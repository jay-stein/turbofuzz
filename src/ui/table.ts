import { clear, el, svgIcon } from "./dom.js";
import {
  describeSuggestion,
  suggestionShortLabel,
  type ColumnSuggestion,
} from "../data/suggestions.js";
import { isNullToken, isNullWithWire } from "../parse/null-tokens.js";
import { parseNumber } from "../parse/numbers.js";
import { valueLength } from "../parse/value-length.js";
import { COLUMN_TYPES, TYPE_LABELS, type ColumnType } from "../types.js";
import type { ColumnMeta } from "../worker/protocol.js";

const ROW_HEIGHT = 28;
const DEFAULT_COL_WIDTH = 180;
const MIN_COL_WIDTH = 56;
const MAX_COL_WIDTH = 720;
const INDEX_WIDTH = 64;
const OVERSCAN = 10;
const CACHE_LIMIT = 4000;

function crossIcon(): SVGElement {
  return svgIcon('<path d="M8 8l8 8"/><path d="M16 8l-8 8"/>', "del-icon");
}

export interface HighlightRule {
  column: number;
  query: string;
  mode: "contains" | "exact";
}

export type ColumnQaKind = "nulls" | "valueAnomalies" | "lengthAnomalies";

export interface ResultTableOptions {
  onSort: (column: number, dir: 1 | -1 | 0) => void;
  onTypeChange: (column: number, type: ColumnType) => void;
  onColumnSpecial: (column: number, kind: ColumnQaKind) => void;
  onMergeSimilar: (column: number) => void;
  onColumnContext: (column: number, x: number, y: number) => void;
  onToggleColumnDelete: (column: number) => void;
  onToggleRowDelete: (position: number) => void;
  /** Applies a one-click fix suggested for the column (sentinel, locale, ...). */
  onSuggestion?: (column: number, suggestion: ColumnSuggestion) => void;
  onRequestRows: (
    start: number,
    end: number,
    done: (start: number, rows: string[][], groups?: boolean[], flags?: Uint8Array) => void,
  ) => void;
}

export class ResultTable {
  private readonly scroller: HTMLDivElement;
  private readonly header: HTMLDivElement;
  private readonly spacer: HTMLDivElement;
  private readonly rowsHost: HTMLDivElement;
  private readonly onResize = (): void => this.render();

  private columns: ColumnMeta[] = [];
  private widths: number[] = [];
  private count = 0;
  private sortColumn = -1;
  private sortDir: 1 | -1 = 1;
  private highlights: HighlightRule[] = [];
  private columnQa = new Set<string>();
  private pendingRowDeletes = new Set<number>();
  private pendingColumnDeletes = new Set<number>();
  private readonly groupStarts = new Set<number>();
  private readonly rowFlags = new Map<number, number>();
  private readonly cache = new Map<number, string[]>();
  private pendingStart = -1;
  private pendingEnd = -1;
  private lastStart = -1;
  private lastEnd = -1;

  constructor(
    root: HTMLElement,
    private readonly options: ResultTableOptions,
  ) {
    this.header = el("div", { class: "table-header" });
    this.rowsHost = el("div", { class: "table-rows" });
    this.spacer = el("div", { class: "table-spacer" }, [this.rowsHost]);
    this.scroller = el("div", { class: "table-scroller" }, [this.header, this.spacer]);
    root.append(this.scroller);

    this.scroller.addEventListener("scroll", () => this.render());
    window.addEventListener("resize", this.onResize);
  }

  dispose(): void {
    window.removeEventListener("resize", this.onResize);
    this.count = 0;
    this.cache.clear();
    this.rowFlags.clear();
  }

  setColumns(columns: ColumnMeta[]): void {
    this.columns = columns;
    this.widths = columns.map(() => DEFAULT_COL_WIDTH);
    this.renderHeader();
    this.invalidateRows();
  }

  /** Replaces one column's metadata (type/fences) without losing widths. */
  updateColumn(column: number, meta: ColumnMeta): void {
    this.columns[column] = meta;
    this.renderHeader();
    this.invalidateRows();
  }

  /** Replaces every column's metadata (preserving widths) and repaints once. */
  updateColumns(columns: ColumnMeta[]): void {
    this.columns = columns;
    this.renderHeader();
    this.invalidateRows();
  }

  /** Re-renders the header after column names are mutated in place. */
  refreshHeader(): void {
    this.renderHeader();
  }

  setCount(count: number): void {
    this.count = count;
    this.spacer.style.height = `${count * ROW_HEIGHT}px`;
    this.spacer.style.width = `${this.totalWidth()}px`;
    this.render();
  }

  setSort(column: number, dir: 1 | -1): void {
    this.sortColumn = column;
    this.sortDir = dir;
    this.renderHeader();
  }

  scrollToTop(): void {
    this.scroller.scrollTop = 0;
    this.invalidateRows();
  }

  setHighlights(highlights: HighlightRule[]): void {
    const unchanged =
      highlights.length === this.highlights.length &&
      highlights.every((rule, index) => {
        const previous = this.highlights[index];
        return (
          rule.column === previous.column &&
          rule.query === previous.query &&
          rule.mode === previous.mode
        );
      });
    if (unchanged) return;
    this.highlights = highlights;
    this.invalidateRows();
  }

  /** Marks which per-column QA chips are currently filtering. */
  setColumnQa(active: ReadonlySet<string>): void {
    this.columnQa = new Set(active);
    this.renderHeader();
  }

  /** Marks rows and columns staged for deletion (red × state). */
  setPendingDeletes(rows: ReadonlySet<number>, columns: ReadonlySet<number>): void {
    this.pendingRowDeletes = new Set(rows);
    this.pendingColumnDeletes = new Set(columns);
    this.renderHeader();
    this.invalidateRows();
  }

  invalidateRows(): void {
    this.cache.clear();
    this.pendingStart = -1;
    this.pendingEnd = -1;
    this.lastStart = -1;
    this.lastEnd = -1;
    this.render();
  }

  /** Seeds the cache with the eagerly shipped first page and repaints. */
  setFirstRows(rows: string[][], groups?: boolean[], flags?: Uint8Array): void {
    this.cache.clear();
    this.groupStarts.clear();
    this.rowFlags.clear();
    for (let i = 0; i < rows.length; i++) {
      this.cache.set(i, rows[i]);
      if (groups?.[i] === true) this.groupStarts.add(i);
      const flag = flags?.[i] ?? 0;
      if (flag !== 0) this.rowFlags.set(i, flag);
    }
    this.pendingStart = -1;
    this.pendingEnd = -1;
    this.lastStart = -1;
    this.lastEnd = -1;
    this.render();
  }

  private toggleSort(column: number): void {
    let dir: 1 | -1 | 0;
    if (this.sortColumn !== column) dir = 1;
    else if (this.sortDir === 1) dir = -1;
    else dir = 0;
    this.options.onSort(column, dir);
  }

  private gridTemplate(): string {
    return [`${INDEX_WIDTH}px`, ...this.widths.map((width) => `${width}px`)].join(" ");
  }

  private totalWidth(): number {
    return INDEX_WIDTH + this.widths.reduce((total, width) => total + width, 0);
  }

  private applyWidths(): void {
    const template = this.gridTemplate();
    this.header.style.gridTemplateColumns = template;
    this.header.style.width = `${this.totalWidth()}px`;
    this.spacer.style.width = `${this.totalWidth()}px`;
    for (const row of this.rowsHost.querySelectorAll<HTMLElement>(".tr")) {
      row.style.gridTemplateColumns = template;
    }
  }

  private startResize(event: PointerEvent, index: number): void {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = this.widths[index];
    const grip = event.currentTarget as HTMLElement;
    grip.classList.add("active");

    const onMove = (move: PointerEvent): void => {
      this.widths[index] = Math.min(
        MAX_COL_WIDTH,
        Math.max(MIN_COL_WIDTH, startWidth + (move.clientX - startX)),
      );
      this.applyWidths();
    };
    const onUp = (): void => {
      grip.classList.remove("active");
      window.removeEventListener("pointermove", onMove);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
  }

  private renderHeader(): void {
    clear(this.header);
    const template = this.gridTemplate();
    this.header.style.gridTemplateColumns = template;
    this.header.style.width = `${this.totalWidth()}px`;

    const indexHead = el("div", {
      class: "th row-index-head",
      title: "Row number (current order) / column number",
    });
    indexHead.append(el("span", { class: "th-index" }, ["#"]));
    this.header.append(indexHead);

    this.columns.forEach((column, index) => {
      const name = column.name;
      const cell = el("div", { class: "th" });
      const qa = this.buildQaRow(column, index);
      const top = el("div", { class: "th-top" });
      const number = el("span", { class: "th-index", title: `Column ${index + 1}` }, [
        String(index + 1),
      ]);
      const label = el(
        "button",
        { class: "th-label", type: "button", title: `Sort by ${name}` },
        [name],
      );
      if (index === this.sortColumn) {
        label.classList.add(this.sortDir === 1 ? "sort-asc" : "sort-desc");
      }
      label.addEventListener("click", () => this.toggleSort(index));

      const grip = el("div", {
        class: "col-resize",
        title: "Drag to resize · double-click to reset",
      });
      grip.addEventListener("pointerdown", (event) =>
        this.startResize(event as PointerEvent, index),
      );
      grip.addEventListener("dblclick", () => {
        this.widths[index] = DEFAULT_COL_WIDTH;
        this.applyWidths();
      });

      const del = el(
        "button",
        { class: "del-btn", type: "button", title: `Delete column “${name}”…` },
        [],
      );
      del.append(crossIcon());
      del.classList.toggle("active", this.pendingColumnDeletes.has(index));
      del.addEventListener("click", (event) => {
        event.stopPropagation();
        this.options.onToggleColumnDelete(index);
      });
      cell.classList.toggle("col-pending", this.pendingColumnDeletes.has(index));

      const typeSelect = el("select", {
        class: "th-type",
        title: `Column ${index + 1} type — change to re-interpret this column`,
      }) as HTMLSelectElement;
      for (const type of COLUMN_TYPES) {
        typeSelect.append(
          el("option", { value: type }, [TYPE_LABELS[type]]) as HTMLOptionElement,
        );
      }
      typeSelect.value = column.type;
      typeSelect.addEventListener("change", () => {
        this.options.onTypeChange(index, typeSelect.value as ColumnType);
      });

      top.append(number, label, grip, del);
      cell.append(qa, top, typeSelect);
      cell.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        this.options.onColumnContext(index, event.clientX, event.clientY);
      });
      this.header.append(cell);
    });
  }

  /**
   * Per-column QA indicators above the column name: empty cells, value
   * outliers, long values, mergeable near-duplicates and constant-value
   * flags. Amber when there is something to act on, muted when clean;
   * clicking a count filters the table to that column's flagged rows.
   */
  private buildQaRow(column: ColumnMeta, index: number): HTMLElement {
    const row = el("div", { class: "th-qa" });
    const chips = [
      this.qaChip(column, index, "nulls", column.stats.nulls, {
        one: "empty cell",
        many: "empty cells",
      }, "click to show rows where this column is empty"),
      this.qaChip(column, index, "valueAnomalies", column.anomalyCounts.values, {
        one: "value outlier",
        many: "value outliers",
      }, "click to show this column's value outliers"),
      this.qaChip(column, index, "lengthAnomalies", column.anomalyCounts.lengths, {
        one: "long value",
        many: "long values",
      }, "click to show this column's overlong values"),
    ].filter((chip): chip is HTMLButtonElement => chip !== null);
    row.append(...chips, ...this.buildFixChips(column, index));
    if (column.similarGroups > 0) {
      const merge = el(
        "button",
        { class: "th-qa-chip warn merge", type: "button" },
        [`${column.similarGroups.toLocaleString()} mergeable`],
      ) as HTMLButtonElement;
      merge.title = `${column.similarGroups.toLocaleString()} group${
        column.similarGroups === 1 ? "" : "s"
      } of near-identical values in “${column.name}” — click to merge them`;
      merge.addEventListener("click", () => this.options.onMergeSimilar(index));
      row.append(merge);
    }
    if (column.stats.distinct === 1) {
      row.append(
        el(
          "span",
          {
            class: "th-qa-chip warn flag",
            title: `Every non-empty row in “${column.name}” has the same value — this column carries little information and may be droppable`,
          },
          ["constant value"],
        ),
      );
    }
    return row;
  }

  private qaChip(
    column: ColumnMeta,
    index: number,
    kind: ColumnQaKind,
    count: number,
    noun: { one: string; many: string },
    hint: string,
  ): HTMLButtonElement | null {
    // Zero-count chips are noise: only surface what needs attention.
    if (count === 0) return null;
    const active = this.columnQa.has(`${index}:${kind}`);
    const text = `${count.toLocaleString()} ${count === 1 ? noun.one : noun.many}`;
    const chip = el("button", { class: "th-qa-chip warn", type: "button" }, [text]) as HTMLButtonElement;
    chip.classList.toggle("active", active);
    chip.title = `${text} in “${column.name}” — ${active ? "click to clear" : hint}`;
    chip.addEventListener("click", () => this.options.onColumnSpecial(index, kind));
    return chip;
  }

  /**
   * One-click fix chips from the column's suggestions (missing-value tokens,
   * mixed decimal conventions, type conflicts, formula-like cells). Same
   * actions as the suggestion chips in the filter sidebar, but on the header
   * where the problem is visible.
   */
  private buildFixChips(column: ColumnMeta, index: number): HTMLButtonElement[] {
    if (column.suggestions.length === 0 || this.options.onSuggestion === undefined) return [];
    return column.suggestions.map((suggestion) => {
      const chip = el(
        "button",
        { class: "th-qa-chip fix", type: "button" },
        [suggestionShortLabel(suggestion)],
      ) as HTMLButtonElement;
      chip.title = `${describeSuggestion(suggestion)} — click to fix`;
      chip.addEventListener("click", () => this.options.onSuggestion?.(index, suggestion));
      return chip;
    });
  }

  private render(): void {
    const height = this.scroller.clientHeight || 600;
    const start = Math.max(0, Math.floor(this.scroller.scrollTop / ROW_HEIGHT) - OVERSCAN);
    const end = Math.min(this.count, start + Math.ceil(height / ROW_HEIGHT) + OVERSCAN * 2);
    if (start === this.lastStart && end === this.lastEnd) return;
    this.lastStart = start;
    this.lastEnd = end;

    clear(this.rowsHost);

    if (this.count === 0) {
      this.rowsHost.style.transform = "translateY(0px)";
      this.rowsHost.append(el("div", { class: "empty" }, ["No matching rows"]));
      return;
    }

    this.rowsHost.style.transform = `translateY(${start * ROW_HEIGHT}px)`;
    const fragment = document.createDocumentFragment();
    let missing = false;

    for (let i = start; i < end; i++) {
      const row = this.cache.get(i);
      if (row === undefined) missing = true;
      fragment.append(this.buildRow(i, row));
    }
    this.rowsHost.append(fragment);

    if (missing && (this.pendingStart !== start || this.pendingEnd !== end)) {
      this.pendingStart = start;
      this.pendingEnd = end;
      this.options.onRequestRows(start, end, (rowsStart, rows, groups, flags) => {
        if (this.pendingStart === start && this.pendingEnd === end) {
          this.pendingStart = -1;
          this.pendingEnd = -1;
        }
        for (let i = 0; i < rows.length; i++) {
          const position = rowsStart + i;
          this.cache.set(position, rows[i]);
          this.groupStarts.delete(position);
          if (groups?.[i] === true) this.groupStarts.add(position);
          this.rowFlags.delete(position);
          const flag = flags?.[i] ?? 0;
          if (flag !== 0) this.rowFlags.set(position, flag);
        }
        this.pruneCache(start);
        this.lastStart = -1;
        this.lastEnd = -1;
        this.render();
      });
    }
  }

  private buildRow(index: number, row: string[] | undefined): HTMLElement {
    const tr = el("div", { class: "tr" });
    tr.style.gridTemplateColumns = this.gridTemplate();
    if (row === undefined) tr.classList.add("skeleton");
    if (this.groupStarts.has(index)) tr.classList.add("group-start");
    if (((this.rowFlags.get(index) ?? 0) & 1) !== 0) tr.classList.add("dup-row");
    if (this.pendingRowDeletes.has(index)) tr.classList.add("row-pending");

    const indexCell = el("div", { class: "td row-index" });
    const del = el(
      "button",
      { class: "del-btn", type: "button", title: "Delete this row…" },
      [],
    );
    del.append(crossIcon());
    del.classList.toggle("active", this.pendingRowDeletes.has(index));
    del.addEventListener("click", (event) => {
      event.stopPropagation();
      this.options.onToggleRowDelete(index);
    });
    indexCell.append(del, el("span", { class: "row-number" }, [String(index + 1)]));
    tr.append(indexCell);

    for (let c = 0; c < this.columns.length; c++) {
      const type = this.columns[c]?.type;
      const cell = el("div", { class: "td" });
      if (type === "integer" || type === "number") cell.classList.add("num-cell");
      else if (type === "boolean") cell.classList.add("bool-cell");
      if (row !== undefined) this.fillCell(cell, row[c] ?? "", c);
      tr.append(cell);
    }
    return tr;
  }

  private pruneCache(center: number): void {
    if (this.cache.size <= CACHE_LIMIT) return;
    for (const key of this.cache.keys()) {
      if (key < center - CACHE_LIMIT / 2 || key > center + CACHE_LIMIT / 2) {
        this.cache.delete(key);
        this.rowFlags.delete(key);
      }
    }
  }

  private fillCell(cell: HTMLElement, value: string, columnIndex: number): void {
    const policy = this.columns[columnIndex]?.nullPolicy;
    const isNull =
      policy === undefined
        ? isNullToken(value)
        : isNullWithWire(value, policy.extra, policy.keep);
    if (isNull) {
      cell.classList.add("null-cell");
      cell.textContent = value;
      return;
    }
    this.applyAnomaly(cell, value, columnIndex);

    const rule = this.highlights.find((candidate) => candidate.column === columnIndex);
    if (rule === undefined || rule.query.trim() === "") {
      cell.textContent = value;
      return;
    }

    const lower = value.toLowerCase();
    const needle = rule.query.trim().toLowerCase();

    if (rule.mode === "exact") {
      if (lower === needle) cell.append(el("mark", {}, [value]));
      else cell.textContent = value;
      return;
    }

    const index = lower.indexOf(needle);
    if (index < 0) {
      cell.textContent = value;
      return;
    }
    cell.append(
      document.createTextNode(value.slice(0, index)),
      el("mark", {}, [value.slice(index, index + needle.length)]),
      document.createTextNode(value.slice(index + needle.length)),
    );
  }

  /** Red-tints cells outside the column's precomputed anomaly fences. */
  private applyAnomaly(cell: HTMLElement, value: string, columnIndex: number): void {
    const meta = this.columns[columnIndex];
    if (meta === undefined) return;

    const valueFence = meta.valueFence;
    if (valueFence !== null) {
      const parsed = parseNumber(value);
      if (Number.isFinite(parsed) && (parsed < valueFence.lo || parsed > valueFence.hi)) {
        cell.classList.add("anomaly-cell");
        const format = (bound: number): string =>
          Number.isFinite(bound)
            ? bound.toLocaleString(undefined, { maximumFractionDigits: 2 })
            : bound > 0
              ? "∞"
              : "-∞";
        const method =
          valueFence.method === "quantile"
            ? "p0.5–p99.5 quantile fence"
            : valueFence.method === "log"
              ? "log-scale median fence (MAD)"
              : "robust median fence (MAD)";
        cell.title = `Value outlier — median ${valueFence.center.toLocaleString()}, expected ${format(valueFence.lo)} – ${format(valueFence.hi)} (${method})`;
      }
      return;
    }

    const lengthFence = meta.lengthFence;
    if (lengthFence !== null) {
      const length = valueLength(value);
      if (length > lengthFence.hi) {
        cell.classList.add("anomaly-cell");
        cell.title = `Overlong value — ${length} chars (expected at most ${Math.round(lengthFence.hi)})`;
      }
    }
  }
}

import { clear, el, svgIcon } from "./dom.js";
import { openMenu, type MenuItem } from "./menu.js";
import {
  describeSuggestion,
  suggestionShortLabel,
  type ColumnSuggestion,
} from "../data/suggestions.js";
import { clusterSimilar, type SimilarCluster } from "../search/similar.js";
import { dismissedClusterCount, isClusterDismissed } from "./similar-dismissals.js";
import { isNullToken, isNullWithWire } from "../parse/null-tokens.js";
import { parseDate, toDateInputValue, toTimeInputValue } from "../parse/dates.js";
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

export type ColumnQaKind =
  | "nulls"
  | "valueAnomalies"
  | "lengthAnomalies"
  | "groupAnomalies"
  | "pattern";

export interface ResultTableOptions {
  onSort: (column: number, dir: 1 | -1 | 0) => void;
  /** Clicking a column name opens the inspector anchored to it. */
  onColumnInspect: (column: number, anchor: HTMLElement) => void;
  onTypeChange: (column: number, type: ColumnType) => void;
  onColumnSpecial: (column: number, kind: ColumnQaKind) => void;
  onMergeSimilar: (column: number) => void;
  onColumnContext: (column: number, x: number, y: number) => void;
  onToggleColumnDelete: (column: number) => void;
  onToggleRowDelete: (position: number) => void;
  /** Applies a one-click fix suggested for the column (sentinel, locale, ...). */
  onSuggestion?: (column: number, suggestion: ColumnSuggestion) => void;
  /** Converts placeholder tokens ("NA", "TBD") to real nulls in one column. */
  onConvertToken?: (column: number, tokens: string[]) => void;
  onRequestRows: (
    start: number,
    end: number,
    done: (
      start: number,
      rows: string[][],
      groups?: boolean[],
      flags?: Uint8Array,
      changed?: Uint8Array,
    ) => void,
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
  /** Per-column fixed decimal display formats (display only, not the data). */
  private formats = new Map<number, number>();
  /** Per-column thousands-separator display (display only, not the data). */
  private grouping = new Set<number>();
  private columnQa = new Set<string>();
  private pendingRowDeletes = new Set<number>();
  private pendingColumnDeletes = new Set<number>();
  private readonly groupStarts = new Set<number>();
  private readonly rowFlags = new Map<number, number>();
  /** Per-row, per-cell 1/0 flags: value changed since load. */
  private readonly changedRows = new Map<number, Uint8Array>();
  private showChanges = false;
  private readonly cache = new Map<number, string[]>();
  private pendingStart = -1;
  private pendingEnd = -1;
  private lastStart = -1;
  private lastEnd = -1;
  /** Column briefly highlighted after a Reports jump; cleared by a timer. */
  private flashIndex: number | null = null;
  private flashTimer: number | null = null;

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
    if (this.flashTimer !== null) window.clearTimeout(this.flashTimer);
    this.count = 0;
    this.cache.clear();
    this.rowFlags.clear();
  }

  setColumns(columns: ColumnMeta[]): void {
    const previous = new Map<string, number>();
    this.columns.forEach((column, index) => {
      const width = this.widths[index];
      if (width !== undefined) previous.set(column.name, width);
    });
    this.columns = columns;
    this.widths = columns.map((column) => previous.get(column.name) ?? DEFAULT_COL_WIDTH);
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

  /**
   * Briefly highlights a column (header and visible cells) and scrolls it into
   * view — used after a Reports action jumps to the table.
   */
  flashColumn(column: number): void {
    if (column < 0 || column >= this.columns.length) return;
    const offset =
      INDEX_WIDTH + this.widths.slice(0, column).reduce((sum, width) => sum + width, 0);
    if (typeof this.scroller.scrollTo === "function") {
      this.scroller.scrollTo({ left: Math.max(0, offset - 120), behavior: "smooth" });
    }
    this.flashIndex = column;
    this.renderHeader();
    this.render();
    if (this.flashTimer !== null) window.clearTimeout(this.flashTimer);
    this.flashTimer = window.setTimeout(() => {
      this.flashTimer = null;
      this.flashIndex = null;
      this.renderHeader();
      this.render();
    }, 1700);
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
  setFirstRows(
    rows: string[][],
    groups?: boolean[],
    flags?: Uint8Array,
    changed?: Uint8Array,
  ): void {
    this.cache.clear();
    this.groupStarts.clear();
    this.rowFlags.clear();
    this.changedRows.clear();
    const columnCount = this.columns.length;
    for (let i = 0; i < rows.length; i++) {
      this.cache.set(i, rows[i]);
      if (groups?.[i] === true) this.groupStarts.add(i);
      const flag = flags?.[i] ?? 0;
      if (flag !== 0) this.rowFlags.set(i, flag);
      if (changed !== undefined && columnCount > 0) {
        const row = changed.slice(i * columnCount, (i + 1) * columnCount);
        if (row.some((value) => value !== 0)) this.changedRows.set(i, row);
      }
    }
    this.pendingStart = -1;
    this.pendingEnd = -1;
    this.lastStart = -1;
    this.lastEnd = -1;
    this.render();
  }

  /** Fixed-decimal display for numeric columns (null entries follow "Auto"). */
  setFormats(formats: ReadonlyMap<number, number>): void {
    this.formats = new Map(formats);
    this.repaintRows();
  }

  /** Per-column thousands-separator display (display only, not the data). */
  setGrouping(columns: Iterable<number>): void {
    this.grouping = new Set(columns);
    this.repaintRows();
  }

  /**
   * Rebuild the visible rows even when the scroll window has not changed —
   * render() skips identical windows, which made display-setting changes look
   * like they did nothing.
   */
  private repaintRows(): void {
    this.lastStart = -1;
    this.lastEnd = -1;
    this.render();
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
      if (this.flashIndex === index) cell.classList.add("flash-column");
      if (column.type === "integer" || column.type === "number") {
        cell.classList.add("num-head");
      }
      const qa = this.buildQaRow(column, index);
      const top = el("div", { class: "th-top" });
      const number = el("span", { class: "th-index", title: `Column ${index + 1}` }, [
        String(index + 1),
      ]);
      const label = el(
        "button",
        { class: "th-label", type: "button", title: `Inspect “${name}”` },
        [name],
      );
      if (index === this.sortColumn) {
        label.classList.add(this.sortDir === 1 ? "sort-asc" : "sort-desc");
      }
      label.addEventListener("click", () => this.options.onColumnInspect(index, label));

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
   * clicking a count filters the table to that column's flagged rows. Two or
   * more count issues collapse into one "N issues" chip with a menu so a busy
   * header can never wrap and push its title below its neighbours'.
   */
  private buildQaRow(column: ColumnMeta, index: number): HTMLElement {
    const row = el("div", { class: "th-qa" });
    const tokenChips = this.buildTokenChips(column, index);
    const issues: {
      kind: ColumnQaKind;
      count: number;
      noun: { one: string; many: string };
      hint: string;
    }[] = [];
    // Placeholder text replaces the generic empty-cell chip so the header
    // stays one line and the actionable count wins.
    if (tokenChips.length === 0 && column.stats.nulls > 0) {
      issues.push({
        kind: "nulls",
        count: column.stats.nulls,
        noun: { one: "empty cell", many: "empty cells" },
        hint: "click to show rows where this column is empty",
      });
    }
    if (column.anomalyCounts.values > 0) {
      issues.push({
        kind: "valueAnomalies",
        count: column.anomalyCounts.values,
        noun: { one: "value outlier", many: "value outliers" },
        hint: "click to show this column's value outliers",
      });
    }
    if (column.anomalyCounts.lengths > 0) {
      issues.push({
        kind: "lengthAnomalies",
        count: column.anomalyCounts.lengths,
        noun: { one: "long value", many: "long values" },
        hint: "click to show this column's overlong values",
      });
    }
    const pattern = column.pattern ?? null;
    if (pattern !== null && pattern.offCount > 0) {
      issues.push({
        kind: "pattern",
        count: pattern.offCount,
        noun: { one: "off-format value", many: "off-format values" },
        hint: `click to show values that don't match ${pattern.mask}`,
      });
    }
    if (issues.length <= 1) {
      for (const issue of issues) {
        const chip = this.qaChip(
          column,
          index,
          issue.kind,
          issue.count,
          issue.noun,
          issue.hint,
        );
        if (chip !== null) row.append(chip);
      }
    } else {
      row.append(this.mergedQaChip(column, index, issues));
    }
    row.append(...tokenChips, ...this.buildFixChips(column, index));
    const similarPairs = column.similarGroups - dismissedClusterCount(column.name);
    if (similarPairs > 0 && column.categories !== null) {
      const merge = el(
        "button",
        { class: "th-qa-chip warn merge", type: "button" },
        [`${similarPairs.toLocaleString()} similar ${similarPairs === 1 ? "pair" : "pairs"}`],
      ) as HTMLButtonElement;
      merge.title = `${similarPairs.toLocaleString()} ${
        similarPairs === 1 ? "pair" : "pairs"
      } of near-identical values in “${column.name}” — click to review`;
      merge.addEventListener("click", () => this.openSimilarPairs(column, index, merge));
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

  /**
   * One chip for a column with several count issues; the menu offers each
   * issue (with its own filter toggle) without making the header taller.
   */
  private mergedQaChip(
    column: ColumnMeta,
    index: number,
    issues: readonly {
      kind: ColumnQaKind;
      count: number;
      noun: { one: string; many: string };
      hint: string;
    }[],
  ): HTMLButtonElement {
    const anyActive = issues.some((issue) => this.columnQa.has(`${index}:${issue.kind}`));
    const chip = el(
      "button",
      { class: "th-qa-chip warn", type: "button" },
      [`${issues.length} issues`],
    ) as HTMLButtonElement;
    chip.classList.toggle("active", anyActive);
    chip.setAttribute("aria-pressed", anyActive ? "true" : "false");
    chip.title = `${issues.length} issues in “${column.name}” — click to choose what to show`;
    chip.addEventListener("click", () => {
      openMenu(
        chip,
        issues.map((issue) => {
          const label = `${issue.count.toLocaleString()} ${
            issue.count === 1 ? issue.noun.one : issue.noun.many
          }`;
          const active = this.columnQa.has(`${index}:${issue.kind}`);
          return {
            label: `${label}${active ? " ✓" : ""}`,
            title: `${label} in “${column.name}” — ${
              active ? "click to clear" : issue.hint
            }`,
            action: () => this.options.onColumnSpecial(index, issue.kind),
          };
        }),
      );
    });
    return chip;
  }

  /**
   * Popover for the "N similar pairs" chip: up to three pairs with counts,
   * then the Merge panel for the full review.
   */
  private openSimilarPairs(column: ColumnMeta, index: number, anchor: HTMLElement): void {
    const labels = column.categories?.labels ?? [];
    const counts = column.categories?.counts ?? [];
    const clusters = clusterSimilar(
      labels.map((value, memberIndex) => ({ value, count: counts[memberIndex] })),
    )
      .filter((cluster) => !isClusterDismissed(column.name, cluster))
      .slice(0, 3);
    const items: MenuItem[] = clusters.map((cluster) => ({
      label: this.pairLabel(cluster),
      title: cluster.values
        .map((entry) => `${entry.value} (${entry.count.toLocaleString()})`)
        .join(" / "),
      disabled: true,
      action: () => {},
    }));
    items.push({
      label: "Merge values…",
      title: "Review and merge these values",
      action: () => this.options.onMergeSimilar(index),
    });
    openMenu(anchor, items);
  }

  /** “Widget A (42) / Widget B (3)” for one similar cluster. */
  private pairLabel(cluster: SimilarCluster): string {
    const suggested =
      cluster.values.find((entry) => entry.value === cluster.suggested) ?? cluster.values[0];
    const other = cluster.values.find((entry) => entry.value !== cluster.suggested);
    if (other === undefined) return `${suggested.value} (${suggested.count.toLocaleString()})`;
    return `${suggested.value} (${suggested.count.toLocaleString()}) / ${other.value} (${other.count.toLocaleString()})`;
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
    chip.setAttribute("aria-pressed", active ? "true" : "false");
    chip.title = `${text} in “${column.name}” — ${active ? "click to clear" : hint}`;
    chip.addEventListener("click", () => this.options.onColumnSpecial(index, kind));
    return chip;
  }

  /**
   * Header chip for placeholder tokens in this column ("NA", "TBD", "NULL").
   * One click blanks all of them in this column as a tracked, undoable step —
   * the missing-value policy considers every null spelling at once, so the
   * chip counts all placeholder cells rather than one token.
   */
  private buildTokenChips(column: ColumnMeta, index: number): HTMLButtonElement[] {
    if (this.options.onConvertToken === undefined) return [];
    const tokens = column.nullTokens.filter((token) => token.label !== "" && token.count > 0);
    if (tokens.length === 0) return [];
    const total = tokens.reduce((sum, token) => sum + token.count, 0);
    const ranked = tokens
      .slice()
      .sort((a, b) => b.count - a.count)
      .map((token) => token.label);
    const chip = el(
      "button",
      { class: "th-qa-chip fix token", type: "button" },
      [`${total.toLocaleString()} ${total === 1 ? "placeholder" : "placeholders"}`],
    ) as HTMLButtonElement;
    const examples = ranked.slice(0, 3).map((label) => `“${label}”`).join(", ");
    const blanks = Math.max(0, column.stats.nulls - total);
    chip.title = `${column.stats.nulls.toLocaleString()} cells in “${column.name}” are missing${
      blanks > 0
        ? ` (${blanks.toLocaleString()} blank + ${total.toLocaleString()} placeholder text)`
        : ""
    } — click to blank the placeholder text ${examples}${
      ranked.length > 3 ? ", …" : ""
    } (undo in the Recipe)`;
    chip.addEventListener("click", () => this.options.onConvertToken?.(index, ranked));
    return [chip];
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
      this.options.onRequestRows(start, end, (rowsStart, rows, groups, flags, changed) => {
        if (this.pendingStart === start && this.pendingEnd === end) {
          this.pendingStart = -1;
          this.pendingEnd = -1;
        }
        const columnCount = this.columns.length;
        for (let i = 0; i < rows.length; i++) {
          const position = rowsStart + i;
          this.cache.set(position, rows[i]);
          this.groupStarts.delete(position);
          if (groups?.[i] === true) this.groupStarts.add(position);
          this.rowFlags.delete(position);
          const flag = flags?.[i] ?? 0;
          if (flag !== 0) this.rowFlags.set(position, flag);
          this.changedRows.delete(position);
          if (changed !== undefined && columnCount > 0) {
            const row = changed.slice(i * columnCount, (i + 1) * columnCount);
            if (row.some((value) => value !== 0)) this.changedRows.set(position, row);
          }
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

    const changedRow = this.changedRows.get(index);
    for (let c = 0; c < this.columns.length; c++) {
      const type = this.columns[c]?.type;
      const cell = el("div", { class: "td" });
      if (this.flashIndex === c) cell.classList.add("flash-column");
      if (type === "integer" || type === "number") cell.classList.add("num-cell");
      else if (type === "boolean") cell.classList.add("bool-cell");
      if (row !== undefined) this.fillCell(cell, row[c] ?? "", c);
      if (changedRow !== undefined && changedRow[c] === 1) {
        cell.classList.add("changed-cell");
      }
      tr.append(cell);
    }
    return tr;
  }

  /** "Show changes" toggle: reveals cells whose value differs from load. */
  setShowChanges(show: boolean): void {
    this.showChanges = show;
    this.scroller.classList.toggle("show-changes", show);
  }

  private pruneCache(center: number): void {
    if (this.cache.size <= CACHE_LIMIT) return;
    for (const key of this.cache.keys()) {
      if (key < center - CACHE_LIMIT / 2 || key > center + CACHE_LIMIT / 2) {
        this.cache.delete(key);
        this.rowFlags.delete(key);
        this.changedRows.delete(key);
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
      if (value !== "") {
        // Placeholder tokens ("NA", "TBD") keep a bold red value so the raw
        // text stays readable through the hatching and looks clickable.
        cell.classList.add("null-token-cell");
        cell.title = `“${value}” is read as a missing value — convert placeholder tokens from the Overview or Clean → Nulls`;
      }
      return;
    }
    this.applyAnomaly(cell, value, columnIndex);

    // Type-aware display formatting (display only; stored values unchanged):
    // - integers always render whole values ("1.0" -> 1), honouring grouping
    // - number columns honour the forced-decimal and grouping preferences
    // - date/datetime cells render in one standard shape (YYYY/MM/DD [HH:MM])
    const decimals = this.formats.get(columnIndex);
    const grouped = this.grouping.has(columnIndex);
    const numericType = this.columns[columnIndex]?.type;
    let display = value;
    if (numericType === "integer") {
      const parsed = parseNumber(value);
      if (Number.isFinite(parsed) && Number.isInteger(parsed)) {
        display = parsed.toLocaleString(undefined, {
          useGrouping: grouped,
          maximumFractionDigits: 0,
        });
      }
    } else if (numericType === "number" && (decimals !== undefined || grouped)) {
      const parsed = parseNumber(value);
      if (Number.isFinite(parsed)) {
        display =
          decimals !== undefined
            ? parsed.toLocaleString(undefined, {
                minimumFractionDigits: decimals,
                maximumFractionDigits: decimals,
              })
            : parsed.toLocaleString(undefined, {
                useGrouping: grouped,
                maximumFractionDigits: 20,
              });
      }
    } else if (numericType === "date" || numericType === "datetime") {
      const dateOrder = this.columns[columnIndex]?.dateOrder ?? "dmy";
      const ms = parseDate(value, dateOrder);
      if (Number.isFinite(ms)) {
        const date = toDateInputValue(ms).replace(/-/g, "/");
        display = numericType === "datetime" ? `${date} ${toTimeInputValue(ms)}` : date;
      }
    }
    if (display !== value && cell.title === "") cell.title = value;

    const rule = this.highlights.find((candidate) => candidate.column === columnIndex);
    if (rule === undefined || rule.query.trim() === "") {
      cell.textContent = display;
      return;
    }

    const lower = display.toLowerCase();
    const needle = rule.query.trim().toLowerCase();

    if (rule.mode === "exact") {
      if (lower === needle) cell.append(el("mark", {}, [display]));
      else cell.textContent = display;
      return;
    }

    const index = lower.indexOf(needle);
    if (index < 0) {
      cell.textContent = display;
      return;
    }
    cell.append(
      document.createTextNode(display.slice(0, index)),
      el("mark", {}, [display.slice(index, index + needle.length)]),
      document.createTextNode(display.slice(index + needle.length)),
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

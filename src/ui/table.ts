import { clear, el, svgIcon } from "./dom.js";
import { openMenu, type MenuItem } from "./menu.js";
import { FilterPanel } from "./filters.js";
import {
  describeSuggestion,
  suggestionShortLabel,
  type ColumnSuggestion,
} from "../data/suggestions.js";
import { clusterSimilar, type SimilarCluster } from "../search/similar.js";
import { chipClass, chipText, collapsedFixLabel, suggestionChipLabel } from "./chips.js";
import { dismissedClusterCount, isClusterDismissed } from "./similar-dismissals.js";
import { isNullToken, isNullWithWire } from "../parse/null-tokens.js";
import { parseDate, toDateInputValue, toTimeInputValue } from "../parse/dates.js";
import { parseNumber } from "../parse/numbers.js";
import { valueLength } from "../parse/value-length.js";
import { COLUMN_TYPES, TYPE_LABELS, type ColumnType } from "../types.js";
import type { ColumnMeta } from "../worker/protocol.js";
import type { ColumnFilter } from "../search/query-engine.js";
import { formatDurationMs, toDateTimeInputValue } from "../parse/dates.js";

const ROW_HEIGHT = 28;
/** Short header glyphs for the column types (the full name is the select's title). */
const TYPE_GLYPHS: Partial<Record<ColumnType, string>> = {
  string: "Aa",
  category: "Cat",
  integer: "123",
  number: "1.5",
  date: "Date",
  datetime: "D+T",
  time: "Time",
  duration: "Dur",
  boolean: "T/F",
  identifier: "ID",
};

const DEFAULT_COL_WIDTH = 180;
const MIN_COL_WIDTH = 56;
const MAX_COL_WIDTH = 720;
const INDEX_WIDTH = 64;
/** The optional File row column: the row's number in the loaded data, whatever the order. */
const FILE_ROW_WIDTH = 76;
/** The + after the last header, where a new column would go. */
const ADD_COLUMN_WIDTH = 40;
const OVERSCAN = 10;
const CACHE_LIMIT = 4000;

function crossIcon(): SVGElement {
  return svgIcon('<path d="M8 8l8 8"/><path d="M16 8l-8 8"/>', "del-icon");
}

function filterIcon(): SVGElement {
  return svgIcon('<path d="M2 3h12l-4.5 5.5V14l-3-1.5V8.5z"/>', "quick-filter-icon");
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
  onTypeChange: (column: number, type: ColumnType) => boolean | Promise<boolean>;
  /** The column's values that best fit what was typed in a filter (a few letters or a small typo). */
  requestValueSuggestions?: (column: number, query: string) => Promise<{ label: string; count: number }[]>;
  /** Quick contains filter typed directly in a column header. */
  onQuickFilter?: (column: number, query: string) => void;
  /** Current contains query for a column, used to restore the header input. */
  quickFilterFor?: (column: number) => string;
  /** Full filter state for a column, used by typed header filters. */
  columnFilterFor?: (column: number) => ColumnFilter | null;
  /** Applies a typed header filter. */
  onColumnFilter?: (column: number, filter: ColumnFilter | null) => void;
  onColumnSpecial: (column: number, kind: ColumnQaKind) => void;
  onMergeSimilar: (column: number) => void;
  onColumnContext: (column: number, x: number, y: number) => void;
  onToggleColumnDelete: (column: number) => void;
  onToggleRowDelete: (position: number) => void;
  /** Applies a one-click fix suggested for the column (sentinel, locale, ...). */
  onSuggestion?: (column: number, suggestion: ColumnSuggestion) => void;
  /** Converts placeholder tokens ("NA", "TBD") to real nulls in one column. */
  onConvertToken?: (column: number, tokens: string[]) => void;
  /** Clamps a numeric column's extreme values at a percentile. */
  onWinsorize?: (column: number, percent: number) => void;
  /** Adds a Yes/No outlier flag column for a numeric column. */
  onFlagAnomalies?: (column: number) => void;
  /** Opens Clean for a column on the requested tab. */
  onOpenClean?: (column: number, tab: "nulls" | "values") => void;
  /** Opens the one-click fill menu for a column's empty cells, anchored to the chip. */
  onFillMenu?: (anchor: HTMLElement, column: number) => void;
  /** Opens the outlier fix menu for a column, anchored to the chip. */
  onOutlierMenu?: (anchor: HTMLElement, column: number) => void;
  /** Dataset row indexes for positions [start, end), for the File row column. */
  onRequestRowIds?: (start: number, end: number, done: (start: number, ids: Uint32Array) => void) => void;
  /** The + at the end of the header row: a new column at the end. */
  onAddColumn?: () => void;
  /** The rows on screen changed: first and last visible position (0-based), and the row count. */
  onViewport?: (first: number, last: number, count: number) => void;
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
  private quickFilterTimer: number | null = null;

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
  /** Row briefly highlighted after Go to; cleared by a timer. */
  private flashRow: number | null = null;
  private flashRowTimer: number | null = null;
  private showFileRow = false;
  /** Dataset row index per position, for the File row column (cleared with the rows). */
  private readonly ids = new Map<number, number>();
  private idsPending = "";
  private lastViewport = "";

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
    if (this.quickFilterTimer !== null) window.clearTimeout(this.quickFilterTimer);
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

  /** Rebuilds header filter state unless the user is typing in a header input. */
  refreshFilters(): void {
    if (this.header.contains(document.activeElement)) return;
    this.renderHeader();
  }

  private sensitiveNotes = new Map<number, string>();

  /** Marks columns that may hold sensitive data (index -> why); shown as a small dot. */
  setSensitive(notes: ReadonlyMap<number, string>): void {
    this.sensitiveNotes = new Map(notes);
    this.renderHeader();
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
      this.leadWidth() + this.widths.slice(0, column).reduce((sum, width) => sum + width, 0);
    if (typeof this.scroller.scrollTo === "function") {
      this.scroller.scrollTo({ left: Math.max(0, offset - 120), behavior: "smooth" });
    }
    this.flashIndex = column;
    this.renderHeader();
    this.render();
    if (this.flashTimer !== null) window.clearTimeout(this.flashTimer);
    if (this.quickFilterTimer !== null) window.clearTimeout(this.quickFilterTimer);
    this.flashTimer = window.setTimeout(() => {
      this.flashTimer = null;
      this.flashIndex = null;
      this.renderHeader();
      this.render();
    }, 1700);
  }

  setCount(count: number): void {
    const before = this.indexWidth();
    this.count = count;
    if (this.indexWidth() !== before) {
      this.renderHeader();
      this.lastStart = -1;
    }
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

  /** Scrolls the last row into view. */
  scrollToBottom(): void {
    this.scroller.scrollTop = this.scroller.scrollHeight;
    this.render();
  }

  /** Scrolls a position (0-based, current order) into view, a third of the way down, and flashes it. */
  scrollToRow(position: number): void {
    const visible = Math.max(1, Math.floor((this.scroller.clientHeight - this.header.offsetHeight) / ROW_HEIGHT));
    this.scroller.scrollTop = Math.max(0, (position - Math.floor(visible / 3)) * ROW_HEIGHT);
    this.flashRow = position;
    if (this.flashRowTimer !== null) window.clearTimeout(this.flashRowTimer);
    this.flashRowTimer = window.setTimeout(() => {
      this.flashRow = null;
      this.flashRowTimer = null;
      this.repaintRows();
    }, 1600);
    this.repaintRows();
  }

  /** Shows or hides the File row column (the row's number in the loaded data). */
  setShowFileRow(on: boolean): void {
    if (on === this.showFileRow) return;
    this.showFileRow = on;
    this.renderHeader();
    this.spacer.style.width = `${this.totalWidth()}px`;
    this.repaintRows();
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
    this.ids.clear();
    this.idsPending = "";
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
    this.ids.clear();
    this.idsPending = "";
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

  /** The # column fits the longest row number (12,480 needs five digits) beside the delete button. */
  private indexWidth(): number {
    return Math.max(INDEX_WIDTH, 30 + 8 * String(Math.max(1, this.count)).length);
  }

  /** Width of the row-number columns before the data: # and, when shown, File row. */
  private leadWidth(): number {
    return this.indexWidth() + (this.showFileRow ? FILE_ROW_WIDTH : 0);
  }

  private gridTemplate(): string {
    return [`${this.indexWidth()}px`, ...(this.showFileRow ? [`${FILE_ROW_WIDTH}px`] : []), ...this.widths.map((width) => `${width}px`)].join(" ");
  }

  private totalWidth(): number {
    return this.leadWidth() + this.widths.reduce((total, width) => total + width, 0);
  }

  /** The header has one more track than the rows: the + for a new column. */
  private headerTemplate(): string {
    return this.options.onAddColumn === undefined ? this.gridTemplate() : `${this.gridTemplate()} ${ADD_COLUMN_WIDTH}px`;
  }

  private headerWidth(): number {
    return this.totalWidth() + (this.options.onAddColumn === undefined ? 0 : ADD_COLUMN_WIDTH);
  }

  private applyWidths(): void {
    const template = this.gridTemplate();
    this.header.style.gridTemplateColumns = this.headerTemplate();
    this.header.style.width = `${this.headerWidth()}px`;
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
    this.header.style.gridTemplateColumns = this.headerTemplate();
    this.header.style.width = `${this.headerWidth()}px`;

    const indexHead = el("div", {
      class: "th row-index-head",
      title: "Row number (current order) / column number",
    });
    indexHead.append(el("span", { class: "th-index" }, ["#"]));
    this.header.append(indexHead);
    if (this.showFileRow) {
      this.header.append(
        el("div", { class: "th file-row-head", title: "The row's number in the loaded data: it stays with the row through sorting, filtering and shuffling" }, [
          el("span", { class: "th-index" }, ["File row"]),
        ]),
      );
    }

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
      const sensitiveNote = this.sensitiveNotes.get(index);

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
      // The select stays the real control; a short glyph shows in the header
      // so the column name keeps the width.
      const typeWrap = el("span", {
        class: "th-type-wrap",
        "data-glyph": TYPE_GLYPHS[column.type] ?? "",
      });
      typeWrap.append(typeSelect);
      typeSelect.addEventListener("change", () => {
        typeWrap.dataset.glyph = TYPE_GLYPHS[typeSelect.value as ColumnType] ?? "";
      });
      typeSelect.addEventListener("change", () => {
        const previous = column.type;
        const applied = this.options.onTypeChange(
          index,
          typeSelect.value as ColumnType,
        );
        const restore = (ok: boolean): void => {
          if (!ok) typeSelect.value = previous;
        };
        if (applied instanceof Promise) void applied.then(restore);
        else restore(applied);
      });

      if (sensitiveNote !== undefined) {
        const dot = el("span", {
          class: "th-sensitive-dot",
          role: "img",
          "aria-label": `Possibly sensitive: ${sensitiveNote}`,
          title: `Possibly sensitive — ${sensitiveNote}`,
        });
        top.append(number, label, dot, grip, del);
      } else {
        top.append(number, label, grip, del);
      }

      const quickFilter = el("div", { class: "th-filter" });
      const filterMark = el("span", { class: "th-filter-icon" });
      filterMark.append(filterIcon());
      if (this.options.onColumnFilter !== undefined) {
        const activeFilter = this.options.columnFilterFor?.(index) ?? null;
        quickFilter.classList.add("th-filter-button");
        if (activeFilter !== null) quickFilter.classList.add("active");
        const filterLabel = el("span", { class: "th-filter-label" }, [
          activeFilter === null ? "Filter…" : describeHeaderFilter(activeFilter, column),
        ]);
        quickFilter.append(filterMark, filterLabel);
        quickFilter.setAttribute("role", "button");
        quickFilter.tabIndex = 0;
        quickFilter.title =
          activeFilter === null
            ? `Filter ${name}`
            : `${describeHeaderFilter(activeFilter, column)} - click to edit`;
        const open = (): void => {
          openHeaderFilterPanel(
            quickFilter,
            column,
            activeFilter,
            (filter) => {
              this.options.onColumnFilter?.(index, filter);
              this.renderHeader();
            },
            this.options.requestValueSuggestions === undefined
              ? undefined
              : (query) => this.options.requestValueSuggestions!(index, query),
          );
        };
        quickFilter.addEventListener("click", (event) => {
          event.stopPropagation();
          open();
        });
        quickFilter.addEventListener("keydown", (event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          open();
        });
      } else {
        const current = this.options.quickFilterFor?.(index) ?? "";
        if (current !== "") quickFilter.classList.add("active");
        const filterInput = el("input", {
          class: "th-filter-input",
          type: "text",
          value: current,
          placeholder: "Filter…",
          title: `Quick contains filter for "${name}"`,
          "aria-label": `Filter ${name}`,
        }) as HTMLInputElement;
        const applyQuickFilter = (): void => {
          if (this.quickFilterTimer !== null) {
            window.clearTimeout(this.quickFilterTimer);
            this.quickFilterTimer = null;
          }
          const query = filterInput.value.trim();
          quickFilter.classList.toggle("active", query !== "");
          this.options.onQuickFilter?.(index, query);
        };
        filterInput.addEventListener("input", () => {
          if (this.quickFilterTimer !== null) window.clearTimeout(this.quickFilterTimer);
          this.quickFilterTimer = window.setTimeout(applyQuickFilter, 140);
        });
        filterInput.addEventListener("keydown", (event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            applyQuickFilter();
          }
        });
        filterInput.addEventListener("blur", applyQuickFilter);
        filterInput.addEventListener("click", (event) => event.stopPropagation());
        quickFilter.append(filterMark, filterInput);
      }      cell.append(qa, top, typeWrap, quickFilter);
      cell.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        this.options.onColumnContext(index, event.clientX, event.clientY);
      });
      this.header.append(cell);
    });
    if (this.options.onAddColumn !== undefined) {
      const add = el("button", { class: "th add-col-head", type: "button", title: "Add a column: a formula over the others, or one value for every row", "aria-label": "Add a column" }, ["+"]);
      add.addEventListener("click", () => this.options.onAddColumn?.());
      this.header.append(add);
    }
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
      action: string;
      hint: string;
    }[] = [];
    // Placeholder text replaces the generic empty-cell chip so the header
    // stays one line and the actionable count wins.
    const placeholders = tokenChips.length > 0;
    if (column.stats.nulls > 0) {
      issues.push({
        kind: "nulls",
        count: column.stats.nulls,
        noun: { one: "empty cell", many: "empty cells" },
        action: placeholders ? "View placeholders" : "View empty cells",
        hint: placeholders
          ? "show the rows where this column is missing or holds placeholder text"
          : "show rows where this column is empty",
      });
    }
    if (column.anomalyCounts.values > 0) {
      issues.push({
        kind: "valueAnomalies",
        count: column.anomalyCounts.values,
        noun: { one: "value outlier", many: "value outliers" },
        action: "View outliers",
        hint: "show this column's value outliers",
      });
    }
    if (column.anomalyCounts.lengths > 0) {
      issues.push({
        kind: "lengthAnomalies",
        count: column.anomalyCounts.lengths,
        noun: { one: "long value", many: "long values" },
        action: "View long values",
        hint: "show this column's overlong values",
      });
    }
    const pattern = column.pattern ?? null;
    if (pattern !== null && pattern.offCount > 0) {
      issues.push({
        kind: "pattern",
        count: pattern.offCount,
        noun: { one: "off-format value", many: "off-format values" },
        action: "View off-pattern",
        hint: `show values that don't match ${pattern.mask}`,
      });
    }
    if (issues.length <= 2) {
      for (const issue of issues) {
        const chip = this.qaChip(
          column,
          index,
          issue.kind,
          issue.count,
          issue.noun,
          issue.action,
          issue.hint,
        );
        if (chip !== null) row.append(chip);
      }
    } else {
      row.append(this.mergedQaChip(column, index, issues));
    }
    const fixes = [
      ...tokenChips,
      ...this.buildIssueFixChips(column, index, issues),
      ...this.buildFixChips(column, index),
    ];
    if (fixes.length > 2) row.append(this.mergedFixChip(column, fixes));
    else row.append(...fixes);
    const similarPairs = column.similarGroups - dismissedClusterCount(column.name);
    if (similarPairs > 0 && column.categories !== null) {
      const merge = el(
        "button",
        { class: "th-qa-chip warn merge", type: "button" },
        [`Review similar · ${similarPairs.toLocaleString()}`],
      ) as HTMLButtonElement;
      merge.title = `${similarPairs.toLocaleString()} ${
        similarPairs === 1 ? "pair" : "pairs"
      } of near-identical values in “${column.name}” — click to review`;
      merge.addEventListener("click", () => this.openSimilarPairs(column, index, merge));
      row.append(merge);
    }
    if (column.stats.distinct === 1) {
      const constant = el(
        "button",
        {
          class: "th-qa-chip warn flag",
          type: "button",
          title: `Every non-empty row in “${column.name}” has the same value — open the column inspector to review or drop it`,
        },
        ["Review constant"],
      ) as HTMLButtonElement;
      constant.addEventListener("click", () =>
        this.options.onColumnInspect(index, constant),
      );
      row.append(constant);
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
      action: string;
      hint: string;
    }[],
  ): HTMLButtonElement {
    const anyActive = issues.some((issue) => this.columnQa.has(`${index}:${issue.kind}`));
    const chip = el(
      "button",
      { class: "th-qa-chip warn", type: "button" },
      [`View ${issues.length} issue types`],
    ) as HTMLButtonElement;
    chip.classList.toggle("active", anyActive);
    chip.setAttribute("aria-pressed", anyActive ? "true" : "false");
    chip.title = `${issues.length} issue types in “${column.name}” — choose what to show`;
    chip.addEventListener("click", () => {
      openMenu(
        chip,
        issues.map((issue) => {
          const label = `${issue.action} · ${issue.count.toLocaleString()}`;
          const active = this.columnQa.has(`${index}:${issue.kind}`);
          return {
            label: `${label}${active ? " ✓" : ""}`,
            title: `${issue.count.toLocaleString()} ${
              issue.count === 1 ? issue.noun.one : issue.noun.many
            } in “${column.name}” — ${active ? "click to clear" : issue.hint}`,
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
    action: string,
    hint: string,
  ): HTMLButtonElement | null {
    // Zero-count chips are noise: only surface what needs attention.
    if (count === 0) return null;
    const active = this.columnQa.has(`${index}:${kind}`);
    const meaning = `${count.toLocaleString()} ${
      count === 1 ? noun.one : noun.many
    } in “${column.name}”`;
    const chip = el(
      "button",
      { class: "th-qa-chip warn", type: "button" },
      [`${action} · ${count.toLocaleString()}`],
    ) as HTMLButtonElement;
    chip.classList.toggle("active", active);
    chip.setAttribute("aria-pressed", active ? "true" : "false");
    chip.title = `${meaning} — ${active ? "click to clear" : hint}`;
    chip.addEventListener("click", () => this.options.onColumnSpecial(index, kind));
    return chip;
  }

  /** Fix actions for count issues; each opens a menu or the Clean drawer. */
  private buildIssueFixChips(
    column: ColumnMeta,
    index: number,
    issues: readonly { kind: ColumnQaKind; count: number; action: string }[],
  ): HTMLButtonElement[] {
    const chips: HTMLButtonElement[] = [];
    const nulls = issues.find((issue) => issue.kind === "nulls")?.count ?? 0;
    if (nulls > 0 && (this.options.onFillMenu !== undefined || this.options.onOpenClean !== undefined)) {
      const fix = el(
        "button",
        { class: `${chipClass("fix")} issue-fix`, type: "button" },
        [chipText("fix", nulls > 1 ? "empty cells…" : "empty cell…")],
      ) as HTMLButtonElement;
      fix.title =
        this.options.onFillMenu !== undefined
          ? `Fill the empty cells in “${column.name}” — median, mean, most common value and more`
          : `Open Clean · Nulls for “${column.name}” — fill or blank the empty cells`;
      fix.addEventListener("click", () => {
        if (this.options.onFillMenu !== undefined) this.options.onFillMenu(fix, index);
        else this.options.onOpenClean?.(index, "nulls");
      });
      chips.push(fix);
    }
    const longValues = issues.find((issue) => issue.kind === "lengthAnomalies")?.count ?? 0;
    if (longValues > 0 && this.options.onOpenClean !== undefined) {
      const fix = el(
        "button",
        { class: `${chipClass("fix")} issue-fix`, type: "button" },
        [chipText("fix", "long values…")],
      ) as HTMLButtonElement;
      fix.title = `Open Clean for “${column.name}” to review or trim overlong values`;
      fix.addEventListener("click", () => this.options.onOpenClean?.(index, "values"));
      chips.push(fix);
    }
    const outliers = issues.find((issue) => issue.kind === "valueAnomalies")?.count ?? 0;
    if (outliers > 0) {
      const canFix =
        this.options.onOutlierMenu !== undefined ||
        this.options.onWinsorize !== undefined ||
        this.options.onFlagAnomalies !== undefined ||
        this.options.onOpenClean !== undefined;
      if (canFix) {
        const fix = el(
          "button",
          { class: `${chipClass("fix")} issue-fix`, type: "button" },
          [chipText("fix", "outliers…")],
        ) as HTMLButtonElement;
        fix.title = `Choose a fix for ${outliers.toLocaleString()} unusual values in “${column.name}”`;
        fix.addEventListener("click", () => {
          if (this.options.onOutlierMenu !== undefined) {
            this.options.onOutlierMenu(fix, index);
            return;
          }
          const items: MenuItem[] = [];
          if (this.options.onWinsorize !== undefined) {
            items.push({
              label: "Clip extremes at 1% / 99%",
              title: "Winsorise the column — extreme values move to the fence (undoable)",
              action: () => this.options.onWinsorize?.(index, 1),
            });
          }
          if (this.options.onFlagAnomalies !== undefined) {
            items.push({
              label: "Flag unusual values",
              title: "Add a Yes/No column marking the outlier rows",
              action: () => this.options.onFlagAnomalies?.(index),
            });
          }
          if (this.options.onOpenClean !== undefined) {
            items.push({
              label: "Open Clean…",
              title: "Review and edit individual values",
              action: () => this.options.onOpenClean?.(index, "values"),
            });
          }
          openMenu(fix, items);
        });
        chips.push(fix);
      }
    }
    return chips;
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
      [
        `Fix: Blank ${total.toLocaleString()} ${
          total === 1 ? "placeholder" : "placeholders"
        }`,
      ],
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
        [suggestionChipLabel(suggestionShortLabel(suggestion))],
      ) as HTMLButtonElement;
      chip.title = `${describeSuggestion(suggestion)} — click to fix`;
      chip.addEventListener("click", () => this.options.onSuggestion?.(index, suggestion));
      return chip;
    });
  }

  /** Keep busy headers to one line: >2 fixes collapse into a menu. */
  private mergedFixChip(
    column: ColumnMeta,
    fixes: readonly HTMLButtonElement[],
  ): HTMLButtonElement {
    const chip = el(
      "button",
      { class: `${chipClass("fix")} merge`, type: "button" },
      [collapsedFixLabel(fixes.length)],
    ) as HTMLButtonElement;
    chip.title = `${fixes.length} fixes in "${column.name}" - choose one; each is undoable`;
    chip.addEventListener("click", () => {
      openMenu(
        chip,
        fixes.map((fix) => ({
          label: fix.textContent ?? "Fix",
          title: fix.title,
          action: () => fix.click(),
        })),
      );
    });
    return chip;
  }
  private render(): void {
    const height = this.scroller.clientHeight || 600;
    this.reportViewport(height);
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
    this.requestIds(start, end);

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

  /** Reports the rows on screen again, even if unchanged (a new bar, a new row count). */
  refreshViewport(): void {
    this.lastViewport = "";
    this.reportViewport(this.scroller.clientHeight || 600);
  }

  /** Tells the page which rows are on screen, once per change. */
  private reportViewport(height: number): void {
    if (this.options.onViewport === undefined) return;
    // Rows sit under the sticky header: row i spans [i, i + 1) x ROW_HEIGHT below it.
    const top = this.scroller.scrollTop;
    const first = Math.min(Math.max(0, this.count - 1), Math.floor(top / ROW_HEIGHT));
    const last = Math.max(first, Math.min(this.count - 1, Math.floor((top + height - this.header.offsetHeight - 1) / ROW_HEIGHT)));
    const key = `${first}|${last}|${this.count}`;
    if (key === this.lastViewport) return;
    this.lastViewport = key;
    this.options.onViewport(first, last, this.count);
  }

  /** Fetches the File row numbers the shown rows still lack. */
  private requestIds(start: number, end: number): void {
    if (!this.showFileRow || this.options.onRequestRowIds === undefined) return;
    let need = false;
    for (let i = start; i < end && !need; i++) if (!this.ids.has(i)) need = true;
    const key = `${start}|${end}`;
    if (!need || this.idsPending === key) return;
    this.idsPending = key;
    this.options.onRequestRowIds(start, end, (from, ids) => {
      if (this.idsPending === key) this.idsPending = "";
      ids.forEach((id, k) => this.ids.set(from + k, id));
      // Keep the map small: only positions near the window.
      if (this.ids.size > 5000) for (const position of this.ids.keys()) if (Math.abs(position - start) > 2000) this.ids.delete(position);
      this.repaintRows();
    });
  }

  private buildRow(index: number, row: string[] | undefined): HTMLElement {
    const tr = el("div", { class: "tr" });
    if (this.flashRow === index) tr.classList.add("flash-row");
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
    if (this.showFileRow) {
      const id = this.ids.get(index);
      tr.append(el("div", { class: "td file-row" }, [id === undefined ? "" : String(id + 1)]));
    }

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
    // - date/datetime cells render as ISO YYYY-MM-DD [HH:MM]
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
        const date = toDateInputValue(ms);
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

function formatHeaderValue(value: number | null | undefined, meta: ColumnMeta): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "";
  switch (meta.type) {
    case "date":
      return toDateInputValue(value);
    case "datetime":
      return toDateTimeInputValue(value);
    case "time":
      return toTimeInputValue(value);
    case "duration":
      return formatDurationMs(value);
    default:
      return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }
}

function describeHeaderFilter(filter: ColumnFilter, meta: ColumnMeta): string {
  if (filter.kind === "range") {
    const min = formatHeaderValue(filter.min, meta);
    const max = formatHeaderValue(filter.max, meta);
    return `${min || "…"} – ${max || "…"}`;
  }
  if (filter.kind === "compare") {
    const label = {
      eq: "=",
      ne: "≠",
      gt: ">",
      gte: "≥",
      lt: "<",
      lte: "≤",
      aboveAvg: "above avg",
      belowAvg: "below avg",
    }[filter.op];
    const value = formatHeaderValue(filter.value, meta);
    return value === "" ? label : `${label} ${value}`;
  }
  if (filter.kind === "blank") return filter.negate ? "not blank" : "blank";
  if (filter.kind === "values") return `${filter.selected.length} values`;
  return "filtered";
}

/** Reuse the full sidebar filter card in a floating panel anchored to a header. */
function openHeaderFilterPanel(
  anchor: HTMLElement,
  meta: ColumnMeta,
  current: ColumnFilter | null,
  onApply: (filter: ColumnFilter | null) => void,
  requestSuggestions?: (query: string) => Promise<{ label: string; count: number }[]>,
): void {
  const popover = el("div", {
    class: "th-filter-popover th-filter-panel-popover",
    role: "dialog",
    "aria-label": `Filter ${meta.name}`,
  });
  const host = el("div", { class: "th-filter-panel-host" });
  const filters = new Map<number, ColumnFilter>();
  if (current !== null) filters.set(0, current);
  const panel = new FilterPanel(
    host,
    [{ ...meta, suggestions: [] }],
    filters,
    {
      onFilter: (_index, filter) => {
        if (filter === null) filters.delete(0);
        else filters.set(0, filter);
        onApply(filter);
      },
      onSuggestion: () => {},
      ...(requestSuggestions === undefined ? {} : { requestSuggestions: (_index: number, query: string) => requestSuggestions(query) }),
    },
  );
  panel.focusColumn(0);
  popover.append(host);

  const close = (): void => {
    popover.remove();
    document.removeEventListener("pointerdown", onPointerDown, true);
    document.removeEventListener("keydown", onKey);
  };
  const onPointerDown = (event: PointerEvent): void => {
    const target = event.target as Node;
    if (!popover.contains(target) && !anchor.contains(target)) close();
  };
  const onKey = (event: KeyboardEvent): void => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    close();
    anchor.focus();
  };
  document.addEventListener("pointerdown", onPointerDown, true);
  document.addEventListener("keydown", onKey);
  document.body.append(popover);
  const rect = anchor.getBoundingClientRect();
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - popover.offsetWidth - 8));
  popover.style.left = `${left}px`;
  const below = rect.bottom + 6;
  popover.style.top =
    below + popover.offsetHeight > window.innerHeight - 8
      ? `${Math.max(8, rect.top - popover.offsetHeight - 6)}px`
      : `${below}px`;
}
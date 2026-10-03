import { clear, el } from "./dom.js";
import { isNullToken } from "../parse/null-tokens.js";

const ROW_HEIGHT = 28;
const DEFAULT_COL_WIDTH = 180;
const MIN_COL_WIDTH = 56;
const MAX_COL_WIDTH = 720;
const OVERSCAN = 10;
const CACHE_LIMIT = 4000;

export interface HighlightRule {
  column: number;
  query: string;
  mode: "contains" | "exact";
}

export interface ResultTableOptions {
  onSort: (column: number, dir: 1 | -1 | 0) => void;
  onRequestRows: (
    start: number,
    end: number,
    done: (start: number, rows: string[][], groups?: boolean[]) => void,
  ) => void;
}

export class ResultTable {
  private readonly scroller: HTMLDivElement;
  private readonly header: HTMLDivElement;
  private readonly spacer: HTMLDivElement;
  private readonly rowsHost: HTMLDivElement;
  private readonly onResize = (): void => this.render();

  private columns: string[] = [];
  private widths: number[] = [];
  private count = 0;
  private sortColumn = -1;
  private sortDir: 1 | -1 = 1;
  private highlights: HighlightRule[] = [];
  private nullHighlight = false;
  private readonly groupStarts = new Set<number>();
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
  }

  setColumns(columns: string[]): void {
    this.columns = columns;
    this.widths = columns.map(() => DEFAULT_COL_WIDTH);
    this.renderHeader();
    this.invalidateRows();
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

  /** Tints null/empty cells; used while the Null rows filter is active. */
  setNullHighlight(active: boolean): void {
    if (this.nullHighlight === active) return;
    this.nullHighlight = active;
    this.lastStart = -1;
    this.lastEnd = -1;
    this.render();
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

  invalidateRows(): void {
    this.cache.clear();
    this.pendingStart = -1;
    this.pendingEnd = -1;
    this.lastStart = -1;
    this.lastEnd = -1;
    this.render();
  }

  /** Seeds the cache with the eagerly shipped first page and repaints. */
  setFirstRows(rows: string[][], groups?: boolean[]): void {
    this.cache.clear();
    this.groupStarts.clear();
    for (let i = 0; i < rows.length; i++) {
      this.cache.set(i, rows[i]);
      if (groups?.[i] === true) this.groupStarts.add(i);
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
    return this.widths.map((width) => `${width}px`).join(" ");
  }

  private totalWidth(): number {
    return this.widths.reduce((total, width) => total + width, 0);
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

    this.columns.forEach((name, index) => {
      const cell = el("div", { class: "th" });
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

      cell.append(label, grip);
      this.header.append(cell);
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
      this.options.onRequestRows(start, end, (rowsStart, rows, groups) => {
        if (this.pendingStart === start && this.pendingEnd === end) {
          this.pendingStart = -1;
          this.pendingEnd = -1;
        }
        for (let i = 0; i < rows.length; i++) {
          const position = rowsStart + i;
          this.cache.set(position, rows[i]);
          this.groupStarts.delete(position);
          if (groups?.[i] === true) this.groupStarts.add(position);
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
    for (let c = 0; c < this.columns.length; c++) {
      const cell = el("div", { class: "td" });
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
      }
    }
  }

  private fillCell(cell: HTMLElement, value: string, columnIndex: number): void {
    if (this.nullHighlight && isNullToken(value)) {
      cell.classList.add("null-cell");
      cell.textContent = value;
      return;
    }

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
}

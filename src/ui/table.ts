import { clear, el } from "./dom.js";

const ROW_HEIGHT = 28;
const COL_WIDTH = 180;
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
    done: (start: number, rows: string[][]) => void,
  ) => void;
}

export class ResultTable {
  private readonly scroller: HTMLDivElement;
  private readonly header: HTMLDivElement;
  private readonly spacer: HTMLDivElement;
  private readonly rowsHost: HTMLDivElement;
  private readonly onResize = (): void => this.render();

  private columns: string[] = [];
  private count = 0;
  private sortColumn = -1;
  private sortDir: 1 | -1 = 1;
  private highlights: HighlightRule[] = [];
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
    this.renderHeader();
    this.invalidateRows();
  }

  setCount(count: number): void {
    this.count = count;
    this.spacer.style.height = `${count * ROW_HEIGHT}px`;
    this.spacer.style.width = `${this.columns.length * COL_WIDTH}px`;
    this.render();
  }

  setSort(column: number, dir: 1 | -1): void {
    this.sortColumn = column;
    this.sortDir = dir;
    this.renderHeader();
  }

  setHighlights(highlights: HighlightRule[]): void {
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

  private toggleSort(column: number): void {
    let dir: 1 | -1 | 0;
    if (this.sortColumn !== column) dir = 1;
    else if (this.sortDir === 1) dir = -1;
    else dir = 0;
    this.options.onSort(column, dir);
  }

  private renderHeader(): void {
    clear(this.header);
    const count = this.columns.length;
    this.header.style.gridTemplateColumns = `repeat(${count}, ${COL_WIDTH}px)`;
    this.header.style.width = `${count * COL_WIDTH}px`;

    this.columns.forEach((name, index) => {
      const cell = el("button", { class: "th", type: "button", title: `Sort by ${name}` }, [name]);
      if (index === this.sortColumn) {
        cell.classList.add(this.sortDir === 1 ? "sort-asc" : "sort-desc");
      }
      cell.addEventListener("click", () => this.toggleSort(index));
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
      fragment.append(this.buildRow(row));
    }
    this.rowsHost.append(fragment);

    if (missing && (this.pendingStart !== start || this.pendingEnd !== end)) {
      this.pendingStart = start;
      this.pendingEnd = end;
      this.options.onRequestRows(start, end, (rowsStart, rows) => {
        if (this.pendingStart === start && this.pendingEnd === end) {
          this.pendingStart = -1;
          this.pendingEnd = -1;
        }
        for (let i = 0; i < rows.length; i++) this.cache.set(rowsStart + i, rows[i]);
        this.pruneCache(start);
        this.lastStart = -1;
        this.lastEnd = -1;
        this.render();
      });
    }
  }

  private buildRow(row: string[] | undefined): HTMLElement {
    const tr = el("div", { class: "tr" });
    tr.style.gridTemplateColumns = `repeat(${this.columns.length}, ${COL_WIDTH}px)`;
    if (row === undefined) tr.classList.add("skeleton");
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

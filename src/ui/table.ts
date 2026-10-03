import { clear, el } from "./dom.js";
import type { Dataset } from "../data/dataset.js";

const ROW_HEIGHT = 28;
const COL_WIDTH = 180;
const OVERSCAN = 10;

export interface HighlightRule {
  column: number;
  query: string;
  mode: "contains" | "exact";
}

export class ResultTable {
  private readonly scroller: HTMLDivElement;
  private readonly header: HTMLDivElement;
  private readonly spacer: HTMLDivElement;
  private readonly rowsHost: HTMLDivElement;
  private dataset: Dataset | null = null;
  private sortedIds: Uint32Array = new Uint32Array(0);
  private sortColumn = -1;
  private sortDir: 1 | -1 = 1;
  private highlights: HighlightRule[] = [];
  private lastStart = -1;
  private lastEnd = -1;

  private readonly onResize = (): void => this.render();

  constructor(root: HTMLElement) {
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
    this.dataset = null;
  }

  setData(dataset: Dataset, ids: Uint32Array, highlights: HighlightRule[] = []): void {
    this.dataset = dataset;
    this.sortedIds = ids;
    this.highlights = highlights;
    this.applySort();
    this.renderHeader();
    this.spacer.style.height = `${this.sortedIds.length * ROW_HEIGHT}px`;
    this.spacer.style.width = `${dataset.columnCount * COL_WIDTH}px`;
    this.lastStart = -1;
    this.lastEnd = -1;
    this.render();
  }

  private toggleSort(column: number): void {
    if (this.sortColumn === column) {
      this.sortDir = this.sortDir === 1 ? -1 : 1;
    } else {
      this.sortColumn = column;
      this.sortDir = 1;
    }
    this.applySort();
    this.renderHeader();
    this.lastStart = -1;
    this.lastEnd = -1;
    this.render();
  }

  private applySort(): void {
    if (this.dataset === null || this.sortColumn < 0) return;
    const column = this.dataset.columns[this.sortColumn];
    const dir = this.sortDir;
    const numeric =
      column.type === "integer" || column.type === "number" || column.type === "date";

    if (numeric) {
      const numbers = column.numbers();
      this.sortedIds.sort((a, b) => {
        const va = numbers[a];
        const vb = numbers[b];
        const na = Number.isNaN(va);
        const nb = Number.isNaN(vb);
        if (na && nb) return 0;
        if (na) return 1;
        if (nb) return -1;
        return (va - vb) * dir;
      });
    } else {
      const values = column.raw;
      this.sortedIds.sort((a, b) => {
        const va = values[a];
        const vb = values[b];
        const cmp = va < vb ? -1 : va > vb ? 1 : 0;
        return cmp * dir;
      });
    }
  }

  private renderHeader(): void {
    if (this.dataset === null) return;
    clear(this.header);
    const columnCount = this.dataset.columnCount;
    this.header.style.gridTemplateColumns = `repeat(${columnCount}, ${COL_WIDTH}px)`;
    this.header.style.width = `${columnCount * COL_WIDTH}px`;

    this.dataset.columns.forEach((column, index) => {
      const cell = el("button", { class: "th", type: "button", title: `Sort by ${column.name}` }, [
        column.name,
      ]);
      if (index === this.sortColumn) {
        cell.classList.add(this.sortDir === 1 ? "sort-asc" : "sort-desc");
      }
      cell.addEventListener("click", () => this.toggleSort(index));
      this.header.append(cell);
    });
  }

  private render(): void {
    if (this.dataset === null) return;
    const height = this.scroller.clientHeight || 600;
    const start = Math.max(0, Math.floor(this.scroller.scrollTop / ROW_HEIGHT) - OVERSCAN);
    const end = Math.min(
      this.sortedIds.length,
      start + Math.ceil(height / ROW_HEIGHT) + OVERSCAN * 2,
    );
    if (start === this.lastStart && end === this.lastEnd) return;
    this.lastStart = start;
    this.lastEnd = end;

    clear(this.rowsHost);

    if (this.sortedIds.length === 0) {
      this.rowsHost.style.transform = "translateY(0px)";
      this.rowsHost.append(el("div", { class: "empty" }, ["No matching rows"]));
      return;
    }

    this.rowsHost.style.transform = `translateY(${start * ROW_HEIGHT}px)`;
    const fragment = document.createDocumentFragment();
    const columnCount = this.dataset.columnCount;

    for (let i = start; i < end; i++) {
      const rowIndex = this.sortedIds[i];
      const row = el("div", { class: "tr" });
      row.style.gridTemplateColumns = `repeat(${columnCount}, ${COL_WIDTH}px)`;
      for (let c = 0; c < columnCount; c++) {
        const cell = el("div", { class: "td" });
        this.fillCell(cell, this.dataset.columns[c].raw[rowIndex] ?? "", c);
        row.append(cell);
      }
      fragment.append(row);
    }
    this.rowsHost.append(fragment);
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

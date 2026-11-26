/**
 * Peek: a look at the data, on the Chart page between the chart tabs and the charts, so the rows
 * can be checked before a chart is made and while it is worked on. It shows the table's first 100
 * rows as the table has them (filtered, in its order), or the Pivot View the open chart draws. It
 * stays short and scrolls inside itself, and folds down to one line. Open or folded is remembered
 * apart for making a chart (open at first: look before choosing) and for looking at one (folded at
 * first: the chart gets the room).
 */
import type { ChartCard } from "./chart-card.js";
import { fieldsInUse } from "./chart-card-data.js";
import { formatChartNumber, isNumericType } from "./chart-utils.js";
import { el, svgIcon } from "./dom.js";
import type { AggregateMessage, ColumnMeta, PivotMessage, RowsMessage } from "../worker/protocol.js";
import type { ChartSource } from "./chart-card-types.js";

/** The table peek shows this many rows. */
export const PEEK_ROWS = 100;
/** A view peek stops here; the view itself has the rest. */
const VIEW_ROWS = 500;
const VIEW_COLUMNS = 60;
const OPEN_KEY = "turbofuzz.charts.peekOpen";

/** An eye: look at the data. */
function eyeIcon(): SVGElement {
  return svgIcon('<path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>', "chart-peek-icon");
}

export type PeekContext = "drafting" | "chart";

function readOpen(context: PeekContext): boolean {
  try {
    const saved = localStorage.getItem(`${OPEN_KEY}.${context}`);
    return saved === null ? context === "drafting" : saved === "1";
  } catch {
    return context === "drafting";
  }
}

function writeOpen(context: PeekContext, open: boolean): void {
  try {
    localStorage.setItem(`${OPEN_KEY}.${context}`, open ? "1" : "0");
  } catch {
    // Not remembered: it starts as it does at first next time.
  }
}

export interface PeekOptions {
  requestRows?(start: number, end: number): Promise<RowsMessage>;
  requestViewPivot?(source: string): Promise<PivotMessage | null>;
  requestViewAggregate?(source: string): Promise<AggregateMessage | null>;
  columns(): ColumnMeta[];
  rowCount(): number;
  sources(): ChartSource[];
  /** The chart on screen, or null while one is being made. */
  activeCard(): ChartCard | null;
  /** Making a chart (the Add panel, or no charts yet) or looking at one. */
  context(): PeekContext;
  /** Opened or folded: what is under it moves, and a chart sizes itself to the room. */
  onToggle?(): void;
  onShowTable?(): void;
  onOpenSource?(source: string): void;
}

export class ChartPeek {
  /** The rows, under the tab row; hidden while folded. */
  readonly root: HTMLElement;
  /** The eye in the tab row, between the chart tabs and Add chart. */
  readonly toggle: HTMLButtonElement;
  private readonly summary: HTMLElement;
  private readonly action: HTMLButtonElement;
  private readonly body: HTMLElement;
  private context: PeekContext;
  private open: boolean;
  /** What the body shows now; the same again is not fetched again. */
  private key = "";
  private ticket = 0;
  private actionRun: () => void = () => undefined;

  constructor(private readonly options: PeekOptions) {
    this.summary = el("span", { class: "charts-peek-summary" });
    this.toggle = el(
      "button",
      { class: "small charts-peek-toggle", type: "button", title: "Peek at the data: the table's first rows, or the Pivot View the open chart draws", "aria-controls": "charts-peek" },
      [eyeIcon(), el("span", { class: "charts-peek-label" }, ["Peek"]), el("span", { class: "charts-peek-chevron", "aria-hidden": "true" })],
    ) as HTMLButtonElement;
    this.toggle.addEventListener("click", () => {
      this.setOpen(!this.open, true);
      this.options.onToggle?.();
      if (this.open) this.reveal();
    });
    this.action = el("button", { class: "link small charts-peek-open", type: "button" }) as HTMLButtonElement;
    this.action.addEventListener("click", () => this.actionRun());
    this.body = el("div", { class: "charts-peek-body" });
    const close = el("button", { class: "icon-btn charts-peek-close", type: "button", title: "Fold the peek away", "aria-label": "Fold the peek away" }, ["×"]) as HTMLButtonElement;
    close.addEventListener("click", () => {
      this.setOpen(false, true);
      this.options.onToggle?.();
      this.toggle.focus();
    });
    this.root = el("section", { class: "charts-peek", id: "charts-peek", "aria-label": "Peek at the data" }, [
      el("div", { class: "charts-peek-head" }, [this.summary, el("span", { class: "grow" }), this.action, close]),
      this.body,
    ]);
    this.context = options.context();
    this.open = readOpen(this.context);
    this.setOpen(this.open, false);
  }

  /**
   * Brings the opened peek into view. It opens above the chart, and the page is often scrolled a
   * little past that point, which leaves the peek behind the pinned bars, so Peek seemed to do nothing.
   */
  private reveal(): void {
    requestAnimationFrame(() => {
      const scroller = this.root.closest<HTMLElement>(".workspace-body");
      const bar = this.toggle.closest<HTMLElement>(".charts-toolbar");
      if (scroller === null || bar === null || this.root.hidden) return;
      const gap = this.root.getBoundingClientRect().top - bar.getBoundingClientRect().bottom - 6;
      if (gap < 0) scroller.scrollTop = Math.max(0, scroller.scrollTop + gap);
    });
  }

  private setOpen(open: boolean, remember: boolean): void {
    this.open = open;
    if (remember) writeOpen(this.context, open);
    this.toggle.classList.toggle("open", open);
    this.toggle.setAttribute("aria-expanded", String(open));
    this.root.hidden = !open;
    this.key = "";
    this.refresh();
  }

  /** New table results, another chart on screen, or new columns: show what is there now. */
  refresh(force = false): void {
    if (force) this.key = "";
    const context = this.options.context();
    if (context !== this.context) {
      this.context = context;
      const open = readOpen(context);
      if (open !== this.open) return this.setOpen(open, false);
    }
    const card = this.options.activeCard();
    const source = card?.config.source ?? "";
    const view = source === "" ? undefined : this.options.sources().find((entry) => entry.id === source);
    if (view === undefined) this.showTable(card);
    else this.showView(view);
  }

  private showTable(card: ChartCard | null): void {
    const total = this.options.rowCount();
    const shown = Math.min(PEEK_ROWS, total);
    this.summary.textContent = `Table · first ${shown.toLocaleString()} of ${total.toLocaleString()} ${total === 1 ? "row" : "rows"}`;
    this.setAction(this.options.onShowTable === undefined ? null : "Open Table", () => this.options.onShowTable?.());
    if (!this.open) return;
    if (this.options.columns().length === 0) {
      this.key = "";
      return this.fill(wait("Load data to peek at it."));
    }
    const used = card === null ? new Set<number>() : usedColumns(card);
    const key = `table|${total}|${[...used].join(",")}|${this.options.columns().length}`;
    if (key === this.key) return;
    this.key = key;
    const request = this.options.requestRows;
    if (request === undefined) return this.fill(wait("The rows are not available here."));
    const ticket = ++this.ticket;
    void request(0, PEEK_ROWS).then(
      (message) => {
        if (ticket === this.ticket) this.fill(tableRows(this.options.columns(), message.rows, used));
      },
      () => {
        if (ticket === this.ticket) this.fill(wait("Could not load the rows."));
      },
    );
  }

  private showView(view: ChartSource): void {
    const pivot = view.kind === "pivot";
    this.summary.textContent = `${pivot ? "Pivot View" : "View"} · ${view.name}`;
    this.setAction(this.options.onOpenSource === undefined ? null : pivot ? "Open Pivot View" : "Open View", () => this.options.onOpenSource?.(view.id));
    if (!this.open) return;
    // A view follows the table's filters: fetch again whenever the table moves.
    const key = `view|${view.id}|${this.options.rowCount()}`;
    if (key === this.key) return;
    this.key = key;
    const ticket = ++this.ticket;
    const fail = (): void => {
      if (ticket === this.ticket) this.fill(wait("Could not load the view."));
    };
    if (pivot && this.options.requestViewPivot !== undefined) {
      void this.options.requestViewPivot(view.id).then((message) => {
        if (ticket === this.ticket) this.fill(message === null ? wait("This view is gone.") : pivotTable(message));
      }, fail);
    } else if (this.options.requestViewAggregate !== undefined) {
      void this.options.requestViewAggregate(view.id).then((message) => {
        if (ticket === this.ticket) this.fill(message === null ? wait("This view is gone.") : aggregateTable(message));
      }, fail);
    } else {
      fail();
    }
  }

  private setAction(label: string | null, run: () => void): void {
    this.action.classList.toggle("hidden", label === null);
    this.action.textContent = label ?? "";
    this.actionRun = run;
  }

  private fill(content: HTMLElement): void {
    // Keep the reader's place when the same data comes back with new values.
    const left = this.body.scrollLeft;
    this.body.replaceChildren(content);
    this.body.scrollLeft = left;
  }
}

function wait(text: string): HTMLElement {
  return el("div", { class: "charts-peek-wait" }, [text]);
}

/** The columns a chart draws, marked in the peek. */
function usedColumns(card: ChartCard): Set<number> {
  const { measures, dimensions } = fieldsInUse(card);
  const facet = card.config.facetColumn ?? -1;
  return new Set([...measures, ...dimensions, ...(facet >= 0 ? [facet] : [])]);
}

/** `numeric(index)`: the column holds numbers, so it lines up on the right. */
function grid(head: (string | HTMLElement)[], rows: (string | HTMLElement)[][], numeric: (index: number) => boolean, used: ReadonlySet<number> = new Set()): HTMLElement {
  const table = el("table", { class: "chart-peek-table" });
  const classes = head.map((_, index) => [used.has(index) ? "used" : "", numeric(index) ? "num" : ""].filter((name) => name !== "").join(" "));
  const headRow = el("tr");
  head.forEach((name, index) => headRow.append(el("th", { class: classes[index]!, ...(used.has(index) ? { title: "Used by this chart" } : {}) }, [name])));
  table.append(el("thead", {}, [headRow]));
  const tbody = el("tbody");
  for (const row of rows) {
    const tr = el("tr");
    row.forEach((cell, index) => tr.append(el("td", { class: classes[index]! }, [cell])));
    tbody.append(tr);
  }
  table.append(tbody);
  return table;
}

/** The table's first rows, every column, the chart's own columns marked. */
function tableRows(columns: ColumnMeta[], rows: string[][], used: ReadonlySet<number>): HTMLElement {
  if (rows.length === 0) return wait("No rows match the table's filters.");
  return grid(
    columns.map((meta) => meta.name),
    rows.map((row) => row.map((cell) => (cell === "" ? el("span", { class: "chart-peek-empty" }, ["empty"]) : cell))),
    (index) => {
      const meta = columns[index];
      return meta !== undefined && isNumericType(meta.type);
    },
    used,
  );
}

const number = (value: number | undefined): string => (value === undefined || !Number.isFinite(value) ? "" : formatChartNumber(value));

/** A pivot as the Pivot View lays it out: row labels down the side, one column per column label, each measure. */
function pivotTable(pivot: PivotMessage): HTMLElement {
  const cols = Math.min(pivot.colLabels.length, VIEW_COLUMNS);
  const rows = Math.min(pivot.rowLabels.length, VIEW_ROWS);
  const head: string[] = [...pivot.rowNames];
  const multi = pivot.measures.length > 1;
  const colNames = pivot.colLabels.length === 0 ? [""] : pivot.colLabels.slice(0, cols).map((parts) => parts.join(" · "));
  for (const measure of pivot.measures) for (const name of colNames) head.push(name === "" ? measure.name : multi ? `${name} · ${measure.name}` : name);
  const width = Math.max(1, pivot.colLabels.length);
  const body: string[][] = [];
  for (let r = 0; r < rows; r++) {
    const row = [...(pivot.rowLabels[r] ?? [])];
    for (const measure of pivot.measures) for (let c = 0; c < colNames.length; c++) row.push(number(measure.values[r * width + c]));
    body.push(row);
  }
  return withNote(grid(head, body, (index) => index >= pivot.rowNames.length), pivot.rowLabels.length > rows || pivot.colLabels.length > cols ? `First ${rows.toLocaleString()} rows and ${cols.toLocaleString()} columns of ${pivot.rowLabels.length.toLocaleString()} × ${pivot.colLabels.length.toLocaleString()}` : "");
}

/** A grouped view: its group columns, then its measures. */
function aggregateTable(result: AggregateMessage): HTMLElement {
  const rows = Math.min(result.groupCount, VIEW_ROWS);
  const head = [...result.dimensionNames, ...result.measureNames];
  const body: string[][] = [];
  for (let i = 0; i < rows; i++) body.push([...result.dimensions.map((values) => values[i] ?? ""), ...result.measures.map((values) => number(values[i]))]);
  return withNote(grid(head, body, (index) => index >= result.dimensionNames.length), result.groupCount > rows ? `First ${rows.toLocaleString()} of ${result.groupCount.toLocaleString()} groups` : "");
}

function withNote(content: HTMLElement, note: string): HTMLElement {
  return note === "" ? content : el("div", {}, [content, el("div", { class: "charts-peek-note" }, [note])]);
}

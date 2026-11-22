/**
 * Peek: a quick look at the data a chart is drawn from, without leaving the Chart page. For a
 * chart of the table it shows the table's first rows as the table has them (filtered and in its
 * order); for a chart of a Pivot View it shows that pivot, scrollable. It is a popover: Escape,
 * a click elsewhere or the button again puts it away.
 */
import type { ChartCard } from "./chart-card.js";
import { fieldsInUse } from "./chart-card-data.js";
import { formatChartNumber, isNumericType } from "./chart-utils.js";
import { el, svgIcon } from "./dom.js";
import type { AggregateMessage, PivotMessage } from "../worker/protocol.js";

/** The table peek shows this many rows. */
export const PEEK_ROWS = 10;
/** A view peek stops here; the view itself has the rest. */
const VIEW_ROWS = 500;
const VIEW_COLUMNS = 60;

/** A small grid with an eye-like lens: look at the rows under the chart. */
function peekIcon(): SVGElement {
  return svgIcon(
    '<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M3 9.5h18M9 9.5V20"/>',
    "chart-peek-icon",
  );
}

let open: { close: () => void } | null = null;

/** The Peek button for a card's header. */
export function buildPeekButton(card: ChartCard): HTMLButtonElement {
  const button = el(
    "button",
    {
      class: "ghost small chart-peek-btn",
      type: "button",
      "aria-haspopup": "dialog",
      "aria-expanded": "false",
      title: "Peek at the data this chart is drawn from: the table's first rows, or the Pivot View it charts",
    },
    [],
  ) as HTMLButtonElement;
  button.append(peekIcon(), el("span", {}, ["Peek"]));
  button.addEventListener("click", () => {
    const mine = button.getAttribute("aria-expanded") === "true";
    open?.close();
    if (!mine) openPeek(card, button);
  });
  return button;
}

function openPeek(card: ChartCard, anchor: HTMLButtonElement): void {
  const body = el("div", { class: "chart-peek-body" }, [el("div", { class: "chart-peek-wait" }, ["Loading…"])]);
  const title = el("span", { class: "chart-peek-title" });
  const action = el("button", { class: "link small chart-peek-open", type: "button" }) as HTMLButtonElement;
  const closeButton = el("button", { class: "icon-btn chart-peek-close", type: "button", title: "Close", "aria-label": "Close the peek" }, ["×"]) as HTMLButtonElement;
  const pop = el("div", { class: "chart-peek", role: "dialog", "aria-label": "Peek at the chart's data" }, [
    el("div", { class: "chart-peek-head" }, [title, el("span", { class: "grow" }), action, closeButton]),
    body,
  ]);
  document.body.append(pop);
  place(pop, anchor);
  anchor.setAttribute("aria-expanded", "true");

  const onKey = (event: KeyboardEvent): void => {
    if (event.key !== "Escape") return;
    event.stopPropagation();
    close();
    anchor.focus();
  };
  const onDown = (event: PointerEvent): void => {
    const target = event.target as Node | null;
    if (target !== null && (pop.contains(target) || anchor.contains(target))) return;
    close();
  };
  const onResize = (): void => place(pop, anchor);
  const close = (): void => {
    pop.remove();
    anchor.setAttribute("aria-expanded", "false");
    document.removeEventListener("keydown", onKey, true);
    document.removeEventListener("pointerdown", onDown, true);
    window.removeEventListener("resize", onResize);
    if (open === handle) open = null;
  };
  const handle = { close };
  open = handle;
  document.addEventListener("keydown", onKey, true);
  document.addEventListener("pointerdown", onDown, true);
  window.addEventListener("resize", onResize);
  closeButton.addEventListener("click", close);

  const source = card.config.source;
  const fill = (content: HTMLElement): void => {
    if (open !== handle) return;
    body.replaceChildren(content);
    place(pop, anchor);
  };
  const fail = (): void => fill(el("div", { class: "chart-peek-wait" }, ["Could not load the data."]));
  if (source === "") {
    const shown = Math.min(PEEK_ROWS, card.rowCount);
    title.textContent = `Table · first ${shown.toLocaleString()} of ${card.rowCount.toLocaleString()} ${card.rowCount === 1 ? "row" : "rows"}`;
    action.textContent = "Open Table";
    action.classList.toggle("hidden", card.options.onShowTable === undefined);
    action.addEventListener("click", () => {
      close();
      card.options.onShowTable?.();
    });
    const request = card.options.requestRows;
    if (request === undefined) return fail();
    void request(0, PEEK_ROWS).then((message) => fill(tableRows(card, message.rows)), fail);
    return;
  }
  const view = card.sources.find((entry) => entry.id === source);
  title.textContent = view === undefined ? "View" : `${view.kind === "pivot" ? "Pivot View" : "View"} · ${view.name}`;
  action.textContent = view?.kind === "pivot" ? "Open Pivot View" : "Open View";
  action.classList.toggle("hidden", card.options.onOpenSource === undefined);
  action.addEventListener("click", () => {
    close();
    card.options.onOpenSource?.(source);
  });
  if (view?.kind === "pivot" && card.options.requestViewPivot !== undefined) {
    void card.options.requestViewPivot(source).then((message) => (message === null ? fail() : fill(pivotTable(message))), fail);
  } else if (card.options.requestViewAggregate !== undefined) {
    void card.options.requestViewAggregate(source).then((message) => (message === null ? fail() : fill(aggregateTable(message))), fail);
  } else {
    fail();
  }
}

/** Under the button, kept inside the window. */
function place(pop: HTMLElement, anchor: HTMLElement): void {
  const box = anchor.getBoundingClientRect();
  const width = Math.min(pop.offsetWidth || 720, window.innerWidth - 32);
  const left = Math.max(16, Math.min(box.right - width, window.innerWidth - width - 16));
  pop.style.left = `${left}px`;
  pop.style.top = `${Math.round(box.bottom + 6)}px`;
  pop.style.maxHeight = `${Math.max(200, window.innerHeight - box.bottom - 24)}px`;
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
  return el("div", { class: "chart-peek-scroll" }, [table]);
}

/** The table's first rows, every column, the chart's own columns marked. */
function tableRows(card: ChartCard, rows: string[][]): HTMLElement {
  if (rows.length === 0) return el("div", { class: "chart-peek-wait" }, ["No rows match the table's filters."]);
  const { measures, dimensions } = fieldsInUse(card);
  const used = new Set([...measures, ...dimensions, ...(card.config.facetColumn ?? -1) >= 0 ? [card.config.facetColumn ?? -1] : []]);
  return grid(card.columns.map((meta) => meta.name), rows.map((row) => row.map((cell) => (cell === "" ? el("span", { class: "chart-peek-empty" }, ["empty"]) : cell))), (index) => {
    const meta = card.columns[index];
    return meta !== undefined && isNumericType(meta.type);
  }, used);
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
  return note === "" ? content : el("div", {}, [content, el("div", { class: "chart-peek-note" }, [note])]);
}

import { extractTsv } from "../data/chart-extract.js";
import { readGroupOpen, writeGroupOpen } from "./chart-card-parts.js";
import { el } from "./dom.js";

/** The drawer shows this much of the chart's data; the download has all of it. */
const DRAWER_ROWS = 200;
const DRAWER_COLUMNS = 24;

/**
 * "Data behind this chart": the numbers the chart is drawing, in a drawer under the chart, so a
 * value can be checked without leaving for the Table. Closed until opened, then as it was left; its
 * table is only built while it is open. The first row of `rows()` is the header.
 */
export class ChartDataDrawer {
  readonly root: HTMLDetailsElement;
  private key = "";
  private timer = 0;
  private disposed = false;

  /** `showTable` gives the action that opens the Table on the rows the chart uses, or undefined when there is none. */
  constructor(
    private readonly rows: () => string[][],
    private readonly showTable: () => (() => void) | undefined = () => undefined,
  ) {
    const count = el("span", { class: "chart-data-count" });
    const copy = el(
      "button",
      { class: "ghost small chart-data-copy", type: "button", title: "Copy these rows, tab-separated, to paste into a spreadsheet" },
      ["Copy"],
    ) as HTMLButtonElement;
    const table = el(
      "button",
      { class: "link small chart-data-show-table hidden", type: "button", title: "Open the Table on the rows this chart uses; the table's filters apply here too" },
      ["Show rows in Table"],
    ) as HTMLButtonElement;
    table.addEventListener("click", () => this.showTable()?.());
    const body = el("div", { class: "chart-data-body" });
    this.root = el("details", { class: "chart-data-drawer" }, [
      el("summary", { class: "chart-data-title" }, [el("span", { class: "chart-data-name" }, ["Data behind this chart"]), count]),
      el("div", { class: "chart-data-bar" }, [el("span", { class: "chart-data-note" }), table, copy]),
      body,
    ]) as HTMLDetailsElement;
    this.root.open = readGroupOpen("data");
    this.root.addEventListener("toggle", () => {
      writeGroupOpen("data", this.root.open);
      this.key = "";
      this.sync();
    });
    copy.addEventListener("click", () => {
      const text = extractTsv(this.rows());
      void navigator.clipboard?.writeText(text).then(
        () => (copy.textContent = "Copied"),
        () => (copy.textContent = "Copy failed"),
      );
      window.setTimeout(() => (copy.textContent = "Copy"), 1500);
    });
  }

  /** Brings the open state in step with the one remembered, when the chart's tab is shown again. */
  restoreOpen(): void {
    this.root.open = readGroupOpen("data");
  }

  /** After the chart settles: a repaint on every hover must not rebuild a table. */
  schedule(): void {
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.sync(), 120);
  }

  dispose(): void {
    this.disposed = true;
    window.clearTimeout(this.timer);
  }

  private sync(): void {
    const drawer = this.root;
    if (this.disposed) return;
    const rows = this.rows();
    const total = Math.max(0, rows.length - 1);
    const key = `${drawer.open}|${rows.length}|${rows[0]?.join("\t") ?? ""}|${rows[1]?.join("\t") ?? ""}|${rows[rows.length - 1]?.join("\t") ?? ""}`;
    if (key === this.key) return;
    this.key = key;
    drawer.classList.toggle("hidden", total === 0);
    drawer.querySelector(".chart-data-show-table")?.classList.toggle("hidden", this.showTable() === undefined);
    const count = drawer.querySelector(".chart-data-count");
    if (count !== null) count.textContent = `${total.toLocaleString()} ${total === 1 ? "row" : "rows"}`;
    const body = drawer.querySelector(".chart-data-body");
    const note = drawer.querySelector(".chart-data-note");
    if (body === null || note === null) return;
    if (!drawer.open) {
      body.replaceChildren();
      return;
    }
    const header = (rows[0] ?? []).slice(0, DRAWER_COLUMNS);
    // A number reads with separators here; the first column is the label and stays as it is.
    const show = (cell: string, column: number): string => {
      if (column === 0 || cell === "") return cell;
      const value = Number(cell);
      return Number.isFinite(value) ? value.toLocaleString(undefined, { maximumFractionDigits: 4 }) : cell;
    };
    const numeric = header.map(
      (_, column) => column > 0 && rows.slice(1, 40).every((row) => row[column] === "" || row[column] === undefined || Number.isFinite(Number(row[column]))),
    );
    const table = el("table", { class: "chart-data-table" }, [
      el("thead", {}, [el("tr", {}, header.map((name, column) => el("th", { class: numeric[column] ? "num" : "", scope: "col" }, [name])))]),
      el(
        "tbody",
        {},
        rows.slice(1, DRAWER_ROWS + 1).map((row) =>
          el("tr", {}, header.map((_, column) => el("td", { class: numeric[column] ? "num" : "" }, [numeric[column] ? show(row[column] ?? "", column) : (row[column] ?? "")]))),
        ),
      ),
    ]);
    body.replaceChildren(table);
    const cut: string[] = [];
    if (total > DRAWER_ROWS) cut.push(`the first ${DRAWER_ROWS} of ${total.toLocaleString()} rows`);
    if ((rows[0]?.length ?? 0) > DRAWER_COLUMNS) cut.push(`the first ${DRAWER_COLUMNS} of ${rows[0]?.length} columns`);
    note.textContent = cut.length === 0 ? "These are the numbers the chart draws." : `Showing ${cut.join(" and ")}. Download data (CSV) in the ⋯ menu has them all.`;
  }
}

import { extractRows, extractTsv, type ChartExtract, type ExtractSection } from "../data/chart-extract.js";
import { formatFormulaSafe } from "../data/formula-safe.js";
import { downloadCsv } from "./chart-export.js";
import { setupDialog } from "./dialog.js";
import { el } from "./dom.js";

/** A long table shows its start here; Copy and Download always carry all of it. */
const PREVIEW_ROWS = 200;

const isNumber = (cell: string): boolean => /^-?\d*\.?\d+(e[-+]?\d+)?$/i.test(cell);

const shown = (cell: string): string =>
  isNumber(cell) ? Number(cell).toLocaleString(undefined, { maximumSignificantDigits: 7 }) : cell;

async function copy(text: string, button: HTMLButtonElement, label: string): Promise<void> {
  let copied = false;
  try {
    await navigator.clipboard.writeText(text);
    copied = true;
  } catch {
    // The label below says so.
  }
  button.textContent = copied ? "Copied" : "Clipboard blocked";
  window.setTimeout(() => {
    button.textContent = label;
  }, 1400);
}

function sectionTable(section: ExtractSection): HTMLElement {
  const table = el("table", { class: "chart-stats-table" });
  const head = el("tr");
  const first = section.rows[1] ?? [];
  (section.rows[0] ?? []).forEach((cell, index) => {
    head.append(el("th", isNumber(first[index] ?? "") ? { class: "num" } : {}, [cell]));
  });
  table.append(el("thead", {}, [head]));
  const body = el("tbody");
  for (const row of section.rows.slice(1, PREVIEW_ROWS + 1)) {
    const tr = el("tr");
    for (const cell of row) {
      tr.append(el("td", isNumber(cell) ? { class: "num", title: cell } : {}, [shown(cell)]));
    }
    body.append(tr);
  }
  table.append(body);
  return el("div", { class: "chart-stats-scroll" }, [table]);
}

/** The window behind Extract stats. */
export function openChartStats(extract: ChartExtract, fileName: string): void {
  const overlay = el("div", { class: "modal-overlay" });
  const modal = el("div", { class: "modal chart-stats-modal" });
  const close = (): void => {
    overlay.remove();
    document.removeEventListener("keydown", onKey);
  };
  const onKey = (event: KeyboardEvent): void => {
    if (event.key !== "Escape") return;
    event.stopPropagation();
    close();
  };
  const closeButton = el("button", { class: "icon-btn", type: "button", title: "Close (Esc)" }, ["×"]);
  closeButton.addEventListener("click", close);
  modal.append(el("div", { class: "modal-head" }, [el("h2", {}, ["Chart stats"]), closeButton]));

  const body = el("div", { class: "chart-stats-body" });
  body.append(el("p", { class: "chart-stats-title" }, [extract.title]));
  const facts = el("dl", { class: "chart-stats-facts" });
  for (const [label, value] of extract.facts) facts.append(el("dt", {}, [label]), el("dd", {}, [value]));
  body.append(facts);
  for (const section of extract.sections) {
    const count = section.rows.length - 1;
    const copyTable = el("button", { class: "ghost small", type: "button" }, ["Copy table"]) as HTMLButtonElement;
    copyTable.addEventListener("click", () => void copy(extractTsv(section.rows), copyTable, "Copy table"));
    body.append(
      el("section", { class: "chart-stats-section" }, [
        el("div", { class: "chart-stats-section-head" }, [
          el("h3", {}, [section.title]),
          el("span", { class: "chart-stats-count" }, [
            count > PREVIEW_ROWS
              ? `first ${PREVIEW_ROWS.toLocaleString()} of ${count.toLocaleString()} rows; Copy and Download have them all`
              : `${count.toLocaleString()} ${count === 1 ? "row" : "rows"}`,
          ]),
          el("span", { class: "grow" }),
          copyTable,
        ]),
        sectionTable(section),
      ]),
    );
  }
  modal.append(body);

  const rows = extractRows(extract);
  const copyAll = el("button", { class: "ghost", type: "button", title: "Copy everything here, to paste into a spreadsheet" }, ["Copy all"]) as HTMLButtonElement;
  copyAll.addEventListener("click", () => void copy(extractTsv(rows), copyAll, "Copy all"));
  const download = el("button", { class: "primary", type: "button", title: "Download everything here as one CSV" }, ["Download CSV"]) as HTMLButtonElement;
  download.addEventListener("click", () => {
    downloadCsv(fileName, rows.map((row) => row.map(formatFormulaSafe)));
  });
  modal.append(el("div", { class: "clean-footer" }, [copyAll, el("span", { class: "grow" }), download]));

  overlay.append(modal);
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) close();
  });
  document.addEventListener("keydown", onKey);
  document.body.append(overlay);
  setupDialog(overlay, "Chart stats");
  closeButton.focus();
}

import { el } from "./dom.js";
import { setupDialog } from "./dialog.js";
import { detectDelimiter } from "../parse/delimiter.js";
import { decodeText } from "../parse/encoding.js";
import { parseDelimited } from "../parse/parse.js";

/** Estimated cells above which a browser load is likely to exhaust memory. */
export const LARGE_LOAD_CELLS = 8_000_000;
/** Rows offered as the safe alternative when a file is flagged as large. */
export const SAMPLE_ROWS = 100_000;
/** How much of the file is read to estimate its shape. */
const SAMPLE_BYTES = 256 * 1024;

export interface LoadEstimate {
  /** Estimated total data rows (header rows included; approximate). */
  rows: number;
  columns: number;
  /** rows × columns, the memory-pressure proxy. */
  cells: number;
}

/**
 * Estimates the whole file's row/column count from a text prefix. The prefix
 * must be decoded text (already cut at a row boundary by the caller helpers);
 * the estimate is deliberately labelled approximate in the UI.
 */
export function estimateFromText(totalBytes: number, text: string): LoadEstimate | null {
  if (totalBytes <= 0 || text.trim() === "") return null;
  const cut = text.includes("\n") ? text.slice(0, text.lastIndexOf("\n")) : text;
  if (cut.trim() === "") return null;
  const delimiter = detectDelimiter(cut);
  const parsed = parseDelimited(cut, { delimiter, hasHeaders: false, normalizeRows: false });
  const rows = parsed.rows;
  if (rows.length < 2) return null;
  let columns = 0;
  let bytes = 0;
  for (const row of rows) {
    if (row.length > columns) columns = row.length;
    // Cells + separators + newline ≈ the row's on-disk footprint.
    bytes += row.reduce((sum, cell) => sum + cell.length, 0) + Math.max(0, row.length - 1) + 1;
  }
  if (columns <= 0 || bytes <= 0) return null;
  const bytesPerRow = bytes / rows.length;
  const estimatedRows = Math.max(1, Math.round(totalBytes / bytesPerRow));
  return { rows: estimatedRows, columns, cells: estimatedRows * columns };
}

/** Estimates from a file buffer's first 256 KB (never touches binary formats). */
export function estimateFromBuffer(totalBytes: number, buffer: ArrayBuffer): LoadEstimate | null {
  const prefix = buffer.slice(0, Math.min(SAMPLE_BYTES, buffer.byteLength));
  return estimateFromText(totalBytes, decodeText(prefix).text);
}

export type LargeLoadChoice = "sample" | "all" | null;

/**
 * Three-way dialog for files estimated to be too large: load a sample, load
 * everything anyway, or cancel. Resolves null when dismissed.
 */
export function openLargeLoadDialog(
  estimate: LoadEstimate,
  fileName: string,
): Promise<LargeLoadChoice> {
  return new Promise((resolve) => {
    const overlay = el("div", { class: "modal-overlay" });
    const modal = el("div", { class: "modal confirm-modal" });

    const head = el("div", { class: "modal-head" });
    head.append(el("h2", {}, ["This file looks very large"]));
    const closeButton = el("button", { class: "icon-btn", type: "button", title: "Close" }, ["×"]);
    head.append(closeButton);
    modal.append(head);

    modal.append(
      el("p", { class: "confirm-body" }, [
        `“${fileName}” is roughly ${estimate.rows.toLocaleString()} rows × ${estimate.columns.toLocaleString()} columns (≈${estimate.cells.toLocaleString()} cells). Browsers usually run out of memory on files this size, which can hang or crash this tab.`,
      ]),
      el("p", { class: "confirm-body" }, [
        `Loading the first ${SAMPLE_ROWS.toLocaleString()} rows gives you a workable sample of the structure and values; you can still load the full file at your own risk.`,
      ]),
    );

    const footer = el("div", { class: "clean-footer" });
    const cancel = el("button", { class: "ghost", type: "button" }, ["Cancel"]);
    const all = el("button", { class: "ghost", type: "button" }, ["Load everything anyway"]);
    const sample = el("button", { class: "primary", type: "button" }, [
      `Load first ${SAMPLE_ROWS.toLocaleString()} rows`,
    ]);
    footer.append(cancel, el("span", { class: "grow" }), all, sample);
    modal.append(footer);

    let settled = false;
    const finish = (value: LargeLoadChoice): void => {
      if (settled) return;
      settled = true;
      overlay.remove();
      document.removeEventListener("keydown", onKey);
      resolve(value);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") finish(null);
    };
    closeButton.addEventListener("click", () => finish(null));
    cancel.addEventListener("click", () => finish(null));
    all.addEventListener("click", () => finish("all"));
    sample.addEventListener("click", () => finish("sample"));
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) finish(null);
    });
    document.addEventListener("keydown", onKey);

    overlay.append(modal);
    document.body.append(overlay);
    setupDialog(overlay, "Large file");
  });
}

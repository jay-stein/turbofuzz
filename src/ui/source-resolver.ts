import Papa from "papaparse";
import { listArchiveEntries, readArchiveEntry, type ArchiveEntry } from "../parse/archive.js";
import { decompressBzip2 } from "../parse/bz2.js";
import { combineSheets, type SheetGrid } from "../parse/combine-sheets.js";
import { listWorkbookSheets, readWorkbookSheet } from "../parse/xlsx.js";
import { listLegacySheets, readLegacySheet } from "../parse/xls.js";
import { el } from "./dom.js";
import { setupDialog } from "./dialog.js";
import { renderSheetPicker } from "./sheet-picker.js";

/** A file reduced to plain delimited text, with a name to show for it. */
export interface ResolvedSource {
  name: string;
  buffer: ArrayBuffer;
}

/** What compare and append can be given: plain tables, workbooks and archives that hold them. */
export const SOURCE_FILE_TYPES = ".csv,.tsv,.psv,.txt,.json,.ndjson,.jsonl,.parquet,.xlsx,.xls,.zip,.gz,.bz2";
const PLAIN = /\.(csv|tsv|psv|txt|tab|json|ndjson|jsonl|parquet)$/i;
const WORKBOOK = /\.(xlsx|xls)$/i;
const ARCHIVE = /\.(zip|gz|bz2)$/i;
const MAX_SHEETS = 100;
const MAX_LAYERS = 4;

/** Why a file cannot be used here, or null when it can (or can be opened to find a table). */
export function unreadableReason(name: string): string | null {
  if (PLAIN.test(name) || WORKBOOK.test(name) || ARCHIVE.test(name)) return null;
  return `${name} is not a CSV, TSV, JSON, Parquet, Excel or zipped file.`;
}

const bufferOf = (bytes: Uint8Array): ArrayBuffer =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

const baseName = (name: string): string => name.replace(/\.[^.]+$/, "");

/**
 * A modal that shows `fill`'s content and settles with whatever it passes to
 * `done`, or null when closed.
 */
function ask<T>(title: string, fill: (host: HTMLElement, done: (value: T) => void) => void): Promise<T | null> {
  return new Promise((resolve) => {
    const overlay = el("div", { class: "modal-overlay" });
    const modal = el("div", { class: "modal confirm-modal" });
    const close = el("button", { class: "icon-btn", type: "button", title: "Close" }, ["×"]);
    modal.append(el("div", { class: "modal-head" }, [el("h2", {}, [title]), close]));
    const host = el("div", { class: "table-picker-list" });
    modal.append(host);
    let settled = false;
    const finish = (value: T | null): void => {
      if (settled) return;
      settled = true;
      overlay.remove();
      document.removeEventListener("keydown", onKey);
      resolve(value);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") finish(null);
    };
    close.addEventListener("click", () => finish(null));
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) finish(null);
    });
    document.addEventListener("keydown", onKey);
    overlay.append(modal);
    document.body.append(overlay);
    fill(host, finish);
    setupDialog(overlay, title);
  });
}

const csvOf = (rows: string[][]): ArrayBuffer => new TextEncoder().encode(Papa.unparse(rows)).buffer as ArrayBuffer;

async function fromWorkbook(name: string, buffer: ArrayBuffer): Promise<ResolvedSource | null> {
  const legacy = /\.xls$/i.test(name) ? await listLegacySheets(buffer, MAX_SHEETS) : null;
  const listing = legacy ?? (await listWorkbookSheets(buffer, MAX_SHEETS));
  const read = (sheet: string): Promise<string[][]> => (legacy === null ? readWorkbookSheet(buffer, sheet) : readLegacySheet(legacy.workbook, sheet));
  if (listing.sheets.length === 0) throw new Error(`${name} has no worksheets.`);
  const base = baseName(name);
  const choice =
    listing.sheets.length === 1
      ? { sheets: [listing.sheets[0]!.name], sheetColumn: false }
      : await ask<{ sheets: string[]; sheetColumn: boolean }>(`Which worksheets from “${name}”?`, (host, done) =>
          renderSheetPicker(host, listing.sheets, true, {
            loadOne: (sheet) => done({ sheets: [sheet], sheetColumn: false }),
            combine: (sheets, sheetColumn) => done({ sheets, sheetColumn }),
          }),
        );
  if (choice === null) return null;
  const grids: SheetGrid[] = [];
  for (const sheet of choice.sheets) {
    const grid = await read(sheet);
    if (grid.length > 0) grids.push({ name: sheet, grid });
  }
  if (grids.length === 0) throw new Error("That worksheet has no data.");
  if (grids.length === 1) return { name: `${base} — ${grids[0]!.name}.csv`, buffer: csvOf(grids[0]!.grid) };
  const combined = combineSheets(grids, { hasHeaders: true, sheetColumn: choice.sheetColumn });
  if (!combined.ok) throw new Error(`These worksheets can't be combined: ${combined.reason}`);
  return { name: `${base} — ${grids.length} sheets.csv`, buffer: csvOf(combined.table) };
}

async function fromZip(name: string, buffer: ArrayBuffer, layer: number): Promise<ResolvedSource | null> {
  const entries = await listArchiveEntries(buffer);
  if (entries.length === 0) throw new Error(`No tables found in ${name}.`);
  const entry =
    entries.length === 1
      ? entries[0]!
      : await ask<ArchiveEntry>(`Which file in “${name}”?`, (host, done) => {
          for (const candidate of entries) {
            const button = el("button", { class: "table-option", type: "button" }, [
              el("span", { class: "table-option-name" }, [candidate.path]),
            ]);
            button.addEventListener("click", () => done(candidate));
            host.append(button);
          }
        });
  if (entry === null) return null;
  return resolveBuffer(entry.name, bufferOf(await readArchiveEntry(buffer, entry.path)), layer + 1);
}

async function resolveBuffer(name: string, buffer: ArrayBuffer, layer: number): Promise<ResolvedSource | null> {
  if (layer > MAX_LAYERS) throw new Error(`${name} is packed too deeply.`);
  if (PLAIN.test(name)) return { name, buffer };
  if (WORKBOOK.test(name)) return fromWorkbook(name, buffer);
  if (/\.zip$/i.test(name)) return fromZip(name, buffer, layer);
  if (/\.gz$/i.test(name)) {
    const { gunzipSync } = await import("fflate");
    return resolveBuffer(name.replace(/\.gz$/i, ""), bufferOf(gunzipSync(new Uint8Array(buffer))), layer + 1);
  }
  if (/\.bz2$/i.test(name)) return resolveBuffer(name.replace(/\.bz2$/i, ""), bufferOf(await decompressBzip2(buffer)), layer + 1);
  throw new Error(unreadableReason(name) ?? `Could not read ${name}.`);
}

/**
 * Reduces a chosen file to a table compare or append can read: workbooks ask
 * which worksheets (one, or several with the same columns stacked), archives
 * ask which file when there are several, compressed files are unpacked.
 * Resolves null when the person closes the question.
 */
export function resolveSource(file: { name: string; arrayBuffer(): Promise<ArrayBuffer> }): Promise<ResolvedSource | null> {
  return file.arrayBuffer().then((buffer) => resolveBuffer(file.name, buffer, 0));
}

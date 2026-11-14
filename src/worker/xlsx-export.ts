import type { ColumnData } from "../data/column.js";
import type { Dataset } from "../data/dataset.js";
import { maskValue } from "../data/mask-value.js";
import { XLSX_ROWS_PER_SHEET } from "../ui/export-formats.js";
import { columnLetters, sheetName } from "../ui/xlsx-writer.js";
import { unparsedCell } from "./csv.js";
import type { ExportOptions } from "./protocol.js";

/** Excel refuses a longer cell; longer text is cut and counted. */
const CELL_LIMIT = 32_767;
/** Rows read to size the columns; the rest are not looked at. */
const WIDTH_SAMPLE_ROWS = 200;
const MAX_WIDTH = 60;
const MIN_WIDTH = 8;
const DAY_MS = 86_400_000;
/** Days from 1899-12-30 (Excel's day 0) to 1970-01-01. */
const EPOCH_SERIAL = 25_569;
/** Rows rendered to text per deflate push, so a sheet never exists as one giant string. */
const ROWS_PER_PUSH = 4000;

const TRUE_WORDS = new Set(["true", "yes", "y", "t", "1"]);
const FALSE_WORDS = new Set(["false", "no", "n", "f", "0"]);
/** Digits Excel would drop: a leading zero ("0800"), or more than 15 digits. */
const FRAGILE_DIGITS = /^[+-]?0\d|^[+-]?\d{16,}/;

export const XLSX_DATE_FORMAT = "yyyy-mm-dd";
export const XLSX_DATETIME_FORMAT = "yyyy-mm-dd hh:mm:ss";
export const XLSX_TIME_FORMAT = "hh:mm";
export const XLSX_DURATION_FORMAT = "[h]:mm:ss";

type Cell = string | number | boolean | { v: number; z: string } | null;

export interface XlsxResult {
  bytes: Uint8Array;
  /** Data rows written (header excluded). */
  rows: number;
  sheets: number;
  /** Cells whose text was cut to Excel's 32,767-character limit. */
  truncated: number;
}

/** Excel's serial day for a UTC epoch in ms; null before 1900-03-01, where Excel's calendar disagrees. */
function serial(epochMs: number): number | null {
  const days = epochMs / DAY_MS + EPOCH_SERIAL;
  return days >= 61 ? days : null;
}

function textCell(value: string, mask: boolean): Cell {
  if (value === "") return null;
  return mask ? maskValue(value) : value;
}

/**
 * One typed cell. Numbers, dates, times and booleans keep their type; anything
 * that did not parse as its column's type keeps its text (as the CSV export
 * does), and identifier-like text is never turned into a number. Text cells are
 * strings, never formulas, so `=`, `+`, `-` and `@` need no escaping.
 */
function typedCell(column: ColumnData, row: number, nullAsBlank: boolean, mask: boolean): Cell {
  switch (column.type) {
    case "integer":
    case "number": {
      const value = column.numbers()[row];
      if (!Number.isFinite(value)) return textCell(unparsedCell(column, row, nullAsBlank), mask);
      if (mask) return textCell(String(value), mask);
      const raw = column.raw[row] ?? "";
      if (FRAGILE_DIGITS.test(raw.trim()) || (column.type === "integer" && !Number.isSafeInteger(value))) return textCell(raw, mask);
      return value;
    }
    case "date":
    case "datetime":
    case "time":
    case "duration": {
      const value = column.numbers()[row];
      if (!Number.isFinite(value)) return textCell(unparsedCell(column, row, nullAsBlank), mask);
      if (mask) return textCell(column.raw[row] ?? "", mask);
      if (column.type === "time" || column.type === "duration") {
        return { v: value / DAY_MS, z: column.type === "time" ? XLSX_TIME_FORMAT : XLSX_DURATION_FORMAT };
      }
      const days = serial(value);
      if (days === null) return textCell(column.raw[row] ?? "", mask);
      return { v: days, z: column.type === "date" ? XLSX_DATE_FORMAT : XLSX_DATETIME_FORMAT };
    }
    default: {
      const raw = column.raw[row] ?? "";
      if (nullAsBlank && column.isNull(raw)) return null;
      if (column.type === "boolean" && !mask) {
        const word = raw.trim().toLowerCase();
        if (TRUE_WORDS.has(word)) return true;
        if (FALSE_WORDS.has(word)) return false;
      }
      return textCell(raw, mask);
    }
  }
}

function width(cell: Cell): number {
  if (cell === null) return 0;
  if (typeof cell === "object") return cell.z === XLSX_DATETIME_FORMAT ? 19 : cell.z === XLSX_DATE_FORMAT ? 10 : 8;
  return String(cell).length;
}

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const NEEDS_ESCAPE = /[&<>"\u0000-\u0008\u000b\u000c\u000e-\u001f\ud800-\udfff￾￿]/;

/** Characters XML 1.0 cannot hold are dropped; the special ones are escaped. Plain text takes the fast path. */
function xml(text: string): string {
  if (!NEEDS_ESCAPE.test(text)) return text;
  return text
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, "")
    .replace(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** cellXfs index for each number format; 0 is General, 1 the bold header. */
const STYLE_OF: Record<string, number> = {
  [XLSX_DATE_FORMAT]: 2,
  [XLSX_DATETIME_FORMAT]: 3,
  [XLSX_TIME_FORMAT]: 4,
  [XLSX_DURATION_FORMAT]: 5,
};

/** One cell; `ref` is empty for a cell that directly follows the previous one, which keeps the XML (and the deflate work) smaller. */
function cellXml(ref: string, cell: Cell, style = 0): string {
  if (cell === null) return "";
  const r = ref === "" ? "" : ` r="${ref}"`;
  if (typeof cell === "string") {
    const s = style === 0 ? "" : ` s="${style}"`;
    const space = /^\s|\s$|\n/.test(cell) ? ' xml:space="preserve"' : "";
    return `<c${r} t="inlineStr"${s}><is><t${space}>${xml(cell)}</t></is></c>`;
  }
  if (typeof cell === "number") return `<c${r}><v>${cell}</v></c>`;
  if (typeof cell === "boolean") return `<c${r} t="b"><v>${cell ? 1 : 0}</v></c>`;
  return `<c${r} s="${STYLE_OF[cell.z]}"><v>${cell.v}</v></c>`;
}

const STYLES =
  XML_HEAD +
  '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
  `<numFmts count="4"><numFmt numFmtId="164" formatCode="${XLSX_DATE_FORMAT}"/><numFmt numFmtId="165" formatCode="${XLSX_DATETIME_FORMAT}"/><numFmt numFmtId="166" formatCode="${XLSX_TIME_FORMAT}"/><numFmt numFmtId="167" formatCode="${XLSX_DURATION_FORMAT}"/></numFmts>` +
  '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
  '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="6"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
  '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="167" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs>' +
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';

/** Data-file and archive suffixes a dataset name may carry; a sheet is named after the data, not the file. */
const FILE_SUFFIX = /\.(csv|tsv|psv|txt|dat|json|jsonl|ndjson|xlsx|xls|parquet|gz|bz2|zip)$/i;

/** The dataset name without file extensions (`orders.csv.gz` becomes `orders`). */
export function sheetTitle(name: string): string {
  let title = name.trim();
  while (FILE_SUFFIX.test(title)) title = title.replace(FILE_SUFFIX, "");
  return title;
}

const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

/**
 * Builds a typed .xlsx workbook for rows `start..end` of `ids`: one sheet per
 * 1,048,575 data rows, each with a bold, frozen header row, an autofilter on it
 * and column widths from the first rows. The sheet XML is written directly and
 * deflated as it is produced (fflate): SheetJS's writer took 10-30 s for
 * 100,000 x 30 cells. Text is stored as text cells, never as formulas.
 */
export async function buildXlsxWorkbook(
  dataset: Dataset,
  ids: Uint32Array,
  start: number,
  end: number,
  title: string,
  options: ExportOptions = {},
): Promise<XlsxResult> {
  const nullAsBlank = options.nullAsBlank ?? true;
  const handling = new Map<number, "mask" | "exclude">();
  for (const entry of options.columnHandling ?? []) handling.set(entry.column, entry.mode);
  const kept: number[] = [];
  for (let c = 0; c < dataset.columns.length; c++) if (handling.get(c) !== "exclude") kept.push(c);
  const columns = kept.map((c) => dataset.columns[c]);
  const masked = kept.map((c) => handling.get(c) === "mask");
  const letters = columns.map((_, k) => columnLetters(k));
  const lastLetter = letters[letters.length - 1] ?? "A";

  const { Zip, ZipDeflate, strToU8 } = await import("fflate");
  const chunks: Uint8Array[] = [];
  let failure: Error | null = null;
  const zip = new Zip((error, data) => {
    if (error !== null) failure = error;
    else chunks.push(data);
  });
  const addText = (name: string, text: string): void => {
    const file = new ZipDeflate(name, { level: 1 });
    zip.add(file);
    file.push(strToU8(text), true);
  };

  const taken = new Set<string>();
  const total = Math.max(0, end - start);
  const sheetCount = Math.max(1, Math.ceil(total / XLSX_ROWS_PER_SHEET));
  const names = Array.from({ length: sheetCount }, () => sheetName(sheetTitle(title), taken));

  addText(
    "[Content_Types].xml",
    XML_HEAD +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      names.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("") +
      "</Types>",
  );
  addText(
    "_rels/.rels",
    XML_HEAD +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
  );
  addText(
    "xl/workbook.xml",
    XML_HEAD +
      `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${REL}"><sheets>` +
      names.map((name, i) => `<sheet name="${xml(name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("") +
      "</sheets></workbook>",
  );
  addText(
    "xl/_rels/workbook.xml.rels",
    XML_HEAD +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      names.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${REL}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("") +
      `<Relationship Id="rId${sheetCount + 1}" Type="${REL}/styles" Target="styles.xml"/></Relationships>`,
  );
  addText("xl/styles.xml", STYLES);

  let truncated = 0;
  const render = (i: number): Cell[] => {
    const row = ids[i];
    const cells: Cell[] = new Array(columns.length);
    for (let k = 0; k < columns.length; k++) {
      let cell = typedCell(columns[k], row, nullAsBlank, masked[k]);
      if (typeof cell === "string" && cell.length > CELL_LIMIT) {
        cell = cell.slice(0, CELL_LIMIT);
        truncated++;
      }
      cells[k] = cell;
    }
    return cells;
  };

  for (let s = 0; s < sheetCount; s++) {
    const from = start + s * XLSX_ROWS_PER_SHEET;
    const to = Math.min(end, from + XLSX_ROWS_PER_SHEET);
    // Widths come from the first rows only; those rows are rendered once and reused.
    const sample = Math.min(to - from, WIDTH_SAMPLE_ROWS);
    const longest = columns.map((column) => column.name.length);
    const first: Cell[][] = [];
    for (let i = from; i < from + sample; i++) {
      const cells = render(i);
      first.push(cells);
      for (let k = 0; k < cells.length; k++) longest[k] = Math.max(longest[k], width(cells[k]));
    }
    const lastRow = Math.max(0, to - from) + 1;
    const file = new ZipDeflate(`xl/worksheets/sheet${s + 1}.xml`, { level: 1 });
    zip.add(file);
    const widths = longest
      .map((chars, k) => `<col min="${k + 1}" max="${k + 1}" width="${Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, chars + 2))}" customWidth="1"/>`)
      .join("");
    const headerCells = columns.map((column, k) => cellXml(`${letters[k]}1`, column.name, 1)).join("");
    file.push(
      strToU8(
        XML_HEAD +
          '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
          `<dimension ref="A1:${lastLetter}${lastRow}"/>` +
          '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft"/></sheetView></sheetViews>' +
          (widths === "" ? "" : `<cols>${widths}</cols>`) +
          `<sheetData><row r="1">${headerCells}</row>`,
      ),
      false,
    );
    let batch: string[] = [];
    for (let i = from; i < to; i++) {
      const cells = i - from < sample ? first[i - from] : render(i);
      const r = i - from + 2;
      let line = `<row r="${r}">`;
      let gap = true;
      for (let k = 0; k < cells.length; k++) {
        const cell = cells[k];
        if (cell === null) gap = true;
        else {
          line += cellXml(gap ? `${letters[k]}${r}` : "", cell);
          gap = false;
        }
      }
      batch.push(`${line}</row>`);
      if (batch.length >= ROWS_PER_PUSH) {
        file.push(strToU8(batch.join("")), false);
        batch = [];
      }
    }
    const tail = `</sheetData>${columns.length > 0 ? `<autoFilter ref="A1:${lastLetter}${lastRow}"/>` : ""}</worksheet>`;
    file.push(strToU8(batch.join("") + tail), true);
  }
  zip.end();
  if (failure !== null) throw failure;
  let size = 0;
  for (const chunk of chunks) size += chunk.length;
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return { bytes, rows: total, sheets: sheetCount, truncated };
}

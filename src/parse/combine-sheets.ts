import { detectTable } from "./header-detect.js";

export interface SheetGrid {
  name: string;
  grid: string[][];
}

export interface CombineOptions {
  /** Find each sheet's header row (as a single-sheet load does); off: every row is data. */
  hasHeaders: boolean;
  /** Add a column naming each row's worksheet. */
  sheetColumn: boolean;
}

export type CombineResult =
  | { ok: true; table: string[][]; hasHeaders: boolean; rows: number; sheetColumn: string | null }
  | { ok: false; reason: string };

/** The column added for each row's sheet name. */
export const SHEET_COLUMN = "excel_worksheetname";

/** “a”, “a” and “b”, “a”, “b” and “c”, or “a”, “b”, “c” and 2 more. */
function quoteList(names: readonly string[]): string {
  const quoted = names.slice(0, 3).map((name) => `“${name}”`);
  if (names.length > 3) return `${quoted.join(", ")} and ${names.length - 3} more`;
  return quoted.length <= 1 ? quoted.join("") : `${quoted.slice(0, -1).join(", ")} and ${quoted.at(-1)}`;
}

/**
 * Stacks a workbook's worksheets into one table when they have the same
 * columns: the same header names, in any order (rows are lined up by name to
 * the first sheet's order), or without headers the same number of columns.
 * Optionally adds `excel_worksheetname` (or `excel_worksheetname_2` when a
 * sheet already has that column) saying which sheet each row came from.
 * Refuses, with the reason, when a sheet's columns differ.
 */
export function combineSheets(sheets: readonly SheetGrid[], options: CombineOptions): CombineResult {
  if (sheets.length === 0) return { ok: false, reason: "The workbook has no worksheets with data." };

  if (!options.hasHeaders) {
    const width = Math.max(...sheets[0]!.grid.map((row) => row.length), 0);
    for (const sheet of sheets.slice(1)) {
      const other = Math.max(...sheet.grid.map((row) => row.length), 0);
      if (other !== width) {
        return { ok: false, reason: `“${sheet.name}” has ${other} columns and “${sheets[0]!.name}” has ${width}, so they can't be stacked.` };
      }
    }
    const table: string[][] = [];
    for (const sheet of sheets) {
      for (const row of sheet.grid) {
        const cells = Array.from({ length: width }, (_, c) => row[c] ?? "");
        table.push(options.sheetColumn ? [...cells, sheet.name] : cells);
      }
    }
    return { ok: true, table, hasHeaders: false, rows: table.length, sheetColumn: options.sheetColumn ? SHEET_COLUMN : null };
  }

  const detected = sheets.map((sheet) => ({ sheet, table: detectTable(sheet.grid) }));
  const headers = detected[0]!.table.headers.map((header) => header.trim());
  if (headers.length === 0) return { ok: false, reason: `No header row was found in “${sheets[0]!.name}”.` };
  const wanted = new Set(headers);
  // Each later sheet: the position of each of the first sheet's columns.
  const orders: number[][] = [];
  for (const { sheet, table } of detected) {
    const own = table.headers.map((header) => header.trim());
    const missing = headers.filter((name) => !own.includes(name));
    const extra = own.filter((name) => !wanted.has(name));
    if (missing.length > 0 || extra.length > 0) {
      const parts = [missing.length > 0 ? `is missing ${quoteList(missing)}` : "", extra.length > 0 ? `has ${quoteList(extra)}, which “${sheets[0]!.name}” does not` : ""].filter(Boolean);
      return { ok: false, reason: `“${sheet.name}” ${parts.join(", and ")}.` };
    }
    orders.push(headers.map((name) => own.indexOf(name)));
  }

  let sheetColumn: string | null = null;
  if (options.sheetColumn) {
    sheetColumn = SHEET_COLUMN;
    for (let n = 2; wanted.has(sheetColumn); n++) sheetColumn = `${SHEET_COLUMN}_${n}`;
  }
  const table: string[][] = [sheetColumn === null ? headers : [...headers, sheetColumn]];
  detected.forEach(({ sheet, table: own }, index) => {
    const order = orders[index]!;
    for (const row of own.rows) {
      const cells = order.map((at) => row[at] ?? "");
      table.push(sheetColumn === null ? cells : [...cells, sheet.name]);
    }
  });
  return { ok: true, table, hasHeaders: true, rows: table.length - 1, sheetColumn };
}

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

/** A column some sheets lack: those sheets' rows are left empty in it. */
export interface SheetGap {
  column: string;
  /** The sheets without this column. */
  missingIn: string[];
}

export type CombineResult =
  | { ok: true; table: string[][]; hasHeaders: boolean; rows: number; sheetColumn: string | null; gaps: SheetGap[] }
  | { ok: false; reason: string };

/** The column added for each row's sheet name. */
export const SHEET_COLUMN = "excel_worksheetname";

/** Header names match as files do when stacked: case and extra spaces don't matter. */
const headerKey = (value: string): string => value.trim().replace(/\s+/g, " ").toLowerCase();

/**
 * Stacks a workbook's worksheets into one table, as several files are stacked:
 * columns are lined up by header name (case and spacing aside), in the order
 * they are first met; a column only some sheets have is kept, and the other
 * sheets' rows are left empty in it (reported in `gaps`). Without headers,
 * columns line up by position and narrower sheets are padded. Optionally adds
 * `excel_worksheetname` (or `excel_worksheetname_2` when a sheet already has
 * that column) saying which sheet each row came from.
 */
export function combineSheets(sheets: readonly SheetGrid[], options: CombineOptions): CombineResult {
  if (sheets.length === 0) return { ok: false, reason: "The workbook has no worksheets with data." };

  if (!options.hasHeaders) {
    const width = Math.max(0, ...sheets.flatMap((sheet) => sheet.grid.map((row) => row.length)));
    const table: string[][] = [];
    for (const sheet of sheets) {
      for (const row of sheet.grid) {
        const cells = Array.from({ length: width }, (_, c) => row[c] ?? "");
        table.push(options.sheetColumn ? [...cells, sheet.name] : cells);
      }
    }
    return { ok: true, table, hasHeaders: false, rows: table.length, sheetColumn: options.sheetColumn ? SHEET_COLUMN : null, gaps: [] };
  }

  const detected = sheets.map((sheet) => ({ sheet, table: detectTable(sheet.grid) }));
  if (detected[0]!.table.headers.length === 0) return { ok: false, reason: `No header row was found in “${sheets[0]!.name}”.` };
  // Every column met, in the order met; the first spelling of a name is the one kept.
  const headers: string[] = [];
  const position = new Map<string, number>();
  for (const { table } of detected) {
    for (const header of table.headers) {
      const key = headerKey(header);
      if (position.has(key)) continue;
      position.set(key, headers.length);
      headers.push(header.trim());
    }
  }
  // Each sheet: for each output column, where it sits in that sheet (-1: not there, left empty).
  const orders: number[][] = detected.map(({ table }) => {
    const order = new Array<number>(headers.length).fill(-1);
    table.headers.forEach((header, at) => {
      const index = position.get(headerKey(header))!;
      if (order[index] === -1) order[index] = at;
    });
    return order;
  });
  const gaps: SheetGap[] = headers
    .map((column, index) => ({ column, missingIn: detected.filter((_, s) => orders[s]![index] === -1).map(({ sheet }) => sheet.name) }))
    .filter((gap) => gap.missingIn.length > 0);
  const wanted = new Set(headers);

  let sheetColumn: string | null = null;
  if (options.sheetColumn) {
    sheetColumn = SHEET_COLUMN;
    for (let n = 2; wanted.has(sheetColumn); n++) sheetColumn = `${SHEET_COLUMN}_${n}`;
  }
  const table: string[][] = [sheetColumn === null ? headers : [...headers, sheetColumn]];
  detected.forEach(({ sheet, table: own }, index) => {
    const order = orders[index]!;
    for (const row of own.rows) {
      const cells = order.map((at) => (at < 0 ? "" : (row[at] ?? "")));
      table.push(sheetColumn === null ? cells : [...cells, sheet.name]);
    }
  });
  return { ok: true, table, hasHeaders: true, rows: table.length - 1, sheetColumn, gaps };
}

import type { WorkBook } from "xlsx";
import type { WorkbookSheet } from "./xlsx.js";

export interface LegacyListing {
  sheets: WorkbookSheet[];
  total: number;
  workbook: WorkBook;
}

/**
 * Legacy BIFF .xls support via a lazily imported SheetJS chunk. The fast
 * fflate path handles .xlsx; this exists only for old binary files, so the
 * ~1MB parser is never part of the main bundle.
 *
 * Sheets are returned in workbook order (SheetJS `!ref` reflects cells with
 * values, so formatting-only ranges do not inflate the size).
 */
export async function listLegacySheets(
  buffer: ArrayBuffer,
  limit = 50,
): Promise<LegacyListing> {
  const XLSX = await import("xlsx");
  const workbook = XLSX.read(buffer, { type: "array" });
  const names = workbook.SheetNames;

  const sheets: WorkbookSheet[] = [];
  for (const name of names.slice(0, Math.max(1, limit))) {
    const sheet = workbook.Sheets[name];
    const ref: string | undefined = sheet === undefined ? undefined : sheet["!ref"];
    if (ref === undefined) continue;
    const range = XLSX.utils.decode_range(ref);
    const rows = range.e.r - range.s.r + 1;
    const columns = range.e.c - range.s.c + 1;
    if (rows <= 0 || columns <= 0) continue;
    sheets.push({ name, rows, columns });
  }

  return { sheets, total: names.length, workbook };
}

export async function readLegacySheet(workbook: WorkBook, sheetName: string): Promise<string[][]> {
  const XLSX = await import("xlsx");
  const sheet = workbook.Sheets[sheetName];
  if (sheet === undefined) return [];

  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: "",
    blankrows: false,
    raw: false,
  });

  return rows.map((row) =>
    Array.isArray(row)
      ? row.map((value) => (value === null || value === undefined ? "" : String(value)))
      : [],
  );
}

import type { WorkBook } from "xlsx";
import type { WorkbookSheet } from "./xlsx.js";

/**
 * Legacy BIFF .xls support via a lazily imported SheetJS chunk. The fast
 * fflate path handles .xlsx; this exists only for old binary files, so the
 * ~1MB parser is never part of the main bundle.
 */
export async function listLegacySheets(
  buffer: ArrayBuffer,
): Promise<{ sheets: WorkbookSheet[]; workbook: WorkBook }> {
  const XLSX = await import("xlsx");
  const workbook = XLSX.read(buffer, { type: "array" });

  const sheets = workbook.SheetNames.flatMap((name) => {
    const sheet = workbook.Sheets[name];
    const ref: string | undefined = sheet === undefined ? undefined : sheet["!ref"];
    if (ref === undefined) return [];
    const range = XLSX.utils.decode_range(ref);
    return [
      {
        name,
        rows: range.e.r - range.s.r + 1,
        columns: range.e.c - range.s.c + 1,
      },
    ];
  });

  sheets.sort((a, b) => b.rows * b.columns - a.rows * a.columns || b.rows - a.rows);
  return { sheets, workbook };
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

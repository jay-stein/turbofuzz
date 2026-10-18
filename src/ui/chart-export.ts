/**
 * Small, dependency-free CSV helpers for chart data exports. Table exports
 * stream through the worker; charts already hold their rendered payloads, so
 * they serialize client-side and keep the same Excel-friendly conventions.
 */

export function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function rowsToCsv(rows: readonly (readonly string[])[]): string {
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
}

/** Download a UTF-8 CSV with a BOM, matching the table export. */
export function downloadCsv(fileName: string, rows: readonly (readonly string[])[]): boolean {
  if (typeof URL.createObjectURL !== "function") return false;
  const blob = new Blob([`\uFEFF${rowsToCsv(rows)}`], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  return true;
}

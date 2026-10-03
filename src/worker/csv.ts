import type { Dataset } from "../data/dataset.js";

export function csvEscape(value: string): string {
  if (
    value.includes(",") ||
    value.includes('"') ||
    value.includes("\n") ||
    value.includes("\r")
  ) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Builds one chunk of a CSV export over the given (already ordered) row ids.
 * Always terminates lines with CRLF and includes a trailing CRLF so chunks
 * can be concatenated safely. Header is included only when start === 0.
 */
export function buildCsv(
  dataset: Dataset,
  ids: Uint32Array,
  start: number,
  end: number,
  includeHeader: boolean,
): string {
  const columns = dataset.columns;
  const lines: string[] = [];

  if (includeHeader) {
    const header: string[] = new Array(columns.length);
    for (let c = 0; c < columns.length; c++) header[c] = csvEscape(columns[c].name);
    lines.push(header.join(","));
  }

  for (let i = start; i < end; i++) {
    const row = ids[i];
    const cells: string[] = new Array(columns.length);
    for (let c = 0; c < columns.length; c++) cells[c] = csvEscape(columns[c].raw[row]);
    lines.push(cells.join(","));
  }

  if (lines.length === 0) return "";
  return `${lines.join("\r\n")}\r\n`;
}

import type { ColumnData } from "../data/column.js";
import type { Dataset } from "../data/dataset.js";
import { escapeFormula } from "../data/formula.js";
import { toDateInputValue } from "../parse/dates.js";
import type { ExportOptions } from "./protocol.js";

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
 * Export value for one cell. Typed columns emit their parsed value — numbers
 * lose currency/grouping symbols and dates become ISO — and unparseable cells
 * export as blank. Text columns keep their raw cell unless nullAsBlank is on.
 */
function exportCell(column: ColumnData, row: number, nullAsBlank: boolean): string {
  if (column.type === "integer" || column.type === "number") {
    const value = column.numbers()[row];
    return Number.isFinite(value) ? String(value) : "";
  }
  if (column.type === "date") {
    const value = column.numbers()[row];
    return Number.isFinite(value) ? toDateInputValue(value) : "";
  }
  const raw = column.raw[row];
  if (nullAsBlank && column.isNull(raw)) return "";
  return raw;
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
  options: ExportOptions = {},
): string {
  const columns = dataset.columns;
  const nullAsBlank = options.nullAsBlank ?? true;
  const escapeFormulas = options.escapeFormulas ?? false;
  const lines: string[] = [];

  if (includeHeader) {
    const header: string[] = new Array(columns.length);
    for (let c = 0; c < columns.length; c++) header[c] = csvEscape(columns[c].name);
    lines.push(header.join(","));
  }

  for (let i = start; i < end; i++) {
    const row = ids[i];
    const cells: string[] = new Array(columns.length);
    for (let c = 0; c < columns.length; c++) {
      const value = exportCell(columns[c], row, nullAsBlank);
      cells[c] = csvEscape(escapeFormulas ? escapeFormula(value) : value);
    }
    lines.push(cells.join(","));
  }

  if (lines.length === 0) return "";
  return `${lines.join("\r\n")}\r\n`;
}

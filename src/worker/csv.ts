import type { ColumnData } from "../data/column.js";
import type { Dataset } from "../data/dataset.js";
import { escapeFormula } from "../data/formula.js";
import {
  formatDurationMs,
  toDateInputValue,
  toDateTimeValue,
  toTimeInputValue,
} from "../parse/dates.js";
import { maskValue } from "../data/mask-value.js";
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
 * lose currency/grouping symbols, dates/timestamps become ISO, times `HH:MM`,
 * durations `H:MM:SS` — and unparseable cells export as blank. Text columns
 * keep their raw cell unless nullAsBlank is on.
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
  if (column.type === "datetime") {
    const value = column.numbers()[row];
    return Number.isFinite(value) ? toDateTimeValue(value) : "";
  }
  if (column.type === "time") {
    const value = column.numbers()[row];
    return Number.isFinite(value) ? toTimeInputValue(value) : "";
  }
  if (column.type === "duration") {
    const value = column.numbers()[row];
    return Number.isFinite(value) ? formatDurationMs(value) : "";
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
  const nullAsBlank = options.nullAsBlank ?? true;
  const escapeFormulas = options.escapeFormulas ?? false;
  const handling = new Map<number, "mask" | "exclude">();
  for (const entry of options.columnHandling ?? []) handling.set(entry.column, entry.mode);
  // Excluded columns are left out of the header and every row.
  const kept: number[] = [];
  for (let c = 0; c < dataset.columns.length; c++) {
    if (handling.get(c) !== "exclude") kept.push(c);
  }
  const columns = dataset.columns;
  const lines: string[] = [];

  if (includeHeader) {
    lines.push(kept.map((c) => csvEscape(columns[c].name)).join(","));
  }

  for (let i = start; i < end; i++) {
    const row = ids[i];
    const cells: string[] = new Array(kept.length);
    for (let k = 0; k < kept.length; k++) {
      const c = kept[k];
      let value = exportCell(columns[c], row, nullAsBlank);
      if (value !== "" && handling.get(c) === "mask") value = maskValue(value);
      cells[k] = csvEscape(escapeFormulas ? escapeFormula(value) : value);
    }
    lines.push(cells.join(","));
  }

  if (lines.length === 0) return "";
  return `${lines.join("\r\n")}\r\n`;
}

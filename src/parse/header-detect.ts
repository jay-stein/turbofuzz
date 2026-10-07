import { parseNumber } from "./numbers.js";

export interface DetectedTable {
  /** Rows above the header block (titles, notes, section labels). */
  skipRows: number;
  /** Number of header levels merged into `headers` (1-2 typically). */
  headerRows: number;
  /** Column labels merged across header levels; "" where none was found. */
  headers: string[];
  /** Data rows after the header block, trailing empty rows removed. */
  rows: string[][];
  /** First non-empty value from the skipped rows, if any. */
  title: string | null;
}

const MAX_SCAN_ROWS = 25;
const MAX_SCAN_COLUMNS = 300;
const DATA_LOOKAHEAD = 5;
const MIN_SCORE = 2.5;

interface RowProfile {
  populated: number;
  text: number;
  numeric: number;
}

function isNumericCell(cell: string): boolean {
  return cell !== "" && Number.isFinite(parseNumber(cell));
}

function profileOf(row: readonly string[]): RowProfile {
  let populated = 0;
  let text = 0;
  let numeric = 0;
  const limit = Math.min(row.length, MAX_SCAN_COLUMNS);
  for (let i = 0; i < limit; i++) {
    const cell = row[i] ?? "";
    if (cell === "") continue;
    populated++;
    if (isNumericCell(cell)) numeric++;
    else text++;
  }
  return { populated, text, numeric };
}

/**
 * Index just past the last non-empty cell. This is the column extent, which
 * differs from the populated-cell count when a column is blank in some cells:
 * a blank header above a populated data column must still count as a column.
 */
function populatedExtent(row: readonly string[]): number {
  const limit = Math.min(row.length, MAX_SCAN_COLUMNS);
  for (let i = limit - 1; i >= 0; i--) {
    if ((row[i] ?? "") !== "") return i + 1;
  }
  return 0;
}

/** Highest fraction of numeric cells in the next few populated rows. */
function numericDataBelow(grid: readonly string[][], index: number): number {
  let best = 0;
  for (let offset = 1; offset <= DATA_LOOKAHEAD; offset++) {
    const row = grid[index + offset];
    if (row === undefined) break;
    const profile = profileOf(row);
    if (profile.populated === 0) continue;
    best = Math.max(best, profile.numeric / profile.populated);
  }
  return best;
}

function mergeHeaders(grid: readonly string[][], start: number, count: number, columns: number): string[] {
  const headers: string[] = [];
  for (let column = 0; column < columns; column++) {
    const parts: string[] = [];
    for (let row = start; row < start + count; row++) {
      const value = (grid[row]?.[column] ?? "").trim();
      if (value === "") continue;
      if (parts.includes(value)) continue;
      parts.push(value);
    }
    headers.push(parts.join(" ").slice(0, 120));
  }
  return headers;
}

function trimTrailingEmptyRows(rows: string[][]): string[][] {
  const result = rows.map((row) => row.slice());
  while (result.length > 0 && result[result.length - 1].every((cell) => cell === "")) {
    result.pop();
  }
  return result;
}

function titleFrom(grid: readonly string[][], before: number, fallback: string | null): string | null {
  for (let row = 0; row < before; row++) {
    for (const cell of grid[row] ?? []) {
      const value = cell.trim();
      if (value !== "") return value.slice(0, 120);
    }
  }
  return fallback;
}

/**
 * Heuristic header detection for messy spreadsheets:
 *
 * 1. Score each of the first rows on text ratio, filled width relative to the
 *    sheet, whether numeric data follows, and a penalty for rows that are
 *    themselves numeric. The best-scoring row is the first header level.
 * 2. If numeric data follows, extend downward while rows stay text-only —
 *    capturing two-deep headers.
 * 3. Merge header levels column-wise, de-duplicating values repeated by
 *    merged cells ("Revenue" + "Passengers" -> "Revenue Passengers").
 *
 * Falls back to the first non-empty row as a single header when there is no
 * usable signal, matching the previous "first row is header" behaviour.
 */
export function detectTable(grid: readonly string[][]): DetectedTable {
  const scanRows = Math.min(grid.length, MAX_SCAN_ROWS);
  if (scanRows === 0) {
    return { skipRows: 0, headerRows: 0, headers: [], rows: [], title: null };
  }

  let width = 0;
  const profiles: RowProfile[] = [];
  for (let row = 0; row < scanRows; row++) {
    const profile = profileOf(grid[row] ?? []);
    profiles.push(profile);
    width = Math.max(width, populatedExtent(grid[row] ?? []));
  }

  let bestIndex = -1;
  let bestScore = 0;
  for (let row = 0; row < scanRows; row++) {
    const profile = profiles[row];
    if (profile.populated < 2) continue;
    const textRatio = profile.text / profile.populated;
    const widthRatio = width > 0 ? profile.populated / width : 0;
    const below = numericDataBelow(grid, row);
    const selfNumbers = profile.numeric / profile.populated;
    const score = textRatio * 2 + widthRatio * 2 + below * 3 - selfNumbers * 3;
    if (score > bestScore) {
      bestScore = score;
      bestIndex = row;
    }
  }

  if (bestIndex === -1 || bestScore < MIN_SCORE) {
    const firstNonEmpty = grid.findIndex((row) => row.some((cell) => cell !== ""));
    if (firstNonEmpty === -1) {
      return { skipRows: 0, headerRows: 0, headers: [], rows: [], title: null };
    }
    return {
      skipRows: firstNonEmpty,
      headerRows: 1,
      headers: mergeHeaders(grid, firstNonEmpty, 1, width),
      rows: trimTrailingEmptyRows(grid.slice(firstNonEmpty + 1)),
      title: titleFrom(grid, firstNonEmpty, null),
    };
  }

  let headerRows = 1;
  let headerStart = bestIndex;
  const dataFollows = numericDataBelow(grid, bestIndex) > 0.3;
  if (dataFollows) {
    // Extend upward into merged super-headers (at most two rows). Such rows
    // are text-only and wider than a title, e.g. "Sales" spanning two columns.
    while (headerStart > 0 && bestIndex - headerStart < 2) {
      const profile = profiles[headerStart - 1];
      if (profile === undefined || profile.populated < 2 || profile.numeric > 0) break;
      headerStart--;
    }
    // Extend downward while rows stay text-only and hold no numeric cells,
    // which keeps a data row like `1,Ann,…` out of the header block.
    while (bestIndex + headerRows < grid.length && headerRows < 3) {
      const profile = profiles[bestIndex + headerRows];
      if (profile === undefined || profile.populated === 0) break;
      if (profile.numeric > 0) break;
      headerRows++;
    }
  }

  const totalHeaderRows = headerRows + (bestIndex - headerStart);
  return {
    skipRows: headerStart,
    headerRows: totalHeaderRows,
    headers: mergeHeaders(grid, headerStart, totalHeaderRows, width),
    rows: trimTrailingEmptyRows(grid.slice(bestIndex + headerRows)),
    title: titleFrom(grid, headerStart, null),
  };
}

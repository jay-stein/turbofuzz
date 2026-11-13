import { parseNumber } from "./numbers.js";

export interface DetectedTable {
  /** Rows above the header block (titles, notes, section labels). */
  skipRows: number;
  /** Number of header levels merged into `headers` (1-2 typically). */
  headerRows: number;
  /** Column labels merged across header levels; "" where none was found. */
  headers: string[];
  /** Rows between the header block and the first data row (units lines, notes). */
  skipAfter: number;
  /** Data rows after the header block, footer and trailing empty rows removed. */
  rows: string[][];
  /** Non-empty rows cut from the end of the data (footnotes, source lines). */
  footerRows: number;
  /** First non-empty value from the skipped rows, if any. */
  title: string | null;
}

/**
 * Where the data stops: "auto" cuts a trailing footnote block, "file" keeps
 * everything, "blank" stops at the first empty row, and a number keeps the
 * file's records up to and including that 1-based record number.
 */
export type DataEnd = "auto" | "file" | "blank" | number;

/** A user-chosen import layout that replaces the automatic guess. */
export interface HeaderLayout {
  /** Rows above the header block to drop (titles, notes). */
  skipRows: number;
  /** Header levels after the skipped rows; 0 means the table has no header row. */
  headerRows: number;
  /** Rows to drop between the header block and the data (units lines). Default 0. */
  skipAfter?: number;
  /** Where the data stops. Default "auto". */
  dataEnd?: DataEnd;
  /** Columns of the table (0-based, after the header is read) to leave out. Default none. */
  skipColumns?: number[];
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

/** A cell's outline: letter runs become "a", digit runs "9", punctuation kept ("TXN100379" → "a9", "02/11/2023" → "9/9/9"). */
function cellShape(cell: string): string {
  return cell.trim().replace(/\p{L}+/gu, "a").replace(/\d+/g, "9").replace(/\s+/g, " ");
}

const SHAPE_LOOKAHEAD = 6;

/**
 * Share of a row's filled cells whose shape matches most of the cells below them
 * in the same column (up to SHAPE_LOOKAHEAD filled rows). A record scores high;
 * a header ("Txn ID" over "TXN100379") scores low.
 */
function shapeLikeBelow(grid: readonly string[][], index: number): number {
  const row = grid[index] ?? [];
  const below: (readonly string[])[] = [];
  for (let next = index + 1; next < grid.length && below.length < SHAPE_LOOKAHEAD; next++) {
    const candidate = grid[next] ?? [];
    if (candidate.some((cell) => cell !== "")) below.push(candidate);
  }
  // Too few rows below to compare: no evidence it is a header, so it ranks as a
  // record does. Fewer than three is too few to judge fairly.
  if (below.length < 3) return 1;
  let filled = 0;
  let alike = 0;
  const limit = Math.min(row.length, MAX_SCAN_COLUMNS);
  for (let column = 0; column < limit; column++) {
    const cell = row[column] ?? "";
    if (cell.trim() === "") continue;
    filled++;
    const shape = cellShape(cell);
    let same = 0;
    let seen = 0;
    for (const other of below) {
      const value = other[column] ?? "";
      if (value.trim() === "") continue;
      seen++;
      if (cellShape(value) === shape) same++;
    }
    if (seen > 0 && same * 2 > seen) alike++;
  }
  return filled === 0 ? 0 : alike / filled;
}

function mergeHeaders(grid: readonly string[][], start: number, count: number, columns: number): string[] {
  // A label in an upper header row spans the blank cells to its right, as a
  // merged cell does in Excel ("Jan" over Budget | Actual): carry it across while
  // the bottom row still names a column, so the second column reads "Jan Actual".
  const bottom = start + count - 1;
  const levels: string[][] = [];
  for (let row = start; row < start + count; row++) {
    const cells: string[] = [];
    let carry = "";
    for (let column = 0; column < columns; column++) {
      const value = (grid[row]?.[column] ?? "").trim();
      const named = (grid[bottom]?.[column] ?? "").trim() !== "";
      if (value !== "") carry = value;
      else if (row === bottom || !named) carry = "";
      cells.push(value !== "" ? value : carry);
    }
    levels.push(cells);
  }
  const headers: string[] = [];
  for (let column = 0; column < columns; column++) {
    const parts: string[] = [];
    for (const cells of levels) {
      const value = cells[column];
      if (value === "" || parts.includes(value)) continue;
      parts.push(value);
    }
    headers.push(parts.join(" ").slice(0, 120));
  }
  return uniqueNames(headers);
}

/** Numbers repeated column names ("Actual", "Actual 2", …) so every column can be told apart and referenced. */
function uniqueNames(names: readonly string[]): string[] {
  const taken = new Set(names.map((name) => name.toLowerCase()));
  const seen = new Map<string, number>();
  return names.map((name) => {
    if (name === "") return name;
    const key = name.toLowerCase();
    const count = (seen.get(key) ?? 0) + 1;
    seen.set(key, count);
    if (count === 1) return name;
    let suffix = count;
    while (taken.has(`${key} ${suffix}`)) suffix++;
    taken.add(`${key} ${suffix}`);
    return `${name} ${suffix}`;
  });
}

const FOOTER_MARKER = /^(foot)?notes?\b|^sources?\b|^symbol legend\b|^how to cite\b/i;
const FOOTER_HEADING = /^((foot)?notes?|sources?|symbol legend)\s*:?$/i;
/** A summary row's label: "Total", "TOTAL", "Grand total", "Sub-total", "Totals:". */
const TOTAL_LABEL = /^(grand\s+|sub-?\s*)?totals?\b\s*:?/i;
const FOOTER_SCAN_ROWS = 400;
const BODY_SAMPLE_ROWS = 20;

function isEmptyRow(row: readonly string[]): boolean {
  return row.every((cell) => cell === "");
}

function filledCount(row: readonly string[]): number {
  let filled = 0;
  for (const cell of row) if (cell !== "") filled++;
  return filled;
}

function hasNumberBeyondFirst(row: readonly string[]): boolean {
  for (let index = 1; index < row.length; index++) if (isNumericCell(row[index])) return true;
  return false;
}

/** True when most of the first records carry a number outside the first column. */
function bodyIsNumeric(rows: readonly string[][]): boolean {
  let seen = 0;
  let numeric = 0;
  for (let index = 0; index < rows.length && seen < BODY_SAMPLE_ROWS; index++) {
    if (isEmptyRow(rows[index])) continue;
    seen++;
    if (hasNumberBeyondFirst(rows[index])) numeric++;
  }
  return seen > 0 && numeric * 2 >= seen;
}

/**
 * Where a trailing footnote block begins, or `rows.length` when there is none.
 * A line that is only "Footnotes:" or "Source:" starts it outright. Otherwise
 * the block is the run at the end of rows that no longer look like records
 * (under half the columns filled, or no number where the table has numbers),
 * and is only cut when that run holds a blank row or a "Notes"/"Source" line,
 * so a lone odd last record is kept.
 */
function footerStart(rows: readonly string[][], width: number): number {
  for (let index = Math.max(0, rows.length - FOOTER_SCAN_ROWS); index < rows.length; index++) {
    const row = rows[index];
    if (index > 0 && filledCount(row) === 1 && FOOTER_HEADING.test((row[0] ?? "").trim())) return index;
  }
  const numeric = bodyIsNumeric(rows);
  let last = rows.length;
  while (last > 0) {
    const row = rows[last - 1];
    const record = !isEmptyRow(row) && filledCount(row) * 2 >= width && (!numeric || hasNumberBeyondFirst(row));
    if (record) break;
    last--;
  }
  for (let index = last; index < rows.length; index++) {
    const row = rows[index];
    if (isEmptyRow(row) || FOOTER_MARKER.test((row[0] ?? "").trim())) return index;
  }
  return rows.length;
}

/**
 * Where a trailing block of summary rows begins, looking back from `stop`
 * (blank rows in between are skipped). A row counts when its first filled cell
 * is a Total label: it sums the rows above, so keeping it double-counts every
 * figure in sums, pivots and charts.
 */
function totalRowsStart(rows: readonly string[][], stop: number): number {
  let start = stop;
  for (let index = stop - 1; index > 0; index--) {
    const row = rows[index];
    if (isEmptyRow(row)) continue;
    const first = row.find((cell) => cell.trim() !== "") ?? "";
    if (!TOTAL_LABEL.test(first.trim())) break;
    start = index;
  }
  return start;
}

function applyDataEnd(
  rows: string[][],
  width: number,
  end: DataEnd,
  startRecord: number,
): { rows: string[][]; footerRows: number } {
  let stop = rows.length;
  if (typeof end === "number") {
    stop = Math.max(0, Math.min(rows.length, Math.floor(end) - startRecord));
  } else if (end === "blank") {
    const blank = rows.findIndex(isEmptyRow);
    if (blank !== -1) stop = blank;
  } else if (end === "auto") {
    stop = footerStart(rows, width);
    stop = totalRowsStart(rows, stop);
  }
  while (stop > 0 && isEmptyRow(rows[stop - 1])) stop--;
  let footerRows = 0;
  for (let index = stop; index < rows.length; index++) if (!isEmptyRow(rows[index])) footerRows++;
  return { rows: stop === rows.length ? rows : rows.slice(0, stop), footerRows };
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

/** True when the first record is mostly numeric and the rows below match it. */
function isHeaderlessNumeric(grid: readonly string[][], index: number): boolean {
  const first = profileOf(grid[index] ?? []);
  if (first.populated < 2 || first.numeric / first.populated < 0.8) return false;
  let seen = 0;
  for (let offset = 1; offset <= DATA_LOOKAHEAD; offset++) {
    const row = grid[index + offset];
    if (row === undefined) break;
    const profile = profileOf(row);
    if (profile.populated === 0) continue;
    seen++;
    if (profile.numeric / profile.populated < 0.8) return false;
  }
  return seen > 0;
}

/** Applies a user-chosen layout; no guessing. Column count comes from the widest row seen. */
function applyLayout(grid: readonly string[][], layout: HeaderLayout): DetectedTable {
  const skipRows = Math.max(0, Math.min(Math.floor(layout.skipRows), grid.length));
  const headerRows = Math.max(0, Math.min(Math.floor(layout.headerRows), grid.length - skipRows));
  const skipAfter = Math.max(
    0,
    Math.min(Math.floor(layout.skipAfter ?? 0), grid.length - skipRows - headerRows),
  );
  let width = 0;
  const limit = Math.min(grid.length, skipRows + headerRows + skipAfter + MAX_SCAN_ROWS);
  for (let row = skipRows; row < limit; row++) {
    if (row >= skipRows + headerRows && row < skipRows + headerRows + skipAfter) continue;
    width = Math.max(width, populatedExtent(grid[row] ?? []));
  }
  const headers =
    headerRows > 0
      ? mergeHeaders(grid, skipRows, headerRows, width)
      : Array.from({ length: width }, (_, index) => `Column ${index + 1}`);
  const start = skipRows + headerRows + skipAfter;
  const ended = applyDataEnd(grid.slice(start), width, layout.dataEnd ?? "auto", start);
  return {
    skipRows,
    headerRows,
    headers,
    skipAfter,
    rows: ended.rows,
    footerRows: ended.footerRows,
    title: titleFrom(grid, skipRows, null),
  };
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
const NUM = String.raw`['"“‘]?(-?\d+(?:\.\d+)?)['"”’]?`;
const MISSING_WORDS = String.raw`(?:missing|unknown|not (?:stated|known|available|recorded|applicable)|no data|n/?a)`;
const STATED_CODE_PATTERNS: readonly RegExp[] = [
  // "A value of '-9' is used for a missing/unknown value."
  new RegExp(String.raw`(?:values?|codes?)\s+(?:of\s+)?${NUM}\s+(?:is|are)\s+used\s+(?:for|to\s+\w+)\s+(?:a\s+)?${MISSING_WORDS}`, "i"),
  // "-9 = unknown", "999 means missing"
  new RegExp(String.raw`${NUM}\s*(?:=|means|:|-|–)\s*${MISSING_WORDS}\b`, "i"),
  // "Missing values are coded as -9"
  new RegExp(String.raw`${MISSING_WORDS}[^.]{0,40}?(?:coded|recorded|represented|shown|entered)\s+as\s+${NUM}`, "i"),
];

/**
 * A number the file's own notes (the rows above the table) say stands for "missing": "A value of '-9' is used for a missing
 * value." Read from the skipped rows only, so a data cell is never mistaken for a note.
 */
export function statedMissingCodes(skipped: readonly (readonly string[])[]): string[] {
  const found = new Set<string>();
  for (const row of skipped) {
    for (const cell of row) {
      const text = cell.trim();
      if (text.length < 8 || text.length > 300) continue;
      for (const pattern of STATED_CODE_PATTERNS) {
        const m = pattern.exec(text);
        if (m !== null && m[1] !== undefined) found.add(m[1]);
      }
    }
  }
  return [...found];
}

/** The same table without the columns the layout leaves out. */
function withoutColumns(table: DetectedTable, skip: readonly number[] | undefined): DetectedTable {
  if (skip === undefined || skip.length === 0) return table;
  const drop = new Set(skip);
  const keep: number[] = [];
  for (let i = 0; i < table.headers.length; i++) if (!drop.has(i)) keep.push(i);
  return {
    ...table,
    headers: keep.map((i) => table.headers[i]!),
    rows: table.rows.map((row) => keep.map((i) => row[i] ?? "")),
  };
}

export function detectTable(grid: readonly string[][], layout?: HeaderLayout): DetectedTable {
  if (layout !== undefined) return withoutColumns(applyLayout(grid, layout), layout.skipColumns);
  const empty: DetectedTable = {
    skipRows: 0,
    headerRows: 0,
    headers: [],
    skipAfter: 0,
    rows: [],
    footerRows: 0,
    title: null,
  };
  const scanRows = Math.min(grid.length, MAX_SCAN_ROWS);
  if (scanRows === 0) return empty;

  let width = 0;
  const profiles: RowProfile[] = [];
  const extents: number[] = [];
  for (let row = 0; row < scanRows; row++) {
    const profile = profileOf(grid[row] ?? []);
    const extent = populatedExtent(grid[row] ?? []);
    profiles.push(profile);
    extents.push(extent);
    width = Math.max(width, extent);
  }

  /** Cuts the footer off the rows from `start` on and names the columns. */
  const finish = (
    skipRows: number,
    headerRows: number,
    skipAfter: number,
    headers: string[],
  ): DetectedTable => {
    const start = skipRows + headerRows + skipAfter;
    const ended = applyDataEnd(grid.slice(start), width, "auto", start);
    return {
      skipRows,
      headerRows,
      headers,
      skipAfter,
      rows: ended.rows,
      footerRows: ended.footerRows,
      title: titleFrom(grid, skipRows, null),
    };
  };

  let bestIndex = -1;
  let bestScore = 0;
  let bestRank = -Infinity;
  for (let row = 0; row < scanRows; row++) {
    const profile = profiles[row];
    if (profile.populated < 2) continue;
    // One label repeated in every filled cell is a merged title spread across
    // the row (Excel "Q1 payments" over A1:D1), never a set of column names.
    if (new Set((grid[row] ?? []).filter((cell) => cell.trim() !== "").map((cell) => cell.trim())).size === 1) continue;
    const textRatio = profile.text / profile.populated;
    const widthRatio = width > 0 ? profile.populated / width : 0;
    const below = numericDataBelow(grid, row);
    const selfNumbers = profile.numeric / profile.populated;
    const score = textRatio * 2 + widthRatio * 2 + below * 3 - selfNumbers * 3;
    if (score < MIN_SCORE) continue;
    // Among rows that could be the header, prefer the one least like the rows
    // under it: in a text-heavy table a record ("TXN100379, 02/11/2023, …")
    // scores as well as the real header, but its cells share the shape of the
    // cells below. Only ranks candidates; whether there is a header at all
    // still rests on the score alone.
    const rank = score - shapeLikeBelow(grid, row) * 3;
    if (rank > bestRank) {
      bestRank = rank;
      bestScore = score;
      bestIndex = row;
    }
  }

  if (bestIndex === -1 || bestScore < MIN_SCORE) {
    const firstNonEmpty = grid.findIndex((row) => row.some((cell) => cell !== ""));
    if (firstNonEmpty === -1) return empty;
    // No row reads as a header and the first record is as numeric as the ones
    // below it: a header-less table. Keep every record and name the columns.
    if (isHeaderlessNumeric(grid, firstNonEmpty)) {
      return finish(
        firstNonEmpty,
        0,
        0,
        Array.from({ length: width }, (_, index) => `Column ${index + 1}`),
      );
    }
    return finish(firstNonEmpty, 1, 0, mergeHeaders(grid, firstNonEmpty, 1, width));
  }

  let headerRows = 1;
  let headerStart = bestIndex;
  let skipAfter = 0;
  const dataFollows = numericDataBelow(grid, bestIndex) > 0.3;
  if (dataFollows) {
    // Extend upward into merged super-headers (at most two rows). Such rows
    // are text-only and reach into the right half of the table, e.g. "Sales"
    // spanning two columns. A "Label | value" line that stops after a column or
    // two is table metadata, not a header level.
    while (headerStart > 0 && bestIndex - headerStart < 2) {
      const profile = profiles[headerStart - 1];
      if (profile === undefined || profile.populated < 2 || profile.numeric > 0) break;
      if (extents[headerStart - 1] * 5 < width * 3) break;
      headerStart--;
    }
    // Extend downward while rows stay text-only and hold no numeric cells,
    // which keeps a data row like `1,Ann,…` out of the header block. A line that
    // stops after a column or two is a units note, not a header level.
    while (bestIndex + headerRows < grid.length && headerRows < 3) {
      const profile = profiles[bestIndex + headerRows];
      if (profile === undefined || profile.populated === 0) break;
      if (profile.numeric > 0) break;
      if (extents[bestIndex + headerRows] * 5 < width * 3) break;
      headerRows++;
    }
    // Units or note lines under the header ("" | "Hours"): text, no label in
    // the first column and mostly empty.
    while (skipAfter < 2) {
      const index = bestIndex + headerRows + skipAfter;
      const profile = profiles[index];
      if (profile === undefined || profile.populated === 0 || profile.numeric > 0) break;
      if (profile.populated * 2 >= width || (grid[index]?.[0] ?? "") !== "") break;
      skipAfter++;
    }
  }

  const totalHeaderRows = headerRows + (bestIndex - headerStart);
  return finish(
    headerStart,
    totalHeaderRows,
    skipAfter,
    mergeHeaders(grid, headerStart, totalHeaderRows, width),
  );
}

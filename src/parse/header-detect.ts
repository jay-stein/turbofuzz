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
/** How far down the scan may reach past empty rows looking for MAX_SCAN_ROWS filled ones. */
const MAX_SCAN_DEPTH = 500;
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

const WHOLE_CELL = /^['"]?(\d{1,4})['"]?$/;
const YEAR = /^(?:1[6-9]|20|21)\d\d$/;

/**
 * True when a row's numbers are labels rather than a record: a run of years stepping evenly left to
 * right ("1960 | 1961 | …", "2015 | 2020 | 2025", at least three), or a count 0, 1, 2, … across five or
 * more columns (the column numbers some sheets keep above their header for lookups).
 */
function isSequenceRow(row: readonly string[]): boolean {
  return sequenceKind(row) !== null;
}

/** "years" for a header of years, "count" for a row of column numbers 0, 1, 2, …; null otherwise. */
function sequenceKind(row: readonly string[]): "years" | "count" | null {
  const values: number[] = [];
  let numbers = 0;
  const limit = Math.min(row.length, MAX_SCAN_COLUMNS);
  for (let i = 0; i < limit; i++) {
    const cell = (row[i] ?? "").trim();
    if (cell === "" || !isNumericCell(cell)) continue;
    numbers++;
    const whole = WHOLE_CELL.exec(cell);
    if (whole !== null) values.push(Number(whole[1]));
  }
  if (values.length < 3 || values.length * 4 < numbers * 3) return null;
  if (values.every((value) => YEAR.test(String(value)))) {
    // Years may repeat in groups under a super-header ("2021 … 2025 | 2021 … 2025"): each group steps evenly
    // by 1-10 years, a step back starts the next group, and at least one group holds three or more years.
    let step = 0;
    let run = 1;
    let longest = 1;
    for (let i = 1; i < values.length; i++) {
      const diff = values[i]! - values[i - 1]!;
      if (diff <= 0) {
        step = 0;
        run = 1;
        continue;
      }
      if (diff > 10 || (step !== 0 && diff !== step)) return null;
      step = diff;
      run++;
      longest = Math.max(longest, run);
    }
    // One year in every column under different headings ("2025 | 2025 | 2025") labels them too.
    const single = values.length >= 3 && values.every((value) => value === values[0]);
    return longest >= 3 || single ? "years" : null;
  }
  const step = values[1]! - values[0]!;
  for (let i = 2; i < values.length; i++) if (values[i]! - values[i - 1]! !== step) return null;
  return step === 1 && values.length >= 5 ? "count" : null;
}

/**
 * The rows the scoring looks at, with a sequence row's numbers read as labels ("1960" -> "y1960"), so a
 * header of years (or a row of column numbers) neither scores as numbers nor matches the shape of the
 * figures under it. Column names still come from the real grid.
 */
function scoringGrid(grid: readonly string[][], rows: number): string[][] {
  const scan: string[][] = [];
  const limit = Math.min(grid.length, rows);
  for (let index = 0; index < limit; index++) {
    const row = grid[index] ?? [];
    scan.push(isSequenceRow(row) ? row.map((cell) => (WHOLE_CELL.test(cell.trim()) ? `y${cell.trim()}` : cell)) : (row as string[]));
  }
  return scan;
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

/**
 * Share of a row's labels standing over a column that is filled in at least half of the next value rows
 * (up to SHAPE_LOOKAHEAD rows of mostly numbers). 1 when there are no value rows to judge by.
 */
function coverageBelow(grid: readonly string[][], index: number): number {
  const below: (readonly string[])[] = [];
  for (let next = index + 1; next < grid.length && below.length < SHAPE_LOOKAHEAD; next++) {
    const candidate = grid[next] ?? [];
    if (!isEmptyRow(candidate) && profileOf(candidate).numeric > 0) below.push(candidate);
  }
  if (below.length < 2) return 1;
  const row = grid[index] ?? [];
  let labels = 0;
  let covered = 0;
  for (let column = 0; column < Math.min(row.length, MAX_SCAN_COLUMNS); column++) {
    if ((row[column] ?? "").trim() === "") continue;
    labels++;
    let filled = 0;
    for (const other of below) if ((other[column] ?? "").trim() !== "") filled++;
    if (filled * 2 >= below.length) covered++;
  }
  return labels === 0 ? 0 : covered / labels;
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
/** How many cells the first records usually fill (the median): a sheet's width can be set by stray cells far to the right. */
function typicalFilled(rows: readonly string[][], width: number): number {
  const counts: number[] = [];
  for (let index = 0; index < rows.length && counts.length < BODY_SAMPLE_ROWS; index++) {
    if (!isEmptyRow(rows[index])) counts.push(filledCount(rows[index]));
  }
  if (counts.length === 0) return width;
  counts.sort((a, b) => a - b);
  return Math.min(width, counts[counts.length >> 1]!);
}

function footerStart(rows: readonly string[][], width: number): number {
  for (let index = Math.max(0, rows.length - FOOTER_SCAN_ROWS); index < rows.length; index++) {
    const row = rows[index];
    if (index > 0 && filledCount(row) === 1 && FOOTER_HEADING.test((row[0] ?? "").trim())) return index;
  }
  const numeric = bodyIsNumeric(rows);
  const typical = typicalFilled(rows, width);
  let last = rows.length;
  while (last > 0) {
    const row = rows[last - 1];
    const record = !isEmptyRow(row) && filledCount(row) * 2 >= typical && (!numeric || hasNumberBeyondFirst(row));
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
const MAX_TOTAL_ROWS = 5;

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
    // Notes after a table are a small block at its end. Unless the block opens with "Notes", "Source" or
    // the like, a "footer" holding most of the filled rows is a misreading of the table's shape, and
    // cutting it would silently empty the table: keep everything.
    let filledBefore = 0;
    let filledAfter = 0;
    let opening = "";
    for (let index = 0; index < rows.length; index++) {
      if (isEmptyRow(rows[index])) continue;
      if (index < stop) filledBefore++;
      else {
        if (filledAfter === 0) opening = (rows[index].find((cell) => cell.trim() !== "") ?? "").trim();
        filledAfter++;
      }
    }
    const marked = FOOTER_MARKER.test(opening) || FOOTER_HEADING.test(opening);
    if (!marked && filledAfter > filledBefore) stop = rows.length;
    // A summary block is a handful of rows. When most of the table starts with "Total ..."
    // (every row of a "Total Nacional" file does), those are data, not a footer.
    const totals = totalRowsStart(rows, stop);
    const block = stop - totals;
    if (block <= MAX_TOTAL_ROWS && block * 2 < rows.length) stop = totals;
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

/** A cell shape that carries digits: the evidence a row holds values rather than labels ("C00059" → "a9"). */
function hasDigitShape(shape: string): boolean {
  return shape.includes("9");
}

/**
 * True when a row reads as a record of the table below it, not as column names: at least half its filled
 * cells share the shape of the cells under them, and at least two of those carry digits (an id, a year, an
 * amount). A header such as "Name | City" over "Ann | Paris" has no digits, so it never qualifies.
 */
export function rowLooksLikeData(grid: readonly string[][], index: number): boolean {
  const row = grid[index] ?? [];
  const below: (readonly string[])[] = [];
  for (let next = index + 1; next < grid.length && below.length < SHAPE_LOOKAHEAD; next++) {
    const candidate = grid[next] ?? [];
    if (candidate.some((cell) => cell !== "")) below.push(candidate);
  }
  if (below.length < 3) return false;
  let filled = 0;
  let alike = 0;
  let alikeWithDigits = 0;
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
    if (seen > 0 && same * 2 > seen) {
      alike++;
      if (hasDigitShape(shape)) alikeWithDigits++;
    }
  }
  return filled >= 2 && alike * 2 >= filled && alikeWithDigits >= 2;
}

/** True when any non-empty row above `bestIndex` is a full-width record or looks like the rows below it. */
function skippedRowsAreRecords(grid: readonly string[][], bestIndex: number, width: number): boolean {
  return firstRecordAbove(grid, bestIndex, width) !== -1;
}

/** The first non-empty row above `bestIndex` that is a full-width record or looks like the rows below it, or -1. */
function firstRecordAbove(grid: readonly string[][], bestIndex: number, width: number): number {
  if (width < 3) return -1;
  for (let row = 0; row < bestIndex; row++) {
    const cells = grid[row] ?? [];
    const filled = filledCount(cells);
    if (filled === 0) continue;
    // One label repeated across the row is a merged title, however wide.
    if (new Set(cells.filter((cell) => cell.trim() !== "").map((cell) => cell.trim())).size === 1) continue;
    // A text row repeating a label into the next cell is a merged super-header ("Estimates | Estimates"), not a record.
    if (profileOf(cells).numeric === 0 && repeatsNeighbour(cells)) continue;
    if (populatedExtent(cells) >= width && filled >= width) return row;
    if (filled >= 3 && rowLooksLikeData(grid, row)) return row;
  }
  return -1;
}

/** A row of values: two or more filled cells, at least half of them numbers. */
function isValueRow(row: readonly string[]): boolean {
  const profile = profileOf(row);
  return profile.populated >= 2 && profile.numeric * 2 >= profile.populated;
}

/** An upper header level spans the columns under it: blanks inside its reach, or the same label in neighbouring cells. */
function spansColumns(row: readonly string[]): boolean {
  const extent = populatedExtent(row);
  for (let i = 0; i < extent; i++) {
    const cell = (row[i] ?? "").trim();
    if (cell === "") return true;
    if (i > 0 && cell === (row[i - 1] ?? "").trim()) return true;
  }
  return false;
}

/** Most of an upper row's labels stand over a named column of the header row below. */
function labelsOverColumns(upper: readonly string[], header: readonly string[]): boolean {
  let labels = 0;
  let over = 0;
  for (let i = 0; i < Math.min(upper.length, MAX_SCAN_COLUMNS); i++) {
    if ((upper[i] ?? "").trim() === "") continue;
    labels++;
    if ((header[i] ?? "").trim() !== "") over++;
  }
  return labels > 0 && over * 2 > labels;
}

/** The same label in two neighbouring cells, as a merged cell reads once expanded. */
function repeatsNeighbour(row: readonly string[]): boolean {
  for (let i = 1; i < row.length; i++) {
    const cell = (row[i] ?? "").trim();
    if (cell !== "" && cell === (row[i - 1] ?? "").trim()) return true;
  }
  return false;
}

/** One label repeated in every filled cell: a merged title spread across the row. */
function isMergedTitle(row: readonly string[]): boolean {
  return new Set(row.filter((cell) => cell.trim() !== "").map((cell) => cell.trim())).size === 1;
}

const MIN_METADATA_ROWS = 4;

/**
 * The layout of published time series (central banks, statistics offices): a header row, then a block of
 * "Label | value per column" rows (Description, Frequency, Units, Source, Series ID…), then dated records.
 * The header is the block's first wide row; the rest of the block sits between it and the data. Found only
 * when every label in the block is a word without digits, there are at least four of them, and the records'
 * first column has one digit-bearing shape (dates, periods), so ordinary records are never mistaken for it.
 */
function metadataBlock(scan: readonly string[][], width: number): { header: number; data: number } | null {
  let data = -1;
  for (let row = 0; row < Math.min(scan.length, MAX_SCAN_ROWS); row++) {
    if (!isValueRow(scan[row] ?? [])) continue;
    let following = 0;
    let fine = true;
    for (let next = row + 1; next < scan.length && following < 2; next++) {
      if (isEmptyRow(scan[next] ?? [])) continue;
      following++;
      if (!isValueRow(scan[next] ?? [])) fine = false;
    }
    if (fine && following === 2) {
      data = row;
      break;
    }
  }
  if (data < MIN_METADATA_ROWS) return null;
  const firstShapes = new Map<string, number>();
  let sampled = 0;
  for (let row = data; row < scan.length && sampled < SHAPE_LOOKAHEAD; row++) {
    const first = (scan[row]?.[0] ?? "").trim();
    if (first === "") continue;
    sampled++;
    const shape = cellShape(first);
    firstShapes.set(shape, (firstShapes.get(shape) ?? 0) + 1);
  }
  const [dataShape, count] = [...firstShapes.entries()].sort((a, b) => b[1] - a[1])[0] ?? ["", 0];
  if (sampled < 3 || count * 5 < sampled * 4 || !hasDigitShape(dataShape)) return null;

  let header = -1;
  let blanks = 0;
  for (let row = data - 1; row >= 0; row--) {
    const cells = scan[row] ?? [];
    if (isEmptyRow(cells)) {
      if (++blanks > 2) break;
      continue;
    }
    blanks = 0;
    if (isMergedTitle(cells) && filledCount(cells) > 1) break;
    const first = (cells[0] ?? "").trim();
    const wide = populatedExtent(cells) * 5 >= width * 3 && !isValueRow(cells);
    const labelOnly = first !== "" && filledCount(cells) === 1;
    if (!wide && !labelOnly) break;
    if (wide) header = row;
  }
  if (header === -1) return null;
  // The labels of the rows under the header (the header's own first cell names the date column, or is blank).
  const metadata: string[] = [];
  for (let row = header + 1; row < data; row++) {
    const cells = scan[row] ?? [];
    if (!isEmptyRow(cells)) metadata.push((cells[0] ?? "").trim());
  }
  if (metadata.length < MIN_METADATA_ROWS - 1) return null;
  if (metadata.some((label) => label === "" || label.length > 40 || /\d/.test(label))) return null;
  if (new Set(metadata.map((label) => label.toLowerCase())).size !== metadata.length) return null;
  return { header, data };
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
  // The first MAX_SCAN_ROWS filled rows: a chart or a gap above the table (a report sheet) leaves
  // empty rows that would otherwise use up the scan before the header is reached.
  let scanRows = 0;
  for (let filled = 0; scanRows < Math.min(grid.length, MAX_SCAN_DEPTH) && filled < MAX_SCAN_ROWS; scanRows++) {
    if (!isEmptyRow(grid[scanRows] ?? [])) filled++;
  }
  if (scanRows === 0) return empty;
  // What the scoring reads: the scanned rows plus enough below them to look ahead, years in a header row as labels.
  const scan = scoringGrid(grid, scanRows + SHAPE_LOOKAHEAD + DATA_LOOKAHEAD + 20);

  let width = 0;
  const profiles: RowProfile[] = [];
  const extents: number[] = [];
  for (let row = 0; row < scanRows; row++) {
    const profile = profileOf(scan[row] ?? []);
    const extent = populatedExtent(scan[row] ?? []);
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

  const meta = metadataBlock(scan, width);
  if (meta !== null) {
    return finish(meta.header, 1, meta.data - meta.header - 1, mergeHeaders(grid, meta.header, 1, width));
  }

  /** The next filled row is a row of values: the header sits right above the data. */
  const nextIsValues = (row: number): boolean => {
    for (let next = row + 1; next < scan.length; next++) {
      if (!isEmptyRow(scan[next] ?? [])) return isValueRow(scan[next] ?? []);
    }
    return false;
  };

  let bestIndex = -1;
  let bestScore = 0;
  let bestRank = -Infinity;
  const candidates: { row: number; score: number; rank: number }[] = [];
  for (let row = 0; row < scanRows; row++) {
    const profile = profiles[row];
    if (profile.populated < 2) continue;
    // One label repeated in every filled cell is a merged title spread across
    // the row (Excel "Q1 payments" over A1:D1), never a set of column names.
    if (isMergedTitle(scan[row] ?? [])) continue;
    // A row of column numbers (0, 1, 2, …) is lookup scaffolding above the real header, never the header.
    if (sequenceKind(grid[row] ?? []) === "count") continue;
    const textRatio = profile.text / profile.populated;
    const widthRatio = width > 0 ? profile.populated / width : 0;
    const below = numericDataBelow(scan, row);
    const selfNumbers = profile.numeric / profile.populated;
    const score = textRatio * 2 + widthRatio * 2 + below * 3 - selfNumbers * 3;
    if (score < MIN_SCORE) continue;
    // Among rows that could be the header, prefer the one least like the rows
    // under it: in a text-heavy table a record ("TXN100379, 02/11/2023, …")
    // scores as well as the real header, but its cells share the shape of the
    // cells below. Only ranks candidates; whether there is a header at all
    // still rests on the score alone.
    // A header names columns that hold data: a row whose labels mostly stand over columns left empty
    // below (a menu of links above the table) counts against itself.
    const coverage = coverageBelow(scan, row);
    const rank = score - shapeLikeBelow(scan, row) * 3 - (coverage < 0.6 ? (1 - coverage) * 3 : 0);
    // On a tie, the row right above the figures wins over label rows higher up ("Sourcekey | RWTC" over "Date | Price").
    const tie = Math.abs(rank - bestRank) < 1e-9 && nextIsValues(row) && !nextIsValues(bestIndex);
    candidates.push({ row, score, rank });
    if (rank > bestRank + 1e-9 || tie) {
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
    if (isHeaderlessNumeric(scan, firstNonEmpty)) {
      return finish(
        firstNonEmpty,
        0,
        0,
        Array.from({ length: width }, (_, index) => `Column ${index + 1}`),
      );
    }
    return finish(firstNonEmpty, 1, 0, mergeHeaders(grid, firstNonEmpty, 1, width));
  }

  // A title is a short note above the table. Rows above the best header that are full records (as wide
  // as the table, or shaped like the rows below) mean the file has no header: every row is data.
  const record = firstRecordAbove(scan, bestIndex, width);
  if (record !== -1) {
    // Records above the best header: either the file has no header, or the sheet stacks tables and the
    // best header belongs to a later one. A header candidate above those records starts the first table.
    let earlier: { row: number; score: number; rank: number } | null = null;
    for (const candidate of candidates) {
      if (candidate.row < record && (earlier === null || candidate.rank > earlier.rank)) earlier = candidate;
    }
    if (earlier === null) {
      return finish(0, 0, 0, Array.from({ length: width }, (_, index) => `Column ${index + 1}`));
    }
    bestIndex = earlier.row;
    bestScore = earlier.score;
  }

  let headerRows = 1;
  let headerStart = bestIndex;
  let skipAfter = 0;
  const dataFollows = numericDataBelow(scan, bestIndex) > 0.3;
  if (dataFollows) {
    // Extend upward into merged super-headers (at most two rows). Such rows
    // are text-only, reach into the right half of the table and span columns,
    // e.g. "Sales" over two columns (blank beside it, or repeated by a merge).
    // A "Label | value" line that stops after a column or two is table metadata,
    // a merged title is one label across the row, and a row of distinct labels
    // in every cell ("Sourcekey | RWTC") names nothing below it: none is a level.
    let levelsAbove = 0;
    while (headerStart > 0 && levelsAbove < 2) {
      // One blank row may sit between a super-header and the row it spans.
      const gap = isEmptyRow(scan[headerStart - 1] ?? []) && headerStart > 1 ? 1 : 0;
      const index = headerStart - 1 - gap;
      const profile = profiles[index];
      const above = scan[index] ?? [];
      if (profile === undefined || profile.populated < 2 || profile.numeric > 0) break;
      if (extents[index] * 5 < width * 3) break;
      if (isMergedTitle(above) || !spansColumns(above)) break;
      if (sequenceKind(grid[index] ?? []) === "count") break;
      // Its labels sit over named columns of the header; a menu of links beside the table does not.
      if (!labelsOverColumns(above, scan[bestIndex] ?? [])) break;
      headerStart = index;
      levelsAbove++;
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

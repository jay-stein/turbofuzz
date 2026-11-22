/**
 * How a date column was read: the text in the file beside the date it became, so a person can
 * check the parse instead of trusting it. Over the whole column it counts the text shapes found
 * ("9999-99-99 99:99:99" for 2014-07-07 00:00:00), the values that did not read, and the ones
 * whose day and month could be swapped (03/04/2020); the first rows are listed one by one.
 */

export type DateAuditFlag = "ok" | "unreadable" | "ambiguous";

export interface DateAuditRow {
  /** The row's position in the file (0-based). */
  row: number;
  /** The cell's text as it is in the file. */
  text: string;
  /** What it was read as: epoch milliseconds (UTC), or NaN when it did not read. */
  value: number;
  flag: DateAuditFlag;
}

export interface DateAuditShape {
  /** Digits shown as 9 and letters as a: the form of the text, not its value. */
  shape: string;
  count: number;
  example: string;
}

export interface DateAuditResult {
  /** The first rows with text, in file order. */
  rows: DateAuditRow[];
  /** The first unreadable or ambiguous rows anywhere in the column. */
  problems: DateAuditRow[];
  /** Cells with text. */
  nonEmpty: number;
  /** Cells that are empty or a missing-value token in the file. */
  blanks: number;
  unreadable: number;
  ambiguous: number;
  /** Values read with a time of day other than midnight. */
  timed: number;
  /** The most common forms of the text, largest first. */
  shapes: DateAuditShape[];
}

/** Day and month both 12 or less and different: which is which is a choice, not a fact. */
const SWAPPABLE = /^\s*(\d{1,2})[/.\- ](\d{1,2})[/.\- ]\d{2,4}/;
const SHAPE_LIMIT = 8;

export function dateShape(text: string): string {
  return text.trim().slice(0, 40).replace(/\d/g, "9").replace(/[A-Za-z]+/g, "a");
}

export function isSwappable(text: string): boolean {
  const match = SWAPPABLE.exec(text);
  if (match === null) return false;
  const a = Number(match[1]);
  const b = Number(match[2]);
  return a >= 1 && b >= 1 && a <= 12 && b <= 12 && a !== b;
}

/** `blank(row)`: the cell is empty or a missing-value token, so it was never meant to be a date. */
export function auditDates(text: ArrayLike<string>, values: ArrayLike<number>, blank: (row: number) => boolean, limit: number): DateAuditResult {
  const rows: DateAuditRow[] = [];
  const problems: DateAuditRow[] = [];
  const shapes = new Map<string, DateAuditShape>();
  let nonEmpty = 0;
  let blanks = 0;
  let unreadable = 0;
  let ambiguous = 0;
  let timed = 0;
  for (let row = 0; row < text.length; row++) {
    const cell = text[row] ?? "";
    if (blank(row) || cell.trim() === "") {
      blanks++;
      continue;
    }
    nonEmpty++;
    const value = values[row] ?? Number.NaN;
    const flag: DateAuditFlag = !Number.isFinite(value) ? "unreadable" : isSwappable(cell) ? "ambiguous" : "ok";
    if (Number.isFinite(value) && value % 86_400_000 !== 0) timed++;
    if (flag === "unreadable") unreadable++;
    else if (flag === "ambiguous") ambiguous++;
    const shape = dateShape(cell);
    const seen = shapes.get(shape);
    if (seen !== undefined) seen.count++;
    else shapes.set(shape, { shape, count: 1, example: cell.trim() });
    if (rows.length < limit) rows.push({ row, text: cell, value, flag });
    if (flag !== "ok" && problems.length < limit) problems.push({ row, text: cell, value, flag });
  }
  const ranked = [...shapes.values()].sort((a, b) => b.count - a.count).slice(0, SHAPE_LIMIT);
  return { rows, problems, nonEmpty, blanks, unreadable, ambiguous, timed, shapes: ranked };
}

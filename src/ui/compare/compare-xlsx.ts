import { diffValue } from "../../data/compare/diffs.js";
import type { CompareReport } from "../../data/compare/report.js";
import type { ShiftReport } from "../../data/compare/shift.js";
import { pairFamily } from "../../data/compare/values.js";
import {
  ROW_CHANGED,
  ROW_ONLY_A,
  ROW_ONLY_B,
  type ColumnPairing,
  type CompareColumn,
  type CompareRules,
  type CompareSide,
  type MatchResult,
} from "../../data/compare/types.js";
import { looksLikeIdName } from "../../data/identifier.js";
import { toDateInputValue } from "../../parse/dates.js";
import { TYPE_LABELS } from "../../types.js";
import { FALSE_WORDS, FRAGILE_DIGITS, TRUE_WORDS, XLSX_DATETIME_FORMAT, XLSX_DATE_FORMAT, XLSX_DURATION_FORMAT, XLSX_TIME_FORMAT, serial } from "../../worker/xlsx-export.js";
import { XlsxBuilder, type StyleSpec, type XCell } from "../xlsx-styled.js";
import { columnLetters } from "../xlsx-writer.js";

/** What the workbook says about the run besides the data: the settings text and when it was made. */
export interface ReportMeta {
  /** The one-line description of the run (how rows matched, the rules, the time taken). */
  description: string;
  rules: CompareRules;
  /** A column pair made automatically because the values match, with the share that match. */
  autoPaired: { a: string; b: string; overlap: number } | null;
  /** Shown on the Summary, e.g. 2026-11-15 10:30 UTC. */
  created: string;
}

export interface WorkbookLimits {
  /** Rows a sheet may hold, header rows included (Excel: 1,048,576). */
  sheetRows: number;
  /** Cell changes listed on the Changed cells sheet at most. */
  changeRows: number;
}

export const DEFAULT_LIMITS: WorkbookLimits = { sheetRows: 1_048_576, changeRows: 1_000_000 };

export interface ReportWorkbook {
  bytes: Uint8Array;
  /** Rows that differ, and how many of them the Differences sheet holds. */
  differences: { total: number; written: number };
  /** Changed cells, and how many of them the Changed cells sheet lists. */
  changes: { total: number; written: number };
}

const DAY_MS = 86_400_000;
const WIDTH_SAMPLE = 200;
const MIN_WIDTH = 9;
const MAX_WIDTH = 45;

const nf = new Intl.NumberFormat("en");
const num = new Intl.NumberFormat("en", { maximumFractionDigits: 2 });

/** The look of the report, in one place. Fills are light and the text on them dark, so colour never carries a value alone. */
const P = {
  ink: "1F2937",
  dim: "6B7280",
  line: "9CA3AF",
  redFill: "FDE2E2",
  redInk: "991B1B",
  redStrong: "FCA5A5",
  greenFill: "DCFCE7",
  greenInk: "166534",
  greenStrong: "86EFAC",
  amberFill: "FEF3C7",
  amberStrong: "FDE68A",
  amberInk: "78350F",
  blueFill: "DBEAFE",
  blueTint: "EFF6FF",
  blueInk: "1E3A8A",
  greyFill: "E5E7EB",
  greyTint: "F3F4F6",
  hatch: "C7CCD1",
  negative: "B91C1C",
};
const SIGNED_INT = "+#,##0;-#,##0;0";
const SIGNED_DEC = "+#,##0.0###;-#,##0.0###;0.0";
const SIGNED_PCT = "+0.0%;-0.0%;0.0%";

interface Typer {
  /** Number format code for the column's numbers and dates; undefined for General. */
  fmt: string | undefined;
  at(row: number): XCell;
}

/**
 * Cell values as Excel types: numbers, dates (real Excel dates), booleans and
 * text. Anything that did not parse as its column's type, and numbers Excel
 * would damage (leading zeros, over 15 digits), stay text.
 */
function typer(column: CompareColumn): Typer {
  const raw = column.raw;
  const empty = (row: number): boolean => column.isEmpty(row);
  switch (column.type) {
    case "integer":
    case "number": {
      const values = column.numbers();
      let decimals = 0;
      for (let i = 0; i < Math.min(raw.length, 300); i++) {
        const dot = /\.(\d+)\s*$/.exec(raw[i] ?? "");
        if (dot !== null) decimals = Math.max(decimals, Math.min(6, dot[1]!.length));
      }
      const integer = column.type === "integer";
      return {
        fmt: decimals > 0 ? `0.${"0".repeat(decimals)}` : undefined,
        at(row) {
          if (empty(row)) return null;
          const v = values[row]!;
          if (!Number.isFinite(v) || FRAGILE_DIGITS.test((raw[row] ?? "").trim()) || (integer && !Number.isSafeInteger(v))) return raw[row] ?? null;
          return v;
        },
      };
    }
    case "date":
    case "datetime":
    case "time":
    case "duration": {
      const values = column.numbers();
      const type = column.type;
      return {
        fmt: type === "date" ? XLSX_DATE_FORMAT : type === "datetime" ? XLSX_DATETIME_FORMAT : type === "time" ? XLSX_TIME_FORMAT : XLSX_DURATION_FORMAT,
        at(row) {
          if (empty(row)) return null;
          const v = values[row]!;
          if (!Number.isFinite(v)) return raw[row] ?? null;
          if (type === "time" || type === "duration") return v / DAY_MS;
          return serial(v) ?? raw[row] ?? null;
        },
      };
    }
    case "boolean":
      return {
        fmt: undefined,
        at(row) {
          if (empty(row)) return null;
          const text = (raw[row] ?? "").trim().toLowerCase();
          return TRUE_WORDS.has(text) ? true : FALSE_WORDS.has(text) ? false : (raw[row] ?? null);
        },
      };
    default:
      return { fmt: undefined, at: (row) => (empty(row) ? null : (raw[row] ?? null)) };
  }
}

/** Float noise from subtracting (0.30000000000000004) is rounded off. */
const round12 = (v: number): number => Number(v.toPrecision(12));
const percent = (part: number, whole: number): string => (whole === 0 ? "" : `${((part / whole) * 100).toFixed(1)}%`);

function columnWidth(chars: number, fmt: string | undefined): number {
  const floor = fmt === XLSX_DATETIME_FORMAT ? 19 : fmt === XLSX_DATE_FORMAT ? 11 : MIN_WIDTH;
  return Math.min(MAX_WIDTH, Math.max(floor, chars + 2));
}

/** Longest text among the first rows of a column (for a width); `rows` holds a row of this side per position, -1 for none. */
function sampleLength(column: CompareColumn, rows: ArrayLike<number>, count: number): number {
  let longest = 0;
  for (let i = 0; i < Math.min(count, WIDTH_SAMPLE); i++) {
    const row = rows[i]!;
    if (row >= 0) longest = Math.max(longest, (column.raw[row] ?? "").length);
  }
  return longest;
}

const SIDE_NAMES = { [ROW_CHANGED]: "~ changed", [ROW_ONLY_A]: "− only in A", [ROW_ONLY_B]: "+ only in B" } as const;

/**
 * The comparison as a formatted Excel workbook: a Summary, the Differences
 * (every compared column side by side, only the rows that differ, changed
 * cells coloured), the Changed cells as a list, the rows only in A and only in
 * B, the Columns pairing and, when there is one, the Big Picture. Sheets are
 * written row by row and deflated as they go, so 50,000 differing rows by 40
 * columns never exist as one string.
 */
export async function compareReportWorkbook(
  a: CompareSide,
  b: CompareSide,
  pairing: ColumnPairing,
  match: MatchResult,
  keyPairs: readonly number[] | null,
  report: CompareReport,
  shift: ShiftReport | null,
  meta: ReportMeta,
  limits: WorkbookLimits = DEFAULT_LIMITS,
): Promise<ReportWorkbook> {
  const book = await XlsxBuilder.create();
  const keySet = new Set(keyPairs ?? []);
  const keys = [...keySet].map((index) => pairing.pairs[index]).filter((pair) => pair !== undefined);
  const parts = pairing.pairs.flatMap((pair, index) => (keySet.has(index) ? [] : [{ pair, index }]));

  // One pass over the aligned rows: which differ, and how many cells changed.
  const status = match.status;
  const picked = new Int32Array(match.counts.changed + match.counts.onlyA + match.counts.onlyB);
  let total = 0;
  let cellTotal = 0;
  for (let i = 0; i < status.length && total < picked.length; i++) {
    const s = status[i]!;
    if (s !== ROW_CHANGED && s !== ROW_ONLY_A && s !== ROW_ONLY_B) continue;
    picked[total++] = i;
    if (s === ROW_CHANGED) for (const { index } of parts) if (match.changed[index]!.get(i)) cellTotal++;
  }

  const names = {
    summary: book.uniqueName("Summary"),
    differences: book.uniqueName("Differences"),
    changes: book.uniqueName("Changed cells"),
    onlyA: book.uniqueName("Only in A"),
    onlyB: book.uniqueName("Only in B"),
    columns: book.uniqueName("Columns"),
    shift: shift === null ? "" : book.uniqueName("Big Picture"),
  };

  // Rows a sheet can still hold under its header rows; one more is kept for the note when rows are left out.
  const room = (headers: number, count: number): { rows: number; cut: boolean } => {
    const free = Math.max(0, limits.sheetRows - headers);
    return count <= free ? { rows: count, cut: false } : { rows: Math.max(0, free - 1), cut: true };
  };
  const diffRoom = room(2, total);
  const changeRoom = room(1, Math.min(cellTotal, limits.changeRows));
  const changeCut = cellTotal > changeRoom.rows;
  const onlyARoom = room(1, match.counts.onlyA);
  const onlyBRoom = room(1, match.counts.onlyB);

  writeSummary(book, names, a, b, keys.map((p) => p.a), keySet, report, meta, { diffRoom, total, cellTotal, changeRows: changeRoom.rows, changeCut, onlyARoom, onlyBRoom });
  writeDifferences(book, names.differences, a, b, keys, parts, match, picked, total, diffRoom);
  writeChanges(book, names.changes, a, b, keys, parts, match, picked, total, changeRoom.rows, cellTotal);
  if (match.fuzzy !== null && match.fuzzy !== undefined && match.fuzzy.pairs.length > 0) writeSimilar(book, book.uniqueName("Similar keys"), match.fuzzy, limits.sheetRows);
  writeOnly(book, names.onlyA, a, match, "a", onlyARoom, "EF4444", P.redFill, P.redInk);
  writeOnly(book, names.onlyB, b, match, "b", onlyBRoom, "22C55E", P.greenFill, P.greenInk);
  writeColumns(book, names.columns, a, b, pairing, keySet, meta);
  if (shift !== null) writeShift(book, names.shift, shift);

  return { bytes: book.finish(), differences: { total, written: diffRoom.rows }, changes: { total: cellTotal, written: changeRoom.rows } };
}

type Names = Record<"summary" | "differences" | "changes" | "onlyA" | "onlyB" | "columns" | "shift", string>;

interface Room {
  rows: number;
  cut: boolean;
}

function headerStyle(book: XlsxBuilder, fill: string, ink: string, extra: StyleSpec = {}): number {
  return book.styles.style({ bold: true, fill, color: ink, align: "center", valign: "center", wrap: true, border: { bottom: { style: "thin", color: P.line } }, ...extra });
}

// ---------------------------------------------------------------- Differences

function writeDifferences(
  book: XlsxBuilder,
  name: string,
  a: CompareSide,
  b: CompareSide,
  keys: ColumnPairing["pairs"],
  parts: { pair: ColumnPairing["pairs"][number]; index: number }[],
  match: MatchResult,
  picked: Int32Array,
  total: number,
  room: Room,
): void {
  const style = (spec: StyleSpec): number => book.styles.style(spec);
  const edge = { left: { style: "thin" as const, color: P.line } };
  const typed = parts.map(({ pair }) => {
    const ca = a.columns[pair.a]!;
    const cb = b.columns[pair.b]!;
    return { ca, cb, ta: typer(ca), tb: typer(cb), numeric: pairFamily(ca, cb) === "number", integer: ca.type === "integer" && cb.type === "integer" };
  });
  const keyTypers = keys.map((pair) => ({ ta: typer(a.columns[pair.a]!), tb: typer(b.columns[pair.b]!) }));

  // Layout: Status, the keys, then A | B (| Δ) for every compared column.
  const groupStart: number[] = [];
  let width = 1 + keys.length;
  for (const part of typed) {
    groupStart.push(width);
    width += part.numeric ? 3 : 2;
  }
  const last = columnLetters(Math.max(0, width - 1));

  // Widths from the first rows.
  const aRows = new Int32Array(Math.min(room.rows, WIDTH_SAMPLE));
  const bRows = new Int32Array(aRows.length);
  for (let n = 0; n < aRows.length; n++) {
    aRows[n] = match.aRow[picked[n]!]!;
    bRows[n] = match.bRow[picked[n]!]!;
  }
  const widths: number[] = [13, ...keys.map((pair, k) => columnWidth(Math.max(a.columns[pair.a]!.name.length, sampleLength(a.columns[pair.a]!, aRows, aRows.length), sampleLength(b.columns[pair.b]!, bRows, bRows.length)), keyTypers[k]!.ta.fmt))];
  typed.forEach((part) => {
    const title = part.ca.name === part.cb.name ? part.cb.name : `${part.ca.name} → ${part.cb.name}`;
    const own = Math.ceil(title.length / (part.numeric ? 3 : 2));
    widths.push(columnWidth(Math.max(own, sampleLength(part.ca, aRows, aRows.length)), part.ta.fmt), columnWidth(Math.max(own, sampleLength(part.cb, bRows, bRows.length)), part.tb.fmt));
    if (part.numeric) widths.push(11);
  });

  const sheet = book.sheet({
    name,
    tabColor: "F59E0B",
    widths,
    freeze: { rows: 2, cols: 1 + keys.length },
    landscape: true,
    fitWidth: true,
    printTitleRows: [1, 2],
  });

  // Header rows: the column name over its A | B | Δ.
  const headTop: XCell[] = new Array(width).fill(null);
  const headSub: XCell[] = new Array(width).fill(null);
  const topStyles: number[] = new Array(width).fill(0);
  const subStyles: number[] = new Array(width).fill(0);
  const merges: string[] = [];
  const base = headerStyle(book, P.greyFill, P.ink);
  const baseLeft = headerStyle(book, P.greyFill, P.ink, { border: { bottom: { style: "thin", color: P.line }, ...edge } });
  headTop[0] = "Status";
  topStyles[0] = subStyles[0] = base;
  merges.push("A1:A2");
  keys.forEach((pair, k) => {
    headTop[1 + k] = a.columns[pair.a]!.name;
    topStyles[1 + k] = subStyles[1 + k] = k === 0 ? baseLeft : base;
    merges.push(`${columnLetters(1 + k)}1:${columnLetters(1 + k)}2`);
  });
  const hA = (left: boolean): number => headerStyle(book, "F8D7DA", P.redInk, left ? { border: { bottom: { style: "thin", color: P.line }, ...edge } } : {});
  const hB = headerStyle(book, "D4EDDA", P.greenInk);
  const hD = headerStyle(book, P.blueFill, P.blueInk);
  const hName = (left: boolean): number => headerStyle(book, P.greyFill, P.ink, { border: { bottom: { style: "thin", color: P.line }, ...(left ? edge : {}) } });
  typed.forEach((part, p) => {
    const c = groupStart[p]!;
    const cells = part.numeric ? 3 : 2;
    headTop[c] = part.ca.name === part.cb.name ? part.cb.name : `${part.ca.name} → ${part.cb.name}`;
    for (let k = 0; k < cells; k++) topStyles[c + k] = hName(k === 0);
    headSub[c] = "A";
    headSub[c + 1] = "B";
    subStyles[c] = hA(true);
    subStyles[c + 1] = hB;
    if (part.numeric) {
      headSub[c + 2] = "Δ (B−A)";
      subStyles[c + 2] = hD;
    }
    merges.push(`${columnLetters(c)}1:${columnLetters(c + cells - 1)}1`);
  });
  sheet.row(1, headTop, topStyles, 22);
  sheet.row(2, headSub, subStyles, 20);

  // Styles of the data cells, by role.
  const statusStyle = {
    [ROW_CHANGED]: style({ bold: true, fill: P.amberStrong, color: P.amberInk }),
    [ROW_ONLY_A]: style({ bold: true, fill: P.redStrong, color: "7F1D1D" }),
    [ROW_ONLY_B]: style({ bold: true, fill: P.greenStrong, color: "14532D" }),
  };
  const keyStyles = keyTypers.map((k, i) => style({ bold: true, numFmt: k.ta.fmt, border: i === 0 ? edge : undefined }));
  const hatch = (left: boolean): number => style({ hatch: { fg: P.hatch, bg: P.greyTint }, border: left ? edge : undefined });
  const hatchPlain = hatch(false);
  const roles = typed.map((part) => {
    const signed = part.integer ? SIGNED_INT : SIGNED_DEC;
    const fa = part.ta.fmt;
    const fb = part.tb.fmt;
    return {
      chgA: style({ fill: P.redFill, color: P.redInk, numFmt: fa, border: edge }),
      chgB: style({ fill: P.greenFill, color: P.greenInk, numFmt: fb }),
      sameA: style({ color: P.dim, numFmt: fa, border: edge }),
      sameB: style({ color: P.dim, numFmt: fb }),
      onlyA: style({ fill: P.redFill, color: P.redInk, numFmt: fa, border: edge }),
      onlyB: style({ fill: P.greenFill, color: P.greenInk, numFmt: fb }),
      hatchA: hatch(true),
      pos: style({ fill: P.blueTint, color: P.greenInk, bold: true, numFmt: signed }),
      neg: style({ fill: P.blueTint, color: P.negative, bold: true, numFmt: signed }),
      zero: style({ fill: P.blueTint, color: P.dim, numFmt: signed }),
      blank: style({ fill: P.blueTint }),
      plain: style({}),
    };
  });
  const nums = typed.map((part) => (part.numeric ? { x: part.ca.numbers(), y: part.cb.numbers() } : null));

  const cells: XCell[] = new Array(width).fill(null);
  const styles: number[] = new Array(width).fill(0);
  for (let n = 0; n < room.rows; n++) {
    const i = picked[n]!;
    const s = match.status[i]! as 1 | 2 | 3;
    const ar = match.aRow[i]!;
    const br = match.bRow[i]!;
    cells[0] = SIDE_NAMES[s];
    styles[0] = statusStyle[s];
    for (let k = 0; k < keyTypers.length; k++) {
      cells[1 + k] = ar >= 0 ? keyTypers[k]!.ta.at(ar) : keyTypers[k]!.tb.at(br);
      styles[1 + k] = keyStyles[k]!;
    }
    for (let p = 0; p < typed.length; p++) {
      const c = groupStart[p]!;
      const part = typed[p]!;
      const role = roles[p]!;
      if (s === ROW_CHANGED) {
        const changed = match.changed[parts[p]!.index]!.get(i);
        cells[c] = part.ta.at(ar);
        cells[c + 1] = part.tb.at(br);
        styles[c] = changed ? role.chgA : role.sameA;
        styles[c + 1] = changed ? role.chgB : role.sameB;
        if (part.numeric) {
          const d = changed ? diffValue("sub", nums[p]!.x[ar]!, nums[p]!.y[br]!) : NaN;
          cells[c + 2] = d === d ? round12(d) : null;
          styles[c + 2] = d === d ? (d > 0 ? role.pos : d < 0 ? role.neg : role.zero) : changed ? role.blank : role.plain;
        }
      } else if (s === ROW_ONLY_A) {
        cells[c] = part.ta.at(ar);
        cells[c + 1] = null;
        styles[c] = role.onlyA;
        styles[c + 1] = hatchPlain;
        if (part.numeric) {
          cells[c + 2] = null;
          styles[c + 2] = hatchPlain;
        }
      } else {
        cells[c] = null;
        cells[c + 1] = part.tb.at(br);
        styles[c] = role.hatchA;
        styles[c + 1] = role.onlyB;
        if (part.numeric) {
          cells[c + 2] = null;
          styles[c + 2] = hatchPlain;
        }
      }
    }
    sheet.row(n + 3, cells, styles);
  }
  let lastRow = room.rows + 2;
  if (room.cut) {
    lastRow++;
    sheet.row(lastRow, [`Only the first ${nf.format(room.rows)} of ${nf.format(total)} rows that differ are listed here: a sheet cannot hold more. The rest are left out.`], style({ bold: true, fill: P.amberFill, color: P.amberInk }));
  } else if (total === 0) {
    lastRow++;
    sheet.row(lastRow, ["No rows differ: every row matched is identical."], style({ italic: true, color: P.dim }));
  }
  sheet.end({ autoFilter: `A2:${last}${Math.max(2, room.rows + 2)}`, merges });
}

// -------------------------------------------------------------- Changed cells

function writeChanges(
  book: XlsxBuilder,
  name: string,
  a: CompareSide,
  b: CompareSide,
  keys: ColumnPairing["pairs"],
  parts: { pair: ColumnPairing["pairs"][number]; index: number }[],
  match: MatchResult,
  picked: Int32Array,
  total: number,
  rows: number,
  cellTotal: number,
): void {
  const style = (spec: StyleSpec): number => book.styles.style(spec);
  const keyTypers = keys.map((pair) => ({ ta: typer(a.columns[pair.a]!), tb: typer(b.columns[pair.b]!) }));
  const typed = parts.map(({ pair }) => {
    const ca = a.columns[pair.a]!;
    const cb = b.columns[pair.b]!;
    const numeric = pairFamily(ca, cb) === "number";
    const ta = typer(ca);
    const tb = typer(cb);
    const signed = ca.type === "integer" && cb.type === "integer" ? SIGNED_INT : SIGNED_DEC;
    return {
      ta,
      tb,
      numeric,
      x: numeric ? ca.numbers() : null,
      y: numeric ? cb.numbers() : null,
      name: cb.name,
      sa: style({ fill: P.redFill, color: P.redInk, numFmt: ta.fmt, align: "left" }),
      sb: style({ fill: P.greenFill, color: P.greenInk, numFmt: tb.fmt, align: "left" }),
      up: style({ bold: true, color: P.greenInk, numFmt: signed }),
      down: style({ bold: true, color: P.negative, numFmt: signed }),
      flat: style({ color: P.dim, numFmt: signed }),
    };
  });
  const headers = [...keys.map((pair) => a.columns[pair.a]!.name), "A row", "B row", "Column", "Value in A", "Value in B", "Δ (B−A)", "Δ %"];
  const k = keys.length;
  const sheet = book.sheet({
    name,
    tabColor: "F59E0B",
    widths: [...keys.map((_, i) => columnWidth(a.columns[keys[i]!.a]!.name.length, undefined)), 9, 9, 22, 18, 18, 13, 10],
    freeze: { rows: 1, cols: 0 },
    landscape: true,
    fitWidth: true,
    printTitleRows: [1, 1],
  });
  const head = headerStyle(book, P.greyFill, P.ink);
  const headers2 = headers.map((_, c) => (c === k + 3 ? headerStyle(book, "F8D7DA", P.redInk) : c === k + 4 ? headerStyle(book, "D4EDDA", P.greenInk) : c >= k + 5 ? headerStyle(book, P.blueFill, P.blueInk) : head));
  sheet.row(1, headers, headers2, 22);
  const keyStyle = style({ bold: true });
  const rowNo = style({ color: P.dim, numFmt: "0" });
  const colName = style({ bold: true });
  const pctPos = style({ numFmt: SIGNED_PCT });
  const cells: XCell[] = new Array(headers.length).fill(null);
  const styles: number[] = new Array(headers.length).fill(0);
  let written = 0;
  for (let n = 0; n < total && written < rows; n++) {
    const i = picked[n]!;
    if (match.status[i] !== ROW_CHANGED) continue;
    const ar = match.aRow[i]!;
    const br = match.bRow[i]!;
    for (let p = 0; p < typed.length && written < rows; p++) {
      if (!match.changed[parts[p]!.index]!.get(i)) continue;
      const t = typed[p]!;
      for (let j = 0; j < k; j++) {
        cells[j] = keyTypers[j]!.ta.at(ar);
        styles[j] = keyStyle;
      }
      cells[k] = ar + 1;
      cells[k + 1] = br + 1;
      cells[k + 2] = t.name;
      cells[k + 3] = t.ta.at(ar);
      cells[k + 4] = t.tb.at(br);
      styles[k] = styles[k + 1] = rowNo;
      styles[k + 2] = colName;
      styles[k + 3] = t.sa;
      styles[k + 4] = t.sb;
      let delta: number | null = null;
      let ratio: number | null = null;
      if (t.numeric) {
        const d = diffValue("sub", t.x![ar]!, t.y![br]!);
        if (d === d) delta = round12(d);
        const r = diffValue("pct", t.x![ar]!, t.y![br]!);
        if (r === r) ratio = round12(r / 100);
      }
      cells[k + 5] = delta;
      cells[k + 6] = ratio;
      styles[k + 5] = delta === null ? 0 : delta > 0 ? t.up : delta < 0 ? t.down : t.flat;
      styles[k + 6] = pctPos;
      written++;
      sheet.row(written + 1, cells, styles);
    }
  }
  let last = written + 1;
  if (cellTotal > written) {
    last++;
    sheet.row(last, [`Only the first ${nf.format(written)} of ${nf.format(cellTotal)} changed cells are listed here. The rest are left out.`], style({ bold: true, fill: P.amberFill, color: P.amberInk }));
  } else if (written === 0) {
    last++;
    sheet.row(last, [match.mode === "key" || match.mode === "position" ? "No cell changed." : "Rows were matched on whole content, so a changed row counts as one removed and one added and no cell changes are listed."], style({ italic: true, color: P.dim }));
  }
  const pctCol = columnLetters(k + 6);
  sheet.end({
    autoFilter: `A1:${columnLetters(headers.length - 1)}${Math.max(1, written + 1)}`,
    colourScales: written > 0 ? [{ ref: `${pctCol}2:${pctCol}${written + 1}`, colors: ["F87171", "FFFFFF", "4ADE80"], middle: 0 }] : [],
  });
}

// ------------------------------------------------------------- Only in A / B

function writeOnly(book: XlsxBuilder, name: string, side: CompareSide, match: MatchResult, which: "a" | "b", room: Room, tab: string, tint: string, ink: string): void {
  const style = (spec: StyleSpec): number => book.styles.style(spec);
  const typers = side.columns.map(typer);
  const rowsOf = which === "a" ? match.aRow : match.bRow;
  const wanted = which === "a" ? ROW_ONLY_A : ROW_ONLY_B;
  const sample: number[] = [];
  for (let i = 0; i < match.status.length && sample.length < WIDTH_SAMPLE; i++) if (match.status[i] === wanted) sample.push(rowsOf[i]!);
  const sheet = book.sheet({
    name,
    tabColor: tab,
    widths: side.columns.map((column, c) => columnWidth(Math.max(column.name.length, sampleLength(column, sample, sample.length)), typers[c]!.fmt)),
    freeze: { rows: 1, cols: 0 },
    landscape: true,
    fitWidth: true,
    printTitleRows: [1, 1],
  });
  const head = headerStyle(book, tint, ink);
  sheet.row(1, side.columns.map((column) => column.name), head, 22);
  const bodyStyles = typers.map((t) => style({ numFmt: t.fmt }));
  const cells: XCell[] = new Array(side.columns.length).fill(null);
  let written = 0;
  for (let i = 0; i < match.status.length && written < room.rows; i++) {
    if (match.status[i] !== wanted) continue;
    const row = rowsOf[i]!;
    for (let c = 0; c < typers.length; c++) cells[c] = typers[c]!.at(row);
    written++;
    sheet.row(written + 1, cells, bodyStyles);
  }
  let last = written + 1;
  if (room.cut) {
    last++;
    sheet.row(last, [`Only the first ${nf.format(written)} rows are listed here: a sheet cannot hold more. The rest are left out.`], style({ bold: true, fill: P.amberFill, color: P.amberInk }));
  } else if (written === 0) {
    last++;
    sheet.row(last, [`No rows are only in ${which.toUpperCase()}.`], style({ italic: true, color: P.dim }));
  }
  sheet.end({ autoFilter: side.columns.length === 0 ? undefined : `A1:${columnLetters(side.columns.length - 1)}${Math.max(1, written + 1)}` });
}

// ---------------------------------------------------------------- Similar keys

/** Rows paired by similar key text, those to review first: what each side called it, how close, and what else agrees. */
function writeSimilar(book: XlsxBuilder, name: string, fuzzy: NonNullable<MatchResult["fuzzy"]>, sheetRows: number): void {
  const style = (spec: StyleSpec): number => book.styles.style(spec);
  const sheet = book.sheet({ name, tabColor: "F59E0B", widths: [34, 34, 12, 22, 26], freeze: { rows: 1, cols: 0 }, landscape: true, fitWidth: true, printTitleRows: [1, 1] });
  sheet.row(1, ["Key in A", "Key in B", "Similar", "Other columns", "Check"], headerStyle(book, P.greyFill, P.ink), 22);
  const ordered = [...fuzzy.pairs].sort((x, y) => (x.tier === y.tier ? x.score - y.score : x.tier === "review" ? -1 : 1));
  const written = Math.min(ordered.length, Math.max(0, sheetRows - 2));
  const review = style({ fill: P.amberStrong, color: P.amberInk, bold: true, align: "center" });
  const sure = style({ align: "center" });
  ordered.slice(0, written).forEach((pair, index) => {
    sheet.row(
      index + 2,
      [pair.aKey, pair.bKey, `${Math.round(pair.score * 100)}%`, pair.checked === 0 ? "none to check" : `${pair.agree} of ${pair.checked} agree`, pair.tier === "review" ? (pair.ambiguous ? "Review: another row was as close" : "Review") : "Confident"],
      [0, 0, sure, 0, pair.tier === "review" ? review : sure],
    );
  });
  sheet.end({ autoFilter: `A1:E${Math.max(1, written + 1)}` });
}

// ------------------------------------------------------------------- Columns

function writeColumns(book: XlsxBuilder, name: string, a: CompareSide, b: CompareSide, pairing: ColumnPairing, keySet: ReadonlySet<number>, meta: ReportMeta): void {
  const style = (spec: StyleSpec): number => book.styles.style(spec);
  const sheet = book.sheet({ name, tabColor: "6B7280", widths: [24, 24, 14, 14, 18, 12, 14], freeze: { rows: 1, cols: 0 }, landscape: true, fitWidth: true, printTitleRows: [1, 1] });
  const headers = ["Column in A", "Column in B", "Type in A", "Type in B", "How paired", "Role", "Status"];
  sheet.row(1, headers, headerStyle(book, P.greyFill, P.ink), 22);
  const fills: Record<string, StyleSpec> = {
    same: {},
    retyped: { fill: P.amberStrong, color: P.amberInk, bold: true },
    removed: { fill: P.redStrong, color: "7F1D1D", bold: true },
    added: { fill: P.greenStrong, color: "14532D", bold: true },
    ignored: { fill: P.greyFill, color: P.ink, bold: true },
  };
  let r = 1;
  const put = (line: string[]): void => {
    const cells = line.slice(0, 6);
    const kind = line[6]!;
    sheet.row(++r, [...cells, kind], [0, 0, 0, 0, 0, 0, style({ ...fills[kind], align: "center" })]);
  };
  pairing.pairs.forEach((pair, index) => {
    const ca = a.columns[pair.a]!;
    const cb = b.columns[pair.b]!;
    const auto = meta.autoPaired !== null && meta.autoPaired.a === ca.name && meta.autoPaired.b === cb.name;
    const how = auto ? "auto, by values" : pair.manual ? "by hand" : "by name";
    put([ca.name, cb.name, TYPE_LABELS[ca.type], TYPE_LABELS[cb.type], how, keySet.has(index) ? "key" : "compared", ca.type === cb.type ? "same" : "retyped"]);
  });
  for (const index of pairing.onlyA) put([a.columns[index]!.name, "", TYPE_LABELS[a.columns[index]!.type], "", "", "", "removed"]);
  for (const index of pairing.onlyB) put(["", b.columns[index]!.name, "", TYPE_LABELS[b.columns[index]!.type], "", "", "added"]);
  for (const pair of pairing.ignored) {
    const ca = pair.a < 0 ? null : a.columns[pair.a]!;
    const cb = pair.b < 0 ? null : b.columns[pair.b]!;
    put([ca?.name ?? "", cb?.name ?? "", ca === null ? "" : TYPE_LABELS[ca.type], cb === null ? "" : TYPE_LABELS[cb.type], "", "ignored", "ignored"]);
  }
  sheet.end({ autoFilter: `A1:G${Math.max(1, r)}` });
}

// --------------------------------------------------------------- Big Picture

function writeShift(book: XlsxBuilder, name: string, shift: ShiftReport): void {
  const style = (spec: StyleSpec): number => book.styles.style(spec);
  const sheet = book.sheet({ name, tabColor: "8B5CF6", widths: [26, 12, 14, 30, 12, 40, 40], freeze: { rows: 1, cols: 0 }, landscape: true, fitWidth: true, printTitleRows: [1, 1] });
  sheet.row(1, ["Column", "Kind", "Shift", "Measure", "Size", "A", "B"], headerStyle(book, P.greyFill, P.ink), 22);
  const level = {
    none: style({ color: P.dim, align: "center" }),
    mild: style({ fill: P.amberStrong, color: P.amberInk, bold: true, align: "center" }),
    large: style({ fill: P.redStrong, color: "7F1D1D", bold: true, align: "center" }),
  };
  const size = style({ numFmt: "0.000" });
  const wrap = style({ wrap: true, valign: "top" });
  let r = 1;
  for (const column of shift.columns) {
    const shiftText = column.level === "none" ? "no real shift" : column.level;
    if (column.kind === "numeric") {
      const text = (v: number): string => (column.family === "date" ? (Number.isFinite(v) ? toDateInputValue(v) : "") : num.format(v));
      sheet.row(
        ++r,
        [
          column.name,
          column.family === "date" ? "dates" : "numbers",
          shiftText,
          `PSI${column.smd === null || column.family === "date" ? "" : `; mean ${Math.abs(column.smd) < 0.005 ? "0.00" : `${column.smd > 0 ? "+" : "−"}${Math.abs(column.smd).toFixed(2)}`} SD`}`,
          round12(column.psi),
          `mean ${text(column.a.mean)}, median ${text(column.a.median)}`,
          `mean ${text(column.b.mean)}, median ${text(column.b.median)}`,
        ],
        [0, 0, level[column.level], 0, size, wrap, wrap],
      );
    } else {
      const top = column.values.slice(0, 3);
      sheet.row(
        ++r,
        [column.name, "categories", shiftText, "Cramér's V", round12(column.v), top.map((v) => `${v.label} ${(v.a * 100).toFixed(1)}%`).join(", "), top.map((v) => `${v.label} ${(v.b * 100).toFixed(1)}%`).join(", ")],
        [0, 0, level[column.level], 0, size, wrap, wrap],
      );
    }
  }
  const filterEnd = Math.max(1, r);
  const skipped = style({ italic: true, color: P.dim });
  for (const column of shift.skipped) sheet.row(++r, [column.name, "skipped", column.why], skipped);
  sheet.end({
    autoFilter: `A1:G${filterEnd}`,
    colourScales: filterEnd > 1 ? [{ ref: `E2:E${filterEnd}`, colors: ["FFFFFF", "FDE68A", "F87171"] }] : [],
  });
}

// ------------------------------------------------------------------- Summary

interface SummaryFacts {
  diffRoom: Room;
  total: number;
  cellTotal: number;
  changeRows: number;
  changeCut: boolean;
  onlyARoom: Room;
  onlyBRoom: Room;
}

function writeSummary(
  book: XlsxBuilder,
  names: Names,
  a: CompareSide,
  b: CompareSide,
  keyColumns: readonly number[],
  keySet: ReadonlySet<number>,
  report: CompareReport,
  meta: ReportMeta,
  facts: SummaryFacts,
): void {
  const style = (spec: StyleSpec): number => book.styles.style(spec);
  const sheet = book.sheet({ name: names.summary, tabColor: "3B82F6", widths: [24, 16, 16, 16, 16, 16, 16, 16], gridlines: false, landscape: true, fitWidth: true });
  const merges: string[] = [];
  const links: { ref: string; sheet: string; tip?: string }[] = [];
  let dataBarRange = "";
  let r = 0;
  const line = (cells: XCell[], styles: number | number[], height?: number): number => {
    sheet.row(++r, cells, styles, height);
    return r;
  };
  const wide = (text: string, spec: StyleSpec, height?: number): void => {
    const at = line([text, null, null, null, null, null, null, null], style(spec), height);
    merges.push(`A${at}:H${at}`);
  };
  const blank = (): void => void ++r;
  const section = (title: string): void => {
    blank();
    wide(title, { bold: true, size: 13, color: P.ink, border: { bottom: { style: "medium", color: P.line } } }, 22);
  };
  const label = style({ bold: true, color: P.ink, fill: P.greyTint, valign: "center" });
  const value = style({ valign: "center", wrap: true });
  const info = (name: string, text: string): void => {
    const at = line([name, text, null, null, null, null, null, null], [label, value, value, value, value, value, value, value], text.length > 105 ? 15 * Math.ceil(text.length / 105) : 18);
    merges.push(`B${at}:H${at}`);
  };

  const rows = report.rows;
  wide("Comparison of A and B", { bold: true, size: 20, color: P.ink, valign: "center" }, 32);
  wide(`Made with TurboFuzz, in the browser · ${meta.created}`, { italic: true, color: P.dim });
  blank();
  info("A (before)", `${a.name} · ${nf.format(rows.a)} rows × ${nf.format(a.columns.length)} columns`);
  info("B (after)", `${b.name} · ${nf.format(rows.b)} rows × ${nf.format(b.columns.length)} columns`);
  const keyNames = keyColumns.map((index) => a.columns[index]?.name ?? "?");
  info("Matched on", report.mode === "key" ? `key ${keyNames.join(" + ")}` : report.mode === "position" ? "row position (row n of A against row n of B)" : "whole rows (no key)");
  if (meta.autoPaired !== null) info("Key pairing", `${meta.autoPaired.a} in A was paired with ${meta.autoPaired.b} in B automatically: ${(meta.autoPaired.overlap * 100).toFixed(1).replace(/\.0$/, "")}% of their values match.`);
  const rules = meta.rules;
  const tolerance = [rules.numberAbs > 0 ? `±${num.format(rules.numberAbs)}` : "", rules.numberRel > 0 ? `±${num.format(rules.numberRel * 100)}%` : ""].filter((t) => t !== "");
  info(
    "Ignored when comparing",
    `case: ${rules.ignoreCase ? "ignored" : "matters"} · extra spaces: ${rules.trimSpaces ? "ignored" : "matter"} · numbers: ${tolerance.length === 0 ? "must be exactly equal" : `equal within ${tolerance.join(" or ")}`} · two empty cells: ${rules.emptyEqualsEmpty ? "equal" : "a change"}`,
  );
  info("Run", meta.description);

  // Count tiles: a label, a big number and a line under it, each in its own colour.
  blank();
  const tiles = [
    { title: "Identical", n: rows.identical, sub: `${percent(rows.identical, rows.matched)} of matched rows`, fill: P.greyFill, ink: P.ink, link: null },
    { title: "~ Changed", n: rows.changed, sub: `${percent(rows.changed, rows.matched)} of matched rows`, fill: P.amberStrong, ink: P.amberInk, link: names.differences },
    { title: "− Only in A", n: rows.onlyA, sub: "removed: not in B", fill: P.redStrong, ink: "7F1D1D", link: names.onlyA },
    { title: "+ Only in B", n: rows.onlyB, sub: "added: not in A", fill: P.greenStrong, ink: "14532D", link: names.onlyB },
  ];
  const top = r + 1;
  const tileRow = (cellOf: (t: (typeof tiles)[number]) => XCell, spec: (t: (typeof tiles)[number]) => StyleSpec, height: number): number => {
    const cells: XCell[] = [];
    const styles: number[] = [];
    for (const t of tiles) {
      cells.push(cellOf(t), null);
      const s = style({ ...spec(t), fill: t.fill, color: t.ink, align: "center", valign: "center" });
      styles.push(s, s);
    }
    return line(cells, styles, height);
  };
  tileRow((t) => t.title, () => ({ bold: true, size: 12 }), 22);
  tileRow((t) => t.n, () => ({ bold: true, size: 28, numFmt: "#,##0" }), 42);
  tileRow((t) => t.sub, () => ({ size: 10 }), 18);
  for (let t = 0; t < 4; t++) for (let row = top; row < top + 3; row++) merges.push(`${columnLetters(t * 2)}${row}:${columnLetters(t * 2 + 1)}${row}`);
  tiles.forEach((t, i) => {
    if (t.link !== null) links.push({ ref: `${columnLetters(i * 2)}${top}`, sheet: t.link, tip: `Go to ${t.link}` });
  });

  // Warnings and notes, in amber.
  const warnings: string[] = [];
  for (const [side, d, e] of [["A", report.duplicateKeys.a, report.emptyKeys.a], ["B", report.duplicateKeys.b, report.emptyKeys.b]] as const) {
    if (d > 0) warnings.push(`Warning: ${nf.format(d)} rows in ${side} repeat a key; repeats pair in file order, so check the key before trusting the numbers.`);
    if (e > 0) warnings.push(`Warning: ${nf.format(e)} rows in ${side} have no key, so they cannot be matched.`);
  }
  if (facts.diffRoom.cut) warnings.push(`Note: the Differences sheet lists the first ${nf.format(facts.diffRoom.rows)} of ${nf.format(facts.total)} rows that differ, because a sheet cannot hold more. The rest are left out.`);
  if (facts.changeCut) warnings.push(`Note: the Changed cells sheet lists the first ${nf.format(facts.changeRows)} of ${nf.format(facts.cellTotal)} changed cells. The rest are left out.`);
  if (facts.onlyARoom.cut) warnings.push(`Note: the Only in A sheet lists the first ${nf.format(facts.onlyARoom.rows)} of ${nf.format(rows.onlyA)} rows. The rest are left out.`);
  if (facts.onlyBRoom.cut) warnings.push(`Note: the Only in B sheet lists the first ${nf.format(facts.onlyBRoom.rows)} of ${nf.format(rows.onlyB)} rows. The rest are left out.`);
  if (warnings.length > 0) {
    blank();
    for (const text of warnings) {
      const at = line([text, null, null, null, null, null, null, null], style({ bold: true, fill: P.amberFill, color: P.amberInk, wrap: true, valign: "center", border: { left: { style: "medium", color: "F59E0B" } } }), 15 * Math.max(1, Math.ceil(text.length / 120)) + 4);
      merges.push(`A${at}:H${at}`);
    }
  }

  // Columns that were added, removed, renamed or retyped.
  section("Columns");
  const kinds: [string, string, StyleSpec][] = [
    ...report.columns.added.map((n): [string, string, StyleSpec] => ["Added", n, { fill: P.greenStrong, color: "14532D" }]),
    ...report.columns.removed.map((n): [string, string, StyleSpec] => ["Removed", n, { fill: P.redStrong, color: "7F1D1D" }]),
    ...report.columns.renamed.map((p): [string, string, StyleSpec] => ["Renamed", `${p.a} → ${p.b}`, { fill: P.blueFill, color: P.blueInk }]),
    ...report.columns.retyped.map((c): [string, string, StyleSpec] => ["Retyped", `${c.name}: ${TYPE_LABELS[c.a]} → ${TYPE_LABELS[c.b]}`, { fill: P.amberStrong, color: P.amberInk }]),
    ...report.columns.ignored.map((p): [string, string, StyleSpec] => ["Ignored", p.a !== "" && p.b !== "" && p.a !== p.b ? `${p.a} → ${p.b}` : p.a || p.b, { fill: P.greyFill, color: P.ink }]),
  ];
  if (kinds.length === 0) wide("The same columns, with the same types, on both sides.", { color: P.dim, italic: true });
  for (const [what, text, spec] of kinds) {
    const at = line([what, text, null, null, null, null, null, null], [style({ ...spec, bold: true, align: "center" }), 0, 0, 0, 0, 0, 0, 0]);
    merges.push(`B${at}:H${at}`);
  }

  // The totals check.
  const totals = report.totals.filter((t) => !keySet.has(t.pair) && !looksLikeIdName(t.name));
  section("Totals check (sum of each number column)");
  if (totals.length === 0) wide("No number column appears on both sides.", { color: P.dim, italic: true });
  else {
    const head = headerStyle(book, P.greyFill, P.ink);
    line(["Column", "A, all rows", "B, all rows", "B − A", "B − A %", "A, matched rows", "B, matched rows", "B − A, matched"], head, 32);
    const money = style({ numFmt: "#,##0.00" });
    const sign = (v: number): number => style({ numFmt: "+#,##0.00;-#,##0.00;0.00", bold: v !== 0, color: v > 0 ? P.greenInk : v < 0 ? P.negative : P.dim });
    const pct = style({ numFmt: SIGNED_PCT });
    for (const t of totals) {
      const diff = round12(t.b.sum - t.a.sum);
      const matched = round12(t.matched.b - t.matched.a);
      line([t.name, round12(t.a.sum), round12(t.b.sum), diff, t.a.sum === 0 ? null : round12((t.b.sum - t.a.sum) / Math.abs(t.a.sum)), round12(t.matched.a), round12(t.matched.b), matched], [style({ bold: true }), money, money, sign(diff), pct, money, money, sign(matched)]);
    }
  }

  // Changes by column.
  section("Changes by column");
  if (report.mode === "content") wide("Rows were matched on their whole content, so a changed row counts as one removed and one added.", { color: P.dim, italic: true });
  else if (report.changes.length === 0) wide("No matched row changed.", { color: P.dim, italic: true });
  else {
    const head = headerStyle(book, P.greyFill, P.ink);
    const headAt = line(["Column", "Rows changed", "Share of matched", "Most common changes (before → after)", null, null, null, null], head, 22);
    merges.push(`D${headAt}:H${headAt}`);
    const count = style({ numFmt: "#,##0" });
    const share = style({ numFmt: "0.0%" });
    const text = style({ wrap: true, valign: "center" });
    const first = r + 1;
    const shown = (v: string): string => (v === "" ? "(empty)" : v);
    for (const change of report.changes) {
      const common = change.top.slice(0, 3).map((p) => `${shown(p.from)} → ${shown(p.to)} ×${nf.format(p.count)}`).join("; ");
      const at = line([change.name, change.changed, rows.matched === 0 ? null : round12(change.changed / rows.matched), common, null, null, null, null], [style({ bold: true }), count, share, text, text, text, text, text], common.length > 80 ? 30 : 18);
      merges.push(`D${at}:H${at}`);
    }
    dataBarRange = `B${first}:B${r}`;
  }

  // Legend.
  section("Colour legend");
  const legend: [StyleSpec, XCell, string][] = [
    [{ bold: true, fill: P.amberStrong, color: P.amberInk }, "~ changed", "The row is in both A and B and at least one value differs."],
    [{ fill: P.redFill, color: P.redInk }, "value in A", "A cell that changed: the value in A (before). On an only-in-A row, the whole A side."],
    [{ fill: P.greenFill, color: P.greenInk }, "value in B", "A cell that changed: the value in B (after). On an only-in-B row, the whole B side."],
    [{ color: P.dim }, "unchanged", "A value on a changed row that did not change (grey, no fill)."],
    [{ hatch: { fg: P.hatch, bg: P.greyTint } }, "", "Hatched: this side has no row."],
    [{ fill: P.blueTint, bold: true, color: P.greenInk, numFmt: SIGNED_INT }, 5, "Δ (B − A) of a number, green when it went up."],
    [{ fill: P.blueTint, bold: true, color: P.negative, numFmt: SIGNED_INT }, -5, "Δ (B − A) of a number, red when it went down."],
  ];
  for (const [spec, sample, text] of legend) {
    const at = line([sample, text, null, null, null, null, null, null], [style({ ...spec, align: "center" }), 0, 0, 0, 0, 0, 0, 0]);
    merges.push(`B${at}:H${at}`);
  }

  sheet.end({ merges, links, dataBars: dataBarRange === "" ? [] : [{ ref: dataBarRange, color: "F59E0B" }] });
}

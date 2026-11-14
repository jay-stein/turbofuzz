import { pairFamily } from "./values.js";
import type { ColumnPairing, CompareSide, MatchResult } from "./types.js";

/** What a Value differences cell shows for a matched row: the numbers of A and B combined. */
export type DiffOp = "sub" | "rsub" | "pct" | "ratio" | "abs";

export const DIFF_OPS: { op: DiffOp; label: string; hint: string }[] = [
  { op: "sub", label: "B − A", hint: "How much each value went up (+) or down (−)" },
  { op: "rsub", label: "A − B", hint: "The same, the other way round" },
  { op: "pct", label: "% change (B vs A)", hint: "(B − A) ÷ |A|, as a percentage; blank where A is 0" },
  { op: "ratio", label: "Ratio (B ÷ A)", hint: "1 means unchanged; blank where A is 0" },
  { op: "abs", label: "Size of change |B − A|", hint: "How far apart, ignoring direction" },
];

/** The value where a colour scale is neutral: 0, or 1 for a ratio. */
export function diffCenter(op: DiffOp): number {
  return op === "ratio" ? 1 : 0;
}

/** Applies an operation to one cell's A and B values; NaN when it is undefined (a missing value, or dividing by zero). */
export function diffValue(op: DiffOp, a: number, b: number): number {
  if (!(a === a) || !(b === b)) return NaN;
  switch (op) {
    case "sub":
      return b - a;
    case "rsub":
      return a - b;
    case "abs":
      return Math.abs(b - a);
    case "pct":
      return a === 0 ? (b === 0 ? 0 : NaN) : ((b - a) / Math.abs(a)) * 100;
    case "ratio":
      return a === 0 ? (b === 0 ? 1 : NaN) : b / a;
  }
}

/** A column pair whose values can be combined: both sides hold numbers. */
export interface DiffColumn {
  /** Index into pairing.pairs. */
  pair: number;
  name: string;
}

export function diffColumns(a: CompareSide, b: CompareSide, pairing: ColumnPairing): DiffColumn[] {
  const out: DiffColumn[] = [];
  pairing.pairs.forEach((pair, index) => {
    const ca = a.columns[pair.a]!;
    const cb = b.columns[pair.b]!;
    if (pairFamily(ca, cb) === "number") out.push({ pair: index, name: cb.name });
  });
  return out;
}

/** How one column's differences are spread, for the colour scale and the header. */
export interface DiffSummary {
  pair: number;
  /** Rows with a value on both sides. */
  n: number;
  mean: number;
  min: number;
  max: number;
  /** How far from the centre the colour scale reaches: the 95th percentile of the distances, so one outlier does not wash out the rest. */
  reach: number;
}

const SAMPLE = 50_000;

/** Summaries over every matched row, one pass per column; the percentile comes from an even sample. */
export function summariseDiffs(a: CompareSide, b: CompareSide, pairing: ColumnPairing, columns: readonly DiffColumn[], positions: Int32Array, match: MatchResult, op: DiffOp): DiffSummary[] {
  const centre = diffCenter(op);
  const stride = Math.max(1, Math.ceil(positions.length / SAMPLE));
  return columns.map((column) => {
    const pair = pairing.pairs[column.pair]!;
    const x = a.columns[pair.a]!.numbers();
    const y = b.columns[pair.b]!.numbers();
    let n = 0;
    let sum = 0;
    let min = Infinity;
    let max = -Infinity;
    const sample: number[] = [];
    for (let i = 0; i < positions.length; i++) {
      const at = positions[i]!;
      const v = diffValue(op, x[match.aRow[at]!]!, y[match.bRow[at]!]!);
      if (!(v === v)) continue;
      n++;
      sum += v;
      if (v < min) min = v;
      if (v > max) max = v;
      if (i % stride === 0) sample.push(Math.abs(v - centre));
    }
    sample.sort((p, q) => p - q);
    const p95 = sample.length === 0 ? 0 : sample[Math.min(sample.length - 1, Math.floor(sample.length * 0.95))]!;
    const reach = p95 > 0 ? p95 : n === 0 ? 0 : Math.max(Math.abs(min - centre), Math.abs(max - centre));
    return { pair: column.pair, n, mean: n === 0 ? NaN : sum / n, min: n === 0 ? NaN : min, max: n === 0 ? NaN : max, reach };
  });
}

/** A window of matched rows: a label for each, and the differences row by row, column by column (NaN where undefined). */
export interface DiffWindow {
  start: number;
  total: number;
  labels: string[];
  values: Float64Array;
}

/** What names a row: its key values (key matching), else its row number in A. */
export function rowLabel(a: CompareSide, pairing: ColumnPairing, keyPairs: readonly number[], aRow: number): string {
  if (keyPairs.length === 0) return `Row ${aRow + 1}`;
  return keyPairs.map((index) => a.columns[pairing.pairs[index]!.a]!.raw[aRow] ?? "").join(" · ");
}

export function diffWindow(
  a: CompareSide,
  b: CompareSide,
  pairing: ColumnPairing,
  match: MatchResult,
  columns: readonly DiffColumn[],
  keyPairs: readonly number[],
  positions: Int32Array,
  start: number,
  end: number,
  op: DiffOp,
): DiffWindow {
  const from = Math.max(0, Math.min(start, positions.length));
  const to = Math.max(from, Math.min(end, positions.length));
  const width = columns.length;
  const values = new Float64Array((to - from) * width);
  const labels: string[] = [];
  const numbers = columns.map((column) => {
    const pair = pairing.pairs[column.pair]!;
    return { x: a.columns[pair.a]!.numbers(), y: b.columns[pair.b]!.numbers() };
  });
  for (let i = from; i < to; i++) {
    const at = positions[i]!;
    const ar = match.aRow[at]!;
    const br = match.bRow[at]!;
    labels.push(rowLabel(a, pairing, keyPairs, ar));
    for (let c = 0; c < width; c++) values[(i - from) * width + c] = diffValue(op, numbers[c]!.x[ar]!, numbers[c]!.y[br]!);
  }
  return { start: from, total: positions.length, labels, values };
}

/** The number column with the most changed rows (an index into pairing.pairs), the first on a tie; null when no number column changed. */
export function mostChangedColumn(columns: readonly DiffColumn[], match: MatchResult): number | null {
  let best: number | null = null;
  let most = 0;
  for (const column of columns) {
    const count = match.changed[column.pair]!.count();
    if (count > most) {
      most = count;
      best = column.pair;
    }
  }
  return best;
}

/**
 * The positions ordered by the size of one column's difference (its distance from the neutral value,
 * so a fall counts as much as a rise): largest first, or smallest first. Rows with no difference
 * there (a blank, or dividing by zero) always come last; ties keep their order.
 */
export function sortDiffPositions(
  a: CompareSide,
  b: CompareSide,
  pairing: ColumnPairing,
  match: MatchResult,
  pair: number,
  positions: Int32Array,
  op: DiffOp,
  dir: "desc" | "asc",
): Int32Array {
  const column = pairing.pairs[pair]!;
  const x = a.columns[column.a]!.numbers();
  const y = b.columns[column.b]!.numbers();
  const centre = diffCenter(op);
  const n = positions.length;
  const size = new Float64Array(n);
  let defined = 0;
  const order = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    const at = positions[i]!;
    const v = diffValue(op, x[match.aRow[at]!]!, y[match.bRow[at]!]!);
    if (v === v) {
      size[i] = Math.abs(v - centre);
      order[defined++] = i;
    } else {
      size[i] = NaN;
    }
  }
  // Undefined rows go after the sorted ones, in their own order.
  let tail = defined;
  for (let i = 0; i < n; i++) if (size[i] !== size[i]) order[tail++] = i;
  const sign = dir === "desc" ? -1 : 1;
  order.subarray(0, defined).sort((p, q) => sign * (size[p]! - size[q]!) || p - q);
  const out = new Int32Array(n);
  for (let i = 0; i < n; i++) out[i] = positions[order[i]!]!;
  return out;
}

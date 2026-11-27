/**
 * A line of y against any ordered x, the way seaborn's lineplot draws one: the rows at each x (or in
 * each narrow band of x, when x has too many values to draw one point each) are summarised by a
 * statistic, the average by default, with an interval round it: a 95% confidence interval, a
 * standard error or deviation, or the middle 95% of the rows. A hue column draws one line per value.
 * x may be numbers (spaced by value) or categories (in their natural order).
 */
import { formulaInterval, intervalBlock, type IntervalKind } from "./error-bars.js";

export type RelLineStat = "mean" | "median" | "sum" | "min" | "max" | "count";
export type RelLineBand = Exclude<IntervalKind, "bootstrap"> | "none";

/** Up to this many distinct x values are each a point; more are gathered into RELLINE_BINS bands of x. */
export const RELLINE_EXACT = 200;
export const RELLINE_BINS = 80;

/**
 * A Line's x as "Row order": each value in the order the table holds it, numbered like the table's
 * rows, the way Excel draws a line of one column. No date or index column is needed.
 */
export const ROW_ORDER = -2;
/** In row order every row is its own point up to this many; a longer column is drawn in ROW_ORDER_BINS stretches. */
export const ROW_ORDER_EXACT = 5000;
export const ROW_ORDER_BINS = 1000;

export interface RelLineInput {
  ids: ArrayLike<number>;
  /** x for each row: a number, or for categorical x the category's code (NaN where missing). */
  x: ArrayLike<number>;
  /** Categorical x: the labels the codes index, put in natural order for the axis. */
  xLabels: readonly string[] | null;
  /** y for each row; null counts rows. */
  y: ArrayLike<number> | null;
  /** Hue code for each row (0xffff where missing); null for one line. */
  hue: ArrayLike<number> | null;
  hueLabels: readonly string[];
  /** The largest hues by rows get a line; the rest are counted in `hiddenHues`. */
  maxHues: number;
  stat: RelLineStat;
  band: RelLineBand;
  /** Distinct x values drawn one point each before x is gathered into `bins` bands (RELLINE_EXACT, RELLINE_BINS by default). */
  exact?: number;
  bins?: number;
}

export interface RelLineSeries {
  label: string;
  /** The hue's code, -1 for the single line. */
  code: number;
  center: Float64Array;
  low: Float64Array;
  high: Float64Array;
  n: Uint32Array;
}

export interface RelLineResult {
  /** Point positions: x values (ascending) for numeric x, 0..k-1 for categorical x. */
  xs: Float64Array;
  /** Categorical x: the label at each position. */
  xLabels: string[] | null;
  /** Numeric x gathered into bands: each point is the average x of its band. */
  binned: boolean;
  series: RelLineSeries[];
  hiddenHues: number;
  /** Rows with both an x and (when asked) a y. */
  rows: number;
  /** Why there is no band, when one was asked for and cannot be drawn. */
  bandBlock: string | null;
  /** Points whose confidence band was kept within the range of their rows (few rows). */
  narrowed: number;
}

export function computeRelLine(input: RelLineInput): RelLineResult {
  const { ids, x, y, hue } = input;
  const statName = input.stat === "count" ? "sum" : input.stat;
  const bandBlock =
    input.band === "none" ? null : input.stat === "count" || y === null ? "Counts have no interval: choose a Value and Average" : intervalBlock(input.band, statName);
  const band: RelLineBand = bandBlock === null ? input.band : "none";

  // Which hues get a line: the largest by rows.
  let hues: number[] = [-1];
  let hiddenHues = 0;
  if (hue !== null) {
    const counts = new Map<number, number>();
    for (let i = 0; i < ids.length; i++) {
      const code = hue[ids[i]!]!;
      if (code !== 0xffff) counts.set(code, (counts.get(code) ?? 0) + 1);
    }
    const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]).map(([code]) => code);
    hues = ranked.slice(0, input.maxHues).sort((a, b) => naturalCompare(input.hueLabels[a] ?? "", input.hueLabels[b] ?? ""));
    hiddenHues = Math.max(0, ranked.length - hues.length);
  }
  const hueSlot = new Map(hues.map((code, slot) => [code, slot]));

  // The x positions.
  let positions: number[];
  let keyOf: (value: number) => number;
  let xLabels: string[] | null = null;
  let binned = false;
  if (input.xLabels !== null) {
    const present = new Set<number>();
    for (let i = 0; i < ids.length; i++) {
      const code = x[ids[i]!]!;
      if (Number.isFinite(code)) present.add(code);
    }
    const labels = input.xLabels;
    const order = [...present].sort((a, b) => naturalCompare(labels[a] ?? "", labels[b] ?? ""));
    const slot = new Map(order.map((code, index) => [code, index]));
    positions = order.map((_, index) => index);
    xLabels = order.map((code) => labels[code] ?? "");
    keyOf = (value) => slot.get(value) ?? -1;
  } else {
    const exact = input.exact ?? RELLINE_EXACT;
    const bins = input.bins ?? RELLINE_BINS;
    const distinct = new Set<number>();
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < ids.length; i++) {
      const value = x[ids[i]!]!;
      if (!Number.isFinite(value)) continue;
      if (distinct.size <= exact) distinct.add(value);
      if (value < min) min = value;
      if (value > max) max = value;
    }
    if (distinct.size <= exact) {
      positions = [...distinct].sort((a, b) => a - b);
      const slot = new Map(positions.map((value, index) => [value, index]));
      keyOf = (value) => slot.get(value) ?? -1;
    } else {
      binned = true;
      const width = (max - min) / bins;
      positions = Array.from({ length: bins }, () => 0);
      keyOf = (value) => (Number.isFinite(value) ? Math.min(bins - 1, Math.floor((value - min) / width)) : -1);
    }
  }

  // Every row's y, by (hue, x).
  const k = positions.length;
  const cells: number[][] = Array.from({ length: hues.length * k }, () => []);
  const xSum = binned ? new Float64Array(k) : null;
  const xCount = binned ? new Uint32Array(k) : null;
  let rows = 0;
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i]!;
    const xv = x[id]!;
    const key = keyOf(xv);
    if (key < 0) continue;
    const yv = y === null ? 1 : y[id]!;
    if (!Number.isFinite(yv)) continue;
    const slot = hue === null ? 0 : hueSlot.get(hue[id]!);
    if (slot === undefined) continue;
    cells[slot * k + key]!.push(yv);
    rows++;
    if (xSum !== null && xCount !== null) {
      xSum[key] += xv;
      xCount[key]++;
    }
  }

  let xs = Float64Array.from(positions);
  let keep: number[] | null = null;
  if (xSum !== null && xCount !== null) {
    // A band's point sits at the average x of its rows; empty bands are dropped.
    keep = [];
    for (let key = 0; key < k; key++) if (xCount[key]! > 0) keep.push(key);
    xs = Float64Array.from(keep, (key) => xSum[key]! / xCount[key]!);
  }
  const columns = keep ?? positions.map((_, index) => index);
  let narrowed = 0;
  const series: RelLineSeries[] = hues.map((code, slot) => {
    const center = new Float64Array(columns.length).fill(Number.NaN);
    const low = new Float64Array(columns.length).fill(Number.NaN);
    const high = new Float64Array(columns.length).fill(Number.NaN);
    const n = new Uint32Array(columns.length);
    columns.forEach((key, at) => {
      const values = cells[slot * k + key]!;
      if (values.length === 0) return;
      n[at] = values.length;
      center[at] = summarise(values, input.stat, y === null);
      if (band !== "none") {
        const interval = formulaInterval(Float64Array.from(values), band, statName);
        low[at] = interval.low;
        high[at] = interval.high;
        // Few rows make a t-interval wider than the rows themselves (t is 12.7 at two). A bootstrap
        // interval, seaborn's, never leaves them: keep a confidence band within the rows' range.
        if (band === "ci" && Number.isFinite(interval.low)) {
          let lowest = Infinity;
          let highest = -Infinity;
          for (const value of values) {
            if (value < lowest) lowest = value;
            if (value > highest) highest = value;
          }
          if (interval.low < lowest || interval.high > highest) {
            low[at] = Math.max(interval.low, lowest);
            high[at] = Math.min(interval.high, highest);
            narrowed++;
          }
        }
      }
    });
    return { label: code < 0 ? "" : (input.hueLabels[code] ?? ""), code, center, low, high, n };
  });
  return { xs, xLabels, binned, series, hiddenHues, rows, bandBlock, narrowed };
}

function summarise(values: number[], stat: RelLineStat, counting: boolean): number {
  if (counting || stat === "count") return values.length;
  switch (stat) {
    case "sum":
      return values.reduce((a, b) => a + b, 0);
    case "min":
      return values.reduce((a, b) => Math.min(a, b), Infinity);
    case "max":
      return values.reduce((a, b) => Math.max(a, b), -Infinity);
    case "median": {
      const sorted = [...values].sort((a, b) => a - b);
      const mid = sorted.length >> 1;
      return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
    }
    default:
      return values.reduce((a, b) => a + b, 0) / values.length;
  }
}

/** "Stage 2" before "Stage 10", "1" before "2": labels in the order a reader expects. */
function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

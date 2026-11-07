/**
 * The shape of the rows behind a series, before any aggregation: how often a moment
 * holds more than one row (several series interleaved: one row per store, car park or
 * sensor), which column tells those rows apart, and how regular the spacing of the
 * moments is. Decomposition and forecasting need one value per period, so a series made
 * of several must be said out loud, not summed or averaged silently.
 */

import { DAY } from "./base.js";

/** A category column the page could split by, coded per row of the series input. */
export interface ShapeCandidate {
  column: number;
  name: string;
  /** Category code per row (aligned with the times); -1 for empty. */
  codes: Int32Array;
  /** True when every value is a number (a quantity or a numeric code), which names a series less often than text. */
  numeric?: boolean;
}

/** A column with its values named, for suggesting which one to pick a single series by. */
export interface EntityCandidate extends ShapeCandidate {
  /** The value behind each code. */
  labels: string[];
}

/** A column that probably names the series in the rows, with its largest values. */
export interface SeriesSuggestion {
  column: number;
  name: string;
  /** Distinct values among the rows. */
  distinct: number;
  /** Share of rows whose value appears at 24 or more moments, so its rows can make a series of their own. */
  coverage: number;
  /** True when every value is a number: a quantity or code, offered only after the text columns. */
  numeric: boolean;
  /** True when each value runs across most of the dates with a similar number of rows, as parallel series do. */
  sound: boolean;
  /** Largest values first. */
  values: { label: string; rows: number; moments: number }[];
}

export interface SeriesKey {
  column: number;
  name: string;
  /** Distinct values among the rows of repeated moments. */
  distinct: number;
  /** Share of repeated moments where every row has a different value. */
  coverage: number;
}

export interface SeriesSpacing {
  /** Typical gap between consecutive moments, in milliseconds. */
  typicalMs: number;
  /** Share of gaps equal to the typical gap. */
  onBeat: number;
  /** Share of gaps that are a whole number of typical gaps (missing periods, not jitter). */
  onGrid: number;
  p10Ms: number;
  p90Ms: number;
  kind: "regular" | "gaps" | "irregular";
}

export interface SeriesShape {
  rows: number;
  /** Distinct moments (timestamps) among the rows. */
  moments: number;
  /** Median rows per moment: 1 means one series. */
  typical: number;
  /** Most rows at one moment. */
  most: number;
  /** Share of moments holding more than one row. */
  repeatShare: number;
  /** Columns that explain the repeats, best first. */
  keys: SeriesKey[];
  /** Columns to pick one series by, best first (a few at most), when the rows mix several. */
  suggest: SeriesSuggestion[];
  spacing: SeriesSpacing | null;
}

/** A value needs this many moments of its own before its rows read as a series. */
const MIN_MOMENTS = 24;

/** Rows needed before "this column changes slowly along time" can be judged. */
const MIN_SLOW_ROWS = 60;
/**
 * Agreement of neighbouring rows beyond chance (Cohen's kappa) above which a column says when,
 * not which series: a weekday, a month, an hour, a holiday or semester flag. A column that names
 * series (a store, a station) sits near zero or below, however skewed its values are.
 */
const SLOW_KAPPA = 0.5;

/** Fewest distinct values that read as "several series" rather than a flag; a handful. */
const HANDFUL = 3;
/** A value runs across the dates when its first and last moments are at least this share of the whole range apart. */
const SPREAD_SPAN = 0.5;
/** Share of rows that must sit in such values, and the smallest value's rows relative to an even split, for the series to read as parallel. */
const SOUND_SPREAD = 0.8;
const SOUND_BALANCE = 0.25;

/** Repeated moments checked per column; a long table is sampled evenly. */
const MAX_RUNS = 5000;
/** A column explains the repeats when it differs within this share of repeated moments. */
const KEY_COVERAGE = 0.95;

/**
 * Reads the shape of the rows `keep` selects (all rows when null). `times` are UTC
 * milliseconds per row; candidates are category columns coded per row.
 */
export function seriesShape(times: Float64Array, keep: Uint8Array | null, candidates: readonly ShapeCandidate[], entities: readonly EntityCandidate[] = []): SeriesShape {
  const idx: number[] = [];
  for (let i = 0; i < times.length; i++) if ((keep === null || keep[i]) && Number.isFinite(times[i])) idx.push(i);
  idx.sort((a, b) => times[a] - times[b]);

  // Runs of rows at the same moment.
  const runs: [number, number][] = [];
  const sizes: number[] = [];
  const moments: number[] = [];
  for (let a = 0; a < idx.length; ) {
    let b = a + 1;
    while (b < idx.length && times[idx[b]] === times[idx[a]]) b++;
    sizes.push(b - a);
    moments.push(times[idx[a]]);
    if (b - a > 1) runs.push([a, b]);
    a = b;
  }
  const sorted = [...sizes].sort((x, y) => x - y);
  const typical = sorted.length ? sorted[sorted.length >> 1] : 0;
  const most = sorted.length ? sorted[sorted.length - 1] : 0;

  const keys: SeriesKey[] = [];
  if (runs.length) {
    const step = Math.max(1, Math.ceil(runs.length / MAX_RUNS));
    for (const cand of candidates) {
      const seen = new Map<number, number>();
      const values = new Set<number>();
      let checked = 0, distinctRuns = 0, failed = 0;
      for (let r = 0; r < runs.length; r += step) {
        const [a, b] = runs[r];
        checked++;
        let ok = true;
        for (let k = a; k < b; k++) {
          const code = cand.codes[idx[k]];
          values.add(code);
          if (code < 0 || seen.get(code) === r) ok = false;
          seen.set(code, r);
        }
        if (ok) distinctRuns++;
        else if (++failed > checked * (1 - KEY_COVERAGE) + 5) break;
      }
      const coverage = checked ? distinctRuns / checked : 0;
      if (coverage >= KEY_COVERAGE) keys.push({ column: cand.column, name: cand.name, distinct: values.size, coverage });
    }
    // Text before numeric codes, then fewest values first: the column that names the series, not a row id.
    const numeric = new Set(candidates.filter((cand) => cand.numeric).map((cand) => cand.column));
    keys.sort((x, y) => Number(numeric.has(x.column)) - Number(numeric.has(y.column)) || x.distinct - y.distinct || y.coverage - x.coverage);
  }

  return {
    rows: idx.length,
    moments: moments.length,
    typical,
    most,
    repeatShare: moments.length ? runs.length / moments.length : 0,
    keys,
    suggest: suggestSeries(times, idx, entities),
    spacing: spacingOf(moments),
  };
}

/**
 * Whether a column keeps its value from one row to the next, in time order, far more often than its value mix would by chance.
 * Calendar columns (day_of_week, month, hour, is_weekend, is_holiday, semester flags) do; so does anything else that describes
 * the moment. Rows of different series interleave, so a column that names them does not.
 */
export function changesSlowly(codes: ArrayLike<number>, idx: readonly number[], values: number): boolean {
  if (idx.length < MIN_SLOW_ROWS) return false;
  const rows = new Float64Array(values);
  let total = 0, pairs = 0, same = 0, prev = -1;
  for (let k = 0; k < idx.length; k++) {
    const code = codes[idx[k]];
    if (code < 0 || code >= values) { prev = -1; continue; }
    rows[code]++; total++;
    if (prev >= 0) { pairs++; if (code === prev) same++; }
    prev = code;
  }
  if (pairs === 0) return false;
  let chance = 0;
  for (let c = 0; c < values; c++) chance += (rows[c] / total) ** 2;
  if (!(chance < 1)) return false;
  return (same / pairs - chance) / (1 - chance) >= SLOW_KAPPA;
}

/**
 * Which columns could name the series: for each candidate, how many rows sit in values seen at enough moments to make a series
 * of their own. Columns with a handful or more of such values come first (a station or a store, not a two-way flag), the one
 * with fewer values first among those; a few at most, each with its largest values. A column that changes slowly along time
 * (the weekday, the month, an hour, a holiday flag) describes the moment, not a series, and is left out.
 */
const DATE_PART_LABELS = new Set([
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday", "mon", "tue", "tues", "wed", "thu", "thur", "thurs", "fri", "sat", "sun",
  "january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december",
  "jan", "feb", "mar", "apr", "jun", "jul", "aug", "sep", "sept", "oct", "nov", "dec",
]);

/** A column whose values are all weekday or month names describes the moment, not a series, wherever it sits. */
function namesADatePart(labels: readonly string[]): boolean {
  const named = labels.map((l) => l.trim().toLowerCase()).filter((l) => l !== "");
  return named.length > 0 && named.every((l) => DATE_PART_LABELS.has(l));
}

export function suggestSeries(times: Float64Array, idx: readonly number[], entities: readonly EntityCandidate[]): SeriesSuggestion[] {
  if (entities.length === 0 || idx.length === 0) return [];
  const momentOf = new Int32Array(idx.length);
  let id = -1, prev = Number.NaN;
  for (let k = 0; k < idx.length; k++) {
    const t = times[idx[k]];
    if (t !== prev) { id++; prev = t; }
    momentOf[k] = id;
  }
  const out: SeriesSuggestion[] = [];
  for (const cand of entities) {
    if (namesADatePart(cand.labels)) continue;
    const n = cand.labels.length;
    const rows = new Uint32Array(n), moments = new Uint32Array(n), last = new Int32Array(n).fill(-1), first = new Int32Array(n).fill(-1);
    for (let k = 0; k < idx.length; k++) {
      const code = cand.codes[idx[k]];
      if (code < 0 || code >= n) continue;
      rows[code]++;
      if (first[code] < 0) first[code] = momentOf[k];
      if (last[code] !== momentOf[k]) { last[code] = momentOf[k]; moments[code]++; }
    }
    const span = Math.max(1, id);
    let total = 0, covered = 0, distinct = 0, spread = 0, least = Infinity;
    for (let c = 0; c < n; c++) {
      if (rows[c] === 0) continue;
      distinct++; total += rows[c];
      if (moments[c] >= MIN_MOMENTS) covered += rows[c];
      if ((last[c] - first[c]) / span >= SPREAD_SPAN) spread += rows[c];
      least = Math.min(least, rows[c]);
    }
    if (total === 0 || distinct < 2 || covered / total < 0.5) continue;
    // Whether the values read as parallel series: each runs across most of the dates, with a similar number of rows.
    const sound = spread / total >= SOUND_SPREAD && least / (total / distinct) >= SOUND_BALANCE;
    if (changesSlowly(cand.codes, idx, n)) continue;
    const order: number[] = [];
    for (let c = 0; c < n; c++) if (rows[c] > 0) order.push(c);
    order.sort((a, b) => rows[b] - rows[a]);
    out.push({
      column: cand.column, name: cand.name, distinct, coverage: covered / total, numeric: cand.numeric === true, sound,
      values: order.slice(0, 8).map((c) => ({ label: cand.labels[c], rows: rows[c], moments: moments[c] })),
    });
  }
  out.sort((a, b) =>
    Number(a.numeric) - Number(b.numeric) ||
    Number(b.distinct >= HANDFUL) - Number(a.distinct >= HANDFUL) ||
    Number(b.sound) - Number(a.sound) ||
    a.distinct - b.distinct ||
    b.coverage - a.coverage);
  return out.slice(0, 3);
}

/**
 * Regularity of the moments: the typical gap, and how many gaps sit on it or on a
 * multiple of it. Month and quarter lengths vary, so long gaps get a wider tolerance.
 */
export function spacingOf(moments: readonly number[]): SeriesSpacing | null {
  if (moments.length < 3) return null;
  const gaps: number[] = [];
  for (let k = 1; k < moments.length; k++) gaps.push(moments[k] - moments[k - 1]);
  gaps.sort((a, b) => a - b);
  const typicalMs = gaps[gaps.length >> 1];
  if (!(typicalMs > 0)) return null;
  const tol = typicalMs >= 27 * DAY ? 0.1 : 0.02;
  let onBeat = 0, onGrid = 0;
  for (const gap of gaps) {
    const ratio = gap / typicalMs;
    const whole = Math.round(ratio);
    if (Math.abs(ratio - 1) <= tol) onBeat++;
    if (whole >= 1 && Math.abs(ratio - whole) <= tol * whole) onGrid++;
  }
  const at = (q: number): number => gaps[Math.min(gaps.length - 1, Math.floor(q * gaps.length))];
  const n = gaps.length;
  const kind = onBeat / n >= 0.9 ? "regular" : onGrid / n >= 0.9 ? "gaps" : "irregular";
  return { typicalMs, onBeat: onBeat / n, onGrid: onGrid / n, p10Ms: at(0.1), p90Ms: at(0.9), kind };
}

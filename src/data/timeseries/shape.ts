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
  spacing: SeriesSpacing | null;
}

/** Repeated moments checked per column; a long table is sampled evenly. */
const MAX_RUNS = 5000;
/** A column explains the repeats when it differs within this share of repeated moments. */
const KEY_COVERAGE = 0.95;

/**
 * Reads the shape of the rows `keep` selects (all rows when null). `times` are UTC
 * milliseconds per row; candidates are category columns coded per row.
 */
export function seriesShape(times: Float64Array, keep: Uint8Array | null, candidates: readonly ShapeCandidate[]): SeriesShape {
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
    // Fewest values first: the column that names the series, not a row id.
    keys.sort((x, y) => x.distinct - y.distinct || y.coverage - x.coverage);
  }

  return {
    rows: idx.length,
    moments: moments.length,
    typical,
    most,
    repeatShare: moments.length ? runs.length / moments.length : 0,
    keys,
    spacing: spacingOf(moments),
  };
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

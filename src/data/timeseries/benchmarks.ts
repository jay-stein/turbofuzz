/**
 * The simple forecasting methods every other model has to beat, and the intermittent-demand methods.
 *
 * Benchmarks (Hyndman and Athanasopoulos, Forecasting: Principles and Practice, 3rd ed., 5.2):
 *   - Naive: every forecast is the last value.
 *   - Drift: the last value plus the average change per period over the history (the line through
 *     the first and last points, extended).
 *   - Mean: the average of the whole history.
 *   - SES: simple exponential smoothing, a level that follows recent values (fpp3 8.1); the smoothing
 *     parameter is fitted by maximum likelihood (see ets.ts).
 *
 * Intermittent demand, for a series that is mostly zeros with now and then a sale:
 *   - Croston (1972): the size of a sale and the gap between sales are each smoothed with simple
 *     exponential smoothing, and the forecast is size divided by gap (the demand rate).
 *   - SBA, the Syntetos-Boylan approximation (2005): Croston's rate times (1 - alpha/2), which removes
 *     Croston's upward bias.
 *   - TSB (Teunter, Syntetos and Babai, 2011): smooths the probability that a period has a sale
 *     (updated every period, so it also decays through a long run of zeros) and the size of a sale.
 *   - Classification: an average demand interval above 1.32 is called intermittent (Syntetos, Boylan
 *     and Croston, 2005).
 *
 * Missing periods arrive as NaN: the methods skip them and learn nothing from them.
 * Smoothing parameters are fixed (0.1, the default of R's forecast::croston) rather than tuned: with
 * so few non-zero values per series a tuned parameter would mostly fit noise.
 */

import { fitSes } from "./ets.js";

/** The last observed value in [0, o). */
export function naiveLevel(y: ArrayLike<number>, o: number): number {
  for (let t = o - 1; t >= 0; t--) if (y[t]! === y[t]!) return y[t]!;
  return NaN;
}

/** The average change per period between the first and last observed values in [0, o). */
export function driftSlope(y: ArrayLike<number>, o: number): number {
  let first = -1, last = -1;
  for (let t = 0; t < o; t++) if (y[t]! === y[t]!) { if (first < 0) first = t; last = t; }
  return first >= 0 && last > first ? (y[last]! - y[first]!) / (last - first) : 0;
}

/** The mean of the observed values in [0, o). */
export function meanLevel(y: ArrayLike<number>, o: number): number {
  let s = 0, c = 0;
  for (let t = 0; t < o; t++) if (y[t]! === y[t]!) { s += y[t]!; c++; }
  return c ? s / c : NaN;
}

export const CROSTON_ALPHA = 0.1;

export interface Intermittent {
  /** Smoothed size of a sale (Croston, SBA) and smoothed periods between sales. */
  size: number;
  interval: number;
  /** Smoothed probability that a period has a sale (TSB), and its size. */
  prob: number;
  tsbSize: number;
  /** Periods since the last sale: kept for the page's note. */
  sinceSale: number;
}

/**
 * Fits the intermittent methods on [0, o). Croston and SBA start from the first sale and its
 * wait (the usual start, as in R's forecast::croston); TSB starts from the share of periods with a sale.
 */
export function fitIntermittent(y: ArrayLike<number>, o: number, alpha = CROSTON_ALPHA, beta = CROSTON_ALPHA): Intermittent | null {
  let first = -1;
  for (let t = 0; t < o; t++) if (y[t]! === y[t]! && y[t]! > 0) { first = t; break; }
  if (first < 0) return null;
  let size = y[first]!, interval = first + 1, gap = 1;
  let seen = 0, sales = 0;
  for (let t = 0; t < o; t++) if (y[t]! === y[t]!) { seen++; if (y[t]! > 0) sales++; }
  let prob = sales / Math.max(1, seen), tsbSize = y[first]!;
  let sinceSale = 0;
  for (let t = 0; t < o; t++) {
    const v = y[t]!;
    if (!(v === v)) continue;
    const sale = v > 0;
    if (sale) {
      if (t > first) { size += alpha * (v - size); interval += alpha * (gap - interval); }
      gap = 1; tsbSize += alpha * (v - tsbSize); sinceSale = 0;
    } else { gap++; sinceSale++; }
    prob += beta * ((sale ? 1 : 0) - prob);
  }
  return { size, interval, prob, tsbSize, sinceSale };
}

/** The longest bucket IMAPA adds the history up in: a year of months, and about as many as the gaps between sales are long. */
export const IMAPA_MAX_LEVELS = 12;

/**
 * IMAPA (Petropoulos and Kourentzes 2015), the forecast per period: the history from the first sale is added up in non-overlapping
 * buckets of 1, 2, ... L periods (L is the average gap between sales, at most 12; buckets are counted back from the latest
 * period), each set of bucket totals is smoothed with simple exponential smoothing (fitted, as ADIDA does), the smoothed total is
 * spread back over the periods of a bucket, and the forecasts of all the bucket lengths are averaged. A bucket with a missing
 * period is missing. A length with fewer than three buckets is left out.
 */
export function imapaRate(y: ArrayLike<number>, o: number): number {
  let from = 0;
  while (from < o && !(y[from]! > 0)) from++;
  if (from >= o) return 0;
  const seg = Float64Array.from({ length: o - from }, (_, i) => y[from + i]!);
  const levels = Math.max(1, Math.min(IMAPA_MAX_LEVELS, Math.round(demandProfile(y, o).adi)));
  let sum = 0, count = 0;
  for (let len = 1; len <= levels; len++) {
    const n = Math.floor(seg.length / len), off = seg.length - n * len;
    if (len > 1 && n < 3) continue;
    const totals = new Float64Array(n);
    for (let b = 0; b < n; b++) {
      let s = 0;
      for (let k = 0; k < len; k++) s += seg[off + b * len + k]!;
      totals[b] = s;
    }
    const level = fitSes(len === 1 ? seg : totals, len === 1 ? seg.length : n).level;
    if (level === level) { sum += level / len; count++; }
  }
  return count ? Math.max(0, sum / count) : 0;
}

export const crostonRate = (f: Intermittent): number => f.size / f.interval;
export const sbaRate = (f: Intermittent, alpha = CROSTON_ALPHA): number => (1 - alpha / 2) * (f.size / f.interval);
export const tsbRate = (f: Intermittent): number => f.prob * f.tsbSize;

/** Average demand interval and squared coefficient of variation of the sales, over the observed periods in [0, o). */
export function demandProfile(y: ArrayLike<number>, o: number): { adi: number; cv2: number; zeros: number; sales: number; n: number } {
  let n = 0, sales = 0, sum = 0, sum2 = 0;
  // Periods before the first sale are a product that did not exist yet (or an outbreak not yet begun), not a gap in demand.
  let from = 0;
  while (from < o && !(y[from]! > 0)) from++;
  for (let t = from; t < o; t++) {
    const v = y[t]!;
    if (!(v === v)) continue;
    n++;
    if (v > 0) { sales++; sum += v; sum2 += v * v; }
  }
  const mean = sales ? sum / sales : 0;
  const variance = sales > 1 ? Math.max(0, (sum2 - sales * mean * mean) / (sales - 1)) : 0;
  return { adi: sales ? n / sales : Infinity, cv2: mean > 0 ? variance / (mean * mean) : 0, zeros: n - sales, sales, n };
}

/** The Syntetos-Boylan-Croston cut: demand that comes in fewer than three of every four periods. */
export const ADI_CUT = 1.32;
export function isIntermittent(y: ArrayLike<number>, o: number): boolean {
  let min = Infinity;
  for (let t = 0; t < o; t++) if (y[t]! === y[t]! && y[t]! < min) min = y[t]!;
  if (min < 0) return false;
  const p = demandProfile(y, o);
  return p.n >= 8 && p.sales >= 1 && p.adi > ADI_CUT;
}

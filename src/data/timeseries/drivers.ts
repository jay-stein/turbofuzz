/**
 * Which other columns help predict the series: the driver suggestions.
 *
 * The test is out of sample and cheap. Trend and season are taken out of the series and of each candidate column the same way, so
 * what is left of both is the part neither calendar nor drift explains. Then, walking forward through the second half of the
 * history, the coefficient of "remainder of the series on the candidate's remainder" is fitted on the past only and used to predict
 * the next remainder. The share by which that cuts the root-mean-square error of predicting no remainder at all is what a column
 * earns. A column is offered only when it cuts the error by a real margin in both halves of the test stretch, which keeps one lucky
 * stretch (or one of fifty columns tried) from passing.
 */

export interface DriverHint {
  col: string;
  /** Periods the column leads the series by (0 = the same period; the future value must then be assumed, as every driver rule does). */
  lag: number;
  /** Share of the root-mean-square error removed, 0 to 1. */
  cut: number;
  /** Correlation of the two remainders over the whole history. */
  corr: number;
  /** The remainder moves with the column (+1) or against it (-1). */
  sign: 1 | -1;
}

export interface DriverScan {
  hints: DriverHint[];
  /** Columns that were tested. */
  tested: number;
  /** Columns left out because they look built from the series itself. */
  leaked: string[];
}

/** The smallest cut that is offered, and the most columns tried (the strongest correlations first). */
export const MIN_CUT = 0.08;
const MAX_TESTED = 40;
const MAX_LAG = 2;

/** What is left after a centred moving average (one season wide) and the per-phase mean of the rest. */
export function remainderOf(x: ArrayLike<number>, n: number, m: number): Float64Array {
  const w = m > 1 ? m : 5;
  const half = w >> 1;
  const trend = new Float64Array(n);
  const prefix = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i]! + x[i]!;
  for (let i = 0; i < n; i++) {
    const lo = Math.max(0, i - half), hi = Math.min(n - 1, i + half);
    trend[i] = (prefix[hi + 1]! - prefix[lo]!) / (hi - lo + 1);
  }
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = x[i]! - trend[i]!;
  if (m > 1) {
    const sum = new Float64Array(m), cnt = new Float64Array(m);
    for (let i = 0; i < n; i++) { sum[i % m] = sum[i % m]! + out[i]!; cnt[i % m] = cnt[i % m]! + 1; }
    for (let i = 0; i < n; i++) out[i] = out[i]! - sum[i % m]! / Math.max(1, cnt[i % m]!);
  }
  return out;
}

function corr(a: ArrayLike<number>, b: ArrayLike<number>, lag: number, n: number): number {
  let sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0, c = 0;
  for (let t = lag; t < n; t++) { const p = a[t]!, q = b[t - lag]!; sa += p; sb += q; saa += p * p; sbb += q * q; sab += p * q; c++; }
  if (c < 3) return 0;
  const va = saa - (sa * sa) / c, vb = sbb - (sb * sb) / c;
  return va > 1e-12 && vb > 1e-12 ? (sab - (sa * sb) / c) / Math.sqrt(va * vb) : 0;
}

/**
 * Walk-forward error cut of predicting r[t] by beta * u[t - lag], beta fitted on t' < t. Returns the cut over the test stretch and in
 * each half of it, or null when there is too little to judge.
 */
function walkForward(r: Float64Array, u: Float64Array, lag: number, n: number): { cut: number; halves: [number, number] } | null {
  const first = Math.max(lag + 8, Math.floor(n * 0.5));
  if (n - first < 16) return null;
  let sxy = 0, sxx = 0;
  for (let t = lag; t < first; t++) { sxy += u[t - lag]! * r[t]!; sxx += u[t - lag]! * u[t - lag]!; }
  const mid = first + ((n - first) >> 1);
  const sse = [0, 0], base = [0, 0];
  for (let t = first; t < n; t++) {
    const x = u[t - lag]!, h = t < mid ? 0 : 1;
    const beta = sxx > 1e-12 ? sxy / sxx : 0;
    const e = r[t]! - beta * x;
    sse[h] = sse[h]! + e * e; base[h] = base[h]! + r[t]! * r[t]!;
    sxy += x * r[t]!; sxx += x * x;
  }
  if (!(base[0]! > 0) || !(base[1]! > 0)) return null;
  const cut = (s: number, b: number): number => 1 - Math.sqrt(s / b);
  return { cut: cut(sse[0]! + sse[1]!, base[0]! + base[1]!), halves: [cut(sse[0]!, base[0]!), cut(sse[1]!, base[1]!)] };
}

/**
 * @param y the modelled series, gaps filled
 * @param n its length
 * @param m the main season in periods (1 when none)
 * @param cols candidate columns as per-period means, aligned with y
 * @param skip columns that are not candidates (already drivers, counters of time, the measure)
 */
export function scanDrivers(y: ArrayLike<number>, n: number, m: number, cols: Record<string, ArrayLike<number>>, skip: ReadonlySet<string>): DriverScan {
  const out: DriverScan = { hints: [], tested: 0, leaked: [] };
  if (n < 40) return out;
  const r = remainderOf(y, n, m);
  let rv = 0;
  for (let i = 0; i < n; i++) rv += r[i]! * r[i]!;
  if (!(rv > 1e-12)) return out;
  const cand: { col: string; u: Float64Array; best: number; lag: number }[] = [];
  for (const [col, x] of Object.entries(cols)) {
    if (skip.has(col) || x.length < n) continue;
    let ok = true;
    for (let i = 0; i < n; i++) if (!(x[i]! === x[i]!)) { ok = false; break; }
    if (!ok) continue;
    const u = remainderOf(x, n, m);
    let best = 0, lag = 0;
    for (let l = 0; l <= MAX_LAG; l++) { const c = corr(r, u, l, n); if (Math.abs(c) > Math.abs(best)) { best = c; lag = l; } }
    if (Math.abs(best) < 0.15) { out.tested++; continue; }
    cand.push({ col, u, best, lag });
  }
  cand.sort((a, b) => Math.abs(b.best) - Math.abs(a.best));
  out.tested += Math.min(cand.length, MAX_TESTED);
  for (const c of cand.slice(0, MAX_TESTED)) {
    // A column that is the series under another name (a copy, a unit conversion, revenue = units x price) would predict by leaking
    // the answer: its remainder is the series' own remainder, or the two move in lockstep. It is left out and named.
    if (c.lag === 0 && (Math.abs(c.best) > 0.995 || Math.abs(corr(y, cols[c.col]!, 0, n)) > 0.9995)) { out.leaked.push(c.col); continue; }
    const w = walkForward(r, c.u, c.lag, n);
    if (!w || w.cut < MIN_CUT || w.halves[0] < MIN_CUT / 2 || w.halves[1] < MIN_CUT / 2) continue;
    out.hints.push({ col: c.col, lag: c.lag, cut: w.cut, corr: c.best, sign: c.best >= 0 ? 1 : -1 });
  }
  out.hints.sort((a, b) => b.cut - a.cut);
  return out;
}

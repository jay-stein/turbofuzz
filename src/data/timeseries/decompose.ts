/**
 * Time Series page, layer 2: trend, season and the rest; unusual periods; the trend's
 * one clear break.
 */

import type { Aggregated, TsConfig } from "./aggregate.js";

export interface Decomposition {
  /** Season length in periods; 0 for trend only. */
  m: number;
  trend: Float64Array;
  seasonal: Float64Array;
  rem: Float64Array;
  prof: Float64Array;
  /** Strength of trend and of season, 0 to 1. */
  ft: number;
  fs: number;
  level: number;
  /** Below a day: the daily cycle and what each part of the week adds on top. */
  parts?: { daily: Float64Array; weekly: Float64Array; pd: number };
  /** The season is a share of the trend (it swings more when the level is higher). */
  scaled?: boolean;
}
export interface Segment { sse: number; slope: number; mean: number }
export interface Changepoint { k: number; gain: number; before: Segment; after: Segment }
export interface SeasonOption { m: number; fs: number; multi: boolean }
export interface DecompResult {
  options: SeasonOption[];
  dec: Decomposition | null;
  /** A rough cycle the calendar does not name, in periods (0 when none). */
  cycle: number;
  z: Float64Array | null;
  mad: number;
  /** The largest few unusual periods, worst first. */
  anomalies: number[];
  anomalyCount: number;
  cp: Changepoint | null;
}

const variance = (n: number, f: (i: number) => number): number => {
  let s = 0, ss = 0;
  for (let i = 0; i < n; i++) { const x = f(i); s += x; ss += x * x; }
  return ss / n - (s / n) ** 2;
};

export function decompose(y: Float64Array, n: number, m: number): Decomposition | null {
  if (n < 2 * m + 2) return null;
  const pre = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + y[i];
  const trend = new Float64Array(n).fill(NaN);
  let a: number, z: number;
  if (m % 2 === 1) {
    const k = (m - 1) / 2; a = k; z = n - 1 - k;
    for (let i = k; i < n - k; i++) trend[i] = (pre[i + k + 1] - pre[i - k]) / m;
  } else {
    const k = m / 2; a = k; z = n - 1 - k;
    for (let i = k; i < n - k; i++) trend[i] = (pre[i + k] - pre[i - k + 1] + 0.5 * (y[i - k] + y[i + k])) / m;
  }
  const fit = (i0: number, i1: number): [number, number] => {
    let sx = 0, sy = 0, sxx = 0, sxy = 0, c = 0;
    for (let i = i0; i <= i1; i++) { sx += i; sy += trend[i]; sxx += i * i; sxy += i * trend[i]; c++; }
    const s = (c * sxy - sx * sy) / (c * sxx - sx * sx || 1);
    return [s, (sy - s * sx) / c];
  };
  const L = Math.max(2, Math.min(m, z - a));
  const [s0, c0] = fit(a, a + L - 1);
  for (let i = 0; i < a; i++) trend[i] = c0 + s0 * i;
  const [s1, c1] = fit(z - L + 1, z);
  for (let i = z + 1; i < n; i++) trend[i] = c1 + s1 * i;
  // Median per phase, so one bad period (a data gap, a viral day) cannot fake a seasonal peak.
  const det = new Float64Array(n);
  for (let i = 0; i < n; i++) det[i] = y[i] - trend[i];
  const prof = phaseMedian(det, a, z, m);
  const seasonal = new Float64Array(n), rem = new Float64Array(n);
  for (let i = 0; i < n; i++) { seasonal[i] = prof[i % m]; rem[i] = y[i] - trend[i] - seasonal[i]; }
  const vr = variance(n, (i) => rem[i]);
  const ft = Math.max(0, 1 - vr / (variance(n, (i) => trend[i] + rem[i]) || 1));
  const fs = Math.max(0, 1 - vr / (variance(n, (i) => seasonal[i] + rem[i]) || 1));
  let level = 0;
  for (let i = 0; i < n; i++) level += trend[i];
  return { m, trend, seasonal, rem, prof, ft, fs, level: level / n };
}

/** Median of v over each phase i % m for i in [a, z], centred on zero. */
export function phaseMedian(v: Float64Array, a: number, z: number, m: number): Float64Array {
  const per = Math.ceil((z - a + 1) / m) + 1, buf = new Float64Array(m * per), cnt = new Int32Array(m);
  for (let i = a; i <= z; i++) { const k = i % m; buf[k * per + cnt[k]++] = v[i]; }
  const prof = new Float64Array(m);
  let mean = 0;
  for (let k = 0; k < m; k++) {
    const s = buf.subarray(k * per, k * per + cnt[k]).sort(), h = s.length >> 1;
    prof[k] = s.length ? (s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2) : 0;
    mean += prof[k];
  }
  mean /= m;
  for (let k = 0; k < m; k++) prof[k] -= mean;
  return prof;
}

/** Centred moving average around a cycle (wraps), for reporting a long seasonal profile. */
export function circularSmooth(p: Float64Array, half: number): Float64Array {
  const m = p.length, out = new Float64Array(m);
  for (let k = 0; k < m; k++) { let s = 0; for (let j = -half; j <= half; j++) s += p[(k + j + m) % m]; out[k] = s / (2 * half + 1); }
  return out;
}

/** The k-th smallest value of a (reordered in place): a median without a full sort. */
export function selectK(a: Float64Array, k: number): number {
  let lo = 0, hi = a.length - 1;
  while (lo < hi) {
    const pv = a[(lo + hi) >> 1];
    let i = lo, j = hi;
    while (i <= j) {
      while (a[i] < pv) i++;
      while (a[j] > pv) j--;
      if (i <= j) { const t = a[i]; a[i] = a[j]; a[j] = t; i++; j--; }
    }
    if (k <= j) hi = j;
    else if (k >= i) lo = i;
    else return a[k];
  }
  return a[k];
}

export function robustZ(rem: Float64Array, n: number): { z: Float64Array; mad: number } {
  const arr = Float64Array.from(rem.subarray(0, n));
  const med = selectK(arr, n >> 1);
  let mad = selectK(arr.map((v) => Math.abs(v - med)), n >> 1) * 1.4826;
  if (!(mad > 1e-9)) { let a = 0, b = 0; for (const v of arr) { a += v; b += v * v; } mad = Math.sqrt(Math.max(1e-18, b / n - (a / n) ** 2)); }
  const z = new Float64Array(n);
  for (let i = 0; i < n; i++) z[i] = (rem[i] - med) / mad;
  return { z, mad };
}

/** The single split of the trend into two straight lines that fits best, if it helps much. */
export function changepoint(trend: Float64Array, n: number): Changepoint | null {
  const P = (f: (i: number) => number): Float64Array => { const a = new Float64Array(n + 1); for (let i = 0; i < n; i++) a[i + 1] = a[i] + f(i); return a; };
  const Sx = P((i) => i), Sy = P((i) => trend[i]), Sxx = P((i) => i * i), Sxy = P((i) => i * trend[i]), Syy = P((i) => trend[i] * trend[i]);
  const seg = (i0: number, i1: number): Segment => {
    const c = i1 - i0, sx = Sx[i1] - Sx[i0], sy = Sy[i1] - Sy[i0], sxx = Sxx[i1] - Sxx[i0], sxy = Sxy[i1] - Sxy[i0], syy = Syy[i1] - Syy[i0];
    const vx = sxx - (sx * sx) / c, cxy = sxy - (sx * sy) / c;
    const slope = vx > 0 ? cxy / vx : 0;
    return { sse: Math.max(0, syy - (sy * sy) / c - slope * cxy), slope, mean: sy / c };
  };
  const whole = seg(0, n);
  const minSeg = Math.max(4, Math.floor(n * 0.15));
  let best: { k: number; sse: number; a: Segment; b: Segment } | null = null;
  for (let k = minSeg; k <= n - minSeg; k++) {
    const a = seg(0, k), b = seg(k, n), s = a.sse + b.sse;
    if (!best || s < best.sse) best = { k, sse: s, a, b };
  }
  if (!best || whole.sse <= 0) return null;
  return { k: best.k, gain: 1 - best.sse / whole.sse, before: best.a, after: best.b };
}

/**
 * A repeating cycle the calendar does not name (an 11-year cycle in monthly data, say):
 * the strongest autocorrelation peak of the detrended series.
 */
export function detectCycle(y: Float64Array, N: number, taken: readonly number[]): number {
  if (N < 30) return 0;
  // A wide centred moving average follows a curved trend (a linear fit leaves its bend in
  // the residual, which then reads as a slow cycle); cycles up to its half-width survive.
  const W = Math.max(5, Math.floor(N / 4)), half = W >> 1;
  const pre = new Float64Array(N + 1);
  for (let i = 0; i < N; i++) pre[i + 1] = pre[i] + y[i];
  const r = new Float64Array(N);
  let mean = 0;
  for (let i = 0; i < N; i++) { const a = Math.max(0, i - half), b = Math.min(N, i + half + 1); r[i] = y[i] - (pre[b] - pre[a]) / (b - a); mean += r[i]; }
  mean /= N;
  let v = 0;
  for (let i = 0; i < N; i++) { r[i] -= mean; v += r[i] * r[i]; }
  if (!(v > 0)) return 0;
  const maxLag = Math.min(Math.floor(N / 3), 600, half);
  const acf = new Float64Array(maxLag + 2);
  for (let lag = 1; lag <= maxLag + 1; lag++) { let c = 0; for (let i = lag; i < N; i++) c += r[i] * r[i - lag]; acf[lag] = c / v; }
  let best = 0, bestV = 0.3;
  for (let lag = 3; lag <= maxLag; lag++) if (acf[lag] > acf[lag - 1] && acf[lag] >= acf[lag + 1] && acf[lag] > bestV) { best = lag; bestV = acf[lag]; }
  if (!best || taken.some((p) => Math.abs(p - best) <= Math.max(1, 0.1 * p))) return 0;
  return best;
}

/** No season to separate: a smooth trend (wide moving average) and what is left over. */
export function trendOnly(y: Float64Array, N: number): Decomposition | null {
  let w = Math.max(3, Math.round(N / 12));
  w = Math.min(w, Math.floor((N - 2) / 2));
  if (w % 2 === 0) w--;
  if (w < 3) return null;
  const d = decompose(y, N, w);
  if (!d) return null;
  d.seasonal.fill(0);
  d.prof = new Float64Array(1);
  for (let i = 0; i < N; i++) d.rem[i] = y[i] - d.trend[i];
  const vr = variance(N, (i) => d.rem[i]), vt = variance(N, (i) => d.trend[i] + d.rem[i]);
  d.ft = Math.max(0, 1 - vr / (vt || 1));
  d.fs = 0;
  d.m = 0;
  return d;
}

/**
 * Two seasons at once below a day: the cycle within a day, then what each part of the
 * week adds on top of it. The trend is the week-long moving average, as for weekly alone.
 */
export function decomposeMulti(y: Float64Array, n: number, pd: number): Decomposition | null {
  const w = 7 * pd, d = decompose(y, n, w);
  if (!d) return null;
  const a = w >> 1, z = n - 1 - a;
  const det = new Float64Array(n);
  for (let i = 0; i < n; i++) det[i] = y[i] - d.trend[i];
  const daily = phaseMedian(det, a, z, pd);
  for (let i = 0; i < n; i++) det[i] -= daily[i % pd];
  const weekly = phaseMedian(det, a, z, w);
  for (let k = 0; k < w; k++) d.prof[k] = daily[k % pd] + weekly[k];
  for (let i = 0; i < n; i++) { d.seasonal[i] = d.prof[i % w]; d.rem[i] = y[i] - d.trend[i] - d.seasonal[i]; }
  const vr = variance(n, (i) => d.rem[i]);
  d.ft = Math.max(0, 1 - vr / (variance(n, (i) => d.trend[i] + d.rem[i]) || 1));
  d.fs = Math.max(0, 1 - vr / (variance(n, (i) => d.seasonal[i] + d.rem[i]) || 1));
  d.parts = { daily, weekly, pd };
  return d;
}

/**
 * The same split with a season that scales with the trend (y = trend x season x rest),
 * from the ratios y / trend, phase by phase. It is written back as amounts, seasonal =
 * trend x (season - 1), so trend + seasonal + remainder still add up to y; the profile
 * is those amounts at the average level. Null when the trend is not above zero.
 */
export function scaleWithLevel(y: Float64Array, n: number, d: Decomposition): Decomposition | null {
  const m = d.parts ? 7 * d.parts.pd : d.m;
  if (m < 2) return null;
  const r = new Float64Array(n);
  for (let i = 0; i < n; i++) { if (!(d.trend[i] > 0)) return null; r[i] = y[i] / d.trend[i] - 1; }
  const a = m >> 1, z = n - 1 - a;
  let S: Float64Array, daily: Float64Array | null = null;
  if (d.parts) {
    const pd = d.parts.pd;
    daily = phaseMedian(r, a, z, pd);
    for (let i = 0; i < n; i++) r[i] = (r[i] + 1) / (1 + daily[i % pd]) - 1;
    const weekly = phaseMedian(r, a, z, m);
    S = new Float64Array(m);
    for (let k = 0; k < m; k++) S[k] = (1 + daily[k % pd]) * (1 + weekly[k]);
  } else {
    S = phaseMedian(r, a, z, m);
    for (let k = 0; k < m; k++) S[k] += 1;
  }
  const seasonal = new Float64Array(n), rem = new Float64Array(n), prof = new Float64Array(m);
  for (let i = 0; i < n; i++) { seasonal[i] = d.trend[i] * (S[i % m] - 1); rem[i] = y[i] - d.trend[i] - seasonal[i]; }
  for (let k = 0; k < m; k++) prof[k] = d.level * (S[k] - 1);
  const vr = variance(n, (i) => rem[i]);
  const out: Decomposition = {
    ...d, seasonal, rem, prof, scaled: true,
    ft: Math.max(0, 1 - vr / (variance(n, (i) => d.trend[i] + rem[i]) || 1)),
    fs: Math.max(0, 1 - vr / (variance(n, (i) => seasonal[i] + rem[i]) || 1)),
  };
  if (d.parts && daily) {
    const pd = d.parts.pd, dl = new Float64Array(pd), wk = new Float64Array(m);
    for (let k = 0; k < pd; k++) dl[k] = d.level * daily[k];
    for (let k = 0; k < m; k++) wk[k] = prof[k] - dl[k % pd];
    out.parts = { daily: dl, weekly: wk, pd };
  }
  return out;
}

/** Sum of squares of what is left over: how much a split leaves unexplained. */
function remSS(d: Decomposition, n: number): number { let s = 0; for (let i = 0; i < n; i++) s += d.rem[i] * d.rem[i]; return s; }

/**
 * A season that grows with the level (busier peaks when busier overall) is a share of
 * the trend, not a fixed amount: the scaled split, when the series is above zero and
 * it leaves clearly less unexplained; else d as it is.
 */
export function preferScaled(y: Float64Array, n: number, d: Decomposition): Decomposition {
  for (let i = 0; i < n; i++) if (!(y[i] > 0)) return d;
  const s = scaleWithLevel(y, n, d);
  return s && remSS(s, n) < 0.85 * remSS(d, n) ? s : d;
}

export function computeDecomposition(A: Aggregated, cfg: TsConfig): DecompResult {
  const g = A.g, N = A.modelN;
  const cands = g.periods.filter((p) => N >= 2 * p + 2);
  // The cycle search costs length x lags, so it reads the latest stretch only.
  const CW = 20_000;
  const cyc = N > CW ? detectCycle(A.yModel.subarray(N - CW, N), CW, cands) : detectCycle(A.yModel, N, cands);
  if (cyc && N >= 2 * cyc + 2) cands.push(cyc);
  const options: Decomposition[] = [];
  for (const p of cands) {
    const d = g.unit === "min" && g.perDay && p === 7 * g.perDay ? decomposeMulti(A.yModel, N, g.perDay) : decompose(A.yModel, N, p);
    if (d) options.push(A.allPositive ? preferScaled(A.yModel, N, d) : d);
  }
  // A weak best season is noise (births, share prices): trend only, unless the person picked one.
  const best = options.length ? options.reduce((a, b) => (b.fs > a.fs ? b : a)) : null;
  const dec = options.find((d) => d.m === cfg.period) ?? (best && best.fs >= 0.15 ? best : null) ?? trendOnly(A.yModel, N);
  const summary = options.map((o) => ({ m: o.m, fs: o.fs, multi: !!o.parts }));
  if (!dec) return { options: summary, dec: null, cycle: cyc, anomalies: [], anomalyCount: 0, cp: null, z: null, mad: 0 };
  const rz = robustZ(dec.rem, N);
  const anomalies: number[] = [];
  // A period with no value was filled in for the models; it is a gap, not an anomaly.
  for (let i = 0; i < N; i++) if (Math.abs(rz.z[i]) >= cfg.sens && !A.made[i] && A.y[i] === A.y[i]) anomalies.push(i);
  anomalies.sort((a, b) => Math.abs(rz.z[b]) - Math.abs(rz.z[a]));
  return { options: summary, dec, cycle: cyc, z: rz.z, mad: rz.mad, anomalies: anomalies.slice(0, 8), anomalyCount: anomalies.length, cp: changepoint(dec.trend, N) };
}

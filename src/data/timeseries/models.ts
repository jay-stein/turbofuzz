/**
 * Time Series page, layer 3: forecasts. Eight models, every one backtested from earlier
 * dates against "repeat the last cycle"; bands come from those backtest errors, not
 * from a formula. No dependencies: a few hundred lines of typed arrays.
 */

import { eventWindowLen, type Grain, type TsTable } from "./base.js";
import { regular, type Aggregated, type TsConfig, type TsDriver } from "./aggregate.js";
import { decompose, preferScaled } from "./decompose.js";
import { cap, nounFor } from "./format.js";
import { chiSquareSf, tTwoSided } from "./stats.js";

export type ModelKey = "sn" | "hw" | "ets" | "reg" | "theta" | "clim" | "ens" | "comb";
export const MODEL_KEYS: readonly ModelKey[] = ["sn", "hw", "ets", "reg", "theta", "clim", "ens", "comb"];
export const MODEL_INFO: Readonly<Record<ModelKey, { name: string; meth: string }>> = {
  sn: { name: "Repeat last cycle", meth: "Seasonal naive" },
  hw: { name: "Smooth and damp", meth: "Holt-Winters, damped trend" },
  reg: { name: "Trend, seasons and drivers", meth: "Prophet-style regression" },
  theta: { name: "Steady trend", meth: "Theta method" },
  clim: { name: "Seasonal average", meth: "Mean of the same point in earlier cycles" },
  ets: { name: "Best smoothing", meth: "ETS, picked by AICc (trend none, additive or damped; season none, additive or multiplicative)" },
  ens: { name: "Blend with regression", meth: "Average of best smoothing, steady trend and the trend, seasons and drivers model" },
  comb: { name: "Combination", meth: "Average of best smoothing, steady trend and smooth and damp (the M4 \"Comb\" benchmark, fpp3 13.4)" },
};

interface BandQ { q10: number; q90: number; q025: number; q975: number }
type HwParams = [number, number, number, number];
interface HwState { l: number; b: number; s: Float64Array }
interface RegFit {
  beta: Float64Array; p: number; fill: (i: number, x: Float64Array) => void; x: Float64Array; smear: number;
  K: number; Ky: number; Kw: number; Kd: number; T: number; drv: { d: TsDriver; log: boolean; mean: number }[]; iDrv: number; logY: boolean; maxLog: number;
}
/** prof: the season added back; scale: the season as factors (one that grows with the level). */
interface ThetaFit { prof: Float64Array | null; scale: Float64Array | null; b0: number; alpha: number; level: number; o: number; m: number }

/** Accuracy measures, all from the same backtest errors (see METRIC_INFO). */
export type MetricKey = "mase" | "mae" | "rmse" | "wape" | "smape" | "mape" | "bias";
export const METRIC_KEYS: readonly MetricKey[] = ["mase", "mae", "rmse", "wape", "smape", "mape", "bias"];
export type Metrics = Record<MetricKey, number>;
const METRIC_INFO_LABEL: Record<MetricKey, string> = { mase: "MASE", mae: "MAE", rmse: "RMSE", wape: "WAPE", smape: "sMAPE", mape: "MAPE", bias: "bias" };

/** What the page shows about one model (no closures, so it can leave the worker). */
export interface ModelSummary {
  key: ModelKey;
  mase: number;
  /** Backtest error relative to repeating the last cycle. */
  ratio: number;
  /** On the latest backtest: how many periods fell inside the 80% band built from the others. */
  check: { hit: number; tot: number } | null;
  /** On the selection folds (all but the last when there are 4 or more). */
  metrics: Metrics;
  /** On the lockbox: the last fold, never used to rank or pick; null with under 4 folds. */
  lock: Metrics | null;
  /** Selection folds where this model's error was below repeating the last cycle. */
  folds: { won: number; of: number };
  hw?: { params: HwParams };
  /** ETS components, e.g. "A,Ad,M" (error, trend, season), and its smoothing parameters. */
  ets?: { spec: string; alpha: number; beta: number; gamma: number; phi: number; aicc: number; tried: number };
  reg?: { K: number; Ky: number; Kw: number; Kd: number; logY: boolean; drivers: { col: string; log: boolean; beta: number; flag: boolean }[] };
  theta?: { alpha: number; b0: number; seasonal: boolean };
  clim?: { m: number };
}
export interface ModelRun {
  T: number;
  H: number;
  m: number;
  origins: number[];
  step: number;
  models: Record<ModelKey, ModelSummary>;
  best: ModelKey;
  /** The best model by each measure (bias by its size), on the selection folds only. */
  bestBy: Record<MetricKey, ModelKey>;
  /** The last fold is held back from selection and only scored (a lockbox). */
  lockbox: boolean;
  /**
   * What Auto picks for each measure, and why. With a season of 24 periods or less the
   * Combination is the default and a rival replaces it only by winning the selection
   * folds, then the lockbox fold, then a Diebold-Mariano test; with longer seasons Auto
   * picks the backtest winner.
   */
  auto: Record<MetricKey, { pick: ModelKey; why: string }>;
  autoPolicy: "combination" | "backtest";
  cv: "expanding" | "rolling";
  /** Periods each rolling fold trains on; null when expanding. */
  trainLen: number | null;
  rough: boolean;
  profile: string;
}
export interface ModelError { error: string }
export interface Future {
  F: Float64Array; lo80: Float64Array; hi80: Float64Array; lo95: Float64Array; hi95: Float64Array;
  /** Against actuals after a backtest split. */
  held: { hit: number; tot: number; mae: number; ratio?: number } | null;
}
export type Futures = Record<ModelKey, Future>;

/** Inside the worker only: the run plus what the futures need (fits with closures). */
interface RunInternal extends ModelRun { oc: Record<ModelKey, Float64Array>; etsFinal: EtsState; etsFit: EtsFit; hwFinal: HwState; hwParams: HwParams; regFit: RegFit; thetaFit: ThetaFit; climM: number; climMeans: Float64Array; q: Record<ModelKey, BandQ[]> }

function hwInit(y: Float64Array, m: number, limit: number): HwState {
  let l = 0;
  for (let i = 0; i < m; i++) l += y[i];
  l /= m;
  let b = 0;
  if (limit >= 2 * m) { let l2 = 0; for (let i = m; i < 2 * m; i++) l2 += y[i]; b = (l2 / m - l) / m; }
  const s = new Float64Array(m);
  for (let i = 0; i < m; i++) s[i] = y[i] - l;
  return { l, b, s };
}
// Filled periods arrive as NaN in y (yi is the filled series, used only for the starting
// state): the state carries through them like a forecast and learns nothing from them.
function hwSSE(y: Float64Array, T: number, m: number, a: number, be: number, ga: number, ph: number, yi: Float64Array = y): number {
  const st = hwInit(yi, m, T);
  let l = st.l, b = st.b, sse = 0;
  const s = st.s;
  for (let t = m; t < T; t++) {
    const k = t % m, yt = y[t];
    if (!(yt === yt)) { l += ph * b; b *= ph; continue; }
    const e = yt - (l + ph * b + s[k]);
    sse += e * e;
    const ln = a * (yt - s[k]) + (1 - a) * (l + ph * b);
    b = be * (ln - l) + (1 - be) * ph * b;
    s[k] = ga * (yt - ln) + (1 - ga) * s[k];
    l = ln;
  }
  return sse;
}
function hwFit(y: Float64Array, T: number, m: number, warm: HwParams | undefined, yi: Float64Array = y): HwParams {
  const lo = [0.01, 0.001, 0.001, 0.8], hi = [0.99, 0.5, 0.7, 0.98];
  let p: HwParams = warm ? [...warm] : [0.3, 0.05, 0.15, 0.95];
  if (m === 1) p[2] = 0; // no season: plain damped trend
  let best = hwSSE(y, T, m, p[0], p[1], p[2], p[3], yi);
  const step = warm ? [0.04, 0.015, 0.04, 0.015] : [0.12, 0.04, 0.1, 0.04];
  for (let round = 0; round < 7; round++) {
    for (let j = 0; j < 4; j++) {
      if (m === 1 && j === 2) continue;
      for (const dir of [1, -1]) {
        const q: HwParams = [...p];
        q[j] = Math.min(hi[j], Math.max(lo[j], q[j] + dir * step[j]));
        const e = hwSSE(y, T, m, q[0], q[1], q[2], q[3], yi);
        if (e < best) { best = e; p = q; }
      }
    }
    for (let j = 0; j < 4; j++) step[j] *= 0.5;
  }
  return p;
}
function hwRun(y: Float64Array, T: number, m: number, p: HwParams, origins: number[], yi: Float64Array = y): { snaps: Map<number, HwState>; final: HwState } {
  const [a, be, ga, ph] = p;
  const st = hwInit(yi, m, origins.length ? origins[0] : T);
  let l = st.l, b = st.b;
  const s = st.s;
  const snaps = new Map<number, HwState>();
  let oi = 0;
  for (let t = m; t < T; t++) {
    while (oi < origins.length && origins[oi] === t) { snaps.set(t, { l, b, s: s.slice() }); oi++; }
    const k = t % m, yt = y[t];
    if (!(yt === yt)) { l += ph * b; b *= ph; continue; }
    const ln = a * (yt - s[k]) + (1 - a) * (l + ph * b);
    b = be * (ln - l) + (1 - be) * ph * b;
    s[k] = ga * (yt - ln) + (1 - ga) * s[k];
    l = ln;
  }
  return { snaps, final: { l, b, s } };
}
function hwForecast(st: HwState, m: number, ph: number, t0: number, H: number, out: Float64Array, off: number): void {
  let damp = 0, pw = 1;
  for (let h = 0; h < H; h++) { pw *= ph; damp += pw; out[off + h] = st.l + damp * st.b + st.s[(t0 + h) % m]; }
}
// ---------------------------------------------------------------- ETS (auto)
// Exponential smoothing with additive errors, as in Hyndman & Athanasopoulos,
// Forecasting: Principles and Practice (3rd ed.), ch. 8: trend none (N), additive (A)
// or damped (Ad); season none (N), additive (A) or multiplicative (M, positive series
// only). Each is fitted by least squares and the one with the lowest AICc is kept.

type EtsTrend = "N" | "A" | "Ad";
type EtsSeason = "N" | "A" | "M";
interface EtsState { l: number; b: number; s: Float64Array }
interface EtsFit { trend: EtsTrend; season: EtsSeason; m: number; a: number; be: number; ga: number; ph: number; aicc: number; tried: number }

function etsInit(y: Float64Array, from: number, m: number, fit: Pick<EtsFit, "trend" | "season">): EtsState {
  const mm = fit.season === "N" ? 1 : m;
  let l = 0;
  for (let i = 0; i < mm; i++) l += y[from + i];
  l /= mm;
  let b = 0;
  if (fit.trend !== "N" && y.length - from >= 2 * mm) { let l2 = 0; for (let i = mm; i < 2 * mm; i++) l2 += y[from + i]; b = (l2 / mm - l) / mm; }
  const s = new Float64Array(Math.max(1, m)).fill(fit.season === "M" ? 1 : 0);
  if (fit.season === "A") for (let i = 0; i < m; i++) s[(from + i) % m] = y[from + i] - l;
  if (fit.season === "M") for (let i = 0; i < m; i++) s[(from + i) % m] = l !== 0 ? y[from + i] / l : 1;
  return { l, b, s };
}

/** One step: the forecast for t, then the state after seeing y[t]. NaN when the state breaks (a zero level or season). */
function etsStep(st: EtsState, y: number, k: number, f: Omit<EtsFit, "aicc" | "tried">): number {
  const damped = f.trend === "N" ? 0 : f.ph;
  const base = st.l + damped * st.b;
  const sk = st.s[k];
  const pred = f.season === "M" ? base * sk : f.season === "A" ? base + sk : base;
  if (!(y === y)) return pred; // a gap: carry the state
  const des = f.season === "M" ? (sk !== 0 ? y / sk : NaN) : f.season === "A" ? y - sk : y;
  const ln = f.a * des + (1 - f.a) * base;
  if (f.trend !== "N") st.b = f.be * (ln - st.l) + (1 - f.be) * damped * st.b;
  if (f.season === "M") st.s[k] = ln !== 0 ? f.ga * (y / ln) + (1 - f.ga) * sk : NaN;
  else if (f.season === "A") st.s[k] = f.ga * (y - ln) + (1 - f.ga) * sk;
  st.l = ln;
  return pred;
}

function etsSSE(y: Float64Array, from: number, T: number, f: Omit<EtsFit, "aicc" | "tried">, yi: Float64Array = y): { sse: number; n: number } {
  const st = etsInit(yi, from, f.m, f);
  const start = from + (f.season === "N" ? 1 : f.m);
  let sse = 0, n = 0;
  for (let t = start; t < T; t++) {
    const pred = etsStep(st, y[t], t % f.m, f);
    if (!Number.isFinite(pred) || !Number.isFinite(st.l)) return { sse: Infinity, n: 1 };
    if (y[t] === y[t]) { const e = y[t] - pred; sse += e * e; n++; }
  }
  return { sse, n };
}

/** Least-squares smoothing parameters for one ETS form (coordinate search, as for Holt-Winters). */
function etsFitOne(y: Float64Array, from: number, T: number, m: number, trend: EtsTrend, season: EtsSeason, yi: Float64Array = y): EtsFit | null {
  const free = [true, trend !== "N", season !== "N", trend === "Ad"];
  const lo = [0.01, 0.001, 0.001, 0.8], hi = [0.99, 0.5, 0.7, 0.98];
  let p = [0.3, trend === "N" ? 0 : 0.05, season === "N" ? 0 : 0.15, trend === "Ad" ? 0.95 : 1];
  const sse = (q: number[]): number => etsSSE(y, from, T, { trend, season, m, a: q[0]!, be: q[1]!, ga: q[2]!, ph: q[3]! }, yi).sse;
  let best = sse(p);
  const step = [0.12, 0.04, 0.1, 0.04];
  for (let round = 0; round < 5; round++) {
    for (let j = 0; j < 4; j++) {
      if (!free[j]) continue;
      for (const dir of [1, -1]) {
        const q = [...p];
        q[j] = Math.min(hi[j]!, Math.max(lo[j]!, q[j]! + dir * step[j]!));
        const e = sse(q);
        if (e < best) { best = e; p = q; }
      }
    }
    for (let j = 0; j < 4; j++) step[j]! *= 0.5;
  }
  const { n } = etsSSE(y, from, T, { trend, season, m, a: p[0]!, be: p[1]!, ga: p[2]!, ph: p[3]! }, yi);
  // Parameters plus initial states: level, trend, and m - 1 free seasonal starts.
  const k = free.filter(Boolean).length + 1 + (trend !== "N" ? 1 : 0) + (season !== "N" ? m - 1 : 0);
  if (!Number.isFinite(best) || n - k - 1 <= 0 || best <= 0) return null;
  const aicc = n * Math.log(best / n) + 2 * k + (2 * k * (k + 1)) / (n - k - 1);
  return { trend, season, m, a: p[0]!, be: p[1]!, ga: p[2]!, ph: p[3]!, aicc, tried: 0 };
}

/** ETS learns its smoothing from the latest stretch: older periods barely move it but cost as much to fit. */
function etsFrom(T: number, m: number): number {
  const w = Math.max(800, 6 * m);
  return T > w ? Math.floor((T - w) / Math.max(1, m)) * Math.max(1, m) : 0;
}

/** Fitted forms kept for the same stretch of the same series (a horizon drag refits nothing). */
const etsCache = new Map<string, EtsFit>();

/** The ETS form with the lowest AICc over [from, T), from the cache when this stretch was fitted before. */
function etsSelect(y: Float64Array, from: number, T: number, m: number, yi: Float64Array = y): EtsFit {
  let sum = 0;
  for (let t = from; t < T; t += Math.max(1, Math.floor((T - from) / 64))) sum += y[t] === y[t] ? y[t] : 0.5;
  const key = `${from}|${T}|${m}|${sum}|${y[T - 1]}`;
  const hit = etsCache.get(key);
  if (hit) return hit;
  const fit = etsSelectFresh(y, from, T, m, yi);
  if (etsCache.size > 64) etsCache.clear();
  etsCache.set(key, fit);
  return fit;
}

function etsSelectFresh(y: Float64Array, from: number, T: number, m: number, yi: Float64Array = y): EtsFit {
  let positive = true;
  for (let t = from; t < T; t++) if (y[t] === y[t] && !(y[t] > 0)) { positive = false; break; }
  const seasons: EtsSeason[] = m >= 2 && T - from >= 2 * m + 2 ? (positive ? ["N", "A", "M"] : ["N", "A"]) : ["N"];
  let best: EtsFit | null = null, tried = 0;
  for (const season of seasons) {
    for (const trend of ["N", "A", "Ad"] as EtsTrend[]) {
      const fit = etsFitOne(y, from, T, season === "N" ? 1 : m, trend, season, yi);
      tried++;
      if (fit && (best === null || fit.aicc < best.aicc)) best = fit;
    }
  }
  return { ...(best ?? { trend: "N", season: "N", m: 1, a: 0.3, be: 0, ga: 0, ph: 1, aicc: NaN, tried: 0 }), tried };
}

/** Runs a fitted ETS from `from` to T, keeping the state at each origin. */
function etsRun(y: Float64Array, from: number, T: number, f: EtsFit, origins: number[], yi: Float64Array = y): { snaps: Map<number, EtsState>; final: EtsState } {
  const st = etsInit(yi, from, f.m, f);
  const snaps = new Map<number, EtsState>();
  let oi = 0;
  while (oi < origins.length && origins[oi]! < from + f.m) oi++;
  for (let t = from + (f.season === "N" ? 1 : f.m); t < T; t++) {
    while (oi < origins.length && origins[oi] === t) { snaps.set(t, { l: st.l, b: st.b, s: st.s.slice() }); oi++; }
    etsStep(st, y[t], t % f.m, f);
  }
  return { snaps, final: { l: st.l, b: st.b, s: st.s.slice() } };
}

function etsForecast(st: EtsState, f: EtsFit, t0: number, H: number, out: Float64Array, off: number): void {
  let damp = 0, pw = 1;
  for (let h = 0; h < H; h++) {
    if (f.trend === "Ad") { pw *= f.ph; damp += pw; } else if (f.trend === "A") damp = h + 1;
    const base = st.l + damp * st.b, sk = st.s[(t0 + h) % f.m] ?? 0;
    out[off + h] = f.season === "M" ? base * sk : f.season === "A" ? base + sk : base;
  }
}

/** "A,Ad,M": error, trend and season, as ETS is usually written. */
export function etsSpec(f: Pick<EtsFit, "trend" | "season">): string {
  return `A,${f.trend},${f.season}`;
}

function cholSolve(Am: Float64Array, bv: Float64Array, p: number): Float64Array {
  const L = new Float64Array(p * p);
  for (let i = 0; i < p; i++) {
    for (let j = 0; j <= i; j++) {
      let s = Am[i * p + j];
      for (let k = 0; k < j; k++) s -= L[i * p + k] * L[j * p + k];
      if (i === j) L[i * p + i] = Math.sqrt(Math.max(s, 1e-12));
      else L[i * p + j] = s / L[j * p + j];
    }
  }
  const z = new Float64Array(p), x = new Float64Array(p);
  for (let i = 0; i < p; i++) { let s = bv[i]; for (let k = 0; k < i; k++) s -= L[i * p + k] * z[k]; z[i] = s / L[i * p + i]; }
  for (let i = p - 1; i >= 0; i--) { let s = z[i]; for (let k = i + 1; k < p; k++) s -= L[k * p + i] * x[k]; x[i] = s / L[i * p + i]; }
  return x;
}

/** Recent typical value of a driver: the median of its last couple of months. */
export function driverRecent(A: Aggregated, col: string): number {
  return regular(A.colMean[col], A.n - eventWindowLen(A.g), A.n);
}
/** A driver's value at period i: actual where the table has it; after the data ends, the driver's rule. */
function driverAt(A: Aggregated, d: TsDriver, i: number): number {
  const s = A.colMean[d.col];
  if (i < A.n) return s[i];
  if (d.rule === "lastyear") { let j = i - A.g.ly; while (j >= A.n) j -= A.g.ly; return j >= 0 ? s[j] : s[A.n - 1]; }
  const base = driverRecent(A, d.col);
  return d.rule === "pct" ? base * (1 + d.pct / 100) : base;
}

// Fits learn from the latest periods only: older ones barely move a forecast but cost
// as much to fit (a year of hours is 8,766 rows per refit). Daily data up to about ten
// years is never cut.
const REG_WIN = 4000;
/** Start of a fitting window ending at o: whole cycles of m, so every phase keeps its place. */
function fitFrom(o: number, m: number): number {
  const w = Math.max(REG_WIN, 3 * m);
  return o > w ? Math.floor((o - w) / m) * m : 0;
}
/** sin(ja), cos(ja) for j = 1..K into x from k, by rotation: two trig calls, not 2K. */
function harmonics(x: Float64Array, k: number, a: number, K: number): number {
  if (!K) return k;
  const s1 = Math.sin(a), c1 = Math.cos(a);
  let sj = s1, cj = c1;
  for (let j = 1; j <= K; j++) {
    x[k++] = sj; x[k++] = cj;
    const t = sj * c1 + cj * s1;
    cj = cj * c1 - sj * s1; sj = t;
  }
  return k;
}

/** Prophet-style regression on log values: trend with shrunk bends, Fourier seasons, any driver columns. */
function regFit(A: Aggregated, table: TsTable, drivers: TsDriver[], y: Float64Array, T: number, flex: number, win = Infinity): RegFit {
  const g: Grain = A.g, from = Math.max(0, T - Math.min(REG_WIN, win)), W = T - from;
  // A season needs data to learn it from: yearly terms only with a full year, weekly and daily with three cycles.
  const Ky = W >= g.perYear ? Math.max(0, Math.min(4, Math.floor((g.perYear - 1) / 2))) : 0;
  const wk = g.unit === "day" && g.n === 1 ? 7 : g.perDay ? 7 * g.perDay : 0;
  const Kw = wk && W >= 3 * wk ? 3 : 0;
  const pd = g.perDay ?? 0;
  const Kd = pd && W >= 3 * pd ? Math.min(6, pd >> 1) : 0;
  const K = Math.max(1, Math.min(10, Math.floor(T / 10)));
  const hinges = Array.from({ length: K }, (_, k) => (0.85 * (k + 1)) / (K + 1));
  // A positive series is fitted on logs (effects read as percentages); anything with
  // zeros or negatives is fitted as it is (effects read in its own units).
  let logY = true;
  for (let i = 0; i < T; i++) if (!A.made[i] && !(y[i] > 0)) { logY = false; break; }
  const drv = drivers.filter((d) => A.colMean[d.col]).map((d) => {
    const s = A.colMean[d.col];
    let pos = true;
    for (let i = 0; i < T; i++) if (!(s[i] > 0)) { pos = false; break; }
    const log = logY && !table.flags[d.col] && pos;
    let mean = 0;
    for (let i = 0; i < T; i++) mean += log ? Math.log(s[i]) : s[i];
    return { d, log, mean: mean / T };
  });
  const iDrv = 2 + K + 2 * Ky + 2 * Kw + 2 * Kd;
  const p = iDrv + drv.length;
  const fill = (i: number, x: Float64Array): void => {
    let k = 0;
    const t = i / T;
    x[k++] = 1; x[k++] = t;
    for (const c of hinges) x[k++] = t > c ? t - c : 0;
    k = harmonics(x, k, (2 * Math.PI * i) / g.perYear, Ky);
    k = harmonics(x, k, (2 * Math.PI * i) / (wk || 1), Kw);
    k = harmonics(x, k, (2 * Math.PI * i) / (pd || 1), Kd);
    for (const v of drv) { const raw = driverAt(A, v.d, i); x[k++] = (v.log ? Math.log(raw) : raw) - v.mean; }
  };
  const M = new Float64Array(p * p), bv = new Float64Array(p), x = new Float64Array(p);
  let cnt = 0;
  for (let i = from; i < T; i++) {
    if (A.made[i] || !(y[i] === y[i]) || (logY && !(y[i] > 0))) continue;
    fill(i, x);
    const zt = logY ? Math.log(y[i]) : y[i];
    for (let a = 0; a < p; a++) {
      const xa = x[a];
      bv[a] += xa * zt;
      for (let c = 0; c <= a; c++) M[a * p + c] += xa * x[c];
    }
    cnt++;
  }
  for (let a = 0; a < p; a++) for (let c = 0; c < a; c++) M[c * p + a] = M[a * p + c];
  // Each bend is shrunk relative to its own scale, so late bends are as free as early ones.
  const rel = flexDetail(T, flex).lambda;
  M[1 * p + 1] += 1e-6 * cnt;
  for (let k = 0; k < K; k++) { const j = (2 + k) * p + (2 + k); M[j] += Math.max(M[j] * rel, 1e-6 * cnt); }
  for (let k = 2 + K; k < p; k++) M[k * p + k] += 1e-4 * cnt;
  M[0] += 1e-9;
  const beta = cholSolve(M, bv, p);
  let smear = 0, sc = 0;
  for (let i = from; i < T && logY; i++) {
    if (!(y[i] > 0) || A.made[i]) continue;
    fill(i, x);
    let s = 0;
    for (let a = 0; a < p; a++) s += x[a] * beta[a];
    smear += Math.exp(Math.log(y[i]) - s); sc++;
  }
  let maxLog = -Infinity;
  for (let i = 0; i < T && logY; i++) if (y[i] > 0) maxLog = Math.max(maxLog, Math.log(y[i]));
  return { beta, p, fill, x: new Float64Array(p), smear: sc ? smear / sc : 1, K, Ky, Kw, Kd, T, drv, iDrv, logY, maxLog };
}
function regAt(fit: RegFit, i: number): number {
  fit.fill(i, fit.x);
  let s = 0;
  for (let a = 0; a < fit.p; a++) s += fit.x[a] * fit.beta[a];
  // On logs a steep end slope compounds without limit; no forecast goes past 20x the largest value seen.
  return fit.logY ? Math.exp(Math.min(s, fit.maxLog + 3)) * fit.smear : s;
}
/** Theta method: simple smoothing plus half the long-run slope, on the deseasonalised series. */
function thetaFit(y: Float64Array, o: number, m: number, start = 0, skip?: Uint8Array): ThetaFit {
  const s = Math.max(fitFrom(o, m), start);
  if (s) return thetaFit(y.subarray(s, o), o - s, m, 0, skip?.subarray(s, o));
  const add = m > 1 && o >= 2 * m + 2 ? decompose(y, o, m) : null;
  const d = add ? preferScaled(y, o, add) : null;
  // A scaled season comes out as factors around 1 (its profile is amounts at the average level).
  const scale = d?.scaled ? d.prof.map((v) => 1 + v / d.level) : null;
  const prof = d && !scale ? d.prof : null;
  const z = new Float64Array(o);
  for (let i = 0; i < o; i++) z[i] = scale ? y[i] / scale[i % m] : y[i] - (prof ? prof[i % m] : 0);
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (let i = 0; i < o; i++) { sx += i; sy += z[i]; sxx += i * i; sxy += i * z[i]; }
  const b0 = (o * sxy - sx * sy) / (o * sxx - sx * sx || 1);
  let best = Infinity, alpha = 0.5, level = z[0];
  for (let a = 0.05; a < 0.951; a += 0.05) {
    let l = z[0], sse = 0;
    for (let i = 1; i < o; i++) { if (skip?.[i]) continue; const e = z[i] - l; sse += e * e; l += a * e; }
    if (sse < best) { best = sse; alpha = a; level = l; }
  }
  return { prof, scale, b0, alpha, level, o, m };
}
function thetaAt(f: ThetaFit, h: number): number {
  const a = f.alpha;
  const flat = f.level + (f.b0 / 2) * ((1 - Math.pow(1 - a, f.o)) / a + h);
  return f.scale ? flat * f.scale[(f.o + h) % f.m] : flat + (f.prof ? f.prof[(f.o + h) % f.m] : 0);
}
/** Climatology: the average of the same point in every earlier cycle. */
function phaseMeans(y: Float64Array, o: number, m: number, start = 0): Float64Array {
  const sum = new Float64Array(m), cnt = new Float64Array(m);
  let all = 0;
  for (let i = start; i < o; i++) { sum[i % m] += y[i]; cnt[i % m]++; all += y[i]; }
  const out = new Float64Array(m);
  for (let k = 0; k < m; k++) out[k] = cnt[k] ? sum[k] / cnt[k] : all / (o - start || 1);
  return out;
}
/** What the series looks like decides which model families apply (the model router). */
function seriesProfile(A: Aggregated, T: number): string {
  let zeros = 0, neg = 0, ints = 0, filled = 0, tot = 0, sum = 0;
  for (let i = 0; i < T; i++) {
    const v = A.y[i];
    if (!(v === v)) continue;
    tot++; sum += v;
    if (v === 0) zeros++;
    if (v < 0) neg++;
    if (Math.abs(v - Math.round(v)) < 1e-9) ints++;
    if (A.made[i]) filled++;
  }
  const bits: string[] = [];
  bits.push(zeros - filled > 0.3 * tot ? "mostly zero periods: models for sparse series would suit it better" : "few zero periods");
  bits.push(A.allPositive ? "all values above zero, so changes read as percentages" : neg ? "values below zero, so changes read in the series' own units and forecasts may go below zero" : "zero values present, so changes read in the series' own units");
  if (ints === tot && sum / tot < 30) bits.push("small whole numbers: a count model would suit it better");
  if (filled) bits.push(`${filled} filled ${nounFor(A.g, filled)} left out of fitting`);
  return cap(bits.join("; ")) + ".";
}
export function quantile(sorted: ArrayLike<number>, q: number): number {
  if (!sorted.length) return 0;
  const pos = (sorted.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}
function bandQuantiles(errs: Float64Array, ks: number[], H: number): BandQ[] {
  const w = Math.max(1, Math.round(H / 8));
  const out: BandQ[] = [];
  for (let h = 0; h < H; h++) {
    const pool: number[] = [];
    for (const k of ks) for (let j = Math.max(0, h - w); j <= Math.min(H - 1, h + w); j++) { const e = errs[k * H + j]; if (e === e) pool.push(e); }
    pool.sort((a, b) => a - b);
    const q50 = quantile(pool, 0.5), q10 = quantile(pool, 0.1), q90 = quantile(pool, 0.9);
    out.push({ q10, q90, q025: Math.min(quantile(pool, 0.025), q50 - 1.53 * (q50 - q10)), q975: Math.max(quantile(pool, 0.975), q50 + 1.53 * (q90 - q50)) });
  }
  return out;
}

/**
 * The longest forecast this history can check: every forecast is backtested from earlier
 * dates, which needs a training stretch plus the horizon plus room for several origins
 * (see runModels). Past that there is nothing to measure the forecast or its band
 * against, so the page does not offer it. A hard ceiling keeps very fine series quick.
 */
export function maxHorizon(A: Aggregated): number {
  const m = A.modelM || 1, minTrain = Math.max(m + Math.max(4, Math.ceil(m / 4)), 8);
  let H = Math.max(1, Math.floor((3 * (A.modelN - minTrain)) / 5));
  while (H > 1 && minTrain + H + 2 * Math.max(1, Math.round(H / 3)) > A.modelN) H--;
  return Math.min(H, 20_000);
}
export function horizonOf(A: Aggregated, cfg: TsConfig): number { return Math.max(1, Math.min(maxHorizon(A), cfg.horizon ?? A.g.horizon)); }

/** Holt-Winters starting points carried between runs of the same series. */
export type HwWarm = Map<string, HwParams>;

interface BacktestPlan { T: number; origins: number[]; step: number; rolling: boolean; trainLen: number | null; startOf: (o: number) => number; scale: number }

/**
 * Where the backtest folds start and what each trains on. Up to 10 origins, H/3 apart,
 * ending H before the split. MASE's scale is the in-sample error of repeating the last
 * cycle on the training data before the first origin only (fpp3 5.8), so no test
 * period leaks into it.
 */
function backtestPlan(A: Aggregated, cfg: TsConfig, splitReq: number | null, H: number): BacktestPlan | ModelError {
  const g = A.g, N = A.modelN, m = A.modelM;
  const minTrain = Math.max(m + Math.max(4, Math.ceil(m / 4)), 8);
  const step = Math.max(1, Math.round(H / 3));
  const minSplit = minTrain + H + 2 * step;
  if (N < minSplit) return { error: `A ${H}-${g.noun} forecast needs at least ${minSplit} ${g.nouns} of history; this series has ${N}. Forecast less far ahead or pick a finer grain.` };
  const T = splitReq == null ? N : Math.max(minSplit, Math.min(N, splitReq));
  const y = A.yModel;
  const origins: number[] = [];
  for (let k = 0; k < 10; k++) { const o = T - H - k * step; if (o < minTrain) break; origins.push(o); }
  origins.reverse();
  const R = origins.length;
  // Rolling: every fold trains on the same length as the first (whole cycles, so phases keep their place).
  const rolling = cfg.cv === "rolling" && R > 1;
  const trainLen = rolling ? origins[0]! : null;
  const startOf = (o: number): number => (rolling ? Math.max(0, Math.floor((o - trainLen!) / Math.max(1, m)) * Math.max(1, m)) : 0);
  const scaleEnd = R ? origins[0]! : T;
  let scale = 0, sc = 0;
  for (let t = m; t < scaleEnd; t++) { const d = Math.abs(y[t] - y[t - m]); if (d === d) { scale += d; sc++; } }
  scale = scale / (sc || 1) || 1;
  return { T, origins, step, rolling, trainLen, startOf, scale };
}

/**
 * A validation curve for Trend flexibility: the backtest MASE of the trend, seasons and
 * drivers model at every setting from 1 to 10, on the same folds as the board. A curve
 * that keeps falling as the trend gets bendier is real structure; one that turns back
 * up is the model starting to fit noise.
 */
export function flexCurve(A: Aggregated, table: TsTable, cfg: TsConfig, H: number): { flex: number; mase: number }[] {
  const plan = backtestPlan(A, cfg, cfg.split, H);
  if ("error" in plan) return [];
  const y = A.yModel, out: { flex: number; mase: number }[] = [];
  for (let flex = 1; flex <= 10; flex++) {
    let ae = 0, ac = 0;
    for (const o of plan.origins) {
      const f = regFit(A, table, cfg.drivers, y, o, flex, plan.rolling ? o - plan.startOf(o) : Infinity);
      for (let h = 0; h < H; h++) { if (A.made[o + h]) continue; const e = Math.abs(y[o + h] - regAt(f, o + h)); if (e === e) { ae += e; ac++; } }
    }
    out.push({ flex, mase: ae / (ac || 1) / plan.scale });
  }
  return out;
}

/** The trend's hinge count and ridge penalty at a flexibility, as the page explains them. */
export function flexDetail(T: number, flex: number): { hinges: number; lambda: number } {
  return { hinges: Math.max(1, Math.min(10, Math.floor(T / 10))), lambda: 0.3 * Math.pow(10, (5 - flex) / 2.5) };
}

/** Fits every model on [0, T) and backtests it from earlier origins. */
export function runModels(A: Aggregated, table: TsTable, cfg: TsConfig, splitReq: number | null, H: number, warm: HwWarm): (ModelRun & { internal: RunInternal }) | ModelError {
  const g = A.g, m = A.modelM;
  const plan = backtestPlan(A, cfg, splitReq, H);
  if ("error" in plan) return plan;
  const { T, origins, step, rolling, trainLen, startOf, scale } = plan;
  const y = A.yModel;
  // The smoothing models see filled periods as missing: they bridge them but never learn from them.
  const yM = y.slice();
  for (let t = 0; t < yM.length; t++) if (A.made[t]) yM[t] = NaN;
  const R = origins.length;
  const oc = Object.fromEntries(MODEL_KEYS.map((k) => [k, new Float64Array(R * H)])) as Record<ModelKey, Float64Array>;

  origins.forEach((o, k) => { for (let h = 0; h < H; h++) oc.sn[k * H + h] = y[o - m + (h % m)]; });

  // Smoothing parameters for the backtest are fitted on data before the first origin
  // only, so no model is scored on periods it was tuned on (that would flatter it).
  const wkey = [cfg.grain, cfg.agg, cfg.measure, cfg.group, cfg.gaps].join("|");
  const first0 = origins.length ? origins[0] : T;
  // The cut is rounded down to a coarse step: still before every origin (honest), and
  // the same while the horizon is dragged, so fits are reused.
  const quantum = Math.max(m, 64);
  const cut = Math.max(Math.min(first0, 2 * m + 10), Math.floor(first0 / quantum) * quantum);
  const hb = etsFrom(cut, m);
  const hwBack = cut - hb >= 2 * m + 2 ? hwFit(yM.subarray(hb), cut - hb, m, warm.get(wkey), y.subarray(hb)) : null;
  const hs = fitFrom(T, m);
  const hwParams = hwFit(yM.subarray(hs), T - hs, m, warm.get(wkey), y.subarray(hs));
  warm.set(wkey, hwParams);
  const backRun = hwRun(yM, T, m, hwBack ?? hwParams, origins, y);
  origins.forEach((o, k) => {
    const s0 = startOf(o), p = hwBack ?? hwParams;
    const st = s0 > 0 ? hwRun(yM.subarray(s0), o - s0, m, p, [], y.subarray(s0)).final : backRun.snaps.get(o);
    if (st) hwForecast(st, m, p[3], o - s0, H, oc.hw, k * H);
  });
  const run = hwRun(yM, T, m, hwParams, [], y);

  // ETS: the form and its parameters chosen before the first origin for the backtest, again on all data for the forecast.
  const eb = etsFrom(cut, m);
  const etsBack = etsSelect(yM, eb, cut, m, y);
  const etsBackRun = etsRun(yM, eb, T, etsBack, origins, y);
  origins.forEach((o, k) => {
    const s0 = startOf(o);
    const st = s0 > 0 ? etsRun(yM, s0, o, etsBack, [], y).final : etsBackRun.snaps.get(o);
    if (st) etsForecast(st, etsBack, o, H, oc.ets, k * H); else for (let h = 0; h < H; h++) oc.ets[k * H + h] = oc.hw[k * H + h];
  });
  const es = etsFrom(T, m);
  const etsFit = etsSelect(yM, es, T, m, y);
  const etsFinal = etsRun(yM, es, T, etsFit, [], y).final;

  origins.forEach((o, k) => { const f = regFit(A, table, cfg.drivers, y, o, cfg.flex, rolling ? o - startOf(o) : Infinity); for (let h = 0; h < H; h++) oc.reg[k * H + h] = regAt(f, o + h); });
  const reg = regFit(A, table, cfg.drivers, y, T, cfg.flex);

  origins.forEach((o, k) => { const f = thetaFit(y, o, m, startOf(o), A.made); for (let h = 0; h < H; h++) oc.theta[k * H + h] = thetaAt(f, h); });
  const theta = thetaFit(y, T, m, 0, A.made);

  const first = origins.length ? origins[0] : T;
  const climM = g.periods.filter((pp) => first >= pp).pop() || m;
  origins.forEach((o, k) => { const means = phaseMeans(y, o, climM, rolling ? Math.max(0, Math.floor((o - trainLen!) / climM) * climM) : 0); for (let h = 0; h < H; h++) oc.clim[k * H + h] = means[(o + h) % climM]; });
  const climMeans = phaseMeans(y, T, climM);

  for (let i = 0; i < R * H; i++) {
    oc.ens[i] = (oc.ets[i] + oc.reg[i] + oc.theta[i]) / 3;
    oc.comb[i] = (oc.ets[i] + oc.theta[i] + oc.hw[i]) / 3;
  }

  const models = {} as Record<ModelKey, ModelSummary>;
  const q = {} as Record<ModelKey, BandQ[]>;
  const foldMae = {} as Record<ModelKey, Float64Array>;
  const errsAll = {} as Record<ModelKey, Float64Array>;
  // With 4 or more folds the last is a lockbox: models are ranked and the Auto pick is
  // made on the others only, then the pick is scored once on data the choice never saw.
  // The best of seven on the same folds is optimistic (selection bias); the lockbox is not.
  const lockbox = R >= 4;
  const sel = (k: number): boolean => !lockbox || k < R - 1;
  for (const key of MODEL_KEYS) {
    const errs = (errsAll[key] = new Float64Array(R * H).fill(NaN));
    const fm = (foldMae[key] = new Float64Array(R));
    const all = newAcc(), last = newAcc();
    origins.forEach((o, k) => {
      const acc = sel(k) ? all : last;
      let fae = 0, fc = 0;
      for (let h = 0; h < H; h++) {
        if (A.made[o + h]) continue;
        const act = y[o + h], f = oc[key][k * H + h], e = act - f;
        if (!(e === e)) continue;
        errs[k * H + h] = e; fae += Math.abs(e); fc++;
        addErr(acc, act, f);
      }
      fm[k] = fc ? fae / fc : NaN;
    });
    const metrics = metricsOf(all, scale);
    q[key] = bandQuantiles(errs, origins.map((_, k) => k), H);
    let check: ModelSummary["check"] = null;
    if (R >= 4) {
      const qx = bandQuantiles(errs, origins.slice(0, -1).map((_, k) => k), H);
      let hit = 0, tot = 0;
      for (let h = 0; h < H; h++) { const e = errs[(R - 1) * H + h]; if (e !== e) continue; tot++; if (e >= qx[h].q10 && e <= qx[h].q90) hit++; }
      check = { hit, tot };
    }
    models[key] = { key, mase: metrics.mase, ratio: 0, check, metrics, lock: lockbox ? metricsOf(last, scale) : null, folds: { won: 0, of: 0 } };
  }
  for (const key of MODEL_KEYS) {
    let won = 0, of = 0;
    for (let k = 0; k < R; k++) {
      if (!sel(k)) continue; const a = foldMae[key][k]!, b = foldMae.sn[k]!; if (a === a && b === b) { of++; if (a < b) won++; } }
    models[key].folds = { won, of };
  }
  const base = models.sn.mase || 1;
  for (const key of MODEL_KEYS) models[key].ratio = models[key].mase / base;
  models.hw.hw = { params: hwParams };
  models.ets.ets = { spec: etsSpec(etsFit), alpha: etsFit.a, beta: etsFit.be, gamma: etsFit.ga, phi: etsFit.ph, aicc: etsFit.aicc, tried: etsFit.tried };
  models.reg.reg = { K: reg.K, Ky: reg.Ky, Kw: reg.Kw, Kd: reg.Kd, logY: reg.logY, drivers: reg.drv.map((v, j) => ({ col: v.d.col, log: v.log, beta: reg.beta[reg.iDrv + j], flag: !!table.flags[v.d.col] })) };
  models.theta.theta = { alpha: theta.alpha, b0: theta.b0, seasonal: theta.prof !== null || theta.scale !== null };
  models.clim.clim = { m: climM };
  const order: ModelKey[] = ["comb", "ets", "hw", "reg", "ens", "theta", "clim", "sn"];
  const size = (key: ModelKey, mk: MetricKey): number => { const v = models[key].metrics[mk]; return v === v ? (mk === "bias" ? Math.abs(v) : v) : Infinity; };
  const bestBy = Object.fromEntries(METRIC_KEYS.map((mk) => [mk, order.reduce((a, b) => (size(b, mk) < size(a, mk) ? b : a))])) as Record<MetricKey, ModelKey>;
  // Auto. fpp3 5.10 and 13.4: choosing the winner of several models from a few short,
  // overlapping folds is noisy, and the average of ETS, Theta and a damped trend rarely
  // loses to it (it beats every published classical method on M3 monthly and quarterly,
  // Monash benchmark, CHG-2026-10-31-27). So up to the 24-period seasons that seasonal ETS
  // handles, the Combination is the default and a rival has to earn the pick.
  const autoPolicy: ModelRun["autoPolicy"] = m <= 24 ? "combination" : "backtest";
  const dmLag = Math.max(0, Math.ceil(H / step) - 1);
  const lockSize = (key: ModelKey, mk: MetricKey): number => { const v = models[key].lock?.[mk] ?? NaN; return v === v ? (mk === "bias" ? Math.abs(v) : v) : Infinity; };
  const nm = (k: ModelKey): string => MODEL_INFO[k].name;
  const auto = {} as ModelRun["auto"];
  for (const mk of METRIC_KEYS) {
    if (autoPolicy === "backtest") {
      // The Combination's members are the seasonal-smoothing family, so it is not a candidate here.
      const pool = order.filter((k) => k !== "comb");
      auto[mk] = { pick: pool.reduce((a, b) => (size(b, mk) < size(a, mk) ? b : a)), why: `A season of ${m} periods is longer than seasonal ETS and Theta handle well (R's ets() stops at 24), so Auto picks the backtest winner on the selection folds, and the Combination of those models is not a candidate.` };
      continue;
    }
    const rivals = order.filter((k) => k !== "comb");
    const cand = rivals.reduce((a, b) => (size(b, mk) < size(a, mk) ? b : a));
    const label = METRIC_INFO_LABEL[mk];
    if (!(size(cand, mk) < size("comb", mk))) auto[mk] = { pick: "comb", why: `The Combination is Auto's default, and no other model beat it on ${label} over the selection folds.` };
    else if (!lockbox) auto[mk] = { pick: "comb", why: `${nm(cand)} led the Combination on ${label}, but with under 4 folds there is no unseen fold to confirm it, so the Combination stays.` };
    else if (!(lockSize(cand, mk) < lockSize("comb", mk))) auto[mk] = { pick: "comb", why: `${nm(cand)} led the Combination on ${label} over the selection folds but not on the unseen lockbox fold, so the Combination stays.` };
    else {
      const dm = dmTest(errsAll[cand], errsAll["comb"], lockbox ? R - 1 : R, H, dmLag);
      if (dm.p < 0.05 && dm.diff < 0) auto[mk] = { pick: cand, why: `${nm(cand)} replaced the Combination: it led on ${label} over the selection folds and on the lockbox fold, and a Diebold-Mariano test finds it more accurate (p = ${dm.p < 0.001 ? "< 0.001" : dm.p.toFixed(3)}).` };
      else auto[mk] = { pick: "comb", why: `${nm(cand)} led the Combination on ${label} over the selection folds and the lockbox fold, but not significantly (Diebold-Mariano p = ${dm.p === dm.p ? dm.p.toFixed(2) : "n/a"} over ${dm.n} folds), so the Combination stays.` };
    }
  }
  const best = auto.mase.pick;
  const out: ModelRun = { T, H, m, origins, step, models, best, bestBy, lockbox, auto, autoPolicy, cv: rolling ? "rolling" : "expanding", trainLen, rough: R < 3, profile: seriesProfile(A, T) };
  return { ...out, internal: { ...out, oc, etsFinal, etsFit, hwFinal: run.final, hwParams, regFit: reg, thetaFit: theta, climM, climMeans, q } };
}

interface ErrAcc { ae: number; ac: number; se: number; ay: number; sum: number; sm: number; smc: number; mp: number; mpc: number }
const newAcc = (): ErrAcc => ({ ae: 0, ac: 0, se: 0, ay: 0, sum: 0, sm: 0, smc: 0, mp: 0, mpc: 0 });
function addErr(a: ErrAcc, act: number, f: number): void {
  const e = act - f;
  a.ae += Math.abs(e); a.ac++; a.se += e * e; a.ay += Math.abs(act); a.sum -= e;
  const d = Math.abs(act) + Math.abs(f);
  if (d > 0) { a.sm += (2 * Math.abs(e)) / d; a.smc++; }
  if (act !== 0) { a.mp += Math.abs(e / act); a.mpc++; }
}
function metricsOf(a: ErrAcc, scale: number): Metrics {
  const mae = a.ac ? a.ae / a.ac : NaN;
  return {
    mase: mae / scale, mae, rmse: a.ac ? Math.sqrt(a.se / a.ac) : NaN,
    wape: a.ay > 0 ? a.ae / a.ay : NaN, smape: a.smc ? a.sm / a.smc : NaN, mape: a.mpc ? a.mp / a.mpc : NaN,
    bias: a.ay > 0 ? a.sum / a.ay : NaN,
  };
}

/** Future values and bands for every model. */
export function computeFutures(A: Aggregated, run: RunInternal): Futures {
  const { T, H, m } = run;
  const y = A.yModel;
  const F: Record<ModelKey, Float64Array> = {
    sn: new Float64Array(H), hw: new Float64Array(H), ets: new Float64Array(H), reg: new Float64Array(H), theta: new Float64Array(H), clim: new Float64Array(H), ens: new Float64Array(H), comb: new Float64Array(H),
  };
  hwForecast(run.hwFinal, m, run.hwParams[3], T, H, F.hw, 0);
  etsForecast(run.etsFinal, run.etsFit, T, H, F.ets, 0);
  for (let h = 0; h < H; h++) {
    F.reg[h] = regAt(run.regFit, T + h);
    F.sn[h] = y[T - m + (h % m)];
    F.theta[h] = thetaAt(run.thetaFit, h);
    F.clim[h] = run.climMeans[(T + h) % run.climM];
    F.ens[h] = (F.ets[h] + F.reg[h] + F.theta[h]) / 3;
    F.comb[h] = (F.ets[h] + F.theta[h] + F.hw[h]) / 3;
  }
  const floor0 = A.nonNeg ? (v: number): number => Math.max(0, v) : (v: number): number => v;
  const out = {} as Futures;
  for (const key of MODEL_KEYS) {
    const qk = run.q[key], f = F[key];
    const lo80 = new Float64Array(H), hi80 = new Float64Array(H), lo95 = new Float64Array(H), hi95 = new Float64Array(H);
    for (let h = 0; h < H; h++) {
      f[h] = floor0(f[h]);
      lo80[h] = floor0(f[h] + qk[h].q10); hi80[h] = f[h] + qk[h].q90;
      lo95[h] = floor0(f[h] + qk[h].q025); hi95[h] = f[h] + qk[h].q975;
    }
    let held: Future["held"] = null;
    if (T < A.modelN) {
      let hit = 0, tot = 0, ae = 0;
      for (let h = 0; h < H && T + h < A.modelN; h++) {
        const v = A.y[T + h];
        if (!(v === v) || A.made[T + h]) continue;
        tot++; ae += Math.abs(v - f[h]);
        if (v >= lo80[h] && v <= hi80[h]) hit++;
      }
      held = { hit, tot, mae: tot ? ae / tot : NaN };
    }
    out[key] = { F: f, lo80, hi80, lo95, hi95, held };
  }
  // With held-out actuals, grade on them: a backtest on an easy stretch must not hide a miss.
  const snHeld = out.sn.held;
  if (snHeld && snHeld.mae > 0) for (const k of MODEL_KEYS) { const h = out[k].held; if (h) h.ratio = h.mae / snHeld.mae; }
  return out;
}

export function grade(ratio: number, key: ModelKey): { cls: "base" | "good" | "okay" | "poor"; text: string } {
  if (key === "sn") return { cls: "base", text: "Baseline" };
  if (ratio < 0.8) return { cls: "good", text: "Good" };
  if (ratio < 1) return { cls: "okay", text: "OK" };
  return { cls: "poor", text: "Poor" };
}

// ---------------------------------------------------------------- Deep check (on request)
// The checks fpp3 asks of a forecast, run only when the person asks (no latency budget):
// is the pick significantly better than each rival (Diebold–Mariano, §5.10), how does
// each model's error grow with the horizon (§5.10), are the bands calibrated on every
// fold (§5.9), and do the pick's one-step residuals look like white noise (§5.4).

export interface DeepCheck {
  pick: ModelKey;
  /** Diebold–Mariano on absolute error, pick against each rival, over the selection folds. */
  dm: { other: ModelKey; n: number; diff: number; stat: number; p: number }[];
  /** HAC lag used for the DM variance (folds overlap when they are closer than the horizon). */
  dmLag: number;
  /** MAE by step ahead (1-based steps, sampled to at most 60) on the selection folds. */
  horizon: { steps: number[]; mae: Record<ModelKey, number[]> };
  /** Leave-one-fold-out band coverage on every fold, and the mean 80% Winkler score scaled like MASE. */
  calib: Record<ModelKey, { n: number; cov80: number; cov95: number; winkler: number }>;
  /** The pick's one-step (or fitted) residuals on the training data. */
  resid: { kind: string; n: number; mean: number; acf: number[]; crit: number; m: number; lb: { lag: number; q: number; p: number } } | null;
  ms: number;
}

/** In-sample one-step errors of a model on its own fitting window (NaN where not defined or filled). */
function oneStepErrors(A: Aggregated, run: RunInternal, key: ModelKey): { e: Float64Array; kind: string } {
  const { T, m } = run, y = A.yModel, e = new Float64Array(T).fill(NaN), pred = new Float64Array(T).fill(NaN);
  const etsPred = (): void => {
    const f = run.etsFit, es = etsFrom(T, m), st = etsInit(y, es, f.m, f);
    for (let t = es + (f.season === "N" ? 1 : f.m); t < T; t++) pred[t] = etsStep(st, y[t], t % f.m, f);
  };
  const regPred = (): void => { for (let t = Math.max(0, T - REG_WIN); t < T; t++) pred[t] = regAt(run.regFit, t); };
  const thetaPred = (): void => {
    const tf = run.thetaFit, s = T - tf.o;
    const mul = (i: number): number => (tf.scale ? tf.scale[i % tf.m]! : 1), add = (i: number): number => (tf.prof ? tf.prof[i % tf.m]! : 0);
    const z = (i: number): number => (tf.scale ? y[s + i] / mul(i) : y[s + i] - add(i));
    let l = z(0);
    for (let i = 1; i < tf.o; i++) {
      const flat = l + tf.b0 / 2;
      pred[s + i] = tf.scale ? flat * mul(i) : flat + add(i);
      l += tf.alpha * (z(i) - l);
    }
  };
  let kind = "one-step";
  switch (key) {
    case "sn": for (let t = m; t < T; t++) pred[t] = y[t - m]; break;
    case "clim": for (let t = 0; t < T; t++) pred[t] = run.climMeans[t % run.climM]!; kind = "fitted"; break;
    case "hw": {
      const hs = fitFrom(T, m), sub = y.subarray(hs), [a, be, ga, ph] = run.hwParams, st = hwInit(sub, m, T - hs);
      let l = st.l, b = st.b;
      const sv = st.s;
      for (let t = m; t < T - hs; t++) {
        const k = t % m, yt = sub[t];
        pred[hs + t] = l + ph * b + sv[k];
        if (A.made[hs + t]) { l += ph * b; b *= ph; continue; }
        const ln = a * (yt - sv[k]) + (1 - a) * (l + ph * b);
        b = be * (ln - l) + (1 - be) * ph * b; sv[k] = ga * (yt - ln) + (1 - ga) * sv[k]; l = ln;
      }
      break;
    }
    case "ets": etsPred(); break;
    case "reg": regPred(); kind = "fitted"; break;
    case "theta": thetaPred(); kind = "one-step (approximate)"; break;
    case "comb": {
      etsPred(); const pe = pred.slice(); pred.fill(NaN);
      thetaPred(); const pt = pred.slice(); pred.fill(NaN);
      oneStepErrorsHw(A, run, pred);
      for (let t = 0; t < T; t++) pred[t] = (pe[t]! + pt[t]! + pred[t]!) / 3;
      kind = "one-step (approximate)";
      break;
    }
    case "ens": {
      etsPred(); const pe = pred.slice(); pred.fill(NaN);
      regPred(); const pr = pred.slice(); pred.fill(NaN);
      thetaPred(); const pt = pred.slice();
      for (let t = 0; t < T; t++) pred[t] = (pe[t]! + pr[t]! + pt[t]!) / 3;
      kind = "mixed one-step and fitted";
      break;
    }
  }
  for (let t = 0; t < T; t++) if (!A.made[t]) e[t] = y[t] - pred[t]!;
  return { e, kind };
}

/** Runs every Deep check for the pick. */
export function deepCheck(A: Aggregated, run: RunInternal, pick: ModelKey): DeepCheck {
  const t0 = performance.now();
  const { origins, H, step, T, m } = run, R = origins.length, y = A.yModel;
  const selR = run.lockbox ? R - 1 : R;
  const errs = {} as Record<ModelKey, Float64Array>;
  for (const k of MODEL_KEYS) {
    const a = (errs[k] = new Float64Array(R * H).fill(NaN));
    origins.forEach((o, f) => { for (let h = 0; h < H; h++) if (!A.made[o + h]) a[f * H + h] = y[o + h] - run.oc[k][f * H + h]!; });
  }
  // Diebold–Mariano on fold means of |e_pick| - |e_other|: overlapping folds are dependent,
  // so a Bartlett (Newey–West) variance with lag = overlap - 1, the Harvey–Leybourne–Newbold
  // small-sample correction, and t with n - 1 degrees of freedom.
  const dmLag = Math.max(0, Math.ceil(H / step) - 1);
  const dm: DeepCheck["dm"] = [];
  for (const other of MODEL_KEYS) {
    if (other === pick) continue;
    dm.push({ other, ...dmTest(errs[pick], errs[other], selR, H, dmLag) });
  }
  // Error by horizon.
  const nSteps = Math.min(H, 60), steps = Array.from({ length: nSteps }, (_, i) => Math.round(1 + (i * (H - 1)) / Math.max(1, nSteps - 1)));
  const mae = {} as Record<ModelKey, number[]>;
  for (const k of MODEL_KEYS) mae[k] = steps.map((st) => { let s = 0, c = 0; for (let f = 0; f < selR; f++) { const e = errs[k][f * H + st - 1]!; if (e === e) { s += Math.abs(e); c++; } } return c ? s / c : NaN; });
  // Calibration: each fold's errors against bands built from the other folds.
  let scale = 0, sc = 0;
  for (let t = m; t < (R ? origins[0]! : T); t++) { const v = Math.abs(y[t] - y[t - m]); if (v === v) { scale += v; sc++; } }
  scale = scale / (sc || 1) || 1;
  const nh = Math.min(H, 120);
  const hs = Array.from(new Set(Array.from({ length: nh }, (_, i) => Math.floor((i * H) / nh))));
  const calib = {} as DeepCheck["calib"];
  for (const k of MODEL_KEYS) {
    let n = 0, in80 = 0, in95 = 0, wk = 0;
    if (R >= 3) for (let f = 0; f < R; f++) {
      const qx = bandQuantiles(errs[k], origins.map((_, j) => j).filter((j) => j !== f), H);
      for (const h of hs) {
        const e = errs[k][f * H + h]!, q = qx[h]!;
        if (!(e === e)) continue;
        n++;
        if (e >= q.q10 && e <= q.q90) in80++;
        if (e >= q.q025 && e <= q.q975) in95++;
        wk += q.q90 - q.q10 + (e < q.q10 ? 10 * (q.q10 - e) : e > q.q90 ? 10 * (e - q.q90) : 0);
      }
    }
    calib[k] = { n, cov80: n ? in80 / n : NaN, cov95: n ? in95 / n : NaN, winkler: n ? wk / n / scale : NaN };
  }
  // Residuals of the pick: ACF and Ljung–Box (lag 2m for seasonal data, 10 otherwise, at most n/5).
  let resid: DeepCheck["resid"] = null;
  const { e, kind } = oneStepErrors(A, run, pick);
  const r: number[] = [];
  for (let t = Math.max(0, T - 3000); t < T; t++) if (e[t] === e[t]) r.push(e[t]!);
  const n = r.length;
  if (n >= 20) {
    const mean = r.reduce((x, v) => x + v, 0) / n;
    let c0 = 0;
    for (const v of r) c0 += (v - mean) * (v - mean);
    const maxLag = Math.min(Math.max(m > 1 ? 2 * m : 20, 20), Math.floor(n / 4), 400);
    const acf: number[] = [];
    for (let k = 1; k <= maxLag; k++) { let s = 0; for (let i = k; i < n; i++) s += (r[i]! - mean) * (r[i - k]! - mean); acf.push(c0 > 0 ? s / c0 : 0); }
    const lag = Math.max(1, Math.min(m > 1 ? 2 * m : 10, Math.floor(n / 5), acf.length));
    let q = 0;
    for (let k = 1; k <= lag; k++) q += (acf[k - 1]! * acf[k - 1]!) / (n - k);
    q *= n * (n + 2);
    resid = { kind, n, mean, acf, crit: 1.96 / Math.sqrt(n), m, lb: { lag, q, p: chiSquareSf(q, lag) } };
  }
  return { pick, dm, dmLag, horizon: { steps, mae }, calib, resid, ms: performance.now() - t0 };
}

/**
 * Diebold-Mariano test (fpp3 5.10) that model A's absolute error is below model B's, over
 * the first `folds` folds. The loss is each fold's mean absolute error; overlapping folds
 * are dependent, so the variance is Bartlett (Newey-West) with lag `lag`, with the
 * Harvey-Leybourne-Newbold small-sample correction and a t distribution on n - 1 df.
 * diff < 0 means A is more accurate. NaN with fewer than 3 folds.
 */
export function dmTest(errA: Float64Array, errB: Float64Array, folds: number, H: number, lag: number): { n: number; diff: number; stat: number; p: number } {
  const d: number[] = [];
  for (let f = 0; f < folds; f++) {
    let s = 0, c = 0;
    for (let h = 0; h < H; h++) { const a = errA[f * H + h]!, b = errB[f * H + h]!; if (a === a && b === b) { s += Math.abs(a) - Math.abs(b); c++; } }
    if (c) d.push(s / c);
  }
  const n = d.length;
  if (n < 3) return { n, diff: NaN, stat: NaN, p: NaN };
  const mean = d.reduce((x, v) => x + v, 0) / n, L = Math.min(lag, n - 1);
  const gamma = (j: number): number => { let s = 0; for (let i = j; i < n; i++) s += (d[i]! - mean) * (d[i - j]! - mean); return s / n; };
  let v = gamma(0);
  for (let j = 1; j <= L; j++) v += 2 * (1 - j / (L + 1)) * gamma(j);
  const hh = L + 1, hln = (n + 1 - 2 * hh + (hh * (hh - 1)) / n) / n;
  const stat = v > 0 ? (mean / Math.sqrt(v / n)) * (hln > 0 ? Math.sqrt(hln) : 1) : mean === 0 ? 0 : Math.sign(mean) * Infinity;
  return { n, diff: mean, stat, p: Number.isFinite(stat) ? tTwoSided(stat, n - 1) : 0 };
}

/** The damped Holt-Winters one-step forecasts on the fitting window, written into pred (NaN elsewhere). */
function oneStepErrorsHw(A: Aggregated, run: RunInternal, pred: Float64Array): void {
  const { T, m } = run, y = A.yModel, hs = fitFrom(T, m), sub = y.subarray(hs), [a, be, ga, ph] = run.hwParams, st = hwInit(sub, m, T - hs);
  let l = st.l, b = st.b;
  const sv = st.s;
  for (let t = m; t < T - hs; t++) {
    const k = t % m, yt = sub[t];
    pred[hs + t] = l + ph * b + sv[k];
    if (A.made[hs + t]) { l += ph * b; b *= ph; continue; }
    const ln = a * (yt - sv[k]) + (1 - a) * (l + ph * b);
    b = be * (ln - l) + (1 - be) * ph * b; sv[k] = ga * (yt - ln) + (1 - ga) * sv[k]; l = ln;
  }
}

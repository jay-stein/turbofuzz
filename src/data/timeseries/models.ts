/**
 * Time Series page, layer 3: forecasts. Six models, every one backtested from earlier
 * dates against "repeat the last cycle"; bands come from those backtest errors, not
 * from a formula. No dependencies: a few hundred lines of typed arrays.
 */

import { eventWindowLen, type Grain, type TsTable } from "./base.js";
import { regular, type Aggregated, type TsConfig, type TsDriver } from "./aggregate.js";
import { decompose } from "./decompose.js";
import { cap, nounFor } from "./format.js";

export type ModelKey = "sn" | "hw" | "reg" | "theta" | "clim" | "ens";
export const MODEL_KEYS: readonly ModelKey[] = ["sn", "hw", "reg", "theta", "clim", "ens"];
export const MODEL_INFO: Readonly<Record<ModelKey, { name: string; meth: string }>> = {
  sn: { name: "Repeat last cycle", meth: "Seasonal naive" },
  hw: { name: "Smooth and damp", meth: "Holt-Winters, damped trend" },
  reg: { name: "Trend, seasons and drivers", meth: "Prophet-style regression" },
  theta: { name: "Steady trend", meth: "Theta method" },
  clim: { name: "Seasonal average", meth: "Mean of the same point in earlier cycles" },
  ens: { name: "Blend", meth: "Average of smooth-and-damp, steady trend and drivers" },
};

interface BandQ { q10: number; q90: number; q025: number; q975: number }
type HwParams = [number, number, number, number];
interface HwState { l: number; b: number; s: Float64Array }
interface RegFit {
  beta: Float64Array; p: number; fill: (i: number, x: Float64Array) => void; x: Float64Array; smear: number;
  K: number; Ky: number; Kw: number; Kd: number; T: number; drv: { d: TsDriver; log: boolean; mean: number }[]; iDrv: number; logY: boolean; maxLog: number;
}
interface ThetaFit { prof: Float64Array | null; b0: number; alpha: number; level: number; o: number; m: number }

/** What the page shows about one model (no closures, so it can leave the worker). */
export interface ModelSummary {
  key: ModelKey;
  mase: number;
  /** Backtest error relative to repeating the last cycle. */
  ratio: number;
  /** On the latest backtest: how many periods fell inside the 80% band built from the others. */
  check: { hit: number; tot: number } | null;
  hw?: { params: HwParams };
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
interface RunInternal extends ModelRun { hwFinal: HwState; hwParams: HwParams; regFit: RegFit; thetaFit: ThetaFit; climM: number; climMeans: Float64Array; q: Record<ModelKey, BandQ[]> }

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
function hwSSE(y: Float64Array, T: number, m: number, a: number, be: number, ga: number, ph: number): number {
  const st = hwInit(y, m, T);
  let l = st.l, b = st.b, sse = 0;
  const s = st.s;
  for (let t = m; t < T; t++) {
    const k = t % m, yt = y[t];
    const e = yt - (l + ph * b + s[k]);
    sse += e * e;
    const ln = a * (yt - s[k]) + (1 - a) * (l + ph * b);
    b = be * (ln - l) + (1 - be) * ph * b;
    s[k] = ga * (yt - ln) + (1 - ga) * s[k];
    l = ln;
  }
  return sse;
}
function hwFit(y: Float64Array, T: number, m: number, warm: HwParams | undefined): HwParams {
  const lo = [0.01, 0.001, 0.001, 0.8], hi = [0.99, 0.5, 0.7, 0.98];
  let p: HwParams = warm ? [...warm] : [0.3, 0.05, 0.15, 0.95];
  if (m === 1) p[2] = 0; // no season: plain damped trend
  let best = hwSSE(y, T, m, p[0], p[1], p[2], p[3]);
  const step = warm ? [0.04, 0.015, 0.04, 0.015] : [0.12, 0.04, 0.1, 0.04];
  for (let round = 0; round < 7; round++) {
    for (let j = 0; j < 4; j++) {
      if (m === 1 && j === 2) continue;
      for (const dir of [1, -1]) {
        const q: HwParams = [...p];
        q[j] = Math.min(hi[j], Math.max(lo[j], q[j] + dir * step[j]));
        const e = hwSSE(y, T, m, q[0], q[1], q[2], q[3]);
        if (e < best) { best = e; p = q; }
      }
    }
    for (let j = 0; j < 4; j++) step[j] *= 0.5;
  }
  return p;
}
function hwRun(y: Float64Array, T: number, m: number, p: HwParams, origins: number[]): { snaps: Map<number, HwState>; final: HwState } {
  const [a, be, ga, ph] = p;
  const st = hwInit(y, m, origins.length ? origins[0] : T);
  let l = st.l, b = st.b;
  const s = st.s;
  const snaps = new Map<number, HwState>();
  let oi = 0;
  for (let t = m; t < T; t++) {
    while (oi < origins.length && origins[oi] === t) { snaps.set(t, { l, b, s: s.slice() }); oi++; }
    const k = t % m, yt = y[t];
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
function regFit(A: Aggregated, table: TsTable, drivers: TsDriver[], y: Float64Array, T: number, flex: number): RegFit {
  const g: Grain = A.g, from = Math.max(0, T - REG_WIN), W = T - from;
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
  const rel = 0.3 * Math.pow(10, (5 - flex) / 2.5);
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
function thetaFit(y: Float64Array, o: number, m: number): ThetaFit {
  const s = fitFrom(o, m);
  if (s) return thetaFit(y.subarray(s, o), o - s, m);
  const d = m > 1 && o >= 2 * m + 2 ? decompose(y, o, m) : null;
  const prof = d ? d.prof : null;
  const z = new Float64Array(o);
  for (let i = 0; i < o; i++) z[i] = y[i] - (prof ? prof[i % m] : 0);
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (let i = 0; i < o; i++) { sx += i; sy += z[i]; sxx += i * i; sxy += i * z[i]; }
  const b0 = (o * sxy - sx * sy) / (o * sxx - sx * sx || 1);
  let best = Infinity, alpha = 0.5, level = z[0];
  for (let a = 0.05; a < 0.951; a += 0.05) {
    let l = z[0], sse = 0;
    for (let i = 1; i < o; i++) { const e = z[i] - l; sse += e * e; l += a * e; }
    if (sse < best) { best = sse; alpha = a; level = l; }
  }
  return { prof, b0, alpha, level, o, m };
}
function thetaAt(f: ThetaFit, h: number): number {
  const a = f.alpha;
  return f.level + (f.b0 / 2) * ((1 - Math.pow(1 - a, f.o)) / a + h) + (f.prof ? f.prof[(f.o + h) % f.m] : 0);
}
/** Climatology: the average of the same point in every earlier cycle. */
function phaseMeans(y: Float64Array, o: number, m: number): Float64Array {
  const sum = new Float64Array(m), cnt = new Float64Array(m);
  let all = 0;
  for (let i = 0; i < o; i++) { sum[i % m] += y[i]; cnt[i % m]++; all += y[i]; }
  const out = new Float64Array(m);
  for (let k = 0; k < m; k++) out[k] = cnt[k] ? sum[k] / cnt[k] : all / o;
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

/** Fits every model on [0, T) and backtests it from earlier origins. */
export function runModels(A: Aggregated, table: TsTable, cfg: TsConfig, splitReq: number | null, H: number, warm: HwWarm): (ModelRun & { internal: RunInternal }) | ModelError {
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
  let scale = 0, sc = 0;
  for (let t = m; t < T; t++) { scale += Math.abs(y[t] - y[t - m]); sc++; }
  scale = scale / (sc || 1) || 1;
  const oc = Object.fromEntries(MODEL_KEYS.map((k) => [k, new Float64Array(R * H)])) as Record<ModelKey, Float64Array>;

  origins.forEach((o, k) => { for (let h = 0; h < H; h++) oc.sn[k * H + h] = y[o - m + (h % m)]; });

  const wkey = [cfg.grain, cfg.agg, cfg.measure, cfg.group, cfg.gaps].join("|");
  const hs = fitFrom(T, m);
  const hwParams = hwFit(y.subarray(hs), T - hs, m, warm.get(wkey));
  warm.set(wkey, hwParams);
  const run = hwRun(y, T, m, hwParams, origins);
  origins.forEach((o, k) => { const st = run.snaps.get(o); if (st) hwForecast(st, m, hwParams[3], o, H, oc.hw, k * H); });

  origins.forEach((o, k) => { const f = regFit(A, table, cfg.drivers, y, o, cfg.flex); for (let h = 0; h < H; h++) oc.reg[k * H + h] = regAt(f, o + h); });
  const reg = regFit(A, table, cfg.drivers, y, T, cfg.flex);

  origins.forEach((o, k) => { const f = thetaFit(y, o, m); for (let h = 0; h < H; h++) oc.theta[k * H + h] = thetaAt(f, h); });
  const theta = thetaFit(y, T, m);

  const first = origins.length ? origins[0] : T;
  const climM = g.periods.filter((pp) => first >= pp).pop() || m;
  origins.forEach((o, k) => { const means = phaseMeans(y, o, climM); for (let h = 0; h < H; h++) oc.clim[k * H + h] = means[(o + h) % climM]; });
  const climMeans = phaseMeans(y, T, climM);

  for (let i = 0; i < R * H; i++) oc.ens[i] = (oc.hw[i] + oc.reg[i] + oc.theta[i]) / 3;

  const models = {} as Record<ModelKey, ModelSummary>;
  const q = {} as Record<ModelKey, BandQ[]>;
  for (const key of MODEL_KEYS) {
    const errs = new Float64Array(R * H).fill(NaN);
    let ae = 0, ac = 0;
    origins.forEach((o, k) => {
      for (let h = 0; h < H; h++) {
        if (A.made[o + h]) continue;
        const e = y[o + h] - oc[key][k * H + h];
        errs[k * H + h] = e; ae += Math.abs(e); ac++;
      }
    });
    q[key] = bandQuantiles(errs, origins.map((_, k) => k), H);
    let check: ModelSummary["check"] = null;
    if (R >= 4) {
      const qx = bandQuantiles(errs, origins.slice(0, -1).map((_, k) => k), H);
      let hit = 0, tot = 0;
      for (let h = 0; h < H; h++) { const e = errs[(R - 1) * H + h]; if (e !== e) continue; tot++; if (e >= qx[h].q10 && e <= qx[h].q90) hit++; }
      check = { hit, tot };
    }
    models[key] = { key, mase: ae / (ac || 1) / scale, ratio: 0, check };
  }
  const base = models.sn.mase || 1;
  for (const key of MODEL_KEYS) models[key].ratio = models[key].mase / base;
  models.hw.hw = { params: hwParams };
  models.reg.reg = { K: reg.K, Ky: reg.Ky, Kw: reg.Kw, Kd: reg.Kd, logY: reg.logY, drivers: reg.drv.map((v, j) => ({ col: v.d.col, log: v.log, beta: reg.beta[reg.iDrv + j], flag: !!table.flags[v.d.col] })) };
  models.theta.theta = { alpha: theta.alpha, b0: theta.b0, seasonal: theta.prof !== null };
  models.clim.clim = { m: climM };
  const best = (["hw", "reg", "ens", "theta", "clim", "sn"] as ModelKey[]).reduce((a, b) => (models[b].mase < models[a].mase ? b : a));
  const out: ModelRun = { T, H, m, origins, step, models, best, rough: R < 3, profile: seriesProfile(A, T) };
  return { ...out, internal: { ...out, hwFinal: run.final, hwParams, regFit: reg, thetaFit: theta, climM, climMeans, q } };
}

/** Future values and bands for every model. */
export function computeFutures(A: Aggregated, run: RunInternal): Futures {
  const { T, H, m } = run;
  const y = A.yModel;
  const F: Record<ModelKey, Float64Array> = {
    sn: new Float64Array(H), hw: new Float64Array(H), reg: new Float64Array(H), theta: new Float64Array(H), clim: new Float64Array(H), ens: new Float64Array(H),
  };
  hwForecast(run.hwFinal, m, run.hwParams[3], T, H, F.hw, 0);
  for (let h = 0; h < H; h++) {
    F.reg[h] = regAt(run.regFit, T + h);
    F.sn[h] = y[T - m + (h % m)];
    F.theta[h] = thetaAt(run.thetaFit, h);
    F.clim[h] = run.climMeans[(T + h) % run.climM];
    F.ens[h] = (F.hw[h] + F.reg[h] + F.theta[h]) / 3;
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

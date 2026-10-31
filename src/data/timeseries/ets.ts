/**
 * Automatic exponential smoothing in the state-space (innovations) form: ETS(error, trend,
 * season) with error A or M, trend N, A or damped A (Ad), season N, A or M. Every allowed form
 * is fitted by maximum likelihood over its smoothing parameters and starting states with
 * Nelder-Mead, and the form with the lowest AICc is kept. Written from the published
 * description, as a counterpart of R's forecast::ets():
 *
 * Hyndman, R. J., Koehler, A. B., Snyder, R. D. and Grose, S. (2002). A state space framework
 * for automatic forecasting using exponential smoothing methods. International Journal of
 * Forecasting, 18(3), 439-454.
 * Hyndman, R. J. and Khandakar, Y. (2008). Automatic time series forecasting: the forecast
 * package for R. Journal of Statistical Software, 27(3), 1-22.
 * Hyndman, R. J. and Athanasopoulos, G. (2021). Forecasting: Principles and Practice, 3rd ed.,
 * ch. 8 (the equations are those of sections 8.1-8.5; estimation and AICc, 8.6).
 * Hurvich, C. M. and Tsai, C.-L. (1989). Regression and time series model selection in small
 * samples. Biometrika, 76(2), 297-307.
 *
 * As in forecast::ets with its defaults: no multiplicative trend; additive errors never with a
 * multiplicative season (numerically unstable); multiplicative errors and seasons only for
 * series that are positive throughout; seasons only up to 24 periods; parameters kept in the
 * "usual" region (0 < alpha < 1, 0 < beta < alpha, 0 < gamma < 1 - alpha, 0.8 < phi < 0.98).
 * The starting-state heuristic (classical decomposition of the first cycles, and a straight line
 * through the first max(10, 2m) seasonally adjusted points) is the one the package describes.
 * Not done: the admissibility check on top of the usual region, and analytic prediction
 * intervals. No code was copied.
 */

import { nelderMead } from "./optimize.js";

export type EtsError = "A" | "M";
export type EtsTrend = "N" | "A" | "Ad";
export type EtsSeason = "N" | "A" | "M";
/** State between steps. s is indexed by phase (t mod m). */
export interface EtsState { l: number; b: number; s: Float64Array }
/** Starting state at the first observation: level, trend, and the seasonal values of the first m observations in order. */
export interface EtsInit { l: number; b: number; s: Float64Array }
export interface EtsParams { error: EtsError; trend: EtsTrend; season: EtsSeason; m: number; a: number; be: number; ga: number; ph: number }
export interface EtsFit extends EtsParams { init: EtsInit; aicc: number; loglik: number; tried: number }

/** "M,Ad,A": error, trend and season, as ETS is written. */
export function etsSpec(f: Pick<EtsParams, "error" | "trend" | "season">): string {
  return `${f.error},${f.trend},${f.season}`;
}

/** Whether the smoothing parameters are in the usual region. */
function usual(f: EtsParams): boolean {
  if (!(f.a >= 1e-4 && f.a <= 0.9999)) return false;
  if (f.trend !== "N" && !(f.be >= 1e-4 && f.be <= f.a)) return false;
  if (f.season !== "N" && !(f.ga >= 1e-4 && f.ga <= 1 - f.a)) return false;
  if (f.trend === "Ad" && !(f.ph >= 0.8 && f.ph <= 0.98)) return false;
  return true;
}

/**
 * One step of the innovations form. Returns the one-step forecast and moves the state past
 * y (a missing y moves it as a forecast with no innovation). NaN when the forecast breaks.
 *   mu = (l + phi b) combined with s;  eps = y - mu (A errors) or (y - mu) / mu (M errors)
 *   l' = l + phi b + alpha kl eps;  b' = phi b + beta kl eps;  s' = s + gamma ks eps
 * with the loadings kl and ks of fpp3 table 8.? (1 for A errors; the forecast for M errors with
 * no or an additive season; l + phi b and s for M errors with a multiplicative season).
 */
export function etsStep(st: EtsState, y: number, k: number, f: EtsParams): number {
  const dp = f.trend === "N" ? 0 : f.ph;
  const lp = st.l + dp * st.b;
  const sk = f.season === "N" ? 0 : st.s[k]!;
  const mu = f.season === "M" ? lp * sk : lp + sk;
  if (f.error === "M" && !(mu > 1e-12 || mu < -1e-12)) return NaN;
  if (!(y === y)) { st.b = dp * st.b; st.l = lp; return mu; }
  const e = y - mu, eps = f.error === "A" ? e : e / mu;
  let kl = 1, ks = 1;
  if (f.error === "M") { if (f.season === "M") { kl = lp; ks = sk; } else { kl = mu; ks = mu; } }
  st.l = lp + f.a * kl * eps;
  if (f.trend !== "N") st.b = dp * st.b + f.be * kl * eps;
  if (f.season !== "N") st.s[k] = sk + f.ga * ks * eps;
  return mu;
}

/** Initial state as an EtsState for a run that starts at index `from`. */
function stateAt(init: EtsInit, from: number, m: number, season: EtsSeason): EtsState {
  const s = new Float64Array(Math.max(1, m)).fill(season === "M" ? 1 : 0);
  if (season !== "N") for (let i = 0; i < m; i++) s[(from + i) % m] = init.s[i]!;
  return { l: init.l, b: init.b, s };
}

// ---------------------------------------------------------------- starting states

/**
 * Classical decomposition (as R's decompose(): a centred moving average of one season, the
 * phase means of what is left, normalised to sum to 0 or to average 1): the seasonal figure of
 * m values, indexed by position from the series start. Null with under two cycles.
 */
export function classicalFigure(y: ArrayLike<number>, from: number, n: number, m: number, mult: boolean): Float64Array | null {
  if (n < 2 * m) return null;
  const trend = new Float64Array(n).fill(NaN);
  const half = m >> 1;
  for (let t = half; t < n - half; t++) {
    let s = 0, c = 0;
    if (m % 2 === 0) {
      for (let j = -half; j <= half; j++) { const w = j === -half || j === half ? 0.5 : 1; const v = y[from + t + j]!; if (v === v) { s += w * v; c += w; } }
    } else {
      for (let j = -half; j <= half; j++) { const v = y[from + t + j]!; if (v === v) { s += v; c++; } }
    }
    trend[t] = c > 0 ? s / c : NaN;
  }
  const fig = new Float64Array(m);
  for (let i = 0; i < m; i++) {
    let s = 0, c = 0;
    for (let t = i; t < n; t += m) {
      const tr = trend[t]!, v = y[from + t]!;
      if (tr === tr && v === v && (!mult || tr !== 0)) { s += mult ? v / tr : v - tr; c++; }
    }
    fig[i] = c ? s / c : mult ? 1 : 0;
  }
  let mean = 0;
  for (let i = 0; i < m; i++) mean += fig[i]!;
  mean /= m;
  for (let i = 0; i < m; i++) fig[i] = mult ? fig[i]! / (mean || 1) : fig[i]! - mean;
  return fig;
}

/** Ordinary least squares of y on the columns of X (small systems), by Gauss-Jordan elimination. */
function ols(X: number[][], y: number[]): number[] | null {
  const p = X[0]!.length, A: number[][] = Array.from({ length: p }, () => new Array<number>(p + 1).fill(0));
  for (let r = 0; r < X.length; r++) for (let i = 0; i < p; i++) { for (let j = 0; j < p; j++) A[i]![j]! += X[r]![i]! * X[r]![j]!; A[i]![p]! += X[r]![i]! * y[r]!; }
  for (let i = 0; i < p; i++) {
    let piv = i;
    for (let r = i + 1; r < p; r++) if (Math.abs(A[r]![i]!) > Math.abs(A[piv]![i]!)) piv = r;
    if (Math.abs(A[piv]![i]!) < 1e-12) return null;
    [A[i], A[piv]] = [A[piv]!, A[i]!];
    for (let r = 0; r < p; r++) if (r !== i) { const f = A[r]![i]! / A[i]![i]!; for (let c = i; c <= p; c++) A[r]![c]! -= f * A[i]![c]!; }
  }
  return A.map((row, i) => row[p]! / row[i]!);
}

/** The seasonal values of the first m observations, as the starting heuristic of forecast::ets gives them. */
function seasonalStart(y: ArrayLike<number>, from: number, n: number, m: number, mult: boolean): Float64Array {
  const fig = n >= 3 * m ? classicalFigure(y, from, n, m, mult) : null;
  if (fig) { const s = new Float64Array(m); for (let i = 0; i < m; i++) s[i] = fig[i]!; return s; }
  const norm = (s: Float64Array): Float64Array => {
    let mean = 0;
    for (let i = 0; i < m; i++) mean += s[i]!;
    mean /= m;
    for (let i = 0; i < m; i++) s[i] = mult ? s[i]! / (mean || 1) : s[i]! - mean;
    return s;
  };
  // Under three cycles: a straight line plus one pair of harmonics; the first m deviations from the line.
  const X: number[][] = [], z: number[] = [];
  for (let t = 1; t <= n; t++) { const v = y[from + t - 1]!; if (v === v) { X.push([1, t, Math.sin((2 * Math.PI * t) / m), Math.cos((2 * Math.PI * t) / m)]); z.push(v); } }
  const beta = X.length > 4 ? ols(X, z) : null;
  const s = new Float64Array(m).fill(mult ? 1 : 0);
  if (!beta) return s;
  for (let i = 0; i < m; i++) { const v = y[from + i]!, line = beta[0]! + beta[1]! * (i + 1); s[i] = v === v ? (mult ? (line !== 0 ? v / line : 1) : v - line) : s[i]!; }
  return norm(s);
}

/** Starting state for a form: the heuristic of forecast::ets. y is the filled series (no gaps). */
export function etsInitial(y: ArrayLike<number>, from: number, n: number, m: number, trend: EtsTrend, season: EtsSeason): EtsInit {
  const seas = season !== "N" && m >= 2;
  const s = seas ? seasonalStart(y, from, n, m, season === "M") : new Float64Array(0);
  const maxn = Math.min(Math.max(10, 2 * (seas ? m : 1)), n);
  const adj = new Float64Array(maxn);
  for (let i = 0; i < maxn; i++) { const v = y[from + i]!; adj[i] = seas ? (season === "M" ? (s[i % m]! !== 0 ? v / s[i % m]! : v) : v - s[i % m]!) : v; }
  if (trend === "N") { let mean = 0; for (let i = 0; i < maxn; i++) mean += adj[i]!; return { l: mean / maxn, b: 0, s }; }
  // Straight line through the seasonally adjusted first max(10, 2m) points; the level is its value at time 0.
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (let i = 0; i < maxn; i++) { const x = i + 1; sx += x; sy += adj[i]!; sxx += x * x; sxy += x * adj[i]!; }
  const den = maxn * sxx - sx * sx, b = den !== 0 ? (maxn * sxy - sx * sy) / den : 0, l = (sy - b * sx) / maxn;
  return { l: Math.abs(l + b) < 1e-8 ? l * 1.001 : l, b: Math.abs(l + b) < 1e-8 ? b * 0.999 : b, s };
}

// ---------------------------------------------------------------- likelihood and fitting

/**
 * -2 log likelihood up to a constant that is the same for every form on the same data:
 * n ln(sum eps^2) + 2 sum ln|mu| (the second term for multiplicative errors only).
 */
function minusTwoLogLik(y: ArrayLike<number>, from: number, T: number, f: EtsParams, init: EtsInit): { lik: number; n: number } {
  const st = stateAt(init, from, f.m, f.season);
  let sse = 0, logs = 0, n = 0;
  for (let t = from; t < T; t++) {
    const yt = y[t]!, mu = etsStep(st, yt, t % f.m, f);
    if (!Number.isFinite(mu) || !Number.isFinite(st.l)) return { lik: Infinity, n: 0 };
    if (yt === yt) { const e = yt - mu, eps = f.error === "A" ? e : e / mu; sse += eps * eps; if (f.error === "M") logs += Math.log(Math.abs(mu)); n++; }
  }
  if (!(sse > 0) || n === 0) return { lik: Infinity, n };
  return { lik: n * Math.log(sse) + 2 * logs, n };
}

/** Fits one form over [from, T): smoothing parameters and starting states by Nelder-Mead from the heuristic start. */
interface FitOptions { freeSeasonal: boolean; maxEvals: number; restart: boolean; warm?: EtsFit }
function fitForm(y: ArrayLike<number>, from: number, T: number, m: number, error: EtsError, trend: EtsTrend, season: EtsSeason, yi: ArrayLike<number>, opt: FitOptions): EtsFit | null {
  const n = T - from;
  const seas = season !== "N";
  const init0 = opt.warm ? opt.warm.init : etsInitial(yi, from, n, m, trend, season);
  const free = seas && opt.freeSeasonal;
  const hasB = trend !== "N", hasD = trend === "Ad", mm = seas ? m : 1;
  let scale = 0, cnt = 0;
  for (let t = from; t < T; t++) { const v = y[t]!; if (v === v) { scale += Math.abs(v); cnt++; } }
  scale = cnt ? scale / cnt : 1;
  // Parameter vector: alpha, [beta], [gamma], [phi], l0, [b0], [s0 .. s(m-2)].
  const w = opt.warm;
  const a0 = w ? w.a : seas ? 0.1 : 0.3;
  const x0: number[] = [a0];
  const steps: number[] = [0.05];
  if (hasB) { x0.push(w ? w.be : 0.1 * a0); steps.push(0.01); }
  if (seas) { x0.push(w ? w.ga : Math.min(0.05, (1 - a0) / 2)); steps.push(0.02); }
  if (hasD) { x0.push(w ? w.ph : 0.95); steps.push(0.03); }
  x0.push(init0.l); steps.push(0.05 * Math.abs(init0.l) + 0.01 * scale + 1e-6);
  if (hasB) { x0.push(init0.b); steps.push(0.1 * Math.abs(init0.b) + 0.005 * scale + 1e-6); }
  if (free) for (let i = 0; i < m - 1; i++) { x0.push(init0.s[i]!); steps.push(season === "M" ? 0.03 : 0.03 * scale + 1e-6); }
  const decode = (x: number[]): { f: EtsParams; init: EtsInit } => {
    let i = 0;
    const a = x[i++]!, be = hasB ? x[i++]! : 0, ga = seas ? x[i++]! : 0, ph = hasD ? x[i++]! : hasB ? 1 : 1;
    const l = x[i++]!, b = hasB ? x[i++]! : 0;
    const s = new Float64Array(seas ? m : 0);
    if (free) { let sum = 0; for (let k = 0; k < m - 1; k++) { s[k] = x[i++]!; sum += s[k]!; } s[m - 1] = season === "M" ? m - sum : -sum; }
    else if (seas) s.set(init0.s);
    return { f: { error, trend, season, m: mm, a, be, ga, ph }, init: { l, b, s } };
  };
  const objective = (x: number[]): number => {
    const { f, init } = decode(x);
    if (!usual(f)) return 1e30;
    if (season === "M") { for (let k = 0; k < m; k++) if (!(init.s[k]! > 0)) return 1e30; }
    if (error === "M" && (init.l + (hasB ? init.b : 0) <= 0)) return 1e30;
    const { lik } = minusTwoLogLik(y, from, T, f, init);
    return Number.isFinite(lik) ? lik : 1e30;
  };
  let best = nelderMead(objective, x0, steps, opt.maxEvals);
  // One restart from the best point: simplex methods often stop early on a flat ridge.
  if (opt.restart && best.f < 1e29) best = nelderMead(objective, best.x, steps.map((v) => v * 0.5), opt.maxEvals);
  if (!(best.f < 1e29)) return null;
  const { f, init } = decode(best.x);
  const k = 1 + (hasB ? 1 : 0) + (seas ? 1 : 0) + (hasD ? 1 : 0) + 1 + (hasB ? 1 : 0) + (seas ? m - 1 : 0) + 1;
  const { lik, n: nObs } = minusTwoLogLik(y, from, T, f, init);
  if (nObs - k - 1 <= 0 || !Number.isFinite(lik)) return null;
  const aicc = lik + 2 * k + (2 * k * (k + 1)) / (nObs - k - 1);
  return { ...f, init, aicc, loglik: -0.5 * lik, tried: 0 };
}

/**
 * Simple exponential smoothing by maximum likelihood, ETS(A,N,N): the smoothing parameter and
 * the starting level are estimated, as forecast::ses() does for the Theta method. z may hold
 * NaN where a period is filled. Returns the parameter and the level after the last observation.
 */
export function fitSes(z: Float64Array, n: number): { alpha: number; level: number } {
  let first = NaN;
  for (let t = 0; t < n && !(first === first); t++) first = z[t]!;
  const filled = Float64Array.from({ length: n }, (_, t) => (z[t]! === z[t]! ? z[t]! : first));
  const fit = fitForm(z, 0, n, 1, "A", "N", "N", filled, { freeSeasonal: false, maxEvals: 300, restart: true });
  const alpha = fit ? fit.a : 0.3;
  const st: EtsState = { l: fit ? fit.init.l : first, b: 0, s: new Float64Array(1) };
  const f: EtsParams = { error: "A", trend: "N", season: "N", m: 1, a: alpha, be: 0, ga: 0, ph: 1 };
  for (let t = 0; t < n; t++) etsStep(st, z[t]!, 0, f);
  return { alpha, level: st.l };
}

/** ETS learns from the latest stretch: older periods barely move it, and fitting is the cost. */
export function etsFrom(T: number, m: number): number {
  const w = Math.max(300, 6 * m);
  return T > w ? Math.floor((T - w) / Math.max(1, m)) * Math.max(1, m) : 0;
}

/** Fitted forms kept for the same stretch of the same series (a horizon drag refits nothing). */
const etsCache = new Map<string, EtsFit>();

/**
 * The ETS form with the lowest AICc over [from, T) of y (NaN where a period is filled), with yi
 * the filled series used for the starting states; from the cache when this stretch was fitted before.
 */
export function etsSelect(y: Float64Array, from: number, T: number, m: number, yi: Float64Array = y): EtsFit {
  let sum = 0;
  const stride = Math.max(1, Math.floor((T - from) / 64));
  for (let t = from; t < T; t += stride) sum += y[t] === y[t] ? y[t]! : 0.5;
  const key = `${from}|${T}|${m}|${sum}|${y[T - 1]}`;
  const hit = etsCache.get(key);
  if (hit) return hit;
  const fit = selectFresh(y, from, T, m, yi);
  if (etsCache.size > 64) etsCache.clear();
  etsCache.set(key, fit);
  return fit;
}

function selectFresh(y: Float64Array, from: number, T: number, m: number, yi: Float64Array): EtsFit {
  let positive = true;
  for (let t = from; t < T; t++) if (y[t] === y[t] && !(y[t]! > 0)) { positive = false; break; }
  const n = T - from;
  const seasons: EtsSeason[] = m >= 2 && m <= 24 && n >= 2 * m + 2 ? (positive ? ["N", "A", "M"] : ["N", "A"]) : ["N"];
  const errors: EtsError[] = positive ? ["A", "M"] : ["A"];
  // Stage 1: every allowed form, with the seasonal starting states fixed at the heuristic (at most
  // six dimensions). Stage 2: the best few forms refitted with every starting state free, from the
  // stage-1 answer, and ranked again. R's ets() frees every state in every form; this keeps the
  // choice and most of the likelihood at a fraction of the cost.
  const stage1: EtsFit[] = [];
  let tried = 0;
  for (const error of errors) {
    for (const season of seasons) {
      if (error === "A" && season === "M") continue; // unstable; forecast::ets leaves these out
      for (const trend of ["N", "A", "Ad"] as EtsTrend[]) {
        const fit = fitForm(y, from, T, season === "N" ? 1 : m, error, trend, season, yi, { freeSeasonal: false, maxEvals: 600, restart: true });
        tried++;
        if (fit) stage1.push(fit);
      }
    }
  }
  stage1.sort((p, q) => p.aicc - q.aicc);
  const finalists = stage1.slice(0, 3).map((f) => (f.season === "N" ? f : fitForm(y, from, T, f.m, f.error, f.trend, f.season, yi, { freeSeasonal: true, maxEvals: Math.min(2500, 200 * (f.m + 6)), restart: false, warm: f }) ?? f));
  let best: EtsFit | null = null;
  for (const f of [...finalists, ...stage1.slice(3)]) if (best === null || f.aicc < best.aicc) best = f;
  if (best) return { ...best, tried };
  const init = etsInitial(yi, from, n, 1, "N", "N");
  return { error: "A", trend: "N", season: "N", m: 1, a: 0.3, be: 0, ga: 0, ph: 1, init, aicc: NaN, loglik: NaN, tried };
}

/**
 * Runs a fitted ETS from `from` to T and returns the state at each origin and at the end.
 * The fit's own starting state is used when the run starts where the fit did (fitInit);
 * otherwise (a rolling window, or a new decomposition) the heuristic start is recomputed.
 */
export function etsRun(y: Float64Array, from: number, T: number, f: EtsFit, origins: number[], yi: Float64Array = y, fitInit = true): { snaps: Map<number, EtsState>; final: EtsState } {
  const init = fitInit ? f.init : etsInitial(yi, from, T - from, f.m, f.trend, f.season);
  const st = stateAt(init, from, f.m, f.season);
  const snaps = new Map<number, EtsState>();
  let oi = 0;
  while (oi < origins.length && origins[oi]! < from) oi++;
  for (let t = from; t < T; t++) {
    while (oi < origins.length && origins[oi] === t) { snaps.set(t, { l: st.l, b: st.b, s: st.s.slice() }); oi++; }
    etsStep(st, y[t]!, t % f.m, f);
  }
  return { snaps, final: { l: st.l, b: st.b, s: st.s.slice() } };
}

/** One-step forecasts over [from, T) from the fit's own starting state, written into out at the same indices. */
export function etsFitted(y: Float64Array, from: number, T: number, f: EtsFit, out: Float64Array): void {
  const st = stateAt(f.init, from, f.m, f.season);
  for (let t = from; t < T; t++) out[t] = etsStep(st, y[t]!, t % f.m, f);
}

/** H forecasts from a state at position t0, written into out from off. */
export function etsForecast(st: EtsState, f: EtsParams, t0: number, H: number, out: Float64Array, off: number): void {
  let damp = 0, pw = 1;
  for (let h = 0; h < H; h++) {
    if (f.trend === "Ad") { pw *= f.ph; damp += pw; } else if (f.trend === "A") damp = h + 1;
    const base = st.l + damp * st.b, sk = f.season === "N" ? 0 : st.s[(t0 + h) % f.m] ?? 0;
    out[off + h] = f.season === "M" ? base * sk : base + sk;
  }
}

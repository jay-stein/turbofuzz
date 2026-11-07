/**
 * The AutoARIMA job behind the Forecast tab's deep run: choose the differences, search the orders, report the fit, forecast with
 * analytic intervals, and score the chosen order on the same backtest folds as the board (orders held, coefficients refitted
 * on each fold's history). Pure: the page runs it in a worker it can stop, and the tests call it directly.
 */

import {
  akaikeWeights, averageForecasts, autoArimaSearch, chooseDifferences, differencingVote, fitArima, forecastArima, residualCheck, specLabel,
  type ArimaCoef, type ArimaFit, type ArimaSpec, type ResidualCheck, type TriedModel,
} from "./arima.js";
import { boxCox, invBoxCox } from "./boxcox.js";
import { mstl } from "./stl.js";

export interface ArimaJob {
  /** The modelled series up to the end of the data, NaN where a period was filled in (the fit skips those). */
  y: Float64Array;
  /** Fit on [0, T); the forecast starts at T. */
  T: number;
  H: number;
  /** The main season of the grain, and what the board's smoothing models did about it. */
  m: number;
  seasonMode: "none" | "native" | "mstl";
  /** The board's backtest folds, so the order is scored on the same ones. */
  origins: number[];
  rolling: boolean;
  trainLen: number | null;
  /** The last fold is the lockbox. */
  lockbox: boolean;
  /** The power in use on the board, applied here too. */
  lambda: number | null;
  nonNeg: boolean;
  /** Try every order, not only the stepwise neighbourhood (slow). */
  exhaustive: boolean;
  /** The seasons removed first when the season is too long for ARIMA (mode "mstl"), shortest first. */
  periods?: number[];
  /** DV-ARIMA: choose the differencing by a forecast vote beside the unit-root test. Off unless asked for; not with every order. */
  vote?: boolean;
}

export interface ArimaProgress { stage: string; tried: number; best: string; bestAicc: number; current: string; detail: string }

/** One candidate differencing in the vote, with its share. */
export interface ArimaVoteRow { d: number; D: number; label: string; err: number; weight: number; unitRoot: boolean }

/** The models averaged into the forecast, with their weights. */
export interface ArimaAveraged { label: string; weight: number }

export interface ArimaBacktest {
  folds: number;
  /** Mean absolute error on the selection folds, and the same for repeating the last cycle: the ratio is the board's "error against". */
  mae: number; maeSeasonalNaive: number; ratio: number;
  /** MASE, as the board's default measure: the error over the in-sample error of repeating the last cycle before the first fold. */
  mase: number;
  /** The same on the lockbox fold, or null. */
  lockMae: number | null; lockRatio: number | null; lockMase: number | null;
  /** Selection folds where it beat repeating the last cycle, out of those scored. */
  foldsWon: number; foldsOf: number;
  /** The same ratio for the single best model alone, to show what the averaging did. */
  ratioBestOnly: number;
}

export type ArimaResult =
  | { ok: false; reason: string }
  | {
    ok: true;
    label: string;
    spec: ArimaSpec;
    coefs: ArimaCoef[];
    sigma2: number; loglik: number; aic: number; aicc: number; bic: number; nUsed: number; k: number; converged: boolean;
    differences: { d: number; D: number; kpss: number[]; strength: number; m: number };
    tried: TriedModel[];
    /** The forecast the page shows: the weighted average of the models the search found, ranges including their disagreement. */
    forecast: { F: number[]; lo80: number[]; hi80: number[]; lo95: number[]; hi95: number[] };
    /** The best model's own forecast and ranges. */
    forecastBest: { F: number[]; lo80: number[]; hi80: number[]; lo95: number[]; hi95: number[] };
    averaged: ArimaAveraged[];
    /** The differencing vote, or null when it was off or could not be run. */
    vote: ArimaVoteRow[] | null;
    /** What plain auto.arima (the unit-root tests alone) settles on, for comparison. */
    plainLabel: string;
    /** Set when a season too long for ARIMA was removed with STL first: the periods removed, and how much history was used. */
    adjusted: { periods: number[]; used: number } | null;
    resid: ResidualCheck | null;
    backtest: ArimaBacktest | null;
    lambda: number | null;
    searched: "stepwise" | "every order";
    seconds: number;
    /** Set only when the folds were left to the caller (deferFolds): what they need. */
    pending?: FoldContext;
  };

/** Takes the seasons out of yFull[s0, e) with STL (a season too long for ARIMA), keeping their continuation over the horizon. */
function stripper(job: ArimaJob, yFull: Float64Array): (s0: number, e: number) => { s: number; adj: Float64Array; sf: Float64Array; ps: number[] } | null {
  const periodsAll = job.periods && job.periods.length ? job.periods : [job.m];
  const win = Math.max(1000, 6 * job.m);
  return (s0: number, e: number): { s: number; adj: Float64Array; sf: Float64Array; ps: number[] } | null => {
    const s = Math.max(s0, e - win, 0), n = e - s;
    const ps = periodsAll.filter((p) => n >= 2 * p + 2);
    if (ps.length === 0) return null;
    const raw = yFull.slice(s, e);
    // The decomposition needs every period: fill gaps by straight lines (the fit itself skips them again).
    const filled = Float64Array.from(raw);
    let prev = -1;
    for (let t = 0; t < n; t++) {
      if (filled[t]! !== filled[t]!) continue;
      if (prev >= 0 && t - prev > 1) for (let k = prev + 1; k < t; k++) filled[k] = filled[prev]! + ((filled[t]! - filled[prev]!) * (k - prev)) / (t - prev);
      else if (prev < 0) for (let k = 0; k < t; k++) filled[k] = filled[t]!;
      prev = t;
    }
    if (prev < 0) return null;
    for (let k = prev + 1; k < n; k++) filled[k] = filled[prev]!;
    const dec = mstl(filled, ps, 1);
    const part = new Float64Array(n), sf = new Float64Array(job.H);
    ps.forEach((p, i) => {
      const comp = dec.seasonal[i]!;
      for (let t = 0; t < n; t++) part[t] = part[t]! + comp[t]!;
      for (let h = 0; h < job.H; h++) sf[h] = sf[h]! + comp[n - p + (h % p)]!;
    });
    const adj = new Float64Array(n);
    for (let t = 0; t < n; t++) adj[t] = raw[t]! === raw[t]! ? raw[t]! - part[t]! : Number.NaN;
    return { s, adj, sf, ps };
  };
}

/** What a fold needs besides the job: the chosen model and the team averaged into the forecast, fitted on the full history. */
export interface FoldContext { job: ArimaJob; best: ArimaFit; team: { fit: ArimaFit; weight: number }[] }

/** One fold's error sums. Folds are independent of each other, so they can be scored on separate threads and added up after. */
export interface FoldOut {
  k: number; lock: boolean;
  /** Selection folds: absolute error of the forecast, of repeating the last cycle, and of the best model alone, over `an` points. */
  ae: number; se: number; an: number; bestAe: number;
  /** The same on the lockbox fold. */
  lockAe: number; lockSe: number; lockN: number;
  /** This fold alone, for "folds won". */
  foldAe: number; foldSe: number; foldN: number;
}

/** Refits the held orders on fold k's history and scores their forecast of the next H periods; null when the fold cannot be scored. */
export function foldScore(ctx: FoldContext, k: number): FoldOut | null {
  const { job, best, team } = ctx;
  const bc = job.lambda;
  const m = job.seasonMode === "native" ? job.m : 1;
  const long = job.seasonMode === "mstl";
  const yFull = bc === null ? job.y : boxCox(job.y, bc);
  const inv = (v: number): number => (bc === null ? v : invBoxCox(v, bc));
  const floor = (v: number): number => (job.nonNeg ? Math.max(0, v) : v);
  const strip = stripper(job, yFull);
  const R = job.origins.length;
  const o = job.origins[k]!;
  const start = job.rolling && job.trainLen !== null ? Math.max(0, Math.floor((o - job.trainLen) / Math.max(1, m)) * Math.max(1, m)) : 0;
  const cut = long ? strip(start, o) : null;
  if (long && cut === null) return null;
  const seg = cut ? cut.adj : yFull.slice(start, o);
  // The seasonal part added back: this fold's own, or the full history's when the season was not removed per fold.
  const seas = cut ? cut.sf : (long ? strip(0, job.T)?.sf : null) ?? new Float64Array(job.H);
  // Each fold's history is the full history cut short, so the full fit's coefficients are a start close to the answer.
  const f = fitArima(seg, best.spec, { from: best });
  if (!f) return null;
  // The averaged forecast: each member's order refitted on this fold, with the weights from the full history.
  const memberFc: { F: Float64Array; w: number }[] = [];
  for (const t of team) {
    const mf = t.fit.spec === best.spec ? f : fitArima(seg, t.fit.spec, { from: t.fit });
    if (mf) memberFc.push({ F: forecastArima(seg, mf, job.H).F, w: t.weight });
  }
  const wsum = memberFc.reduce((a, b) => a + b.w, 0) || 1;
  const pred = new Float64Array(job.H);
  for (const mm of memberFc) for (let h = 0; h < job.H; h++) pred[h] = pred[h]! + (mm.w / wsum) * mm.F[h]!;
  for (let h = 0; h < job.H; h++) pred[h] = pred[h]! + seas[h]!;
  const bestPred = Float64Array.from(forecastArima(seg, f, job.H).F, (v, h) => v + seas[h]!);
  const out: FoldOut = { k, lock: job.lockbox && k === R - 1, ae: 0, se: 0, an: 0, bestAe: 0, lockAe: 0, lockSe: 0, lockN: 0, foldAe: 0, foldSe: 0, foldN: 0 };
  for (let h = 0; h < job.H; h++) {
    const actual = job.y[o + h]!;
    if (!(actual === actual)) continue;
    const e = Math.abs(actual - floor(inv(pred[h]!)));
    const eBest = Math.abs(actual - floor(inv(bestPred[h]!)));
    const ref = job.y[o - Math.max(1, job.m) + (h % Math.max(1, job.m))];
    const s = ref === ref ? Math.abs(actual - ref!) : NaN;
    if (!(e === e) || !(s === s) || !(eBest === eBest)) continue;
    if (out.lock) { out.lockAe += e; out.lockSe += s; out.lockN++; }
    else { out.ae += e; out.se += s; out.an++; out.foldAe += e; out.foldSe += s; out.foldN++; out.bestAe += eBest; }
  }
  return out;
}

/** The backtest figures from the folds' sums, added in fold order so the totals do not depend on which thread scored which. */
export function combineFolds(job: ArimaJob, outs: FoldOut[]): ArimaBacktest | null {
  const R = job.origins.length;
  if (R === 0) return null;
  const sel = job.lockbox ? R - 1 : R;
  let ae = 0, an = 0, se = 0, lockAe = 0, lockSe = 0, lockN = 0, won = 0, of = 0, bestAe = 0;
  // The MASE scale: the in-sample error of repeating the last cycle on the history before the first fold.
  let scale = 0, sc = 0;
  const lag = Math.max(1, job.m);
  for (let t = lag; t < job.origins[0]!; t++) { const dv = Math.abs(job.y[t]! - job.y[t - lag]!); if (dv === dv) { scale += dv; sc++; } }
  scale = scale / (sc || 1) || 1;
  for (const o of [...outs].sort((a, b) => a.k - b.k)) {
    ae += o.ae; se += o.se; an += o.an; bestAe += o.bestAe; lockAe += o.lockAe; lockSe += o.lockSe; lockN += o.lockN;
    if (!o.lock && o.foldN > 0) { of++; if (o.foldAe < o.foldSe) won++; }
  }
  if (an === 0) return null;
  return {
    folds: sel, mae: ae / an, maeSeasonalNaive: se / an, ratio: se > 0 ? ae / se : NaN, mase: ae / an / scale,
    lockMae: lockN > 0 ? lockAe / lockN : null, lockRatio: lockN > 0 && lockSe > 0 ? lockAe / lockSe : null, lockMase: lockN > 0 ? lockAe / lockN / scale : null,
    foldsWon: won, foldsOf: of, ratioBestOnly: se > 0 ? bestAe / se : NaN,
  };
}

/** Fills in the backtest of a result that was returned with its folds pending. */
export function withBacktest(result: Extract<ArimaResult, { ok: true }>, outs: FoldOut[]): ArimaResult {
  const { pending, ...rest } = result;
  return pending ? { ...rest, backtest: combineFolds(pending.job, outs) } : result;
}

export function runAutoArima(job: ArimaJob, onProgress: (p: ArimaProgress) => void = () => {}, cancelled: () => boolean = () => false, opts: { deferFolds?: boolean } = {}): ArimaResult {
  const t0 = Date.now();
  const m = job.seasonMode === "native" ? job.m : 1;
  const bc = job.lambda;
  const yFull = bc === null ? job.y : boxCox(job.y, bc);
  // A season too long for ARIMA (a week of half-hours, a day of minutes) is removed with STL first and ARIMA is fitted to what is
  // left, the seasonal part added back to the forecast: the textbook's way (fpp3 12.1, R's stlf), and what the board's models do.
  const long = job.seasonMode === "mstl";
  const periodsAll = job.periods && job.periods.length ? job.periods : [job.m];
  const strip = stripper(job, yFull);
  const strip0 = long ? strip(0, job.T) : null;
  if (long && strip0 === null) {
    const need = 2 * Math.min(...periodsAll) + 2;
    return { ok: false, reason: `This series repeats every ${job.m} periods, and ARIMA needs the season taken out first, which takes at least two full cycles of history (${need.toLocaleString()} readings here). There are ${job.T.toLocaleString()}. Use a coarser period (hourly instead of half-hourly, say) or more history.` };
  }
  const sf0 = strip0 ? strip0.sf : new Float64Array(job.H);
  const y = strip0 ? strip0.adj : yFull.slice(0, job.T);
  const known = y.reduce((n, v) => n + (v === v ? 1 : 0), 0);
  if (known < 12) return { ok: false, reason: `Only ${known} readings: too few to fit an ARIMA model.` };
  onProgress({ stage: "Choosing the differences", tried: 0, best: "", bestAicc: NaN, current: "", detail: "" });
  const dd = chooseDifferences(y, m);
  onProgress({ stage: "Searching the orders", tried: 0, best: "", bestAicc: NaN, current: "", detail: `d = ${dd.d}, D = ${dd.D}` });
  // As R does, a long series (over 150 readings, or a season over 12) is searched with the quick fit and its best three refitted
  // exactly; a shorter one has every model fitted exactly. Trying every order is always exact.
  const approximate = !job.exhaustive && (known > 150 || m > 12);
  const found = autoArimaSearch(y, m, dd.d, dd.D, {
    exhaustive: job.exhaustive,
    approximate,
    cancelled,
    onProgress: (p) => onProgress({ stage: job.exhaustive ? "Trying every order" : "Searching the orders", tried: p.tried, best: p.best, bestAicc: p.bestAicc, current: p.current, detail: `d = ${dd.d}, D = ${dd.D}` }),
  });
  if (!found) return { ok: false, reason: cancelled() ? "Stopped." : "No ARIMA model could be fitted to this series." };
  // DV-ARIMA: the search again at the neighbouring differencings, and the forecast chosen across all of them.
  let team = akaikeWeights(found.fits);
  let voteRows: ArimaVoteRow[] | null = null;
  if (job.vote === true && !job.exhaustive) {
    const v = differencingVote(y, m, job.H, dd, team, {
      approximate, cancelled,
      onGroup: (d, D) => onProgress({ stage: "Voting on the differencing", tried: found.tried.length, best: specLabel(found.best.spec), bestAicc: found.best.aicc, current: "", detail: `trying d = ${d}, D = ${D}` }),
    });
    if (v) {
      team = v.team;
      const label = (g: { d: number; D: number }): string => `d = ${g.d}${m > 1 ? `, D = ${g.D}` : ""}`;
      voteRows = v.groups.map((g) => ({ d: g.d, D: g.D, label: label(g), err: g.err, weight: g.weight, unitRoot: g.unitRoot })).sort((a, b) => b.weight - a.weight);
    }
  }
  if (cancelled()) return { ok: false, reason: "Stopped." };
  // The leading model again, with standard errors from the numerical Hessian.
  const lead = voteRows ? team[0]!.fit : found.best;
  onProgress({ stage: "Standard errors", tried: found.tried.length, best: specLabel(lead.spec), bestAicc: lead.aicc, current: "", detail: "" });
  const best = fitArima(y, lead.spec, { se: true, from: lead }) ?? lead;
  const inv = (v: number): number => (bc === null ? v : invBoxCox(v, bc));
  const floor = (v: number): number => (job.nonNeg ? Math.max(0, v) : v);
  const fc = forecastArima(y, best, job.H);
  const back = (a: Float64Array | number[]): number[] => Array.from(a, (v) => floor(inv(v)));
  // Averaging over the models the search tried, by Akaike weights, steadies the forecast against the luck of which one had the lowest AICc.
  team = team.map((t) => (t.fit === lead ? { fit: best, weight: t.weight } : t));
  const avgFc = averageForecasts(y, team, job.H);
  const toBack = (f: { F: ArrayLike<number>; lo80: ArrayLike<number>; hi80: ArrayLike<number>; lo95: ArrayLike<number>; hi95: ArrayLike<number> }) => {
    const sh = (a: ArrayLike<number>): number[] => back(Array.from(a, (v, h) => v + sf0[h]!));
    return { F: sh(f.F), lo80: sh(f.lo80), hi80: sh(f.hi80), lo95: sh(f.lo95), hi95: sh(f.hi95) };
  };
  const resid = residualCheck(best);

  // Backtest: the order is held, the coefficients refitted on each fold's history, scored on the original scale.
  const R = job.origins.length;
  const ctx: FoldContext = { job, best, team };
  let backtest: ArimaBacktest | null = null;
  const pending = R > 0 && opts.deferFolds === true;
  if (R > 0 && !pending) {
    const outs: FoldOut[] = [];
    for (let k = 0; k < R; k++) {
      if (cancelled()) break;
      onProgress({ stage: `Backtest, fold ${k + 1} of ${R}`, tried: found.tried.length, best: specLabel(best.spec), bestAicc: best.aicc, current: "", detail: "" });
      const out = foldScore(ctx, k);
      if (out) outs.push(out);
    }
    backtest = combineFolds(job, outs);
  }
  return {
    ok: true,
    label: specLabel(best.spec),
    spec: best.spec,
    coefs: best.coefs,
    sigma2: best.sigma2, loglik: best.loglik, aic: best.aic, aicc: best.aicc, bic: best.bic, nUsed: best.nUsed, k: best.k, converged: best.converged,
    differences: { d: dd.d, D: dd.D, kpss: dd.kpss, strength: dd.strength, m },
    tried: [...found.tried].sort((a, b) => (Number.isFinite(a.aicc) ? a.aicc : Infinity) - (Number.isFinite(b.aicc) ? b.aicc : Infinity)),
    forecast: toBack(avgFc),
    forecastBest: toBack(fc),
    averaged: team.map((t) => ({ label: specLabel(t.fit.spec), weight: t.weight })),
    vote: voteRows,
    plainLabel: specLabel(found.best.spec),
    adjusted: strip0 ? { periods: strip0.ps, used: y.length } : null,
    resid,
    backtest,
    lambda: bc,
    searched: job.exhaustive ? "every order" : "stepwise",
    seconds: (Date.now() - t0) / 1000,
    ...(pending ? { pending: ctx } : {}),
  };
}

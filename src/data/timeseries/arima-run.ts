/**
 * The AutoARIMA job behind the Forecast tab's deep run: choose the differences, search the orders, report the fit, forecast with
 * analytic intervals, and score the chosen order on the same backtest folds as the board (orders held, coefficients refitted
 * on each fold's history). Pure: the page runs it in a worker it can stop, and the tests call it directly.
 */

import {
  autoArimaSearch, chooseDifferences, fitArima, forecastArima, residualCheck, specLabel,
  type ArimaCoef, type ArimaSpec, type ResidualCheck, type TriedModel,
} from "./arima.js";
import { boxCox, invBoxCox } from "./boxcox.js";

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
}

export interface ArimaProgress { stage: string; tried: number; best: string; bestAicc: number; current: string; detail: string }

export interface ArimaBacktest {
  folds: number;
  /** Mean absolute error on the selection folds, and the same for repeating the last cycle: the ratio is the board's "error against". */
  mae: number; maeSeasonalNaive: number; ratio: number;
  /** The same on the lockbox fold, or null. */
  lockMae: number | null; lockRatio: number | null;
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
    forecast: { F: number[]; lo80: number[]; hi80: number[]; lo95: number[]; hi95: number[] };
    resid: ResidualCheck | null;
    backtest: ArimaBacktest | null;
    lambda: number | null;
    searched: "stepwise" | "every order";
    seconds: number;
  };

export function runAutoArima(job: ArimaJob, onProgress: (p: ArimaProgress) => void = () => {}, cancelled: () => boolean = () => false): ArimaResult {
  const t0 = Date.now();
  if (job.seasonMode === "mstl") {
    return { ok: false, reason: `This series has a season of ${job.m} periods, longer than ARIMA handles directly. R's advice is to remove the season first and fit ARIMA to the adjusted series (stlf); that is not built yet.` };
  }
  const m = job.seasonMode === "native" ? job.m : 1;
  const bc = job.lambda;
  const yFull = bc === null ? job.y : boxCox(job.y, bc);
  const y = yFull.slice(0, job.T);
  const known = y.reduce((n, v) => n + (v === v ? 1 : 0), 0);
  if (known < 12) return { ok: false, reason: `Only ${known} readings: too few to fit an ARIMA model.` };
  onProgress({ stage: "Choosing the differences", tried: 0, best: "", bestAicc: NaN, current: "", detail: "" });
  const dd = chooseDifferences(y, m);
  onProgress({ stage: "Searching the orders", tried: 0, best: "", bestAicc: NaN, current: "", detail: `d = ${dd.d}, D = ${dd.D}` });
  const found = autoArimaSearch(y, m, dd.d, dd.D, {
    exhaustive: job.exhaustive,
    cancelled,
    onProgress: (p) => onProgress({ stage: job.exhaustive ? "Trying every order" : "Searching the orders", tried: p.tried, best: p.best, bestAicc: p.bestAicc, current: p.current, detail: `d = ${dd.d}, D = ${dd.D}` }),
  });
  if (!found) return { ok: false, reason: cancelled() ? "Stopped." : "No ARIMA model could be fitted to this series." };
  // The chosen model again, with standard errors from the numerical Hessian.
  onProgress({ stage: "Standard errors", tried: found.tried.length, best: specLabel(found.best.spec), bestAicc: found.best.aicc, current: "", detail: "" });
  const best = fitArima(y, found.best.spec, { se: true }) ?? found.best;
  const inv = (v: number): number => (bc === null ? v : invBoxCox(v, bc));
  const floor = (v: number): number => (job.nonNeg ? Math.max(0, v) : v);
  const fc = forecastArima(y, best, job.H);
  const back = (a: Float64Array): number[] => Array.from(a, (v) => floor(inv(v)));
  const resid = residualCheck(best);

  // Backtest: the order is held, the coefficients refitted on each fold's history, scored on the original scale.
  let backtest: ArimaBacktest | null = null;
  const R = job.origins.length;
  if (R > 0) {
    const sel = job.lockbox ? R - 1 : R;
    let ae = 0, an = 0, se = 0, sn = 0, lockAe = 0, lockSe = 0, lc = 0, lockN = 0;
    for (let k = 0; k < R; k++) {
      if (cancelled()) break;
      const o = job.origins[k]!;
      onProgress({ stage: `Backtest, fold ${k + 1} of ${R}`, tried: found.tried.length, best: specLabel(best.spec), bestAicc: best.aicc, current: "", detail: "" });
      const start = job.rolling && job.trainLen !== null ? Math.max(0, Math.floor((o - job.trainLen) / Math.max(1, m)) * Math.max(1, m)) : 0;
      const seg = yFull.slice(start, o);
      const f = fitArima(seg, best.spec);
      if (!f) continue;
      const pred = forecastArima(seg, f, job.H).F;
      for (let h = 0; h < job.H; h++) {
        const actual = job.y[o + h]!;
        if (!(actual === actual)) continue;
        const e = Math.abs(actual - floor(inv(pred[h]!)));
        const ref = job.y[o - Math.max(1, job.m) + (h % Math.max(1, job.m))];
        const s = ref === ref ? Math.abs(actual - ref!) : NaN;
        if (!(e === e) || !(s === s)) continue;
        if (job.lockbox && k === R - 1) { lockAe += e; lockSe += s; lc++; lockN++; }
        else { ae += e; se += s; an++; sn++; }
      }
    }
    void sn; void lc;
    if (an > 0) {
      backtest = {
        folds: sel, mae: ae / an, maeSeasonalNaive: se / an, ratio: se > 0 ? ae / se : NaN,
        lockMae: lockN > 0 ? lockAe / lockN : null, lockRatio: lockN > 0 && lockSe > 0 ? lockAe / lockSe : null,
      };
    }
  }
  return {
    ok: true,
    label: specLabel(best.spec),
    spec: best.spec,
    coefs: best.coefs,
    sigma2: best.sigma2, loglik: best.loglik, aic: best.aic, aicc: best.aicc, bic: best.bic, nUsed: best.nUsed, k: best.k, converged: best.converged,
    differences: { d: dd.d, D: dd.D, kpss: dd.kpss, strength: dd.strength, m },
    tried: [...found.tried].sort((a, b) => (Number.isFinite(a.aicc) ? a.aicc : Infinity) - (Number.isFinite(b.aicc) ? b.aicc : Infinity)),
    forecast: { F: back(fc.F), lo80: back(fc.lo80), hi80: back(fc.hi80), lo95: back(fc.lo95), hi95: back(fc.hi95) },
    resid,
    backtest,
    lambda: bc,
    searched: job.exhaustive ? "every order" : "stepwise",
    seconds: (Date.now() - t0) / 1000,
  };
}

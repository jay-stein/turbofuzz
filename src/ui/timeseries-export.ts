/**
 * Time Series exports for analysts: the forecast on its own, the model scorecard (every
 * measure, check and parameter), and the backtest in long form (each model, fold and
 * step ahead, with the actual), so any measure can be recomputed or plotted elsewhere.
 * Pure: rows of strings for downloadCsv.
 */

import type { TsBacktest, TsSnapshot } from "../data/timeseries/engine.js";
import { grade, METRIC_KEYS, MODEL_INFO, MODEL_KEYS, type MetricKey, type ModelKey, type ModelSummary } from "../data/timeseries/models.js";
import { METRIC_INFO } from "./timeseries-metrics.js";

const num = (v: number | undefined): string => (v === undefined || !(v === v) || !Number.isFinite(v) ? "" : String(Math.round(v * 1e6) / 1e6));

/** Future periods only: the chosen model's forecast and both bands. */
export function forecastRows(s: TsSnapshot, key: ModelKey, starts: ArrayLike<number>, iso: (ms: number) => string, label: (ms: number) => string): string[][] {
  const rows = [["period_start", "period", "model", "forecast", "lo80", "hi80", "lo95", "hi95"]];
  if ("error" in s.models || !s.futures) return rows;
  const { T, H } = s.models, f = s.futures[key];
  for (let h = 0; h < H; h++) {
    const t = starts[T + h];
    if (t === undefined) break;
    rows.push([iso(t), label(t), MODEL_INFO[key].name, num(f.F[h]), num(f.lo80[h]), num(f.hi80[h]), num(f.lo95[h]), num(f.hi95[h])]);
  }
  return rows;
}

/** A model's fitted settings in words an analyst can reuse. */
export function modelParams(m: ModelSummary, season: number): string {
  if (m.ets) return `ETS(${m.ets.spec}) alpha=${num(m.ets.alpha)} beta=${num(m.ets.beta)} gamma=${num(m.ets.gamma)} phi=${num(m.ets.phi)} AICc=${num(m.ets.aicc)} forms_tried=${m.ets.tried} season=${season}`;
  if (m.hw) { const [a, b, g, p] = m.hw.params; return `Holt-Winters additive, damped: alpha=${num(a)} beta=${num(b)} gamma=${num(g)} phi=${num(p)} season=${season}`; }
  if (m.reg) {
    const d = m.reg.drivers.map((v) => `${v.col}${v.log ? "(log)" : ""}=${num(v.beta)}`).join(" ");
    return `trend_bends=${m.reg.K} yearly_pairs=${m.reg.Ky} weekly_pairs=${m.reg.Kw} daily_pairs=${m.reg.Kd} log_y=${m.reg.logY}${d ? ` drivers: ${d}` : ""}`;
  }
  if (m.theta) return `Theta: alpha=${num(m.theta.alpha)} slope=${num(m.theta.b0)} (half used) deseasonalised=${m.theta.seasonal}`;
  if (m.clim) return `mean of the same phase, cycle=${m.clim.m}`;
  if (m.key === "sn") return `copies one cycle back, season=${season}`;
  return "mean of best smoothing, steady trend, and trend, seasons and drivers";
}

/** One row per model: every measure, the checks, how it was validated and its parameters. */
export function scorecardRows(s: TsSnapshot, metric: MetricKey, picked: ModelKey | null, iso: (ms: number) => string): string[][] {
  const head = ["model", "method", "rank", "auto_pick", "shown", ...METRIC_KEYS.map((k) => k), "vs_repeat_last_cycle", "grade", "folds_beaten", "folds",
    "band_check_inside_80", "band_check_periods", "heldout_mae", "heldout_inside_80", "heldout_periods", "validation", "train_periods_per_fold", "horizon", "fold_step",
    "fitted_from", "fitted_to", "fitted_periods", "ranked_by", ...METRIC_KEYS.map((k) => `lockbox_${k}`), "parameters"];
  const rows = [head];
  if ("error" in s.models || !s.futures) return rows;
  const M = s.models, futures = s.futures;
  const size = (k: ModelKey): number => { const v = M.models[k].metrics[metric]; return v === v ? (metric === "bias" ? Math.abs(v) : v) : Infinity; };
  const order = [...MODEL_KEYS].sort((a, b) => size(a) - size(b));
  order.forEach((k, i) => {
    const m = M.models[k], held = futures[k].held;
    rows.push([
      MODEL_INFO[k].name, MODEL_INFO[k].meth, String(i + 1), k === M.bestBy[metric] ? "yes" : "", k === picked ? "yes" : "",
      ...METRIC_KEYS.map((mk) => num(m.metrics[mk])), num(m.ratio), grade(m.ratio, k).text, k === "sn" ? "" : String(m.folds.won), String(m.folds.of),
      m.check ? String(m.check.hit) : "", m.check ? String(m.check.tot) : "", held ? num(held.mae) : "", held ? String(held.hit) : "", held ? String(held.tot) : "",
      M.cv, M.trainLen === null ? "all before each fold" : String(M.trainLen), String(M.H), String(M.step),
      iso(s.A.t[0]!), iso(s.A.t[M.T - 1]!), String(M.T), METRIC_INFO[metric].label, ...METRIC_KEYS.map((mk) => num(m.lock?.[mk])), modelParams(m, M.m),
    ]);
  });
  return rows;
}

/** Long form: model, fold, step ahead, period, actual, forecast, error. Filled periods are marked and never scored. */
export function backtestRows(s: TsSnapshot, bt: TsBacktest, starts: ArrayLike<number>, iso: (ms: number) => string): string[][] {
  const rows = [["model", "fold", "fold_origin", "step_ahead", "period_start", "actual", "forecast", "error", "abs_error", "filled"]];
  const y = s.A.y, made = s.A.made;
  for (const k of MODEL_KEYS) {
    const fc = bt.forecasts[k];
    bt.origins.forEach((o, f) => {
      for (let h = 0; h < bt.H; h++) {
        const i = o + h, t = starts[i];
        if (t === undefined || i >= s.A.modelN) continue;
        const act = y[i]!, fv = fc[f * bt.H + h]!, filled = !!made[i] || !(act === act);
        const e = filled ? NaN : act - fv;
        rows.push([MODEL_INFO[k].name, String(f + 1), iso(starts[o]!), String(h + 1), iso(t), filled ? "" : num(act), num(fv), num(e), num(Math.abs(e)), filled ? "1" : ""]);
      }
    });
  }
  return rows;
}

/**
 * Time Series: the accuracy measures (what each says, when to use it, its formula) and
 * the "Which model, and why?" window: how the backtest guards against overfitting, the
 * two validation windows, one line per model, and the measures table.
 */

import type { MetricKey, ModelKey } from "../data/timeseries/models.js";
import { setupDialog } from "./dialog.js";
import { el } from "./dom.js";

export interface MetricInfo {
  label: string;
  /** Lower is better for all but bias, where nearer zero is. */
  short: string;
  strengths: string;
  when: string;
  /** HTML (static, ours). */
  formula: string;
}

const SUM = "&Sigma;<sub>t</sub>";
const E = "|y<sub>t</sub> &minus; &ycirc;<sub>t</sub>|";

export const METRIC_INFO: Record<MetricKey, MetricInfo> = {
  mase: {
    label: "MASE",
    short: "Mean absolute scaled error",
    strengths: "Scale-free, so it compares series of any size, and fine with zeros. Recommended by Hyndman & Koehler (2006). Below 1: the forecast errs less than repeating the last cycle did one cycle ahead in the training data. A multi-step forecast can sit above 1 and still beat repeating the last cycle at the same horizons; the board's \"vs repeat-last-cycle\" column compares like with like.",
    when: "The default: ranking models, and comparing across series or grains.",
    formula: `MASE = MAE &divide; ( <sup>1</sup>&frasl;<sub>T&minus;m</sub> &Sigma;<sub>t=m+1..T</sub> |y<sub>t</sub> &minus; y<sub>t&minus;m</sub>| ), the error of repeating the last cycle (season m) on the training data`,
  },
  mae: {
    label: "MAE",
    short: "Mean absolute error",
    strengths: "In the series' own units, so it reads directly (\"off by 12 kWh on average\"). Big misses count no more than their size. The median forecast minimises it.",
    when: "One series, when the cost of a miss grows in step with its size.",
    formula: `MAE = <sup>1</sup>&frasl;<sub>n</sub> ${SUM} ${E}`,
  },
  rmse: {
    label: "RMSE",
    short: "Root mean squared error",
    strengths: "Squares each miss, so a few big misses weigh heavily. In the series' units. The mean forecast minimises it.",
    when: "When big misses hurt far more than small ones (stock-outs, capacity, peak load).",
    formula: `RMSE = &radic;( <sup>1</sup>&frasl;<sub>n</sub> ${SUM} (y<sub>t</sub> &minus; &ycirc;<sub>t</sub>)<sup>2</sup> )`,
  },
  wape: {
    label: "WAPE",
    short: "Weighted absolute percentage error",
    strengths: "A percentage that business readers grasp. Zeros in single periods do no harm, and busy periods count for more than quiet ones.",
    when: "Sales, demand and volumes, including series with many zeros. Use it for reporting accuracy to people.",
    formula: `WAPE = ${SUM} ${E} &divide; ${SUM} |y<sub>t</sub>|`,
  },
  smape: {
    label: "sMAPE",
    short: "Symmetric mean absolute percentage error",
    strengths: "A percentage bounded from 0 to 200%, and the measure of the M3 and M4 forecasting competitions.",
    when: "Comparing with published competition results. Avoid it near zero: there the denominator is tiny.",
    formula: `sMAPE = <sup>1</sup>&frasl;<sub>n</sub> ${SUM} 2${E} &divide; (|y<sub>t</sub>| + |&ycirc;<sub>t</sub>|)`,
  },
  mape: {
    label: "MAPE",
    short: "Mean absolute percentage error",
    strengths: "The most familiar percentage error. Each period counts the same.",
    when: "Positive series well away from zero, when people expect it. It is undefined at zero, explodes near zero, and punishes over-forecasts more than under-forecasts, so it favours forecasts that run low.",
    formula: `MAPE = <sup>1</sup>&frasl;<sub>n</sub> ${SUM} ${E} &divide; |y<sub>t</sub>| (periods where y<sub>t</sub> &ne; 0)`,
  },
  bias: {
    label: "Bias",
    short: "Mean error, as a share of the actuals",
    strengths: "Shows direction, which the others hide: positive means the forecast runs high, negative means low. A model can have a small error and still lean one way every time.",
    when: "Alongside an error measure: ordering stock or setting budgets, where a lean in one direction costs more than noise. Nearer zero is better.",
    formula: `Bias = ${SUM} (&ycirc;<sub>t</sub> &minus; y<sub>t</sub>) &divide; ${SUM} |y<sub>t</sub>|`,
  },
};

const pct = (v: number, d = 1): string => `${(v * 100).toFixed(d)}%`;

/** A measure's value as the board shows it. */
export function metricText(key: MetricKey, v: number): string {
  if (!(v === v) || !Number.isFinite(v)) return "–";
  switch (key) {
    case "mase": return v.toFixed(2);
    case "mae": case "rmse": return Math.abs(v) >= 100 ? Math.round(v).toLocaleString() : v.toPrecision(3);
    case "bias": return `${v >= 0 ? "+" : "−"}${pct(Math.abs(v))}`;
    default: return pct(v);
  }
}

/** When each model shines, and when to doubt it. */
export const MODEL_GUIDE: Record<ModelKey, { shines: string; doubt: string }> = {
  sn: { shines: "The baseline. It copies the same period one cycle back. Strong on stable seasonal series.", doubt: "Any model that cannot beat it is not worth using; the board measures every other model against it." },
  hw: { shines: "Holt-Winters: a damped trend plus a season of fixed size. Steady and quick.", doubt: "A season that grows as the level grows, and sudden breaks." },
  ets: { shines: "Picks the smoothing form (trend none, straight or damped; season none, fixed or growing) by AICc. A strong all-round default.", doubt: "Very long seasons (hours in a week) and breaks in the series." },
  reg: { shines: "Several seasons at once (day, week, year), and drivers such as temperature or promotions. The trend can bend.", doubt: "A Bendy trend can chase noise, which is overfitting; watch the backtest as you raise it. Drivers must be known ahead." },
  theta: { shines: "Simple smoothing plus half the long-run slope. It won the M3 competition, and is hard to beat on short, noisy series.", doubt: "It ignores drivers and follows breaks slowly." },
  clim: { shines: "The average of the same point in every cycle. Good when there is a season but no trend.", doubt: "Any trend: it forecasts the past average." },
  ens: { shines: "The average of best smoothing, steady trend and the trend, seasons and drivers model: the way to let drivers pull on an otherwise smoothing-based forecast.", doubt: "On monthly, quarterly and yearly data the regression is usually the weakest of its three parts, so the Combination tends to beat it." },
  comb: { shines: "The average of best smoothing, steady trend and smooth and damp. Auto's default: it beat every published classical method on M3 monthly and quarterly and on tourism data, because the three misses partly cancel and the average has no parameters of its own to overfit.", doubt: "Intermittent demand (many zeros), where plain smoothing or Croston's method does better, and series where one member is clearly wrong." },
};

const MODEL_ORDER: ModelKey[] = ["sn", "clim", "hw", "ets", "theta", "reg", "ens", "comb"];

/** Little train/test strips for four folds. */
function foldsDiagram(kind: "expanding" | "rolling"): HTMLElement {
  const rows = [0, 1, 2, 3].map((k) => {
    const start = kind === "rolling" ? k * 8 : 0, train = 40 + k * 8 - start;
    return el("div", { class: "ts-fold" }, [
      el("span", { class: "ts-fold-gap", style: `width:${start}%` }),
      el("span", { class: "ts-fold-train", style: `width:${train}%` }),
      el("span", { class: "ts-fold-test", style: "width:12%" }),
    ]);
  });
  return el("div", { class: "ts-folds", "aria-hidden": "true" }, rows);
}

/** The "Which model, and why?" window. */
export function openModelGuide(names: Record<ModelKey, string>): void {
  const overlay = el("div", { class: "modal-overlay" });
  const close = el("button", { class: "icon-btn", type: "button", title: "Close" }, ["×"]);
  const table = el("table", { class: "ts-metric-table" });
  table.innerHTML = `<thead><tr><th>Metric</th><th>Why it's good (strengths)</th><th>When to use it</th><th>Math (formula)</th></tr></thead><tbody>${
    (Object.keys(METRIC_INFO) as MetricKey[]).map((k) => {
      const m = METRIC_INFO[k];
      return `<tr><th scope="row">${m.label}<small>${m.short}</small></th><td>${m.strengths}</td><td>${m.when}</td><td class="ts-formula">${m.formula}</td></tr>`;
    }).join("")
  }</tbody>`;
  const models = el("table", { class: "ts-metric-table ts-model-guide" });
  models.innerHTML = `<thead><tr><th>Model</th><th>When it shines</th><th>When to doubt it</th></tr></thead><tbody>${
    MODEL_ORDER.map((k) => `<tr><th scope="row">${names[k]}</th><td>${MODEL_GUIDE[k].shines}</td><td>${MODEL_GUIDE[k].doubt}</td></tr>`).join("")
  }</tbody>`;
  const body = el("div", { class: "ts-guide-body" });
  body.innerHTML = `
    <h3>Overfitting, and how the scores avoid it</h3>
    <p>Any model can be tuned to fit its own history closely. That says nothing about the future. So no score here is measured on data the model learned from. Each one comes from forecasts made from <b>earlier dates</b> (the backtest folds). The model's settings are chosen <b>before the first fold</b>, and it is scored on what actually came next.</p>
    <ul>
      <li><b>Lockbox</b>: with 4 or more folds, the last one is held back. Models are ranked, and Auto picks, on the others only; the pick is then scored once on the held-back fold. The best of seven on the same folds is optimistic (selection bias, the "winner's curse"); the lockbox score is not. If the pick ranks low there, its lead was luck.</li>
      <li><b>Folds beaten</b>: in how many folds the model beat repeating the last cycle. One that is best overall but wins few folds may have been lucky once.</li>
      <li><b>Close scores</b>: when two models score within about 5%, prefer the simpler one. It has less room to have learned noise.</li>
      <li><b>Expanding vs rolling</b>: if a model ranks well under one and badly under the other, it depends on how much history it gets.</li>
    </ul>
    <h3>How Auto chooses</h3>
    <p>Picking the best of eight models from a few short, overlapping folds is noisy, and the noise costs accuracy: on the Monash archive, always using ETS beat "pick the backtest winner" on 15 of 19 low-frequency datasets. fpp3 (13.4) and the M4 competition favour averaging, so:</p>
    <ul>
      <li><b>Seasons up to 24 periods</b> (monthly, quarterly, yearly, daily): Auto uses the <b>Combination</b> of best smoothing, steady trend and smooth and damp. A rival replaces it only if it beats the Combination on the selection folds, <i>and</i> on the unseen lockbox fold, <i>and</i> a Diebold–Mariano test finds it significantly more accurate. The model card says which step stopped a rival.</li>
      <li><b>Longer seasons</b> (weekly, hourly): the families differ a lot and the Combination's members are not designed for 52 or 168 periods, so Auto picks the backtest winner.</li>
      <li>You can always pick any model by hand; the board keeps every score honest.</li>
    </ul>
    <h3>Validation window</h3>
    <div class="ts-cv-explain">
      <div><b>Expanding</b> (default)<p>Each fold trains on everything before its forecast date, the classic time-series cross-validation. Uses all the history.</p></div>
      <div><b>Rolling</b><p>Each fold trains on a fixed-length window that slides forward, so older behaviour is forgotten. It shows how a model copes when the past is less like the future.</p></div>
    </div>
    <div class="ts-cv-explain"><div>${foldsDiagram("expanding").outerHTML}</div><div>${foldsDiagram("rolling").outerHTML}</div></div>
    <p class="ts-note"><span class="ts-fold-key train"></span> trains · <span class="ts-fold-key test"></span> scored</p>
    <h3>Models</h3>`;
  body.append(models, el("h3", {}, ["Accuracy measures"]), table,
    el("p", { class: "ts-note" }, ["y is the actual value, ŷ the forecast, n the number of forecast periods scored across all folds. Further reading: Hyndman & Athanasopoulos, Forecasting: Principles and Practice (3rd ed.), sections 5.8 to 5.10."]));
  const modal = el("div", { class: "modal ts-guide-modal" }, [el("div", { class: "modal-head" }, [el("h2", {}, ["Which model, and why?"]), close]), body]);
  overlay.append(modal);
  const finish = (): void => { overlay.remove(); document.removeEventListener("keydown", onKey); };
  const onKey = (e: KeyboardEvent): void => { if (e.key === "Escape") finish(); };
  close.addEventListener("click", finish);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) finish(); });
  document.addEventListener("keydown", onKey);
  document.body.append(overlay);
  setupDialog(overlay, "Which model, and why?");
}

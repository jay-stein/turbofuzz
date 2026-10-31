/**
 * Technical documentation for the Time Series models, shown in the model details window:
 * what each model is, its equations as implemented, how it is fitted, how its forecast and
 * band are made, where this implementation differs from the textbook form, and the sources.
 * Citations are written [ref:id] and resolve against data/timeseries/references.ts.
 */

import { REFERENCES, REFERENCE_ORDER } from "../data/timeseries/references.js";
import type { TsSnapshot } from "../data/timeseries/engine.js";
import { MODEL_INFO, MODEL_KEYS, type MetricKey, type ModelKey } from "../data/timeseries/models.js";
import { setupDialog } from "./dialog.js";
import { el } from "./dom.js";
import { modelRows } from "./timeseries-findings.js";
import { MODEL_GUIDE } from "./timeseries-metrics.js";

export interface ModelDoc {
  kind: string;
  summary: string;
  /** Equations as implemented (HTML). */
  equations: string[];
  fitting: string[];
  forecasting: string[];
  /** Where this implementation is not the textbook's, said plainly. */
  differs: string[];
}

const BAND = "The 80% and 95% bands are not model-based. For each step ahead they are quantiles of this model's own backtest errors at that step (pooled over the folds and over the neighbouring steps, a window of H/8 either side), added to the forecast, with the 95% tails widened to at least 1.53 times the 80% half-width (the ratio of the normal 97.5% and 90% quantiles) when the sample is thin. They are checked fold by fold in the Deep check. [ref:fpp3] 5.5 describes the same idea as empirical (bootstrapped) intervals.";

export const MODEL_DOCS: Record<ModelKey, ModelDoc> = {
  sn: {
    kind: "Benchmark",
    summary: "Each period is forecast as the value one season earlier: the seasonal naive method, the benchmark every other model has to beat [ref:fpp3] (5.2). With no season (m = 1) it is the naive forecast and repeats the last value.",
    equations: [
      "ŷ<sub>T+h|T</sub> = y<sub>T+h−m(k+1)</sub>, k = ⌊(h − 1) / m⌋",
      "m is the longest season the history can support (hourly data: 168 hours, weekly: 52, monthly: 12, quarterly: 4, daily: 7).",
    ],
    fitting: ["Nothing is fitted. The MASE denominator is this method's mean absolute one-step-ahead (one season back) error over the training data before the first backtest fold [ref:mase]."],
    forecasting: ["The forecast is the last full cycle, repeated. " + BAND],
    differs: ["None: it is the textbook method. It is shown as a model so that everything else can be graded against it (the 'vs repeat-last-cycle' column)."],
  },
  clim: {
    kind: "Benchmark",
    summary: "The mean of all earlier values at the same point of the season: a seasonal version of the mean method [ref:fpp3] (5.2). It has no trend, so it suits a stable season and fails on anything that drifts.",
    equations: [
      "ŷ<sub>T+h|T</sub> = (1 / |J|) · Σ<sub>j ∈ J</sub> y<sub>j</sub>, J = { j ≤ T : j ≡ T + h (mod c) }",
      "c is the longest season that fits before the first fold.",
    ],
    fitting: ["Nothing is fitted; the phase means are recomputed on each fold's history (on the latest fixed-length window when the validation window is rolling)."],
    forecasting: [BAND],
    differs: ["Not a textbook named method: it is the mean method applied within each phase of the season."],
  },
  hw: {
    kind: "Exponential smoothing",
    summary: "Holt-Winters smoothing with an additive season and a damped additive trend [ref:holt] [ref:winters] [ref:damped]. The level, trend and season each follow the data through their own smoothing weight, and the damping φ makes the trend flatten out so a long forecast does not run away.",
    equations: [
      "ℓ<sub>t</sub> = α (y<sub>t</sub> − s<sub>t−m</sub>) + (1 − α)(ℓ<sub>t−1</sub> + φ b<sub>t−1</sub>)",
      "b<sub>t</sub> = β (ℓ<sub>t</sub> − ℓ<sub>t−1</sub>) + (1 − β) φ b<sub>t−1</sub>",
      "s<sub>t</sub> = γ (y<sub>t</sub> − ℓ<sub>t</sub>) + (1 − γ) s<sub>t−m</sub>",
      "ŷ<sub>T+h|T</sub> = ℓ<sub>T</sub> + (φ + φ² + … + φ<sup>h</sup>) b<sub>T</sub> + s<sub>T+h−m(k+1)</sub>",
      "With no season the season terms drop out and it is Holt's damped trend. With a season removed first (MSTL, below) the same damped trend runs on the seasonally adjusted series and the season is added back.",
    ],
    fitting: [
      "The four weights are found by minimising the sum of squared one-step-ahead errors, within α ∈ [0.01, 0.99], β ∈ [0.001, 0.5], γ ∈ [0.001, 0.7], φ ∈ [0.8, 0.98], by a coordinate search that halves its step over seven rounds. It starts from the previous fit of the same series, so dragging the horizon does not start again.",
      "Starting state: level = the first cycle's mean, trend = the difference between the first two cycles' means divided by m, season = the first cycle's deviations from its mean.",
      "It is fitted on the latest whole cycles of up to 4,000 periods. For the backtest the weights are fitted on data before the first fold only, so no fold is scored on periods the weights were tuned on.",
      "A filled period is treated as missing: the level and trend carry on as a forecast and nothing is learnt from the made-up value.",
    ],
    forecasting: [BAND],
    differs: ["The recursions are the classical smoothing form [ref:winters], not the state-space (innovations) form of ETS [ref:ets2002]. For additive seasons the two are equivalent under a change of parameters; this model is not a port of ETS(A,Ad,A) and its weights are not comparable with those of ets().", "The weights are chosen by a short coordinate search, not a full optimiser, and the starting state is a heuristic, not estimated."],
  },
  ets: {
    kind: "Exponential smoothing, selected by AICc",
    summary: "The state-space (innovations) form of exponential smoothing [ref:ets2002] [ref:fpp3] (ch. 8). It fits every allowed combination of error (additive or multiplicative), trend (none, additive, damped) and season (none, additive, multiplicative) by maximum likelihood and keeps the one with the lowest AICc: automatic exponential smoothing as ets() does it [ref:forecastpkg]. As in ets(), additive errors are never combined with a multiplicative season (numerically unstable), and multiplicative errors and seasons are tried only for series that are positive throughout: 15 forms for such a series, 6 otherwise.",
    equations: [
      "μ<sub>t</sub> = (ℓ<sub>t−1</sub> + φ b<sub>t−1</sub>) ⊙ s<sub>t−m</sub>   (⊙ is + for no or an additive season, × for a multiplicative one; no b or s term when absent)",
      "ε<sub>t</sub> = y<sub>t</sub> − μ<sub>t</sub> (additive errors)  or  (y<sub>t</sub> − μ<sub>t</sub>) / μ<sub>t</sub> (multiplicative errors),  ε<sub>t</sub> ~ N(0, σ²)",
      "ℓ<sub>t</sub> = ℓ<sub>t−1</sub> + φ b<sub>t−1</sub> + α k<sub>ℓ</sub> ε<sub>t</sub>",
      "b<sub>t</sub> = φ b<sub>t−1</sub> + β k<sub>ℓ</sub> ε<sub>t</sub>   (φ = 1 for an undamped trend; absent for none)",
      "s<sub>t</sub> = s<sub>t−m</sub> + γ k<sub>s</sub> ε<sub>t</sub>",
      "The loadings: k<sub>ℓ</sub> = k<sub>s</sub> = 1 for additive errors; for multiplicative errors k<sub>ℓ</sub> = k<sub>s</sub> = μ<sub>t</sub> with no or an additive season, and k<sub>ℓ</sub> = ℓ<sub>t−1</sub> + φ b<sub>t−1</sub>, k<sub>s</sub> = s<sub>t−m</sub> with a multiplicative season. β here is ETS's β (= α β*).",
      "ŷ<sub>T+h|T</sub> = (ℓ<sub>T</sub> + (φ + … + φ<sup>h</sup>) b<sub>T</sub>) ⊙ s<sub>T+h−m(k+1)</sub>: the same point forecast whichever the error type.",
      "−2 ln L = n ln(Σ ε<sub>t</sub>²) + 2 Σ ln|μ<sub>t</sub>| (the second term for multiplicative errors), up to a constant shared by all forms. AICc = −2 ln L + 2k + 2k(k + 1) / (n − k − 1) [ref:aicc], k = the free smoothing parameters, the starting states (level, trend, m − 1 seasonals) and σ².",
    ],
    fitting: [
      "Smoothing parameters and starting states are estimated together by Nelder–Mead [ref:nelder] on −2 ln L, started from forecast::ets's heuristic: a classical decomposition of the first cycles for the season, and a straight line through the first max(10, 2m) seasonally adjusted points for the level and trend [ref:forecastpkg]. Parameters are kept in the usual region: 0 < α < 1, 0 < β < α, 0 < γ < 1 − α, 0.8 < φ < 0.98.",
      "To keep the 15-form search fast, every form is first fitted with the seasonal starting states held at the heuristic (at most six free values), and the best three are then refitted with every starting state free and ranked again. Fitting all states in all forms (as ets() does) took about eight times as long and gave the same choice and no better likelihood.",
      "The form is chosen once on the history before the first backtest fold and fixed for every fold, then chosen again on all the data for the forecast, so the selection never sees a fold it is scored on. It fits the latest max(300, 6m) periods; fits are cached by series and window. A filled period is a step with no innovation: the state moves on as a forecast and nothing is learnt.",
      "With a season over 24 periods the season is removed first with MSTL and only the six non-seasonal forms are fitted on the adjusted series (see Seasons: testing and removing them). R's ets() declines seasons over 24 and tells you to use stlf() [ref:forecastpkg]; this is that route.",
    ],
    forecasting: ["Point forecasts follow the equations above from the final state. " + BAND],
    differs: [
      "Checked against Nixtla's statsforecast (a port of R's ets()) on 620 series: it chooses the same form on 53–88% of series (85–88% on quarterly and yearly data), the median difference between the two forecasts is 0.0–2.6%, and where both choose the same form our AICc is equal to the reference's (median difference 0.000; on a 150-series subset, 108 had the same form, and ours was better by more than 0.5 on 23 of those and worse on 6). Mean error is within 2% of the reference's overall (+2.0%), driven by a few short, trending yearly series where optimisers land in different places.",
      "The equations are checked against statsmodels' ETSModel to 1e-13 for every non-seasonal and additive-season form. For a multiplicative season statsmodels updates the season with the current level; fpp3 (8.3) and R's code use the previous level, as here, and those forms are checked against the textbook's component form.",
      "The usual region is enforced but not the admissibility check on top of it; the optimiser is our own Nelder–Mead, not R's; the two-stage fit above is ours; and the bands are empirical, not the model's own analytic intervals ([ref:fpp3] 8.7), which are not implemented.",
    ],
  },
  theta: {
    kind: "Theta method",
    summary: "Simple exponential smoothing plus a drift of half the slope of the long-run linear trend. It won the M3 competition [ref:m3] [ref:theta], and Hyndman and Billah [ref:thetabillah] showed that its forecasts are exactly this.",
    equations: [
      "z<sub>t</sub> = y<sub>t</sub> deseasonalised by the classical decomposition: y<sub>t</sub> / S<sub>t</sub> for a positive series, y<sub>t</sub> − S<sub>t</sub> otherwise, only if the seasonality test is positive",
      "b<sub>0</sub> = the OLS slope of z<sub>t</sub> on t = 0, …, n − 1",
      "ℓ<sub>t</sub> = α z<sub>t</sub> + (1 − α) ℓ<sub>t−1</sub>, with α and the starting level ℓ<sub>0</sub> estimated by maximum likelihood (simple exponential smoothing, ETS(A,N,N))",
      "ẑ<sub>n+h</sub> = ℓ<sub>n</sub> + (b<sub>0</sub> / 2) · [ (h − 1) + (1 − (1 − α)<sup>n</sup>) / α ],  then re-seasonalised",
    ],
    fitting: [
      "Refitted on every fold's own history (nothing is carried over, so there is nothing to leak). α and ℓ<sub>0</sub> are estimated by the same likelihood and Nelder–Mead as ETS, on the deseasonalised series, as forecast::ses() does inside thetaf().",
      "The seasonality test is the Theta method's own: the lag-m autocorrelation must exceed 1.645 standard errors (Bartlett's formula over the shorter lags) [ref:theta] [ref:bartlett], as in R's thetaf() [ref:forecastpkg]. With under three cycles the season is kept. For a long season the test is made at the shortest period that fits (24 hours for hourly data).",
      "A filled period is left out of the likelihood when α is estimated.",
    ],
    forecasting: [BAND],
    differs: ["Checked against statsforecast's Theta on 620 series: the median difference between the two forecasts is 0.0–0.4% on every dataset and the mean error is within 0.4% of the reference's overall.", "For a series that is not positive the season is removed additively; thetaf() would apply the multiplicative decomposition regardless."],
  },
  reg: {
    kind: "Regression",
    summary: "A trend with changepoints, Fourier seasons and any driver columns you add, in the design of Prophet [ref:prophet] but fitted in closed form by ridge regression. It is the only model that can use drivers (promotions, temperature) and the only one that learns several seasons at once.",
    equations: [
      "g(y<sub>t</sub>) = β<sub>0</sub> + β<sub>1</sub> (t / T) + Σ<sub>k=1..K</sub> δ<sub>k</sub> · max(0, t / T − c<sub>k</sub>) + Σ<sub>j</sub> [a<sub>j</sub> sin(2πjt / P) + b<sub>j</sub> cos(2πjt / P)] + Σ<sub>d</sub> γ<sub>d</sub> x<sub>d,t</sub> + ε<sub>t</sub>",
      "g = ln when every value is positive (effects then read as percentages), otherwise the identity. Changepoints c<sub>k</sub> = 0.85 k / (K + 1), K = min(10, ⌊T / 10⌋). Fourier pairs: up to 4 for the yearly cycle (with a full year), 3 weekly (three weeks), up to 6 daily (three days). Drivers enter as log x when the response is logged and x is positive and not a 0/1 flag, otherwise as x, centred.",
      "β̂ = (XᵀX + Λ)⁻¹ Xᵀ z [ref:ridge]. Λ penalises each changepoint's slope change δ<sub>k</sub> by λ times its own diagonal of XᵀX, λ = 0.3 · 10<sup>(5 − flex) / 2.5</sup>; the Fourier and driver terms get a small fixed ridge. Trend flexibility is the setting 'flex' from 1 (λ ≈ 12) to 10 (λ ≈ 0.003).",
      "ŷ<sub>T+h</sub> = exp(ĝ<sub>T+h</sub>) · s̄, s̄ = the mean of exp(ln y<sub>t</sub> − ĝ<sub>t</sub>) over the fit [ref:duan].",
    ],
    fitting: [
      "Closed form: the normal equations are solved by Cholesky decomposition on the latest 4,000 periods, refitted on every fold. Filled periods are left out of the fit. There is nothing to iterate, so the only choice that can overfit is the trend flexibility, which the Trend flexibility panel validates on the same folds.",
    ],
    forecasting: ["The trend is extended with the last slope, which includes any changepoint slopes in force at the end of the data: the usual way this model overfits. " + BAND],
    differs: ["It is Prophet's design, not Prophet: a closed-form ridge fit instead of MAP estimation in Stan, piecewise-linear trend only, no holidays, and empirical bands instead of simulated ones.", "On monthly, quarterly and yearly series it is usually the weakest model; its place is hourly and daily data and series with drivers."],
  },
  ens: {
    kind: "Combination",
    summary: "The plain average of Best smoothing, Steady trend and Trend, seasons and drivers. It is the way to let drivers pull on an otherwise smoothing-based forecast.",
    equations: ["ŷ<sub>T+h|T</sub> = ( ŷ<sup>ETS</sup> + ŷ<sup>Theta</sup> + ŷ<sup>Regression</sup> ) / 3"],
    fitting: ["Nothing of its own is fitted: it averages the three models' forecasts, each fitted as described under its own name."],
    forecasting: [BAND],
    differs: ["None. On low-frequency data the Combination (Best smoothing, Steady trend, Smooth and damp) usually does better because the regression is the weakest member there."],
  },
  comb: {
    kind: "Combination",
    summary: "The plain average of Best smoothing, Steady trend and Smooth and damp. Averaging forecasts has been recommended since Bates and Granger [ref:bates] [ref:clemen], is hard to beat with estimated weights [ref:smithwallis], and is in the spirit of the M4 competition's Comb benchmark (an average of simple, Holt and damped smoothing) [ref:m4] and of fpp3's advice [ref:fpp3] (13.4). It is Auto's default.",
    equations: ["ŷ<sub>T+h|T</sub> = ( ŷ<sup>ETS</sup> + ŷ<sup>Theta</sup> + ŷ<sup>Holt-Winters</sup> ) / 3"],
    fitting: ["No parameters of its own, so nothing of its own to overfit: the three members are fitted as described under their names, each on the same folds. Equal weights are used because estimating weights adds error that often cancels the gain [ref:smithwallis]."],
    forecasting: ["Each member's misses are partly independent, so the average's error is smaller than the members' typical error. " + BAND],
    differs: ["The members differ from M4's Comb (which averages simple, Holt and damped smoothing on seasonally adjusted data), so the Monash/M4 results for Comb are not ours. Ours are measured separately (see Evidence)."],
  },
};

export interface Topic { id: string; title: string; html: string }

export const TOPICS: Topic[] = [
  {
    id: "auto",
    title: "How Auto chooses",
    html: `
      <p>Choosing the best of eight models from a few short, overlapping backtest folds is noisy, and the noise costs accuracy: the winner's score is optimistic because it was picked for being the lowest (selection bias) [ref:selection] [ref:varma]. So Auto does not simply pick the lowest score.</p>
      <h4>Seasons of 24 periods or less (monthly, quarterly, yearly, daily)</h4>
      <p>Auto is the <b>Combination</b>. A rival replaces it only by passing three tests in turn, each on data the previous one did not decide:</p>
      <ol>
        <li>it scores better on the <b>selection folds</b> (all folds but the last) on the measure you ranked by;</li>
        <li>it also scores better on the <b>lockbox fold</b>, the last one, held back from every choice;</li>
        <li>a <b>Diebold–Mariano test</b> [ref:dm] finds it more accurate than the Combination at the 5% level. The loss is each fold's mean absolute error; because folds overlap, the variance is Newey–West [ref:newey] with lag = overlap − 1, with the Harvey–Leybourne–Newbold small-sample correction [ref:hln] and a t distribution on n − 1 degrees of freedom. Fewer than three folds give no test, and the Combination stays.</li>
      </ol>
      <p>The model card names the step that stopped a rival, or the evidence that let it through.</p>
      <h4>Longer seasons (weekly, hourly)</h4>
      <p>Auto picks the backtest winner on the selection folds, and the Combination is not a candidate. Its members are the seasonal-smoothing family, and on the Monash archive the winner of the backtest beat the Combination on every long-season dataset (hourly, half-hourly, weekly), mainly because repeat-last-cycle and the Fourier regression win there.</p>
      <h4>Why a combination</h4>
      <p>Averaging forecasts reduces variance and has no weights to estimate [ref:bates] [ref:clemen] [ref:smithwallis]. On the Monash archive [ref:monash], always using the Combination beat 'pick the backtest winner' on most monthly, quarterly and yearly datasets, and beat every published classical method from R's forecast package on M3 monthly and quarterly and on the tourism data. That evidence, and how to reproduce it, is under Evidence.</p>`,
  },
  {
    id: "seasons",
    title: "Seasons: testing and removing them",
    html: `
      <h4>Is there a season?</h4>
      <p>The Theta method's test: the lag-m autocorrelation of the series must exceed 1.645 standard errors, the standard error coming from Bartlett's formula over the shorter lags [ref:theta] [ref:bartlett]. R's thetaf() and the M4 benchmark methods use it before deseasonalising [ref:m4] [ref:forecastpkg]. It needs three cycles of history.</p>
      <p>The test has a weakness: a trend (or any smooth, persistent series such as daily sunspots) inflates the autocorrelations at every lag. The error bar then grows and a real season can be missed, and the lag-m autocorrelation itself can be large enough to pass, so a trending series is sometimes called seasonal. The second error is harmless (a season removed from a series that has none is close to zero); the first is why the test does not decide at short seasons. On the Monash archive, letting it switch the season off for ETS and Holt-Winters at seasons of 24 periods or less cost 1–4% on several monthly and quarterly datasets, so there it does not decide (AICc chooses the ETS form, and Holt-Winters keeps its season). It decides for Theta (as in thetaf()) and for seasons over 24 periods, where it is made at the shortest period that fits: at 168 hours its error bar sums 167 squared autocorrelations and sees nothing.</p>
      <h4>Seasons longer than 24 periods</h4>
      <p>R's ets() does not fit a seasonal state beyond 24 periods and says to use stlf() [ref:forecastpkg]: learning 168 seasonal values from a few weeks is more parameters than the data can support. This page takes that route [ref:fpp3] (12.1, 13.1):</p>
      <ol>
        <li>The season is removed by <b>STL</b> [ref:stl] (seasonal-trend decomposition by loess), or by <b>MSTL</b> [ref:mstl] when the history supports several periods (hourly data: 24 and 168), each period's seasonal component estimated in turn, shortest first. Seasonal windows are 7 + 4i as in forecast::mstl(), trend and low-pass windows and jumps as in R's stl(). One pass is made over the periods where R and statsmodels make two: on the hourly Monash datasets one pass was as accurate (slightly better on M4 hourly) at half the cost, and a window of about six cycles (1,008 hours for a weekly season) was as good as eight and faster.</li>
        <li>Best smoothing (trend forms only) and a damped trend run on the <b>seasonally adjusted series</b>.</li>
        <li>Each seasonal component's last cycle is repeated over the horizon and added back (a seasonal naive forecast of the component), exactly as forecast::stlf() does.</li>
      </ol>
      <p>The decomposition is redone on each backtest fold's own history. Its parameters are fixed before the first fold. Filled periods are decomposed as their filled values but masked out of the smoothing models. Our STL matches Python's statsmodels STL to machine precision on test series (settings of R's stl()), and statsmodels' MSTL to within 2% of the series' spread (statsmodels uses jumps of 1 where R uses ceil(window / 10)).</p>`,
  },
  {
    id: "backtest",
    title: "Backtest, lockbox, scores and bands",
    html: `
      <p><b>Folds.</b> Up to ten forecast origins, spaced H/3 apart and ending H before the split, each forecasting H periods ahead from the history before it: time series cross-validation [ref:fpp3] (5.10) [ref:cv]. With an <i>expanding</i> window each fold trains on everything before its origin; with a <i>rolling</i> window on a fixed length (the first fold's), so older behaviour is forgotten.</p>
      <p><b>No leakage.</b> Smoothing weights and the ETS form are fitted on the history before the first fold, so no fold is scored on periods the choice was tuned on; MASE's scale is taken from the training data before the first fold [ref:mase]; the Auto pick is made on all folds but the last.</p>
      <p><b>Lockbox.</b> With four or more folds the last is held back. Models are ranked, and Auto picks, on the others; every model is then scored once on the lockbox. That score carries no selection bias [ref:selection]. A pick that ranks low there had a lead that was luck.</p>
      <p><b>Scores.</b> MASE [ref:mase] (default), MAE, RMSE, WAPE [ref:wape], sMAPE [ref:smape], MAPE, bias; see Which model, and why? for formulas. The Deep check adds Diebold–Mariano tests [ref:dm], error by steps ahead, band coverage on every fold (leave one fold out) with the Winkler interval score [ref:winkler] [ref:scoring], and the Ljung–Box test on residuals [ref:ljung] (fpp3 5.4).</p>
      <p><b>Bands.</b> ${BAND}</p>`,
  },
  {
    id: "gaps",
    title: "Gaps and filled periods",
    html: `
      <p>Periods with no rows can be left empty or filled for display. Whatever is shown, the models need an unbroken series and bridge gaps with the <b>smart fill</b>: the usual pattern (a straight line through the deseasonalised level plus the robust phase profile) for gaps up to a quarter of the shortest season, the <b>median of the same phase in the nearest cycles</b> either side for longer ones.</p>
      <p>These fills are this project's own design, chosen by measurement: on real hourly gym counts with stretches hidden and refilled, the usual pattern was best up to about six hours and the nearby median missed 20–40% less beyond that. The smoothing models treat filled periods as missing (their state carries across, nothing is learnt), the regression leaves them out of its fit, and forecast errors are never scored on them. Seasonal naive for gaps is Hyndman's seasonal naive method [ref:fpp3].</p>`,
  },
  {
    id: "evidence",
    title: "Evidence: how this was checked",
    html: `
      <p>The forecasting is measured, not assumed. <code>tools/ts-eval/monash.ts</code> runs these models on the Monash Time Series Forecasting Archive [ref:monash] (29 datasets from the M1, M3, M4, tourism [ref:tourism] and other competitions) with the archive's protocol, and prints the mean MASE beside the published results of R's forecast package [ref:forecastpkg] (SES, Theta, TBATS, ETS, ARIMA). A fixed 141-series subset of it is the <b>accuracy gate</b> in <code>npm run gate</code>: the default forecast may not get more than 2% worse on any dataset without the change saying why.</p>
      <p>Our STL is checked against Python's statsmodels to machine precision. The seasonal ETS form is, in a later phase of the plan, to be checked series by series against statsforecast (Apache-2.0).</p>
      <p>What the checks have shown, among other things: the Combination beats every published classical method on M3 monthly and quarterly and on the tourism data; letting the backtest pick among eight models cost accuracy on most low-frequency data (hence Auto's rule); a weekly season of 52 learned as 52 seasonal states did badly and removing it first helped; and the weekly MASE scale of the archive is the 52-week seasonal naive, which an early version of our protocol got wrong (it made weekly data look 5× worse than it was). The full record, with dates and numbers, is in 09_CHANGE_LOG.md and next_steps.md.</p>`,
  },
];

/** Replaces [ref:id] with a link to the Sources list. */
export function cite(html: string): string {
  return html.replace(/\[ref:([a-z0-9]+)\]/g, (_, id: string) => {
    const r = REFERENCES[id];
    return r ? `<a class="ts-cite" href="#sources" data-cite="${id}" title="${r.full.replace(/"/g, "&quot;")}">${r.short}</a>` : `[unknown source ${id}]`;
  });
}

/** Ids cited anywhere in the documentation, for tests. */
export function citedIds(): string[] {
  const all = [
    ...Object.values(MODEL_DOCS).flatMap((d) => [d.summary, ...d.equations, ...d.fitting, ...d.forecasting, ...d.differs]),
    ...TOPICS.map((t) => t.html),
  ].join(" ");
  return [...new Set([...all.matchAll(/\[ref:([a-z0-9]+)\]/g)].map((m) => m[1]!))];
}

const list = (items: string[]): string => `<ul>${items.map((i) => `<li>${cite(i)}</li>`).join("")}</ul>`;

function sourcesHtml(focus?: string): string {
  return `<p>Everything here was reimplemented from the published methods; no code was copied from other projects. R's forecast package (GPL-3), statsmodels (BSD-3-Clause) and statsforecast (Apache-2.0) are used in the development environment only, as references to check against. The Monash archive data (CC BY 4.0) is used for testing and is not part of the app. The textbook <i>Forecasting: Principles and Practice</i> is the guide this page follows.</p>
    <ol class="ts-sources">${REFERENCE_ORDER.map((id) => {
      const r = REFERENCES[id]!;
      return `<li id="src-${id}"${id === focus ? ' class="focus"' : ""}><b>${r.short}</b>. ${r.full}${r.url ? ` <a href="${r.url}" target="_blank" rel="noopener noreferrer">${r.url.replace(/^https?:\/\//, "")}</a>` : ""}<br><span class="ts-note">Used here for: ${r.used}</span></li>`;
    }).join("")}</ol>`;
}

/** The body of a model's page, with this series' own facts at the top. */
function modelPage(s: TsSnapshot, key: ModelKey, metric: MetricKey): string {
  const d = MODEL_DOCS[key], info = MODEL_INFO[key], guide = MODEL_GUIDE[key];
  const facts = modelRows(s, key, metric);
  return `<h2>${info.name} <small>${d.kind}</small></h2>
    <p class="ts-doc-lead">${cite(d.summary)}</p>
    ${facts.length ? `<h3>On this series</h3><dl class="ts-modelcard ts-doc-facts">${facts.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl>` : ""}
    <h3>The model</h3>${d.equations.map((e) => `<p class="ts-eq">${cite(e)}</p>`).join("")}
    <h3>How it is fitted</h3>${list(d.fitting)}
    <h3>The forecast and its band</h3>${list(d.forecasting)}
    <h3>When it shines, when to doubt it</h3><p><b>Shines:</b> ${cite(guide.shines)}</p><p><b>Doubt it:</b> ${cite(guide.doubt)}</p>
    <h3>Where this differs from the textbook</h3>${list(d.differs)}`;
}

/**
 * The model details window. `open` is a model key or a topic id ("auto", "seasons",
 * "backtest", "gaps", "evidence", "sources").
 */
export function openModelDetails(options: { snap: TsSnapshot | null; open: ModelKey | string; metric: MetricKey }): void {
  const overlay = el("div", { class: "modal-overlay" });
  const close = el("button", { class: "icon-btn", type: "button", title: "Close" }, ["×"]);
  const nav = el("nav", { class: "ts-docs-nav", "aria-label": "Models and topics" });
  const body = el("div", { class: "ts-docs-body" });
  const modal = el("div", { class: "modal ts-docs-modal" }, [el("div", { class: "modal-head" }, [el("h2", {}, ["How the forecasts work"]), close]), el("div", { class: "ts-docs-grid" }, [nav, body])]);
  overlay.append(modal);
  const s = options.snap && !("error" in options.snap.models) ? options.snap : null;
  const autoPick = s && !("error" in s.models) ? s.models.auto[options.metric].pick : null;
  let current = options.open;
  const render = (focusRef?: string): void => {
    nav.innerHTML = `<h4>Models</h4>${MODEL_KEYS.map((k) => `<button type="button" data-doc="${k}" aria-current="${k === current}">${MODEL_INFO[k].name}${k === autoPick ? ' <small class="ts-auto">Auto</small>' : ""}</button>`).join("")}
      <h4>Topics</h4>${[...TOPICS, { id: "sources", title: "Sources and credits", html: "" }].map((t) => `<button type="button" data-doc="${t.id}" aria-current="${t.id === current}">${t.title}</button>`).join("")}`;
    const topic = TOPICS.find((t) => t.id === current);
    if (current === "sources") body.innerHTML = `<h2>Sources and credits</h2>${sourcesHtml(focusRef)}`;
    else if (topic) body.innerHTML = `<h2>${topic.title}</h2>${cite(topic.html)}`;
    else if (s && (MODEL_KEYS as readonly string[]).includes(current)) body.innerHTML = modelPage(s, current as ModelKey, options.metric);
    else if ((MODEL_KEYS as readonly string[]).includes(current)) body.innerHTML = `<h2>${MODEL_INFO[current as ModelKey].name}</h2><p>Open a series on the Forecast tab to see this model's fit.</p>`;
    body.scrollTop = 0;
    if (focusRef) body.querySelector(`#src-${focusRef}`)?.scrollIntoView({ block: "center" });
  };
  nav.addEventListener("click", (e) => { const b = (e.target as Element).closest<HTMLElement>("[data-doc]"); if (b) { current = b.dataset.doc!; render(); } });
  body.addEventListener("click", (e) => {
    const a = (e.target as Element).closest<HTMLAnchorElement>("a.ts-cite");
    if (a) { e.preventDefault(); current = "sources"; render(a.dataset.cite); }
  });
  const finish = (): void => { overlay.remove(); document.removeEventListener("keydown", onKey); };
  const onKey = (e: KeyboardEvent): void => { if (e.key === "Escape") finish(); };
  close.addEventListener("click", finish);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) finish(); });
  document.addEventListener("keydown", onKey);
  render();
  document.body.append(overlay);
  setupDialog(overlay, "How the forecasts work");
}

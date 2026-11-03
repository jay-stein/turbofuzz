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

const BAND = "The 80% and 95% bands are not model-based. At each step ahead the spread (root mean square) of this model's own backtest errors at that step, pooled over the folds and the neighbouring steps (a window of H/8 either side), gives a normal band around the forecast: plus or minus 1.28 times that spread for 80% and 1.96 times for 95% [ref:fpp3] (5.5). They are checked fold by fold in the Deep check. Bands like these still tend to be too narrow: see \"How far to trust the ranges\".";

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
  naive: {
    kind: "Benchmark",
    summary: "Every future period is forecast as the last observed value: the naive method [ref:fpp3] (5.2). It is the right yardstick for a series that wanders with no season, and it is the seasonal naive when the season is one period long.",
    equations: [
      "ŷ<sub>T+h|T</sub> = y<sub>T</sub>",
      "The forecast is flat: one value for every step ahead.",
    ],
    fitting: ["Nothing is fitted. Filled periods count as missing, so the last value is the last real reading."],
    forecasting: [BAND],
    differs: ["None: it is the textbook method. Its bands come from its own backtest errors, not from the random-walk formula (σ√h) the textbook gives."],
  },
  drift: {
    kind: "Benchmark",
    summary: "The naive forecast plus the average change per period over the whole history: a straight line through the first and last values, extended [ref:fpp3] (5.2). It suits a steady trend with no season.",
    equations: [
      "ŷ<sub>T+h|T</sub> = y<sub>T</sub> + h · (y<sub>T</sub> − y<sub>1</sub>) / (T − 1)",
    ],
    fitting: ["Nothing is fitted: the slope is the average change between the first and last real readings. For each backtest fold it is recomputed on that fold's history (the latest fixed-length window when the validation window is rolling)."],
    forecasting: [BAND],
    differs: ["None: it is the textbook method. A turn in the series is not noticed until it is too late: the slope averages the whole history."],
  },
  mean: {
    kind: "Benchmark",
    summary: "Every future period is forecast as the average of the whole history: the mean method [ref:fpp3] (5.2). It suits a series that bounces around one fixed level, and fails on any trend.",
    equations: [
      "ŷ<sub>T+h|T</sub> = (y<sub>1</sub> + … + y<sub>T</sub>) / T",
    ],
    fitting: ["Nothing is fitted. Filled periods count as missing and are left out of the average."],
    forecasting: [BAND],
    differs: ["None: it is the textbook method."],
  },
  ses: {
    kind: "Benchmark",
    summary: "Simple exponential smoothing: a level that moves toward each new value by a fraction α, with no trend and no season [ref:fpp3] (8.1) [ref:ets2002]. Recent values count most, so it follows a series that drifts slowly.",
    equations: [
      "ℓ<sub>t</sub> = α y<sub>t</sub> + (1 − α) ℓ<sub>t−1</sub>",
      "ŷ<sub>T+h|T</sub> = ℓ<sub>T</sub>",
      "α = 1 is the naive method; α near 0 approaches the mean.",
    ],
    fitting: ["α and the starting level are found by maximum likelihood in the same state-space form as Best smoothing (error additive, no trend, no season), on the latest 300 periods or six cycles. For the backtest it is refitted on each fold."],
    forecasting: [BAND],
    differs: ["It is the ETS(A,N,N) model of Best smoothing's family, fitted by the same code, with no AICc choice among forms."],
  },
  croston: {
    kind: "Intermittent demand",
    summary: "For a series that is mostly zeros with now and then a sale. The size of a sale and the number of periods between sales are each smoothed with simple exponential smoothing, and the forecast is size divided by gap: the demand per period [ref:croston].",
    equations: [
      "z<sub>t</sub> = z<sub>t−1</sub> + α (y<sub>t</sub> − z<sub>t−1</sub>), p<sub>t</sub> = p<sub>t−1</sub> + α (q − p<sub>t−1</sub>), updated only in periods with a sale; q is the number of periods since the last sale",
      "ŷ<sub>T+h|T</sub> = z<sub>T</sub> / p<sub>T</sub>, the same for every step ahead",
      "α = 0.1, fixed.",
    ],
    fitting: ["The start is the first sale and the wait before it. α is fixed at 0.1 (the default of R's forecast::croston) and not tuned: a series with so few sales has little to tune on. Periods before the first sale are not counted: the product did not exist yet."],
    forecasting: [BAND],
    differs: [
      "Croston's rate is biased upward [ref:syntetos2005]; the corrected method is shown beside it.",
      "It appears only for a series whose average demand interval is above 1.32 (demand in fewer than three of every four periods) and never negative [ref:syntetos2005].",
      "On a series that is mostly zeros, absolute-error measures (MAE, MASE) reward forecasting zero [ref:kolassa2016]; this method forecasts the mean, which is what stock planning needs, so judge it by RMSE and bias as well.",
    ],
  },
  sba: {
    kind: "Intermittent demand",
    summary: "Croston's method with its upward bias removed: the forecast is multiplied by 1 − α/2 [ref:syntetos2005]. The usual choice for sales that come now and then.",
    equations: [
      "ŷ<sub>T+h|T</sub> = (1 − α / 2) · z<sub>T</sub> / p<sub>T</sub>",
      "z and p are Croston's smoothed size and gap; α = 0.1, fixed.",
    ],
    fitting: ["As Croston: the start is the first sale, α is fixed at 0.1, and periods before the first sale are not counted."],
    forecasting: [BAND],
    differs: ["Shown only for intermittent series (an average demand interval above 1.32). It does not fade through a long run of zeros; the Fading demand method does. Absolute-error measures reward forecasting zero on this kind of data [ref:kolassa2016]."],
  },
  tsb: {
    kind: "Intermittent demand",
    summary: "The chance that a period has a sale is smoothed every period, including the periods with none, and multiplied by the smoothed size of a sale [ref:teunter2011]. When sales stop the chance, and the forecast, fade.",
    equations: [
      "d<sub>t</sub> = 1 if y<sub>t</sub> > 0, else 0;   π<sub>t</sub> = π<sub>t−1</sub> + β (d<sub>t</sub> − π<sub>t−1</sub>)",
      "z<sub>t</sub> = z<sub>t−1</sub> + α (y<sub>t</sub> − z<sub>t−1</sub>), only in periods with a sale",
      "ŷ<sub>T+h|T</sub> = π<sub>T</sub> · z<sub>T</sub>;   α = β = 0.1, fixed.",
    ],
    fitting: ["The chance starts at the share of periods with a sale and the size at the first sale. α and β are fixed at 0.1 and not tuned. Periods before the first sale are not counted."],
    forecasting: [BAND],
    differs: [
      "Shown only for intermittent series. It is Auto's choice for them: on 489 car-parts series (Monash protocol) it matched the Combination on MASE (1.113 and 1.127) and was best on RMSE, and Croston with the bias correction was clearly worse (1.370). That is one dataset, so the choice rests on the method's design as well [ref:teunter2011].",
      "Absolute-error measures reward forecasting zero on a series like this [ref:kolassa2016]: a flat zero forecast scored 0.763 on the same series, better than every method here, and no use for planning stock.",
    ],
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
      "The usual region is enforced but not the admissibility check on top of it; the optimiser is our own Nelder–Mead, not R's; the two-stage fit above is ours; and the bands come from backtest errors, not the model's own analytic intervals ([ref:fpp3] 8.7), which are not implemented.",
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
    differs: ["It is Prophet's design, not Prophet: a closed-form ridge fit instead of MAP estimation in Stan, piecewise-linear trend only, no holidays, and bands from its backtest errors instead of simulated ones.", "On monthly, quarterly and yearly series it is usually the weakest model; its place is hourly and daily data and series with drivers."],
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
    summary: "The plain average of Best smoothing, Steady trend and Smooth and damp (with no season at this grain, of Best smoothing and Smooth and damp only). Averaging forecasts has been recommended since Bates and Granger [ref:bates] [ref:clemen], is hard to beat with estimated weights [ref:smithwallis], and is in the spirit of the M4 competition's Comb benchmark (an average of simple, Holt and damped smoothing) [ref:m4] and of fpp3's advice [ref:fpp3] (13.4). It is Auto's default.",
    equations: ["ŷ<sub>T+h|T</sub> = ( ŷ<sup>ETS</sup> + ŷ<sup>Theta</sup> + ŷ<sup>Holt-Winters</sup> ) / 3", "With no season (yearly data): ŷ<sub>T+h|T</sub> = ( ŷ<sup>ETS</sup> + ŷ<sup>Holt-Winters</sup> ) / 2"],
    fitting: ["No parameters of its own, so nothing of its own to overfit: the three members are fitted as described under their names, each on the same folds. Equal weights are used because estimating weights adds error that often cancels the gain [ref:smithwallis]."],
    forecasting: ["Each member's misses are partly independent, so the average's error is smaller than the members' typical error. " + BAND],
    differs: ["With no season the Theta member is dropped. Theta is built for a deseasonalised series and, on short yearly series, scored worse than the other two. Measured on the Monash yearly sets and M3 Other, the two-way average beat the three-way one by 2.5% (M1 yearly), 2.8% (tourism yearly) and 7.0% (M3 Other) and tied it on M3 yearly (+0.1%): about 950 series. The rule was chosen after seeing those four sets, so it is tested on no other; it applies only when the grain has no season.", "The members differ from M4's Comb (which averages simple, Holt and damped smoothing on seasonally adjusted data), so the Monash/M4 results for Comb are not ours. Ours are measured separately (see Evidence)."],
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
    id: "verdict",
    title: "How the forecast verdict is decided, and how it was checked",
    html: `
      <p>The badge above a forecast answers what a person wants to know: <b>does it beat a simple method, is it the best available, and can you trust the shaded band</b>. The word beside the model comes from the first answer.</p>
      <h4>What the words mean</h4>
      <ul>
        <li><b>Reliable</b>: it beats the best simple method comprehensively. In the backtests it had at least 10% less error than the best of six simple methods (repeat the last cycle, the seasonal average, repeat the last value, a straight line on, the overall average, simple smoothing), it beat repeating the last cycle in at least two thirds of the tests, no simple method did better on the test that was held back, and a test was held back at all.</li>
        <li><b>Use with care</b>: the page cannot show that it beats a simple method. That is not a finding that it is bad: the margin may be thin, the record short, or no test could be held back, or in the backtests it did no better than a simple method. The simple method it names is a safe alternative.</li>
        <li><b>Can't judge yet</b>: too little history to test it against anything.</li>
      </ul>
      <p>The shaded band is judged on its own, by how often past bands held the real value against the share they aim for (80%), and never changes the word on the forecast. Is it the best available is a separate answer: a model can be reliable and still not first.</p>
      <h4>How it was checked</h4>
      <p>On 497 series drawn at random from the Monash archive [ref:monash] (M1, M3, tourism, hospital, FRED-MD and CIF, in two sets of about 250 that the rules were not tuned on), the models were run on all but the last stretch of each series, the verdict was built from the backtests alone, and the model Auto picked was then scored on the stretch held out, against the yardstick its verdict named.</p>
      <table class="ts-board"><thead><tr><th>The page said</th><th>Series</th><th>Beat the simple method on the real future</th><th>By 10% or more</th><th>Typical error against it</th></tr></thead><tbody>
        <tr><td>Reliable</td><td>60</td><td>87%</td><td>75%</td><td>31% less</td></tr>
        <tr><td>Use with care</td><td>414</td><td>59%</td><td>43%</td><td>13% less</td></tr>
        <tr><td>Can't judge yet</td><td>23</td><td>87%</td><td>52%</td><td>too few to say</td></tr>
      </tbody></table>
      <p>Two things follow. <b>Reliable is a strong claim and it held up</b>: nearly nine times in ten it beat the simple method, by a good margin. And <b>no backtest signal found a group of series where the model usually loses</b>: even where the backtests showed no edge over a simple method (the bulk of "Use with care"), the pick still won 59% of the time. That is why there is no red "Not reliable": a label that is wrong about as often as it is right is not information. What the page can honestly say is whether it has shown an edge.</p>
      <h4>Limits</h4>
      <ul>
        <li>The ten per cent and two-thirds thresholds are rules of thumb chosen before the check, not a statistical test. Reliable is precise but not common: about one series in eight earned it.</li>
        <li>These are the archive's series, mostly business and economic data with a steady pattern. A series with sudden breaks or one-off events may behave differently, and the backtests cannot see a break that has not happened yet.</li>
        <li>With under about four backtests no test is held back, so a short series is never called Reliable.</li>
      </ul>`,
  },
  {
    id: "ranges",
    title: "How far to trust the ranges",
    html: `
      <p>The shaded range is a normal band around the forecast, as wide as this model's own backtest errors at each step ahead say it should be [ref:fpp3] (5.5). Prediction ranges tend to be <b>too narrow</b>, and the textbook says so: they assume the model is right and ignore uncertainty about its settings and about which model was chosen.</p>
      <p>We measured it, on the Monash archive [ref:monash] with each forecast made from all but its last stretch (<code>tools/ts-eval/coverage.ts</code>). On 141 series from 20 datasets (2,370 forecast points) the real value fell inside the <b>80% range 83.5%</b> of the time and inside the <b>95% range 93.5%</b> of the time. An earlier version took the 10% and 90% quantiles of the same errors instead; with a handful of folds those sat well inside the true spread and the 80% range held 68%, with a worse Winkler score [ref:fpp3] (5.9) of 7.04 against 6.42 (lower is better).</p>
      <p>The choice was checked on series it was not chosen on: 60 further series from each of 11 datasets. The 80% range held <b>81 to 83%</b> on M3 monthly and quarterly, tourism, hospital, FRED-MD, NN5 and pedestrian counts, <b>76%</b> on M1 monthly, <b>72%</b> on M4 weekly and <b>65%</b> on M3 yearly, and the Winkler score was better than before on ten of the eleven. Where the history is long enough, the Heads up note says when this series' own ranges held the value less often than promised.</p>
      <p>So the ranges are close to honest for most monthly, quarterly and daily series, and <b>still too narrow for short yearly series and for weekly ones</b>: read them there as a minimum. We have not stretched them by a fixed factor, and a small-sample (<i>t</i>) correction was tried and rejected: it over-covered (86% against an aim of 80%) and scored worse.</p>`,
  },
  {
    id: "autoarima",
    title: "AutoARIMA (the deep run)",
    html: `
      <p>AutoARIMA is a deep run you start by hand under the hood: no time limit, in the background, with a Stop button. It fits the seasonal ARIMA model of Box and Jenkins [ref:boxjenkins] that the search of Hyndman and Khandakar [ref:forecastpkg] (R's <code>auto.arima</code>) settles on, and shows its parameters. Auto never uses it. Once you have run it, it joins the ranked list of all models, scored on the same backtest folds as the others, and can become the best-performing model on the cards above it; the row goes away if you change the series, the forecast length or the transformation, because it belongs to the series it was run on. Click its row to put its forecast on the chart, or its Parameters link for the fitted terms.</p>
      <p><b>The model.</b> φ(B) Φ(B<sup>m</sup>) (1 − B)<sup>d</sup> (1 − B<sup>m</sup>)<sup>D</sup> (y<sub>t</sub> − μ) = θ(B) Θ(B<sup>m</sup>) ε<sub>t</sub>, with ε normal and the same variance throughout. <i>d</i> and <i>D</i> are how many times the series is differenced, plainly and by the season; φ and Φ are autoregressive weights on earlier values, θ and Θ moving-average weights on earlier errors, and μ is a mean (no differencing) or a drift (one difference).</p>
      <h4>How it searches</h4>
      <ol>
        <li><b>Differences.</b> The seasonal strength of an STL fit with a periodic season [ref:wang2006] above 0.64 means one seasonal difference. Then a KPSS test [ref:kpss], with a window of ⌊3√n/13⌋ lags and a 5% level (0.463), adds up to two plain differences while the series still looks like it wanders.</li>
        <li><b>Four starting models</b>: (2,d,2)(1,D,1), (0,d,0)(0,D,0), (1,d,0)(1,D,0) and (0,d,1)(0,D,1), each with and without the constant when one is allowed (a mean if nothing is differenced, a drift if one difference is).</li>
        <li><b>Neighbours (the orders).</b> From the best so far it tries one more or one fewer of each order, both together, and the constant switched, and moves to any that lowers the corrected Akaike criterion (AICc) [ref:aicc], until none does. The orders stop at p, q ≤ 5, P, Q ≤ 2 and five terms in all. "Search every order" fits every order within those limits instead, which is far slower and usually lands on the same model.</li>
      </ol>
      <h4>DV-ARIMA: the differencing chosen by a forecast vote (an option, off by default)</h4>
      <p>R's <code>auto.arima</code> settles how many times to difference with a unit-root test, once, before anything else, and every later step trusts it. A test is a guess about whether the series wanders, and a wrong guess (a drift that runs away, a trend flattened away) cannot be corrected by the steps after it. Here the search is run at the test's choice <i>and</i> its neighbours: one more or one fewer plain difference, and the seasonal difference switched. Each choice's best three models, with their orders held and coefficients refitted, forecast the last stretch of your own history from three starting points half a horizon apart, and the choices are weighted by the inverse of their squared error. Inside a choice, where the models share one likelihood, the corrected Akaike weights decide. The forecast, and its ranges, are the mixture over every model from every choice. It is an alternative you tick on ("Try the differencing vote"), not the default: the plain run is the textbook's <code>auto.arima</code>, and the page shows what that would have chosen when the vote is used.</p>
      <p><b>Is it new?</b> Not in its parts, and we cannot claim it is new as a whole. Averaging forecasts is old [ref:bates], and the econometrics literature has long argued over testing for a unit root before forecasting [ref:diebold2000] against averaging over the restriction instead [ref:hansen2010], in autoregressions. We could not find it applied to the differencing order of an automatic ARIMA search, scored by forecast error, in the software or papers we looked at (R's forecast, Nixtla's statsforecast, pmdarima); that is a weaker statement than "nobody has done it", and a patent we came across argues against validating the differencing by cross-validation, because differencing changes the scale. We score on the modelled scale, where every choice is compared with the same actuals, so that does not arise here.</p>
      <p><b>Is it better?</b> A little, on average, and not on every series. On random series from the Monash archive [ref:monash] (M1, M3, tourism, hospital, FRED-MD and CIF, 150 series per set, none used to choose the method), scored on the archive's protocol, DV-ARIMA's mean MASE was 5.9% and 3.8% lower than the AutoARIMA here on two sets, and 0.0% and 0.5% lower on two others; it won more series than it lost on all four (275 against 193 in all). A fair summary is a gain of 2 to 3%, which is small beside the difference between series, and is smaller than the gain from the board's Combination, which still beats every ARIMA variant we tried. Three further ideas fitted to the same series did no better: moving the coefficients to match the series' variogram (about 1%, on the borderline), correcting the forecast by its own revisions (under 1%, since AutoARIMA's revisions were already unpredictable), and also voting on the drift (better on one set, worse on the other). It costs 3 to 5 times as long as the plain search.</p>
      <h4>How each model is fitted</h4>
      <p>The likelihood is the exact Gaussian one: the model is put in state-space form [ref:gardner1980] and the Kalman filter scores every observation, skipping missing ones [ref:jones1980], with the error variance concentrated out. Estimation is R's "CSS-ML": a conditional sum of squares first, then the exact likelihood from there, by BFGS. Autoregressive weights are mapped to the stationary region through partial autocorrelations; moving-average weights are left free and any root inside the unit circle is reflected afterwards, which leaves the likelihood unchanged and is what R does. Standard errors come from the numerical Hessian of the likelihood.</p>
      <h4>Forecasts and ranges</h4>
      <p>Forecasts come from the filter's state, with the differences integrated back. The 80% and 95% ranges are the model's own: the forecast ± z × σ √(ψ<sub>0</sub>² + … + ψ<sub>h−1</sub>²), with ψ the weights of the whole model, differencing included [ref:fpp3] (9.8). They assume the model is right, so they are narrower than the board's, which are built from its backtest errors. The run also scores the order on the board's backtest folds (the order held, the coefficients refitted on each fold's history) so it can be set beside the board's models; if the series has a Box-Cox power switched on, the model is fitted on the transformed series and mapped back.</p>
      <h4>What it does not do</h4>
      <ul>
        <li>ARIMA's own seasonal terms stop at a season of 24 periods. A longer season (a week of hours or of half-hours, a day of minutes) is taken out first with STL, on up to about six cycles of the history, ARIMA is fitted to what is left, and the seasonal pattern is added back to the forecast and its ranges [ref:fpp3] (12.1), which is what R's <code>stlf</code> does and what the board's smoothing models do. The seasonal terms (P, D, Q) are then not used, and the page says the season was removed first. With less than two full cycles of history the season cannot be seen, and the run says so and what to change.</li>
        <li>As R does, a long series (over 150 points or a season over 12) is searched with the quick approximate fit and the best three are refitted exactly; shorter ones are fitted exactly throughout, so now and then the choice differs from R's.</li>
        <li>Exogenous regressors (drivers) are not used.</li>
      </ul>
      <h4>How it was checked</h4>
      <p>It reproduces R's published results: the airline model on the logged passengers (θ = −0.4018, Θ = −0.5570, σ² = 0.001348, log-likelihood 244.70, AIC −483.4, standard errors 0.090 and 0.073), and <code>auto.arima</code> on the raw passengers: ARIMA(2,1,1)(0,1,0)[12] with coefficients 0.5960, 0.2143 and −0.9819, AICc 1018.17. On ten fixed models its log-likelihood matches statsmodels' [ref:statsmodels] to 0.02 and its estimates to 0.02 (on the differenced series, for models with a drift). Against Nixtla's statsforecast [ref:statsforecast], a port of <code>auto.arima</code>, on six series it chose the same differences every time and never ended with a higher AICc. A monthly series of a few hundred points takes a few seconds; a 24-period season on 600 points took about 40 seconds.</p>
      <p>On the Monash archive [ref:monash] the published ARIMA scores are rarely better than the Combination's, so it is not part of Auto. On a single series it can win: on the raw passengers its backtest error is 0.61 times that of repeating the last cycle, against 0.69 for the board's Auto pick.</p>`,
  },
  {
    id: "transform",
    title: "Transformations (Box-Cox)",
    html: `
      <p>When the swings in a series grow with its level, a power transformation [ref:boxcox] can make them steadier before the models learn [ref:fpp3] (3.1): <i>w</i> = (<i>y</i><sup>λ</sup> − 1) / λ, or ln <i>y</i> when λ = 0. <b>Box-Cox (auto)</b> picks λ with Guerrero's method [ref:guerrero]: cut the history into one-season stretches, and take the λ in [−1, 2] that makes each stretch's spread, relative to its level, as steady as possible. It uses the history before the first backtest fold, once, so every fold and the forecast share it. Our code gives λ = −0.29 for the airline passengers, as R's <code>BoxCox.lambda</code> does.</p>
      <p>Only a series above zero everywhere can be transformed. Best smoothing, Smooth and damp, Steady trend and the regression learn on the transformed series and their forecasts are mapped back, which gives medians rather than means; the accuracy measures here are absolute errors, which the median minimises, so no bias adjustment is applied. The benchmarks, Repeat last cycle and Seasonal average are left on the original scale, so they stay honest yardsticks.</p>
      <h4>It is off by default, on evidence</h4>
      <p>On the Monash archive [ref:monash], with 200 series per dataset, Auto's mean MASE with and without the automatic transformation: M3 monthly 0.834 against 0.853, M1 monthly 1.037 against 1.045, tourism monthly 1.453 against 1.481, hospital 0.742 against 0.743, and FRED-MD 0.457 against 0.646 (the transformation was worse on every one). An earlier run on a 141-series sample looked better on monthly data (−3% to −7%) and worse on yearly, quarterly and pedestrian data (up to +35%); the larger runs showed that to be noise. A transformation is worth trying on a series you know has variance that grows with its level, and judging by the backtest, not by how it looks.</p>`,
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
    nav.innerHTML = `<h4>Models</h4>${(s ? (s.models as { shown: ModelKey[] }).shown : MODEL_KEYS).map((k) => `<button type="button" data-doc="${k}" aria-current="${k === current}">${MODEL_INFO[k].name}${k === autoPick ? ' <small class="ts-auto">Auto</small>' : ""}</button>`).join("")}
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

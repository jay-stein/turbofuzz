/**
 * Where the Time Series methods come from. The model details window cites these by id
 * and lists them under Sources; docs/time-series-sources.md is generated from this file
 * (npx tsx tools/ts-eval/make-sources-doc.ts), so there is one list to keep right.
 *
 * Everything here was reimplemented from the published methods. No code was copied from
 * R's forecast package (GPL-3), statsmodels (BSD-3-Clause) or statsforecast (Apache-2.0);
 * the last two are used in the development environment only, to check our STL and (in a
 * later phase) our ETS against a reference. The Monash archive data (CC BY 4.0) is used
 * for testing and is not part of the app.
 */

export interface Reference {
  /** How it is cited in running text. */
  short: string;
  /** The full citation. */
  full: string;
  url?: string;
  /** What this project took from it. */
  used: string;
}

export const REFERENCES: Record<string, Reference> = {
  fpp3: {
    short: "Hyndman & Athanasopoulos (2021)",
    full: "Hyndman, R. J. and Athanasopoulos, G. (2021). Forecasting: Principles and Practice, 3rd edition. OTexts, Melbourne.",
    url: "https://otexts.com/fpp3/",
    used: "The textbook this page follows: benchmarks (5.2), residual checks (5.4), intervals (5.5), accuracy measures (5.8, 5.9), time series cross-validation (5.10), STL (3.6), seasonal strength (4.3), exponential smoothing (ch. 8), complex seasonality (12.1), weekly and sub-daily data (13.1), combinations (13.4).",
  },
  forecastpkg: {
    short: "Hyndman & Khandakar (2008)",
    full: "Hyndman, R. J. and Khandakar, Y. (2008). Automatic time series forecasting: the forecast package for R. Journal of Statistical Software, 27(3), 1-22.",
    url: "https://doi.org/10.18637/jss.v027.i03",
    used: "The behaviour of ets() (AICc selection among exponential smoothing forms; no seasonal states beyond 24 periods), stlf(), thetaf() and mstl(), which this page follows. Reimplemented from the paper; no code copied (the package is GPL-3).",
  },
  ets2002: {
    short: "Hyndman, Koehler, Snyder & Grose (2002)",
    full: "Hyndman, R. J., Koehler, A. B., Snyder, R. D. and Grose, S. (2002). A state space framework for automatic forecasting using exponential smoothing methods. International Journal of Forecasting, 18(3), 439-454.",
    used: "The ETS family (error, trend, season) and selection by information criterion.",
  },
  holt: {
    short: "Holt (1957)",
    full: "Holt, C. C. (1957). Forecasting seasonals and trends by exponentially weighted moving averages. Reprinted in International Journal of Forecasting, 20(1), 5-10 (2004).",
    used: "Linear trend smoothing.",
  },
  winters: {
    short: "Winters (1960)",
    full: "Winters, P. R. (1960). Forecasting sales by exponentially weighted moving averages. Management Science, 6(3), 324-342.",
    used: "Seasonal smoothing (Holt-Winters).",
  },
  damped: {
    short: "Gardner & McKenzie (1985)",
    full: "Gardner, E. S. and McKenzie, E. (1985). Forecasting trends in time series. Management Science, 31(10), 1237-1246.",
    used: "The damped trend.",
  },
  aicc: {
    short: "Hurvich & Tsai (1989)",
    full: "Hurvich, C. M. and Tsai, C.-L. (1989). Regression and time series model selection in small samples. Biometrika, 76(2), 297-307.",
    used: "AICc, the small-sample corrected Akaike criterion used to choose the ETS form.",
  },
  theta: {
    short: "Assimakopoulos & Nikolopoulos (2000)",
    full: "Assimakopoulos, V. and Nikolopoulos, K. (2000). The theta model: a decomposition approach to forecasting. International Journal of Forecasting, 16(4), 521-530.",
    used: "The Theta method and its test for seasonality.",
  },
  thetabillah: {
    short: "Hyndman & Billah (2003)",
    full: "Hyndman, R. J. and Billah, B. (2003). Unmasking the Theta method. International Journal of Forecasting, 19(2), 287-290.",
    used: "Theta forecasts as simple exponential smoothing plus half the slope of a linear trend: the form implemented here.",
  },
  m3: {
    short: "Makridakis & Hibon (2000)",
    full: "Makridakis, S. and Hibon, M. (2000). The M3-Competition: results, conclusions and implications. International Journal of Forecasting, 16(4), 451-476.",
    used: "Evidence that Theta and simple methods are hard to beat.",
  },
  m4: {
    short: "Makridakis, Spiliotis & Assimakopoulos (2020)",
    full: "Makridakis, S., Spiliotis, E. and Assimakopoulos, V. (2020). The M4 Competition: 100,000 time series and 61 forecasting methods. International Journal of Forecasting, 36(1), 54-74.",
    used: "Evidence for combinations (its Comb benchmark averages simple, Holt and damped smoothing); the seasonality test used by its benchmark methods.",
  },
  tourism: {
    short: "Athanasopoulos et al. (2011)",
    full: "Athanasopoulos, G., Hyndman, R. J., Song, H. and Wu, D. C. (2011). The tourism forecasting competition. International Journal of Forecasting, 27(3), 822-844.",
    used: "A benchmark dataset collection.",
  },
  bates: {
    short: "Bates & Granger (1969)",
    full: "Bates, J. M. and Granger, C. W. J. (1969). The combination of forecasts. Operational Research Quarterly, 20(4), 451-468.",
    used: "Why averaging forecasts works.",
  },
  clemen: {
    short: "Clemen (1989)",
    full: "Clemen, R. T. (1989). Combining forecasts: a review and annotated bibliography. International Journal of Forecasting, 5(4), 559-583.",
    used: "The case for simple averages.",
  },
  smithwallis: {
    short: "Smith & Wallis (2009)",
    full: "Smith, J. and Wallis, K. F. (2009). A simple explanation of the forecast combination puzzle. Oxford Bulletin of Economics and Statistics, 71(3), 331-355.",
    used: "Why equal weights are hard to beat: estimated weights add error.",
  },
  stl: {
    short: "Cleveland, Cleveland, McRae & Terpenning (1990)",
    full: "Cleveland, R. B., Cleveland, W. S., McRae, J. E. and Terpenning, I. (1990). STL: A seasonal-trend decomposition procedure based on loess. Journal of Official Statistics, 6(1), 3-73.",
    used: "The STL algorithm in stl.ts, checked against statsmodels to machine precision.",
  },
  mstl: {
    short: "Bandara, Hyndman & Bergmeir (2021)",
    full: "Bandara, K., Hyndman, R. J. and Bergmeir, C. (2021). MSTL: A seasonal-trend decomposition algorithm for time series with multiple seasonal patterns. arXiv:2107.13462.",
    url: "https://arxiv.org/abs/2107.13462",
    used: "Decomposition with several seasonal periods (hourly data: day and week).",
  },
  bartlett: {
    short: "Bartlett (1946)",
    full: "Bartlett, M. S. (1946). On the theoretical specification and sampling properties of autocorrelated time-series. Supplement to the Journal of the Royal Statistical Society, 8(1), 27-41.",
    used: "The standard error of an autocorrelation, in the seasonality test.",
  },
  prophet: {
    short: "Taylor & Letham (2018)",
    full: "Taylor, S. J. and Letham, B. (2018). Forecasting at scale. The American Statistician, 72(1), 37-45.",
    used: "The design of the trend, seasons and drivers model: a piecewise linear trend with changepoints and Fourier seasonality.",
  },
  ridge: {
    short: "Hoerl & Kennard (1970)",
    full: "Hoerl, A. E. and Kennard, R. W. (1970). Ridge regression: biased estimation for nonorthogonal problems. Technometrics, 12(1), 55-67.",
    used: "The ridge penalty on the trend's slope changes.",
  },
  duan: {
    short: "Duan (1983)",
    full: "Duan, N. (1983). Smearing estimate: a nonparametric retransformation method. Journal of the American Statistical Association, 78(383), 605-610.",
    used: "The back-transform of a model fitted on logs.",
  },
  mase: {
    short: "Hyndman & Koehler (2006)",
    full: "Hyndman, R. J. and Koehler, A. B. (2006). Another look at measures of forecast accuracy. International Journal of Forecasting, 22(4), 679-688.",
    used: "MASE, the default accuracy measure.",
  },
  smape: {
    short: "Makridakis (1993)",
    full: "Makridakis, S. (1993). Accuracy measures: theoretical and practical concerns. International Journal of Forecasting, 9(4), 527-529.",
    used: "sMAPE, the symmetric percentage error used in the M competitions, and why percentage errors need care near zero.",
  },
  wape: {
    short: "Kolassa & Schutz (2007)",
    full: "Kolassa, S. and Schutz, W. (2007). Advantages of the MAD/MEAN ratio over the MAPE. Foresight, 6, 40-43.",
    used: "WAPE, the weighted absolute percentage error.",
  },
  dm: {
    short: "Diebold & Mariano (1995)",
    full: "Diebold, F. X. and Mariano, R. S. (1995). Comparing predictive accuracy. Journal of Business and Economic Statistics, 13(3), 253-263.",
    used: "The test of whether one model's forecasts are really more accurate than another's.",
  },
  hln: {
    short: "Harvey, Leybourne & Newbold (1997)",
    full: "Harvey, D., Leybourne, S. and Newbold, P. (1997). Testing the equality of prediction mean squared errors. International Journal of Forecasting, 13(2), 281-291.",
    used: "The small-sample correction to the Diebold-Mariano statistic.",
  },
  newey: {
    short: "Newey & West (1987)",
    full: "Newey, W. K. and West, K. D. (1987). A simple, positive semi-definite, heteroskedasticity and autocorrelation consistent covariance matrix. Econometrica, 55(3), 703-708.",
    used: "The variance estimate for overlapping folds.",
  },
  ljung: {
    short: "Ljung & Box (1978)",
    full: "Ljung, G. M. and Box, G. E. P. (1978). On a measure of lack of fit in time series models. Biometrika, 65(2), 297-303.",
    used: "The residual autocorrelation test in the Deep check.",
  },
  winkler: {
    short: "Winkler (1972)",
    full: "Winkler, R. L. (1972). A decision-theoretic approach to interval estimation. Journal of the American Statistical Association, 67(337), 1072-1078.",
    used: "The interval score used to compare bands.",
  },
  scoring: {
    short: "Gneiting & Raftery (2007)",
    full: "Gneiting, T. and Raftery, A. E. (2007). Strictly proper scoring rules, prediction, and estimation. Journal of the American Statistical Association, 102(477), 359-378.",
    used: "Why the interval score is a proper way to compare bands.",
  },
  cv: {
    short: "Bergmeir & Benitez (2012)",
    full: "Bergmeir, C. and Benitez, J. M. (2012). On the use of cross-validation for time series predictor evaluation. Information Sciences, 191, 192-213.",
    used: "Time series cross-validation (our backtest folds).",
  },
  selection: {
    short: "Cawley & Talbot (2010)",
    full: "Cawley, G. C. and Talbot, N. L. C. (2010). On over-fitting in model selection and subsequent selection bias in performance evaluation. Journal of Machine Learning Research, 11, 2079-2107.",
    url: "https://jmlr.org/papers/v11/cawley10a.html",
    used: "Why the score of the model you picked is optimistic, and the case for scoring it on data the choice never saw (our lockbox fold).",
  },
  varma: {
    short: "Varma & Simon (2006)",
    full: "Varma, S. and Simon, R. (2006). Bias in error estimation when using cross-validation for model selection. BMC Bioinformatics, 7, 91.",
    used: "The size of that optimism.",
  },
  monash: {
    short: "Godahewa et al. (2021)",
    full: "Godahewa, R., Bergmeir, C., Webb, G. I., Hyndman, R. J. and Montero-Manso, P. (2021). Monash Time Series Forecasting Archive. NeurIPS 2021 Datasets and Benchmarks Track. arXiv:2105.06643.",
    url: "https://forecastingdata.org/",
    used: "The 29 benchmark datasets (CC BY 4.0) and the published results of R's forecast package that we measure against.",
  },
  statsmodels: {
    short: "Seabold & Perktold (2010)",
    full: "Seabold, S. and Perktold, J. (2010). statsmodels: Econometric and statistical modeling with Python. Proceedings of the 9th Python in Science Conference.",
    used: "Development only: its STL and MSTL are the reference our implementation is checked against. No code copied.",
  },
};

/** Ids in a stable order for the Sources list: grouped by what they support. */
export const REFERENCE_ORDER: string[] = [
  "fpp3", "forecastpkg", "monash",
  "ets2002", "holt", "winters", "damped", "aicc",
  "theta", "thetabillah", "m3", "m4", "tourism",
  "bates", "clemen", "smithwallis",
  "stl", "mstl", "bartlett",
  "prophet", "ridge", "duan",
  "mase", "smape", "wape", "cv", "winkler", "scoring", "ljung",
  "dm", "hln", "newey", "selection", "varma",
  "statsmodels",
];

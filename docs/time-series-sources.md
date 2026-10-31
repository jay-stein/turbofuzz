# Time Series: sources and credits

Generated from `src/data/timeseries/references.ts` by `tools/ts-eval/make-sources-doc.ts`; edit that file, not this one. The same list is the app's *Sources and credits* page (Forecast tab, *How the models work*).

Everything was reimplemented from the published methods. No code was copied from other projects.

- **R `forecast` package** (GPL-3, Hyndman et al.): used as a behavioural reference through its published results and documentation only.
- **statsmodels** (BSD-3-Clause): development only; its STL and MSTL are the reference our implementation is checked against (`test/timeseries-stl.test.ts`, `tools/ts-eval/make-stl-reference.py`).
- **statsforecast** (Apache-2.0, Nixtla): installed in the development virtual environment for a later parity check of our ETS; not used by the app.
- **Monash Time Series Forecasting Archive** (CC BY 4.0, Godahewa et al.): benchmark data for `tools/ts-eval/monash.ts` and the 141-series accuracy gate fixture (`test/fixtures/accuracy`, attribution in its `SOURCE.md`); not part of the app.
- **Forecasting: Principles and Practice** (Hyndman and Athanasopoulos, https://otexts.com/fpp3/): the guide this page follows; cited, not reproduced.

## References

- **Hyndman & Athanasopoulos (2021).** Hyndman, R. J. and Athanasopoulos, G. (2021). Forecasting: Principles and Practice, 3rd edition. OTexts, Melbourne. https://otexts.com/fpp3/
  Used for: The textbook this page follows: benchmarks (5.2), residual checks (5.4), intervals (5.5), accuracy measures (5.8, 5.9), time series cross-validation (5.10), STL (3.6), seasonal strength (4.3), exponential smoothing (ch. 8), complex seasonality (12.1), weekly and sub-daily data (13.1), combinations (13.4).
- **Hyndman & Khandakar (2008).** Hyndman, R. J. and Khandakar, Y. (2008). Automatic time series forecasting: the forecast package for R. Journal of Statistical Software, 27(3), 1-22. https://doi.org/10.18637/jss.v027.i03
  Used for: The behaviour of ets() (AICc selection among exponential smoothing forms; no seasonal states beyond 24 periods), stlf(), thetaf() and mstl(), which this page follows. Reimplemented from the paper; no code copied (the package is GPL-3).
- **Godahewa et al. (2021).** Godahewa, R., Bergmeir, C., Webb, G. I., Hyndman, R. J. and Montero-Manso, P. (2021). Monash Time Series Forecasting Archive. NeurIPS 2021 Datasets and Benchmarks Track. arXiv:2105.06643. https://forecastingdata.org/
  Used for: The 29 benchmark datasets (CC BY 4.0) and the published results of R's forecast package that we measure against.
- **Hyndman, Koehler, Snyder & Grose (2002).** Hyndman, R. J., Koehler, A. B., Snyder, R. D. and Grose, S. (2002). A state space framework for automatic forecasting using exponential smoothing methods. International Journal of Forecasting, 18(3), 439-454.
  Used for: The ETS family (error, trend, season) and selection by information criterion.
- **Holt (1957).** Holt, C. C. (1957). Forecasting seasonals and trends by exponentially weighted moving averages. Reprinted in International Journal of Forecasting, 20(1), 5-10 (2004).
  Used for: Linear trend smoothing.
- **Winters (1960).** Winters, P. R. (1960). Forecasting sales by exponentially weighted moving averages. Management Science, 6(3), 324-342.
  Used for: Seasonal smoothing (Holt-Winters).
- **Gardner & McKenzie (1985).** Gardner, E. S. and McKenzie, E. (1985). Forecasting trends in time series. Management Science, 31(10), 1237-1246.
  Used for: The damped trend.
- **Hurvich & Tsai (1989).** Hurvich, C. M. and Tsai, C.-L. (1989). Regression and time series model selection in small samples. Biometrika, 76(2), 297-307.
  Used for: AICc, the small-sample corrected Akaike criterion used to choose the ETS form.
- **Assimakopoulos & Nikolopoulos (2000).** Assimakopoulos, V. and Nikolopoulos, K. (2000). The theta model: a decomposition approach to forecasting. International Journal of Forecasting, 16(4), 521-530.
  Used for: The Theta method and its test for seasonality.
- **Hyndman & Billah (2003).** Hyndman, R. J. and Billah, B. (2003). Unmasking the Theta method. International Journal of Forecasting, 19(2), 287-290.
  Used for: Theta forecasts as simple exponential smoothing plus half the slope of a linear trend: the form implemented here.
- **Makridakis & Hibon (2000).** Makridakis, S. and Hibon, M. (2000). The M3-Competition: results, conclusions and implications. International Journal of Forecasting, 16(4), 451-476.
  Used for: Evidence that Theta and simple methods are hard to beat.
- **Makridakis, Spiliotis & Assimakopoulos (2020).** Makridakis, S., Spiliotis, E. and Assimakopoulos, V. (2020). The M4 Competition: 100,000 time series and 61 forecasting methods. International Journal of Forecasting, 36(1), 54-74.
  Used for: Evidence for combinations (its Comb benchmark averages simple, Holt and damped smoothing); the seasonality test used by its benchmark methods.
- **Athanasopoulos et al. (2011).** Athanasopoulos, G., Hyndman, R. J., Song, H. and Wu, D. C. (2011). The tourism forecasting competition. International Journal of Forecasting, 27(3), 822-844.
  Used for: A benchmark dataset collection.
- **Bates & Granger (1969).** Bates, J. M. and Granger, C. W. J. (1969). The combination of forecasts. Operational Research Quarterly, 20(4), 451-468.
  Used for: Why averaging forecasts works.
- **Clemen (1989).** Clemen, R. T. (1989). Combining forecasts: a review and annotated bibliography. International Journal of Forecasting, 5(4), 559-583.
  Used for: The case for simple averages.
- **Smith & Wallis (2009).** Smith, J. and Wallis, K. F. (2009). A simple explanation of the forecast combination puzzle. Oxford Bulletin of Economics and Statistics, 71(3), 331-355.
  Used for: Why equal weights are hard to beat: estimated weights add error.
- **Cleveland, Cleveland, McRae & Terpenning (1990).** Cleveland, R. B., Cleveland, W. S., McRae, J. E. and Terpenning, I. (1990). STL: A seasonal-trend decomposition procedure based on loess. Journal of Official Statistics, 6(1), 3-73.
  Used for: The STL algorithm in stl.ts, checked against statsmodels to machine precision.
- **Bandara, Hyndman & Bergmeir (2021).** Bandara, K., Hyndman, R. J. and Bergmeir, C. (2021). MSTL: A seasonal-trend decomposition algorithm for time series with multiple seasonal patterns. arXiv:2107.13462. https://arxiv.org/abs/2107.13462
  Used for: Decomposition with several seasonal periods (hourly data: day and week).
- **Bartlett (1946).** Bartlett, M. S. (1946). On the theoretical specification and sampling properties of autocorrelated time-series. Supplement to the Journal of the Royal Statistical Society, 8(1), 27-41.
  Used for: The standard error of an autocorrelation, in the seasonality test.
- **Taylor & Letham (2018).** Taylor, S. J. and Letham, B. (2018). Forecasting at scale. The American Statistician, 72(1), 37-45.
  Used for: The design of the trend, seasons and drivers model: a piecewise linear trend with changepoints and Fourier seasonality.
- **Hoerl & Kennard (1970).** Hoerl, A. E. and Kennard, R. W. (1970). Ridge regression: biased estimation for nonorthogonal problems. Technometrics, 12(1), 55-67.
  Used for: The ridge penalty on the trend's slope changes.
- **Duan (1983).** Duan, N. (1983). Smearing estimate: a nonparametric retransformation method. Journal of the American Statistical Association, 78(383), 605-610.
  Used for: The back-transform of a model fitted on logs.
- **Hyndman & Koehler (2006).** Hyndman, R. J. and Koehler, A. B. (2006). Another look at measures of forecast accuracy. International Journal of Forecasting, 22(4), 679-688.
  Used for: MASE, the default accuracy measure.
- **Makridakis (1993).** Makridakis, S. (1993). Accuracy measures: theoretical and practical concerns. International Journal of Forecasting, 9(4), 527-529.
  Used for: sMAPE, the symmetric percentage error used in the M competitions, and why percentage errors need care near zero.
- **Kolassa & Schutz (2007).** Kolassa, S. and Schutz, W. (2007). Advantages of the MAD/MEAN ratio over the MAPE. Foresight, 6, 40-43.
  Used for: WAPE, the weighted absolute percentage error.
- **Bergmeir & Benitez (2012).** Bergmeir, C. and Benitez, J. M. (2012). On the use of cross-validation for time series predictor evaluation. Information Sciences, 191, 192-213.
  Used for: Time series cross-validation (our backtest folds).
- **Winkler (1972).** Winkler, R. L. (1972). A decision-theoretic approach to interval estimation. Journal of the American Statistical Association, 67(337), 1072-1078.
  Used for: The interval score used to compare bands.
- **Gneiting & Raftery (2007).** Gneiting, T. and Raftery, A. E. (2007). Strictly proper scoring rules, prediction, and estimation. Journal of the American Statistical Association, 102(477), 359-378.
  Used for: Why the interval score is a proper way to compare bands.
- **Ljung & Box (1978).** Ljung, G. M. and Box, G. E. P. (1978). On a measure of lack of fit in time series models. Biometrika, 65(2), 297-303.
  Used for: The residual autocorrelation test in the Deep check.
- **Diebold & Mariano (1995).** Diebold, F. X. and Mariano, R. S. (1995). Comparing predictive accuracy. Journal of Business and Economic Statistics, 13(3), 253-263.
  Used for: The test of whether one model's forecasts are really more accurate than another's.
- **Harvey, Leybourne & Newbold (1997).** Harvey, D., Leybourne, S. and Newbold, P. (1997). Testing the equality of prediction mean squared errors. International Journal of Forecasting, 13(2), 281-291.
  Used for: The small-sample correction to the Diebold-Mariano statistic.
- **Newey & West (1987).** Newey, W. K. and West, K. D. (1987). A simple, positive semi-definite, heteroskedasticity and autocorrelation consistent covariance matrix. Econometrica, 55(3), 703-708.
  Used for: The variance estimate for overlapping folds.
- **Cawley & Talbot (2010).** Cawley, G. C. and Talbot, N. L. C. (2010). On over-fitting in model selection and subsequent selection bias in performance evaluation. Journal of Machine Learning Research, 11, 2079-2107. https://jmlr.org/papers/v11/cawley10a.html
  Used for: Why the score of the model you picked is optimistic, and the case for scoring it on data the choice never saw (our lockbox fold).
- **Varma & Simon (2006).** Varma, S. and Simon, R. (2006). Bias in error estimation when using cross-validation for model selection. BMC Bioinformatics, 7, 91.
  Used for: The size of that optimism.
- **Seabold & Perktold (2010).** Seabold, S. and Perktold, J. (2010). statsmodels: Econometric and statistical modeling with Python. Proceedings of the 9th Python in Science Conference.
  Used for: Development only: its STL and MSTL are the reference our implementation is checked against. No code copied.

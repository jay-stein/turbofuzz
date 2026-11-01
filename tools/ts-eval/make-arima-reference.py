"""
Reference fits for the ARIMA tests: statsmodels' SARIMAX (exact Gaussian likelihood with a diffuse start for the differencing)
on fixed series and fixed orders, and Nixtla's statsforecast AutoARIMA (a port of R's auto.arima) on the same series.
Development only; nothing here is copied into the app.

  .venv-recipe-parity/Scripts/python.exe tools/ts-eval/make-arima-reference.py   (writes test/fixtures/arima-reference.json)
"""
import json, warnings
import numpy as np
import pandas as pd
import statsmodels.api as sm
from statsforecast import StatsForecast
from statsforecast.models import AutoARIMA

warnings.filterwarnings("ignore")
AIR = [112,118,132,129,121,135,148,148,136,119,104,118,115,126,141,135,125,149,170,170,158,133,114,140,145,150,178,163,172,178,199,199,184,162,146,166,171,180,193,181,183,218,230,242,209,191,172,194,196,196,236,235,229,243,264,272,237,211,180,201,204,188,235,227,234,264,302,293,259,229,203,229,242,233,267,269,270,315,364,347,312,274,237,278,284,277,317,313,318,374,413,405,355,306,271,306,315,301,356,348,355,422,465,467,404,347,305,336,340,318,362,348,363,435,491,505,404,359,310,337,360,342,406,396,420,472,548,559,463,407,362,405,417,391,419,461,472,535,622,606,508,461,390,432]
rng = np.random.default_rng(7)
def arma(n, ar, ma, c=0.0, sd=1.0):
    e = rng.normal(0, sd, n + 100)
    y = np.zeros(n + 100)
    for t in range(n + 100):
        y[t] = c + e[t] + sum(a * y[t - i - 1] for i, a in enumerate(ar) if t - i - 1 >= 0) + sum(b * e[t - j - 1] for j, b in enumerate(ma) if t - j - 1 >= 0)
    return y[100:]
series = {
    "air": AIR,
    "logair": list(np.log(AIR)),
    "ar1": list(arma(120, [0.6], [], 5.0)),
    "arma11": list(arma(150, [0.5], [0.4], 2.0)),
    "walk": list(np.cumsum(rng.normal(0.3, 1.0, 140)) + 50),
    "monthly": list(100 + 0.8 * np.arange(96) + 12 * np.sin(2 * np.pi * np.arange(96) / 12) + arma(96, [0.4], [0.3], 0, 3)),
}
cases = [
    ("ar1", (1, 0, 0), (0, 0, 0, 0), True),
    ("ar1", (2, 0, 0), (0, 0, 0, 0), True),
    ("arma11", (1, 0, 1), (0, 0, 0, 0), True),
    ("walk", (0, 1, 1), (0, 0, 0, 0), False),
    ("walk", (1, 1, 0), (0, 0, 0, 0), True),
    ("logair", (0, 1, 1), (0, 1, 1, 12), False),
    ("air", (2, 1, 1), (0, 1, 0, 12), False),
    ("air", (1, 1, 1), (1, 1, 1, 12), False),
    ("monthly", (1, 0, 1), (0, 1, 1, 12), False),
    ("monthly", (1, 1, 0), (1, 1, 0, 12), False),
]
out = {"series": series, "fits": [], "auto": []}
for name, order, seas, const in cases:
    y = np.array(series[name])
    orig_order, orig_seas = order, seas
    # A constant with differencing is a drift: fit it as a mean on the differenced series, the likelihood we compare with
    # (statsmodels' own trend="t" handling of the differencing states gives a different, diffuse-state likelihood).
    trend = "c" if const else None
    if const and order[1] + seas[1] > 0:
        w = np.diff(y, order[1]) if order[1] else y
        if seas[1]:
            w = w[seas[3]:] - w[:-seas[3]]
        y, order, seas = w, (order[0], 0, order[2]), (seas[0], 0, seas[2], seas[3])
    mod = sm.tsa.SARIMAX(y, order=order, seasonal_order=seas, trend=trend, enforce_stationarity=True, enforce_invertibility=True)
    res = mod.fit(disp=False, maxiter=500)
    params = {k: float(v) for k, v in zip(res.param_names, res.params)}
    out["fits"].append({"series": name, "order": list(orig_order), "seasonal": list(orig_seas), "constant": const, "params": params, "llf": float(res.llf), "sigma2": float(res.params[-1]), "nobs_used": int(res.nobs - mod.k_diffuse_states) if hasattr(mod, "k_diffuse_states") else int(res.nobs), "aic": float(res.aic)})
for name, m in [("air", 12), ("logair", 12), ("ar1", 1), ("arma11", 1), ("walk", 1), ("monthly", 12)]:
    df = pd.DataFrame({"unique_id": name, "ds": pd.date_range("2000-01-01", periods=len(series[name]), freq="MS"), "y": series[name]})
    sf = StatsForecast(models=[AutoARIMA(season_length=m)], freq="MS")
    fc = sf.forecast(df=df, h=12, level=[80, 95], fitted=False)
    mdl = StatsForecast(models=[AutoARIMA(season_length=m)], freq="MS")
    mdl.fit(df)
    fitted = mdl.fitted_[0, 0].model_
    out["auto"].append({"series": name, "m": m, "order": [int(v) for v in fitted["arma"][:2]] + [int(fitted["arma"][5])] if False else None, "arma": [int(v) for v in fitted["arma"]], "coef": {k: float(v) for k, v in fitted["coef"].items()}, "aic": float(fitted["aic"]), "aicc": float(fitted.get("aicc", np.nan)), "loglik": float(fitted["loglik"]), "sigma2": float(fitted["sigma2"]), "forecast": [float(v) for v in fc["AutoARIMA"].values], "lo80": [float(v) for v in fc["AutoARIMA-lo-80"].values], "hi80": [float(v) for v in fc["AutoARIMA-hi-80"].values]})
json.dump(out, open("test/fixtures/arima-reference.json", "w"), indent=1)
print("wrote", len(out["fits"]), "fits and", len(out["auto"]), "auto fits")

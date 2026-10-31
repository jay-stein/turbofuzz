"""
Writes test/fixtures/ets-reference.json: one-step forecasts of Python statsmodels' ETSModel
(BSD-3-Clause), which implements the innovations form of Hyndman et al. (2008), for fixed
parameters and starting states, so test/timeseries-ets-form.test.ts can check our equations
against an independent implementation. No fitting is involved: parameters and starting
states are given, so the two must agree to rounding.

Known difference, not ours: for a multiplicative season statsmodels updates the season with
the current level, s_t = g y_t / l_t + (1 - g) s_{t-m}, where fpp3 (8.3) and R's forecast
package use the previous level, s_t = g y_t / (l_{t-1} + phi b_{t-1}) + (1 - g) s_{t-m}. The two
multiplicative-season cases (M,Ad,M and M,N,M) are therefore written to the file but checked
in the test against the textbook's component form instead.

    .venv-recipe-parity/Scripts/python.exe -I tools/ts-eval/make-ets-reference.py
"""
import json
import math

import numpy as np
from statsmodels.tsa.exponential_smoothing.ets import ETSModel

M = 12
n = 60
y = [round(120 + 1.5 * t + (18 + 0.1 * t) * math.sin(2 * math.pi * t / M) + 4 * math.sin(t * 1.9), 4) for t in range(n)]
# Seasonal starting values as factors (mean 1) and as amounts (sum 0), deliberately unequal so their order matters.
fac = [1.12, 1.2, 1.1, 0.98, 0.9, 0.85, 0.88, 0.95, 1.0, 1.04, 0.96, 1.02]
fac = [f * M / sum(fac) for f in fac]
amt = [14, 20, 12, -2, -10, -16, -12, -6, 0, 5, -3, -2]
amt = [a - sum(amt) / M for a in amt]

CASES = [
    # name, error, trend, damped, seasonal, params
    ("A,N,N", "add", None, False, None, dict(a=0.35)),
    ("A,A,N", "add", "add", False, None, dict(a=0.4, b=0.1)),
    ("A,Ad,A", "add", "add", True, "add", dict(a=0.3, b=0.06, g=0.2, phi=0.9)),
    ("M,N,N", "mul", None, False, None, dict(a=0.35)),
    ("M,Ad,N", "mul", "add", True, None, dict(a=0.45, b=0.08, phi=0.92)),
    ("M,N,A", "mul", None, False, "add", dict(a=0.25, g=0.3)),
    ("M,A,A", "mul", "add", False, "add", dict(a=0.3, b=0.05, g=0.2)),
    ("M,Ad,M", "mul", "add", True, "mul", dict(a=0.3, b=0.05, g=0.25, phi=0.9)),
    ("M,N,M", "mul", None, False, "mul", dict(a=0.2, g=0.3)),
]
out = {
    "note": "One-step forecasts from statsmodels ETSModel with known parameters and starting states. Regenerate with tools/ts-eval/make-ets-reference.py",
    "m": M, "y": y, "cases": [],
}
l0, b0 = 125.0, 1.4
for name, err, trend, damped, seas, p in CASES:
    kw = dict(error=err, trend=trend, damped_trend=damped, seasonal=seas, seasonal_periods=M if seas else None, initialization_method="known", initial_level=l0)
    if trend:
        kw["initial_trend"] = b0
    s0 = None
    if seas:
        s0 = fac if seas == "mul" else amt
        # statsmodels lists the starting seasonal values from the oldest state, s_{-m+1}, to s_0 for the first m observations.
        kw["initial_seasonal"] = s0
    model = ETSModel(np.array(y), **kw)
    params = [p["a"]]
    if trend:
        params.append(p["b"])
    if seas:
        params.append(p["g"])
    if damped:
        params.append(p["phi"])
    params += [l0] if True else []
    # parameter order in statsmodels: alpha, [beta], [gamma], [phi], initial states (known: none are free)
    names = list(model.param_names)
    free = [pn for pn in names if not pn.startswith("initial_")]
    vals = dict(zip(free, [p["a"]] + ([p["b"]] if trend else []) + ([p["g"]] if seas else []) + ([p["phi"]] if damped else [])))
    full = [vals.get(pn, 0.0) for pn in names]
    res = model.smooth(full)
    fitted = [float(v) for v in res.fittedvalues]
    out["cases"].append(dict(name=name, error="A" if err == "add" else "M", trend="N" if not trend else ("Ad" if damped else "A"), season="N" if not seas else ("A" if seas == "add" else "M"),
                             a=p["a"], be=p.get("b", 0.0), ga=p.get("g", 0.0), ph=p.get("phi", 1.0), l0=l0, b0=b0 if trend else 0.0, s0=s0 or [], fitted=fitted))
with open("test/fixtures/ets-reference.json", "w") as fh:
    json.dump(out, fh, separators=(",", ":"))
print("written", len(out["cases"]), "cases")

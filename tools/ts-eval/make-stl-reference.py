"""
Writes test/fixtures/stl-reference.json: STL and MSTL output from Python statsmodels
(BSD-3-Clause) on small deterministic series, for test/timeseries-stl.test.ts.

Settings are those of R's stats::stl (the north star for this project): seasonal_deg 0,
trend_deg 1, low_pass_deg 1, jumps ceil(window / 10), 2 inner and 0 outer passes (robust:
1 inner and 15 outer). statsmodels' own defaults differ (5 inner passes, jumps of 1).

    .venv-recipe-parity/Scripts/python.exe -I tools/ts-eval/make-stl-reference.py
"""
import json
import math

import numpy as np
from statsmodels.tsa.seasonal import MSTL, STL


def odd(v):
    k = math.ceil(v)
    return k + 1 if k % 2 == 0 else k


def jump(w):
    return math.ceil(w / 10)


out = {
    "note": "Reference STL and MSTL output from Python statsmodels (BSD-3-Clause) with the settings of R stats::stl. Regenerate with tools/ts-eval/make-stl-reference.py",
    "cases": [],
}


def series(n, f):
    return [round(f(i), 4) for i in range(n)]


def stl_case(name, y, m, ns, robust):
    nt = odd(1.5 * m / (1 - 1.5 / ns))
    nl = m + 1 if m % 2 == 0 else m + 2
    model = STL(np.array(y), period=m, seasonal=ns, trend=nt, low_pass=nl, seasonal_deg=0, trend_deg=1,
                low_pass_deg=1, robust=robust, seasonal_jump=jump(ns), trend_jump=jump(nt), low_pass_jump=jump(nl))
    f = model.fit(inner_iter=1 if robust else 2, outer_iter=15 if robust else 0)
    out["cases"].append(dict(name=name, kind="stl", y=y, m=m, seasonal_window=ns, robust=robust,
                             seasonal=[round(v, 8) for v in f.seasonal], trend=[round(v, 8) for v in f.trend]))


a = series(72, lambda i: 100 + 2 * i + 20 * math.sin(2 * math.pi * i / 12) + 7 * math.sin(i * 1.3) + 3 * math.cos(i * 0.37))
stl_case("monthly", a, 12, 7, False)
b = list(a)
b[30] += 150
stl_case("monthly-outlier-robust", b, 12, 11, True)
c = series(130, lambda i: 50 + 0.1 * i + 12 * math.sin(2 * math.pi * i / 52) + 4 * math.sin(i * 2.1))
stl_case("weekly", c, 52, 11, False)

d = series(420, lambda i: 100 + 30 * math.sin(2 * math.pi * i / 24) + 10 * math.sin(2 * math.pi * i / 168) + 3 * math.sin(i * 1.7))
r = MSTL(np.array(d), periods=[24, 168], windows=[11, 15], iterate=2,
         stl_kwargs=dict(seasonal_deg=0, seasonal_jump=1, trend_jump=1, low_pass_jump=1)).fit()
# statsmodels' MSTL uses jumps of 1 where R uses ceil(window / 10), so this one is compared loosely.
out["cases"].append(dict(name="hourly-mstl", kind="mstl-loose", y=d, periods=[24, 168],
                         seasonal=[[round(v, 6) for v in r.seasonal[:, i]] for i in range(2)],
                         trend=[round(v, 6) for v in r.trend], tolerance_sd_fraction=0.02))
with open("test/fixtures/stl-reference.json", "w") as fh:
    json.dump(out, fh, separators=(",", ":"))
print("written", len(out["cases"]), "cases")

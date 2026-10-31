"""
Reference forecasts from Nixtla's statsforecast (Apache-2.0; a port of R's forecast::ets and
thetaf) on the same series that tools/ts-eval/parity.ts runs through our engine. Development
only: nothing here is part of the app.

    .venv-recipe-parity/Scripts/python.exe -I tools/ts-eval/parity_statsforecast.py <folder of .tsf> <out.json> [cap] [dataset ...]

Series are sampled with the same even stride as monash.ts (cap per dataset, default 100), and
missing values are carried forward as there.
"""
import json
import math
import sys
import warnings

import numpy as np

warnings.filterwarnings("ignore")
from statsforecast.models import AutoETS, Theta  # noqa: E402

DATASETS = {
    # file: (season length, horizon)
    "m3_monthly_dataset": (12, 18),
    "m3_quarterly_dataset": (4, 8),
    "m3_yearly_dataset": (1, 6),
    "tourism_monthly_dataset": (12, 24),
    "tourism_quarterly_dataset": (4, 8),
    "hospital_dataset": (12, 12),
    "m1_monthly_dataset": (12, 18),
}


def read_tsf(path):
    names, series, in_data = [], [], False
    with open(path, encoding="utf-8", errors="replace") as fh:
        for line in fh:
            line = line.rstrip("\r\n")
            if not line or line.startswith("#"):
                continue
            if not in_data:
                in_data = line.startswith("@data")
                continue
            parts = line.split(":")
            vals = [float("nan") if v == "?" else float(v) for v in ":".join(parts[2:]).split(",")]
            prev = float("nan")
            for i, v in enumerate(vals):
                if v == v:
                    prev = v
                else:
                    vals[i] = prev
            first = next((v for v in vals if v == v), 0.0)
            vals = [first if v != v else v for v in vals]
            names.append(parts[0])
            series.append(vals)
    return names, series


def mase(train, test, fc, m):
    s = m if len(train) > m else 1
    d = np.mean(np.abs(train[s:] - train[:-s]))
    return float(np.mean(np.abs(test - fc)) / d) if d > 0 else float("nan")


def main():
    folder, out = sys.argv[1], sys.argv[2]
    cap = int(sys.argv[3]) if len(sys.argv) > 3 else 100
    only = sys.argv[4:]
    result = {}
    for ds, (m, h) in DATASETS.items():
        if only and not any(o in ds for o in only):
            continue
        names, series = read_tsf(f"{folder}/{ds}.tsf")
        idx = list(range(len(series))) if len(series) <= cap else [math.floor(k * len(series) / cap) for k in range(cap)]
        rows = []
        for i in idx:
            y = np.array(series[i], dtype=float)
            if len(y) <= h + 2:
                continue
            train, test = y[:-h], y[-h:]
            row = {"name": names[i], "h": h}
            try:
                e = AutoETS(season_length=m)
                e.fit(train)
                fc = e.predict(h=h)["mean"]
                row.update(ets_method=str(e.model_["method"]) if "method" in e.model_ else str(e.model_.get("components")), ets_fc=[float(v) for v in fc], ets_mase=mase(train, test, fc, m), ets_aicc=float(e.model_["aicc"]))
            except Exception as err:  # a series the reference cannot fit
                row["ets_error"] = str(err)[:80]
            try:
                t = Theta(season_length=m)
                t.fit(train)
                fc = t.predict(h=h)["mean"]
                row.update(theta_fc=[float(v) for v in fc], theta_mase=mase(train, test, fc, m))
            except Exception as err:
                row["theta_error"] = str(err)[:80]
            rows.append(row)
        result[ds] = {"m": m, "h": h, "series": rows}
        print(f"{ds}: {len(rows)} series")
    with open(out, "w") as fh:
        json.dump(result, fh)


main()

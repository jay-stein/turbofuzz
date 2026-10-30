import json, sys, warnings
import numpy as np
from statsmodels.tsa.seasonal import seasonal_decompose
from statsmodels.tsa.holtwinters import ExponentialSmoothing
from statsmodels.tsa.forecasting.theta import ThetaModel
warnings.filterwarnings("ignore")
fx = json.load(open(sys.argv[1]))
def mae(a, b): return float(np.mean(np.abs(np.asarray(a) - np.asarray(b))))
for f in fx:
    y = np.asarray(f["y"], float); m, H, T = f["m"], f["H"], f["split"]
    print(f"\n=== {f['name']}: N={len(y)} m={m} H={H} (page season {f['chosen']}{', scaled' if f['scaled'] else ''})")
    if f["trend"] is not None and m > 1:
        sd = seasonal_decompose(y, period=m, model="additive", two_sided=True)
        tr = np.asarray(f["trend"]); ok = ~np.isnan(sd.trend)
        print(f"  trend vs statsmodels centred MA: max |diff| {np.max(np.abs(tr[ok] - sd.trend[ok])):.2e} over {ok.sum()} interior periods")
        # statsmodels' season is the per-phase MEAN of the detrended series; ours the MEDIAN.
        det = y - sd.trend; idx = np.arange(len(y)) % m
        med = np.array([np.nanmedian(det[idx == k]) for k in range(m)]); med -= med.mean()
        ours = np.asarray(f["seasonal"])[:m]
        print(f"  season vs per-phase median (same method): max |diff| {np.max(np.abs(ours - med[np.arange(m)])):.2e}; vs statsmodels mean: corr {np.corrcoef(ours, sd.seasonal[:m])[0,1]:.3f}")
    train, test = y[:T], y[T:T + H]
    res = {}
    sn = np.array([train[T - m + (h % m)] for h in range(H)]) if m > 1 else np.repeat(train[-1], H)
    res["seasonal naive"] = mae(sn, test)
    pos = (train > 0).all()
    try:
        hw = ExponentialSmoothing(train, trend="add", damped_trend=True, seasonal="add" if m > 1 else None, seasonal_periods=m if m > 1 else None, initialization_method="estimated").fit()
        res["statsmodels HW (add, damped)"] = mae(hw.forecast(H), test)
        if pos and m > 1:
            hwm = ExponentialSmoothing(train, trend="add", damped_trend=True, seasonal="mul", seasonal_periods=m, initialization_method="estimated").fit()
            res["statsmodels HW (mul, damped)"] = mae(hwm.forecast(H), test)
    except Exception as e: res["statsmodels HW"] = str(e)[:40]
    try:
        th = ThetaModel(train, period=m if m > 1 else None, deseasonalize=m > 1, method="additive" if not pos else "auto").fit()
        res["statsmodels Theta"] = mae(th.forecast(H), test)
    except Exception as e: res["statsmodels Theta"] = str(e)[:40]
    for k, lab in [("sn", "page seasonal naive"), ("hw", "page Holt-Winters"), ("theta", "page Theta"), ("reg", "page regression"), ("ens", "page ensemble")]:
        res[lab] = mae(f["F"][k], test)
    base = res["seasonal naive"]
    for k, v in res.items():
        print(f"  {k:32s} {v if isinstance(v, str) else f'MAE {v:10.3f}  ({v / base:5.2f}x naive)'}")
    print("  page sn matches python sn:", np.allclose(f["F"]["sn"], sn))

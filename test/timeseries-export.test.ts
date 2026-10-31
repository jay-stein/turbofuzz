import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTable } from "../src/data/timeseries/base.js";
import { defaultConfig, TsEngine } from "../src/data/timeseries/engine.js";
import { backtestRows, forecastRows, scorecardRows } from "../src/ui/timeseries-export.js";

function snap(backtest: boolean) {
  const n = 144;
  const times = Float64Array.from({ length: n }, (_, i) => Date.UTC(1949, i, 1));
  const v = Float64Array.from({ length: n }, (_, i) => (100 + 2 * i) * (1 + 0.2 * Math.sin((2 * Math.PI * i) / 12)) + 5 * Math.sin(i * 1.3));
  const e = new TsEngine(buildTable({ times, cols: { sales: v }, flags: {}, groups: ["all"], rowGroup: new Uint16Array(n), groupCol: null, dateCol: "month", dropped: 0 })!);
  return e.compute({ ...defaultConfig(e.info()), grain: "month", horizon: 12 }, "forecast", { backtest });
}
const iso = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
const starts = (s: ReturnType<typeof snap>): number[] => Array.from({ length: s.A.n + s.H }, (_, i) => Date.UTC(1949, i, 1));

test("the backtest only travels when asked for", () => {
  assert.equal(snap(false).backtest, undefined);
  assert.ok(snap(true).backtest);
});

test("forecast, scorecard and backtest CSVs hold what an analyst needs", () => {
  const s = snap(true);
  if ("error" in s.models) throw new Error(s.models.error);
  const f = forecastRows(s, "ets", starts(s), iso, iso);
  assert.equal(f.length, 13);
  assert.deepEqual(f[0], ["period_start", "period", "model", "forecast", "lo80", "hi80", "lo95", "hi95"]);
  assert.equal(f[1]![0], "1961-01-01");
  assert.ok(Number(f[1]![6]) <= Number(f[1]![4]) && Number(f[1]![4]) <= Number(f[1]![3]), "95% low under 80% low under forecast");

  const sc = scorecardRows(s, "mase", "ets", iso);
  assert.equal(sc.length, 8);
  const head = sc[0]!;
  for (const col of ["mase", "mae", "rmse", "wape", "smape", "mape", "bias", "folds_beaten", "validation", "parameters"]) assert.ok(head.includes(col), col);
  const ets = sc.find((r) => r[0] === "Best smoothing")!;
  assert.match(ets[head.indexOf("parameters")]!, /^ETS\(A,(N|A|Ad),(N|A|M)\) alpha=/);
  assert.equal(sc[1]![head.indexOf("rank")], "1");
  assert.equal(sc.find((r) => r[head.indexOf("auto_pick")] === "yes")![0], sc[1]![0], "the top-ranked is the Auto pick");

  const bt = backtestRows(s, s.backtest!, starts(s), iso);
  assert.equal(bt.length - 1, 7 * s.models.origins.length * s.models.H);
  // MAE recomputed from the export matches the board.
  const sn = bt.slice(1).filter((r) => r[0] === "Repeat last cycle" && r[8] !== "");
  const mae = sn.reduce((a, r) => a + Number(r[8]), 0) / sn.length;
  assert.ok(Math.abs(mae - s.models.models.sn.metrics.mae) < 1e-3, `${mae} vs ${s.models.models.sn.metrics.mae}`);
});

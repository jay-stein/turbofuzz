import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTable } from "../src/data/timeseries/base.js";
import { defaultConfig, TsEngine } from "../src/data/timeseries/engine.js";
import { METRIC_KEYS } from "../src/data/timeseries/models.js";

function engine(): TsEngine {
  const n = 144;
  const times = Float64Array.from({ length: n }, (_, i) => Date.UTC(1949, i, 1));
  const v = Float64Array.from({ length: n }, (_, i) => (100 + 2.4 * i) * (1 + 0.25 * Math.sin((2 * Math.PI * i) / 12)) + 6 * Math.sin(i * 1.7));
  return new TsEngine(buildTable({ times, cols: { passengers: v }, flags: {}, groups: ["all"], rowGroup: new Uint16Array(n), groupCol: null, dateCol: "month", dropped: 0 })!);
}
const run = (e: TsEngine, cv: "expanding" | "rolling") => {
  const s = e.compute({ ...defaultConfig(e.info()), grain: "month", horizon: 12, cv }, "forecast");
  if ("error" in s.models) throw new Error(s.models.error);
  return s.models;
};

test("every model gets MAE, RMSE, MASE, WAPE, sMAPE, MAPE and bias from its backtest, and fold wins", () => {
  const M = run(engine(), "expanding");
  assert.equal(M.cv, "expanding");
  assert.equal(M.trainLen, null);
  for (const m of Object.values(M.models)) {
    for (const k of METRIC_KEYS) assert.ok(Number.isFinite(m.metrics[k]), `${m.key} ${k}`);
    assert.ok(m.metrics.rmse >= m.metrics.mae - 1e-9, "RMSE is never below MAE");
    assert.ok(m.metrics.wape >= 0 && m.metrics.smape >= 0 && m.metrics.smape <= 2);
    assert.equal(m.folds.of, M.origins.length - (M.lockbox ? 1 : 0), "fold wins count the selection folds");
  }
  assert.equal(M.models.sn.folds.won, 0, "the baseline never beats itself");
  assert.equal(M.best, M.auto.mase.pick);
  const byMae = Object.values(M.models).reduce((a, b) => (b.metrics.mae < a.metrics.mae ? b : a)).key;
  assert.equal(M.bestBy.mae, byMae);
});

test("the last fold is a lockbox: never used to pick, scored on its own", () => {
  const M = run(engine(), "expanding");
  assert.ok(M.origins.length >= 4);
  assert.equal(M.lockbox, true);
  for (const m of Object.values(M.models)) assert.ok(m.lock && Number.isFinite(m.lock.mae));
});

test("rolling folds train on the first fold's length and score differently from expanding", () => {
  const e = engine();
  const exp = run(e, "expanding"), roll = run(e, "rolling");
  assert.equal(roll.cv, "rolling");
  assert.equal(roll.trainLen, roll.origins[0]);
  assert.deepEqual(roll.origins, exp.origins, "same test periods, only the training differs");
  assert.notEqual(roll.models.reg.metrics.mae, exp.models.reg.metrics.mae);
  assert.equal(roll.models.sn.metrics.mae, exp.models.sn.metrics.mae, "repeat-last-cycle needs no training");
});

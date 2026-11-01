import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTable } from "../src/data/timeseries/base.js";
import { defaultConfig, TsEngine } from "../src/data/timeseries/engine.js";

function yearly(n: number): TsEngine {
  const times = Float64Array.from({ length: n }, (_, i) => Date.UTC(1990 + i, 0, 1));
  const v = Float64Array.from({ length: n }, (_, i) => 100 + 3 * i + 4 * Math.sin(i * 1.3));
  return new TsEngine(buildTable({ times, cols: { sales: v }, flags: {}, groups: ["all"], rowGroup: new Uint16Array(n), groupCol: null, dateCol: "year", dropped: 0 })!);
}
const compute = (e: TsEngine, H: number, split?: number) => e.compute({ ...defaultConfig(e.info()), grain: "year", agg: "sum", measure: "sales", horizon: H, ...(split ? { split } : {}) }, "forecast");

test("a short yearly series is still forecast, with a rough backtest and bands that widen", () => {
  const s = compute(yearly(16), 6);
  if ("error" in s.models || !s.futures) throw new Error("error" in s.models ? s.models.error : "no futures");
  assert.equal(s.models.H, 6);
  assert.ok(s.models.rough, "under three folds is rough");
  assert.ok(s.models.origins.length >= 1 && s.models.origins.length < 3);
  const f = s.futures.comb;
  assert.ok(f.F.every(Number.isFinite) && f.lo80.every(Number.isFinite) && f.hi95.every(Number.isFinite));
  for (let h = 0; h < 6; h++) assert.ok(f.lo95[h]! <= f.lo80[h]! && f.lo80[h]! <= f.F[h]! && f.F[h]! <= f.hi80[h]! && f.hi80[h]! <= f.hi95[h]!);
  assert.ok(f.hi80[5]! - f.lo80[5]! >= f.hi80[0]! - f.lo80[0]!, "the band does not narrow with the steps ahead");
});

test("with no room for any fold there is no backtest: Auto uses the Combination, says why, and the bands come from the fitted model", () => {
  const s = compute(yearly(16), 6, 10);
  if ("error" in s.models || !s.futures) throw new Error("error" in s.models ? s.models.error : "no futures");
  assert.equal(s.models.T, 10);
  assert.equal(s.models.origins.length, 0);
  assert.equal(s.models.auto.mase.pick, "comb");
  assert.match(s.models.auto.mase.why, /Only 10 years of history: too few for a backtest/);
  assert.ok(Number.isNaN(s.models.models.comb.ratio), "nothing to compare with");
  const f = s.futures.comb;
  assert.ok(f.hi80[0]! > f.F[0]! && f.lo80[0]! < f.F[0]!, "a band of non-zero width");
  assert.ok(f.hi80[5]! - f.lo80[5]! > f.hi80[0]! - f.lo80[0]!, "widening like a random walk");
  // The held-out actuals are still scored against the forecast.
  assert.ok(f.held && f.held.tot === 6 && Number.isFinite(f.held.mae));
});

test("a history too short to train on and forecast is still refused, with the amount needed", () => {
  // Nine years leave room for one year ahead only: the longest forecast offered shrinks to fit.
  const nine = compute(yearly(9), 6);
  if ("error" in nine.models) throw new Error(nine.models.error);
  assert.equal(nine.models.H, 1);
  // Seven years cannot be trained on at all.
  const seven = compute(yearly(7), 6);
  assert.ok("error" in seven.models);
  assert.match((seven.models as { error: string }).error, /needs at least \d+ years of history; this series has 7/);
});

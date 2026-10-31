import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTable } from "../src/data/timeseries/base.js";
import { defaultConfig, TsEngine } from "../src/data/timeseries/engine.js";
import { dmTest } from "../src/data/timeseries/models.js";

function engineOf(times: number[], values: number[]): TsEngine {
  return new TsEngine(buildTable({ times: Float64Array.from(times), cols: { y: Float64Array.from(values) }, flags: {}, groups: ["all"], rowGroup: new Uint16Array(times.length), groupCol: null, dateCol: "t", dropped: 0 })!);
}

test("with a season of 24 or less, Auto defaults to the Combination and says why", () => {
  const n = 144;
  const e = engineOf(Array.from({ length: n }, (_, i) => Date.UTC(1949, i, 1)), Array.from({ length: n }, (_, i) => (100 + 2.4 * i) * (1 + 0.25 * Math.sin((2 * Math.PI * i) / 12)) + 5 * Math.sin(i * 1.3)));
  const s = e.compute({ ...defaultConfig(e.info()), grain: "month", horizon: 12 }, "forecast");
  if ("error" in s.models) throw new Error(s.models.error);
  assert.equal(s.models.autoPolicy, "combination");
  for (const a of Object.values(s.models.auto)) {
    assert.ok(a.why.length > 20);
    if (a.pick === "comb") assert.match(a.why, /Combination/);
    else assert.match(a.why, /replaced the Combination: it led .* selection folds and on the lockbox fold, and a Diebold-Mariano test/);
  }
  assert.equal(s.models.best, s.models.auto.mase.pick);
  // The Combination is the plain average of its three members.
  const f = s.futures!;
  for (let h = 0; h < 12; h++) assert.ok(Math.abs(f.comb.F[h]! - (f.ets.F[h]! + f.theta.F[h]! + f.hw.F[h]!) / 3) < 1e-9 || f.comb.F[h] === 0);
});

test("with a long season, Auto picks the backtest winner", () => {
  const n = 24 * 90;
  const e = engineOf(Array.from({ length: n }, (_, i) => Date.UTC(2020, 0, 1) + i * 3_600_000), Array.from({ length: n }, (_, i) => 100 + 40 * Math.sin((2 * Math.PI * i) / 24) + 15 * Math.sin((2 * Math.PI * i) / 168) + 3 * Math.sin(i * 1.7)));
  const s = e.compute({ ...defaultConfig(e.info()), grain: "hour", agg: "sum", measure: "y", horizon: 48 }, "forecast");
  if ("error" in s.models) throw new Error(s.models.error);
  assert.equal(s.models.m, 168);
  assert.equal(s.models.autoPolicy, "backtest");
  assert.equal(s.models.auto.mase.pick, s.models.bestBy.mase);
  assert.match(s.models.auto.mase.why, /longer than seasonal ETS and Theta handle well/);
});

test("Diebold-Mariano: a model that is better in every fold is significant; a coin flip is not", () => {
  const H = 6, folds = 10;
  const small = new Float64Array(folds * H), big = new Float64Array(folds * H), mixed = new Float64Array(folds * H);
  let seed = 5;
  const r = (): number => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  for (let i = 0; i < folds * H; i++) { small[i] = 1 + 0.2 * r(); big[i] = 2 + 0.2 * r(); mixed[i] = 1 + 0.2 * r(); }
  const better = dmTest(small, big, folds, H, 2);
  assert.ok(better.diff < 0 && better.p < 0.001, `p ${better.p}`);
  assert.ok(dmTest(big, small, folds, H, 2).diff > 0);
  const same = dmTest(small, mixed, folds, H, 2);
  assert.ok(same.p > 0.05, `p ${same.p}`);
  assert.ok(Number.isNaN(dmTest(small, big, 2, H, 0).p), "under 3 folds there is no test");
});

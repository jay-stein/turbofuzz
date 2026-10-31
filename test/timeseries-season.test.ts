import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTable } from "../src/data/timeseries/base.js";
import { defaultConfig, TsEngine } from "../src/data/timeseries/engine.js";
import { seasonalityTest } from "../src/data/timeseries/seasonality.js";

let seed = 9;
const rnd = (): number => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31 - 0.5);

function engineOf(times: number[], values: number[]): TsEngine {
  return new TsEngine(buildTable({ times: Float64Array.from(times), cols: { y: Float64Array.from(values) }, flags: {}, groups: ["all"], rowGroup: new Uint16Array(times.length), groupCol: null, dateCol: "t", dropped: 0 })!);
}
const hourly = (n: number, f: (i: number) => number): TsEngine => engineOf(Array.from({ length: n }, (_, i) => Date.UTC(2020, 0, 1) + i * 3_600_000), Array.from({ length: n }, (_, i) => f(i)));
const run = (e: TsEngine, grain: "hour" | "month", horizon: number, deep?: "ets") => {
  const s = e.compute({ ...defaultConfig(e.info()), grain, agg: "sum", measure: "y", horizon }, "forecast", deep ? { deep } : {});
  if ("error" in s.models) throw new Error(s.models.error);
  return { s, M: s.models };
};

test("the seasonality test finds a clear season, ignores noise, and says when it cannot test", () => {
  const seasonal = Array.from({ length: 120 }, (_, i) => 50 + 10 * Math.sin((2 * Math.PI * i) / 12) + rnd());
  const t = seasonalityTest(seasonal, 120, 12);
  assert.ok(t.tested && t.seasonal && t.r > t.limit, `${t.r} vs ${t.limit}`);
  const noise = Array.from({ length: 120 }, () => rnd());
  assert.equal(seasonalityTest(noise, 120, 12).seasonal, false);
  assert.equal(seasonalityTest(seasonal, 30, 12).tested, false, "under three cycles");
  assert.equal(seasonalityTest(seasonal, 120, 1).tested, false, "no season to test");
});

test("a daily and weekly cycle in hourly data is removed with MSTL, and the smoothing models run on what is left", () => {
  const e = hourly(24 * 70, (i) => 200 + 60 * Math.sin((2 * Math.PI * i) / 24) + 25 * Math.sin((2 * Math.PI * i) / 168) + 4 * rnd());
  const { s, M } = run(e, "hour", 48);
  assert.equal(M.m, 168);
  assert.equal(M.season.mode, "mstl");
  assert.deepEqual(M.season.periods, [24, 168]);
  assert.match(M.season.why, /R's ets\(\) stops at 24/);
  assert.equal(M.models.ets.ets!.adjusted, true);
  assert.match(M.models.ets.ets!.spec, /,N$/, "no seasonal state: the season was removed first");
  assert.ok(M.models.ets.mase < M.models.sn.mase, `ETS ${M.models.ets.mase} vs repeat-last-cycle ${M.models.sn.mase}`);
  assert.ok(M.models.hw.mase < M.models.sn.mase);
  for (const k of ["ets", "hw", "comb"] as const) assert.ok(s.futures![k].F.every((v) => Number.isFinite(v)), k);
  assert.equal(M.autoPolicy, "backtest", "long seasons keep the backtest winner");
});

test("a long series with no season is smoothed without one", () => {
  const e = hourly(24 * 70, () => 100 + 6 * rnd());
  const { M } = run(e, "hour", 48);
  assert.equal(M.season.mode, "none");
  assert.match(M.season.why, /finds no season/);
  assert.match(M.models.ets.ets!.spec, /,N$/);
  assert.equal(M.models.ets.ets!.adjusted, false);
});

test("at 24 periods or less the season stays and AICc decides, even when a trend hides it from the test", () => {
  const n = 144;
  const e = engineOf(Array.from({ length: n }, (_, i) => Date.UTC(1949, i, 1)), Array.from({ length: n }, (_, i) => 100 + 4 * i + 15 * Math.sin((2 * Math.PI * i) / 12) + 3 * rnd()));
  const { M } = run(e, "month", 12);
  assert.equal(M.season.mode, "native");
  assert.equal(M.autoPolicy, "combination");
});

test("the Deep check works on the seasonally adjusted fit", () => {
  const e = hourly(24 * 70, (i) => 200 + 60 * Math.sin((2 * Math.PI * i) / 24) + 25 * Math.sin((2 * Math.PI * i) / 168) + 4 * rnd());
  const { s } = run(e, "hour", 48, "ets");
  const d = s.deep!;
  assert.ok(d.resid && d.resid.n > 100 && Number.isFinite(d.resid.lb.q), "residuals of the adjusted fit");
  assert.equal(d.dm.length, 7);
});

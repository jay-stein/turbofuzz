import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTable } from "../src/data/timeseries/base.js";
import { defaultConfig, TsEngine } from "../src/data/timeseries/engine.js";
import { MODEL_KEYS } from "../src/data/timeseries/models.js";
import { chiSquareSf, tTwoSided } from "../src/data/timeseries/stats.js";

test("t and chi-square tails match the tables", () => {
  assert.ok(Math.abs(tTwoSided(2.262, 9) - 0.05) < 5e-4);
  assert.ok(Math.abs(tTwoSided(1, 5) - 0.3632) < 5e-4);
  assert.ok(Math.abs(chiSquareSf(18.307, 10) - 0.05) < 5e-4);
  assert.ok(Math.abs(chiSquareSf(3, 2) - Math.exp(-1.5)) < 1e-9);
});

function engine(noise: (i: number) => number): TsEngine {
  const n = 144;
  const times = Float64Array.from({ length: n }, (_, i) => Date.UTC(1949, i, 1));
  const v = Float64Array.from({ length: n }, (_, i) => (100 + 2.4 * i) * (1 + 0.25 * Math.sin((2 * Math.PI * i) / 12)) + noise(i));
  return new TsEngine(buildTable({ times, cols: { y: v }, flags: {}, groups: ["all"], rowGroup: new Uint16Array(n), groupCol: null, dateCol: "month", dropped: 0 })!);
}

test("Deep check: significance against every rival, error by horizon, calibration on every fold, residual tests", () => {
  let seed = 3;
  const rnd = (): number => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31 - 0.5) * 8;
  const e = engine(() => rnd());
  const s = e.compute({ ...defaultConfig(e.info()), grain: "month", horizon: 12 }, "forecast", { deep: "ets" });
  if ("error" in s.models || !s.deep) throw new Error("no deep check");
  const d = s.deep;
  assert.equal(d.dm.length, MODEL_KEYS.length - 1);
  for (const t of d.dm) assert.ok(t.p >= 0 && t.p <= 1, `${t.other} p ${t.p}`);
  // Repeat-last-cycle copies a year of noise and misses the trend: ETS should be significantly better.
  const vsBase = d.dm.find((t) => t.other === "sn")!;
  assert.ok(vsBase.diff < 0 && vsBase.p < 0.05, `vs baseline diff ${vsBase.diff} p ${vsBase.p}`);
  assert.equal(d.horizon.steps.length, 12);
  for (const k of MODEL_KEYS) assert.ok(d.calib[k].n > 0 && d.calib[k].cov80 >= 0 && d.calib[k].cov80 <= 1);
  assert.ok(d.resid && d.resid.acf.length >= 20 && d.resid.lb.lag === 24 && d.resid.lb.p >= 0 && d.resid.lb.p <= 1);
  assert.equal(e.compute({ ...defaultConfig(e.info()), grain: "month", horizon: 12 }, "forecast").deep, undefined, "only on request");
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTable } from "../src/data/timeseries/base.js";
import { defaultConfig, TsEngine } from "../src/data/timeseries/engine.js";

let seed = 5;
const rnd = (): number => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) - 0.5;
const day = 86_400_000;

function engine(values: Float64Array): TsEngine {
  const n = values.length;
  const times = Float64Array.from({ length: n }, (_, i) => Date.UTC(2021, 0, 1) + i * day);
  const t = buildTable({ times, cols: { v: values }, flags: {}, groups: ["all"], rowGroup: new Uint16Array(n), groupCol: null, dateCol: "d", dropped: 0 })!;
  return new TsEngine(t);
}

test("a weekly and a yearly season are taken out together, so the yearly wave is not left in the trend", () => {
  const n = 365 * 4;
  const truth = (t: number): number => 100 + 0.05 * t;
  const e = engine(Float64Array.from({ length: n }, (_, t) => truth(t) + 10 * Math.sin((2 * Math.PI * t) / 7) + 30 * Math.sin((2 * Math.PI * t) / 365.25) + 2 * rnd()));
  const s = e.compute({ ...defaultConfig(e.info()), agg: "mean", measure: "v", grain: "day" }, "decompose");
  const d = s.dec.dec!;
  assert.equal(d.m, 7);
  assert.ok(d.also && Math.abs(d.also.m - 365.25) < 1, "the yearly season is found beside the weekly one");
  let worst = 0;
  for (let t = 20; t < n - 20; t++) worst = Math.max(worst, Math.abs(d.trend[t]! - truth(t)));
  assert.ok(worst < 8, `the trend follows the straight line (worst gap ${worst.toFixed(1)}; the yearly wave swings ±30)`);
});

test("a dip lasting months is one event, not a handful of points", () => {
  const n = 120;
  const times = Float64Array.from({ length: n }, (_, i) => Date.UTC(2010, i, 1));
  const v = Float64Array.from({ length: n }, (_, t) => 200 + 0.5 * t + 25 * Math.sin((2 * Math.PI * t) / 12) + 3 * rnd());
  for (let t = 80; t < 85; t++) v[t] *= 0.55;
  const tbl = buildTable({ times, cols: { v }, flags: {}, groups: ["all"], rowGroup: new Uint16Array(n), groupCol: null, dateCol: "d", dropped: 0 })!;
  const e = new TsEngine(tbl);
  const s = e.compute({ ...defaultConfig(e.info()), agg: "mean", measure: "v", grain: "month" }, "decompose");
  const big = s.dec.events[0]!;
  assert.ok(big.a <= 81 && big.b >= 83, `one event covering the dip (${big.a}-${big.b})`);
  assert.ok(big.dev < -0.3, "and it is a fall");
  assert.ok(s.dec.events.length <= 2, "not separate points");
  const d = s.dec.dec!;
  // The trend stays on its line through the dip instead of sagging with it.
  assert.ok(Math.abs(d.trend[82]! - (200 + 0.5 * 82)) < 15, `trend at the dip ${d.trend[82]!.toFixed(1)}`);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTable } from "../src/data/timeseries/base.js";
import { defaultConfig, TsEngine } from "../src/data/timeseries/engine.js";

/** Monthly, growing, with a season that swings more as the level rises (airline-passenger shape). */
function series(): ReturnType<typeof buildTable> {
  const n = 144;
  const times = Float64Array.from({ length: n }, (_, i) => Date.UTC(1949, i, 1));
  const v = Float64Array.from({ length: n }, (_, i) => (100 + 2.4 * i) * (1 + 0.25 * Math.sin((2 * Math.PI * i) / 12)) * (1 + 0.02 * Math.sin(i * 1.7)));
  return buildTable({ times, cols: { passengers: v }, flags: {}, groups: ["all"], rowGroup: new Uint16Array(n), groupCol: null, dateCol: "month", dropped: 0 });
}

test("auto-ETS picks a multiplicative season for a swing that grows with the level, and beats additive Holt-Winters", () => {
  const engine = new TsEngine(series()!);
  const snap = engine.compute({ ...defaultConfig(engine.info()), grain: "month", horizon: 12 }, "forecast");
  if ("error" in snap.models) throw new Error(snap.models.error);
  const ets = snap.models.models.ets;
  assert.match(ets.ets!.spec, /,M$/);
  assert.equal(ets.ets!.tried, 15, "every allowed form: 6 with additive errors, 9 with multiplicative");
  assert.ok(ets.mase < snap.models.models.hw.mase, `ETS ${ets.mase.toFixed(3)} vs HW ${snap.models.models.hw.mase.toFixed(3)}`);
  assert.equal(snap.futures!.ets.F.length, 12);
});

test("smoothing models bridge a long gap without learning from the filled values", () => {
  const n = 144;
  const times: number[] = [], vals: number[] = [];
  for (let i = 0; i < n; i++) { if (i >= 60 && i < 75) continue; times.push(Date.UTC(1949, i, 1)); vals.push((100 + 2 * i) * (1 + 0.2 * Math.sin((2 * Math.PI * i) / 12))); }
  const t = buildTable({ times: Float64Array.from(times), cols: { y: Float64Array.from(vals) }, flags: {}, groups: ["all"], rowGroup: new Uint16Array(times.length), groupCol: null, dateCol: "month", dropped: 0 })!;
  const engine = new TsEngine(t);
  const snap = engine.compute({ ...defaultConfig(engine.info()), grain: "month", horizon: 12 }, "forecast");
  if ("error" in snap.models) throw new Error(snap.models.error);
  assert.ok(snap.A.made.some((x) => x), "the gap is filled for the models");
  for (const m of Object.values(snap.models.models)) assert.ok(Number.isFinite(m.metrics.mae), m.key);
  for (const f of Object.values(snap.futures!)) assert.ok(f.F.every((v) => Number.isFinite(v)));
});

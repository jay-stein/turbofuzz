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
  assert.equal(ets.ets!.tried, 9);
  assert.ok(ets.mase < snap.models.models.hw.mase, `ETS ${ets.mase.toFixed(3)} vs HW ${snap.models.models.hw.mase.toFixed(3)}`);
  assert.equal(snap.futures!.ets.F.length, 12);
});

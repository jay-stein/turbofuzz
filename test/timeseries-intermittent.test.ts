import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTable } from "../src/data/timeseries/base.js";
import { defaultConfig, TsEngine } from "../src/data/timeseries/engine.js";
import { INTERMITTENT_KEYS, INTERMITTENT_PICK } from "../src/data/timeseries/models.js";

function engineOf(values: (i: number) => number, n = 96): TsEngine {
  const times = Float64Array.from({ length: n }, (_, i) => Date.UTC(2016, i, 1));
  const v = Float64Array.from({ length: n }, (_, i) => values(i));
  return new TsEngine(buildTable({ times, cols: { parts: v }, flags: {}, groups: ["all"], rowGroup: new Uint16Array(n), groupCol: null, dateCol: "month", dropped: 0 })!);
}
const compute = (e: TsEngine) => {
  const s = e.compute({ ...defaultConfig(e.info()), grain: "month", agg: "sum", measure: "parts", horizon: 12 }, "forecast");
  if ("error" in s.models || !s.futures) throw new Error("error" in s.models ? s.models.error : "no futures");
  return { M: s.models, F: s.futures };
};

test("a series that is mostly zeros is classed intermittent, gains Croston, the corrected Croston and TSB, and Auto uses TSB", () => {
  // A sale every third or fourth month, of a varying size.
  const { M, F } = compute(engineOf((i) => (i % 7 === 0 || i % 4 === 1 ? 2 + (i % 5) : 0)));
  assert.equal(M.intermittent, true);
  assert.equal(M.autoPolicy, "intermittent");
  for (const k of INTERMITTENT_KEYS) assert.ok(M.shown.includes(k), `${k} is listed`);
  assert.equal(M.best, INTERMITTENT_PICK);
  assert.equal(M.auto.mase.pick, "tsb");
  assert.match(M.auto.mase.why, /Teunter, Syntetos and Babai/);
  for (const k of INTERMITTENT_KEYS) {
    assert.ok(F[k].F.every((v) => Number.isFinite(v) && v >= 0), `${k} forecasts the demand rate`);
    assert.ok(Number.isFinite(M.models[k].metrics.mae), `${k} is backtested`);
  }
  // The corrected Croston is a little under Croston (the factor 1 - alpha/2).
  assert.ok(Math.abs(F.sba.F[0]! / F.croston.F[0]! - 0.95) < 1e-9);
});

test("steady demand is not intermittent: the Croston methods stay out of the list and Auto is unchanged", () => {
  const { M } = compute(engineOf((i) => 50 + 10 * Math.sin((2 * Math.PI * i) / 12) + (i % 5)));
  assert.equal(M.intermittent, false);
  assert.equal(M.autoPolicy, "combination");
  for (const k of INTERMITTENT_KEYS) assert.ok(!M.shown.includes(k), `${k} is not listed`);
});

test("zeros before the first sale are a product not yet launched, not intermittent demand", () => {
  // Fifty months of nothing, then steady sales every month.
  const { M } = compute(engineOf((i) => (i < 50 ? 0 : 20 + (i % 4)), 120));
  assert.equal(M.intermittent, false);
});

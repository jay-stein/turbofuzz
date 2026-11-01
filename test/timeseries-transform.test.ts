import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTable } from "../src/data/timeseries/base.js";
import { defaultConfig, TsEngine } from "../src/data/timeseries/engine.js";

const AIR = [
  112, 118, 132, 129, 121, 135, 148, 148, 136, 119, 104, 118, 115, 126, 141, 135, 125, 149, 170, 170, 158, 133, 114, 140,
  145, 150, 178, 163, 172, 178, 199, 199, 184, 162, 146, 166, 171, 180, 193, 181, 183, 218, 230, 242, 209, 191, 172, 194,
  196, 196, 236, 235, 229, 243, 264, 272, 237, 211, 180, 201, 204, 188, 235, 227, 234, 264, 302, 293, 259, 229, 203, 229,
  242, 233, 267, 269, 270, 315, 364, 347, 312, 274, 237, 278, 284, 277, 317, 313, 318, 374, 413, 405, 355, 306, 271, 306,
  315, 301, 356, 348, 355, 422, 465, 467, 404, 347, 305, 336, 340, 318, 362, 348, 363, 435, 491, 505, 404, 359, 310, 337,
  360, 342, 406, 396, 420, 472, 548, 559, 463, 407, 362, 405, 417, 391, 419, 461, 472, 535, 622, 606, 508, 461, 390, 432,
];
function engine(values: number[]): TsEngine {
  const n = values.length;
  const times = Float64Array.from({ length: n }, (_, i) => Date.UTC(1949, i, 1));
  return new TsEngine(buildTable({ times, cols: { passengers: Float64Array.from(values) }, flags: {}, groups: ["all"], rowGroup: new Uint16Array(n), groupCol: null, dateCol: "month", dropped: 0 })!);
}
const run = (e: TsEngine, transform: "none" | "auto" | "log") => {
  const s = e.compute({ ...defaultConfig(e.info()), grain: "month", agg: "sum", measure: "passengers", horizon: 12, transform }, "forecast", { deep: "ets" });
  if ("error" in s.models || !s.futures) throw new Error("error" in s.models ? s.models.error : "no futures");
  return { M: s.models, F: s.futures, deep: s.deep };
};

test("off by default: no transformation, as the page ships", () => {
  const e = engine(AIR);
  assert.equal(defaultConfig(e.info()).transform, "none");
  assert.equal(run(e, "none").M.transform, null);
});

test("Box-Cox (auto) takes Guerrero's power on the history before the first fold, and the forecasts come back on the original scale", () => {
  const e = engine(AIR);
  const base = run(e, "none"), bc = run(e, "auto");
  assert.ok(bc.M.transform && bc.M.transform.method === "guerrero");
  assert.ok(bc.M.transform.lambda >= -1 && bc.M.transform.lambda <= 2);
  // The history before the first fold is what the power is read from: it differs a little from the whole-series -0.29.
  assert.ok(Math.abs(bc.M.transform.lambda - -0.29) < 0.35, `lambda ${bc.M.transform.lambda}`);
  for (const k of ["ets", "hw", "theta", "reg", "comb"] as const) {
    const f = bc.F[k].F, g = base.F[k].F;
    for (let h = 0; h < 12; h++) {
      assert.ok(f[h]! > 300 && f[h]! < 800, `${k} ${h}: ${f[h]}`);
      assert.ok(Math.abs(f[h]! / g[h]! - 1) < 0.2, `${k} stays near the untransformed forecast: ${f[h]} vs ${g[h]}`);
    }
  }
  // The benchmarks and the seasonal naive do not move: they are the yardsticks.
  for (const k of ["sn", "naive", "drift", "mean", "ses", "clim"] as const) assert.deepEqual(Array.from(bc.F[k].F), Array.from(base.F[k].F), k);
  // Scored on the original scale, so the backtest errors are in passengers, comparable with the untransformed run.
  assert.ok(bc.M.models.comb.metrics.mae > 1 && bc.M.models.comb.metrics.mae < 100);
  assert.equal(bc.M.models.sn.metrics.mase, base.M.models.sn.metrics.mase);
  // The Deep check's residual tests still run, on the scale of the data.
  assert.ok(bc.deep?.resid && Number.isFinite(bc.deep.resid.lb.q));
});

test("the log is lambda 0, and a series that touches zero is never transformed", () => {
  const e = engine(AIR);
  assert.equal(run(e, "log").M.transform?.lambda, 0);
  const zeros = AIR.map((v, i) => (i === 40 ? 0 : v));
  assert.equal(run(engine(zeros), "auto").M.transform, null);
  assert.equal(run(engine(zeros), "log").M.transform, null);
});

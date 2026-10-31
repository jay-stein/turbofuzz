import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTable } from "../src/data/timeseries/base.js";
import { defaultConfig, TsEngine } from "../src/data/timeseries/engine.js";

test("monthly and quarterly series end with their last calendar period, whatever month it is", () => {
  for (const [grain, step, ns] of [["month", 1, [47, 48, 71, 126, 134]], ["quarter", 3, [21, 22, 23]]] as const) {
    for (const n of ns) {
      const times = Float64Array.from({ length: n }, (_, i) => Date.UTC(1990, i * step, 1));
      const t = buildTable({ times, cols: { v: Float64Array.from({ length: n }, (_, i) => 100 + i) }, flags: {}, groups: ["all"], rowGroup: new Uint16Array(n), groupCol: null, dateCol: "t", dropped: 0 })!;
      const e = new TsEngine(t);
      const s = e.compute({ ...defaultConfig(e.info()), grain, agg: "sum", measure: "v", partial: "include" }, "explore");
      assert.equal(s.A.n, n, `${grain} n=${n}`);
      assert.equal(s.A.y[n - 1], 100 + n - 1);
    }
  }
});

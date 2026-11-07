import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTable } from "../src/data/timeseries/base.js";
import { defaultConfig, TsEngine } from "../src/data/timeseries/engine.js";
import { computePatterns } from "../src/data/timeseries/patterns.js";

/** Orders at irregular minutes between 08:00 and 20:00, every day for 120 days, the last one before 18:00. */
function orders() {
  const times: number[] = [], v: number[] = [];
  let seed = 7;
  const rnd = (): number => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const start = Date.UTC(2025, 0, 1);
  for (let d = 0; d < 120; d++) {
    const n = 8 + Math.floor(rnd() * 4);
    for (let k = 0; k < n; k++) {
      const mins = 480 + Math.floor(rnd() * (d === 119 ? 540 : 720));
      times.push(start + d * 86_400_000 + mins * 60_000 + Math.floor(rnd() * 60_000));
      v.push(20 + Math.floor(rnd() * 30));
    }
  }
  const order = times.map((_, i) => i).sort((a, b) => times[a] - times[b]);
  const n = times.length;
  return buildTable({ times: Float64Array.from(order.map((i) => times[i])), cols: { v: Float64Array.from(order.map((i) => v[i])) }, flags: {}, groups: ["all"], rowGroup: new Uint16Array(n), groupCol: null, dateCol: "t", dropped: 0 })!;
}

test("order timestamps between 08:00 and 20:00 still get a time-of-day profile", () => {
  const t = orders();
  const e = new TsEngine(t);
  const P = computePatterns(t, { ...defaultConfig(e.info()), grain: "day", agg: "sum", measure: "v" });
  assert.ok(P.day, "an hour-by-weekday profile exists for event rows");
});

test("the last day of order rows is complete even when its last order came early", () => {
  const t = orders();
  const e = new TsEngine(t);
  const s = e.compute({ ...defaultConfig(e.info()), grain: "day", agg: "sum", measure: "v" }, "explore");
  assert.equal(s.A.partial[s.A.n - 1], 0);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTable } from "../src/data/timeseries/base.js";
import { defaultConfig, TsEngine } from "../src/data/timeseries/engine.js";

let seed = 21;
const rnd = (): number => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) - 0.5;
const day = 86_400_000;

function table(n: number, cols: Record<string, Float64Array>) {
  const times = Float64Array.from({ length: n }, (_, i) => Date.UTC(2025, 0, 1) + i * day);
  return buildTable({ times, cols, flags: {}, groups: ["all"], rowGroup: new Uint16Array(n), groupCol: null, dateCol: "date", dropped: 0 })!;
}
const agg = (t: ReturnType<typeof table>): string => { const e = new TsEngine(t); return defaultConfig(e.info()).agg; };
const measure = (t: ReturnType<typeof table>): string | null => { const e = new TsEngine(t); return defaultConfig(e.info()).measure; };

test("a level (a temperature, a continuous reading) is averaged by default, an amount is summed", () => {
  const n = 300;
  assert.equal(agg(table(n, { temp_c: Float64Array.from({ length: n }, () => 20 + 10 * rnd()) })), "mean", "named like a level");
  let level = 100;
  assert.equal(agg(table(n, { reading: Float64Array.from({ length: n }, () => (level += rnd())) })), "mean", "each reading is nearly the one before");
  assert.equal(agg(table(n, { sales: Float64Array.from({ length: n }, () => 100 + 50 * rnd()) })), "sum", "independent amounts are totals");
  assert.equal(agg(table(n, { net_flow: Float64Array.from({ length: n }, () => 10 * rnd()) })), "sum", "a signed amount is still a total");
});

test("a small-integer reading is a measure, a month or hour column is still a date part", () => {
  const n = 300;
  assert.equal(measure(table(n, { pm25: Float64Array.from({ length: n }, () => 12 + 2 * Math.round(5 * (rnd() + 0.5))) })), "pm25");
  const month = Float64Array.from({ length: n }, (_, i) => new Date(Date.UTC(2025, 0, 1) + i * day).getUTCMonth() + 1);
  const t = table(n, { month, sales: Float64Array.from({ length: n }, () => 100 + 50 * rnd()) });
  assert.equal(measure(t), "sales");
  const cycling = Float64Array.from({ length: n }, (_, i) => (i % 12) + 1);
  assert.equal(measure(table(n, { slot: cycling, sales: Float64Array.from({ length: n }, () => 100 + 50 * rnd()) })), "sales", "steps up by one and wraps");
});

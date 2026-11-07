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

test("the snapshot says whether the series holds a steady level, and what differencing would make it so", () => {
  const n = 300;
  const steady = new TsEngine(table(n, { v: Float64Array.from({ length: n }, () => 50 + 5 * rnd()) }));
  const a = steady.compute({ ...defaultConfig(steady.info()), agg: "mean", measure: "v" }, "explore").stationarity!;
  assert.equal(a.stationary, true);
  assert.equal(a.d, 0);
  let level = 0;
  const walk = new TsEngine(table(n, { v: Float64Array.from({ length: n }, () => (level += rnd() + 0.3)) }));
  const b = walk.compute({ ...defaultConfig(walk.info()), agg: "mean", measure: "v" }, "explore").stationarity!;
  assert.equal(b.stationary, false);
  assert.ok(b.d >= 1 && b.kpss > b.critical);
});

test("a short burst is an event, not a change of trend, while a lasting step is still found", () => {
  const n = 240;
  const base = (t: number): number => 100 + 10 * Math.sin((2 * Math.PI * t) / 7) + 2 * rnd();
  const spike = new TsEngine(table(n, { v: Float64Array.from({ length: n }, (_, t) => base(t) + (t >= 150 && t < 153 ? 400 : 0)) }));
  const a = spike.compute({ ...defaultConfig(spike.info()), agg: "mean", measure: "v" }, "explore");
  assert.ok(!a.dec.cp || a.dec.cp.gain < 0.5, `a three-day burst read as a trend change (gain ${a.dec.cp?.gain})`);
  const step = new TsEngine(table(n, { v: Float64Array.from({ length: n }, (_, t) => base(t) + (t >= 120 ? 60 : 0)) }));
  const b = step.compute({ ...defaultConfig(step.info()), agg: "mean", measure: "v" }, "explore");
  assert.ok(b.dec.cp && b.dec.cp.gain > 0.5, "a lasting step is still a change");
});

import { buildInsights } from "../src/ui/timeseries-findings.js";

function insights(values: Float64Array) {
  const e = new TsEngine(table(values.length, { v: values }));
  const s = e.compute({ ...defaultConfig(e.info()), agg: "mean", measure: "v" }, "explore");
  return buildInsights(s, { mode: "explore", model: "auto", showShift: true });
}

test("a week-long run of one exact reading is reported as a stuck sensor", () => {
  const n = 200;
  const v = Float64Array.from({ length: n }, (_, t) => 20 + 5 * Math.sin(t / 5) + rnd());
  for (let t = 90; t < 110; t++) v[t] = 12;
  const f = insights(v).find((x) => x.kind === "Stuck readings");
  assert.ok(f, "stuck run found");
  assert.match(f!.html, /20 days in a row/);
  assert.equal(insights(Float64Array.from({ length: n }, (_, t) => 20 + 5 * Math.sin(t / 5) + rnd())).some((x) => x.kind === "Stuck readings"), false);
});

test("a lasting jump by a factor of 1,000 is called a possible unit change", () => {
  const n = 200;
  const v = Float64Array.from({ length: n }, (_, t) => (t < 100 ? 24 : 0.024) * (1 + 0.1 * rnd()));
  const f = insights(v).find((x) => x.kind === "Possible unit change");
  assert.ok(f, "unit change found");
  assert.match(f!.html, /1,000× lower/);
});

test("a strong cycle is found once error codes are treated as missing", () => {
  const n = 300;
  const clean = Float64Array.from({ length: n }, (_, t) => 50 + 15 * Math.sin((2 * Math.PI * t) / 7) + 2 * rnd());
  const withCodes = Float64Array.from(clean, (v, t) => (t % 17 === 3 ? -999 : v));
  const missing = Float64Array.from(withCodes, (v) => (v === -999 ? NaN : v));
  const season = (v: Float64Array): number => {
    const e = new TsEngine(table(n, { v }));
    return e.compute({ ...defaultConfig(e.info()), agg: "mean", measure: "v" }, "explore").dec.dec?.m ?? 0;
  };
  assert.equal(season(missing), 7, "the weekly cycle shows once the codes are missing");
});

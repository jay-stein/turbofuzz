import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTable, DAY, MINUTE, pickSlot, tooFine, type TsInput } from "../src/data/timeseries/base.js";
import { aggregate, seasonalFill, type TsConfig } from "../src/data/timeseries/aggregate.js";
import { computeDecomposition } from "../src/data/timeseries/decompose.js";
import { maxHorizon, runModels } from "../src/data/timeseries/models.js";
import { computePatterns } from "../src/data/timeseries/patterns.js";
import { defaultConfig, TsEngine } from "../src/data/timeseries/engine.js";

const START = Date.UTC(2024, 0, 1); // a Monday

function input(times: number[], values: number[], extra: Partial<TsInput> = {}): TsInput {
  return {
    times: Float64Array.from(times), cols: { value: Float64Array.from(values) }, flags: {},
    groups: ["all"], rowGroup: new Uint16Array(times.length), groupCol: null, dateCol: "date", dropped: 0, ...extra,
  };
}
function cfg(over: Partial<TsConfig> = {}): TsConfig {
  return {
    grain: "day", agg: "sum", measure: "value", group: -1, gaps: "leave", partial: "exclude", smoothW: 7, smoothStat: "mean",
    smoothCentred: false, period: null, sens: 4.5, split: null, horizon: null, flex: 5, drivers: [], ...over,
  };
}
/** Hourly rows with a daily peak at 13:00 and busier Saturdays. */
function hourly(days: number): { times: number[]; values: number[] } {
  const times: number[] = [], values: number[] = [];
  for (let h = 0; h < days * 24; h++) {
    const ms = START + h * 3_600_000, hour = h % 24, wd = Math.floor(h / 24) % 7;
    times.push(ms);
    values.push(100 + 80 * Math.exp(-((hour - 13) ** 2) / 8) * (wd === 5 ? 1.5 : 1) + ((h * 7919) % 13));
  }
  return { times, values };
}

test("picks the slot from the spacing of the dates", () => {
  const daily = Float64Array.from({ length: 30 }, (_, i) => START + i * DAY);
  assert.equal(pickSlot(daily, START, daily[29]), DAY);
  const hours = Float64Array.from({ length: 48 }, (_, i) => START + i * 3_600_000);
  assert.equal(pickSlot(hours, START, hours[47]), 60 * MINUTE);
  // readings about 30 minutes apart with jitter still get a 30-minute slot
  const jitter = Float64Array.from({ length: 200 }, (_, i) => START + i * 30 * MINUTE + ((i * 37) % 90) * 1000);
  assert.equal(pickSlot(jitter, START, jitter[199]), 30 * MINUTE);
});

test("weekdays that never have rows are not gaps", () => {
  const times: number[] = [];
  for (let d = 0; d < 70; d++) if (d % 7 < 5) times.push(START + d * DAY);
  const t = buildTable(input(times, times.map(() => 10)));
  assert.ok(t);
  assert.deepEqual(Array.from(t.structural), [0, 0, 0, 0, 0, 1, 1]);
  const A = aggregate(t, cfg({ grain: "day" }));
  assert.equal(A.gapRanges.length, 0);
});

test("grains finer than the data are too fine; hourly data allows hours", () => {
  const { times, values } = hourly(10);
  const t = buildTable(input(times, values));
  assert.ok(t);
  assert.equal(t.subDay, true);
  assert.equal(tooFine(t, "hour"), false);
  assert.equal(tooFine(t, "min30"), true);
  const daily = buildTable(input(Array.from({ length: 40 }, (_, i) => START + i * DAY), Array(40).fill(1)));
  assert.ok(daily);
  assert.equal(tooFine(daily, "hour"), true);
  assert.equal(tooFine(daily, "day"), false);
});

test("sums by period and marks a partial last period", () => {
  // 10 days of 2 rows each, plus a last week with only 3 days
  const times: number[] = [];
  for (let d = 0; d < 17; d++) { times.push(START + d * DAY, START + d * DAY + 1000); }
  const t = buildTable(input(times, times.map(() => 1)));
  assert.ok(t);
  const A = aggregate(t, cfg({ grain: "week" }));
  assert.equal(A.n, 3);
  assert.equal(A.y[0], 14);
  assert.equal(A.partial[2], 1);
  assert.equal(A.modelN, 2);
});

test("made-up values are marked, zero fills are not", () => {
  const times: number[] = [];
  for (let d = 0; d < 30; d++) if (d < 10 || d > 12) times.push(START + d * DAY);
  const t = buildTable(input(times, times.map(() => 5)));
  assert.ok(t);
  const seasonal = aggregate(t, cfg({ gaps: "seasonal" }));
  assert.deepEqual([seasonal.made[10], seasonal.made[11], seasonal.made[12]], [1, 1, 1]);
  assert.equal(seasonal.y[11], 5);
  const zero = aggregate(t, cfg({ gaps: "zero" }));
  assert.equal(zero.made[11], 0);
  assert.equal(zero.y[11], 0);
});

test("seasonal fill keeps the daily shape a straight line loses", () => {
  const { values } = hourly(21);
  const truth = values.slice(24 * 10 + 10, 24 * 10 + 16);
  const holed = Float64Array.from(values);
  for (let k = 24 * 10 + 10; k < 24 * 10 + 16; k++) holed[k] = NaN;
  const line = seasonalFill(Float64Array.from(holed), 1, true);
  const shaped = seasonalFill(Float64Array.from(holed), 24, true);
  const err = (f: Float64Array): number => truth.reduce((s, v, k) => s + Math.abs(f[24 * 10 + 10 + k] - v), 0);
  assert.ok(err(shaped) < err(line) / 2, `seasonal ${err(shaped)} vs line ${err(line)}`);
});

test("finds a weekly season in daily data", () => {
  const times: number[] = [], values: number[] = [];
  for (let d = 0; d < 200; d++) { times.push(START + d * DAY); values.push(100 + (d % 7 === 5 ? 40 : 0) + (d % 3)); }
  const t = buildTable(input(times, values));
  assert.ok(t);
  const A = aggregate(t, cfg());
  const D = computeDecomposition(A, cfg());
  assert.equal(D.dec?.m, 7);
  assert.ok((D.dec?.fs ?? 0) > 0.8);
});

test("the longest forecast offered is one the history can backtest", () => {
  const { times, values } = hourly(40);
  const t = buildTable(input(times, values));
  assert.ok(t);
  const c = cfg({ grain: "hour" });
  const A = aggregate(t, c);
  const H = maxHorizon(A);
  assert.ok(H > 24 * 7, `max ${H}`);
  const ok = runModels(A, t, c, null, H, new Map());
  assert.ok(!("error" in ok));
  const tooFar = runModels(A, t, c, null, H + 1, new Map());
  assert.ok("error" in tooFar);
});

test("models beat repeating the last cycle on a clean seasonal trend", () => {
  const times: number[] = [], values: number[] = [];
  for (let d = 0; d < 400; d++) { times.push(START + d * DAY); values.push(200 + d * 0.5 + (d % 7 === 5 ? 30 : 0) + 3 * Math.sin(d)); }
  const t = buildTable(input(times, values));
  assert.ok(t);
  const run = runModels(aggregate(t, cfg()), t, cfg(), null, 28, new Map());
  assert.ok(!("error" in run));
  assert.ok(run.models[run.best].ratio < 1);
});

test("patterns find the peak hour and the peak weekday", () => {
  const { times, values } = hourly(28);
  const t = buildTable(input(times, values));
  assert.ok(t);
  const P = computePatterns(t, cfg({ agg: "mean" }));
  assert.ok(P.day && P.week);
  assert.equal(P.day.med.indexOf(Math.max(...P.day.med)), 13);
  assert.equal(P.week.mean.indexOf(Math.max(...P.week.mean)), 5);
});

test("the engine reruns only what changed", () => {
  const { times, values } = hourly(30);
  const t = buildTable(input(times, values));
  assert.ok(t);
  const engine = new TsEngine(t);
  const c = defaultConfig(engine.info());
  assert.equal(c.grain, "hour");
  const first = engine.compute(c, "forecast");
  assert.ok(!("error" in first.models));
  const longer = engine.compute({ ...c, horizon: 72 }, "forecast");
  assert.equal(longer.H, 72);
  assert.equal(longer.A.y, first.A.y);
  assert.equal(longer.dec, first.dec);
});

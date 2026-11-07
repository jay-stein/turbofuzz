import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTable } from "../src/data/timeseries/base.js";
import { defaultConfig, TsEngine } from "../src/data/timeseries/engine.js";

const DAY = 86_400_000;
function engineAt(startMs: number, step: number, n: number): TsEngine {
  const times = Float64Array.from({ length: n }, (_, i) => startMs + i * step * DAY);
  const v = Float64Array.from({ length: n }, (_, i) => 100 + i + 10 * Math.sin(i / 2));
  return new TsEngine(buildTable({ times, cols: { sales: v }, flags: {}, groups: ["all"], rowGroup: new Uint16Array(n), groupCol: null, dateCol: "week", dropped: 0 })!);
}
const weekly = (e: TsEngine) => e.compute({ ...defaultConfig(e.info()), grain: "week", agg: "sum", measure: "sales", horizon: 8 }, "explore");

test("weekly rows stamped on a Sunday start their weeks on Sunday: one period per row, labelled with the stamp", () => {
  const sunday = Date.UTC(2023, 0, 1); // 1 Jan 2023 was a Sunday
  const e = engineAt(sunday, 7, 60);
  assert.equal(e.info().wstart, 6);
  const s = weekly(e);
  assert.equal(s.A.n, 60, "one period per row, no empty lead and no partial tail");
  assert.equal(s.A.t[0], sunday);
  assert.equal(s.A.t[1], sunday + 7 * DAY);
  assert.ok(!s.A.partial.some(Boolean));
});

test("weekly rows on a Friday close start weeks on Friday", () => {
  const friday = Date.UTC(2023, 0, 6);
  const e = engineAt(friday, 7, 60);
  assert.equal(e.info().wstart, 4);
  assert.equal(weekly(e).A.t[3], friday + 21 * DAY);
});

test("Monday-stamped weekly rows, and daily rows grouped into weeks, keep Monday weeks", () => {
  assert.equal(engineAt(Date.UTC(2023, 0, 2), 7, 60).info().wstart, 0);
  const daily = engineAt(Date.UTC(2023, 0, 4), 1, 200); // a Wednesday start, daily rows
  assert.equal(daily.info().wstart, 0);
  const s = weekly(daily);
  assert.equal(new Date(s.A.t[1]!).getUTCDay(), 1, "weeks start on a Monday");
});

test("weekly rows on mixed weekdays are not forced onto one", () => {
  const n = 60;
  const times = Float64Array.from({ length: n }, (_, i) => Date.UTC(2023, 0, 1) + (i * 7 + (i % 3)) * DAY);
  const e = new TsEngine(buildTable({ times, cols: { sales: Float64Array.from({ length: n }, (_, i) => 100 + i) }, flags: {}, groups: ["all"], rowGroup: new Uint16Array(n), groupCol: null, dateCol: "week", dropped: 0 })!);
  assert.equal(e.info().wstart, 0);
});

test("daily rows start their weeks on the day chosen in Settings, and on Monday when nothing is chosen", () => {
  const monday = Date.UTC(2024, 0, 1);
  const n = 84;
  const times = Float64Array.from({ length: n }, (_, i) => monday + i * DAY);
  const v = Float64Array.from({ length: n }, (_, i) => 100 + i);
  const input = { times, cols: { sales: v }, flags: {}, groups: ["all"], rowGroup: new Uint16Array(n), groupCol: null, dateCol: "d", dropped: 0 };
  const weeks = (weekStart?: number) => {
    const e = new TsEngine(buildTable({ ...input, ...(weekStart === undefined ? {} : { weekStart }) })!);
    return e.compute({ ...defaultConfig(e.info()), grain: "week", agg: "sum", measure: "sales", partial: "include" }, "explore");
  };
  const dayOf = (ms: number): number => new Date(ms).getUTCDay();
  assert.equal(dayOf(weeks().A.t[1]!), 1, "Monday when unset");
  assert.equal(dayOf(weeks(6).A.t[1]!), 0, "Sunday when chosen");
  assert.equal(dayOf(weeks(5).A.t[1]!), 6, "Saturday when chosen");
});

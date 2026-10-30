import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTable } from "../src/data/timeseries/base.js";
import { decompose, phaseCount, phaseIndex } from "../src/data/timeseries/decompose.js";
import { defaultConfig, TsEngine } from "../src/data/timeseries/engine.js";

const DAY = 86_400_000;

test("a whole season length keeps i % m; a calendar length spreads periods over whole phases", () => {
  for (let i = 0; i < 100; i++) assert.equal(phaseIndex(i, 7), i % 7);
  const m = 365.25 / 7;
  assert.equal(phaseCount(m), 52);
  const hits = new Array<number>(52).fill(0);
  for (let i = 0; i < 52 * 20; i++) hits[phaseIndex(i, m)]++;
  // Every phase is used, about equally (no 53rd phase that is rarely hit).
  assert.ok(Math.min(...hits) >= 19 && Math.max(...hits) <= 21, hits.join(","));
});

test("a yearly peak in weekly data stays on its week over ten years with 52.18, not with 52", () => {
  // Ten years of weeks; the peak is always mid-July (day 195 of the year).
  const start = Date.UTC(2010, 0, 4), n = 522;
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const d = new Date(start + i * 7 * DAY);
    const doy = (d.getTime() - Date.UTC(d.getUTCFullYear(), 0, 1)) / DAY;
    y[i] = 100 + 40 * Math.exp(-(((doy - 195) / 10) ** 2));
  }
  const calendar = decompose(y, n, 365.25 / 7)!;
  const whole = decompose(y, n, 52)!;
  assert.equal(calendar.prof.length, 52);
  assert.ok(calendar.fs > whole.fs, `52.18 strength ${calendar.fs.toFixed(3)} vs 52 ${whole.fs.toFixed(3)}`);
});

test("the engine names the seasons a series is too short for, and what they need", () => {
  const times = Float64Array.from({ length: 90 }, (_, i) => Date.UTC(2026, 0, 1) + i * DAY);
  const sales = Float64Array.from({ length: 90 }, (_, i) => 100 + 20 * ((i % 7) >= 5 ? -1 : 1) + (i % 3));
  const table = buildTable({ times, cols: { sales }, flags: {}, groups: ["all"], rowGroup: new Uint16Array(90), groupCol: null, dateCol: "day", dropped: 0 })!;
  const engine = new TsEngine(table);
  const snap = engine.compute({ ...defaultConfig(engine.info()), grain: "day" }, "decompose");
  assert.deepEqual(snap.dec.options.map((o) => o.m), [7]);
  assert.deepEqual(snap.dec.tooShort, [{ m: 365.25, need: 733 }]);
});

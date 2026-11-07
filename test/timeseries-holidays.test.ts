import { test } from "node:test";
import assert from "node:assert/strict";
import { easterSunday, holidaysBetween, holidaysOfYear, suggestRegion } from "../src/data/timeseries/holidays.js";

const iso = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
const on = (region: string, year: number): Record<string, string> => Object.fromEntries(holidaysOfYear(region, year).map((h) => [h.name, iso(h.ms)]));

test("Easter, and the Western Australian holidays of 2025", () => {
  assert.equal(iso(easterSunday(2025)), "2025-04-20");
  assert.equal(iso(easterSunday(2024)), "2024-03-31");
  const wa = on("AU-WA", 2025);
  assert.equal(wa["New Year's Day"], "2025-01-01");
  assert.equal(wa["Australia Day"], "2025-01-27", "26 Jan was a Sunday, so the Monday is observed");
  assert.equal(wa["Labour Day"], "2025-03-03");
  assert.equal(wa["Good Friday"], "2025-04-18");
  assert.equal(wa["Anzac Day"], "2025-04-25");
  assert.equal(wa["Western Australia Day"], "2025-06-02");
  assert.equal(wa["King's Birthday"], "2025-09-29");
  assert.equal(wa["Christmas Day"], "2025-12-25");
  assert.equal(wa["Boxing Day"], "2025-12-26");
  assert.equal(wa["Easter Saturday"], undefined, "Western Australia does not keep Easter Saturday");
});

test("other regions, and holidays in a date range", () => {
  assert.equal(on("US", 2025)["Thanksgiving"], "2025-11-27");
  assert.equal(on("UK", 2025)["Spring bank holiday"], "2025-05-26");
  assert.equal(on("AU-VIC", 2025)["Melbourne Cup Day"], "2025-11-04");
  const week = holidaysBetween("AU-WA", Date.UTC(2025, 11, 22), Date.UTC(2025, 11, 29));
  assert.deepEqual(week.map((h) => h.name), ["Christmas Day", "Boxing Day"]);
  assert.deepEqual(holidaysBetween("", 0, Date.UTC(2030, 0, 1)), []);
});

test("a region is suggested from the browser, never assumed", () => {
  assert.equal(suggestRegion("en-AU", "Australia/Perth"), "AU-WA");
  assert.equal(suggestRegion("en-GB", "Europe/London"), "UK");
  assert.equal(suggestRegion("fr-FR", "Europe/Paris"), "");
});

import { buildTable } from "../src/data/timeseries/base.js";
import { HOLIDAY_COL } from "../src/data/timeseries/aggregate.js";
import { defaultConfig, TsEngine } from "../src/data/timeseries/engine.js";
import { buildInsights } from "../src/ui/timeseries-findings.js";

let seed = 17;
const rnd = (): number => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) - 0.5;

function shop(region: string) {
  const n = 365 * 3, times = Float64Array.from({ length: n }, (_, i) => Date.UTC(2023, 0, 1) + i * 86_400_000);
  const holiday = new Set(holidaysBetween(region, times[0]!, times[n - 1]! + 86_400_000).map((h) => h.ms));
  const v = Float64Array.from({ length: n }, (_, i) => (holiday.has(times[i]!) ? 40 : 100 + 20 * Math.sin((2 * Math.PI * i) / 7)) + 3 * rnd());
  const t = buildTable({ times, cols: { sales: v }, flags: {}, groups: ["all"], rowGroup: new Uint16Array(n), groupCol: null, dateCol: "d", dropped: 0 })!;
  return new TsEngine(t);
}

test("a holiday region adds a Public holiday column, which is found as a driver and explains the unusual days", () => {
  const e = shop("AU-WA");
  const off = e.compute({ ...defaultConfig(e.info()), agg: "mean", measure: "sales", grain: "day" }, "explore");
  assert.equal(off.driverScan?.hints.some((h) => h.col === HOLIDAY_COL), false, "no calendar until a region is chosen");
  const on = e.compute({ ...defaultConfig(e.info()), agg: "mean", measure: "sales", grain: "day", holidays: "AU-WA" }, "explore");
  const hint = on.driverScan?.hints.find((h) => h.col === HOLIDAY_COL);
  assert.ok(hint && hint.cut > 0.3, `the calendar cuts the error (${hint?.cut})`);
  const unusual = buildInsights(on, { mode: "explore", model: "auto", showShift: true }).find((f) => f.kind.startsWith("Unusual"));
  assert.ok(unusual);
  assert.match(unusual!.html, /falls on this day, which usually explains it/);
});

test("with the holiday driver on, the forecast knows the holidays to come", () => {
  const e = shop("AU-WA");
  const base = { ...defaultConfig(e.info()), agg: "mean" as const, measure: "sales", grain: "day" as const, holidays: "AU-WA", horizon: 365 };
  const plain = e.compute(base, "forecast");
  const withHol = e.compute({ ...base, drivers: [{ col: HOLIDAY_COL, rule: "hold", pct: 0 }] }, "forecast");
  const ratio = (s: typeof plain): number => ("error" in s.models ? NaN : s.models.models.reg.ratio ?? NaN);
  assert.ok(ratio(withHol) < ratio(plain), `reg error ${ratio(withHol)} < ${ratio(plain)}`);
});

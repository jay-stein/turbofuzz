/**
 * Python reference check for the Time Series engine (run by hand, not in the gate).
 *   npx tsx prototypes/time-series/reference/dump.ts <data dir> out.json
 *   python compare.py out.json        (needs numpy and statsmodels)
 * The data dir holds the public files listed in next_steps.md (airline passengers,
 * sunspots, births, daily minimum temperatures, Fremont hourly). Results: results.txt.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { buildTable, type TsInput } from "../../../src/data/timeseries/base.js";
import { TsEngine, defaultConfig } from "../../../src/data/timeseries/engine.js";
import { decompose } from "../../../src/data/timeseries/decompose.js";
import type { GrainId } from "../../../src/data/timeseries/base.js";
const D = process.argv[2];
const read = (f: string, parse: (cells: string[]) => [number, number] | null): TsInput => {
  const t: number[] = [], v: number[] = [];
  for (const line of readFileSync(D + "/" + f, "utf8").split(/\r?\n/).slice(1)) {
    const cells = line.split(",").map((c) => c.replace(/"/g, "").trim());
    const r = cells.length > 1 ? parse(cells) : null;
    if (r && r[1] === r[1]) { t.push(r[0]); v.push(r[1]); }
  }
  return { times: Float64Array.from(t), cols: { value: Float64Array.from(v) }, flags: {}, groups: ["all"], rowGroup: new Uint16Array(t.length), groupCol: null, dateCol: "date", dropped: 0 };
};
const fremont = (c: string[]): [number, number] | null => {
  const m = /^(\d+)\/(\d+)\/(\d+) (\d+):(\d+):(\d+) (AM|PM)$/.exec(c[0]); if (!m) return null;
  const h = (+m[4] % 12) + (m[7] === "PM" ? 12 : 0);
  return [Date.UTC(+m[3], +m[1] - 1, +m[2], h), Number(c[1])];
};
const fx: { name: string; input: TsInput; grain: GrainId; H: number; agg?: "sum" | "mean" }[] = [
  { name: "airline", input: read("airline-passengers.csv", (c) => [Date.UTC(+c[0].slice(0, 4), +c[0].slice(5, 7) - 1, 1), +c[1]]), grain: "month", H: 24 },
  { name: "sunspots", input: read("monthly-sunspots.csv", (c) => [Date.UTC(+c[0].slice(0, 4), +c[0].slice(5, 7) - 1, 1), +c[1]]), grain: "month", H: 24 },
  { name: "births", input: read("daily-total-female-births.csv", (c) => [Date.parse(c[0] + "T00:00:00Z"), +c[1]]), grain: "day", H: 28 },
  { name: "min-temps", input: read("daily-min-temperatures.csv", (c) => [Date.parse(c[0] + "T00:00:00Z"), +c[1]]), grain: "week", H: 26, agg: "mean" },
  { name: "fremont-hourly", input: (() => { const i = read("fremont-hourly.csv", fremont); const k = i.times.findIndex((x) => x >= Date.UTC(2019, 0, 1)); const e = i.times.findIndex((x) => x >= Date.UTC(2020, 0, 1)); return { ...i, times: i.times.slice(k, e), cols: { value: i.cols.value.slice(k, e) }, rowGroup: new Uint16Array(e - k) }; })(), grain: "hour", H: 168 },
];
const out: unknown[] = [];
for (const f of fx) {
  const t = buildTable(f.input); if (!t) throw new Error(f.name);
  const e = new TsEngine(t);
  const base = { ...defaultConfig(e.info()), grain: f.grain, agg: f.agg ?? "sum", gaps: "seasonal" as const };
  const full = e.compute(base, "decompose");
  const N = full.A.modelN;
  const s = e.compute({ ...base, split: N - f.H, horizon: f.H }, "forecast");
  if ("error" in s.models || !s.futures) throw new Error(f.name + " " + JSON.stringify(s.models));
  const y = Array.from(full.A.yModel.subarray(0, N));
  const m = full.A.modelM;
  const add = decompose(full.A.yModel, N, m);
  out.push({
    name: f.name, m, H: f.H, y, split: N - f.H, chosen: full.dec.dec?.m, scaled: !!full.dec.dec?.scaled,
    trend: add ? Array.from(add.trend) : null, seasonal: add ? Array.from(add.seasonal) : null,
    F: Object.fromEntries(Object.entries(s.futures).map(([k, v]) => [k, Array.from(v.F)])),
    hwParams: (s.models as { models: { hw: unknown } }).models.hw,
  });
}
writeFileSync(process.argv[3], JSON.stringify(out));
console.log("wrote", out.length);

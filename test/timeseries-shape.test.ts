import { test } from "node:test";
import assert from "node:assert/strict";
import { seriesShape, spacingOf, type ShapeCandidate } from "../src/data/timeseries/shape.js";

const MIN = 60_000, DAY = 86_400_000;

/** n moments `step` apart, `per` rows each (one per series), plus a constant column. */
function interleaved(n: number, per: number, step: number): { times: Float64Array; series: Int32Array; region: Int32Array } {
  const times: number[] = [], series: number[] = [], region: number[] = [];
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < per; k++) {
      times.push(Date.UTC(2026, 0, 1) + i * step);
      series.push(k);
      region.push(k % 2);
    }
  }
  return { times: Float64Array.from(times), series: Int32Array.from(series), region: Int32Array.from(region) };
}

test("several rows per moment: the column that tells them apart is named", () => {
  const { times, series, region } = interleaved(200, 5, 30 * MIN);
  const candidates: ShapeCandidate[] = [
    { column: 3, name: "region", codes: region },
    { column: 1, name: "car_park", codes: series },
  ];
  const shape = seriesShape(times, null, candidates);
  assert.equal(shape.rows, 1000);
  assert.equal(shape.moments, 200);
  assert.equal(shape.typical, 5);
  assert.equal(shape.repeatShare, 1);
  // region repeats within a moment, so only car_park explains the rows.
  assert.deepEqual(shape.keys.map((k) => k.name), ["car_park"]);
  assert.equal(shape.keys[0]!.distinct, 5);
});

test("one group's rows make one series again", () => {
  const { times, series } = interleaved(100, 4, DAY);
  const keep = Uint8Array.from(series, (s) => (s === 2 ? 1 : 0));
  const shape = seriesShape(times, keep, [{ column: 1, name: "store", codes: series }]);
  assert.equal(shape.typical, 1);
  assert.equal(shape.repeatShare, 0);
  assert.deepEqual(shape.keys, []);
});

test("a row id is not the series column when a short list also fits", () => {
  const { times, series } = interleaved(100, 3, DAY);
  const id = Int32Array.from(series, (_, i) => i);
  const shape = seriesShape(times, null, [
    { column: 0, name: "row_id", codes: id },
    { column: 1, name: "sensor", codes: series },
  ]);
  assert.deepEqual(shape.keys.map((k) => k.name), ["sensor", "row_id"]);
});

test("spacing: regular, regular with missing periods, and irregular", () => {
  const regular = Array.from({ length: 50 }, (_, i) => i * 30 * MIN);
  assert.equal(spacingOf(regular)?.kind, "regular");
  assert.equal(spacingOf(regular)?.typicalMs, 30 * MIN);

  const gaps = regular.filter((_, i) => i % 7 !== 3 && i % 11 !== 5);
  assert.equal(spacingOf(gaps)?.kind, "gaps");

  let t = 0;
  const jitter = Array.from({ length: 200 }, (_, i) => (t += (8 + ((i * 7) % 12)) * MIN));
  const irregular = spacingOf(jitter)!;
  assert.equal(irregular.kind, "irregular");
  assert.ok(irregular.p10Ms < irregular.typicalMs && irregular.typicalMs < irregular.p90Ms);

  // Calendar months (28 to 31 days) count as regular.
  const months = Array.from({ length: 36 }, (_, i) => Date.UTC(2020, i, 1));
  assert.equal(spacingOf(months)?.kind, "regular");
});

test("suggests the columns that could name a series, many-valued ones before flags, with the largest values first", async () => {
  const { suggestSeries } = await import("../src/data/timeseries/shape.js");
  // 1,200 trips at unique seconds: 30 stations of 40 trips each, a two-way user type, and a column that is mostly one-off.
  const n = 1200;
  const times = Float64Array.from({ length: n }, (_, i) => 1_700_000_000_000 + i * 60_000);
  const idx = Array.from({ length: n }, (_, i) => i);
  const station = Int32Array.from({ length: n }, (_, i) => i % 30);
  const labels = Array.from({ length: 30 }, (_, i) => `Station ${i}`);
  const user = Int32Array.from({ length: n }, (_, i) => i % 2);
  const oneOff = Int32Array.from({ length: n }, (_, i) => i);
  const out = suggestSeries(times, idx, [
    { column: 4, name: "usertype", codes: user, labels: ["Subscriber", "Customer"] },
    { column: 3, name: "station", codes: station, labels },
    { column: 5, name: "trip id", codes: oneOff, labels: Array.from({ length: n }, (_, i) => `T${i}`) },
  ]);
  assert.deepEqual(out.map((o) => o.name), ["station", "usertype"], "a column whose values never reach 24 moments is not suggested; the flag comes after");
  assert.equal(out[0]!.distinct, 30);
  assert.ok(out[0]!.coverage >= 0.99);
  assert.equal(out[0]!.values.length, 8);
  assert.equal(out[0]!.values[0]!.rows, 40);
  assert.deepEqual(suggestSeries(times, idx, []), []);
});

test("calendar columns are not offered as the series: weekday, month, hour and flags change slowly along time", async () => {
  const { suggestSeries, changesSlowly } = await import("../src/data/timeseries/shape.js");
  // One gym, a reading every 10 minutes for 60 days: the weekday, month, hour and weekend flag describe the moment.
  const n = 60 * 144;
  const start = Date.UTC(2015, 7, 14);
  const times = Float64Array.from({ length: n }, (_, i) => start + i * 10 * MIN);
  const idx = Array.from({ length: n }, (_, i) => i);
  const at = (i: number): Date => new Date(times[i]!);
  const weekday = Int32Array.from({ length: n }, (_, i) => at(i).getUTCDay());
  const month = Int32Array.from({ length: n }, (_, i) => at(i).getUTCMonth());
  const hour = Int32Array.from({ length: n }, (_, i) => at(i).getUTCHours());
  const weekend = Int32Array.from({ length: n }, (_, i) => (at(i).getUTCDay() % 6 === 0 ? 1 : 0));
  const names = (len: number): string[] => Array.from({ length: len }, (_, i) => String(i));
  const calendar = [
    { column: 3, name: "day_of_week", codes: weekday, labels: names(7) },
    { column: 9, name: "month", codes: month, labels: names(12) },
    { column: 10, name: "hour", codes: hour, labels: names(24) },
    { column: 4, name: "is_weekend", codes: weekend, labels: names(2) },
  ];
  assert.deepEqual(suggestSeries(times, idx, calendar), [], "one series sampled often is not several");
  for (const c of calendar) assert.equal(changesSlowly(c.codes, idx, c.labels.length), true, c.name);

  // Eight sensors reporting in turn at the same beat do interleave: the column naming them stays on offer.
  const sensor = Int32Array.from({ length: n }, (_, i) => i % 8);
  assert.deepEqual(suggestSeries(times, idx, [...calendar, { column: 1, name: "sensor", codes: sensor, labels: names(8) }]).map((s) => s.name), ["sensor"]);
  // So does a skewed one in random order, as trips from busy and quiet stations arrive.
  let seed = 7;
  const rand = (): number => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const station = Int32Array.from({ length: n }, () => (rand() < 0.6 ? 0 : 1 + Math.floor(rand() * 9)));
  assert.equal(changesSlowly(station, idx, 10), false);
  assert.deepEqual(suggestSeries(times, idx, [{ column: 2, name: "station", codes: station, labels: names(10) }]).map((s) => s.name), ["station"]);
  // Too few rows to judge: left on offer rather than dropped on a guess.
  assert.equal(changesSlowly(weekday, idx.slice(0, 30), 7), false);
});

test("a text column that names the series beats a numeric code with more values", async () => {
  const { suggestSeries, seriesShape: shapeOf } = await import("../src/data/timeseries/shape.js");
  // 200 days, 4 stores every day; `units` is a 1-5 quantity per row, so it also has values at every moment.
  const times: number[] = [], store: number[] = [], units: number[] = [];
  for (let d = 0; d < 200; d++) for (let k = 0; k < 4; k++) { times.push(Date.UTC(2025, 0, 1) + d * DAY); store.push(k); units.push((d * 7 + k * 3) % 5); }
  const t = Float64Array.from(times);
  const idx = times.map((_, i) => i);
  const entities = [
    { column: 2, name: "units", codes: Int32Array.from(units), labels: ["1", "2", "3", "4", "5"], numeric: true },
    { column: 1, name: "store", codes: Int32Array.from(store), labels: ["Perth", "Fremantle", "Midland", "Joondalup"], numeric: false },
  ];
  const out = suggestSeries(t, idx, entities);
  assert.equal(out[0]!.name, "store", "text first, even though units has more values");
  assert.equal(out[0]!.sound, true);
  assert.equal(out.find((o) => o.name === "units")!.numeric, true);

  // The column that explains the repeats is chosen the same way.
  const shape = shapeOf(t, null, [
    { column: 2, name: "units", codes: Int32Array.from(units), numeric: true },
    { column: 1, name: "store", codes: Int32Array.from(store) },
  ]);
  assert.equal(shape.keys[0]?.name, "store");
});

test("a value that exists for only a short stretch does not read as a parallel series", async () => {
  const { suggestSeries } = await import("../src/data/timeseries/shape.js");
  // `era` changes once, halfway: each value is present at 100 moments, but only over half the dates.
  const times: number[] = [], era: number[] = [];
  for (let d = 0; d < 200; d++) { times.push(Date.UTC(2025, 0, 1) + d * DAY); era.push(d < 100 ? 0 : 1); }
  const out = suggestSeries(Float64Array.from(times), times.map((_, i) => i), [{ column: 1, name: "era", codes: Int32Array.from(era), labels: ["old", "new"] }]);
  assert.equal(out.length === 0 || out[0]!.sound === false, true);
});

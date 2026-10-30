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

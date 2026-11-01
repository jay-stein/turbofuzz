import { test } from "node:test";
import assert from "node:assert/strict";
import { groupPlaces } from "../src/data/chart-series.js";

const ids = (n: number): Uint32Array => Uint32Array.from({ length: n }, (_, i) => i);

test("rows at the same place become one dot, valued by how many rows it holds", () => {
  // Three stations: A has 4 trips, B has 2, C has 1; a trip with no position is left out.
  const lon = Float64Array.from([-74.0, -74.0, -73.9, -74.0, -73.9, -73.8, -74.0, Number.NaN]);
  const lat = Float64Array.from([40.7, 40.7, 40.8, 40.7, 40.8, 40.6, 40.7, 40.7]);
  const r = groupPlaces(lon, lat, ids(8), null, "count", 100);
  assert.equal(r.places, true);
  assert.equal(r.shown, 3);
  assert.equal(r.total, 7, "rows with a position");
  assert.deepEqual(Array.from(r.size ?? []), [4, 2, 1]);
  assert.deepEqual(Array.from(r.counts ?? []), [4, 2, 1]);
  assert.equal(r.sampled, false);
  assert.ok(r.xMin <= -74.0 && r.xMax >= -73.8 && r.yMin <= 40.6 && r.yMax >= 40.8, "the extent covers every place, not clipped");
});

test("places a metre apart are one place; ten metres apart are two", () => {
  const lon = Float64Array.from([-74.000001, -74.000004, -74.0001]);
  const lat = Float64Array.from([40.7, 40.7, 40.7]);
  const r = groupPlaces(lon, lat, ids(3), null, "count", 100);
  assert.deepEqual(Array.from(r.counts ?? []), [2, 1]);
});

test("with a size column the place carries the chosen aggregate of it", () => {
  const lon = Float64Array.from([1, 1, 1, 2]);
  const lat = Float64Array.from([5, 5, 5, 6]);
  const size = Float64Array.from([10, 20, 60, 7]);
  const by = (agg: "sum" | "mean" | "min" | "max"): number[] => Array.from(groupPlaces(lon, lat, ids(4), size, agg, 100).size ?? []);
  assert.deepEqual(by("sum"), [90, 7]);
  assert.deepEqual(by("mean"), [30, 7]);
  assert.deepEqual(by("min"), [10, 7]);
  assert.deepEqual(by("max"), [60, 7]);
  // The row counts stay available beside the measure.
  assert.deepEqual(Array.from(groupPlaces(lon, lat, ids(4), size, "sum", 100).counts ?? []), [3, 1]);
});

test("a missing size value does not count toward a mean, and a place with none has no value", () => {
  const lon = Float64Array.from([1, 1, 2]);
  const lat = Float64Array.from([5, 5, 6]);
  const size = Float64Array.from([10, Number.NaN, Number.NaN]);
  const r = groupPlaces(lon, lat, ids(3), size, "mean", 100);
  assert.equal(r.size?.[0], 10);
  assert.ok(Number.isNaN(r.size?.[1] ?? 0));
});

test("more places than the limit keeps the busiest and says it was sampled", () => {
  const n = 50;
  const lon = Float64Array.from({ length: n }, (_, i) => i);
  const lat = new Float64Array(n).fill(1);
  // Places 0..49 get one row each, then places 0..9 get a second one: the busiest ten have 2.
  const rows = Uint32Array.from({ length: n + 10 }, (_, i) => (i < n ? i : i - n));
  const r = groupPlaces(lon, lat, rows, null, "count", 10);
  assert.equal(r.sampled, true);
  assert.equal(r.shown, 10);
  assert.ok(Array.from(r.counts ?? []).every((c) => c === 2));
  assert.equal(r.total, n + 10);
});

test("nothing plottable gives an empty result with a usable extent", () => {
  const r = groupPlaces(Float64Array.from([Number.NaN]), Float64Array.from([Number.NaN]), ids(1), null, "count", 10);
  assert.equal(r.shown, 0);
  assert.ok(r.xMax > r.xMin && r.yMax > r.yMin);
});

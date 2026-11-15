import { test } from "node:test";
import assert from "node:assert/strict";
import { detectGeoPair, matchGeoName } from "../src/data/geo.js";
import { checkPlausibility } from "../src/data/plausibility.js";
import { detectHiddenZeros } from "../src/data/hidden-missing.js";
import { reviewCoordinates } from "../src/data/coordinate-review.js";
import { buildDataset } from "../src/data/build.js";
import { qualityFindings } from "../src/data/findings.js";

const none = () => false;

test("common longitude names are recognised, look-alikes are not", () => {
  for (const name of ["Long", "long", "lng", "LONG_WGS84"]) assert.equal(matchGeoName(name), "lon", name);
  assert.equal(matchGeoName("Lat"), "lat");
  for (const name of ["x", "y", "along", "longest", "belong", "altitude"]) assert.equal(matchGeoName(name), null, name);
});

test("map pair is found for Lat + Long", () => {
  const ds = buildDataset("t", ["Lat", "Long", "n"], Array.from({ length: 20 }, (_, i) => [String(40 + i / 10), String(-70 - i / 10), String(i)]));
  const pair = detectGeoPair(ds.columns.map((c) => ({ name: c.name, type: c.type, stats: c.stats }) as never), 20);
  assert.ok(pair !== null);
});

test("impossible coordinates are counted; ordinary columns and valid values stay quiet", () => {
  const lat = ["10", "95", "-91.5", "123.4", "45"];
  const bad = checkPlausibility("latitude", "number", lat, none, "dot");
  assert.equal(bad?.count, 3);
  assert.equal(checkPlausibility("latitude", "number", ["10", "-90", "90", "45"], none, "dot"), null);
  assert.equal(checkPlausibility("longitude", "number", ["-180", "180", "0", "99"], none, "dot"), null);
  assert.equal(checkPlausibility("longitude", "number", ["-181", "10", "20"], none, "dot")?.count, 1);
  assert.equal(checkPlausibility("price", "number", lat, none, "dot"), null);
});

test("a minority of exact zeros beside real coordinates is a suggestion; no zeros is quiet", () => {
  const raw = [...Array.from({ length: 100 }, (_, i) => String(40 + i / 100)), "0", "0", "0", "0", "0", "0"];
  assert.equal(detectHiddenZeros("lat", "number", raw, none, "dot")?.count, 6);
  assert.equal(detectHiddenZeros("lat", "number", raw.slice(0, 100), none, "dot"), null);
  assert.equal(detectHiddenZeros("depth_m", "number", raw, none, "dot"), null);
});

test("(0,0) and swapped pairs are counted", () => {
  const lat = Float64Array.from([10, 0, 120, 95, 50, 0, NaN]);
  const lon = Float64Array.from([20, 0, 30, 100, 10, 5, 0]);
  const review = reviewCoordinates(lat, lon, 1);
  assert.deepEqual(review, { lonColumn: 1, checked: 6, zeroPair: 1, swapped: 1 });
  assert.equal(reviewCoordinates(Float64Array.from([1, 2]), Float64Array.from([3, 4]), 1), null);
});

test("quality findings list the (0,0) and swapped rows with a Show rows action", () => {
  const ds = buildDataset("t", ["lat", "lon"], [["1", "2"], ["3", "4"]]);
  const metas = ds.columns.map((c) => ({ name: c.name, type: c.type, stats: c.stats, suggestions: [], nullTokens: [], categories: null, similarGroups: 0 }) as never);
  (metas[0] as { stats: object }).stats = { ...ds.columns[0].stats, coordinates: { lonColumn: 1, checked: 2, zeroPair: 2, swapped: 1 } };
  const found = qualityFindings(metas, { duplicateGroups: 0, duplicateRows: 0 } as never, 2).filter((f) => f.id.startsWith("coordinates."));
  assert.equal(found.length, 2);
  assert.ok(found.every((f) => f.action?.kind === "filterCoordinates"));
});

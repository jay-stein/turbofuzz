import { test } from "node:test";
import assert from "node:assert/strict";
import {
  detectGeoPair,
  detectPlaceColumn,
  parseLatitude,
  parseLongitude,
} from "../src/data/geo.js";
import type { ColumnMeta } from "../src/worker/protocol.js";

function meta(overrides: Partial<ColumnMeta> = {}): ColumnMeta {
  return {
    name: "col",
    type: "number",
    numberLocale: "dot",
    dateOrder: "dmy",
    stats: {
      nulls: 0,
      distinct: 100,
      samples: [],
      topValues: [],
      min: null,
      max: null,
      mean: null,
      stddev: null,
      minLength: null,
      maxLength: null,
      avgLength: null,
    },
    anomalyCounts: { values: 0, lengths: 0 },
    similarGroups: 0,
    categories: null,
    histogram: null,
    valueFence: null,
    lengthFence: null,
    nullPolicy: { extra: [], keep: [] },
    nullTokens: [],
    suggestions: [],
    ...overrides,
  };
}

function num(name: string, min: number, max: number, overrides: Partial<ColumnMeta> = {}): ColumnMeta {
  return meta({
    name,
    type: "number",
    stats: { ...meta().stats, min, max },
    ...overrides,
  });
}

test("decimal coordinates parse with signs and hemispheres", () => {
  assert.equal(parseLatitude("51.5074"), 51.5074);
  assert.equal(parseLatitude("-33.8688"), -33.8688);
  assert.equal(parseLatitude("51.5074 N"), 51.5074);
  assert.equal(parseLatitude("S 33.8688"), -33.8688);
  assert.equal(parseLatitude("33,8688 S"), -33.8688, "comma decimals read as dot");
  assert.equal(parseLongitude("E151.2093"), 151.2093);
  assert.equal(parseLongitude("151.2093W"), -151.2093);
});

test("DMS coordinates parse from the common shapes", () => {
  const expected = 51 + 30 / 60 + 26 / 3600;
  assert.ok(Math.abs((parseLatitude(`51°30'26"N`) ?? 0) - expected) < 1e-9);
  assert.ok(Math.abs((parseLatitude("51 30 26 N") ?? 0) - expected) < 1e-9);
  assert.ok(Math.abs((parseLatitude("N51 30 26") ?? 0) - expected) < 1e-9);
  assert.ok(Math.abs((parseLongitude("E151°12'30\"") ?? 0) - (151 + 12 / 60 + 30 / 3600)) < 1e-9);
  assert.ok(Math.abs((parseLatitude("51°30.5' N") ?? 0) - (51 + 30.5 / 60)) < 1e-9);
  assert.equal(parseLatitude("51° 30' 26\" S"), -(51 + 30 / 60 + 26 / 3600));
});

test("invalid coordinates return null", () => {
  assert.equal(parseLatitude("91"), null, "beyond the pole");
  assert.equal(parseLongitude("181"), null);
  assert.equal(parseLatitude("café"), null);
  assert.equal(parseLatitude("51 61 26"), null, "minutes over 59");
  assert.equal(parseLongitude("120 30 61"), null, "seconds over 59");
  assert.equal(parseLatitude(""), null);
  assert.equal(parseLatitude("1 2 3 4"), null, "too many parts");
});

test("detectGeoPair needs both columns named", () => {
  const named = detectGeoPair([
    num("id", 1, 1000),
    num("pickup_latitude", -37.9, -37.7),
    num("pickup_longitude", 144.8, 145.1),
  ]);
  assert.deepEqual(named, {
    lat: 1,
    lon: 2,
    reason: "pickup_latitude/pickup_longitude read as latitude/longitude",
  });

  // Values that merely fit the ranges are not enough: only the names count.
  assert.equal(detectGeoPair([num("x", -122.5, -122.3), num("y", 37.7, 37.9)]), null);
  assert.equal(
    detectGeoPair([num("price", 100, 170), num("age", 20, 80), num("rooms", 1, 6)]),
    null,
    "a price and an age fit the ranges but are not coordinates",
  );
  assert.equal(detectGeoPair([num("lat", 51.4, 51.6), num("price", 100, 170)]), null, "a named latitude does not adopt any column that fits");

  const latOnly = detectGeoPair([
    num("lat", 51.4, 51.6),
    num("lon", -0.2, 0.1),
  ]);
  assert.equal(latOnly?.lat, 0);
  assert.equal(latOnly?.lon, 1);
});

test("detectGeoPair stays quiet without real coordinates", () => {
  assert.equal(detectGeoPair([num("price", 1, 100), num("qty", 1, 5)]), null);
  assert.equal(detectGeoPair([num("lat", 1, 100)]), null, "one column is not a pair");
  assert.equal(
    detectGeoPair([num("amount_a", -80, 80), num("amount_b", -70, 70)]),
    null,
    "two latitude-like ranges prove nothing",
  );
  const idish = num("lat", 1, 90, {
    type: "integer",
    stats: { ...meta().stats, min: 1, max: 90, distinct: 500 },
  });
  assert.equal(
    detectGeoPair([idish, num("lon", -180, 180)], 500),
    null,
    "row-id-like columns never pair",
  );
});

test("decimal coordinates unique on every row still pair", () => {
  const unique = (name: string, min: number, max: number) =>
    num(name, min, max, { type: "number", stats: { ...meta().stats, min, max, distinct: 300 } });
  const pair = detectGeoPair([unique("lat", 20, 50), unique("lon", -15, 35)], 300);
  assert.deepEqual([pair?.lat, pair?.lon], [0, 1]);
});

test("misspelled coordinate names still detect", () => {
  const typo = detectGeoPair([num("Lattitude", -37.9, -37.7), num("Longtitude", 144.8, 145.1)]);
  assert.equal(typo?.lat, 0, "Lattitude (double t) is latitude");
  assert.equal(typo?.lon, 1, "Longtitude (missing i) is longitude");

  const short = detectGeoPair([num("latitute", -37.9, -37.7), num("lngitude", 144.8, 145.1)]);
  assert.ok(short !== null, "letter slips inside the word detect");

  const spaced = detectGeoPair([num("Station Lattitude", -37.9, -37.7), num("Station Longitude", 144.8, 145.1)]);
  assert.equal(spaced?.lat, 0, "tokens inside longer names match");

  const alt = detectGeoPair([num("altitude", 10, 500), num("longitude", 144.8, 145.1)]);
  assert.equal(alt, null, "altitude is not latitude, even one edit away");
});

test("detectPlaceColumn finds a text column named for places, by whole word", () => {
  const wind = [meta({ name: "No", type: "integer" }), meta({ name: "Installed Capacity (MW)" }), meta({ name: "County", type: "category" }), meta({ name: "Year", type: "integer" })];
  assert.equal(detectPlaceColumn(wind), 2);
  assert.equal(detectPlaceColumn([meta({ name: "state_name", type: "string" })]), 0);
  assert.equal(detectPlaceColumn([meta({ name: "Statement", type: "string" }), meta({ name: "product", type: "category" })]), null);
  // A numeric column named for places is a code, not names.
  assert.equal(detectPlaceColumn([meta({ name: "region", type: "integer" })]), null);
});

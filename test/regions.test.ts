import assert from "node:assert/strict";
import test from "node:test";
import type { GeoDataset, GeoFeature } from "../src/data/geo-file.js";
import {
  aggregateRegions,
  buildShapes,
  chooseLabelProperty,
  featureAreaKm2,
  joinKey,
  levelFor,
  pointInFeature,
  RegionIndex,
  simplifyRing,
  suggestJoins,
} from "../src/data/regions.js";

const square = (x: number, y: number, size: number): Float64Array => Float64Array.of(x, y, x + size, y, x + size, y + size, x, y + size, x, y);

const feature = (properties: GeoFeature["properties"], rings: Float64Array[], holes: boolean[] = rings.map(() => false)): GeoFeature => ({ label: "", properties, rings, holes });

test("a point is found inside, outside, in a second part, and not in a hole", () => {
  const donut = feature({}, [square(0, 0, 10), square(4, 4, 2), square(20, 0, 2)], [false, true, false]);
  assert.equal(pointInFeature(donut, 1, 1), true);
  assert.equal(pointInFeature(donut, 5, 5), false, "the hole");
  assert.equal(pointInFeature(donut, 21, 1), true, "the second part");
  assert.equal(pointInFeature(donut, 15, 1), false);
});

test("the index finds the right region among many, and -1 outside them", () => {
  const features: GeoFeature[] = [];
  for (let x = 0; x < 20; x++) for (let y = 0; y < 20; y++) features.push(feature({ id: `${x},${y}` }, [square(x, y, 1)]));
  const index = new RegionIndex(features, { lonMin: 0, lonMax: 20, latMin: 0, latMax: 20 });
  assert.equal(features[index.locate(3.5, 7.5)]!.properties.id, "3,7");
  assert.equal(features[index.locate(19.9, 19.9)]!.properties.id, "19,19");
  assert.equal(index.locate(-1, 5), -1);
  assert.equal(index.locate(5, 25), -1);
});

test("an area comes out right: a degree of latitude and longitude at the equator", () => {
  // 111.19 km a side on the sphere, near enough.
  const area = featureAreaKm2(feature({}, [square(0, 0, 1)]));
  assert.ok(Math.abs(area - 12364) < 15, `${area}`);
  const holed = featureAreaKm2(feature({}, [square(0, 0, 1), square(0.25, 0.25, 0.5)], [false, true]));
  assert.ok(Math.abs(holed - area * 0.75) < 5, `${holed}`);
});

test("simplifying keeps the shape within the tolerance and drops the rest", () => {
  // A circle of 1,000 points.
  const n = 1000;
  const circle = new Float64Array((n + 1) * 2);
  for (let i = 0; i <= n; i++) {
    circle[i * 2] = Math.cos((i / n) * Math.PI * 2);
    circle[i * 2 + 1] = Math.sin((i / n) * Math.PI * 2);
  }
  const simple = simplifyRing(circle, 0.01);
  assert.ok(simple.length / 2 < 40, `${simple.length / 2} points`);
  assert.ok(simple.length / 2 >= 8);
  // Every kept point is still on the circle, and the first and last still meet.
  for (let i = 0; i < simple.length; i += 2) assert.ok(Math.abs(Math.hypot(simple[i]!, simple[i + 1]!) - 1) < 1e-9);
  assert.ok(Math.abs(simple[0]! - simple[simple.length - 2]!) < 1e-9);
  assert.ok(Math.abs(simple[1]! - simple[simple.length - 1]!) < 1e-9);
});

test("levels get finer, tiny islands drop out when zoomed out, and no region vanishes", () => {
  const big = square(0, 0, 50);
  const island = square(60, 60, 0.001);
  const speck = feature({}, [square(70, 70, 0.0005)]);
  const geo = { features: [feature({}, [big, island]), speck], bounds: { lonMin: 0, lonMax: 71, latMin: 0, latMax: 71 } } as unknown as GeoDataset;
  const { shapes, tolerances } = buildShapes(geo);
  assert.equal(shapes[0]!.levels[0]!.length, 1, "the island is too small to see from far out");
  assert.equal(shapes[1]!.levels[0]!.length, 1, "a region made only of a speck keeps it");
  assert.equal(shapes[0]!.levels.at(-1)!.length, 2, "and everything is there close up");
  assert.deepEqual(shapes[0]!.bbox, [0, 0, 60.001, 60.001]);
  assert.equal(levelFor(tolerances, 1e9), 0, "far out: coarsest");
  assert.equal(levelFor(tolerances, 0), tolerances.length - 1, "right in: finest");
});

test("names match despite case, spacing and how a code was written", () => {
  assert.equal(joinKey(" Ang  Mo KIO "), "ang mo kio");
  assert.equal(joinKey("0800"), "800");
  assert.equal(joinKey(800), "800");
  assert.equal(joinKey("800.0"), "800");
  assert.equal(joinKey("0"), "0");
  assert.equal(joinKey("1RNSW"), "1rnsw");
  assert.equal(joinKey(null), "");
});

const counties = [
  feature({ NAME_0: "Ireland", ISO: "IRL", NAME_1: "Carlow", TYPE_1: "County", ID_1: 1 }, [square(0, 0, 1)]),
  feature({ NAME_0: "Ireland", ISO: "IRL", NAME_1: "Cavan", TYPE_1: "County", ID_1: 2 }, [square(1, 0, 1)]),
  feature({ NAME_0: "Ireland", ISO: "IRL", NAME_1: "Clare", TYPE_1: "County", ID_1: 3 }, [square(2, 0, 1)]),
];

test("the naming field is the one that tells regions apart, not the one they share", () => {
  assert.equal(chooseLabelProperty(counties), "NAME_1");
  const singapore = [
    feature({ OBJECTID: 1, PLN_AREA_N: "BEDOK", PLN_AREA_C: "BD", INC_CRC: "5F00E6FF084F3364" }, [square(0, 0, 1)]),
    feature({ OBJECTID: 2, PLN_AREA_N: "BISHAN", PLN_AREA_C: "BS", INC_CRC: "AA11E6FF084F3364" }, [square(1, 0, 1)]),
  ];
  assert.equal(chooseLabelProperty(singapore), "PLN_AREA_N");
});

test("the best pairing of field and column comes first; a field everyone shares is not offered", () => {
  const suggestions = suggestJoins(counties, [
    { index: 4, values: new Set(["ireland"]) },
    { index: 7, values: new Set(["carlow", "clare", "dublin"]) },
  ]);
  assert.deepEqual(suggestions[0], { property: "NAME_1", column: 7, matched: 2, regions: 3, numeric: false });
  assert.ok(suggestions.every((item) => item.property !== "NAME_0"));
  // A row number and a region id are both 1, 2, 3: words beat that, however well the numbers line up.
  const both = suggestJoins(counties, [{ index: 1, values: new Set(["1", "2", "3"]) }, { index: 2, values: new Set(["carlow"]) }]);
  assert.equal(both[0]!.property, "NAME_1");
  assert.equal(both[1]!.numeric, true);
  // And numbers that only partly line up are not offered at all (a gender column against borough codes).
  assert.deepEqual(suggestJoins(counties, [{ index: 1, values: new Set(["1", "2"]) }]), []);
});

test("rows roll up per region by each statistic, and what found no region is reported", () => {
  const ids = Uint32Array.of(0, 1, 2, 3, 4, 5);
  const measure = Float64Array.of(10, 20, 60, Number.NaN, 5, 7);
  const place = [0, 0, 0, 1, -1, -1];
  const names = ["a", "a", "a", "b", "Dublin", "Dublin"];
  const run = (agg: "count" | "sum" | "mean" | "median" | "min" | "max") =>
    aggregateRegions({ regions: 3, ids, regionsOf: (row) => (place[row]! < 0 ? [] : [place[row]!]), unmatchedName: (row) => names[row]!, measure, agg });
  const mean = run("mean");
  assert.equal(mean.values[0], 30);
  assert.ok(Number.isNaN(mean.values[1]!), "region b has a row but no value");
  assert.ok(Number.isNaN(mean.values[2]!), "region c has no rows");
  assert.deepEqual([...mean.rows], [3, 1, 0]);
  assert.equal(mean.rowsMatched, 4);
  assert.equal(mean.rowsUnmatched, 2);
  assert.equal(mean.regionsMatched, 2);
  assert.deepEqual(mean.unmatchedValues, [{ value: "Dublin", rows: 2 }]);
  assert.equal(run("sum").values[0], 90);
  assert.equal(run("median").values[0], 20);
  assert.equal(run("min").values[0], 10);
  assert.equal(run("max").values[0], 60);
  assert.equal(run("count").values[1], 1, "a count counts rows, value or not");
});

test("by period, each region has a value per frame", () => {
  const day = 86_400_000;
  const out = aggregateRegions({
    regions: 2,
    ids: Uint32Array.of(0, 1, 2, 3),
    regionsOf: (row) => [row % 2],
    measure: Float64Array.of(1, 2, 3, 4),
    agg: "sum",
    times: Float64Array.of(0, 0, day, Number.NaN),
    grain: "day",
  });
  assert.equal(out.frames!.labels.length, 2);
  assert.deepEqual([...out.values], [1, 2, 3, Number.NaN]);
});

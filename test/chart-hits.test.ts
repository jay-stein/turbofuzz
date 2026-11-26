import { test } from "node:test";
import assert from "node:assert/strict";
import {
  barHitRegions,
  boxHitRegions,
  correlationHitRegions,
  heatmapHitRegions,
  hitTest,
  seriesHitRegions,
} from "../src/ui/chart-card.js";
import { nearestLineRegions } from "../src/ui/chart-hit-regions.js";
import type { CategoryBar } from "../src/ui/chart-utils.js";
import type { BoxGroupStats } from "../src/data/chart-stats.js";

const geom = { left: 70, top: 60, plotW: 500, plotH: 240 };

test("hitTest finds the region under the point and ignores misses", () => {
  const regions = seriesHitRegions(geom, {
    column: 0,
    bins: [10, 20],
    overflow: 0,
    min: 0,
    max: 100,
    dateAxis: false,
  });
  const first = hitTest(regions, 100, 100);
  assert.equal(first, regions[0]);
  assert.equal(hitTest(regions, 70 + 499, 100), regions[1]);
  assert.equal(hitTest(regions, 69, 100), null);
  assert.equal(hitTest(regions, 100, 301), null);
});

test("histogram bins expose their range and count and set a range filter", () => {
  const regions = seriesHitRegions(geom, {
    column: 3,
    bins: [4, 0, 9],
    overflow: 7,
    min: 0,
    max: 30,
    dateAxis: false,
  });
  assert.equal(regions.length, 4);
  assert.deepEqual(regions[0].lines, ["0 – 10", "4 rows"]);
  assert.deepEqual(regions[0].actions, [
    { kind: "range", column: 3, min: 0, max: 10 },
  ]);
  assert.deepEqual(regions[2].actions, [
    { kind: "range", column: 3, min: 20, max: 30 },
  ]);
  assert.deepEqual(regions[3].lines, ["> 30", "7 rows"]);
  assert.deepEqual(regions[3].actions, [
    { kind: "range", column: 3, min: 30, max: null },
  ]);
  const slot = geom.plotW / 4;
  assert.equal(regions[1].x, geom.left + slot);
  assert.equal(regions[1].w, slot);
  assert.equal(regions[1].h, geom.plotH);
});

test("time series slots label dates and filter a date range", () => {
  const start = Date.UTC(2024, 0, 1);
  const end = Date.UTC(2024, 3, 1);
  const regions = seriesHitRegions(geom, {
    column: 1,
    bins: [5, 6],
    overflow: 0,
    min: start,
    max: end,
    dateAxis: true,
  });
  assert.equal(regions.length, 2);
  assert.deepEqual(regions[0].lines, ["2024-01-01 – 2024-02-15", "5 rows"]);
  assert.deepEqual(regions[1].lines, ["2024-02-15 – 2024-04-01", "6 rows"]);
  assert.equal(regions[0].actions[0].kind, "range");
});

test("several lines in one period: the pointer gets the nearest line alone, with its colour and point", () => {
  const column = { x: 100, w: 20, top: 60, bottom: 300 };
  const regions = nearestLineRegions(column, [
    { y: 250, color: "#0a0", lines: ["NSW", "Rows: 3"], actions: [] },
    { y: 100, color: "#00a", lines: ["VIC", "Rows: 9"], actions: [] },
    { y: 140, color: "#a00", lines: ["QLD", "Rows: 7"], actions: [] },
  ]);
  const at = (y: number) => hitTest(regions, 110, y)?.lines[0];
  // Bands meet halfway between neighbouring lines, and the top and bottom lines reach the plot's edges.
  assert.equal(at(61), "VIC");
  assert.equal(at(119), "VIC");
  assert.equal(at(121), "QLD");
  assert.equal(at(194), "QLD");
  assert.equal(at(196), "NSW");
  assert.equal(at(299), "NSW");
  const nsw = regions.find((region) => region.lines[0] === "NSW")!;
  assert.equal(nsw.color, "#0a0");
  assert.deepEqual(nsw.point, { x: 110, y: 250 });
  assert.equal(hitTest(regions, 130, 200), null);
});

test("bar regions toggle their category and Other is hover-only", () => {
  const bars: CategoryBar[] = [
    { label: "Perth", count: 977, pct: 16.2 },
    { label: "Other", count: 120, pct: 2.0, other: true },
  ];
  const regions = barHitRegions(geom, bars, [4, -1], 2);
  assert.deepEqual(regions[0].lines, ["Perth", "977 rows · 16.2%"]);
  assert.deepEqual(regions[0].actions, [{ kind: "values", column: 2, code: 4 }]);
  assert.deepEqual(regions[1].actions, []);
  const slot = geom.plotW / 2;
  assert.equal(regions[1].x, geom.left + slot);
});

test("heatmap cells report both categories with count and percent", () => {
  const regions = heatmapHitRegions(geom, {
    xLabels: ["Perth", "Other"],
    yLabels: ["Widget A"],
    counts: [40, 10],
    total: 100,
    xColumn: 2,
    yColumn: 3,
    codeOfX: (label) => (label === "Other" ? -1 : 1),
    codeOfY: (label) => (label === "Widget A" ? 0 : -1),
  });
  assert.equal(regions.length, 2);
  assert.deepEqual(regions[0].lines, ["Perth × Widget A", "40 rows · 40.0%"]);
  assert.deepEqual(regions[0].actions, [
    { kind: "values", column: 2, code: 1 },
    { kind: "values", column: 3, code: 0 },
  ]);
  assert.deepEqual(regions[1].actions, [{ kind: "values", column: 3, code: 0 }]);
});

test("box regions carry the five-number summary and no filter", () => {
  const group: BoxGroupStats = {
    label: "Perth",
    count: 10,
    min: 1,
    q1: 3,
    median: 4,
    q3: 6,
    max: 9,
    whiskerLow: 1,
    whiskerHigh: 9,
    outliers: new Float64Array(0),
    outlierCount: 0,
    other: false,
  };
  const regions = boxHitRegions(geom, [group]);
  assert.deepEqual(regions[0].lines, [
    "Perth",
    "min 1",
    "q1 3",
    "median 4",
    "q3 6",
    "max 9",
    "10 values",
  ]);
  assert.deepEqual(regions[0].actions, []);
});

test("correlation cells report r and n, are hover-only, and cover each pair once", () => {
  const two = correlationHitRegions(geom, {
    labels: ["price", "qty"],
    values: Float64Array.from([1, 0.42, 0.42, 1]),
    counts: Uint32Array.from([5, 5, 5, 5]),
  });
  assert.equal(two.length, 1, "two columns are one pair, not four cells");
  assert.deepEqual(two[0].lines, ["qty × price", "r = 0.42", "n = 5"]);
  assert.deepEqual(two[0].actions, []);

  const three = correlationHitRegions(geom, {
    labels: ["a", "b", "c"],
    values: Float64Array.from([1, 0.1, 0.2, 0.1, 1, 0.3, 0.2, 0.3, 1]),
    counts: new Uint32Array(9).fill(7),
  });
  // n columns make n(n-1)/2 pairs, laid out as a staircase.
  assert.deepEqual(three.map((r) => r.lines[0]), ["b × a", "c × a", "c × b"]);
  assert.deepEqual(three.map((r) => r.lines[1]), ["r = 0.10", "r = 0.20", "r = 0.30"]);
  assert.ok(three[1].y === three[2].y, "row 2 holds c against a and b");
});

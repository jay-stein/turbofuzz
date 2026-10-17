import { test } from "node:test";
import assert from "node:assert/strict";
import { fitChartKind } from "../src/ui/chart-gallery.js";
import { mapBrushBounds, suggestCharts, zoomPlotBounds } from "../src/ui/chart-utils.js";
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

function num(name: string, min: number, max: number): ColumnMeta {
  return meta({ name, stats: { ...meta().stats, min, max, distinct: 60 } });
}

test("mapBrushBounds converts a rectangle to lon/lat bounds", () => {
  const frame = { left: 60, top: 40, plotW: 720, plotH: 360 };
  const whole = mapBrushBounds(frame, { x0: 60, y0: 40, x1: 780, y1: 400 });
  assert.deepEqual(whole, { lonMin: -180, lonMax: 180, latMin: -90, latMax: 90 });

  // The centre quarter: Europe-ish longitudes, northern latitudes.
  const quarter = mapBrushBounds(frame, { x0: 240, y0: 40, x1: 600, y1: 220 });
  assert.equal(quarter.lonMin, -90);
  assert.equal(quarter.lonMax, 90);
  assert.equal(quarter.latMin, 0);
  assert.equal(quarter.latMax, 90);

  // A drag that starts outside the plot clamps to the plot rectangle.
  const clamped = mapBrushBounds(frame, { x0: -500, y0: -500, x1: 100, y1: 100 });
  assert.equal(clamped.lonMin, -180);
  assert.equal(clamped.latMax, 90);
  assert.ok(clamped.lonMax < -150, "a small top-left rectangle is a small slice");
});

test("the gallery offers a map when coordinates are detected", () => {
  const columns = [
    num("pickup_latitude", -37.9, -37.7),
    num("pickup_longitude", 144.8, 145.1),
  ];
  const fit = fitChartKind("map", columns, 100);
  assert.equal(fit.ok, true);
  assert.equal(fit.preset.kind, "map");
  assert.equal(fit.preset.x, 1, "x is the longitude");
  assert.equal(fit.preset.y, 0, "y is the latitude");
  assert.match(fit.preset.suggested ?? "", /latitude\/longitude/);

  assert.equal(fitChartKind("map", [num("price", 1, 100)], 100).ok, false);

  const ideas = suggestCharts(columns, 100);
  assert.ok(
    ideas.some((idea) => idea.preset.kind === "map"),
    "the suggestion strip offers the map",
  );
});

test("zoomPlotBounds zooms around the pointer and honours minSpan", () => {
  const base = { xMin: 0, xMax: 100, yMin: 0, yMax: 50 };
  assert.deepEqual(zoomPlotBounds(base, { x: 0.5, y: 0.5 }, 0.5), {
    xMin: 25,
    xMax: 75,
    yMin: 12.5,
    yMax: 37.5,
  });
  assert.deepEqual(zoomPlotBounds(base, { x: 0, y: 1 }, 0.5), {
    xMin: 0,
    xMax: 50,
    yMin: 25,
    yMax: 50,
  });
  assert.deepEqual(zoomPlotBounds(base, { x: 0.5, y: 0.5 }, 3), {
    xMin: -100,
    xMax: 200,
    yMin: -50,
    yMax: 100,
  });
  const tiny = zoomPlotBounds(base, { x: 0.5, y: 0.5 }, 1e-7, 0.5);
  assert.equal(tiny.xMax - tiny.xMin, 0.5);
  assert.equal(tiny.yMax - tiny.yMin, 0.5);
});

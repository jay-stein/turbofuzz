import { test } from "node:test";
import assert from "node:assert/strict";
import { binValues } from "../src/data/chart-bins.js";
import {
  categorySeries,
  chartKindFor,
  correlationCell,
  defaultCardKind,
  defaultChartTitle,
  formatChartNumber,
  formatCount,
  formatTick,
  niceTicks,
  parseChartNumber,
  rampColor,
  suggestedBinRange,
} from "../src/ui/chart-utils.js";
import type { ColumnMeta } from "../src/worker/protocol.js";

function meta(overrides: Partial<ColumnMeta> = {}): ColumnMeta {
  return {
    name: "col",
    type: "string",
    numberLocale: "dot",
    dateOrder: "dmy",
    stats: {
      nulls: 0,
      distinct: 3,
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

test("chart kind follows the column type", () => {
  assert.equal(chartKindFor("number"), "histogram");
  assert.equal(chartKindFor("integer"), "histogram");
  assert.equal(chartKindFor("date"), "line");
  assert.equal(chartKindFor("category"), "bar");
  assert.equal(chartKindFor("boolean"), "bar");
  assert.equal(chartKindFor("string"), null);
  assert.equal(chartKindFor("identifier"), null);
});

test("new card kind prefers numeric, then dates, then categories", () => {
  assert.equal(defaultCardKind([meta({ type: "string" })]), "histogram");
  assert.equal(defaultCardKind([meta({ type: "date" })]), "line");
  assert.equal(defaultCardKind([meta({ type: "category" })]), "bar");
  assert.equal(
    defaultCardKind([meta({ type: "string" }), meta({ type: "number" }), meta({ type: "date" })]),
    "histogram",
  );
});

test("nice ticks cover the range with round steps", () => {
  assert.deepEqual(niceTicks(0, 100, 5), [0, 20, 40, 60, 80, 100]);
  assert.deepEqual(niceTicks(3, 97, 4), [20, 40, 60, 80]);
  const ticks = niceTicks(-12, 12, 6);
  assert.ok(ticks.length >= 4);
  assert.ok(ticks[0] >= -12 && ticks[ticks.length - 1] <= 12);
  assert.deepEqual(niceTicks(5, 5), [5]);
});

test("colour ramp interpolates between stops", () => {
  assert.equal(rampColor(0), "rgb(37, 99, 235)");
  assert.equal(rampColor(1), "rgb(239, 68, 68)");
  assert.match(rampColor(0.5), /^rgb\(\d+, \d+, \d+\)$/);
  assert.equal(rampColor(-5), "rgb(37, 99, 235)");
});

test("axis labels drop insignificant digits", () => {
  assert.equal(formatTick(50_000, "histogram"), "50k");
  assert.equal(formatTick(12_800, "histogram"), "12.8k");
  assert.equal(formatTick(1_500_000, "histogram"), "1.5M");
  assert.equal(formatCount(50_000), "50,000");
  assert.equal(formatCount(48780), "48,780");
});

test("correlation cells diverge around the neutral colour", () => {
  const neutral = correlationCell(0, "#eaeef2");
  assert.equal(neutral.bg, "rgb(234, 238, 242)");
  const positive = correlationCell(1, "#eaeef2");
  assert.match(positive.bg, /^rgb\(/);
  assert.equal(positive.fg, "#ffffff");
  const negative = correlationCell(-1, "#eaeef2");
  assert.notEqual(negative.bg, positive.bg);
  const undefinedCell = correlationCell(Number.NaN, "#eaeef2");
  assert.match(undefinedCell.bg, /^rgb\(/);
});

test("binValues splits the range and aggregates overflow", () => {
  const values = Float64Array.from([-5, 0, 10, 20, 30, 100]);
  const ids = Uint32Array.from([0, 1, 2, 3, 4, 5]);
  const withOverflow = binValues(values, ids, {
    min: 0,
    max: 40,
    binCount: 4,
    overflow: true,
  });
  assert.deepEqual(withOverflow.bins, [1, 1, 1, 1]);
  assert.equal(withOverflow.below, 1);
  assert.equal(withOverflow.overflow, 1);
  assert.equal(withOverflow.above, 0);
  assert.equal(withOverflow.total, 6);

  const withoutOverflow = binValues(values, ids, {
    min: 0,
    max: 40,
    binCount: 4,
    overflow: false,
  });
  assert.equal(withoutOverflow.overflow, 0);
  assert.equal(withoutOverflow.above, 1);
});

test("binValues respects the row subset (current filters)", () => {
  const values = Float64Array.from([1, 2, 3, 4]);
  const ids = Uint32Array.from([1, 3]);
  const out = binValues(values, ids, { min: 1, max: 4, binCount: 3, overflow: false });
  assert.equal(out.total, 2);
  assert.deepEqual(out.bins, [0, 1, 1]);
});

test("chart titles reference the data source and column", () => {
  assert.equal(defaultChartTitle("torture_utf8_bom.csv", "Amount"), "torture_utf8_bom — Amount");
  assert.equal(defaultChartTitle("Pasted data", "Score"), "Pasted data — Score");
  assert.equal(defaultChartTitle("", "Amount"), "Data — Amount");
  assert.equal(defaultChartTitle("data.csv", ""), "data");
});

test("bin bounds round-trip through comma-formatted inputs", () => {
  const formatted = formatChartNumber(19818400000);
  assert.ok(formatted.includes(","), `expected thousands separators in ${formatted}`);
  assert.equal(parseChartNumber(formatted), 19818400000);
  assert.equal(parseChartNumber(" 1 234.5 "), 1234.5);
  assert.equal(parseChartNumber(""), null);
  assert.equal(parseChartNumber("abc"), null);
});

test("suggested bin range clips extreme tails to p95 with overflow on", () => {
  const histogram = {
    bins: [1],
    min: 0,
    max: 100,
    symlog: false,
    below: 0,
    above: 0,
    p05: 5,
    p95: 5000,
  };
  const clipped = suggestedBinRange(
    meta({
      type: "number",
      stats: { ...meta().stats, min: 0, max: 19_818_400_000 },
      histogram,
    }),
  );
  assert.equal(clipped.max, 5000);
  assert.equal(clipped.overflow, true);
  assert.equal(clipped.clipped, true);

  const normal = suggestedBinRange(
    meta({
      type: "number",
      stats: { ...meta().stats, min: 0, max: 100 },
      histogram,
    }),
  );
  assert.equal(normal.max, 100);
  assert.equal(normal.overflow, false);
  assert.equal(normal.clipped, false);
});

test("constant columns get a padded bin range", () => {
  const range = suggestedBinRange(
    meta({ type: "number", stats: { ...meta().stats, min: 5, max: 5 }, histogram: null }),
  );
  assert.deepEqual(range, { min: 4, max: 6, overflow: false, clipped: false });
});

test("category series takes the top N and aggregates the rest as Other", () => {
  const labels = Array.from({ length: 8 }, (_, index) => `v${index}`);
  const counts = labels.map((_, index) => 80 - index * 10);
  const column = meta({ type: "category", categories: { labels, counts } });

  const series = categorySeries(column, undefined, 3, true);
  assert.equal(series.length, 4);
  assert.equal(series[0].label, "v0");
  assert.equal(series[0].count, 80);
  assert.equal(series[3].label, "Other");
  assert.equal(series[3].other, true);
  assert.equal(series[3].count, 50 + 40 + 30 + 20 + 10);
  const total = counts.reduce((sum, count) => sum + count, 0);
  assert.ok(Math.abs(series[3].pct - (150 / total) * 100) < 1e-9);

  const withoutOther = categorySeries(column, undefined, 3, false);
  assert.equal(withoutOther.length, 3);
  assert.ok(!withoutOther.some((bar) => bar.other === true));
});

test("category series uses filtered facet counts", () => {
  const labels = ["a", "b", "c"];
  const counts = [10, 20, 5];
  const column = meta({ type: "category", categories: { labels, counts } });

  const filtered = categorySeries(column, [0, 60, 0], 5, true);
  assert.equal(filtered[0].label, "b");
  assert.equal(filtered[0].count, 60);
  assert.ok(Math.abs(filtered[0].pct - 100) < 1e-9);
});

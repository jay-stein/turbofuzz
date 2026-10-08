import { test } from "node:test";
import assert from "node:assert/strict";
import { binValues } from "../src/data/chart-bins.js";
import { categorySeries, chartKindFor, defaultChartTitle } from "../src/ui/chart-panel.js";
import type { ColumnMeta } from "../src/worker/protocol.js";

function meta(overrides: Partial<ColumnMeta>): ColumnMeta {
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

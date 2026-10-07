import { test } from "node:test";
import assert from "node:assert/strict";
import { categoryBars, chartKindFor } from "../src/ui/chart-panel.js";
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

test("category bars use filtered counts, sorted and capped", () => {
  const labels = Array.from({ length: 15 }, (_, index) => `v${index}`);
  const counts = labels.map((_, index) => 100 - index);
  const column = meta({
    type: "category",
    categories: { labels, counts },
  });

  const unfiltered = categoryBars(column, undefined);
  assert.equal(unfiltered.length, 12);
  assert.equal(unfiltered[0].label, "v0");
  assert.equal(unfiltered[0].count, 100);

  const filteredCounts = counts.map((count, index) => (index === 1 ? 999 : count));
  const filtered = categoryBars(column, filteredCounts);
  assert.equal(filtered[0].label, "v1");
  assert.equal(filtered[0].count, 999);
});

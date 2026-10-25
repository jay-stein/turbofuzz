import { test } from "node:test";
import assert from "node:assert/strict";
import { fitChartKind, QUESTION_GROUPS } from "../src/ui/chart-gallery.js";
import type { ColumnMeta } from "../src/worker/protocol.js";

function meta(overrides: Partial<ColumnMeta> = {}): ColumnMeta {
  return {
    name: "col",
    type: "string",
    numberLocale: "dot",
    dateOrder: "dmy",
    stats: {
      nulls: 0,
      distinct: 5,
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

const columns: ColumnMeta[] = [
  meta({ name: "amount", type: "number" }),
  meta({ name: "city", type: "category" }),
  meta({ name: "region", type: "category" }),
  meta({ name: "when", type: "date" }),
  meta({ name: "score", type: "number" }),
  meta({ name: "bikeid", type: "number" }),
];

test("gallery tiles enable only when the columns fit", () => {
  assert.equal(fitChartKind("histogram", columns, 100).ok, true);
  assert.equal(fitChartKind("histogram", columns, 100).preset.column, 0);
  assert.equal(fitChartKind("line", columns, 100).ok, true);
  assert.equal(fitChartKind("line", columns, 100).preset.column, 3);
  assert.equal(fitChartKind("bar", columns, 100).preset.column, 1);
  const barplot = fitChartKind("barplot", columns, 100);
  assert.equal(barplot.ok, true);
  assert.equal(barplot.preset.column, 1);
  assert.ok((barplot.preset.valueColumn ?? -1) >= 0);
  assert.equal(fitChartKind("scatter", columns, 100).ok, true);
  assert.equal(fitChartKind("box", columns, 100).ok, true);
  assert.equal(fitChartKind("heatmap", columns, 100).ok, true);

  const pair = fitChartKind("correlation", columns, 100);
  assert.equal(pair.ok, true);
  assert.deepEqual(
    pair.preset.correlationColumns,
    [0, 4],
    "amount and score are real numerics; bikeid is ID-like and excluded",
  );
});

test("gallery tiles explain what a disabled chart needs", () => {
  const onlyText = [meta({ name: "notes", type: "string" })];
  assert.equal(fitChartKind("histogram", onlyText, 10).ok, false);
  assert.equal(fitChartKind("histogram", onlyText, 10).reason, "needs a numeric column");
  assert.equal(fitChartKind("line", onlyText, 10).reason, "needs a date or datetime column");
  assert.equal(fitChartKind("bar", onlyText, 10).reason, "needs a grouping column (few distinct values)");
  assert.equal(fitChartKind("heatmap", onlyText, 10).reason, "needs two grouping columns (few distinct values)");
  assert.equal(fitChartKind("correlation", onlyText, 10).reason, "needs two numeric columns");

  const oneCategory = [meta({ name: "city", type: "category" }), meta({ name: "n", type: "integer" })];
  assert.equal(fitChartKind("heatmap", oneCategory, 10).ok, false);
  assert.equal(fitChartKind("box", oneCategory, 10).ok, true);
});

test("the gallery groups every chart type by the question it answers", () => {
  const kinds = QUESTION_GROUPS.flatMap((group) => group.kinds);
  assert.deepEqual(
    [...kinds].sort(),
    [
      "bar",
      "barplot",
      "box",
      "bubble",
      "correlation",
      "density",
      "heatmap",
      "histogram",
      "kpi",
      "line",
      "map",
      "scatter",
      "terms",
      "treemap",
    ],
  );
});

test("unique numeric measures are chartable while named identifiers are not", () => {
  const unique = [
    meta({ name: "revenue", type: "number", stats: { ...meta().stats, distinct: 500 } }),
    meta({ name: "order_id", type: "integer", stats: { ...meta().stats, distinct: 500 } }),
  ];
  assert.equal(fitChartKind("histogram", unique, 500).ok, true);
  assert.equal(fitChartKind("histogram", unique, 500).preset.column, 0);
  assert.equal(fitChartKind("correlation", unique, 500).ok, false);
});
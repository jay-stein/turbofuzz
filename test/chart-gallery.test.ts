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
  assert.equal(fitChartKind("bar", onlyText, 10).reason, "needs a category column");
  assert.equal(fitChartKind("heatmap", onlyText, 10).reason, "needs two category columns");
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
      "box",
      "bubble",
      "correlation",
      "density",
      "heatmap",
      "histogram",
      "kpi",
      "line",
      "scatter",
      "terms",
      "treemap",
    ],
  );
});

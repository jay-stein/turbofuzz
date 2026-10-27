import { test } from "node:test";
import assert from "node:assert/strict";
import { aggFor, availability, fieldsFor, isAdditiveName, isRateName } from "../src/ui/chart-registry.js";
import type { ColumnMeta } from "../src/worker/protocol.js";

function meta(name: string, type: ColumnMeta["type"], distinct: number, grouped = false): ColumnMeta {
  const categories = grouped ? { labels: [], counts: [], other: 0 } : null;
  return {
    name,
    type,
    numberLocale: "dot",
    dateOrder: "dmy",
    stats: {
      nulls: 0,
      distinct,
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
    categories: categories as ColumnMeta["categories"],
    groups: categories as ColumnMeta["groups"],
    histogram: null,
    valueFence: null,
    lengthFence: null,
    nullPolicy: { extra: [], keep: [] },
    nullTokens: [],
    suggestions: [],
  };
}

// Dataset A: daily sales, 730 rows.
const A = [
  meta("date", "date", 730),
  meta("region", "category", 4, true),
  meta("product", "category", 5, true),
  meta("units", "integer", 120, true),
  meta("revenue", "number", 700),
  meta("discount_pct", "integer", 5, true),
];
const names = (indexes: { index: number }[], columns = A): string[] => indexes.map((e) => columns[e.index].name);

test("name hints match whole words only", () => {
  assert.equal(isRateName("duration"), false, "duration must not match ratio");
  assert.equal(isAdditiveName("discount"), false, "discount must not match count");
  assert.equal(isRateName("discount_pct"), true);
  assert.equal(isRateName("conversionRate"), true);
  assert.equal(aggFor("revenue"), "sum");
  assert.equal(aggFor("discount_pct"), "mean");
  assert.equal(aggFor("temperature"), "mean");
});

test("barplot Category suggests categories and lists measures under Other with a reason", () => {
  const f = fieldsFor("barplot", 0, A, 730);
  assert.deepEqual(names(f.suggested), ["region", "product", "discount_pct"]);
  assert.deepEqual(names(f.other), ["date", "units", "revenue"]);
  assert.match(f.other.find((e) => A[e.index].name === "units")?.reason ?? "", /too many groups/);
});

test("box Group by and heatmap follow the same rule", () => {
  assert.deepEqual(names(fieldsFor("box", 1, A, 730).suggested), ["region", "product", "discount_pct"]);
  assert.deepEqual(names(fieldsFor("heatmap", 0, A, 730).suggested), ["region", "product", "discount_pct"]);
  assert.deepEqual(names(fieldsFor("heatmap", 1, A, 730).suggested), ["region", "product", "discount_pct"]);
});

test("ID-like columns never suggest and say why", () => {
  const cols = [meta("customer_id", "integer", 730), meta("region", "category", 4, true)];
  const f = fieldsFor("barplot", 0, cols, 730);
  assert.deepEqual(names(f.suggested, cols), ["region"]);
  assert.equal(f.other[0].reason, "looks like an ID");
});

test("availability explains missing roles", () => {
  const onlyText = [meta("notes", "string", 50)];
  const a = availability(onlyText, 100);
  assert.equal(a.histogram.ok, false);
  assert.equal(a.line.reason, "needs time column");
  assert.equal(a.terms.ok, true);
  assert.equal(availability(A, 730).scatter.ok, true);
});

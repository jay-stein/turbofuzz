import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDataset } from "../src/data/build.js";
import { QueryEngine, type ColumnFilter } from "../src/search/query-engine.js";

const dataset = buildDataset(
  "test",
  ["name", "city", "usage", "status", "year"],
  [
    ["John Johnson", "Malvern", "5,000", "Active", "2023"],
    ["Jane Jonson", "North Malvern", "8,000", "Inactive", "2024"],
    ["Bob Smyth", "Footscray", "12,000", "Active", "2025"],
    ["Anne Smith", "Richmond", "3,000", "Active", "2022"],
  ],
);
const engine = new QueryEngine(dataset);

function evaluate(index: number, filter: ColumnFilter): number[] {
  return [...engine.evaluate(new Map([[index, filter]]))];
}

test("contains filter is case and accent insensitive", () => {
  assert.deepEqual(evaluate(0, { kind: "text", mode: "contains", query: "JONSON" }), [1]);
  assert.deepEqual(evaluate(1, { kind: "text", mode: "contains", query: "malvern" }), [0, 1]);
});

test("exact filter matches whole cell", () => {
  assert.deepEqual(evaluate(1, { kind: "text", mode: "exact", query: "Malvern" }), [0]);
});

test("fuzzy filter matches typos", () => {
  const hits = evaluate(0, { kind: "text", mode: "fuzzy", query: "jonson" });
  assert.ok(hits.includes(0));
  assert.ok(hits.includes(1));
  assert.ok(!hits.includes(2));
  assert.ok(!hits.includes(3));
});

test("numeric range filter", () => {
  assert.deepEqual(evaluate(2, { kind: "range", min: 3000, max: 8000 }), [0, 1, 3]);
  assert.deepEqual(evaluate(2, { kind: "range", min: 6000, max: null }), [1, 2]);
});

test("category value filter", () => {
  const categories = dataset.columns[3].categories();
  const activeIndex = categories.labels.indexOf("Active");
  assert.deepEqual(evaluate(3, { kind: "values", selected: [activeIndex] }), [0, 2, 3]);
});

test("combined filters intersect", () => {
  const filters = new Map<number, ColumnFilter>([
    [0, { kind: "text", mode: "fuzzy", query: "jonson" }],
    [2, { kind: "range", min: 6000, max: null }],
  ]);
  assert.deepEqual([...engine.evaluate(filters)], [1]);
});

test("fuzzy matches the ss spelling of ß", () => {
  const local = buildDataset("t", ["name"], [["Straße 12"], ["Other Place"]]);
  const localEngine = new QueryEngine(local);
  const hits = [
    ...localEngine.evaluate(new Map([[0, { kind: "text", mode: "fuzzy", query: "strasse" }]])),
  ];
  assert.ok(hits.includes(0), `expected Straße row in ${JSON.stringify(hits)}`);
});

test("empty query returns all rows", () => {
  const filters = new Map<number, ColumnFilter>([
    [0, { kind: "text", mode: "contains", query: "   " }],
  ]);
  assert.deepEqual([...engine.evaluate(filters)], [0, 1, 2, 3]);
});

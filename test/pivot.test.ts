import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDataset } from "../src/data/build.js";
import { computePivot, type PivotDef } from "../src/data/pivot.js";

const SALES = buildDataset("sales", ["region", "category", "amount"], [
  ["North", "A", "10"],
  ["North", "B", "5"],
  ["South", "A", "20"],
  ["South", "A", "10"],
  ["East", "B", "7"],
]);

const ids = Uint32Array.from({ length: SALES.rowCount }, (_, index) => index);

function pivot(overrides: Partial<PivotDef> = {}): PivotDef {
  return {
    id: "p1",
    name: "Sales pivot",
    index: [{ column: 0, by: "value" }],
    columns: [{ column: 1, by: "value" }],
    values: [{ column: 2, agg: "sum" }],
    respectFilters: true,
    margins: true,
    ...overrides,
  };
}

test("pivot assembles sorted cells and raw-row margins", () => {
  const result = computePivot(pivot(), SALES.columns, SALES.rowCount, ids);
  assert.deepEqual(result.rowLabels, [["East"], ["North"], ["South"], ["All"]]);
  assert.deepEqual(result.colLabels, [["A"], ["B"], ["All"]]);
  assert.deepEqual([...result.measures[0].values], [
    Number.NaN,
    7,
    7,
    10,
    5,
    15,
    30,
    Number.NaN,
    30,
    40,
    12,
    52,
  ]);
  assert.deepEqual([...result.measures[0].rowTotals], [7, 15, 30, 52]);
  assert.deepEqual([...result.measures[0].colTotals], [40, 12, 52]);
  assert.equal(result.measures[0].grandTotal, 52);
  assert.equal(result.rowNames[0], "region");
  assert.equal(result.colNames[0], "category");
  assert.equal(result.groupCount, 4);
});

test("pivot carries multiple values and aggregations independently", () => {
  const result = computePivot(
    pivot({
      values: [
        { column: null, agg: "count" },
        { column: 2, agg: "sum" },
        { column: 2, agg: "mean" },
      ],
      margins: false,
    }),
    SALES.columns,
    SALES.rowCount,
    ids,
  );
  assert.equal(result.measures.length, 3);
  assert.equal(result.measures[0].name, "count(*)");
  assert.deepEqual([...result.measures[0].values], [Number.NaN, 1, 1, 1, 2, Number.NaN]);
  assert.deepEqual([...result.measures[1].values], [
    Number.NaN,
    7,
    10,
    5,
    30,
    Number.NaN,
  ]);
  assert.deepEqual([...result.measures[2].values], [
    Number.NaN,
    7,
    10,
    5,
    15,
    Number.NaN,
  ]);
  assert.equal(result.rowLabels.length, 3);
  assert.equal(result.colLabels.length, 2);
});

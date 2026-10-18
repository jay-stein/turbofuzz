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

test("pivot key order can follow source order", () => {
  const result = computePivot(
    pivot({ sort: "source" }),
    SALES.columns,
    SALES.rowCount,
    ids,
  );
  assert.deepEqual(result.rowLabels, [["North"], ["South"], ["East"], ["All"]]);
  assert.deepEqual(result.colLabels, [["A"], ["B"], ["All"]]);
});

test("pivot margin labels are configurable", () => {
  const result = computePivot(
    pivot({ marginsName: "Total" }),
    SALES.columns,
    SALES.rowCount,
    ids,
  );
  assert.deepEqual(result.rowLabels.at(-1), ["Total"]);
  assert.deepEqual(result.colLabels.at(-1), ["Total"]);
});
test("pivot computes safe lambda values per group", () => {
  const result = computePivot(
    pivot({
      lambdas: [
        {
          column: 2,
          source: "lambda x: sum(x) / size(x)",
          label: "Average",
        },
      ],
      margins: false,
    }),
    SALES.columns,
    SALES.rowCount,
    ids,
  );
  assert.equal(result.measures.length, 2);
  assert.equal(result.measures[1].name, "Average");
  assert.deepEqual([...result.measures[1].values], [
    Number.NaN,
    7,
    10,
    5,
    15,
    Number.NaN,
  ]);
});
test("pivot value filters restrict raw rows and keep percentage totals", () => {
  const result = computePivot(
    pivot({
      margins: false,
      marginPct: "row",
      valueFilters: [{ column: 0, kind: "values", values: ["north"] }],
    }),
    SALES.columns,
    SALES.rowCount,
    ids,
  );
  assert.deepEqual(result.rowLabels, [["North"]]);
  assert.deepEqual([...result.measures[0].values], [10, 5]);
  assert.deepEqual([...result.measures[0].rowTotals], [15]);
  assert.deepEqual([...result.measures[0].colTotals], [10, 5]);
  assert.equal(result.groupCount, 2);
});
test("grand-total percentages keep raw totals available", () => {
  const result = computePivot(
    pivot({ margins: false, marginPct: "grand" }),
    SALES.columns,
    SALES.rowCount,
    ids,
  );
  assert.equal(result.measures[0]?.grandTotal, 52);
  assert.deepEqual([...result.measures[0]!.rowTotals], [7, 15, 30]);
});
test("pivot caps spread columns at 500 with a truncation flag", () => {
  const rows = Array.from({ length: 501 }, (_, index) => [`key-${index}`, "1"]);
  const wide = buildDataset("wide", ["key", "amount"], rows);
  const wideIds = Uint32Array.from({ length: wide.rowCount }, (_, index) => index);
  const result = computePivot(
    {
      id: "wide",
      name: "Wide pivot",
      index: [],
      columns: [{ column: 0, by: "value" }],
      values: [{ column: 1, agg: "sum" }],
      respectFilters: true,
    },
    wide.columns,
    wide.rowCount,
    wideIds,
  );
  assert.equal(result.columnLimit, 500);
  assert.equal(result.totalColumnCount, 501);
  assert.equal(result.truncatedColumns, true);
  assert.equal(result.colLabels.length, 500);
});
test("numeric pivot filters support comparison ranges and averages", () => {
  const greater = computePivot(
    pivot({
      margins: false,
      valueFilters: [{ column: 2, kind: "number", op: "gt", value: 12 }],
    }),
    SALES.columns,
    SALES.rowCount,
    ids,
  );
  assert.deepEqual(greater.rowLabels, [["South"]]);
  assert.deepEqual([...greater.measures[0]!.values], [20]);

  const range = computePivot(
    pivot({
      margins: false,
      valueFilters: [{ column: 2, kind: "number", op: "between", value: 7, value2: 10 }],
    }),
    SALES.columns,
    SALES.rowCount,
    ids,
  );
  assert.equal(
    [...range.measures[0]!.values].filter(Number.isFinite).reduce((sum, value) => sum + value, 0),
    27,
  );

  const above = computePivot(
    pivot({
      margins: false,
      valueFilters: [{ column: 2, kind: "number", op: "aboveAvg" }],
    }),
    SALES.columns,
    SALES.rowCount,
    ids,
  );
  assert.deepEqual(above.rowLabels, [["South"]]);
});

test("date and text pivot filters match the requested day and text", () => {
  const dated = buildDataset("dated", ["when", "amount"], [
    ["2024-01-01", "1"],
    ["2024-02-15", "2"],
    ["2024-03-01", "3"],
  ]);
  const datedIds = Uint32Array.from({ length: dated.rowCount }, (_, index) => index);
  const before = computePivot(
    {
      id: "dated",
      name: "Dated",
      index: [{ column: 0, by: "value" }],
      columns: [],
      values: [{ column: 1, agg: "sum" }],
      respectFilters: true,
      valueFilters: [
        { column: 0, kind: "date", op: "before", value: Date.UTC(2024, 1, 1) },
      ],
    },
    dated.columns,
    dated.rowCount,
    datedIds,
  );
  assert.deepEqual(before.rowLabels, [["2024-01-01"]]);

  const text = computePivot(
    pivot({
      margins: false,
      valueFilters: [
        { column: 0, kind: "text", op: "contains", value: "sou" },
      ],
    }),
    SALES.columns,
    SALES.rowCount,
    ids,
  );
  assert.deepEqual(text.rowLabels, [["South"]]);
});
test("category filters can exclude selected values", () => {
  const result = computePivot(
    pivot({
      margins: false,
      valueFilters: [
        { column: 0, kind: "values", values: ["north"], negate: true },
      ],
    }),
    SALES.columns,
    SALES.rowCount,
    ids,
  );
  assert.deepEqual(result.rowLabels, [["East"], ["South"]]);
});
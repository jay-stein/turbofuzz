import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDataset } from "../src/data/build.js";
import type { ViewDef } from "../src/data/aggregate.js";
import { computePivot } from "../src/data/pivot.js";
import { computeAggregate } from "../src/data/aggregate.js";
import { defaultPivotShape, fitPivotShape, measuresToSeries, pivotChartDef, pivotToAggregate } from "../src/data/pivot-chart.js";

const DATA = buildDataset("sales", ["region", "product", "month", "amount"], [
  ["North", "Tea", "2024-01-05", "10"],
  ["North", "Coffee", "2024-01-09", "30"],
  ["South", "Tea", "2024-01-15", "1"],
  ["South", "Coffee", "2024-02-02", "3"],
  ["North", "Tea", "2024-02-11", "20"],
  ["South", "Tea", "2024-02-20", "5"],
]);
const ids = Uint32Array.from({ length: DATA.rowCount }, (_, i) => i);

function view(overrides: Partial<ViewDef> = {}): ViewDef {
  return {
    id: "v1",
    name: "Sales",
    dimensions: [
      { column: 0, by: "value" },
      { column: 1, by: "value" },
    ],
    measures: [{ column: 3, agg: "sum" }],
    fill: "none",
    sort: { key: "m0", dir: "desc" },
    limit: 500,
    respectFilters: true,
    pivotColumns: [1],
    ...overrides,
  };
}

function chart(def: ViewDef, shape = defaultPivotShape(def)) {
  const pivot = pivotChartDef(def, shape);
  assert.ok(pivot !== null);
  return pivotToAggregate(computePivot(pivot, DATA.columns, DATA.rowCount, ids));
}

test("rows go on the axis and columns become the series, one entry per pivot cell", () => {
  const def = view();
  assert.deepEqual(defaultPivotShape(def), { axis: 0, series: 1, measure: 0 });
  const result = chart(def);
  assert.deepEqual(result.dimensionNames, ["region", "product"]);
  const cells = Object.fromEntries(result.labels.map((label, i) => [label, result.measures[0][i]]));
  assert.deepEqual(cells, { "North · Coffee": 30, "North · Tea": 30, "South · Coffee": 3, "South · Tea": 6 });
  // The biggest region first: a category axis is ranked, not alphabetical.
  assert.equal(result.dimensions[0][0], "North");
});

test("with no column field a second row field is the series; a lone row field is one series", () => {
  assert.deepEqual(defaultPivotShape(view({ pivotColumns: [] })), { axis: 0, series: 1, measure: 0 });
  const single = view({ pivotColumns: [], dimensions: [{ column: 0, by: "value" }] });
  assert.deepEqual(defaultPivotShape(single), { axis: 0, series: -1, measure: 0 });
  const result = chart(single);
  assert.deepEqual(result.dimensions.length, 1);
  assert.deepEqual([...result.measures[0]], [60, 9]);
  assert.deepEqual(result.labels, ["North", "South"]);
});

test("a field the chart leaves out is collapsed from the rows, so an average stays an average", () => {
  const def = view({
    dimensions: [
      { column: 0, by: "value" },
      { column: 1, by: "value" },
      { column: 2, by: { time: "month" } },
    ],
    measures: [{ column: 3, agg: "mean" }],
    pivotColumns: [2],
  });
  // Axis region, series month: product is left out.
  const result = chart(def, { axis: 0, series: 2, measure: 0 });
  const cells = Object.fromEntries(result.labels.map((label, i) => [label, result.measures[0][i]]));
  assert.equal(cells["North · 2024-01"], 20, "mean of 10 and 30, not a mean of product means");
  assert.equal(cells["South · 2024-02"], 4);
});

test("a date on the axis stays in date order and carries its times", () => {
  const def = view({ dimensions: [{ column: 2, by: { time: "month" } }, { column: 0, by: "value" }], pivotColumns: [1] });
  const result = chart(def);
  assert.deepEqual(result.dimensionIsTime, [true, false]);
  assert.deepEqual([...new Set(result.dimensions[0])], ["2024-01", "2024-02"]);
  assert.ok(Number.isFinite(result.dimensionTimes[0][0]));
});

test("the pivot's own filters apply to its chart", () => {
  const def = view({ pivotValueFilters: [{ column: 1, kind: "values", values: ["Tea"] }] });
  const result = chart(def, { axis: 0, series: -1, measure: 0 });
  assert.deepEqual(Object.fromEntries(result.labels.map((label, i) => [label, result.measures[0][i]])), { North: 30, South: 6 });
});

test("a saved shape is refitted when the pivot loses the field it used", () => {
  const def = view({ dimensions: [{ column: 0, by: "value" }], pivotColumns: [] });
  assert.deepEqual(fitPivotShape(def, { axis: 0, series: 1, measure: 3 }), { axis: 0, series: -1, measure: 0 });
  assert.deepEqual(fitPivotShape(view(), { axis: 1, series: 1, measure: 0 }), { axis: 1, series: -1, measure: 0 });
});

test("several measures over one axis become one series each, in step along the axis", () => {
  const result = computeAggregate(
    {
      id: "v",
      name: "v",
      dimensions: [{ column: 2, by: { time: "month" } }],
      measures: [
        { column: 3, agg: "sum" },
        { column: 3, agg: "max" },
      ],
      fill: "none",
      sort: { key: "dim0", dir: "asc" },
      limit: 500,
      respectFilters: true,
    },
    DATA.columns,
    DATA.rowCount,
    ids,
  );
  const long = measuresToSeries(result, ["total", "largest"]);
  assert.deepEqual(long.dimensions, [
    ["2024-01", "2024-01", "2024-02", "2024-02"],
    ["total", "largest", "total", "largest"],
  ]);
  assert.deepEqual([...long.measures[0]], [41, 30, 28, 20]);
  assert.deepEqual(long.dimensionIsTime, [true, false]);
  assert.equal(long.dimensionTimes[0][0], long.dimensionTimes[0][1], "both series share the period's time");
  assert.equal(long.groupCount, 4);
});

test("a hand-set order carries over: rows along the axis, series in the legend", () => {
  const v = view({ pivotColumns: [1] });
  const def = pivotChartDef(v, { axis: 0, series: 1, measure: 0 })!;
  const pivot = computePivot(def, DATA.columns, DATA.rowCount, ids);
  const plain = pivotToAggregate(pivot);
  assert.deepEqual([...new Set(plain.dimensions[0])], ["North", "South"], "by size without an order");
  const ordered = pivotToAggregate(pivot, { rows: ["South", "North"], cols: ["Tea", "Coffee"] });
  assert.deepEqual([...new Set(ordered.dimensions[0])], ["South", "North"]);
  assert.deepEqual([...new Set(ordered.dimensions[1])], ["Tea", "Coffee"]);
  const byLabel = pivotToAggregate(pivot);
  assert.deepEqual([...new Set(byLabel.dimensions[1])], ["Coffee", "Tea"], "series in the pivot's column order");
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { ColumnData } from "../src/data/column.js";
import { keepRows } from "../src/data/chart-exclusions.js";
import { sliceBreakdown } from "../src/data/slice-breakdown.js";

// region, sales, day (12 rows): East has sales 10,20,30,40; West 1,2,3,4; North 100,200,300,400.
const region = ["East", "East", "East", "East", "West", "West", "West", "West", "North", "North", "North", "North"];
const sales = ["10", "20", "30", "40", "1", "2", "3", "4", "100", "200", "300", "400"];
const day = Array.from({ length: 12 }, (_, i) => `2024-01-${String(i + 1).padStart(2, "0")}`);
const columns = [ColumnData.create("region", region), ColumnData.create("sales", sales), ColumnData.create("day", day)];
const all = Uint32Array.from({ length: 12 }, (_, i) => i);

test("an inverted exclusion keeps only the matching slice", () => {
  const east = keepRows(all, [{ kind: "values", column: 0, labels: ["East"], invert: true }], columns);
  assert.deepEqual(Array.from(east), [0, 1, 2, 3]);
  const mid = keepRows(all, [{ kind: "range", column: 1, min: 3, max: 30, invert: true }], columns);
  assert.deepEqual(Array.from(mid), [0, 1, 2, 6, 7]);
  // Every entry must match, so two slices narrow to their intersection.
  const both = keepRows(
    all,
    [
      { kind: "values", column: 0, labels: ["East", "West"], invert: true },
      { kind: "range", column: 1, min: 20, max: null, invert: true },
    ],
    columns,
  );
  assert.deepEqual(Array.from(both), [1, 2, 3]);
  // An unknown label keeps nothing rather than everything.
  assert.deepEqual(Array.from(keepRows(all, [{ kind: "values", column: 0, labels: ["Nope"], invert: true }], columns)), []);
});

test("rows missing the sliced value are not in a range slice", () => {
  const withGap = [ColumnData.create("v", ["1", "", "3", "x"])];
  const kept = keepRows(Uint32Array.from([0, 1, 2, 3]), [{ kind: "range", column: 0, min: 0, max: 10, invert: true }], withGap);
  assert.deepEqual(Array.from(kept), [0, 2]);
});

test("breakdown counts rows per category mark", () => {
  const regionCols = columns[0]!;
  const labels = regionCols.categories().labels;
  const regions = labels.map((_, code) => ({ kind: "values" as const, code }));
  const east = keepRows(all, [{ kind: "values", column: 0, labels: ["East"], invert: true }], columns);
  const out = sliceBreakdown(east, regionCols, regions, null, 12);
  assert.equal(out[labels.indexOf("East")], 4);
  assert.equal(out[labels.indexOf("West")], 0);
});

test("breakdown puts the slice's rows into numeric bins without double counting an edge", () => {
  const salesCol = columns[1]!;
  const bins = [
    { kind: "range" as const, min: 0, max: 10 },
    { kind: "range" as const, min: 10, max: 100 },
    { kind: "range" as const, min: 100, max: null },
  ];
  // East has 10 (an edge), 20, 30, 40: the 10 belongs to the first bin only.
  const east = keepRows(all, [{ kind: "values", column: 0, labels: ["East"], invert: true }], columns);
  assert.deepEqual(Array.from(sliceBreakdown(east, salesCol, bins, null, 12)), [1, 3, 0]);
  // Everyone: 1,2,3,4 and 10 in the first bin; 20,30,40,100 in the second (100 is the edge); 200,300,400 beyond.
  assert.deepEqual(Array.from(sliceBreakdown(all, salesCol, bins, null, 12)), [5, 4, 3]);
});

test("breakdown aggregates a measure per time period", () => {
  const dayCol = columns[2]!;
  const t = (d: number): number => Date.UTC(2024, 0, d);
  const weeks = [
    { kind: "range" as const, min: t(1), max: t(5) - 1 },
    { kind: "range" as const, min: t(5), max: t(9) - 1 },
    { kind: "range" as const, min: t(9), max: t(13) - 1 },
  ];
  const sales = columns[1]!.numbers();
  assert.deepEqual(Array.from(sliceBreakdown(all, dayCol, weeks, { values: sales, agg: "sum" }, 12)), [100, 10, 1000]);
  assert.deepEqual(Array.from(sliceBreakdown(all, dayCol, weeks, { values: sales, agg: "max" }, 12)), [40, 4, 400]);
  const east = keepRows(all, [{ kind: "values", column: 0, labels: ["East"], invert: true }], columns);
  const mean = sliceBreakdown(east, dayCol, weeks, { values: sales, agg: "mean" }, 12);
  assert.equal(mean[0], 25);
  assert.ok(Number.isNaN(mean[1]), "no East rows in the second period");
  assert.ok(Number.isNaN(sliceBreakdown(east, dayCol, [null], null, 12)[0]!), "marks that are not slices stay NaN");
});

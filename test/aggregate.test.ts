import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDataset } from "../src/data/build.js";
import {
  compileExpression,
  computeAggregate,
  datePartLabel,
  isoWeek,
  timeBucket,
  timeLabel,
  type ViewDef,
} from "../src/data/aggregate.js";

function view(overrides: Partial<ViewDef> = {}): ViewDef {
  return {
    id: "v1",
    name: "View 1",
    dimensions: [{ column: 0, by: "value" }],
    measures: [{ column: null, agg: "count" }],
    fill: "none",
    sort: { key: "m0", dir: "desc" },
    limit: 500,
    respectFilters: true,
    ...overrides,
  };
}

const SALES = buildDataset("sales", ["region", "amount"], [
  ["North", "10"],
  ["South", "5"],
  ["North", "30"],
  ["North", ""],
  ["South", "5"],
  ["East", "20"],
]);

const allIds = (count: number): Uint32Array =>
  Uint32Array.from({ length: count }, (_, index) => index);

test("count, sum and mean group by a value dimension", () => {
  const result = computeAggregate(
    view({
      measures: [
        { column: null, agg: "count" },
        { column: 1, agg: "sum" },
        { column: 1, agg: "mean" },
      ],
    }),
    SALES.columns,
    SALES.rowCount,
    allIds(SALES.rowCount),
  );
  assert.deepEqual(result.labels, ["North", "South", "East"]);
  assert.equal(result.dimensions[0][0], "North");
  assert.deepEqual([...result.measures[0]], [3, 2, 1]);
  assert.deepEqual([...result.measures[1]], [40, 10, 20]);
  assert.deepEqual([...result.measures[2]], [20, 5, 20]);
  // Totals come from rows: 6 rows, 70, and the mean of all present values.
  assert.equal(result.totals[0], 6);
  assert.equal(result.totals[1], 70);
  assert.ok(Math.abs(result.totals[2] - 70 / 5) < 1e-9);
});

test("distinct counts non-missing values per group", () => {
  const result = computeAggregate(
    view({
      dimensions: [{ column: 0, by: "value" }],
      measures: [{ column: 1, agg: "distinct" }],
    }),
    SALES.columns,
    SALES.rowCount,
    allIds(SALES.rowCount),
  );
  const byLabel = new Map(result.labels.map((label, index) => [label, index]));
  assert.equal(result.measures[0][byLabel.get("North") ?? 0], 2);
  assert.equal(result.measures[0][byLabel.get("South") ?? 0], 1);
});

test("time dimensions bucket to the calendar month and fill gaps as zero", () => {
  const dates = buildDataset("trips", ["day", "trips"], [
    ["2024-01-05", "3"],
    ["2024-01-20", "4"],
    ["2024-03-02", "5"],
  ]);
  const result = computeAggregate(
    view({
      dimensions: [{ column: 0, by: { time: "month" } }],
      measures: [{ column: null, agg: "count" }, { column: 1, agg: "sum" }],
      fill: "zero",
      sort: { key: "dim0", dir: "asc" },
    }),
    dates.columns,
    dates.rowCount,
    allIds(dates.rowCount),
  );
  assert.deepEqual(result.labels, ["2024-01", "2024-02", "2024-03"]);
  assert.deepEqual([...result.measures[0]], [2, 0, 1]);
  assert.deepEqual([...result.measures[1]], [7, 0, 5]);
});

test("date parts label and order the output", () => {
  const dates = buildDataset("trips", ["day"], [
    ["2024-01-01"], // Monday
    ["2024-01-03"], // Wednesday
    ["2024-01-07"], // Sunday
  ]);
  const result = computeAggregate(
    view({
      dimensions: [{ column: 0, by: { datePart: "dow" } }],
      sort: { key: "dim0", dir: "asc" },
    }),
    dates.columns,
    dates.rowCount,
    allIds(dates.rowCount),
  );
  assert.deepEqual(result.labels, ["Mon", "Wed", "Sun"]);
});

test("post-aggregation ops run on the ordered output", () => {
  const result = computeAggregate(
    view({
      measures: [
        { column: null, agg: "count", post: [{ op: "cumulative" }] },
        { column: null, agg: "count", post: [{ op: "pctTotal" }] },
        { column: null, agg: "count", post: [{ op: "rank" }] },
      ],
    }),
    SALES.columns,
    SALES.rowCount,
    allIds(SALES.rowCount),
  );
  assert.deepEqual([...result.measures[0]], [3, 5, 6]);
  assert.ok(Math.abs(result.measures[1][1] - 2 / 6) < 1e-9);
  assert.deepEqual([...result.measures[2]], [1, 2, 3]);
});

test("rolling mean and % change treat gaps as zero values", () => {
  const dates = buildDataset("sales", ["month", "value"], [
    ["2024-01-01", "10"],
    ["2024-03-01", "30"],
  ]);
  const result = computeAggregate(
    view({
      dimensions: [{ column: 0, by: { time: "month" } }],
      measures: [
        { column: 1, agg: "sum", post: [{ op: "rolling", window: 2 }] },
        { column: 1, agg: "sum", post: [{ op: "pctChange" }] },
      ],
      fill: "zero",
      sort: { key: "dim0", dir: "asc" },
    }),
    dates.columns,
    dates.rowCount,
    allIds(dates.rowCount),
  );
  assert.deepEqual(result.labels, ["2024-01", "2024-02", "2024-03"]);
  assert.deepEqual([...result.measures[0]], [10, 5, 15]);
  assert.ok(Number.isNaN(result.measures[1][0]));
  assert.equal(result.measures[1][1], -1);
  assert.ok(Number.isNaN(result.measures[1][2]), "a change from zero is undefined");
});

test("two dimensions join their labels and truncation is reported", () => {
  const ds = buildDataset("t", ["a", "b", "n"], [
    ["x", "1", "10"],
    ["x", "2", "20"],
    ["y", "1", "30"],
  ]);
  const result = computeAggregate(
    view({
      dimensions: [
        { column: 0, by: "value" },
        { column: 1, by: "value" },
      ],
      measures: [{ column: 2, agg: "sum" }],
      sort: { key: "m0", dir: "desc" },
      limit: 2,
    }),
    ds.columns,
    ds.rowCount,
    allIds(ds.rowCount),
  );
  assert.deepEqual(result.labels, ["y · 1", "x · 2"]);
  assert.deepEqual(result.dimensions[0], ["y", "x"]);
  assert.equal(result.groupCount, 2);
  assert.equal(result.totalGroups, 3);
  assert.equal(result.truncated, true);
  assert.equal(result.totals[0], 60);
});

test("time helpers handle weeks and labels", () => {
  const monday = Date.UTC(2024, 0, 1);
  assert.equal(timeBucket(monday, "week", 1), monday);
  assert.equal(timeLabel(timeBucket(Date.UTC(2024, 0, 3), "week", 1), "week"), "2024-01-01");
  assert.equal(datePartLabel(Date.UTC(2024, 0, 1), "dow"), "Mon");
  assert.equal(datePartLabel(Date.UTC(2024, 0, 1), "dom"), "01");
  assert.equal(datePartLabel(Date.UTC(2024, 0, 1), "month"), "Jan");
  assert.equal(isoWeek(Date.UTC(2024, 0, 1)), 1);
  assert.equal(timeLabel(Date.UTC(2024, 4, 15, 13, 30), "hour"), "2024-05-15 13:00");
});

test("expression measures combine aggregates into ratios", () => {
  const result = computeAggregate(
    view({
      measures: [
        { column: null, agg: "expr", expr: "sum(amount) / count(*)" },
        { column: null, agg: "expr", expr: "sum(amount) / distinct(region)" },
        { column: null, agg: "expr", expr: "p90(amount)" },
      ],
    }),
    SALES.columns,
    SALES.rowCount,
    allIds(SALES.rowCount),
  );
  assert.deepEqual(result.labels, ["East", "North", "South"]);
  assert.equal(result.measures[0][0], 20);
  assert.ok(Math.abs(result.measures[0][1] - 40 / 3) < 1e-9);
  assert.equal(result.measures[0][2], 5);
  assert.ok(Math.abs(result.totals[0] - 70 / 6) < 1e-9);
  // distinct(region) is 1 within a group, 3 overall.
  assert.equal(result.measures[1][1], 40);
  assert.ok(Math.abs(result.totals[1] - 70 / 3) < 1e-9);
  assert.equal(result.totals[2], 26, "p90 of 5,5,10,20,30 is 26");
});

test("compileExpression validates functions, columns and syntax", () => {
  const names = ["amount", "cost", "customer name"];
  const ok = compileExpression("(sum(amount) - sum(cost)) / sum(amount)", names);
  assert.equal(ok.ok, true);
  const folded = compileExpression("mean(customer NAME)", names);
  assert.equal(folded.ok, true);
  assert.equal(compileExpression("sum(missing)", names).ok, false);
  assert.equal(compileExpression("frobnicate(amount)", names).ok, false);
  assert.equal(compileExpression("sum(amount", names).ok, false);
  assert.equal(compileExpression("sum(*)", names).ok, false);
  assert.equal(compileExpression("", names).ok, false);
  assert.equal(compileExpression("1 + 2", names).ok, false, "needs at least one aggregate");
  const countAll = compileExpression("count(*)", names);
  assert.equal(countAll.ok, true);
  if (countAll.ok) assert.deepEqual(countAll.compiled.terms, [{ agg: "count", column: null, text: "count(*)" }]);
});

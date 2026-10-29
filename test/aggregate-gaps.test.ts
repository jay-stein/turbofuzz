import { test } from "node:test";
import assert from "node:assert/strict";
import { ColumnData } from "../src/data/column.js";
import { computeAggregate, type ViewDef } from "../src/data/aggregate.js";

// Three days with data, two empty days between the last two.
const dates = ["2024-01-01", "2024-01-02", "2024-01-05"];
const points = ["10", "20", "30"];
const columns = [ColumnData.create("day", dates), ColumnData.create("points", points)];

const view = (fill: ViewDef["fill"], showGaps = false, agg: "mean" | "sum" = "mean"): ViewDef => ({
  id: "v",
  name: "v",
  dimensions: [{ column: 0, by: { time: "day" } }],
  measures: [{ column: 1, agg }],
  fill,
  ...(showGaps ? { showGaps } : {}),
  sort: { key: "dim0", dir: "asc" },
  limit: 100,
  respectFilters: false,
});

test("empty days are dropped by default, zero-filled on request, and shown as gaps (NaN) with showGaps", () => {
  const ids = Uint32Array.from([0, 1, 2]);
  const dropped = computeAggregate(view("none"), columns, 3, ids);
  assert.equal(dropped.groupCount, 3);
  const zero = computeAggregate(view("zero", false, "sum"), columns, 3, ids);
  assert.equal(zero.groupCount, 5);
  assert.deepEqual(Array.from(zero.measures[0]), [10, 20, 0, 0, 30]);
  const gaps = computeAggregate(view("none", true), columns, 3, ids);
  assert.equal(gaps.groupCount, 5);
  assert.equal(Number.isNaN(gaps.measures[0][2]), true);
  assert.equal(Number.isNaN(gaps.measures[0][3]), true);
  assert.equal(gaps.measures[0][4], 30);
});

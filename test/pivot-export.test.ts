import { test } from "node:test";
import assert from "node:assert/strict";
import type { PivotMessage } from "../src/worker/protocol.js";
import { pivotCsvRows } from "../src/ui/pivot-export.js";

function pivot(): PivotMessage {
  return {
    type: "pivot",
    requestId: 1,
    pivotId: "p1",
    rowLabels: [["=North"], ["South"]],
    colLabels: [["A"], ["B"]],
    rowNames: ["region"],
    colNames: ["category"],
    rowIsTime: [false],
    colIsTime: [false],
    rowTimes: [Float64Array.from([Number.NaN, Number.NaN])],
    colTimes: [Float64Array.from([Number.NaN, Number.NaN])],
    measures: [
      {
        name: "sum(amount)",
        values: Float64Array.from([10, 5, 20, 7]),
        rowTotals: Float64Array.from([15, 27]),
        colTotals: Float64Array.from([30, 12]),
        grandTotal: 42,
      },
      {
        name: "count(*)",
        values: Float64Array.from([1, 1, 2, 1]),
        rowTotals: Float64Array.from([2, 3]),
        colTotals: Float64Array.from([3, 2]),
        grandTotal: 5,
      },
    ],
    groupCount: 4,
    totalGroups: 4,
    truncated: false,
    ms: 1,
  };
}

test("flat pivot CSV repeats the measure in every column header", () => {
  const result = pivotCsvRows(pivot(), { headers: "flat", formulaSafe: true });
  assert.equal(result.tooLarge, false);
  assert.deepEqual(result.rows[0], [
    "region",
    "sum(amount) / A",
    "sum(amount) / B",
    "count(*) / A",
    "count(*) / B",
  ]);
  assert.equal(result.rows[1]?.[0], "'=North");
  assert.deepEqual(result.rows[1], ["'=North", "10", "5", "1", "1"]);
});

test("multi-row pivot CSV emits a measure row and column-level rows", () => {
  const result = pivotCsvRows(pivot(), { headers: "multi", formulaSafe: false });
  assert.deepEqual(result.rows[0], [
    "",
    "sum(amount)",
    "sum(amount)",
    "count(*)",
    "count(*)",
  ]);
  assert.deepEqual(result.rows[1], ["", "A", "B", "A", "B"]);
  assert.deepEqual(result.rows[2], ["=North", "10", "5", "1", "1"]);
});

test("pivot CSV refuses outputs above the cell cap", () => {
  const result = pivotCsvRows(pivot(), {
    headers: "flat",
    formulaSafe: true,
    cellCap: 4,
  });
  assert.equal(result.tooLarge, true);
  assert.deepEqual(result.rows, []);
});

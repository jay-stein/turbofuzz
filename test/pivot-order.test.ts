import assert from "node:assert/strict";
import test from "node:test";
import { moveBlock, orderKey, orderedIndexes, reorderGroups, reorderPivot } from "../src/data/pivot-order.js";
import type { PivotResult } from "../src/data/pivot.js";

const key = (...parts: string[]): string => orderKey(parts);

function pivot(): PivotResult {
  return {
    rowLabels: [["a"], ["b"], ["All"]],
    colLabels: [["x"], ["y"], ["All"]],
    rowNames: ["r"],
    colNames: ["c"],
    rowIsTime: [false],
    colIsTime: [false],
    rowTimes: [Float64Array.of(NaN, NaN, NaN)],
    colTimes: [Float64Array.of(1, 2, NaN)],
    measures: [{
      name: "n",
      values: Float64Array.of(1, 2, 3, 4, 5, 9, 5, 7, 12),
      rowTotals: Float64Array.of(3, 9, 12),
      colTotals: Float64Array.of(5, 7, 12),
      grandTotal: 12,
    }],
    groupCount: 4,
    totalGroups: 4,
    truncated: false,
    ms: 0,
  };
}

test("an order keeps values it does not know after the ones it does, and margins last", () => {
  assert.deepEqual(orderedIndexes(["a", "b", "c", "All"], ["c", "gone", "a"], 1), [2, 0, 1, 3]);
  assert.deepEqual(orderedIndexes(["a", "b"], undefined), [0, 1]);
});

test("moving a block places it before or after the target, as a whole, inside its parent", () => {
  const flat = [["a"], ["b"], ["c"], ["d"]];
  assert.deepEqual(moveBlock(flat, 0, 0, 2, true), ["b", "c", "a", "d"]);
  assert.deepEqual(moveBlock(flat, 0, 3, 1, false), ["a", "d", "b", "c"]);
  assert.equal(moveBlock(flat, 0, 0, 1, false), null, "already there");
  assert.equal(moveBlock(flat, 0, 0, 3, true, 1), null, "a margin is not a target");

  const nested = [["n", "1"], ["n", "2"], ["s", "1"], ["s", "2"]];
  assert.deepEqual(moveBlock(nested, 0, 2, 0, false), [key("s", "1"), key("s", "2"), key("n", "1"), key("n", "2")], "a parent brings its children");
  assert.deepEqual(moveBlock(nested, 1, 1, 0, false), [key("n", "2"), key("n", "1"), key("s", "1"), key("s", "2")]);
  assert.equal(moveBlock(nested, 1, 1, 2, false), null, "a child stays inside its parent");
});

test("reordering a pivot moves its cells, totals and times with the labels, and leaves margins last", () => {
  const out = reorderPivot(pivot(), ["b", "a"], ["y", "x"], 1, 1);
  assert.deepEqual(out.rowLabels, [["b"], ["a"], ["All"]]);
  assert.deepEqual(out.colLabels, [["y"], ["x"], ["All"]]);
  assert.deepEqual([...out.measures[0]!.values], [5, 4, 9, 2, 1, 3, 7, 5, 12]);
  assert.deepEqual([...out.measures[0]!.rowTotals], [9, 3, 12]);
  assert.deepEqual([...out.measures[0]!.colTotals], [7, 5, 12]);
  assert.deepEqual([...out.colTimes[0]!].slice(0, 2), [2, 1]);
  const same = pivot();
  assert.equal(reorderPivot(same, undefined, undefined), same);
});

test("reordering grouped rows moves every column of the group", () => {
  const out = reorderGroups(
    {
      labels: ["a", "b"],
      dimensions: [["a", "b"]],
      dimensionTimes: [Float64Array.of(1, 2)],
      measures: [Float64Array.of(10, 20)],
      partials: [false, true],
      groupCount: 2,
    },
    ["b", "a"],
  );
  assert.deepEqual(out.dimensions, [["b", "a"]]);
  assert.deepEqual([...out.measures[0]!], [20, 10]);
  assert.deepEqual(out.partials, [true, false]);
  assert.deepEqual([...out.dimensionTimes[0]!], [2, 1]);
});

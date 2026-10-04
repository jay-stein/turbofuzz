import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDataset } from "../src/data/build.js";

test("counts duplicate rows exactly", () => {
  const dataset = buildDataset(
    "t",
    ["a", "b"],
    [
      ["1", "x"],
      ["1", "x"],
      ["1", "x"],
      ["2", "y"],
      ["2", "z"],
    ],
  );
  assert.equal(dataset.stats.duplicateRows, 2);
  assert.equal(dataset.stats.duplicateGroups, 1);
});

test("builds duplicate and null row bitsets", () => {
  const dataset = buildDataset(
    "t",
    ["a", "b"],
    [
      ["1", "x"],
      ["1", "x"],
      ["2", "y"],
      ["", ""],
      ["", "z"],
    ],
  );
  assert.deepEqual([...dataset.duplicateBits.toIndices()], [0, 1]);
  assert.deepEqual([...dataset.nullRowBits.toIndices()], [3, 4]);
  assert.equal(dataset.stats.rowsInDuplicateGroups, 2);
  assert.equal(dataset.stats.rowsWithNulls, 2);
  assert.equal(dataset.stats.duplicateGroups, 1);
});

test("counts empty rows and null cells", () => {
  const dataset = buildDataset(
    "t",
    ["a", "b"],
    [
      ["", ""],
      ["", "x"],
      ["1", ""],
      ["2", "y"],
    ],
  );
  assert.equal(dataset.stats.emptyRows, 1);
  assert.equal(dataset.stats.totalNullCells, 4);
  assert.equal(dataset.stats.totalCells, 8);
  assert.equal(dataset.columns[0].stats.nulls, 2);
});

test("computes text length stats", () => {
  const dataset = buildDataset("t", ["a"], [["abc"], ["a"], ["abcde"]]);
  const stats = dataset.columns[0].stats;
  assert.equal(stats.minLength, 1);
  assert.equal(stats.maxLength, 5);
  assert.equal(stats.avgLength, 3);
});

test("computes numeric mean, stddev and median", () => {
  const dataset = buildDataset("t", ["n"], [["2"], ["4"], ["6"], ["8"]]);
  const column = dataset.columns[0];
  column.numbers();
  assert.equal(column.stats.mean, 5);
  assert.equal(column.stats.min, 2);
  assert.equal(column.stats.max, 8);
  assert.equal(column.median(), 5);
  assert.ok(Math.abs((column.stats.stddev ?? 0) - Math.sqrt(5)) < 1e-9);
});

test("median of an even count averages the middle values", () => {
  const dataset = buildDataset("t", ["n"], [["1"], ["2"], ["3"], ["4"]]);
  assert.equal(dataset.columns[0].median(), 2.5);
});

test("numeric histogram bins values and clamps the last bin", () => {
  const dataset = buildDataset("t", ["n"], [["0"], ["25"], ["50"], ["75"], ["100"]]);
  const histogram = dataset.columns[0].histogram(4);
  assert.ok(histogram !== null);
  assert.deepEqual(histogram.bins, [1, 1, 1, 2]);
  assert.equal(histogram.min, 0);
  assert.equal(histogram.max, 100);
});

test("histogram is null for non-numeric columns", () => {
  const dataset = buildDataset("t", ["n"], [["alpha"], ["beta"], ["gamma"]]);
  assert.equal(dataset.columns[0].histogram(8), null);
});

test("stats carry the top values with exact counts", () => {
  const dataset = buildDataset(
    "t",
    ["v"],
    [["a"], ["b"], ["a"], ["c"], ["a"], ["b"], ["d"]],
  );
  assert.deepEqual(dataset.columns[0].stats.topValues, [
    { label: "a", count: 3 },
    { label: "b", count: 2 },
    { label: "c", count: 1 },
    { label: "d", count: 1 },
  ]);
});

test("medianSampled is exact for small columns", () => {
  const dataset = buildDataset("t", ["n"], [["2"], ["4"], ["6"], ["8"]]);
  assert.equal(dataset.columns[0].medianSampled(100), 5);
});

test("medianSampled approximates large columns", () => {
  const rows = Array.from({ length: 10_000 }, (_, i) => [String(i)]);
  const dataset = buildDataset("t", ["n"], rows);
  const median = dataset.columns[0].medianSampled(200);
  assert.ok(median !== null);
  assert.ok(Math.abs(median - 4999.5) < 100, `expected ~4999.5, got ${median}`);
});

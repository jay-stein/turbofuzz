import { test } from "node:test";
import assert from "node:assert/strict";
import { groupedBinValues } from "../src/data/chart-bins.js";

// Five rows: codes 0 (a) / 1 (b), x = 1, 2, 3, 4, 9.
const values = Float64Array.from([1, 2, 3, 4, 9]);
const codes = Uint16Array.from([0, 1, 0, 0, 1]);
const ids = Uint32Array.from([0, 1, 2, 3, 4]);
const range = { min: 1, max: 4, binCount: 3, overflow: false };

test("groupedBinValues bins each category over the shared range", () => {
  const result = groupedBinValues(values, codes, 2, ids, range, 5);
  assert.equal(result.other, null);
  assert.deepEqual(
    result.groups.map((group) => [group.code, group.bins, group.total]),
    [
      [0, [1, 0, 2], 3],
      [1, [0, 1, 0], 1],
    ],
  );
  assert.equal(result.above, 1, "x = 9 is above max and counted once");
  assert.equal(result.below, 0);
  assert.equal(result.total, 5);
});

test("groupedBinValues folds groups beyond topN into Other", () => {
  const result = groupedBinValues(values, codes, 2, ids, range, 1);
  assert.equal(result.groups.length, 1);
  assert.equal(result.groups[0].code, 0, "largest group keeps its own line");
  assert.ok(result.other !== null);
  assert.equal(result.other?.code, -1);
  assert.deepEqual(result.other?.bins, [0, 1, 0]);
  assert.equal(result.other?.total, 1);
});

test("groupedBinValues counts overflow separately when enabled", () => {
  const result = groupedBinValues(values, codes, 2, ids, { ...range, overflow: true }, 5);
  assert.equal(result.overflow, 1);
  assert.equal(result.above, 0);
  assert.equal(result.groups[1].total, 1, "in-range values only in the series total");
  assert.equal(result.total, 5);
});

test("groupedBinValues counts values below the range once", () => {
  const result = groupedBinValues(values, codes, 2, ids, { min: 2, max: 4, binCount: 2, overflow: false }, 5);
  assert.equal(result.below, 1);
  assert.deepEqual(result.groups[0].bins, [0, 2]);
});

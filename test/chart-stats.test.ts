import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeBoxStats,
  computeCorrelation,
  computeCrossTab,
} from "../src/data/chart-stats.js";

function range(length: number): Uint32Array {
  return Uint32Array.from({ length }, (_, index) => index);
}

test("box stats compute the five-number summary and Tukey whiskers", () => {
  const values = Float64Array.from([1, 2, 3, 4, 5, 10, 11, 12, 100]);
  const codes = new Uint16Array([0, 0, 0, 0, 0, 1, 1, 1, 1]);
  const result = computeBoxStats(values, codes, ["a", "b"], range(9), {
    topN: 5,
    groupOther: false,
  });
  assert.equal(result.groups.length, 2);
  assert.equal(result.total, 9);
  assert.equal(result.missing, 0);

  const first = result.groups[0];
  assert.equal(first.label, "a");
  assert.equal(first.count, 5);
  assert.deepEqual(
    [first.min, first.q1, first.median, first.q3, first.max],
    [1, 2, 3, 4, 5],
  );
  assert.equal(first.whiskerLow, 1);
  assert.equal(first.whiskerHigh, 5);
  assert.equal(first.outliers.length, 0);

  const second = result.groups[1];
  assert.equal(second.count, 4);
  assert.equal(second.median, 11.5);
  assert.equal(second.whiskerHigh, 12);
  assert.deepEqual([...second.outliers], [100]);
});

test("box stats group the tail as Other when asked", () => {
  const values = new Float64Array(10).fill(1);
  const codes = new Uint16Array([0, 0, 0, 0, 0, 1, 1, 1, 1, 2]);
  const result = computeBoxStats(values, codes, ["a", "b", "c"], range(10), {
    topN: 2,
    groupOther: true,
  });
  assert.equal(result.groups.length, 3);
  assert.equal(result.groups[2].label, "Other");
  assert.equal(result.groups[2].other, true);
  assert.equal(result.groups[2].count, 1);
});

test("box stats report non-finite values as missing", () => {
  const values = Float64Array.from([1, Number.NaN, 3]);
  const codes = new Uint16Array([0, 0, 0]);
  const result = computeBoxStats(values, codes, ["a"], range(3), {
    topN: 5,
    groupOther: false,
  });
  assert.equal(result.total, 2);
  assert.equal(result.missing, 1);
  assert.equal(result.groups[0].count, 2);
});

test("crosstab counts pairs with Other buckets", () => {
  const xCodes = new Uint16Array([0, 0, 1, 1, 2]);
  const yCodes = new Uint16Array([0, 1, 0, 1, 2]);
  const result = computeCrossTab(xCodes, yCodes, ["a", "b", "c"], ["p", "q", "r"], range(5), {
    topX: 2,
    topY: 2,
    groupOther: true,
  });
  assert.deepEqual(result.xLabels, ["a", "b", "Other"]);
  assert.deepEqual(result.yLabels, ["p", "q", "Other"]);
  assert.deepEqual([...result.counts], [1, 1, 0, 1, 1, 0, 0, 0, 1]);
  assert.equal(result.total, 5);
});

test("crosstab drops the tail when Other is off", () => {
  const xCodes = new Uint16Array([0, 0, 1, 1, 2]);
  const yCodes = new Uint16Array([0, 1, 0, 1, 2]);
  const result = computeCrossTab(xCodes, yCodes, ["a", "b", "c"], ["p", "q", "r"], range(5), {
    topX: 2,
    topY: 2,
    groupOther: false,
  });
  assert.deepEqual(result.xLabels, ["a", "b"]);
  assert.deepEqual(result.yLabels, ["p", "q"]);
  assert.deepEqual([...result.counts], [1, 1, 1, 1]);
});

test("correlation computes Pearson r with pairwise-complete pairs", () => {
  const x = Float64Array.from([1, 2, 3]);
  const y = Float64Array.from([2, 4, 6]);
  const perfect = computeCorrelation([x, y], range(3));
  assert.equal(perfect.values[1], 1);
  assert.equal(perfect.counts[1], 3);

  const negated = computeCorrelation([x, Float64Array.from([6, 4, 2])], range(3));
  assert.equal(negated.values[1], -1);

  const withGaps = computeCorrelation(
    [Float64Array.from([1, 2, Number.NaN, 4]), Float64Array.from([1, Number.NaN, 3, 4])],
    range(4),
  );
  assert.equal(withGaps.values[1], 1);
  assert.equal(withGaps.counts[1], 2);
});

test("correlation marks constant columns as undefined", () => {
  const x = Float64Array.from([5, 5, 5]);
  const y = Float64Array.from([1, 2, 3]);
  const result = computeCorrelation([x, y], range(3));
  assert.ok(Number.isNaN(result.values[1]));
  assert.equal(result.values[0], 1);
  assert.equal(result.counts[0], 3);
});

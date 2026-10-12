import { test } from "node:test";
import assert from "node:assert/strict";
import { categoryCodes, computeSeries } from "../src/data/chart-series.js";
import { BitSet } from "../src/search/bitset.js";

function range(length: number): Uint32Array {
  return Uint32Array.from({ length }, (_, index) => index);
}

const options = { mode: "points" as const, limit: 1000, gridCols: 8, gridRows: 8, sampleStride: 1 };

test("points mode keeps only finite pairs in result order", () => {
  const x = Float64Array.from([1, Number.NaN, 3, 4]);
  const y = Float64Array.from([10, 20, Number.NaN, 40]);
  const result = computeSeries(x, y, range(4), null, null, null, options);
  assert.equal(result.mode, "points");
  if (result.mode !== "points") return;
  assert.equal(result.total, 2);
  assert.equal(result.shown, 2);
  assert.deepEqual([...result.x], [1, 4]);
  assert.deepEqual([...result.y], [10, 40]);
});

test("points mode follows the row subset (current filters)", () => {
  const x = Float64Array.from([1, 2, 3, 4]);
  const y = Float64Array.from([1, 2, 3, 4]);
  const result = computeSeries(x, y, Uint32Array.from([1, 3]), null, null, null, options);
  assert.equal(result.mode, "points");
  if (result.mode !== "points") return;
  assert.deepEqual([...result.x], [2, 4]);
});

test("axes clip to p1-p99 when a representative sample exists", () => {
  const n = 200;
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    x[i] = i;
    y[i] = i;
  }
  x[n - 1] = 1_000_000;
  y[n - 1] = 1_000_000;
  const result = computeSeries(x, y, range(n), null, null, null, options);
  assert.equal(result.mode, "points");
  if (result.mode !== "points") return;
  assert.ok(result.xMax < 1_000_000);
  assert.ok(result.yMax < 1_000_000);
  assert.equal(result.outside, 4);
  assert.equal(result.shown, n - 4);
});

test("points mode thins to the limit and reports sampling", () => {
  const n = 20;
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    x[i] = i;
    y[i] = i;
  }
  const result = computeSeries(x, y, range(n), null, null, null, {
    ...options,
    limit: 5,
  });
  assert.equal(result.mode, "points");
  if (result.mode !== "points") return;
  assert.equal(result.total, n);
  assert.equal(result.shown, 5);
  assert.equal(result.sampled, true);
  assert.deepEqual([...result.x], [0, 4, 8, 12, 16]);
});

test("auto mode switches to a density grid above the point limit", () => {
  const n = 64;
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    x[i] = i % 8;
    y[i] = Math.floor(i / 8);
  }
  const result = computeSeries(x, y, range(n), null, null, null, {
    mode: "auto",
    limit: 10,
    gridCols: 8,
    gridRows: 8,
    sampleStride: 1,
  });
  assert.equal(result.mode, "density");
  if (result.mode !== "density") return;
  assert.equal(result.total, n);
  assert.equal(result.outside, 0);
  assert.equal(result.max, 1);
  assert.equal(result.counts.reduce((sum, count) => sum + count, 0), n);
  assert.equal(result.counts[0], 1);
  assert.equal(result.counts[7 * 8 + 7], 1);
});

test("explicit density mode ignores the point limit", () => {
  const n = 64;
  const x = new Float64Array(n).fill(2);
  const y = new Float64Array(n).fill(3);
  const result = computeSeries(x, y, range(n), null, null, null, {
    mode: "density",
    limit: 5,
    gridCols: 8,
    gridRows: 8,
  });
  assert.equal(result.mode, "density");
  if (result.mode !== "density") return;
  assert.equal(result.max, n);
});

test("colour and size arrays align with the kept points", () => {
  const x = Float64Array.from([1, 2, 3]);
  const y = Float64Array.from([1, 2, 3]);
  const colors = Float64Array.from([0.1, Number.NaN, 0.9]);
  const sizes = Float64Array.from([5, 6, 7]);
  const codes = new Uint16Array([0, 1, 0]);
  const result = computeSeries(x, y, range(3), colors, codes, sizes, options);
  assert.equal(result.mode, "points");
  if (result.mode !== "points") return;
  assert.ok(result.colorValues !== null);
  assert.ok(result.colorCodes !== null);
  assert.ok(result.size !== null);
  assert.equal(result.colorValues.length, result.shown);
  assert.ok(Number.isNaN(result.colorValues[1]));
  assert.deepEqual([...result.colorCodes], [0, 1, 0]);
  assert.deepEqual([...result.size], [5, 6, 7]);
});

test("no matching pairs returns an empty points payload", () => {
  const result = computeSeries(
    Float64Array.from([1]),
    Float64Array.from([Number.NaN]),
    range(1),
    null,
    null,
    null,
    options,
  );
  assert.equal(result.mode, "points");
  if (result.mode !== "points") return;
  assert.equal(result.shown, 0);
  assert.equal(result.total, 0);
});

test("categoryCodes maps every row to its category value", () => {
  const bits = [new BitSet(4), new BitSet(4)];
  bits[0].set(0);
  bits[0].set(2);
  bits[1].set(1);
  const codes = categoryCodes(bits, 4);
  assert.deepEqual([...codes], [0, 1, 0, 0xffff]);
});

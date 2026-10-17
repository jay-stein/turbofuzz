import { test } from "node:test";
import assert from "node:assert/strict";
import { computeGridCounts } from "../src/data/chart-stats.js";
import {
  computeBarFrames,
  computeBubbleFrames,
  computeHistogramFrames,
} from "../src/data/chart-frames.js";

const allIds = (count: number): Uint32Array =>
  Uint32Array.from({ length: count }, (_, index) => index);

const DAY = 86_400_000;

test("grid counts bin two numeric columns into cells", () => {
  // Values lie on a 4x4 diagonal; the maximum value lands in the last cell
  // with its neighbour, so that cell holds two rows.
  const x = Float64Array.from([0, 1, 2, 3, 4]);
  const y = Float64Array.from([0, 1, 2, 3, 4]);
  const result = computeGridCounts(x, y, allIds(5), 4);
  assert.equal(result.bins, 4);
  assert.equal(result.total, 5);
  assert.equal(result.missing, 0);
  assert.equal(result.maxCount, 2);
  let sum = 0;
  for (const count of result.counts) sum += count;
  assert.equal(sum, 5, "every row lands in exactly one cell");
  assert.equal(result.xMin, 0);
  assert.equal(result.xMax, 4);

  // Stacking three rows into one corner cell increases its count.
  const stacked = computeGridCounts(
    Float64Array.from([0, 0, 0, 4]),
    Float64Array.from([0, 0, 0, 4]),
    allIds(4),
    4,
  );
  assert.equal(stacked.maxCount, 3);
  // Rows with a missing coordinate are reported, not binned.
  const sparse = computeGridCounts(
    Float64Array.from([0, Number.NaN]),
    Float64Array.from([0, 1]),
    allIds(2),
    4,
  );
  assert.equal(sparse.total, 1);
  assert.equal(sparse.missing, 1);
});

test("bar frames split category counts per month", () => {
  const times = Float64Array.from([
    Date.UTC(2024, 0, 5),
    Date.UTC(2024, 0, 20),
    Date.UTC(2024, 1, 3),
    Date.UTC(2024, 1, 10),
    Date.UTC(2024, 1, 25),
    Date.UTC(2024, 2, 1),
  ]);
  const codes = Uint16Array.from([0, 0, 1, 0, 1, 2]);
  const labels = ["closed", "open", "pending"];
  const result = computeBarFrames(times, codes, labels, allIds(6), "month", 2);
  assert.deepEqual(
    result.frames.map((frame) => frame.label),
    ["2024-01", "2024-02", "2024-03"],
  );
  assert.deepEqual(result.bar?.labels, ["closed", "open", "Other"]);
  const counts = result.bar?.counts ?? new Uint32Array();
  // January: closed 2, open 0; February: closed 1, open 2; March: pending -> Other 1.
  assert.deepEqual([...counts.slice(0, 3)], [2, 0, 0]);
  assert.deepEqual([...counts.slice(3, 6)], [1, 2, 0]);
  assert.deepEqual([...counts.slice(6, 9)], [0, 0, 1]);
  assert.equal(result.maxCount, 2);
  assert.equal(result.total, 6);
});

test("bubble frames split grid counts per month", () => {
  const times = Float64Array.from([
    Date.UTC(2024, 0, 5),
    Date.UTC(2024, 0, 6),
    Date.UTC(2024, 1, 3),
  ]);
  const x = Float64Array.from([0, 0, 10]);
  const y = Float64Array.from([0, 0, 10]);
  const result = computeBubbleFrames(times, x, y, allIds(3), "month", 4);
  assert.equal(result.frames.length, 2);
  assert.equal(result.bubble?.bins, 4);
  assert.equal(result.total, 3);
  assert.equal(result.maxCount, 2, "two January rows share one corner cell");
  const cellCount = 16;
  const january = (result.bubble?.grids ?? new Uint32Array()).slice(0, cellCount);
  const february = (result.bubble?.grids ?? new Uint32Array()).slice(cellCount, cellCount * 2);
  assert.equal([...january].reduce((sum, value) => sum + value, 0), 2);
  assert.equal([...february].reduce((sum, value) => sum + value, 0), 1);
});

test("animation frames need a date value per row", () => {
  const times = Float64Array.from([Date.UTC(2024, 0, 5), Number.NaN, Date.UTC(2024, 0, 6)]);
  const codes = Uint16Array.from([0, 0, 0]);
  const result = computeBarFrames(times, codes, ["a"], allIds(3), "month", 5);
  assert.equal(result.total, 2);
  assert.equal(result.missing, 1);
});

test("histogram frames bin values per time bucket on a global scale", () => {
  const times = Float64Array.from([
    Date.UTC(2024, 0, 5),
    Date.UTC(2024, 0, 6),
    Date.UTC(2024, 0, 7),
    Date.UTC(2024, 1, 3),
    Date.UTC(2024, 1, 10),
  ]);
  const values = Float64Array.from([0, 10, 0, 0, 0]);
  const result = computeHistogramFrames(times, values, allIds(5), "month", 4);
  assert.equal(result.frames.length, 2);
  assert.equal(result.hist?.bins, 4);
  assert.equal(result.hist?.min, 0);
  assert.equal(result.hist?.max, 10);
  assert.equal(result.total, 5);
  assert.equal(result.maxCount, 2, "two rows share the low bin in each month");
  const width = 4;
  const january = [...(result.hist?.counts.slice(0, width) ?? [])].reduce((a, b) => a + b, 0);
  const february = [...(result.hist?.counts.slice(width, width * 2) ?? [])].reduce(
    (a, b) => a + b,
    0,
  );
  assert.equal(january, 3);
  assert.equal(february, 2);
});

test("grid counts aggregate a measure per cell", () => {
  const x = Float64Array.from([0, 0, 0, 9]);
  const y = Float64Array.from([0, 0, 0, 9]);
  const values = Float64Array.from([2, 4, 9, 100]);
  const ids = allIds(4);
  const sum = computeGridCounts(x, y, ids, 4, { values, agg: "sum" });
  assert.equal(sum.values?.[0], 15);
  assert.equal(sum.valueMax, 100);
  const mean = computeGridCounts(x, y, ids, 4, { values, agg: "mean" });
  assert.equal(mean.values?.[0], 5);
  assert.equal(mean.valueMax, 100);
  const min = computeGridCounts(x, y, ids, 4, { values, agg: "min" });
  assert.equal(min.values?.[0], 2);
  const max = computeGridCounts(x, y, ids, 4, { values, agg: "max" });
  assert.equal(max.values?.[0], 9);
  assert.ok(Number.isNaN(sum.values?.[5] ?? 0), "empty cells carry no value");
});

test("bubble frames aggregate a measure per frame", () => {
  const times = Float64Array.from([Date.UTC(2024, 0, 5), Date.UTC(2024, 0, 6), Date.UTC(2024, 1, 3)]);
  const x = Float64Array.from([0, 0, 9]);
  const y = Float64Array.from([0, 0, 9]);
  const values = Float64Array.from([2, 4, 100]);
  const result = computeBubbleFrames(times, x, y, allIds(3), "month", 4, {
    values,
    agg: "sum",
  });
  const bubble = result.bubble;
  assert.ok(bubble?.values !== null && bubble?.values !== undefined);
  assert.equal(bubble.valueMax, 100);
  assert.equal(bubble.values?.[0], 6, "January sums into the corner cell");
  const cellCount = 16;
  assert.equal(bubble.values?.[cellCount + 15], 100, "February keeps the lone value");
});


test("grouped grid counts build one grid per category over shared bounds", () => {
  const x = Float64Array.from([0, 0, 9]);
  const y = Float64Array.from([0, 0, 9]);
  const codes = Uint16Array.from([0, 1, 0]);
  const result = computeGridCounts(x, y, allIds(3), 4, undefined, {
    codes,
    labels: ["alpha", "beta"],
  });
  assert.ok(result.groups !== null);
  assert.equal(result.groups?.length, 2);
  const alpha = result.groups?.[0]?.counts.reduce((a, b) => a + b, 0);
  const beta = result.groups?.[1]?.counts.reduce((a, b) => a + b, 0);
  assert.equal(alpha, 2);
  assert.equal(beta, 1);
  assert.equal(result.counts.reduce((a, b) => a + b, 0), 3, "the combined grid covers every row");
  assert.equal(result.maxCount, 2);
});

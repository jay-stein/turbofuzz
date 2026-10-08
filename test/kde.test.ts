import { test } from "node:test";
import assert from "node:assert/strict";
import { contourLevels, marchingSquares, smoothGrid, smoothSeries } from "../src/data/kde.js";

test("smoothSeries preserves total mass and spreads the peak", () => {
  const smoothed = smoothSeries([0, 0, 10, 0, 0], 1);
  const total = [...smoothed].reduce((sum, value) => sum + value, 0);
  assert.ok(Math.abs(total - 10) < 1e-9);
  assert.ok(smoothed[2] > smoothed[1]);
  assert.ok(smoothed[1] > smoothed[0]);
  assert.ok(Math.abs(smoothed[1] - smoothed[3]) < 1e-9);
});

test("smoothGrid spreads a single interior cell symmetrically", () => {
  const cols = 7;
  const rows = 7;
  const counts = new Uint32Array(cols * rows);
  counts[3 * cols + 3] = 4;
  const smooth = smoothGrid(counts, cols, rows, 1);
  const total = [...smooth].reduce((sum, value) => sum + value, 0);
  assert.ok(Math.abs(total - 4) < 1e-9);
  assert.ok(smooth[3 * cols + 3] > smooth[3 * cols + 2]);
  assert.ok(Math.abs(smooth[3 * cols + 2] - smooth[3 * cols + 4]) < 1e-9);
  assert.ok(Math.abs(smooth[2 * cols + 3] - smooth[4 * cols + 3]) < 1e-9);
});

test("marching squares outlines a high cell and ignores flat fields", () => {
  const cols = 3;
  const rows = 3;
  const field = new Float64Array(cols * rows);
  field[1 * cols + 1] = 1;
  const segments = marchingSquares(field, cols, rows, 0.5);
  assert.equal(segments.length, 16);
  assert.deepEqual(marchingSquares(new Float64Array([1, 1, 1, 1]), 2, 2, 2), []);
  assert.deepEqual(marchingSquares(new Float64Array([1, 1, 1, 1]), 2, 2, 0.5), []);
});

test("contour levels spread below the peak", () => {
  const levels = contourLevels(100, 5);
  assert.equal(levels.length, 5);
  assert.ok(levels[0] > 0 && levels[0] < 25);
  assert.ok(levels[4] < 100);
  assert.deepEqual(contourLevels(0), []);
});

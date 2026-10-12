import { test } from "node:test";
import assert from "node:assert/strict";
import { squarifyLayout } from "../src/data/treemap.js";

test("squarify tiles the rectangle with areas proportional to values", () => {
  const values = [50, 25, 15, 10];
  const rects = squarifyLayout(values, 0, 0, 400, 200);
  assert.equal(rects.length, 4);
  const total = values.reduce((sum, value) => sum + value, 0);
  for (let index = 0; index < rects.length; index++) {
    const rect = rects[index]!;
    const share = (rect.w * rect.h) / (400 * 200);
    assert.ok(
      Math.abs(share - values[index]! / total) < 1e-6,
      `tile ${index} share ${share}`,
    );
    assert.ok(rect.x >= -1e-6 && rect.y >= -1e-6);
    assert.ok(rect.x + rect.w <= 400 + 1e-6);
    assert.ok(rect.y + rect.h <= 200 + 1e-6);
  }
  const area = rects.reduce((sum, rect) => sum + rect.w * rect.h, 0);
  assert.ok(Math.abs(area - 400 * 200) < 1e-3);
});

test("squarify handles ties, single values and degenerate input", () => {
  const equal = squarifyLayout([1, 1, 1, 1], 10, 20, 200, 100);
  assert.equal(equal.length, 4);
  for (const rect of equal) {
    assert.ok(Math.abs(rect.w * rect.h - (200 * 100) / 4) < 1e-6);
  }
  assert.deepEqual(squarifyLayout([], 0, 0, 10, 10), []);
  assert.deepEqual(squarifyLayout([0, 0], 0, 0, 10, 10), []);
  assert.deepEqual(squarifyLayout([5], 0, 0, 0, 10), []);
  const single = squarifyLayout([5], 3, 4, 10, 10);
  assert.deepEqual(single, [{ x: 3, y: 4, w: 10, h: 10 }]);
});

test("squarify keeps tiles reasonably square for skewed values", () => {
  const values = [1000, 500, 200, 100, 50, 25, 10, 5];
  const rects = squarifyLayout(values, 0, 0, 600, 300);
  let worstAspect = 0;
  for (const rect of rects) {
    worstAspect = Math.max(worstAspect, rect.w / rect.h, rect.h / Math.max(1e-9, rect.w));
  }
  assert.ok(worstAspect < 12, `worst aspect ${worstAspect}`);
});

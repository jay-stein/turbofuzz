import { test } from "node:test";
import assert from "node:assert/strict";
import { contourValue } from "../src/ui/chart-draw-points.js";

test("contour labels read as rows per grid cell, to two significant figures", () => {
  assert.equal(contourValue(0.0434), "0.043");
  assert.equal(contourValue(3.27), "3.3");
  assert.equal(contourValue(12.6), "13");
  assert.equal(contourValue(482.2), "482");
  assert.equal(contourValue(15400), "15.4K");
});

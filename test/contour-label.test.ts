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

test("a fit line's equation reads in the column names, to three significant figures", async () => {
  const { fitEquation } = await import("../src/ui/chart-draw-points.js");
  assert.equal(fitEquation(2.1234, 229.6, "Total", "Speed"), "Total = 2.12 × Speed + 230");
  assert.equal(fitEquation(-0.5, -12.25, "y", "x"), "y = −0.5 × x − 12.3");
  assert.equal(fitEquation(3, 0, "price", "dist"), "price = 3 × dist");
  assert.equal(fitEquation(1500.4, 25000, "Sales", "Year"), "Sales = 1,500 × Year + 25,000");
});

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  colorForFraction,
  colorFraction,
  colorRamp,
  describeColorDomain,
  resolveColorDomain,
} from "../src/ui/color-scale.js";

test("auto and manual colour domains share one calculation", () => {
  const auto = resolveColorDomain({ autoMin: 2, autoMax: 10 });
  assert.equal(auto.min, 2);
  assert.equal(auto.max, 10);
  assert.equal(auto.fixed, false);
  const fixed = resolveColorDomain({ autoMin: 2, autoMax: 10, min: 0, max: 20 });
  assert.equal(fixed.min, 0);
  assert.equal(fixed.max, 20);
  assert.equal(fixed.fixed, true);
  assert.equal(colorFraction(10, fixed), 0.5);
  assert.equal(colorFraction(-5, fixed), 0);
  assert.equal(colorFraction(25, fixed), 1);
});

test("a centre makes diverging domains symmetric and explained", () => {
  const domain = resolveColorDomain({ autoMin: -2, autoMax: 8, center: 0 });
  assert.equal(domain.centered, true);
  assert.equal(domain.min, -8);
  assert.equal(domain.max, 8);
  assert.equal(describeColorDomain(domain, String), "-8 - 8 centered");
});

test("ramp helpers clamp fractions and fall back deterministically", () => {
  const colors = colorRamp(["#000000", "#ffffff"], 3, () => "#ff0000");
  assert.deepEqual(colors, ["#000000", "#808080", "#ffffff"]);
  assert.equal(colorForFraction(-1, null, () => "#123456"), "#123456");
});
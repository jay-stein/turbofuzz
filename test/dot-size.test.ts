import { test } from "node:test";
import assert from "node:assert/strict";
import { dataRange, dotDomain, dotRadii, scaleFraction, type DotSizeSpec } from "../src/data/dot-size.js";

const spec = (over: Partial<DotSizeSpec> = {}): DotSizeSpec => ({
  minRadius: 2,
  maxRadius: 12,
  valueMin: null,
  valueMax: null,
  scale: "linear",
  ...over,
});
const near = (a: number, b: number): void => assert.ok(Math.abs(a - b) < 1e-9, `${a} is not ${b}`);

test("linear: the smallest value gets the smallest radius, the largest the largest, the middle between", () => {
  const r = dotRadii([10, 20, 30], 3, spec(), 1)!;
  near(r[0]!, 2);
  near(r[1]!, 7);
  near(r[2]!, 12);
});

test("the drawing scale multiplies the radii", () => {
  const r = dotRadii([0, 1], 2, spec(), 2)!;
  near(r[0]!, 4);
  near(r[1]!, 24);
});

test("area keeps the dot's area in step with the value; flannery sits between linear and area", () => {
  near(scaleFraction(0.25, "area", 1), 0.5);
  const f = scaleFraction(0.25, "flannery", 1);
  assert.ok(f > 0.25 && f < 0.5, `flannery ${f}`);
  near(scaleFraction(0.5, "linear", 1), 0.5);
});

test("log lifts the small values of a long tail without moving the ends", () => {
  near(scaleFraction(0, "log", 999), 0);
  near(scaleFraction(1, "log", 999), 1);
  // 1% of the way along a 0..999 range is already about a third of the radius range.
  assert.ok(scaleFraction(0.01, "log", 999) > 0.3);
});

test("a chosen range clamps what lies outside it, so one extreme value cannot shrink the rest", () => {
  const values = [1, 50, 100, 100000];
  const auto = dotRadii(values, 4, spec(), 1)!;
  const capped = dotRadii(values, 4, spec({ valueMax: 100 }), 1)!;
  assert.ok(auto[2]! < 2.1, "with the outlier in range, 100 is nearly the smallest dot");
  near(capped[2]!, 12);
  near(capped[3]!, 12);
  near(capped[0]!, 2);
});

test("a range pointing backwards falls back to the data's own", () => {
  assert.deepEqual(dotDomain(0, 10, 8, 3), { lo: 0, hi: 10 });
  assert.deepEqual(dotDomain(0, 10, null, 5), { lo: 0, hi: 5 });
  assert.deepEqual(dotDomain(0, 10, Number.NaN, null), { lo: 0, hi: 10 });
});

test("equal values draw at the middle, and non-numbers at the smallest radius", () => {
  near(dotRadii([5, 5], 2, spec(), 1)![0]!, 7);
  const r = dotRadii([1, Number.NaN, 3], 3, spec(), 1)!;
  near(r[1]!, 2);
  assert.equal(dotRadii([Number.NaN], 1, spec(), 1), null);
});

test("a maximum radius below the minimum is lifted to it", () => {
  const r = dotRadii([0, 1], 2, spec({ minRadius: 6, maxRadius: 3 }), 1)!;
  near(r[0]!, 6);
  near(r[1]!, 6);
});

test("dataRange skips non-numbers and reads only the shown values", () => {
  assert.deepEqual(dataRange([3, Number.NaN, 9, 100], 3), { min: 3, max: 9 });
  assert.equal(dataRange([Number.NaN], 1), null);
});

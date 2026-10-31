import { test } from "node:test";
import assert from "node:assert/strict";
import { fillGaps } from "../src/data/timeseries/aggregate.js";

/** Hourly, a daily shape, and a level that steps up halfway (a new semester). */
function hours(): Float64Array {
  return Float64Array.from({ length: 24 * 7 * 12 }, (_, i) => (i < 24 * 7 * 6 ? 20 : 40) + 15 * Math.max(0, Math.sin(((i % 24) - 6) / 12 * Math.PI)));
}
const err = (a: Float64Array, b: Float64Array, from: number, to: number): number => { let e = 0; for (let i = from; i < to; i++) e += Math.abs(a[i]! - b[i]!); return e / (to - from); };

test("a long gap takes the nearby typical value, which follows the local level", () => {
  const truth = hours(), from = 24 * 7 * 8, to = from + 24 * 4;
  const holed = truth.slice(); for (let i = from; i < to; i++) holed[i] = NaN;
  // The edge readings sit at the gap's two ends; a straight-line level across four days misses the shape less well than nearby cycles do.
  const smart = fillGaps(holed.slice(), "smart", 168, 24, true), pattern = fillGaps(holed.slice(), "seasonal", 168, 24, true);
  assert.ok(err(smart, truth, from, to) < 0.5, `smart ${err(smart, truth, from, to)}`);
  assert.ok(err(smart, truth, from, to) <= err(pattern, truth, from, to));
});

test("a long gap over a phase that never has values (weekends with no rows) still fills", () => {
  const y = Float64Array.from({ length: 7 * 30 }, (_, i) => (i % 7 >= 5 ? NaN : 10 + (i % 7)));
  for (let i = 70; i < 112; i++) y[i] = NaN;
  for (const how of ["smart", "local"] as const) assert.ok(fillGaps(y.slice(), how, 7, 7, true).every((v) => v === v), how);
});

test("each choice fills every gap: copied from the cycle before, carried forward, nearby typical", () => {
  const truth = hours(), holed = truth.slice();
  for (const i of [5, 300, 301, 1500]) holed[i] = NaN;
  const last = fillGaps(holed.slice(), "lastcycle", 168, 24, true);
  assert.equal(last[300], truth[300 - 168]);
  const fwd = fillGaps(holed.slice(), "last", 168, 24, true);
  assert.equal(fwd[301], truth[299]);
  for (const how of ["smart", "local", "lastcycle", "seasonal", "last"] as const) {
    assert.ok(fillGaps(holed.slice(), how, 168, 24, true).every((v) => v === v), how);
  }
});

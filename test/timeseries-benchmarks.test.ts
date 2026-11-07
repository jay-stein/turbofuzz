import { test } from "node:test";
import assert from "node:assert/strict";
import {
  crostonRate, demandProfile, driftSlope, fitIntermittent, isIntermittent, meanLevel, naiveLevel, sbaRate, tsbRate,
} from "../src/data/timeseries/benchmarks.js";

const near = (a: number, b: number, eps = 1e-9): void => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);

test("naive, drift and mean on a short series, skipping missing values", () => {
  const y = Float64Array.from([2, 4, NaN, 8, 10]);
  assert.equal(naiveLevel(y, 5), 10);
  assert.equal(naiveLevel(y, 3), 4, "a missing last value is skipped");
  near(driftSlope(y, 5), (10 - 2) / 4);
  assert.equal(driftSlope(Float64Array.from([5]), 1), 0);
  near(meanLevel(y, 5), (2 + 4 + 8 + 10) / 4);
});

test("Croston and SBA follow the published recursion on a worked example", () => {
  // Sales of 3 at t=1, 5 at t=4, 2 at t=5, with alpha 0.1. Start: size 3, interval 2 (first sale at index 1).
  const y = Float64Array.from([0, 3, 0, 0, 5, 2, 0]);
  const f = fitIntermittent(y, 7, 0.1)!;
  // t=4: gap since the last sale is 3 (t=2,3 are zero, so gap = 3 at the sale): size 3+0.1(5-3)=3.2, interval 2+0.1(3-2)=2.1
  // t=5: gap 1: size 3.2+0.1(2-3.2)=3.08, interval 2.1+0.1(1-2.1)=1.99
  near(f.size, 3.08);
  near(f.interval, 1.99);
  near(crostonRate(f), 3.08 / 1.99);
  near(sbaRate(f, 0.1), 0.95 * (3.08 / 1.99));
  assert.equal(f.sinceSale, 1);
});

test("TSB smooths the probability of a sale every period, so it decays through zeros where Croston does not", () => {
  const y = Float64Array.from([5, 5, 5, 5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const f = fitIntermittent(y, y.length, 0.1, 0.1)!;
  const early = fitIntermittent(y, 4, 0.1, 0.1)!;
  assert.ok(tsbRate(f) < tsbRate(early) * 0.5, "the TSB rate falls through a long run of zeros");
  // Croston's rate stays where the last sale left it.
  near(crostonRate(f), crostonRate(early));
});

test("a series with no sale cannot be fitted, and missing periods are skipped", () => {
  assert.equal(fitIntermittent(Float64Array.from([0, 0, 0]), 3), null);
  const gappy = Float64Array.from([0, 2, NaN, NaN, 0, 4]);
  const f = fitIntermittent(gappy, 6, 0.1)!;
  assert.ok(Number.isFinite(f.size) && Number.isFinite(f.interval));
});

test("intermittent means demand in fewer than three of every four periods, never negative data", () => {
  const sparse = Float64Array.from({ length: 40 }, (_, i) => (i % 4 === 0 ? 3 + (i % 3) : 0));
  const p = demandProfile(sparse, 40);
  near(p.adi, 4);
  assert.ok(isIntermittent(sparse, 40));
  assert.ok(!isIntermittent(Float64Array.from({ length: 40 }, (_, i) => 10 + (i % 5)), 40), "steady demand is not");
  assert.ok(!isIntermittent(Float64Array.from({ length: 40 }, (_, i) => (i % 4 === 0 ? -3 : 0)), 40), "negative values are not demand");
  assert.ok(!isIntermittent(Float64Array.from([0, 0, 5, 0]), 4), "four periods are too few to say");
});

import { imapaRate } from "../src/data/timeseries/benchmarks.js";

test("IMAPA adds the history up in buckets, smooths each, spreads back, and averages", () => {
  // A sale of 6 every third period: the demand rate is 2 per period at every bucket length that divides the history.
  const y = Float64Array.from(Array.from({ length: 36 }, (_, t) => (t % 3 === 0 ? 6 : 0)));
  const rate = imapaRate(y, y.length);
  assert.ok(Math.abs(rate - 2) < 0.5, `the rate is near 2 (got ${rate})`);
  // Zeros before the first sale are not counted, and no sale is no demand.
  assert.equal(imapaRate(Float64Array.from([0, 0, 0, 0]), 4), 0);
  const late = Float64Array.from([0, 0, 0, 0, 0, 0, ...y]);
  assert.ok(Math.abs(imapaRate(late, late.length) - rate) < 1e-9, "leading zeros change nothing");
  // A missing period is skipped, never read as zero demand, and the rate is never negative.
  const gappy = Float64Array.from(y);
  gappy[7] = NaN;
  assert.ok(Number.isFinite(imapaRate(gappy, gappy.length)) && imapaRate(gappy, gappy.length) >= 0);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { bandAtLevel, parseLevel, probit, zOfLevel } from "../src/data/timeseries/bands.js";

test("the normal quantiles match the ones the models use", () => {
  assert.ok(Math.abs(zOfLevel(80) - 1.2816) < 1e-3);
  assert.ok(Math.abs(zOfLevel(95) - 1.96) < 1e-3);
  assert.ok(Math.abs(zOfLevel(99) - 2.5758) < 1e-3);
  assert.ok(Math.abs(probit(0.5)) < 1e-9);
});

const f = { F: [100, 200], lo80: [90, 180], hi80: [110, 220], lo95: [84.7, 169.4], hi95: [115.3, 230.6] };

test("a band at 80 or 95 is the one the model built, and others are rescaled from the nearer", () => {
  assert.deepEqual([...bandAtLevel(f, 80, false).hi], [110, 220]);
  assert.deepEqual([...bandAtLevel(f, 95, false).lo], [84.7, 169.4]);
  const b50 = bandAtLevel(f, 50, false);
  assert.ok(b50.hi[0]! > 100 && b50.hi[0]! < 110, "a 50% band is narrower than the 80% one");
  assert.ok(Math.abs(b50.hi[0]! - (100 + 10 * zOfLevel(50) / zOfLevel(80))) < 1e-9);
  const b99 = bandAtLevel(f, 99, false);
  assert.ok(b99.hi[0]! > 115.3, "a 99% band is wider than the 95% one");
  assert.ok(Math.abs(b99.lo[1]! - (200 - 30.6 * zOfLevel(99) / zOfLevel(95))) < 1e-9);
});

test("a series that cannot go below zero keeps its band at zero or above", () => {
  const g = { F: [5], lo80: [1], hi80: [9], lo95: [0], hi95: [11] };
  assert.equal(bandAtLevel(g, 99, true).lo[0], 0);
  assert.ok(bandAtLevel(g, 99, false).lo[0]! < 0);
});

test("a typed level is read as a percentage from 50 to 99.9", () => {
  assert.equal(parseLevel("90"), 90);
  assert.equal(parseLevel(" 97.5% "), 97.5);
  assert.equal(parseLevel("20"), 50);
  assert.equal(parseLevel("100"), 99.9);
  assert.equal(parseLevel(""), null);
  assert.equal(parseLevel("abc"), null);
});

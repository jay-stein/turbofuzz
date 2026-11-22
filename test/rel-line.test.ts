import { test } from "node:test";
import assert from "node:assert/strict";
import { computeRelLine, RELLINE_BINS } from "../src/data/rel-line.js";

const ids = (n: number): Uint32Array => Uint32Array.from({ length: n }, (_, i) => i);

test("a line of y against numeric x: the average at each x with a 95% t-interval", () => {
  // x = 1, 2, 3; y at each x = x*10 + {-1, 0, 1}
  const x = Float64Array.from([1, 1, 1, 2, 2, 2, 3, 3, 3]);
  const y = Float64Array.from([9, 10, 11, 19, 20, 21, 29, 30, 31]);
  const result = computeRelLine({ ids: ids(9), x, xLabels: null, y, hue: null, hueLabels: [], maxHues: 8, stat: "mean", band: "ci" });
  assert.deepEqual([...result.xs], [1, 2, 3]);
  assert.equal(result.binned, false);
  assert.deepEqual([...result.series[0]!.center], [10, 20, 30]);
  // sd 1, n 3: t(2) = 4.303, so the t-interval (±2.48) is wider than the rows (±1): it is kept within them.
  assert.deepEqual([...result.series[0]!.low], [9, 19, 29]);
  assert.deepEqual([...result.series[0]!.high], [11, 21, 31]);
  assert.equal(result.narrowed, 3);
  assert.deepEqual([...result.series[0]!.n], [3, 3, 3]);
  assert.equal(result.rows, 9);
  // A standard error band is the formula's, unchanged: ±1/sqrt(3).
  const se = computeRelLine({ ids: ids(9), x, xLabels: null, y, hue: null, hueLabels: [], maxHues: 8, stat: "mean", band: "se" });
  assert.ok(Math.abs(se.series[0]!.low[0]! - (10 - 1 / Math.sqrt(3))) < 1e-9);
  assert.equal(se.narrowed, 0);
});

test("with enough rows the 95% band is Student's t-interval", () => {
  // 20 rows at x = 1: y = 0..19, mean 9.5, sd = sqrt(35), t(19) = 2.093.
  const x = new Float64Array(20).fill(1);
  const y = Float64Array.from({ length: 20 }, (_, i) => i);
  const result = computeRelLine({ ids: ids(20), x, xLabels: null, y, hue: null, hueLabels: [], maxHues: 8, stat: "mean", band: "ci" });
  const margin = (2.093 * Math.sqrt(35)) / Math.sqrt(20);
  assert.ok(Math.abs(result.series[0]!.low[0]! - (9.5 - margin)) < 1e-9);
  assert.equal(result.narrowed, 0);
});

test("one line per hue, the largest kept, in natural order; missing x or y rows are left out", () => {
  const x = Float64Array.from([1, 2, 1, 2, 1, Number.NaN]);
  const y = Float64Array.from([1, 2, 3, 4, Number.NaN, 5]);
  const hue = Uint16Array.from([0, 0, 1, 1, 2, 0]);
  const result = computeRelLine({ ids: ids(6), x, xLabels: null, y, hue, hueLabels: ["b10", "b2", "c"], maxHues: 2, stat: "mean", band: "none" });
  // b10 has 2 usable rows (plus one with no x), b2 has 2, c has 1: c is not drawn.
  assert.deepEqual(result.series.map((s) => s.label), ["b2", "b10"]);
  assert.equal(result.hiddenHues, 1);
  assert.deepEqual([...result.series[1]!.center], [1, 2]);
  assert.ok(Number.isNaN(result.series[0]!.low[0]!), "no band when none was asked for");
  assert.equal(result.rows, 4);
});

test("categorical x sits in natural order; counting rows has no band", () => {
  const labels = ["Stage 10", "Stage 2", "Stage 1"];
  const x = Float64Array.from([0, 1, 2, 2, Number.NaN]);
  const result = computeRelLine({ ids: ids(5), x, xLabels: labels, y: null, hue: null, hueLabels: [], maxHues: 8, stat: "count", band: "ci" });
  assert.deepEqual(result.xLabels, ["Stage 1", "Stage 2", "Stage 10"]);
  assert.deepEqual([...result.series[0]!.center], [2, 1, 1]);
  assert.match(result.bandBlock ?? "", /Counts have no interval/);
});

test("many distinct x values are gathered into bands placed at their rows' average x", () => {
  const n = 1000;
  const x = Float64Array.from({ length: n }, (_, i) => i);
  const y = Float64Array.from({ length: n }, (_, i) => 2 * i);
  const result = computeRelLine({ ids: ids(n), x, xLabels: null, y, hue: null, hueLabels: [], maxHues: 8, stat: "mean", band: "sd" });
  assert.equal(result.binned, true);
  assert.equal(result.xs.length, RELLINE_BINS);
  // y = 2x, so each band's average y is twice its average x.
  for (let i = 0; i < result.xs.length; i++) assert.ok(Math.abs(result.series[0]!.center[i]! - 2 * result.xs[i]!) < 1e-9);
});

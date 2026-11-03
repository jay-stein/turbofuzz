import assert from "node:assert/strict";
import test from "node:test";
import { classBreaks, classCounts, classOf, varianceFit } from "../src/data/classify.js";

const near = (actual: readonly number[], expected: readonly number[], within = 1e-9): void => {
  assert.equal(actual.length, expected.length, `${actual} vs ${expected}`);
  actual.forEach((value, index) => assert.ok(Math.abs(value - expected[index]!) <= within, `${actual} vs ${expected}`));
};

// Three obvious clusters.
const clustered = [1, 2, 3, 50, 51, 52, 100, 101, 102];
// Jenks' own example from the literature on the method, checked by exhaustive search below.
const skewed = [4, 5, 9, 10, 11, 12, 20, 22, 24, 30, 70, 90, 95];

test("natural breaks find the gaps", () => {
  near(classBreaks(clustered, "natural", { classes: 3 }), [1, 3, 52, 102]);
});

test("natural breaks are the true optimum: no other partition has a smaller within-class spread", () => {
  const k = 3;
  const breaks = classBreaks(skewed, "natural", { classes: k });
  const ssd = (part: number[]): number => {
    const mean = part.reduce((a, b) => a + b, 0) / part.length;
    return part.reduce((sum, value) => sum + (value - mean) ** 2, 0);
  };
  const costOf = (cuts: number[]): number => {
    const parts = [skewed.slice(0, cuts[0]), skewed.slice(cuts[0], cuts[1]), skewed.slice(cuts[1])];
    return parts.reduce((sum, part) => sum + ssd(part), 0);
  };
  let best = Infinity;
  for (let a = 1; a < skewed.length - 1; a++) {
    for (let b = a + 1; b < skewed.length; b++) best = Math.min(best, costOf([a, b]));
  }
  const found = classCounts(skewed, breaks).counts;
  const cost = costOf([found[0]!, found[0]! + found[1]!]);
  assert.ok(Math.abs(cost - best) < 1e-9, `${cost} vs ${best}`);
});

test("each method does what it says", () => {
  near(classBreaks([0, 10, 20, 30, 40], "equal", { classes: 4 }), [0, 10, 20, 30, 40]);
  near(classBreaks([1, 2, 3, 4, 5, 6, 7, 8, 9], "quantile", { classes: 4 }), [1, 3, 5, 7, 9]);
  near(classBreaks([120, 980, 2400], "fixed", { classes: 5, interval: 500 }), [0, 500, 1000, 1500, 2000, 2500]);
  near(classBreaks([3, 47, 96], "pretty", { classes: 4 }), [0, 25, 50, 75, 100]);
  near(classBreaks([1, 10, 100, 1000], "log", { classes: 3 }), [1, 10, 100, 1000], 1e-9);
  near(classBreaks([5, 95], "continuous", { classes: 5 }), [5, 95]);
  near(classBreaks([5, 95], "manual", { classes: 5, manual: [50, 0, 100] }), [0, 50, 100]);
  // Standard deviation: population sd of 0..4 is √2; steps about the mean of 2, with the data's ends.
  near(classBreaks([0, 1, 2, 3, 4], "stddev", { classes: 5 }), [0, 2 - Math.SQRT2, 2, 2 + Math.SQRT2, 4]);
});

test("the data can leave fewer classes than asked, and blanks do not count", () => {
  near(classBreaks([1, 1, 1, 2, Number.NaN], "natural", { classes: 5 }), [1, 1, 2]);
  near(classBreaks([300, 600, 900], "natural", { classes: 5 }), [300, 300, 600, 900]);
  assert.deepEqual(classCounts([300, 600, 900], [300, 300, 600, 900]).counts, [1, 1, 1], "as few values as classes: each its own");
  near(classBreaks([1, 1, 1, 2], "quantile", { classes: 4 }), [1, 1.25 + 0, 2].slice(0, 0).concat([1, 1.25, 2]));
  assert.deepEqual(classBreaks([Number.NaN], "natural", { classes: 5 }), []);
  assert.deepEqual(classBreaks([7, 7], "equal", { classes: 5 }), [7, 7]);
});

test("a fixed step far too small for the range does not make thousands of classes", () => {
  assert.ok(classBreaks([0, 1_000_000], "fixed", { classes: 5, interval: 1 }).length <= 65);
});

test("a very long list is thinned for Jenks and stays quick", () => {
  const many = Float64Array.from({ length: 200_000 }, (_, i) => (i * 7919) % 10_007);
  const started = performance.now();
  const breaks = classBreaks(many, "natural", { classes: 5 });
  assert.equal(breaks.length, 6);
  assert.ok(performance.now() - started < 2500, `took ${performance.now() - started} ms`);
});

test("a value's class: first includes its lower edge, each its upper; outside and blank are -1", () => {
  const breaks = [0, 10, 20];
  assert.equal(classOf(0, breaks), 0);
  assert.equal(classOf(10, breaks), 0);
  assert.equal(classOf(10.1, breaks), 1);
  assert.equal(classOf(20, breaks), 1);
  assert.equal(classOf(21, breaks), -1);
  assert.equal(classOf(Number.NaN, breaks), -1);
  assert.deepEqual(classCounts([0, 5, 15, 25, Number.NaN], breaks), { counts: [2, 1], outside: 1, missing: 1 });
});

test("variance fit rewards classes that follow the data", () => {
  const good = varianceFit(clustered, classBreaks(clustered, "natural", { classes: 3 }));
  const poor = varianceFit(clustered, [1, 2, 3, 102]);
  assert.ok(good > 0.99);
  assert.ok(poor < good);
});

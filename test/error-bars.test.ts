import assert from "node:assert/strict";
import test from "node:test";
import {
  bootstrapIntervals,
  defaultInterval,
  formulaInterval,
  groupSeed,
  intervalBlock,
  medianRanks,
  statisticBlock,
  t975,
  type GroupInterval,
} from "../src/data/error-bars.js";

const near = (actual: number, expected: number, within: number, what = ""): void => {
  assert.ok(Math.abs(actual - expected) <= within, `${what} ${actual} is not within ${within} of ${expected}`);
};

const go = async (): Promise<boolean> => true;
const oneToTen = Float64Array.from({ length: 10 }, (_, i) => i + 1);

test("t's 97.5% point matches published values, in the table and beyond it", () => {
  assert.equal(t975(1), 12.706);
  assert.equal(t975(9), 2.262);
  near(t975(40), 2.021, 0.001, "df 40");
  near(t975(120), 1.98, 0.001, "df 120");
  near(t975(1_000_000), 1.96, 0.001, "df huge");
});

test("the average's bars by hand: 1 to 10", () => {
  // mean 5.5, s = 3.02765, se = 0.95743, t(9) = 2.262
  const ci = formulaInterval(oneToTen, "ci", "mean");
  assert.equal(ci.n, 10);
  assert.equal(ci.center, 5.5);
  near(ci.low, 5.5 - 2.262 * 0.95743, 1e-3, "low");
  near(ci.high, 5.5 + 2.262 * 0.95743, 1e-3, "high");
  near(formulaInterval(oneToTen, "se", "mean").high, 5.5 + 0.95743, 1e-4, "se");
  near(formulaInterval(oneToTen, "sd", "mean").high, 5.5 + 3.02765, 1e-4, "sd");
  const pi = formulaInterval(oneToTen, "pi", "mean");
  near(pi.low, 1.225, 1e-9, "pi low");
  near(pi.high, 9.775, 1e-9, "pi high");
});

test("the median's interval uses exact binomial ranks", () => {
  // n = 10: 2·P(X <= 1) = 0.0215 is within 5%; 2·P(X <= 2) = 0.109 is not. So x(2) to x(9), 1-based.
  assert.deepEqual(medianRanks(10), [1, 8]);
  const ci = formulaInterval(oneToTen, "ci", "median");
  assert.deepEqual([ci.center, ci.low, ci.high], [5.5, 2, 9]);
  assert.equal(medianRanks(5), null, "five rows cannot reach 95%: 2·(1/32) = 0.0625");
  assert.deepEqual(medianRanks(6), [0, 5], "six can: 2·(1/64) = 0.031");
  // Published table value: for n = 100 the 95% limits are the 40th and 61st values.
  assert.deepEqual(medianRanks(100), [39, 60]);
  const big = medianRanks(10_000)!;
  near(big[0], 4901, 2, "large n lower rank");
  near(big[1], 5099, 2, "large n upper rank");
});

test("too few rows give no bars rather than a made-up one", () => {
  const one = formulaInterval(Float64Array.of(7), "ci", "mean");
  assert.equal(one.center, 7);
  assert.ok(Number.isNaN(one.low) && Number.isNaN(one.high));
  assert.equal(formulaInterval(new Float64Array(0), "ci", "mean").n, 0);
});

test("what suits what: totals have no bars, and a p90 needs the bootstrap", () => {
  assert.match(statisticBlock("sum") ?? "", /no sampling error/);
  assert.match(statisticBlock("count") ?? "", /no sampling error/);
  assert.match(statisticBlock("max") ?? "", /no reliable interval/);
  assert.equal(statisticBlock("mean"), null);
  assert.equal(intervalBlock("se", "median"), "Only for an average");
  assert.equal(intervalBlock("ci", "median"), null);
  assert.equal(intervalBlock("bootstrap", "p90"), null);
  assert.match(intervalBlock("ci", "p90") ?? "", /use the bootstrap/);
  assert.equal(defaultInterval("mean"), "ci");
  assert.equal(defaultInterval("p90"), "bootstrap");
});

/** A fixed, roughly normal sample. */
function sample(n: number): Float64Array {
  let state = 12345;
  const next = (): number => {
    state = (Math.imul(state, 1_103_515_245) + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
  return Float64Array.from({ length: n }, () => 100 + 15 * (next() + next() + next() + next() + next() + next() - 3) * Math.SQRT2);
}

const run = async (values: Float64Array, agg: string, label = "a"): Promise<GroupInterval> =>
  (await bootstrapIntervals([{ label, values }], agg, go))![0]!;

test("on well-behaved data the bootstrap agrees with the formula", async () => {
  const values = sample(2000);
  const formula = formulaInterval(values, "ci", "mean");
  const boot = await run(values, "mean");
  assert.equal(boot.n, 2000);
  near(boot.center, formula.center, 1e-9, "centre");
  const width = formula.high - formula.low;
  near(boot.low, formula.low, width * 0.1, "low");
  near(boot.high, formula.high, width * 0.1, "high");
  near(boot.bootSe, width / (2 * 1.96), width * 0.05, "resampled spread");
});

test("the counting shortcut gives a median's interval like resampling and sorting does", async () => {
  const values = sample(300);
  const quick = await run(values, "median");
  // Brute force: the definition, with its own random numbers.
  let state = 99;
  const random = (): number => {
    state = (Math.imul(state, 1_103_515_245) + 12345) & 0x7fffffff;
    return state / 0x80000000;
  };
  const stats = Array.from({ length: 2000 }, () => {
    const draw = Float64Array.from(values, () => values[(random() * values.length) | 0]!).sort();
    return (draw[149]! + draw[150]!) / 2;
  }).sort((a, b) => a - b);
  const width = stats[1949]! - stats[50]!;
  near(quick.low, stats[50]!, width * 0.2, "low");
  near(quick.high, stats[1949]!, width * 0.2, "high");
  assert.ok(quick.low < quick.center && quick.center < quick.high);
  const p90 = await run(values, "p90");
  assert.ok(p90.low < p90.center && p90.center < p90.high);
  const sd = await run(values, "stddev");
  near(sd.center, formulaInterval(values, "sd", "mean").high - formulaInterval(values, "sd", "mean").center, 1e-9, "sd centre");
  assert.ok(sd.low < sd.center && sd.center < sd.high);
});

test("the same data gives the same bars every time, and a group's bars do not depend on the others", async () => {
  const values = sample(200);
  const first = await run(values, "median", "north");
  assert.deepEqual(await run(values, "median", "north"), first);
  const together = await bootstrapIntervals([{ label: "south", values: sample(50) }, { label: "north", values }], "median", go);
  assert.deepEqual(together![1], first);
  assert.notEqual(groupSeed("north"), groupSeed("south"));
});

test("progress reaches the end, and a false from the pulse stops the work", async () => {
  const values = sample(5000);
  const seen: number[] = [];
  const done = await bootstrapIntervals(
    [{ label: "a", values }],
    "mean",
    async (progress) => {
      seen.push(progress.done / progress.total);
      assert.equal(progress.groups, 1);
      assert.ok(progress.resample <= progress.resamples);
      return true;
    },
    1000,
    undefined,
    0,
  );
  assert.ok(done !== null);
  assert.ok(seen.length > 10, "it reports along the way");
  assert.ok(seen.every((share, i) => i === 0 || share >= seen[i - 1]!), "and only forwards");
  assert.equal(seen.at(-1), 1);
  let pulses = 0;
  const stopped = await bootstrapIntervals([{ label: "a", values }], "mean", async () => ++pulses < 3, 1000, undefined, 0);
  assert.equal(stopped, null);
  assert.equal(pulses, 3);
});

test("a group of one has no bars and costs nothing", async () => {
  const out = await bootstrapIntervals([{ label: "solo", values: Float64Array.of(3) }], "mean", go);
  assert.equal(out![0]!.n, 1);
  assert.ok(Number.isNaN(out![0]!.low));
});

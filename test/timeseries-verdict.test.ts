import { test } from "node:test";
import assert from "node:assert/strict";
import { CLEAR_WIN, ordinal, trustVerdict, VERDICT_LABEL, type VerdictInput } from "../src/data/timeseries/verdict.js";

const base: VerdictInput = {
  baseline: false, ratio: 0.62, lockRank: 2, models: 8, foldsWon: 8, foldsOf: 9,
  band: { hit: 24, tot: 30, aim: 0.8 }, rough: false, periods: 144, cycle: "year",
};

const Q1 = "Does it beat a simple method?", Q2 = "Is it the best available?", Q3 = "Can you trust the shaded band?";

test("ordinals read naturally, including the teens", () => {
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 101, 111].map(ordinal), ["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "101st", "111th"]);
});

test("the labels are the words people ask in: reliable, use with care, not reliable", () => {
  assert.deepEqual(VERDICT_LABEL, { holds: "Reliable", middling: "Use with care", untested: "Can't judge yet", baseline: "Baseline" });
});

test("a model that clearly beats the simple method on data it never saw is reliable, and the first answer says by how much", () => {
  const v = trustVerdict(base);
  assert.equal(v.level, "holds");
  assert.equal(v.label, "Reliable");
  assert.deepEqual(v.answers.map((a) => a.q), [Q1, Q2, Q3]);
  assert.deepEqual(v.answers[0], { q: Q1, a: "Yes, clearly", cls: "good", text: "38% less error than repeating the last year, winning 8 of 9 tests, including on data it never saw." });
  assert.equal(v.sentence, v.answers[0]!.text);
  assert.deepEqual(v.headsUp, []);
});

test("comprehensively means a clear margin: under 10% less error is only just", () => {
  assert.equal(CLEAR_WIN, 0.9);
  const edge = trustVerdict({ ...base, ratio: 0.9 });
  assert.equal(edge.level, "holds", "exactly 10% less error counts");
  const thin = trustVerdict({ ...base, ratio: 0.93 });
  assert.equal(thin.level, "middling");
  assert.equal(thin.label, "Use with care");
  assert.equal(thin.answers[0]!.a, "Only just");
  assert.match(thin.answers[0]!.text, /beats repeating the last year by only 7%/);
});

test("winning most tests is part of it: two thirds, or all of them when there are fewer than three", () => {
  assert.equal(trustVerdict({ ...base, foldsWon: 6, foldsOf: 9 }).level, "holds");
  const few = trustVerdict({ ...base, foldsWon: 5, foldsOf: 9 });
  assert.equal(few.level, "middling");
  assert.match(few.answers[0]!.text, /beat repeating the last year in only 5 of 9 tests/);
  assert.equal(trustVerdict({ ...base, foldsWon: 2, foldsOf: 2, rough: false }).level, "holds");
  assert.equal(trustVerdict({ ...base, foldsWon: 1, foldsOf: 2 }).level, "middling");
});

test("a simple method that did better on data it never saw is named, and the model is at most use-with-care", () => {
  const v = trustVerdict({ ...base, lockRank: 3, beatenBy: ["Repeat last value", "Drift"] });
  assert.equal(v.level, "middling");
  assert.match(v.answers[0]!.text, /^Repeat last value and Drift did better on data it never saw, so a simple method is hard to beat here/);
  assert.equal(trustVerdict({ ...base, beatenBy: [] }).level, "holds");
  // The benchmark itself is never told it was beaten by a benchmark.
  assert.equal(trustVerdict({ ...base, baseline: true, beatenBy: ["Overall average"] }).level, "baseline");
});

test("no edge over the simple method is use-with-care, not a red alarm: there is no evidence either way, and the simple method is named as a safe alternative", () => {
  const v = trustVerdict({ ...base, ratio: 1.04 });
  assert.equal(v.level, "middling");
  assert.equal(v.label, "Use with care");
  assert.equal(v.cls, "okay");
  assert.equal(v.answers[0]!.a, "Not shown");
  assert.match(v.answers[0]!.text, /did no better than repeating the last year, so there is no evidence it adds value here.*a safe alternative/);
  // There is no "not reliable" level at all: the calibration found no backtest signal that picks out losers.
  for (const input of [{ ...base, ratio: 1.6 }, { ...base, ratio: 3, foldsWon: 0, lockRank: 8 }, { ...base, lockRank: 8 }]) {
    assert.notEqual(trustVerdict(input).level, "doubtful" as never);
    assert.ok(["holds", "middling"].includes(trustVerdict(input).level));
  }
});

test("a model that fell into the bottom third on data it never saw cannot be reliable, and the reason is given", () => {
  const v = trustVerdict({ ...base, lockRank: 7, ratio: 0.5 });
  assert.equal(v.level, "middling");
  assert.match(v.answers[0]!.text, /It ranked 7th of 8 models on data it never saw/);
});

test("reliable and the best are separate answers: a reliable model can rank mid-table, and its place is said without alarm", () => {
  const v = trustVerdict({ ...base, lockRank: 5, leader: { name: "Theta", gapPct: 12 } });
  assert.equal(v.level, "holds", "it beats the simple method clearly, so it is reliable");
  assert.equal(v.answers[1]!.a, "No");
  assert.equal(v.answers[1]!.cls, "okay", "never red: red is for failing the simple-method test");
  assert.match(v.answers[1]!.text, /Ranked 5th of 8 models on data it never saw\. Theta, the lowest-error model, had 12% less error in the backtests/);
});

test("without a test held back it can never be called reliable, and says why", () => {
  const v = trustVerdict({ ...base, lockRank: null, ratio: 0.5 });
  assert.equal(v.level, "middling");
  assert.match(v.answers[0]!.text, /too little history to hold a test back/);
  assert.equal(v.answers[1]!.a, "Can't tell yet");
});

test("is it the best available: first place, a close second, a better one worth a look, and a clearly worse place", () => {
  assert.deepEqual([trustVerdict({ ...base, lockRank: 1 }).answers[1]!.a, trustVerdict({ ...base, lockRank: 1 }).answers[1]!.text], ["Yes", "The best of the 8 models tried, on data it never saw."]);
  const level = trustVerdict({ ...base, lockRank: 2, leader: { name: "Theta", gapPct: 2.4 } }).answers[1]!;
  assert.equal(level.a, "About level");
  assert.match(level.text, /Ranked 2nd of 8 models on data it never saw\. Theta, the lowest-error model, did about the same \(2% less error in the backtests\)/);
  const close = trustVerdict({ ...base, lockRank: 2, leader: { name: "Theta", gapPct: 14 } }).answers[1]!;
  assert.equal(close.a, "Close");
  assert.match(close.text, /Theta, the lowest-error model, had 14% less error in the backtests, so it is worth a look/);
  const worse = trustVerdict({ ...base, lockRank: 5, leader: { name: "Theta", gapPct: 30 } }).answers[1]!;
  assert.equal(worse.a, "No");
  assert.equal(worse.cls, "okay");
});

test("the shaded band is judged on its own; an untested or short-holding band caps the badge, a wide one does not", () => {
  const ok = trustVerdict({ ...base, band: { hit: 25, tot: 30, aim: 0.8 } }).answers[2]!;
  assert.deepEqual([ok.q, ok.a, ok.cls], [Q3, "Yes", "good"]);
  assert.equal(ok.text, "It should hold the real number about 80% of the time, and in past tests it held 83% of the time.");
  const narrow = trustVerdict({ ...base, band: { hit: 22, tot: 30, aim: 0.8 } });
  assert.equal(narrow.answers[2]!.a, "Treat it as a minimum");
  assert.match(narrow.answers[2]!.text, /held only 73% of the time\. The real number may stray further than the band shows/);
  const wide = trustVerdict({ ...base, band: { hit: 29, tot: 30, aim: 0.8 } }).answers[2]!;
  assert.equal(wide.a, "Wider than needed");
  assert.match(wide.text, /97%.*usually well inside/);
  // Too few checks to judge a band: it says it is untested, and the verdict is untouched.
  const few = trustVerdict({ ...base, band: { hit: 3, tot: 10, aim: 0.8 } }).answers[2]!;
  assert.equal(few.a, "Not yet tested");
  assert.equal(trustVerdict({ ...base, band: null }).answers[2]!.a, "Not yet tested");
  assert.equal(trustVerdict(base).level, "holds");
  assert.equal(narrow.level, "middling", "a range that held 73% against an aim of 80% is not reliable");
  assert.match(narrow.why, /shaded range has held less often than it aims to/);
  assert.equal(narrow.sentence, trustVerdict(base).sentence, "the sentence about the forecast itself is unchanged");
  assert.equal(trustVerdict({ ...base, band: { hit: 29, tot: 30, aim: 0.8 } }).level, "holds", "a range wider than needed is safe");
  const untested = trustVerdict({ ...base, band: null });
  assert.equal(untested.level, "middling");
  assert.match(untested.why, /shaded range is not yet tested/);
  assert.deepEqual(narrow.headsUp, []);
});

test("the benchmark itself is the baseline, with one answer", () => {
  const v = trustVerdict({ ...base, baseline: true, ratio: 1 });
  assert.equal(v.level, "baseline");
  assert.equal(v.answers.length, 1);
  assert.match(v.sentence, /repeats the last year/);
});

test("too little history to test at all is can't-judge-yet, with no evidence claimed", () => {
  const v = trustVerdict({ ...base, ratio: Number.NaN, lockRank: null, foldsOf: 0, foldsWon: 0, periods: 14, rough: true });
  assert.equal(v.level, "untested");
  assert.equal(v.label, "Can't judge yet");
  assert.match(v.sentence, /Only 14 periods of history.*no evidence it works/);
});

test("other notes appear only when they are true", () => {
  assert.deepEqual(trustVerdict(base).headsUp, []);
  const short = trustVerdict({ ...base, rough: true, periods: 22 });
  assert.ok(short.headsUp.some((h) => /only 22 periods of history/.test(h)));
  assert.notEqual(short.level, "holds", "a rough test cannot make a forecast reliable");
  assert.ok(trustVerdict({ ...base, intermittent: true }).headsUp.some((h) => /most periods have no sales/.test(h)));
});

test("every sentence is plain: no model-selection jargon on the surface", () => {
  const all = [base, { ...base, ratio: 0.95 }, { ...base, ratio: 1.1 }, { ...base, lockRank: null }, { ...base, lockRank: 6, leader: { name: "Theta", gapPct: 20 } }, { ...base, beatenBy: ["Repeat last value"] }];
  for (const input of all) {
    const v = trustVerdict(input);
    const text = [v.label, ...v.answers.flatMap((a) => [a.q, a.a, a.text]), ...v.headsUp.filter((h) => !/MASE/.test(h))].join(" ");
    assert.doesNotMatch(text, /lockbox|fold\b|AICc|MASE|naive|ratio|p-value|significan/i, text);
  }
});

test("the yardstick is the best simple method, so beating a weak one proves nothing", () => {
  // On noise, repeating the last year is a poor method and the plain average is a good one: 27% better than the first can be no better than the second.
  const noise = trustVerdict({ ...base, ratio: 0.73, bestSimple: { name: "Overall average", ratio: 0.72 } });
  assert.equal(noise.level, "middling");
  assert.match(noise.answers[0]!.text, /did no better than the simple "Overall average" method.*a safe alternative/);
  assert.equal(noise.why, 'no better than the simple "Overall average" method');
  // The same model against a simple method it really does beat: reliable, and the sentence names the one it beat.
  const real = trustVerdict({ ...base, ratio: 0.62, bestSimple: { name: "Overall average", ratio: 0.75 } });
  assert.equal(real.level, "holds");
  assert.equal(real.answers[0]!.text, '17% less error than the simple "Overall average" method, and it beat repeating the last year in 8 of 9 tests, including on data it never saw.');
  assert.equal(real.why, '17% less error than the simple "Overall average" method');
  // A simple method no better than repeating the last cycle changes nothing.
  assert.equal(trustVerdict({ ...base, bestSimple: { name: "Overall average", ratio: 1.3 } }).why, "38% less error than repeating the last year");
  assert.equal(trustVerdict({ ...base, bestSimple: null }).why, "38% less error than repeating the last year");
  // And the one-word "why" for the strip never claims more than the verdict does.
  assert.equal(trustVerdict({ ...base, ratio: Number.NaN, lockRank: null, foldsOf: 0, foldsWon: 0 }).why, "too little history to test");
  assert.equal(trustVerdict({ ...base, baseline: true }).why, "the yardstick");
});

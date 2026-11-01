import { test } from "node:test";
import assert from "node:assert/strict";
import { ordinal, trustVerdict, type VerdictInput } from "../src/data/timeseries/verdict.js";

const base: VerdictInput = {
  baseline: false, ratio: 0.62, lockRank: 2, models: 8, foldsWon: 8, foldsOf: 9,
  band: { hit: 24, tot: 30, aim: 0.8 }, rough: false, periods: 144, cycle: "year",
};

test("ordinals read naturally, including the teens", () => {
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 101, 111].map(ordinal), ["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "101st", "111th"]);
});

test("a top-two model that beat the benchmark in most tests holds up, and the sentence says why", () => {
  const v = trustVerdict(base);
  assert.equal(v.level, "holds");
  assert.equal(v.label, "Holds up");
  assert.equal(v.cls, "good");
  assert.equal(v.sentence, "Did well on data it never saw (2nd of 8 models) and beat repeating the last year in 8 of 9 tests.");
  assert.deepEqual(v.headsUp, []);
});

test("a middle-ranked model is middling", () => {
  const v = trustVerdict({ ...base, lockRank: 4, foldsWon: 5 });
  assert.equal(v.level, "middling");
  assert.match(v.sentence, /4th of 8 models/);
  assert.match(v.sentence, /partly luck/);
});

test("a model in the bottom third on unseen data is doubtful, even with a good backtest ratio", () => {
  const v = trustVerdict({ ...base, lockRank: 7 });
  assert.equal(v.level, "doubtful");
  assert.equal(v.cls, "poor");
  assert.match(v.sentence, /Fell apart on data it never saw \(7th of 8 models\)/);
  // The boundary: 5 of 8 is middling, 6 of 8 is doubtful.
  assert.equal(trustVerdict({ ...base, lockRank: 5 }).level, "middling");
  assert.equal(trustVerdict({ ...base, lockRank: 6 }).level, "doubtful");
});

test("a model no better than repeating the last cycle is doubtful whatever its rank", () => {
  const v = trustVerdict({ ...base, ratio: 1.04, lockRank: 1 });
  assert.equal(v.level, "doubtful");
  assert.match(v.sentence, /no better than simply repeating the last year/i);
});

test("the benchmark itself is the baseline", () => {
  const v = trustVerdict({ ...base, baseline: true, ratio: 1, lockRank: 8 });
  assert.equal(v.level, "baseline");
  assert.equal(v.cls, "base");
  assert.match(v.sentence, /repeats the last year/);
});

test("with no fold to hold back, the verdict rests on the backtests and says it is less certain", () => {
  const good = trustVerdict({ ...base, lockRank: null, ratio: 0.6 });
  assert.equal(good.level, "holds");
  assert.match(good.sentence, /40%/);
  assert.match(good.sentence, /too little history to hold one back/);
  assert.equal(trustVerdict({ ...base, lockRank: null, ratio: 0.9 }).level, "middling");
  assert.equal(trustVerdict({ ...base, lockRank: null, ratio: 1.2 }).level, "doubtful");
});

test("heads-up notes appear only when they are true", () => {
  assert.deepEqual(trustVerdict(base).headsUp, []);
  const narrow = trustVerdict({ ...base, band: { hit: 22, tot: 30, aim: 0.8 } });
  assert.match(narrow.headsUp[0]!, /73% of the time against an aim of 80%.*slightly narrow/);
  const wide = trustVerdict({ ...base, band: { hit: 29, tot: 30, aim: 0.8 } });
  assert.match(wide.headsUp[0]!, /97%.*wider than it needs to be/);
  // Too few checks to judge a band: nothing said.
  assert.deepEqual(trustVerdict({ ...base, band: { hit: 3, tot: 10, aim: 0.8 } }).headsUp, []);
  const luck = trustVerdict({ ...base, foldsWon: 3, foldsOf: 9 });
  assert.ok(luck.headsUp.some((h) => /3 of 9 tests.*luck/.test(h)));
  assert.notEqual(luck.level, "holds");
  const short = trustVerdict({ ...base, rough: true, periods: 22 });
  assert.ok(short.headsUp.some((h) => /only 22 periods of history/.test(h)));
});

test("a simple benchmark that beat the pick on unseen data is named in a heads-up", () => {
  const v = trustVerdict({ ...base, beatenBy: ["Repeat last value", "Simple smoothing"] });
  assert.ok(v.headsUp.some((h) => /Repeat last value and Simple smoothing did better than this forecast on data it never saw/.test(h)));
  assert.deepEqual(trustVerdict({ ...base, beatenBy: [] }).headsUp, []);
  // The benchmark itself is never told it was beaten by a benchmark.
  assert.deepEqual(trustVerdict({ ...base, baseline: true, beatenBy: ["Overall average"] }).headsUp, []);
});

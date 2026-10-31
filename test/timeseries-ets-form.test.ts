import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { etsFitted, etsSelect, etsSpec, fitSes, type EtsFit } from "../src/data/timeseries/ets.js";

interface Case { name: string; error: "A" | "M"; trend: "N" | "A" | "Ad"; season: "N" | "A" | "M"; a: number; be: number; ga: number; ph: number; l0: number; b0: number; s0: number[]; fitted: number[] }
const ref = JSON.parse(readFileSync("test/fixtures/ets-reference.json", "utf8")) as { m: number; y: number[]; cases: Case[] };
const y = Float64Array.from(ref.y), n = y.length;
const fitOf = (c: Case, s0: number[] = c.s0): EtsFit => ({ error: c.error, trend: c.trend, season: c.season, m: c.season === "N" ? 1 : ref.m, a: c.a, be: c.be, ga: c.ga, ph: c.ph, init: { l: c.l0, b: c.b0, s: Float64Array.from(s0) }, aicc: 0, loglik: 0, tried: 0 });
const maxRelDiff = (a: ArrayLike<number>, b: ArrayLike<number>): number => { let d = 0; for (let t = 0; t < n; t++) d = Math.max(d, Math.abs(a[t]! - b[t]!) / Math.abs(b[t]!)); return d; };

test("the innovations-form recursions match statsmodels' ETSModel for every non-seasonal and additive-season form", () => {
  const cases = ref.cases.filter((c) => c.season !== "M");
  assert.equal(cases.length, 7);
  for (const c of cases) {
    const out = new Float64Array(n);
    etsFitted(y, 0, n, fitOf(c), out);
    assert.ok(maxRelDiff(out, c.fitted) < 1e-9, `${c.name}: ${maxRelDiff(out, c.fitted)}`);
  }
});

test("multiplicative seasons follow fpp3 8.3 and R: the season is updated with the previous level (statsmodels uses the current one)", () => {
  const cases = ref.cases.filter((c) => c.season === "M");
  assert.equal(cases.length, 2);
  for (const c of cases) {
    // The component form of fpp3 section 8.3, written out independently of the code under test:
    //   l_t = a y_t / s_{t-m} + (1 - a)(l_{t-1} + phi b_{t-1}); b_t = (be / a)(l_t - l_{t-1}) + (1 - be / a) phi b_{t-1}
    //   s_t = g y_t / (l_{t-1} + phi b_{t-1}) + (1 - g) s_{t-m}; forecast (l + phi b) s
    const m = ref.m, damped = c.trend === "N" ? 0 : c.ph;
    let l = c.l0, b = c.b0;
    const s = [...c.s0], mine = new Float64Array(n);
    for (let t = 0; t < n; t++) {
      const k = t % m, q = l + damped * b;
      mine[t] = q * s[k]!;
      const ln = c.a * (y[t]! / s[k]!) + (1 - c.a) * q;
      if (c.trend !== "N") b = damped * b + (c.be / c.a) * (ln - q);
      s[k] = c.ga * (y[t]! / q) + (1 - c.ga) * s[k]!;
      l = ln;
    }
    const out = new Float64Array(n);
    etsFitted(y, 0, n, fitOf(c), out);
    assert.ok(maxRelDiff(out, mine) < 1e-9, `${c.name}: ${maxRelDiff(out, mine)}`);
    // And it is not statsmodels' recursion, which differs by a few percent on this series.
    assert.ok(maxRelDiff(out, c.fitted) > 1e-3, `${c.name} unexpectedly equals statsmodels`);
  }
});

test("selection finds the form that generated the data", () => {
  let seed = 4;
  const rnd = (): number => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31 - 0.5);
  const make = (f: (t: number) => number, len = 96): Float64Array => Float64Array.from({ length: len }, (_, t) => f(t));
  // Growing swing: multiplicative season.
  const mult = etsSelect(make((t) => (100 + 1.2 * t) * (1 + 0.25 * Math.sin((2 * Math.PI * t) / 12)) * (1 + 0.01 * rnd())), 0, 96, 12);
  assert.equal(mult.season, "M", etsSpec(mult));
  // Constant swing on a straight trend: an additive season and a trend.
  const add = etsSelect(make((t) => 100 + 2 * t + 20 * Math.sin((2 * Math.PI * t) / 12) + 1.5 * rnd()), 0, 96, 12);
  assert.equal(add.season, "A", etsSpec(add));
  assert.notEqual(add.trend, "N", etsSpec(add));
  // Noise around a level: no trend and no season.
  const flat = etsSelect(make(() => 50 + 4 * rnd()), 0, 96, 12);
  assert.equal(etsSpec(flat).endsWith("N,N"), true, etsSpec(flat));
  assert.equal(mult.tried, 15);
});

test("a non-positive series is fitted with additive errors and no multiplicative parts", () => {
  const z = Float64Array.from({ length: 80 }, (_, t) => -5 + 0.05 * t + Math.sin(t / 3));
  const fit = etsSelect(z, 0, 80, 12);
  assert.equal(fit.error, "A");
  assert.notEqual(fit.season, "M");
  assert.equal(fit.tried, 6, "A errors with N or A seasons and three trends");
});

test("simple exponential smoothing by maximum likelihood recovers a smoothing parameter and the level", () => {
  let seed = 8;
  const rnd = (): number => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31 - 0.5) * 2;
  const alpha = 0.4;
  let level = 100;
  const z = new Float64Array(400);
  for (let t = 0; t < 400; t++) { const e = rnd(); z[t] = level + e; level += alpha * e; }
  const fit = fitSes(z, 400);
  assert.ok(Math.abs(fit.alpha - alpha) < 0.12, `alpha ${fit.alpha}`);
  assert.ok(Math.abs(fit.level - level) < 1.5, `level ${fit.level} vs ${level}`);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  armaLik, autoArimaSearch, chooseDifferences, difference, diffPoly, expandAr, expandMa, fitArima, forecastArima, invPartrans,
  isStationary, kpssLevel, maInvert, partrans, polyRoots, residualCheck, seasonalStrength, specLabel, type ArimaSpec,
} from "../src/data/timeseries/arima.js";

const ref = JSON.parse(readFileSync("test/fixtures/arima-reference.json", "utf8")) as {
  series: Record<string, number[]>;
  fits: { series: string; order: number[]; seasonal: number[]; constant: boolean; params: Record<string, number>; llf: number }[];
  auto: { series: string; m: number; arma: number[]; aicc: number; forecast: number[] }[];
};
const near = (a: number, b: number, eps: number, msg = ""): void => assert.ok(Math.abs(a - b) < eps, `${msg} ${a} vs ${b}`);
const spec = (p: number, d: number, q: number, P = 0, D = 0, Q = 0, m = 1, constant = false): ArimaSpec => ({ p, d, q, P, D, Q, m, constant });
const AIR = ref.series.air!, LOGAIR = ref.series.logair!;

test("differencing and the expanded polynomials", () => {
  assert.deepEqual(Array.from(difference([1, 4, 9, 16, 25], 1, 0, 1)).slice(1), [3, 5, 7, 9]);
  assert.deepEqual(Array.from(difference([1, 4, 9, 16, 25], 2, 0, 1)).slice(2), [2, 2, 2]);
  assert.deepEqual(Array.from(difference([1, 2, 3, 4, 5, 6], 0, 1, 2)).slice(2), [2, 2, 2, 2]);
  const gap = difference([1, NaN, 3, 4], 1, 0, 1);
  assert.ok(Number.isNaN(gap[1]) && Number.isNaN(gap[2]), "a missing value spoils the differences that touch it");
  assert.deepEqual(diffPoly(1, 1, 4), [1, -1, 0, 0, -1, 1]);
  // (1 - 0.5 B)(1 - 0.3 B^4) = 1 - 0.5 B - 0.3 B^4 + 0.15 B^5
  const ar = expandAr([0.5], [0.3], 4);
  const tidy = (a: number[]): number[] => a.map((v) => Math.round(v * 1e9) / 1e9 + 0);
  assert.deepEqual(tidy(ar), [0.5, 0, 0, 0.3, -0.15]);
  assert.deepEqual(tidy(expandMa([0.4], [0.6], 4)), [0.4, 0, 0, 0.6, 0.24]);
});

test("the stationary mapping round-trips, and the stationarity and invertibility tests agree with it", () => {
  for (const raw of [[0.3], [0.5, -0.4], [1.2, -0.8, 0.5], [-2, 0.1, 0.7, -0.3]]) {
    const phi = partrans(raw);
    assert.ok(isStationary(phi), `partrans ${raw} is stationary`);
    const back = invPartrans(phi)!;
    back.forEach((v, i) => near(v, raw[i]!, 1e-9));
  }
  assert.ok(!isStationary([1.1]) && !isStationary([0.6, 0.5]) && isStationary([0.5, 0.3]));
  assert.equal(invPartrans([1.2]), null);
  near(maInvert([2])[0]!, 0.5, 1e-9);
  near(maInvert([0.4])[0]!, 0.4, 1e-12);
  // MA(2) with a root pair inside the circle: the reflection has the same autocorrelations and is invertible.
  const inv = maInvert([1.5, 1.2]);
  assert.ok(isStationary(inv.map((v) => -v)), "reflected MA is invertible");
  const acf1 = (t: number[]): number => { const g0 = 1 + t[0]! ** 2 + t[1]! ** 2; return (t[0]! + t[0]! * t[1]!) / g0; };
  near(acf1(inv), acf1([1.5, 1.2]), 1e-9);
  const roots = polyRoots([6, -5, 1]); // (z - 2)(z - 3)
  assert.deepEqual(roots.map((r) => Math.round(r[0] * 1e6) / 1e6).sort(), [2, 3]);
});

test("the Kalman likelihood is the exact AR(1) likelihood", () => {
  const phi = 0.6, z = Float64Array.from([1.2, 0.7, -0.4, 0.9, 1.5, 0.3, -0.8, 0.2]);
  const l = armaLik(z, [phi], [])!;
  let ssq = z[0]! * z[0]! * (1 - phi * phi);
  for (let t = 1; t < z.length; t++) ssq += (z[t]! - phi * z[t - 1]!) ** 2;
  near(l.ssq, ssq, 1e-9);
  near(l.sumLogF, -Math.log(1 - phi * phi), 1e-9);
  assert.equal(l.n, z.length);
  // A missing value is skipped, not scored.
  const gap = Float64Array.from(z); gap[3] = NaN;
  assert.equal(armaLik(gap, [phi], [])!.n, z.length - 1);
});

test("fixed-order fits match statsmodels' exact likelihood and estimates", () => {
  for (const f of ref.fits) {
    const [p, d, q] = f.order as [number, number, number], [P, D, Q, m] = f.seasonal as [number, number, number, number];
    const s = spec(p, d, q, P, D, Q, m || 1, f.constant);
    const fit = fitArima(ref.series[f.series]!, s)!;
    assert.ok(fit, `${f.series} ${specLabel(s)} fitted`);
    near(fit.loglik, f.llf, 0.02, `${f.series} ${specLabel(s)} loglik`);
    // statsmodels names the estimates ar.L1, ma.L1, ar.S.L12, ma.S.L12 and intercept.
    const theirs = Object.entries(f.params).filter(([k]) => k !== "sigma2");
    const pick = (re: RegExp): number[] => theirs.filter(([k]) => re.test(k)).map(([, v]) => v);
    const ours = (re: RegExp): number[] => fit.coefs.filter((c) => re.test(c.name)).map((c) => c.value);
    for (const [a, b] of [[/^ar\.L/, /^ar\d/], [/^ma\.L/, /^ma\d/], [/^ar\.S/, /^sar/], [/^ma\.S/, /^sma/]] as [RegExp, RegExp][]) {
      const x = pick(a), y = ours(b);
      assert.equal(y.length, x.length, `${f.series} count of ${b}`);
      x.forEach((v, i) => near(y[i]!, v, 0.02, `${f.series} ${b}`));
    }
    // statsmodels reports the intercept c of y_t = c + phi y_{t-1} + e; we report the mean mu = c / (1 - sum of the AR coefficients).
    if (f.constant) near(fit.mu * (1 - fit.ar.reduce((a, b) => a + b, 0)), pick(/^(intercept|drift)$/)[0]!, 0.03, `${f.series} constant`);
  }
});

test("the airline model on the log passengers: the textbook coefficients, likelihood and standard errors", () => {
  const fit = fitArima(LOGAIR, spec(0, 1, 1, 0, 1, 1, 12), { se: true })!;
  near(fit.coefs[0]!.value, -0.4018, 0.001); near(fit.coefs[1]!.value, -0.5569, 0.001);
  near(fit.sigma2, 0.001348, 0.00001);
  near(fit.loglik, 244.7, 0.05); near(fit.aic, -483.4, 0.05);
  near(fit.coefs[0]!.se!, 0.0896, 0.003); near(fit.coefs[1]!.se!, 0.0731, 0.003);
  assert.equal(fit.k, 3);
  assert.equal(fit.nUsed, 131);
});

test("the automatic search reproduces R's auto.arima on the passengers and never does worse than statsforecast's", () => {
  const raw = autoArimaSearch(AIR, 12, 1, 1)!;
  assert.equal(specLabel(raw.best.spec), "ARIMA(2,1,1)(0,1,0)[12]");
  near(raw.best.coefs[0]!.value, 0.596, 0.002); near(raw.best.coefs[1]!.value, 0.2143, 0.002); near(raw.best.coefs[2]!.value, -0.9819, 0.002);
  near(raw.best.loglik, -504.92, 0.05); near(raw.best.aicc, 1018.17, 0.05);
  const dl = chooseDifferences(LOGAIR, 12);
  const air = autoArimaSearch(LOGAIR, 12, dl.d, dl.D)!;
  assert.equal(specLabel(air.best.spec), "ARIMA(0,1,1)(0,1,1)[12]");
  for (const a of ref.auto) {
    const y = ref.series[a.series]!, dd = chooseDifferences(y, a.m);
    assert.equal(dd.d, a.arma[5], `${a.series} d`);
    assert.equal(dd.D, a.arma[6], `${a.series} D`);
    const s = autoArimaSearch(y, a.m, dd.d, dd.D)!;
    assert.ok(s.best.aicc <= a.aicc + 0.05, `${a.series}: ours ${s.best.aicc} against statsforecast's ${a.aicc}`);
  }
});

test("the number of differences: a random walk needs one, white noise none, a seasonal series a seasonal one", () => {
  assert.equal(chooseDifferences(ref.series.walk!, 1).d, 1);
  assert.equal(chooseDifferences(ref.series.ar1!, 1).d, 0);
  assert.ok(kpssLevel(ref.series.ar1!) < 0.463 && kpssLevel(ref.series.walk!) > 0.463);
  assert.equal(chooseDifferences(AIR, 12).D, 1);
  assert.ok(seasonalStrength(AIR, 12) > 0.64);
  const noise = Array.from({ length: 120 }, (_, i) => (Math.sin(i * 12.9898) * 43758.5453) % 1);
  assert.ok(seasonalStrength(noise, 12) < 0.64);
});

test("forecasts: the point path and the analytic intervals follow the psi weights", () => {
  const fit = fitArima(LOGAIR, spec(0, 1, 1, 0, 1, 1, 12))!;
  const fc = forecastArima(LOGAIR, fit, 12);
  // Against statsforecast's airline forecast (its coefficients differ in the third decimal).
  const theirs = ref.auto.find((a) => a.series === "logair")!.forecast;
  fc.F.forEach((v, i) => near(v, theirs[i]!, 0.004, `h=${i + 1}`));
  // The first step's variance is sigma^2; the second adds psi_1^2 = (1 + theta_1)^2.
  near(fc.se[0]!, Math.sqrt(fit.sigma2), 1e-12);
  near(fc.se[1]!, Math.sqrt(fit.sigma2 * (1 + (1 + fit.coefs[0]!.value) ** 2)), 1e-9);
  for (let h = 1; h < 12; h++) assert.ok(fc.se[h]! >= fc.se[h - 1]!, "the range never narrows");
  near(fc.hi80[0]! - fc.F[0]!, 1.2815516 * fc.se[0]!, 1e-9);
  near(fc.hi95[3]! - fc.F[3]!, 1.959964 * fc.se[3]!, 1e-9);
});

test("a drift carries the forecast on: a series with drift extends along its slope", () => {
  const y = Array.from({ length: 80 }, (_, i) => 10 + 2 * i + ((i * 7919) % 5) * 0.2);
  const fit = fitArima(y, spec(0, 1, 0, 0, 0, 0, 1, true))!;
  near(fit.coefs[0]!.value, 2, 0.05);
  const fc = forecastArima(y, fit, 4);
  near(fc.F[3]! - fc.F[0]!, 3 * fit.coefs[0]!.value, 1e-6);
});

test("missing values are bridged by the filter and not scored", () => {
  const y = ref.series.arma11!.slice();
  const full = fitArima(y, spec(1, 0, 1, 0, 0, 0, 1, true))!;
  y[40] = NaN; y[41] = NaN; y[90] = NaN;
  const gap = fitArima(y, spec(1, 0, 1, 0, 0, 0, 1, true))!;
  assert.equal(gap.nUsed, full.nUsed - 3);
  near(gap.phi[0]!, full.phi[0]!, 0.1);
  assert.ok(forecastArima(y, gap, 6).F.every(Number.isFinite));
});

test("the residual check, and exhaustive search never ending above the stepwise one", () => {
  const fit = fitArima(LOGAIR, spec(0, 1, 1, 0, 1, 1, 12))!;
  const rc = residualCheck(fit)!;
  assert.equal(rc.lag, 24);
  assert.ok(rc.p > 0 && rc.p <= 1 && rc.acf.length >= 24 && rc.n > 100);
  const y = ref.series.ar1!;
  const step = autoArimaSearch(y, 1, 0, 0)!, all = autoArimaSearch(y, 1, 0, 0, { exhaustive: true })!;
  assert.ok(all.best.aicc <= step.best.aicc + 1e-9);
  assert.ok(all.tried.length > step.tried.length);
});

test("a series too short for the model is declined, not guessed", () => {
  assert.equal(fitArima([1, 2, 3, 2, 1, 2], spec(2, 0, 2, 1, 0, 1, 12)), null);
});

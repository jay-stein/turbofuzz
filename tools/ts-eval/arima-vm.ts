/**
 * Variogram-matched ARIMA: an estimator, new as far as we could find, that fits the coefficients of each model AutoARIMA chose so that
 * the model reproduces how far the series really travels over 1, 2, ... h steps, not only how well it predicts one step ahead.
 *
 * Maximum likelihood is the one-step forecast error in disguise. The h-step forecast and its range depend on the variogram
 * V(k) = E[(u_{t+k} - u_t)^2] of the series, which the model implies exactly through the autocovariances of its differenced series w:
 *   if the model differences at least once (u is one integration short of w): V(k) = k g0 + 2 sum_{j<k} (k - j) gj
 *   if it does not (u = w):                                                  V(k) = 2 (g0 - gk)
 * The estimate minimises  -loglik / n  +  lambda * mean_k (log V_model(k) - log V_data(k))^2,  started at the ML estimate; the order,
 * differencing and Akaike weights are left as AutoARIMA chose them. Scored against the shipped version on random Monash series:
 * accuracy (MASE) and how often the 80% range held the actual.
 *
 *   npx tsx tools/ts-eval/arima-vm.ts <folder of .tsf files> [count=100] [seed=21] [lambdas=0.5,2,8]
 */

import { join } from "node:path";
import {
  akaikeWeights, armaLik, autoArimaSearch, averageForecasts, bfgs, chooseDifferences, difference, expandAr, expandMa, isStationary, maInvert,
  type ArimaFit,
} from "../../src/data/timeseries/arima.js";
import { FREQ, mase, readTsf, type FreqName, type Series } from "./lib.js";

const POOL: { id: string; freq: FreqName; h: number }[] = [
  { id: "m3_monthly_dataset", freq: "monthly", h: 18 }, { id: "m3_quarterly_dataset", freq: "quarterly", h: 8 }, { id: "m3_yearly_dataset", freq: "yearly", h: 6 },
  { id: "m3_other_dataset", freq: "yearly", h: 8 }, { id: "m1_monthly_dataset", freq: "monthly", h: 18 }, { id: "m1_quarterly_dataset", freq: "quarterly", h: 8 },
  { id: "m1_yearly_dataset", freq: "yearly", h: 6 }, { id: "tourism_monthly_dataset", freq: "monthly", h: 24 }, { id: "tourism_quarterly_dataset", freq: "quarterly", h: 8 },
  { id: "tourism_yearly_dataset", freq: "yearly", h: 4 }, { id: "hospital_dataset", freq: "monthly", h: 12 }, { id: "fred_md_dataset", freq: "monthly", h: 12 },
  { id: "cif_2016_dataset", freq: "monthly", h: 12 },
];

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** Autocovariances g0..gK of the ARMA (ar, ma) with unit innovation variance, from its psi weights. */
export function armaAutocov(ar: number[], ma: number[], K: number): Float64Array {
  const L = 1500;
  const psi = new Float64Array(L + K + 1);
  psi[0] = 1;
  for (let j = 1; j < psi.length; j++) {
    let s = j - 1 < ma.length ? ma[j - 1]! : 0;
    for (let i = 1; i <= Math.min(j, ar.length); i++) s += ar[i - 1]! * psi[j - i]!;
    psi[j] = s;
  }
  const g = new Float64Array(K + 1);
  for (let k = 0; k <= K; k++) { let s = 0; for (let i = 0; i < L; i++) s += psi[i]! * psi[i + k]!; g[k] = s; }
  return g;
}

/** The model's variogram V(1..K) from autocovariances of w, for a model that integrates (cumulative) or not. */
export function modelVariogram(g: Float64Array, K: number, integrated: boolean): number[] {
  const out: number[] = [];
  for (let k = 1; k <= K; k++) {
    if (integrated) { let s = k * g[0]!; for (let j = 1; j < k; j++) s += 2 * (k - j) * g[j]!; out.push(s); }
    else out.push(2 * (g[0]! - g[k]!));
  }
  return out;
}

/** The same from the data: z is the differenced series, centred by the model's constant. */
export function dataVariogram(z: Float64Array, K: number, integrated: boolean): number[] {
  const v = Array.from(z).filter((x) => x === x);
  const out: number[] = [];
  for (let k = 1; k <= K; k++) {
    let s = 0, n = 0;
    if (integrated) {
      let run = 0;
      for (let i = 0; i < k && i < v.length; i++) run += v[i]!;
      for (let t = 0; t + k <= v.length; t++) { if (t > 0) run += v[t + k - 1]! - v[t - 1]!; s += run * run; n++; }
    } else for (let t = 0; t + k < v.length; t++) { const dlt = v[t + k]! - v[t]!; s += dlt * dlt; n++; }
    out.push(n > 0 ? s / n : NaN);
  }
  return out;
}

/** Re-estimate one model's coefficients by likelihood plus variogram match out to K steps. */
export function variogramMatch(y: ArrayLike<number>, fit: ArimaFit, K: number, lambda: number): ArimaFit {
  const sp = fit.spec, m = sp.m;
  const npar = sp.p + sp.q + sp.P + sp.Q;
  if (npar === 0 || lambda <= 0) return fit;
  const w = difference(y, sp.d, sp.D, m);
  const z = Float64Array.from(w, (v) => v - fit.mu);
  const integrated = sp.d + sp.D >= 1;
  const Vd = dataVariogram(z, K, integrated);
  const ks = Vd.map((v, i) => (v > 0 && Number.isFinite(v) ? i : -1)).filter((i) => i >= 0);
  if (!ks.length) return fit;
  const split = (x: number[]) => ({
    phi: x.slice(0, sp.p), theta: x.slice(sp.p, sp.p + sp.q), Phi: x.slice(sp.p + sp.q, sp.p + sp.q + sp.P), Theta: x.slice(sp.p + sp.q + sp.P),
  });
  const parts = (x: number[]) => { const c = split(x); return { ...c, ar: expandAr(c.phi, c.Phi, m), ma: expandMa(c.theta, c.Theta, m) }; };
  const obj = (x: number[]): number => {
    const c = parts(x);
    if (c.ar.length && !isStationary(c.ar)) return 1e30;
    const l = armaLik(z, c.ar, c.ma);
    if (!l || !(l.ssq > 0)) return 1e30;
    const s2 = l.ssq / l.n;
    const nll = 0.5 * Math.log(s2) + l.sumLogF / (2 * l.n);
    const g = armaAutocov(c.ar, c.ma, K);
    const Vm = modelVariogram(g, K, integrated);
    let pen = 0;
    for (const k of ks) { const r = Math.log(Math.max(1e-300, s2 * Vm[k]!)) - Math.log(Vd[k]!); pen += r * r; }
    return nll + lambda * (pen / ks.length);
  };
  const x0 = [...fit.phi, ...fit.theta, ...fit.Phi, ...fit.Theta];
  const res = bfgs(obj, x0, { maxIter: 80 });
  if (!(res.value < obj(x0) - 1e-12)) return fit;
  const c = parts(res.x);
  const theta = maInvert(c.theta), Theta = maInvert(c.Theta);
  const ma = expandMa(theta, Theta, m);
  const l = armaLik(z, c.ar, ma);
  if (!l) return fit;
  return { ...fit, phi: c.phi, theta, Phi: c.Phi, Theta, ar: c.ar, ma, sigma2: l.ssq / l.n };
}

if (process.argv[1] && /arima-vm\.ts$/.test(process.argv[1].replace(/\\/g, "/"))) {
  const dir = process.argv[2];
  if (!dir) throw new Error("usage: npx tsx tools/ts-eval/arima-vm.ts <folder> [count] [seed] [lambdas]");
  const count = Number(process.argv[3] ?? 100), seed = Number(process.argv[4] ?? 21);
  const lambdas = (process.argv[5] ?? "0.5,2,8").split(",").map(Number);
  const rand = rng(seed), cache = new Map<string, Series[]>();
  const names = ["avg", ...lambdas.map((l) => `vm${l}`)];
  const acc = new Map<string, number[]>(names.map((nm) => [nm, []]));
  const cov = new Map<string, number[]>(names.map((nm) => [nm, []]));
  const byFreq = new Map<string, Map<string, number[]>>();
  let done = 0, guard = 0;
  const t0 = performance.now();
  while (done < count && guard++ < count * 6) {
    const pool = POOL[Math.floor(rand() * POOL.length)]!;
    if (!cache.has(pool.id)) cache.set(pool.id, readTsf(join(dir, pool.id + ".tsf")).series);
    const all = cache.get(pool.id)!;
    const s = all[Math.floor(rand() * all.length)]!;
    const n = s.values.length, H = pool.h, m = FREQ[pool.freq].season;
    if (n < H + 14) continue;
    const train = s.values.slice(0, n - H), test = s.values.slice(n - H);
    const y = Float64Array.from(train);
    const dd = chooseDifferences(y, m);
    const found = autoArimaSearch(y, m, dd.d, dd.D, { approximate: y.length > 150 || m > 12 });
    if (!found) continue;
    const team = akaikeWeights(found.fits);
    if (!team.length) continue;
    const nonNeg = train.every((v) => v >= 0);
    const row: Record<string, { mase: number; cover: number }> = {};
    const score = (nm: string, tm: typeof team): void => {
      const f = averageForecasts(y, tm, H);
      const F = Array.from(f.F, (v) => (nonNeg ? Math.max(0, v) : v));
      let inside = 0;
      for (let h = 0; h < H; h++) if (test[h]! >= f.lo80[h]! && test[h]! <= f.hi80[h]!) inside++;
      row[nm] = { mase: mase(train, test, F, m), cover: inside / H };
    };
    score("avg", team);
    for (const lam of lambdas) score(`vm${lam}`, team.map((t) => ({ fit: variogramMatch(y, t.fit, H, lam), weight: t.weight })));
    if (!names.every((nm) => Number.isFinite(row[nm]!.mase))) continue;
    for (const nm of names) { acc.get(nm)!.push(row[nm]!.mase); cov.get(nm)!.push(row[nm]!.cover); }
    const g = byFreq.get(pool.freq) ?? new Map<string, number[]>(names.map((nm) => [nm, []]));
    for (const nm of names) g.get(nm)!.push(row[nm]!.mase);
    byFreq.set(pool.freq, g);
    done++;
    if (done % 10 === 0) console.error(`${done}/${count} (${((performance.now() - t0) / 1000).toFixed(0)} s)`);
  }
  const mean = (a: number[]): number => a.reduce((x, y) => x + y, 0) / a.length;
  const gm = (a: number[], b: number[]): number => Math.exp(mean(a.map((v, i) => Math.log(v / b[i]!))));
  const base = acc.get("avg")!;
  console.log(`\n${done} series, seed ${seed}. Against the shipped AutoARIMA (geo below 1 = more accurate); 80% range coverage (target 80%)`);
  console.log(`${"variant".padEnd(9)} ${"mean".padStart(7)} ${"geo".padStart(7)} ${"wins".padStart(5)} ${"losses".padStart(7)} ${"cover80".padStart(8)}`);
  for (const nm of names) {
    const v = acc.get(nm)!;
    console.log(`${nm.padEnd(9)} ${mean(v).toFixed(3).padStart(7)} ${gm(v, base).toFixed(3).padStart(7)} ${String(v.filter((x, i) => x < base[i]! - 1e-9).length).padStart(5)} ${String(v.filter((x, i) => x > base[i]! + 1e-9).length).padStart(7)} ${(100 * mean(cov.get(nm)!)).toFixed(1).padStart(7)}%`);
  }
  console.log("\nby frequency, geometric mean vs shipped:");
  for (const [freq, g] of byFreq) console.log(`${freq.padEnd(10)} n=${String(g.get("avg")!.length).padStart(3)} ` + names.slice(1).map((nm) => `${nm} ${gm(g.get(nm)!, g.get("avg")!).toFixed(3)}`).join("  "));
}

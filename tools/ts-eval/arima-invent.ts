/**
 * New AutoARIMA variants, beyond the literature's auto.arima, scored against the shipped version (Akaike-weighted average) on random
 * Monash series under the archive's protocol (last h held out, MASE).
 *
 *   avg        shipped: the Akaike-weighted average of the models the search fitted, at the differencing KPSS chose
 *   damp<φ>    every member with a drift has it damped: the j-th step's drift counts φ^j, as in a damped trend
 *   stein<κ>   every member's drift is shrunk by z²/(z²+κ), z its estimate over its standard error
 *   dvote      the differencing is not chosen by a unit-root test: the search runs at each plausible (d, D), each group's forecast is
 *              scored on h-step forecasts from origins at the end of the history (orders held, refitted quickly), and the groups are
 *              weighted by inverse squared error. AICc still weighs the models inside a group, where it is valid.
 *   dpick      the same, keeping only the group with the lowest error
 *   dvote+damp both
 *
 *   npx tsx tools/ts-eval/arima-invent.ts <folder of .tsf files> [count=100] [seed=11]
 */

import { join } from "node:path";
import { akaikeWeights, autoArimaSearch, chooseDifferences, fitArima, forecastArima, type ArimaFit } from "../../src/data/timeseries/arima.js";
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

type Team = { fit: ArimaFit; weight: number }[];
const DAMP = [0.8, 0.9, 0.95], STEIN = [1, 4];

/** A member's forecast, its drift damped by φ or shrunk by w (both 1 = untouched). */
function memberForecast(y: Float64Array, f: ArimaFit, H: number, phi: number, stein: number | null): number[] {
  const F = Array.from(forecastArima(y, f, H).F);
  const drifts = f.spec.constant && f.spec.d + f.spec.D >= 1;
  if (!drifts || (phi === 1 && stein === null)) return F;
  const nd = fitArima(y, { ...f.spec, constant: false });
  if (!nd) return F;
  const G = Array.from(forecastArima(y, nd, H).F);
  let w = 1;
  if (stein !== null) {
    const se = fitArima(y, f.spec, { se: true });
    const c = se?.coefs.find((k) => k.name === "drift");
    const z = c && c.se ? c.value / c.se : NaN;
    w = Number.isFinite(z) ? (z * z) / (z * z + stein) : 1;
  }
  return F.map((v, h) => {
    let damp = 1;
    if (phi < 1) { let s = 0, p = 1; for (let j = 1; j <= h + 1; j++) { p *= phi; s += p; } damp = s / (h + 1); }
    return G[h]! + w * damp * (v - G[h]!);
  });
}

const mix = (y: Float64Array, team: Team, H: number, phi = 1, stein: number | null = null): number[] => {
  const out = new Array<number>(H).fill(0);
  for (const t of team) { const p = memberForecast(y, t.fit, H, phi, stein); for (let h = 0; h < H; h++) out[h] = out[h]! + t.weight * p[h]!; }
  return out;
};

function search(y: Float64Array, m: number, d: number, D: number): Team | null {
  const found = autoArimaSearch(y, m, d, D, { approximate: y.length > 150 || m > 12 });
  return found ? akaikeWeights(found.fits) : null;
}

/** h-step mean absolute error of a group's top three orders, refitted quickly from origins at the end of the history. */
function groupError(y: Float64Array, team: Team, H: number, m: number): number {
  const n = y.length, step = Math.max(1, Math.round(H / 2)), floor = Math.max(3 * m, 20);
  const top = team.slice(0, 3), tw = top.reduce((a, t) => a + t.weight, 0);
  let ae = 0, an = 0;
  for (let k = 0; k < 3; k++) {
    const o = n - H - k * step;
    if (o < floor) break;
    const seg = y.slice(0, o);
    const pred = new Array<number>(H).fill(0);
    let ok = true;
    for (const t of top) {
      const f = fitArima(seg, t.fit.spec, { css: true });
      if (!f) { ok = false; break; }
      const F = forecastArima(seg, f, H).F;
      for (let h = 0; h < H; h++) pred[h] = pred[h]! + (t.weight / tw) * F[h]!;
    }
    if (!ok) continue;
    for (let h = 0; h < H; h++) { const e = Math.abs(y[o + h]! - pred[h]!); if (e === e) { ae += e; an++; } }
  }
  return an ? ae / an : NaN;
}

const dir = process.argv[2];
if (!dir) throw new Error("usage: npx tsx tools/ts-eval/arima-invent.ts <folder> [count] [seed]");
const count = Number(process.argv[3] ?? 100), seed = Number(process.argv[4] ?? 11);
const rand = rng(seed), cache = new Map<string, Series[]>();
const names = ["avg", ...DAMP.map((p) => `damp${p}`), ...STEIN.map((k) => `stein${k}`), "dvote", "dpick", ...DAMP.map((p) => `dvote+damp${p}`), "dvote+stein4"];
const scores = new Map<string, number[]>(names.map((nm) => [nm, []]));
const byFreq = new Map<string, Map<string, number[]>>();
let done = 0, guard = 0, moved = 0;
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
  const base = search(y, m, dd.d, dd.D);
  if (!base || !base.length) continue;
  const nonNeg = train.every((v) => v >= 0);
  const clip = (a: number[]): number[] => (nonNeg ? a.map((v) => Math.max(0, v)) : a);
  const F: Record<string, number[]> = { avg: mix(y, base, H) };
  for (const p of DAMP) F[`damp${p}`] = mix(y, base, H, p);
  for (const k of STEIN) F[`stein${k}`] = mix(y, base, H, 1, k);
  // The differencing vote: the KPSS choice and its neighbours.
  const cands = new Set<string>([`${dd.d},${dd.D}`]);
  for (const d of [dd.d - 1, dd.d + 1]) if (d >= 0 && d <= 2) cands.add(`${d},${dd.D}`);
  if (m > 1) cands.add(`${dd.d},${1 - dd.D}`);
  const groups: { key: string; team: Team; err: number }[] = [];
  for (const c of cands) {
    const [d, D] = c.split(",").map(Number) as [number, number];
    if (d + D > 2) continue;
    const team = c === `${dd.d},${dd.D}` ? base : search(y, m, d, D);
    if (!team || !team.length) continue;
    groups.push({ key: c, team, err: groupError(y, team, H, m) });
  }
  const scored = groups.filter((g) => Number.isFinite(g.err) && g.err > 0);
  const vote = (phi: number, stein: number | null = null): number[] => {
    if (scored.length < 2) return mix(y, base, H, phi, stein);
    const w = scored.map((g) => 1 / (g.err * g.err)), tot = w.reduce((a, b) => a + b, 0);
    const out = new Array<number>(H).fill(0);
    scored.forEach((g, i) => { const p = mix(y, g.team, H, phi, stein); for (let h = 0; h < H; h++) out[h] = out[h]! + (w[i]! / tot) * p[h]!; });
    return out;
  };
  F.dvote = vote(1);
  const pick = scored.length >= 2 ? scored.reduce((a, b) => (b.err < a.err ? b : a)) : null;
  if (pick && pick.key !== `${dd.d},${dd.D}`) moved++;
  F.dpick = pick ? mix(y, pick.team, H) : F.avg!;
  for (const p of DAMP) F[`dvote+damp${p}`] = vote(p);
  F["dvote+stein4"] = vote(1, 4);
  const row: Record<string, number> = {};
  for (const nm of names) row[nm] = mase(train, test, clip(F[nm]!), m);
  if (!names.every((nm) => Number.isFinite(row[nm]!))) continue;
  for (const nm of names) scores.get(nm)!.push(row[nm]!);
  const g = byFreq.get(pool.freq) ?? new Map<string, number[]>(names.map((nm) => [nm, []]));
  for (const nm of names) g.get(nm)!.push(row[nm]!);
  byFreq.set(pool.freq, g);
  done++;
  if (done % 10 === 0) console.error(`${done}/${count} (${((performance.now() - t0) / 1000).toFixed(0)} s)`);
}
const mean = (a: number[]): number => a.reduce((x, y) => x + y, 0) / a.length;
const gm = (a: number[], b: number[]): number => Math.exp(mean(a.map((v, i) => Math.log(v / b[i]!))));
const avgS = scores.get("avg")!;
console.log(`\n${done} series, seed ${seed}; the vote moved off the KPSS differencing on ${moved}. Against the shipped average (below 1 = better):`);
console.log(`${"variant".padEnd(16)} ${"mean".padStart(7)} ${"geo vs avg".padStart(11)} ${"wins".padStart(5)} ${"losses".padStart(7)}`);
for (const nm of names) {
  const v = scores.get(nm)!;
  console.log(`${nm.padEnd(16)} ${mean(v).toFixed(3).padStart(7)} ${gm(v, avgS).toFixed(3).padStart(11)} ${String(v.filter((x, i) => x < avgS[i]! - 1e-9).length).padStart(5)} ${String(v.filter((x, i) => x > avgS[i]! + 1e-9).length).padStart(7)}`);
}
console.log("\nby frequency, geometric mean vs avg:");
for (const [freq, g] of byFreq) console.log(`${freq.padEnd(10)} n=${String(g.get("avg")!.length).padStart(3)} ` + names.slice(1).map((nm) => `${nm} ${gm(g.get(nm)!, g.get("avg")!).toFixed(3)}`).join("  "));

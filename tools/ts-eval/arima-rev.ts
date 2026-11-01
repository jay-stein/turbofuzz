/**
 * Revision-corrected AutoARIMA: a forecaster that watches itself change its mind.
 *
 * Good forecasts revise unpredictably: when one more reading arrives, the change in the forecast for a fixed date should be noise
 * (Nordhaus 1987, who used it to test forecasters). If revisions repeat, the model reacts too slowly (or, negative, too fast), and the
 * rest of the revision still to come is predictable. Here the model is replayed through the end of its own history (orders held,
 * coefficients refitted at each origin), the revision persistence beta is measured by regressing each revision on the previous one
 * for the same target, and today's forecast for a date h steps ahead is moved along its latest revision by beta + ... + beta^h, the
 * revisions still to come before that date is observed. beta is shrunk by t^2 / (t^2 + kappa), t its t-statistic.
 *
 *   npx tsx tools/ts-eval/arima-rev.ts <folder of .tsf files> [count=100] [seed=31] [kappas=0,1,4]
 */

import { join } from "node:path";
import { akaikeWeights, autoArimaSearch, averageForecasts, chooseDifferences, fitArima, forecastArima, type ArimaFit } from "../../src/data/timeseries/arima.js";
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

/** The team's forecast from history y[0, o) for H steps, with the orders held and the coefficients refitted quickly. */
function replayForecast(y: Float64Array, o: number, team: Team, H: number): Float64Array | null {
  const seg = y.slice(0, o);
  const out = new Float64Array(H);
  let wsum = 0;
  for (const t of team) {
    const f = fitArima(seg, t.fit.spec, { css: true });
    if (!f) continue;
    const F = forecastArima(seg, f, H).F;
    for (let h = 0; h < H; h++) out[h] = out[h]! + t.weight * F[h]!;
    wsum += t.weight;
  }
  if (wsum <= 0) return null;
  for (let h = 0; h < H; h++) out[h] = out[h]! / wsum;
  return out;
}

export interface Revision { beta: number; t: number; pairs: number; last: Float64Array }

/**
 * Revision persistence over the last origins of the history, and the latest revision for each of the H future dates.
 * f_o covers dates o .. o + H (H + 1 steps), so the revision at the last origin T reaches every date T .. T + H - 1.
 */
export function revisionStudy(y: Float64Array, team: Team, H: number, m: number): Revision | null {
  const T = y.length, floor = Math.max(2 * m + 6, 12);
  const W = Math.min(T - floor, 2 * H + 4);
  if (W < 4) return null;
  const top = team.slice(0, 3);
  const fc = new Map<number, Float64Array>();
  for (let o = T - W; o <= T; o++) { const f = replayForecast(y, o, top, H + 1); if (f) fc.set(o, f); }
  const at = (o: number, tau: number): number => { const f = fc.get(o); const i = tau - o; return f && i >= 0 && i <= H ? f[i]! : NaN; };
  let sxy = 0, sxx = 0, n = 0;
  const pairs: [number, number][] = [];
  for (let o = T - W + 2; o <= T; o++) {
    for (let tau = o; tau <= o + H - 2; tau++) {
      const r = at(o, tau) - at(o - 1, tau), rp = at(o - 1, tau) - at(o - 2, tau);
      if (!Number.isFinite(r) || !Number.isFinite(rp)) continue;
      sxy += r * rp; sxx += rp * rp; n++; pairs.push([rp, r]);
    }
  }
  if (n < 10 || sxx <= 0) return null;
  const beta = sxy / sxx;
  let sse = 0;
  for (const [x, v] of pairs) sse += (v - beta * x) ** 2;
  const se = Math.sqrt(sse / Math.max(1, n - 1) / sxx);
  const last = new Float64Array(H);
  for (let h = 0; h < H; h++) last[h] = at(T, T + h) - at(T - 1, T + h);
  return { beta, t: se > 0 ? beta / se : 0, pairs: n, last };
}

/** Today's forecast moved along its latest revisions by the revisions still to come: beta + ... + beta^h for the date h steps ahead. */
export function correct(F: ArrayLike<number>, rev: Revision, kappa: number): number[] {
  const b0 = Math.max(-0.95, Math.min(0.95, rev.beta));
  const b = kappa > 0 ? b0 * (rev.t * rev.t) / (rev.t * rev.t + kappa) : b0;
  return Array.from(F, (f, h) => {
    let s = 0, p = 1;
    for (let i = 1; i <= h + 1; i++) { p *= b; s += p; }
    const r = rev.last[h]!;
    return Number.isFinite(r) ? f + s * r : f;
  });
}

if (process.argv[1] && /arima-rev\.ts$/.test(process.argv[1].replace(/\\/g, "/"))) {
  const dir = process.argv[2];
  if (!dir) throw new Error("usage: npx tsx tools/ts-eval/arima-rev.ts <folder> [count] [seed] [kappas]");
  const count = Number(process.argv[3] ?? 100), seed = Number(process.argv[4] ?? 31);
  const kappas = (process.argv[5] ?? "0,1,4").split(",").map(Number);
  const rand = rng(seed), cache = new Map<string, Series[]>();
  const names = ["avg", ...kappas.map((k) => `rev${k}`)];
  const acc = new Map<string, number[]>(names.map((nm) => [nm, []]));
  const byFreq = new Map<string, Map<string, number[]>>();
  const betas: number[] = [];
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
    const clip = (a: ArrayLike<number>): number[] => Array.from(a, (v) => (nonNeg ? Math.max(0, v) : v));
    const base = averageForecasts(y, team, H).F;
    const rev = revisionStudy(y, team, H, m);
    if (rev) betas.push(rev.beta);
    const row: Record<string, number> = { avg: mase(train, test, clip(base), m) };
    for (const k of kappas) row[`rev${k}`] = mase(train, test, clip(rev ? correct(base, rev, k) : base), m);
    if (!names.every((nm) => Number.isFinite(row[nm]!))) continue;
    for (const nm of names) acc.get(nm)!.push(row[nm]!);
    const g = byFreq.get(pool.freq) ?? new Map<string, number[]>(names.map((nm) => [nm, []]));
    for (const nm of names) g.get(nm)!.push(row[nm]!);
    byFreq.set(pool.freq, g);
    done++;
    if (done % 10 === 0) console.error(`${done}/${count} (${((performance.now() - t0) / 1000).toFixed(0)} s)`);
  }
  const mean = (a: number[]): number => a.reduce((x, y) => x + y, 0) / a.length;
  const gm = (a: number[], b: number[]): number => Math.exp(mean(a.map((v, i) => Math.log(v / b[i]!))));
  const base = acc.get("avg")!;
  const sb = [...betas].sort((a, b) => a - b);
  console.log(`\n${done} series, seed ${seed}. Revision persistence beta: median ${sb[Math.floor(sb.length / 2)]?.toFixed(2)}, quartiles ${sb[Math.floor(sb.length / 4)]?.toFixed(2)} to ${sb[Math.floor((3 * sb.length) / 4)]?.toFixed(2)} (${betas.length} measured)`);
  console.log(`${"variant".padEnd(9)} ${"mean".padStart(7)} ${"geo".padStart(7)} ${"wins".padStart(5)} ${"losses".padStart(7)}`);
  for (const nm of names) {
    const v = acc.get(nm)!;
    console.log(`${nm.padEnd(9)} ${mean(v).toFixed(3).padStart(7)} ${gm(v, base).toFixed(3).padStart(7)} ${String(v.filter((x, i) => x < base[i]! - 1e-9).length).padStart(5)} ${String(v.filter((x, i) => x > base[i]! + 1e-9).length).padStart(7)}`);
  }
  console.log("\nby frequency, geometric mean vs shipped:");
  for (const [freq, g] of byFreq) console.log(`${freq.padEnd(10)} n=${String(g.get("avg")!.length).padStart(3)} ` + names.slice(1).map((nm) => `${nm} ${gm(g.get(nm)!, g.get("avg")!).toFixed(3)}`).join("  "));
}

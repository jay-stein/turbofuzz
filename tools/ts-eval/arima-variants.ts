/**
 * Tries ways to improve AutoARIMA's forecasts, all computed from one search per series so they can be compared fairly:
 *   base     the model with the lowest AICc (what auto.arima returns)
 *   avg      an average of every model the search fitted with the same differencing, weighted by exp(-delta AICc / 2) (Akaike weights)
 *   top3     the three best by AICc, equally weighted
 *   nodrift  the best model without a constant (when differenced), against the drift that can run away on short series
 *   +comb    each of the above averaged with the board's Combination
 *
 *   npx tsx tools/ts-eval/arima-variants.ts <folder of .tsf files> [count=100] [seed=2]
 */

import { join } from "node:path";
import { autoArimaSearch, chooseDifferences, forecastArima, type ArimaFit } from "../../src/data/timeseries/arima.js";
import { FREQ, forecastsAll, mase, readTsf, type FreqName, type Series } from "./lib.js";

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

const dir = process.argv[2];
if (!dir) throw new Error("usage: npx tsx tools/ts-eval/arima-variants.ts <folder> [count] [seed]");
const count = Number(process.argv[3] ?? 100), seed = Number(process.argv[4] ?? 2);
const rand = rng(seed), cache = new Map<string, Series[]>();
const names = ["base", "avg", "top3", "nodrift", "comb", "base+comb", "avg+comb", "top3+comb", "nodrift+comb", "auto"] as const;
const scores = new Map<string, number[]>(names.map((n) => [n, []]));
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
  const found = autoArimaSearch(y, m, dd.d, dd.D);
  if (!found) continue;
  const board = forecastsAll(s, pool.freq, H);
  if ("skip" in board) continue;
  const fc = (f: ArimaFit): number[] => Array.from(forecastArima(y, f, H).F, (v) => Math.max(0, v));
  const fits = found.fits.filter((f) => Number.isFinite(f.aicc)).sort((a, b) => a.aicc - b.aicc);
  const best = fits[0]!;
  const weights = fits.map((f) => Math.exp(-(f.aicc - best.aicc) / 2));
  const wsum = weights.reduce((a, b) => a + b, 0);
  const mix = (list: ArimaFit[], w: number[]): number[] => {
    const tot = w.reduce((a, b) => a + b, 0);
    const out = new Array<number>(H).fill(0);
    list.forEach((f, i) => { const p = fc(f); for (let h = 0; h < H; h++) out[h] = out[h]! + (w[i]! / tot) * p[h]!; });
    return out;
  };
  const base = fc(best);
  const avg = mix(fits.filter((_, i) => weights[i]! > 1e-3 * wsum), weights.filter((w) => w > 1e-3 * wsum));
  const top3 = mix(fits.slice(0, 3), [1, 1, 1].slice(0, Math.min(3, fits.length)));
  const nodriftFit = dd.d + dd.D === 0 ? best : fits.find((f) => !f.spec.constant) ?? best;
  const nodrift = fc(nodriftFit);
  const comb = Array.from(board.F.comb);
  const half = (a: number[]): number[] => a.map((v, h) => (v + comb[h]!) / 2);
  const forecasts: Record<string, number[]> = { base, avg, top3, nodrift, comb, "base+comb": half(base), "avg+comb": half(avg), "top3+comb": half(top3), "nodrift+comb": half(nodrift), auto: Array.from(board.F[board.auto]) };
  const row: Record<string, number> = {};
  for (const name of names) { const v = mase(train, test, forecasts[name]!, m); row[name] = v; }
  if (!names.every((nm) => Number.isFinite(row[nm]!))) continue;
  for (const name of names) scores.get(name)!.push(row[name]!);
  const g = byFreq.get(pool.freq) ?? new Map<string, number[]>(names.map((nm) => [nm, []]));
  for (const name of names) g.get(name)!.push(row[name]!);
  byFreq.set(pool.freq, g);
  done++;
  if (done % 10 === 0) console.error(`${done}/${count} (${((performance.now() - t0) / 1000).toFixed(0)} s)`);
}
const mean = (a: number[]): number => a.reduce((x, y) => x + y, 0) / a.length;
const gm = (a: number[], b: number[]): number => Math.exp(mean(a.map((v, i) => Math.log(v / b[i]!))));
console.log(`\n${done} series, seed ${seed}. mean MASE, and geometric mean of the ratio to base (below 1 = better) and to the board's Auto`);
console.log(`${"variant".padEnd(14)} ${"mean".padStart(7)} ${"vs base".padStart(8)} ${"vs Auto".padStart(8)} ${"wins vs base".padStart(13)}`);
const baseS = scores.get("base")!, autoS = scores.get("auto")!;
for (const name of names) {
  const v = scores.get(name)!;
  console.log(`${name.padEnd(14)} ${mean(v).toFixed(3).padStart(7)} ${gm(v, baseS).toFixed(3).padStart(8)} ${gm(v, autoS).toFixed(3).padStart(8)} ${String(v.filter((x, i) => x < baseS[i]! - 1e-9).length).padStart(13)}`);
}
console.log("\nby frequency (mean MASE):");
for (const [freq, g] of byFreq) console.log(`${freq.padEnd(10)} n=${String(g.get("base")!.length).padStart(3)} ` + names.map((nm) => `${nm} ${mean(g.get(nm)!).toFixed(2)}`).join("  "));

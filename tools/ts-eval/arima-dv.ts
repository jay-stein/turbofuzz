/**
 * DV-ARIMA and ways to improve it. DV-ARIMA: the differencing is not chosen by a unit-root test; the search runs at the KPSS choice
 * and its neighbours, each group's forecast is scored on h-step forecasts from origins at the end of the history (orders held,
 * refitted quickly), and the groups are weighted by inverse squared error, AICc weighing the models inside each group.
 *
 *   dv        as above, 3 origins (what passed on seeds 12 and 13)
 *   dv+drift  each group split by whether its models carry a constant (drift or mean), so the vote also decides the drift
 *   dv+wide   every differencing with d + D <= 2, not only the neighbours of the KPSS choice
 *   dv+5      5 scoring origins instead of 3
 *   dv+all    all three
 *
 *   npx tsx tools/ts-eval/arima-dv.ts <folder of .tsf files> [count=100] [seed=41] [variants=dv,dv+drift,dv+wide,dv+5,dv+all]
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
interface Options { drift: boolean; wide: boolean; origins: number }

const renorm = (t: Team): Team => { const s = t.reduce((a, b) => a + b.weight, 0); return s > 0 ? t.map((x) => ({ fit: x.fit, weight: x.weight / s })) : t; };

/** h-step mean absolute error of a group's top three orders, refitted quickly from origins at the end of the history. */
function groupError(y: Float64Array, team: Team, H: number, m: number, origins: number): number {
  const n = y.length, step = Math.max(1, Math.round(H / 2)), floor = Math.max(3 * m, 20);
  const top = renorm(team.slice(0, 3));
  let ae = 0, an = 0;
  for (let k = 0; k < origins; k++) {
    const o = n - H - k * step;
    if (o < floor) break;
    const seg = y.slice(0, o);
    const pred = new Array<number>(H).fill(0);
    let ok = true;
    for (const t of top) {
      const f = fitArima(seg, t.fit.spec, { css: true });
      if (!f) { ok = false; break; }
      const F = forecastArima(seg, f, H).F;
      for (let h = 0; h < H; h++) pred[h] = pred[h]! + t.weight * F[h]!;
    }
    if (!ok) continue;
    for (let h = 0; h < H; h++) { const e = Math.abs(y[o + h]! - pred[h]!); if (e === e) { ae += e; an++; } }
  }
  return an ? ae / an : NaN;
}

/** The vote: groups by differencing (and by constant, if asked), weighted by inverse squared backtest error; falls back to the KPSS group. */
export function dvForecast(y: Float64Array, m: number, H: number, dd: { d: number; D: number }, teams: Map<string, Team>, opt: Options): Float64Array {
  const groups: Team[] = [];
  for (const [, team] of teams) {
    if (!opt.drift) { groups.push(team); continue; }
    const withC = renorm(team.filter((t) => t.fit.spec.constant)), noC = renorm(team.filter((t) => !t.fit.spec.constant));
    if (withC.length) groups.push(withC);
    if (noC.length) groups.push(noC);
  }
  const scored = groups.map((g) => ({ g, err: groupError(y, g, H, m, opt.origins) })).filter((x) => Number.isFinite(x.err) && x.err > 0);
  const kpss = teams.get(`${dd.d},${dd.D}`)!;
  if (scored.length < 2) return averageForecasts(y, kpss, H).F;
  const w = scored.map((x) => 1 / (x.err * x.err)), tot = w.reduce((a, b) => a + b, 0);
  const out = new Float64Array(H);
  scored.forEach((x, i) => { const p = averageForecasts(y, x.g, H).F; for (let h = 0; h < H; h++) out[h] = out[h]! + (w[i]! / tot) * p[h]!; });
  return out;
}

const VARIANTS: Record<string, Options> = {
  dv: { drift: false, wide: false, origins: 3 },
  "dv+drift": { drift: true, wide: false, origins: 3 },
  "dv+wide": { drift: false, wide: true, origins: 3 },
  "dv+5": { drift: false, wide: false, origins: 5 },
  "dv+all": { drift: true, wide: true, origins: 5 },
};

if (process.argv[1] && /arima-dv\.ts$/.test(process.argv[1].replace(/\\/g, "/"))) {
  const dir = process.argv[2];
  if (!dir) throw new Error("usage: npx tsx tools/ts-eval/arima-dv.ts <folder> [count] [seed] [variants]");
  const count = Number(process.argv[3] ?? 100), seed = Number(process.argv[4] ?? 41);
  const chosen = (process.argv[5] ?? Object.keys(VARIANTS).join(",")).split(",");
  const rand = rng(seed), cache = new Map<string, Series[]>();
  const names = ["avg", ...chosen];
  const acc = new Map<string, number[]>(names.map((nm) => [nm, []]));
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
    const search = (d: number, D: number): Team | null => {
      const f = autoArimaSearch(y, m, d, D, { approximate: y.length > 150 || m > 12 });
      const t = f ? akaikeWeights(f.fits) : [];
      return t.length ? t : null;
    };
    const kpss = search(dd.d, dd.D);
    if (!kpss) continue;
    const cache2 = new Map<string, Team | null>([[`${dd.d},${dd.D}`, kpss]]);
    const teamsFor = (wide: boolean): Map<string, Team> => {
      const keys = new Set<string>([`${dd.d},${dd.D}`]);
      if (wide) { for (let d = 0; d <= 2; d++) for (const D of m > 1 ? [0, 1] : [0]) if (d + D <= 2) keys.add(`${d},${D}`); }
      else {
        for (const d of [dd.d - 1, dd.d + 1]) if (d >= 0 && d <= 2 && d + dd.D <= 2) keys.add(`${d},${dd.D}`);
        if (m > 1 && dd.d + 1 - dd.D <= 2) keys.add(`${dd.d},${1 - dd.D}`);
      }
      const out = new Map<string, Team>();
      for (const k of keys) {
        if (!cache2.has(k)) { const [d, D] = k.split(",").map(Number) as [number, number]; cache2.set(k, search(d, D)); }
        const t = cache2.get(k);
        if (t) out.set(k, t);
      }
      return out;
    };
    const nonNeg = train.every((v) => v >= 0);
    const clip = (a: ArrayLike<number>): number[] => Array.from(a, (v) => (nonNeg ? Math.max(0, v) : v));
    const row: Record<string, number> = { avg: mase(train, test, clip(averageForecasts(y, kpss, H).F), m) };
    for (const nm of chosen) { const o = VARIANTS[nm]!; row[nm] = mase(train, test, clip(dvForecast(y, m, H, dd, teamsFor(o.wide), o)), m); }
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
  const dv = acc.get("dv") ?? acc.get("avg")!, base = acc.get("avg")!;
  console.log(`\n${done} series, seed ${seed}. Geometric mean against the shipped AutoARIMA and against DV-ARIMA (below 1 = better)`);
  console.log(`${"variant".padEnd(9)} ${"mean".padStart(7)} ${"vs ship".padStart(8)} ${"vs dv".padStart(7)} ${"wins/losses vs dv".padStart(18)}`);
  for (const nm of names) {
    const v = acc.get(nm)!;
    console.log(`${nm.padEnd(9)} ${mean(v).toFixed(3).padStart(7)} ${gm(v, base).toFixed(3).padStart(8)} ${gm(v, dv).toFixed(3).padStart(7)} ${`${v.filter((x, i) => x < dv[i]! - 1e-9).length}/${v.filter((x, i) => x > dv[i]! + 1e-9).length}`.padStart(18)}`);
  }
  console.log("\nby frequency, geometric mean vs DV-ARIMA:");
  for (const [freq, g] of byFreq) console.log(`${freq.padEnd(10)} n=${String(g.get("avg")!.length).padStart(3)} ` + names.filter((nm) => nm !== "dv").map((nm) => `${nm} ${gm(g.get(nm)!, g.get("dv") ?? g.get("avg")!).toFixed(3)}`).join("  "));
}

/**
 * How AutoARIMA does on random series from the Monash archive, beside the board's models, on the archive's protocol (train on all
 * but the last h points, forecast h, MASE scaled by the training data's seasonal naive error).
 *
 *   npx tsx tools/ts-eval/arima-eval.ts <folder of .tsf files> [count=20] [seed=1]
 *
 * Series come from the datasets whose season ARIMA handles (up to 24 periods); each draw picks a dataset, then a series in it, from a
 * seeded generator, so a run can be repeated and a second seed gives series the first never saw.
 */

import { join } from "node:path";
import { runAutoArima, type ArimaJob } from "../../src/data/timeseries/arima-run.js";
import { FREQ, forecastsAll, mase, readTsf, type FreqName, type Series } from "./lib.js";
import type { ModelKey } from "../../src/data/timeseries/models.js";

const POOL: { id: string; freq: FreqName; h: number }[] = [
  { id: "m3_monthly_dataset", freq: "monthly", h: 18 }, { id: "m3_quarterly_dataset", freq: "quarterly", h: 8 }, { id: "m3_yearly_dataset", freq: "yearly", h: 6 },
  { id: "m3_other_dataset", freq: "yearly", h: 8 }, { id: "m1_monthly_dataset", freq: "monthly", h: 18 }, { id: "m1_quarterly_dataset", freq: "quarterly", h: 8 },
  { id: "m1_yearly_dataset", freq: "yearly", h: 6 }, { id: "tourism_monthly_dataset", freq: "monthly", h: 24 }, { id: "tourism_quarterly_dataset", freq: "quarterly", h: 8 },
  { id: "tourism_yearly_dataset", freq: "yearly", h: 4 }, { id: "hospital_dataset", freq: "monthly", h: 12 }, { id: "fred_md_dataset", freq: "monthly", h: 12 },
  { id: "nn5_daily_dataset_with_missing_values", freq: "daily", h: 56 }, { id: "covid_deaths_dataset", freq: "daily", h: 30 },
  { id: "saugeenday_dataset", freq: "daily", h: 30 }, { id: "us_births_dataset", freq: "daily", h: 30 },
];

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export interface Row { dataset: string; id: string; n: number; m: number; order: string; arima: number; best: number; ms: number; models: Partial<Record<ModelKey | "auto", number>> }

export function evaluate(dir: string, count: number, seed: number, variant?: (job: ArimaJob) => ArimaJob): Row[] {
  const rand = rng(seed);
  const cache = new Map<string, Series[]>();
  const rows: Row[] = [];
  let guard = 0;
  while (rows.length < count && guard++ < count * 6) {
    const pool = POOL[Math.floor(rand() * POOL.length)]!;
    if (!cache.has(pool.id)) cache.set(pool.id, readTsf(join(dir, pool.id + ".tsf")).series);
    const all = cache.get(pool.id)!;
    const s = all[Math.floor(rand() * all.length)]!;
    const n = s.values.length, H = pool.h, season = FREQ[pool.freq].season;
    if (n < H + 14 || season > 24) continue;
    const train = s.values.slice(0, n - H), test = s.values.slice(n - H);
    const t0 = performance.now();
    const job: ArimaJob = {
      y: Float64Array.from(train), T: train.length, H, m: season, seasonMode: season > 1 ? "native" : "none", origins: [], rolling: false, trainLen: null, lockbox: false,
      lambda: null, nonNeg: train.every((v) => v >= 0), exhaustive: false,
    };
    const res = runAutoArima(variant ? variant(job) : job);
    const ms = performance.now() - t0;
    if (!res.ok) continue;
    const board = forecastsAll(s, pool.freq, H);
    if ("skip" in board) continue;
    const score = (F: ArrayLike<number>): number => mase(train, test, F, season);
    const models: Row["models"] = { auto: score(board.F[board.auto]) };
    for (const k of ["comb", "ets", "theta", "hw", "sn"] as ModelKey[]) models[k] = score(board.F[k]);
    rows.push({ dataset: pool.id.replace(/_dataset.*/, ""), id: s.name, n, m: season, order: res.label.replace(" with non-zero mean", "+mean").replace(" with drift", "+drift").replace("ARIMA", ""), arima: score(res.forecast.F), best: score(res.forecastBest.F), ms, models });
  }
  return rows;
}

if (process.argv[1] && /arima-eval\.ts$/.test(process.argv[1].replace(/\\/g, "/"))) {
  const dir = process.argv[2];
  if (!dir) throw new Error("usage: npx tsx tools/ts-eval/arima-eval.ts <folder> [count] [seed]");
  const count = Number(process.argv[3] ?? 20), seed = Number(process.argv[4] ?? 1);
  const rows = evaluate(dir, count, seed);
  const f = (v: number | undefined): string => (v === undefined || !Number.isFinite(v) ? "–" : v.toFixed(2)).padStart(6);
  console.log(`${"dataset".padEnd(16)} ${"series".padEnd(10)} ${"n".padStart(5)} ${"order".padEnd(26)} ${"ARIMA".padStart(6)} ${"Auto".padStart(6)} ${"Comb".padStart(6)} ${"ETS".padStart(6)} ${"Theta".padStart(6)} ${"HW".padStart(6)} ${"SN".padStart(6)} ${"sec".padStart(5)}`);
  for (const r of rows) console.log(`${r.dataset.padEnd(16)} ${r.id.slice(0, 10).padEnd(10)} ${String(r.n).padStart(5)} ${r.order.slice(0, 26).padEnd(26)} ${f(r.arima)} ${f(r.models.auto)} ${f(r.models.comb)} ${f(r.models.ets)} ${f(r.models.theta)} ${f(r.models.hw)} ${f(r.models.sn)} ${(r.ms / 1000).toFixed(1).padStart(5)}`);
  const mean = (a: number[]): number => a.reduce((x, y) => x + y, 0) / a.length;
  const median = (a: number[]): number => { const b = [...a].sort((x, y) => x - y); return b[Math.floor(b.length / 2)]!; };
  const col = (g: (r: Row) => number): number[] => rows.map(g).filter(Number.isFinite);
  console.log(`\n${rows.length} series. mean MASE: ARIMA ${mean(col((r) => r.arima)).toFixed(3)}  Auto ${mean(col((r) => r.models.auto!)).toFixed(3)}  Comb ${mean(col((r) => r.models.comb!)).toFixed(3)}  ETS ${mean(col((r) => r.models.ets!)).toFixed(3)}  Theta ${mean(col((r) => r.models.theta!)).toFixed(3)}  HW ${mean(col((r) => r.models.hw!)).toFixed(3)}  SN ${mean(col((r) => r.models.sn!)).toFixed(3)}`);
  console.log(`median MASE: ARIMA ${median(col((r) => r.arima)).toFixed(3)}  Auto ${median(col((r) => r.models.auto!)).toFixed(3)}  Comb ${median(col((r) => r.models.comb!)).toFixed(3)}  ETS ${median(col((r) => r.models.ets!)).toFixed(3)}`);
  console.log(`averaged vs best-only: mean ${mean(col((r) => r.arima)).toFixed(3)} vs ${mean(col((r) => r.best)).toFixed(3)}; geometric ratio ${Math.exp(mean(rows.map((r) => Math.log(r.arima / r.best)))).toFixed(3)}`);
  const wins = rows.filter((r) => r.arima < r.models.auto!).length;
  console.log(`ARIMA beat the board's Auto on ${wins} of ${rows.length}; geometric mean of ARIMA / Auto = ${Math.exp(mean(rows.map((r) => Math.log(r.arima / r.models.auto!)))).toFixed(3)}; total ${(rows.reduce((a, r) => a + r.ms, 0) / 1000).toFixed(0)} s`);
}

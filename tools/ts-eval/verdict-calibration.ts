/**
 * Does the forecast verdict mean what it says? For random Monash series, the engine is run on the training part only; the verdict is built
 * from the backtest numbers alone, exactly as the page builds it (never from the held-out actuals); then the pick is scored on the real
 * future against the yardstick the verdict named (the best simple method in the backtests, else repeating the last cycle).
 *
 *   npx tsx tools/ts-eval/verdict-calibration.ts <folder of .tsf files> [count=200] [seed=51]
 *
 * Reported per verdict: how many series, how often the pick beat the yardstick on the future, how often by 10% or more, how often it
 * beat repeating the last cycle, and the geometric mean of (pick error / yardstick error), below 1 being better.
 */

import { join } from "node:path";
import { BENCHMARK_KEYS, CORE_KEYS, MODEL_INFO, type ModelKey } from "../../src/data/timeseries/models.js";
import { trustVerdict, type VerdictInput } from "../../src/data/timeseries/verdict.js";
import { setup, readTsf, type FreqName, type Series } from "./lib.js";

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
if (!dir) throw new Error("usage: npx tsx tools/ts-eval/verdict-calibration.ts <folder> [count] [seed]");
const count = Number(process.argv[3] ?? 200), seed = Number(process.argv[4] ?? 51);
const rand = rng(seed), cache = new Map<string, Series[]>();

interface Row { level: string; beat: boolean; beat10: boolean; beatSn: boolean; ratio: number; label: string; edge: number; bottom: boolean; sn: number; ratioSn: number; foldShare: number; rank: number }
const rows: Row[] = [];
let guard = 0, skipped = 0, baseline = 0;
const t0 = performance.now();
while (rows.length + baseline < count && guard++ < count * 6) {
  const pool = POOL[Math.floor(rand() * POOL.length)]!;
  if (!cache.has(pool.id)) cache.set(pool.id, readTsf(join(dir, pool.id + ".tsf")).series);
  const all = cache.get(pool.id)!;
  const s = all[Math.floor(rand() * all.length)]!;
  const r = setup(s, pool.freq, pool.h);
  if ("skip" in r) { skipped++; continue; }
  const { snap, test } = r, F = snap.futures!, M = snap.models as Exclude<typeof snap.models, { error: string }>;
  const key: ModelKey = M.best;
  if (key === "sn") { baseline++; continue; }
  const m = M.models[key];
  // The numbers the page has before any actuals: backtest ratio, folds, the held-back fold, the band check on the last backtest.
  const lockValue = (k: ModelKey): number => { const x = M.models[k].lock?.mase ?? Number.NaN; return Number.isFinite(x) ? x : Infinity; };
  const rank = M.lockbox && m.lock ? 1 + CORE_KEYS.filter((k) => lockValue(k) < lockValue(key)).length : null;
  const beatenBy = M.lockbox && m.lock && !BENCHMARK_KEYS.includes(key) ? BENCHMARK_KEYS.filter((b) => !CORE_KEYS.includes(b) && lockValue(b) < lockValue(key)).map((b) => MODEL_INFO[b].name) : [];
  const simples = BENCHMARK_KEYS.filter((k) => k !== "sn" && k !== key && M.shown.includes(k)).map((k) => ({ k, ratio: M.models[k].ratio })).filter((x) => Number.isFinite(x.ratio) && x.ratio < 1);
  const bestSimple = simples.length ? simples.reduce((p, q) => (q.ratio < p.ratio ? q : p)) : null;
  const input: VerdictInput = {
    baseline: false, ratio: m.ratio, lockRank: rank, models: CORE_KEYS.length, foldsWon: m.folds.won, foldsOf: m.folds.of,
    band: m.check ? { hit: m.check.hit, tot: m.check.tot, aim: 0.8 } : null, rough: M.rough, periods: r.train.length, cycle: "year",
    beatenBy, bestSimple: bestSimple ? { name: MODEL_INFO[bestSimple.k].name, ratio: bestSimple.ratio } : null, intermittent: M.intermittent,
  };
  const verdict = trustVerdict(input);
  // The future: the pick against the yardstick the verdict named, and against repeating the last cycle.
  const mae = (k: ModelKey): number => { let e = 0, n = 0; for (let h = 0; h < test.length; h++) { const v = test[h]!; if (Number.isFinite(v)) { e += Math.abs(v - F[k].F[h]!); n++; } } return n ? e / n : Number.NaN; };
  const yard: ModelKey = bestSimple ? bestSimple.k : "sn";
  const ep = mae(key), ey = mae(yard), es = mae("sn");
  if (![ep, ey, es].every((x) => Number.isFinite(x)) || ey <= 0) { skipped++; continue; }
  const edge = m.ratio / (bestSimple ? bestSimple.ratio : 1);
  rows.push({ level: verdict.level, label: verdict.label, beat: ep < ey, beat10: ep <= 0.9 * ey, beatSn: ep < es, ratio: ep / ey, edge, bottom: rank !== null && rank * 3 > CORE_KEYS.length * 2, sn: ep / es, ratioSn: m.ratio, foldShare: m.folds.of > 0 ? m.folds.won / m.folds.of : Number.NaN, rank: rank ?? 0 });
  if (rows.length % 25 === 0) console.error(`${rows.length}/${count} (${((performance.now() - t0) / 1000).toFixed(0)} s)`);
}

const gm = (a: number[]): number => Math.exp(a.reduce((x, y) => x + Math.log(Math.max(1e-9, y)), 0) / (a.length || 1));
const pct = (n: number, d: number): string => (d ? `${Math.round((100 * n) / d)}%` : "–").padStart(5);
console.log(`\n${rows.length} series (seed ${seed}); ${baseline} where Auto picked repeat-last-cycle itself, ${skipped} skipped.`);
console.log(`${"verdict".padEnd(16)} ${"n".padStart(4)} ${"beat yardstick".padStart(15)} ${"by 10%+".padStart(8)} ${"beat sn".padStart(8)} ${"geo ratio".padStart(10)}`);
for (const lv of ["holds", "middling", "doubtful", "untested"]) {
  const g = rows.filter((x) => x.level === lv);
  if (!g.length) continue;
  console.log(`${(g[0]!.label).padEnd(16)} ${String(g.length).padStart(4)} ${pct(g.filter((x) => x.beat).length, g.length).padStart(15)} ${pct(g.filter((x) => x.beat10).length, g.length).padStart(8)} ${pct(g.filter((x) => x.beatSn).length, g.length).padStart(8)} ${gm(g.map((x) => x.ratio)).toFixed(3).padStart(10)}`);
}
console.log(`${"all".padEnd(16)} ${String(rows.length).padStart(4)} ${pct(rows.filter((x) => x.beat).length, rows.length).padStart(15)} ${pct(rows.filter((x) => x.beat10).length, rows.length).padStart(8)} ${pct(rows.filter((x) => x.beatSn).length, rows.length).padStart(8)} ${gm(rows.map((x) => x.ratio)).toFixed(3).padStart(10)}`);

// What drives "Not reliable": no better than the best simple method in the backtests, or bottom third on the held-back fold.
const nr = rows.filter((x) => x.level === "doubtful");
const row = (name: string, g: Row[]): void => console.log(`${name.padEnd(34)} ${String(g.length).padStart(4)} ${pct(g.filter((x) => x.beat).length, g.length).padStart(8)} ${gm(g.map((x) => x.ratio)).toFixed(3).padStart(8)}`);
console.log("Not reliable, by cause (n, beat the yardstick on the future, geo ratio):");
row("edge >= 1 only", nr.filter((x) => x.edge >= 1 && !x.bottom));
row("bottom third only", nr.filter((x) => x.edge < 1 && x.bottom));
row("both", nr.filter((x) => x.edge >= 1 && x.bottom));
console.log("By the backtest edge over the yardstick (model error / yardstick error), all series:");
for (const [lo, hi] of [[0, 0.8], [0.8, 0.9], [0.9, 1.0], [1.0, 1.05], [1.05, 1.1], [1.1, 1.2], [1.2, 99]] as [number, number][]) row(`edge ${lo} to ${hi}`, rows.filter((x) => x.edge >= lo && x.edge < hi));

const rowSn = (name: string, g: Row[]): void => console.log(`${name.padEnd(34)} ${String(g.length).padStart(4)} ${pct(g.filter((x) => x.beatSn).length, g.length).padStart(8)} ${gm(g.map((x) => x.sn)).toFixed(3).padStart(8)}`);
console.log("By the backtest error against repeating the last cycle (n, beat repeating the last cycle on the future, geo ratio of pick / that method):");
for (const [lo, hi] of [[0, 0.7], [0.7, 0.85], [0.85, 1.0], [1.0, 1.1], [1.1, 99]] as [number, number][]) rowSn(`backtest ratio ${lo} to ${hi}`, rows.filter((x) => x.ratioSn >= lo && x.ratioSn < hi));
console.log("By the share of backtests won against repeating the last cycle:");
for (const [lo, hi] of [[0, 0.34], [0.34, 0.5], [0.5, 0.67], [0.67, 1.01]] as [number, number][]) rowSn(`folds won ${lo} to ${hi}`, rows.filter((x) => x.foldShare >= lo && x.foldShare < hi));
console.log("By the pick's rank on the held-back fold (0 = none held back):");
for (const r of [0, 1, 2, 3, 4, 5, 6, 7, 8]) rowSn(`rank ${r}`, rows.filter((x) => x.rank === r));

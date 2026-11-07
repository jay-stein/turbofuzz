/**
 * Would ADIDA or IMAPA earn a place beside Croston, SBA and TSB for intermittent demand? On the intermittent series of a Monash
 * dataset (an average gap between sales over 1.32, at least five sales in the training stretch), on the archive's protocol (train
 * on all but the last h points, forecast h), compare:
 *   - the board's Croston, SBA (what Auto picks for intermittent demand), TSB, SES and mean;
 *   - ADIDA (Nikolopoulos et al. 2011): add the history up in non-overlapping buckets as long as the average gap between sales,
 *     smooth the bucket totals with SES, and spread the forecast back over the periods of a bucket;
 *   - IMAPA (Petropoulos and Kourentzes 2015): the average of ADIDA forecasts over every bucket length from 1 up to that gap.
 * Scores: MASE as the archive reports it (which rewards forecasting zero on a series that is mostly zeros), RMSSE (squared misses,
 * scaled by the in-sample naive error: it does not), and bias (the forecast's total over the whole stretch against the demand).
 *
 *   npx tsx tools/ts-eval/adida.ts <folder of .tsf files> [max series, default 300] [dataset id, default car_parts_dataset_with_missing_values]
 */

import { join } from "node:path";
import { fitSes } from "../../src/data/timeseries/ets.js";
import { FREQ, forecastsAll, mase, meanOf, readTsf, type FreqName } from "./lib.js";

/** The SES level of x[0, n) at a fixed or fitted smoothing parameter. */
function sesLevel(x: Float64Array, alpha: number | null): number {
  if (alpha === null) return fitSes(x, x.length).level;
  let l = x[0]!;
  for (let t = 1; t < x.length; t++) l += alpha * (x[t]! - l);
  return l;
}

/** Totals of non-overlapping buckets of `len` periods, counted back from the end so the latest period is in the last bucket. */
function buckets(y: number[], len: number): Float64Array {
  const n = Math.floor(y.length / len), out = new Float64Array(n), off = y.length - n * len;
  for (let b = 0; b < n; b++) { let s = 0; for (let k = 0; k < len; k++) s += y[off + b * len + k]!; out[b] = s; }
  return out;
}

/** ADIDA: the forecast per period, the same for every step ahead. */
export function adida(y: number[], len: number, alpha: number | null): number {
  if (len <= 1) return sesLevel(Float64Array.from(y), alpha);
  const agg = buckets(y, len);
  return agg.length < 2 ? sesLevel(Float64Array.from(y), alpha) : sesLevel(agg, alpha) / len;
}

/** IMAPA: ADIDA at every bucket length from 1 to `max`, averaged. */
export function imapa(y: number[], max: number, alpha: number | null): number {
  let s = 0;
  for (let len = 1; len <= max; len++) s += adida(y, len, alpha);
  return s / max;
}

/** The average number of periods between sales, and how many sales there are. */
function demandInterval(y: number[]): { adi: number; sales: number } {
  let sales = 0, gaps = 0, last = -1;
  y.forEach((v, t) => { if (v > 0) { sales++; gaps += last < 0 ? t + 1 : t - last; last = t; } });
  return { adi: sales ? gaps / sales : Infinity, sales };
}

/** Squared-error score: sqrt(mean squared miss) over sqrt(mean squared one-step change of the training data). */
function rmsse(train: number[], test: number[], f: ArrayLike<number>): number {
  let d = 0;
  for (let t = 1; t < train.length; t++) d += (train[t]! - train[t - 1]!) ** 2;
  d /= train.length - 1;
  let e = 0;
  for (let h = 0; h < test.length; h++) e += (test[h]! - f[h]!) ** 2;
  return d > 0 ? Math.sqrt(e / test.length / d) : NaN;
}

const folder = process.argv[2] ?? "";
const cap = Number(process.argv[3] ?? 300);
const id = process.argv[4] ?? "car_parts_dataset_with_missing_values";
if (folder === "") { console.error("usage: tsx tools/ts-eval/adida.ts <folder of .tsf files> [max series] [dataset id]"); process.exit(1); }
const freq: FreqName = id.startsWith("car_parts") ? "monthly" : id.startsWith("vehicle") || id.startsWith("temperature") ? "daily" : "monthly";
const file = readTsf(join(folder, `${id}.tsf`));
const H = file.horizon ?? (freq === "monthly" ? 12 : 30);

const METHODS = ["croston", "sba", "tsb", "ses", "mean", "adida", "adida01", "imapa", "imapa01", "app", "blend"] as const;
type M = (typeof METHODS)[number];
const mases: Record<M, number[]> = Object.fromEntries(METHODS.map((k) => [k, []])) as never;
const rmsses: Record<M, number[]> = Object.fromEntries(METHODS.map((k) => [k, []])) as never;
const bias: Record<M, number[]> = Object.fromEntries(METHODS.map((k) => [k, []])) as never;
let seen = 0, used = 0;
for (const s of file.series) {
  if (s.values.length <= H + 2) continue;
  const train = s.values.slice(0, s.values.length - H);
  const { adi, sales } = demandInterval(train);
  if (adi <= 1.32 || sales < 5) continue;
  if (seen++ % Math.max(1, Math.floor(1500 / cap)) !== 0 && cap < 1500) continue;
  if (used >= cap) break;
  const r = forecastsAll(s, freq, H);
  if ("skip" in r) continue;
  const maxLen = Math.min(12, Math.max(1, Math.round(adi)));
  const flat = (v: number): number[] => Array.from({ length: H }, () => v);
  const f: Record<M, ArrayLike<number>> = {
    croston: r.F.croston, sba: r.F.sba, tsb: r.F.tsb, ses: r.F.ses, mean: r.F.mean,
    adida: flat(adida(train, maxLen, null)), adida01: flat(adida(train, maxLen, 0.1)),
    imapa: flat(imapa(train, maxLen, null)), imapa01: flat(imapa(train, maxLen, 0.1)),
    app: r.F.imapa,
    blend: [],
  };
  f.blend = Array.from({ length: H }, (_, h) => (r.F.sba[h]! + (f.imapa as number[])[h]!) / 2);
  const demand = r.test.reduce((a, b) => a + b, 0);
  for (const k of METHODS) {
    mases[k].push(mase(r.train, r.test, f[k], r.season));
    rmsses[k].push(rmsse(r.train, r.test, f[k]));
    let total = 0;
    for (let h = 0; h < H; h++) total += f[k][h]!;
    bias[k].push(demand > 0 ? (total - demand) / demand : NaN);
  }
  used++;
}
console.log(`${id.replace(/_dataset.*$/, "")}: ${used} intermittent series of ${file.series.length}, h = ${H}`);
console.log("method".padEnd(10) + "  MASE   RMSSE   mean bias   median |bias|");
for (const k of METHODS) {
  const b = bias[k].filter(Number.isFinite), med = [...b.map(Math.abs)].sort((x, y) => x - y)[Math.floor(b.length / 2)] ?? NaN;
  console.log(`${k.padEnd(10)} ${meanOf(mases[k]).toFixed(3)}  ${meanOf(rmsses[k]).toFixed(3)}  ${(meanOf(b) * 100).toFixed(1).padStart(8)}%   ${(med * 100).toFixed(0).padStart(8)}%`);
}
const wins = (x: M, y: M, from: Record<M, number[]>): string => {
  let w = 0, n = 0;
  for (let i = 0; i < used; i++) { const a = from[x][i]!, b = from[y][i]!; if (Number.isFinite(a) && Number.isFinite(b)) { n++; if (a < b) w++; } }
  return `${w}/${n}`;
};
console.log("paired wins, MASE / RMSSE (left model better):");
for (const [x, y] of [["tsb", "sba"], ["adida", "sba"], ["imapa", "sba"], ["adida", "tsb"], ["imapa", "tsb"], ["ses", "sba"]] as [M, M][]) {
  console.log(`  ${x} vs ${y}`.padEnd(18) + `${wins(x, y, mases)}  /  ${wins(x, y, rmsses)}`);
}

/**
 * Shared by the Monash benchmark (monash.ts) and the accuracy gate (bench/accuracy.ts):
 * the archive's protocol for one series. Train on all but the last h points, forecast h
 * through the page's own engine, and score MASE against the training data's seasonal
 * naive error.
 */

import { readFileSync } from "node:fs";
import { buildTable, type GrainId } from "../../src/data/timeseries/base.js";
import { defaultConfig, TsEngine } from "../../src/data/timeseries/engine.js";
import { MODEL_KEYS, type ModelKey } from "../../src/data/timeseries/models.js";

export type FreqName = "yearly" | "quarterly" | "monthly" | "weekly" | "daily" | "hourly" | "half_hourly";
/** Our grain, the step between points, and the archive's MASE seasonality. */
export const FREQ: Record<FreqName, { grain: GrainId; add: (t: number, i: number) => number; season: number }> = {
  yearly: { grain: "year", add: (t, i) => { const d = new Date(t); return Date.UTC(d.getUTCFullYear() + i, d.getUTCMonth(), 1); }, season: 1 },
  quarterly: { grain: "quarter", add: (t, i) => { const d = new Date(t); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 3 * i, 1); }, season: 4 },
  monthly: { grain: "month", add: (t, i) => { const d = new Date(t); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + i, 1); }, season: 12 },
  weekly: { grain: "week", add: (t, i) => t + i * 7 * 86_400_000, season: 52 },
  daily: { grain: "day", add: (t, i) => t + i * 86_400_000, season: 7 },
  hourly: { grain: "hour", add: (t, i) => t + i * 3_600_000, season: 24 },
  half_hourly: { grain: "min30", add: (t, i) => t + i * 1_800_000, season: 48 },
};

export interface Series { name: string; start: number; values: number[] }

/** A `.tsf` file of the Monash archive. Missing values are carried forward (leading ones backward). */
export function readTsf(path: string): { freq: string; horizon: number | null; series: Series[] } {
  const lines = readFileSync(path, "utf8").replace(/\r/g, "").split("\n");
  let freq = "", horizon: number | null = null, data = false;
  const attrs: string[] = [];
  const series: Series[] = [];
  for (const line of lines) {
    if (!line || line.startsWith("#")) continue;
    if (!data) {
      const [k, ...rest] = line.split(" ");
      if (k === "@frequency") freq = rest[0]!;
      else if (k === "@horizon") horizon = Number(rest[0]);
      else if (k === "@attribute") attrs.push(rest.join(" "));
      else if (k === "@data") data = true;
      continue;
    }
    const parts = line.split(":");
    const vals = parts.slice(attrs.length).join(":").split(",").map((v) => (v === "?" ? NaN : Number(v)));
    const iStart = attrs.findIndex((a) => a.startsWith("start_timestamp"));
    const ts = iStart >= 0 ? parts[iStart]! : "2000-01-01 00-00-00";
    const m = /^(\d{4})-(\d\d)-(\d\d)(?: (\d\d)-(\d\d)-(\d\d))?/.exec(ts);
    const start = m ? Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +(m[4] ?? 0), +(m[5] ?? 0)) : Date.UTC(2000, 0, 1);
    let prev = NaN;
    for (let i = 0; i < vals.length; i++) { if (vals[i] === vals[i]) prev = vals[i]!; else vals[i] = prev; }
    const first = vals.find((v) => v === v) ?? 0;
    for (let i = 0; i < vals.length && !(vals[i] === vals[i]); i++) vals[i] = first;
    series.push({ name: parts[0]!, start, values: vals });
  }
  return { freq, horizon, series };
}

/** Empty periods the engine put before the first reading (the first bucket starts before it). */
function leadOffset(engine: TsEngine, t0: number, grain: GrainId): number {
  const s = engine.compute({ ...defaultConfig(engine.info()), grain, agg: "sum", measure: "value" }, "explore");
  let k = 0;
  while (k + 1 < s.A.n && s.A.t[k + 1]! <= t0) k++;
  return k;
}

export function mase(train: number[], test: number[], f: ArrayLike<number>, m: number): number {
  const s = train.length > m ? m : 1;
  let d = 0;
  for (let t = s; t < train.length; t++) d += Math.abs(train[t]! - train[t - s]!);
  d /= train.length - s;
  let e = 0;
  for (let h = 0; h < test.length; h++) e += Math.abs(test[h]! - f[h]!);
  return d > 0 ? e / test.length / d : NaN;
}

export type Key = ModelKey | "auto" | "et" | "eth";
/** Fixed combinations: ETS + Theta, and ETS + Theta + damped Holt-Winters (like M4's "Comb" benchmark). */
export const KEYS: Key[] = ["auto", "et", "eth", ...MODEL_KEYS];

/** MASE of every model, the Auto pick and the combinations on one series; or why it could not run. */
export function runSeries(s: Series, freq: FreqName, H: number): { mase: Record<Key, number>; auto: ModelKey } | { skip: string } {
  const fq = FREQ[freq], n = s.values.length;
  if (n <= H + 2) return { skip: "too short" };
  const times = Float64Array.from({ length: n }, (_, i) => fq.add(s.start, i));
  const table = buildTable({ times, cols: { value: Float64Array.from(s.values) }, flags: {}, groups: ["all"], rowGroup: new Uint16Array(n), groupCol: null, dateCol: "t", dropped: 0 });
  if (!table) return { skip: "no table" };
  const engine = new TsEngine(table);
  // A first period not aligned to the grain (a Sunday week, an hourly series starting at noon) adds empty leading periods.
  // A trailing period the readings only partly cover (Sunday-stamped weeks against Monday weeks) is left out, as the page does by default.
  const off = leadOffset(engine, times[0]!, fq.grain);
  const cfg = { ...defaultConfig(engine.info()), grain: fq.grain, agg: "sum" as const, measure: "value", horizon: H, split: off + n - H };
  const snap = engine.compute(cfg, "forecast");
  if ("error" in snap.models) return { skip: snap.models.error.slice(0, 60) };
  if (!snap.futures || snap.models.T !== off + n - H || snap.A.modelN - off !== n || snap.models.H !== H) return { skip: `T ${snap.models.T}/${off + n - H}, n ${snap.A.modelN - off}/${n}, H ${snap.models.H}/${H}` };
  const train = s.values.slice(0, n - H), test = s.values.slice(n - H), F = snap.futures;
  const out = {} as Record<Key, number>;
  for (const k of MODEL_KEYS) out[k] = mase(train, test, F[k].F, fq.season);
  out.auto = mase(train, test, F[snap.models.best].F, fq.season);
  out.et = mase(train, test, Array.from({ length: H }, (_, h) => (F.ets.F[h]! + F.theta.F[h]!) / 2), fq.season);
  out.eth = mase(train, test, Array.from({ length: H }, (_, h) => (F.ets.F[h]! + F.theta.F[h]! + F.hw.F[h]!) / 3), fq.season);
  return { mase: out, auto: snap.models.best };
}

export const meanOf = (a: number[]): number => { const v = a.filter((x) => Number.isFinite(x)); return v.reduce((x, y) => x + y, 0) / (v.length || 1); };

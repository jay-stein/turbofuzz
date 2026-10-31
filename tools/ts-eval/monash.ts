/**
 * Benchmark against the Monash Time Series Forecasting Archive (forecastingdata.org):
 * the archive's own protocol (train on all but the last h points, forecast h, MASE
 * scaled by the training data's seasonal naive error) on each dataset, set beside the
 * published results of R's forecast package (SES, Theta, TBATS, ETS, ARIMA; Godahewa et
 * al., 2021, and forecastingdata.org).
 *
 *   npx tsx tools/ts-eval/monash.ts <folder of .tsf files> [max series per dataset] [dataset filter]
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { buildTable, type GrainId } from "../../src/data/timeseries/base.js";
import { defaultConfig, TsEngine } from "../../src/data/timeseries/engine.js";
import { MODEL_KEYS, type ModelKey } from "../../src/data/timeseries/models.js";

/** Published MASE (mean over series): SES, Theta, TBATS, ETS, ARIMA. */
const PUBLISHED: Record<string, [number, number, number, number, number]> = {
  australian_electricity_demand_dataset: [1.857, 1.867, 1.174, 5.663, 2.574],
  car_parts_dataset_with_missing_values: [0.897, 0.914, 0.998, 0.925, 0.926],
  cif_2016_dataset: [1.291, 0.997, 0.861, 0.841, 0.929],
  covid_deaths_dataset: [7.776, 7.793, 5.719, 5.326, 6.117],
  electricity_weekly_dataset: [1.536, 1.476, 0.792, 1.526, 0.878],
  fred_md_dataset: [0.617, 0.698, 0.502, 0.468, 0.533],
  hospital_dataset: [0.813, 0.761, 0.768, 0.765, 0.787],
  kdd_cup_2018_dataset_with_missing_values: [1.645, 1.646, 1.394, 1.787, 1.982],
  m1_monthly_dataset: [1.379, 1.091, 1.118, 1.074, 1.164],
  m1_quarterly_dataset: [1.929, 1.702, 1.694, 1.658, 1.787],
  m1_yearly_dataset: [4.938, 4.191, 3.499, 3.771, 4.479],
  m3_monthly_dataset: [1.091, 0.864, 0.861, 0.865, 0.873],
  m3_other_dataset: [3.089, 2.271, 1.848, 1.814, 1.831],
  m3_quarterly_dataset: [1.417, 1.117, 1.256, 1.17, 1.24],
  m3_yearly_dataset: [3.167, 2.774, 3.127, 2.86, 3.417],
  m4_hourly_dataset: [11.607, 11.524, 2.663, 26.69, 13.557],
  m4_weekly_dataset: [0.587, 0.546, 0.504, 0.575, 0.55],
  nn5_daily_dataset_with_missing_values: [1.521, 0.885, 0.858, 0.865, 1.013],
  nn5_weekly_dataset: [0.903, 0.885, 0.872, 0.911, 0.887],
  pedestrian_counts_dataset: [0.957, 0.958, 1.297, 1.19, 3.947],
  rideshare_dataset_with_missing_values: [3.014, 3.641, 3.067, 4.04, 1.53],
  saugeenday_dataset: [1.426, 1.425, 1.477, 2.036, 1.485],
  sunspot_dataset_with_missing_values: [0.128, 0.128, 0.067, 0.128, 0.067],
  tourism_monthly_dataset: [3.306, 1.649, 1.751, 1.526, 1.589],
  tourism_quarterly_dataset: [3.21, 1.661, 1.835, 1.592, 1.782],
  tourism_yearly_dataset: [3.253, 3.015, 3.685, 3.395, 3.775],
  traffic_weekly_dataset: [1.116, 1.121, 1.148, 1.125, 1.191],
  us_births_dataset: [4.343, 2.138, 1.453, 1.529, 1.917],
  vehicle_trips_dataset_with_missing_values: [1.224, 1.244, 1.86, 1.305, 1.282],
};
/** Horizons from the archive's paper where the file does not say. */
const HORIZON: Record<string, number> = {
  m1_yearly_dataset: 6, m1_quarterly_dataset: 8, m1_monthly_dataset: 18, m3_other_dataset: 8, hospital_dataset: 12,
  nn5_daily_dataset_with_missing_values: 56, nn5_weekly_dataset: 8, pedestrian_counts_dataset: 24, us_births_dataset: 30,
  saugeenday_dataset: 30, car_parts_dataset_with_missing_values: 12, covid_deaths_dataset: 30, fred_md_dataset: 12,
  australian_electricity_demand_dataset: 336, kdd_cup_2018_dataset_with_missing_values: 168, rideshare_dataset_with_missing_values: 168,
  vehicle_trips_dataset_with_missing_values: 30, electricity_weekly_dataset: 8, traffic_weekly_dataset: 8, sunspot_dataset_with_missing_values: 30,
  tourism_yearly_dataset: 4, tourism_quarterly_dataset: 8, tourism_monthly_dataset: 24, m4_hourly_dataset: 48, m4_weekly_dataset: 13,
};
/** Frequency: our grain, the step between points, and the archive's MASE seasonality. */
const FREQ: Record<string, { grain: GrainId; add: (t: number, i: number) => number; season: number }> = {
  yearly: { grain: "year", add: (t, i) => { const d = new Date(t); return Date.UTC(d.getUTCFullYear() + i, d.getUTCMonth(), 1); }, season: 1 },
  quarterly: { grain: "quarter", add: (t, i) => { const d = new Date(t); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 3 * i, 1); }, season: 4 },
  monthly: { grain: "month", add: (t, i) => { const d = new Date(t); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + i, 1); }, season: 12 },
  weekly: { grain: "week", add: (t, i) => t + i * 7 * 86_400_000, season: 1 },
  daily: { grain: "day", add: (t, i) => t + i * 86_400_000, season: 7 },
  hourly: { grain: "hour", add: (t, i) => t + i * 3_600_000, season: 24 },
  half_hourly: { grain: "min30", add: (t, i) => t + i * 1_800_000, season: 48 },
};

interface Series { name: string; start: number; values: number[] }
function readTsf(path: string): { freq: string; horizon: number | null; series: Series[] } {
  const lines = readFileSync(path, "utf8").replace(/\r/g, "").split("\n");
  let freq = "", horizon: number | null = null, attrs: string[] = [], data = false;
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
    // Missing values: last observation carried forward (the archive's "without missing" versions), leading ones backward.
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

function mase(train: number[], test: number[], f: ArrayLike<number>, m: number): number {
  const s = train.length > m ? m : 1;
  let d = 0;
  for (let t = s; t < train.length; t++) d += Math.abs(train[t]! - train[t - s]!);
  d /= train.length - s;
  let e = 0;
  for (let h = 0; h < test.length; h++) e += Math.abs(test[h]! - f[h]!);
  return d > 0 ? e / test.length / d : NaN;
}

const dir = process.argv[2];
if (!dir) throw new Error("usage: npx tsx tools/ts-eval/monash.ts <folder> [max series] [filter]");
const cap = Number(process.argv[3] ?? 300), filter = process.argv[4] ?? "";
type Key = ModelKey | "auto" | "et" | "eth";
/** Fixed combinations: ETS + Theta, and ETS + Theta + damped Holt-Winters (like M4's "Comb" benchmark). */
const KEYS: Key[] = ["auto", "et", "eth", ...MODEL_KEYS];
const rows: string[] = [];
for (const file of readdirSync(dir).filter((f) => f.endsWith(".tsf") && f.includes(filter)).sort()) {
  const id = file.replace(/\.tsf$/, "");
  const { freq, horizon, series } = readTsf(join(dir, file));
  // M3 Other gives no frequency; the archive scores it with seasonality 1.
  const fq = FREQ[freq || (id === "m3_other_dataset" ? "yearly" : "")];
  if (!fq) { console.log(`skip ${id}: frequency ${freq}`); continue; }
  const H = horizon ?? HORIZON[id] ?? 12;
  const pick = series.length <= cap ? series : Array.from({ length: cap }, (_, k) => series[Math.floor((k * series.length) / cap)]!);
  const sums = Object.fromEntries(KEYS.map((k) => [k, [] as number[]])) as Record<Key, number[]>;
  let skipped = 0, why = "";
  const t0 = performance.now();
  for (const s of pick) {
    const n = s.values.length;
    if (n <= H + 2) { skipped++; why = "too short"; continue; }
    const times = Float64Array.from({ length: n }, (_, i) => fq.add(s.start, i));
    const table = buildTable({ times, cols: { value: Float64Array.from(s.values) }, flags: {}, groups: ["all"], rowGroup: new Uint16Array(n), groupCol: null, dateCol: "t", dropped: 0 });
    if (!table) { skipped++; why = "no table"; continue; }
    const engine = new TsEngine(table);
    // A first period not aligned to the grain (a Sunday week, an hourly series starting at noon) adds empty leading periods.
    // A trailing period the readings only partly cover (Sunday-stamped weeks against Monday weeks) is left out, as the page does by default.
    const off = leadOffset(engine, times[0]!, fq.grain);
    const cfg = { ...defaultConfig(engine.info()), grain: fq.grain, agg: "sum" as const, measure: "value", horizon: H, split: off + n - H };
    const snap = engine.compute(cfg, "forecast");
    if ("error" in snap.models || !snap.futures || snap.models.T !== off + n - H || snap.A.modelN - off !== n || snap.models.H !== H) { skipped++; why = "error" in snap.models ? snap.models.error.slice(0, 60) : `T ${"error" in snap.models ? "" : snap.models.T}/${off + n - H}, n ${snap.A.modelN - off}/${n}, H ${"error" in snap.models ? "" : snap.models.H}/${H}`; continue; }
    const train = s.values.slice(0, n - H), test = s.values.slice(n - H);
    for (const k of MODEL_KEYS) sums[k].push(mase(train, test, snap.futures[k].F, fq.season));
    sums.auto.push(mase(train, test, snap.futures[snap.models.best].F, fq.season));
    const F = snap.futures;
    sums.et.push(mase(train, test, Array.from({ length: H }, (_, h) => (F.ets.F[h]! + F.theta.F[h]!) / 2), fq.season));
    sums.eth.push(mase(train, test, Array.from({ length: H }, (_, h) => (F.ets.F[h]! + F.theta.F[h]! + F.hw.F[h]!) / 3), fq.season));
  }
  const ms = performance.now() - t0;
  const mean = (a: number[]): number => { const v = a.filter((x) => Number.isFinite(x)); return v.reduce((x, y) => x + y, 0) / (v.length || 1); };
  const pub = PUBLISHED[id];
  const ours = Object.fromEntries(KEYS.map((k) => [k, mean(sums[k])])) as Record<Key, number>;
  const line = `${id.replace(/_dataset.*$/, "").padEnd(26)} n=${String(sums.sn.length).padStart(4)}/${String(series.length).padStart(5)} H=${String(H).padStart(3)} ${(ms / Math.max(1, sums.sn.length)).toFixed(0).padStart(5)}ms/s | ours: auto ${ours.auto.toFixed(3)} ets+theta ${ours.et.toFixed(3)} ets+theta+hw ${ours.eth.toFixed(3)} ets ${ours.ets.toFixed(3)} theta ${ours.theta.toFixed(3)} hw ${ours.hw.toFixed(3)} reg ${ours.reg.toFixed(3)} ens ${ours.ens.toFixed(3)} sn ${ours.sn.toFixed(3)} | forecast pkg: ses ${pub?.[0] ?? "-"} theta ${pub?.[1] ?? "-"} tbats ${pub?.[2] ?? "-"} ets ${pub?.[3] ?? "-"} arima ${pub?.[4] ?? "-"}${skipped ? ` | skipped ${skipped} (${why})` : ""}`;
  console.log(line);
  rows.push(line);
}

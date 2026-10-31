/**
 * Benchmark against the Monash Time Series Forecasting Archive (forecastingdata.org):
 * the archive's own protocol (train on all but the last h points, forecast h, MASE
 * scaled by the training data's seasonal naive error) on each dataset, set beside the
 * published results of R's forecast package (SES, Theta, TBATS, ETS, ARIMA; Godahewa et
 * al., 2021, and forecastingdata.org).
 *
 *   npx tsx tools/ts-eval/monash.ts <folder of .tsf files> [max series per dataset] [dataset filter]
 */

import { readdirSync } from "node:fs";
import { join } from "node:path";
import { FREQ, KEYS, meanOf, readTsf, runSeries, type FreqName, type Key } from "./lib.js";

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

const dir = process.argv[2];
if (!dir) throw new Error("usage: npx tsx tools/ts-eval/monash.ts <folder> [max series] [filter]");
const cap = Number(process.argv[3] ?? 300), filter = process.argv[4] ?? "";
for (const file of readdirSync(dir).filter((f) => f.endsWith(".tsf") && f.includes(filter)).sort()) {
  const id = file.replace(/\.tsf$/, "");
  const { freq, horizon, series } = readTsf(join(dir, file));
  // M3 Other gives no frequency; the archive scores it with seasonality 1.
  const name = (freq || (id === "m3_other_dataset" ? "yearly" : "")) as FreqName;
  if (!FREQ[name]) { console.log(`skip ${id}: frequency ${freq}`); continue; }
  const H = horizon ?? HORIZON[id] ?? 12;
  const pick = series.length <= cap ? series : Array.from({ length: cap }, (_, k) => series[Math.floor((k * series.length) / cap)]!);
  const sums = Object.fromEntries(KEYS.map((k) => [k, [] as number[]])) as Record<Key, number[]>;
  let skipped = 0, why = "";
  const t0 = performance.now();
  for (const s of pick) {
    const r = runSeries(s, name, H);
    if ("skip" in r) { skipped++; why = r.skip; continue; }
    for (const k of KEYS) sums[k].push(r.mase[k]);
  }
  const ms = performance.now() - t0;
  const pub = PUBLISHED[id];
  const ours = Object.fromEntries(KEYS.map((k) => [k, meanOf(sums[k])])) as Record<Key, number>;
  console.log(`${id.replace(/_dataset.*$/, "").padEnd(26)} n=${String(sums.sn.length).padStart(4)}/${String(series.length).padStart(5)} H=${String(H).padStart(3)} ${(ms / Math.max(1, sums.sn.length)).toFixed(0).padStart(5)}ms/s | ours: auto ${ours.auto.toFixed(3)} ets+theta ${ours.et.toFixed(3)} ets+theta+hw ${ours.eth.toFixed(3)} ets ${ours.ets.toFixed(3)} theta ${ours.theta.toFixed(3)} hw ${ours.hw.toFixed(3)} reg ${ours.reg.toFixed(3)} ens ${ours.ens.toFixed(3)} sn ${ours.sn.toFixed(3)} | forecast pkg: ses ${pub?.[0] ?? "-"} theta ${pub?.[1] ?? "-"} tbats ${pub?.[2] ?? "-"} ets ${pub?.[3] ?? "-"} arima ${pub?.[4] ?? "-"}${skipped ? ` | skipped ${skipped} (${why})` : ""}`);
}

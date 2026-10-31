/**
 * Builds test/fixtures/accuracy/series.json, the small fixed set of series behind the
 * accuracy gate (bench/accuracy.ts): a few series from each of several Monash archive
 * datasets, chosen by an even stride so the pick is deterministic. Long series keep
 * their latest points (the start timestamp moves with them).
 *
 *   npx tsx tools/ts-eval/make-fixture.ts <folder of .tsf files>
 *
 * Only series the engine can forecast today are taken, so the gate measures accuracy and
 * not coverage; short series join once Phase 4 of the fundamentals plan makes them
 * forecastable (re-run this then, and update the baseline).
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { FREQ, readTsf, runSeries, type FreqName, type Series } from "./lib.js";

/** dataset file, how many series, longest history kept (0 = all), horizon when the file has none. */
const PICKS: [string, number, number, number?][] = [
  ["m3_monthly_dataset", 5, 0], ["m3_quarterly_dataset", 4, 0], ["m3_yearly_dataset", 4, 0], ["m3_other_dataset", 3, 0, 8],
  ["m1_monthly_dataset", 3, 0, 18], ["tourism_monthly_dataset", 4, 0, 24], ["tourism_quarterly_dataset", 3, 0, 8], ["tourism_yearly_dataset", 3, 0, 4],
  ["hospital_dataset", 4, 0, 12], ["fred_md_dataset", 2, 0, 12], ["covid_deaths_dataset", 2, 0, 30],
  ["nn5_daily_dataset_with_missing_values", 3, 0, 56], ["nn5_weekly_dataset", 2, 0, 8],
  ["m4_weekly_dataset", 3, 300], ["electricity_weekly_dataset", 2, 156, 8], ["traffic_weekly_dataset", 2, 104, 8],
  ["m4_hourly_dataset", 3, 800], ["pedestrian_counts_dataset", 2, 800, 24],
  ["car_parts_dataset_with_missing_values", 4, 0, 12], ["vehicle_trips_dataset_with_missing_values", 3, 0, 30],
];

const dir = process.argv[2];
if (!dir) throw new Error("usage: npx tsx tools/ts-eval/make-fixture.ts <folder of .tsf files>");
const out: { dataset: string; freq: FreqName; h: number; id: string; start: number; values: number[] }[] = [];
for (const [file, count, keep, fallbackH] of PICKS) {
  const id = file.replace(/_dataset.*$/, "");
  const { freq, horizon, series } = readTsf(join(dir, `${file}.tsf`));
  const name = (freq || "yearly") as FreqName;
  const H = horizon ?? fallbackH ?? 12;
  const fq = FREQ[name];
  const stride = Math.max(1, Math.floor(series.length / (count * 4)));
  let taken = 0;
  for (let i = Math.floor(stride / 2); i < series.length && taken < count; i += stride) {
    const s = series[i]!;
    let cut: Series = s;
    if (keep > 0 && s.values.length > keep) cut = { name: s.name, start: fq.add(s.start, s.values.length - keep), values: s.values.slice(-keep) };
    if ("skip" in runSeries(cut, name, H)) continue;
    out.push({ dataset: id, freq: name, h: H, id: cut.name, start: cut.start, values: cut.values });
    taken++;
  }
  console.log(`${id.padEnd(24)} ${taken}/${count} series`);
}
const path = "test/fixtures/accuracy/series.json";
mkdirSync("test/fixtures/accuracy", { recursive: true });
writeFileSync(path, JSON.stringify({ series: out }) + "\n");
console.log(`${out.length} series, ${out.reduce((n, s) => n + s.values.length, 0)} points -> ${path}`);

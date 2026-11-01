/**
 * How often the held-out actuals fall inside the Auto forecast's 80% and 95% bands, on the same protocol as the
 * accuracy gate (train on all but the last h points, forecast h). A calibrated band covers about 80% and 95%.
 *
 *   npx tsx tools/ts-eval/coverage.ts                                    the fixed series of the accuracy gate
 *   npx tsx tools/ts-eval/coverage.ts <folder of .tsf files> [max series per dataset] [dataset filter]
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { FREQ, readTsf, runSeries, type FreqName, type Series } from "./lib.js";

interface Sets { name: string; freq: FreqName; h: number; series: Series[] }
const sets: Sets[] = [];
const dir = process.argv[2];
if (!dir) {
  const fx = JSON.parse(readFileSync("test/fixtures/accuracy/series.json", "utf8")) as { series: { dataset: string; freq: FreqName; h: number; id: string; start: number; values: number[] }[] };
  const by = new Map<string, Sets>();
  for (const s of fx.series) {
    const e = by.get(s.dataset) ?? { name: s.dataset, freq: s.freq, h: s.h, series: [] };
    e.series.push({ name: s.id, start: s.start, values: s.values });
    by.set(s.dataset, e);
  }
  sets.push(...by.values());
} else {
  const cap = Number(process.argv[3] ?? 100), filter = process.argv[4] ?? "";
  const HORIZON: Record<string, number> = { m3_monthly_dataset: 18, m1_monthly_dataset: 18, tourism_monthly_dataset: 24, hospital_dataset: 12, fred_md_dataset: 12, m3_quarterly_dataset: 8, tourism_quarterly_dataset: 8, m1_quarterly_dataset: 8, m3_yearly_dataset: 6, m1_yearly_dataset: 6, tourism_yearly_dataset: 4, m4_weekly_dataset: 13, nn5_daily_dataset_with_missing_values: 56 };
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".tsf") && f.includes(filter)).sort()) {
    const id = file.replace(/\.tsf$/, "");
    const { freq, horizon, series } = readTsf(join(dir, file));
    const name = (freq || "") as FreqName;
    if (!FREQ[name]) continue;
    // TS_OFFSET shifts which series are taken, to score series the gate's fixture does not hold.
    const off = Number(process.env.TS_OFFSET ?? 0);
    const pick = series.length <= cap ? series : Array.from({ length: cap }, (_, k) => series[Math.min(series.length - 1, Math.floor((k * series.length) / cap) + off)]!);
    sets.push({ name: id.replace(/_dataset.*$/, ""), freq: name, h: horizon ?? HORIZON[id] ?? 12, series: pick });
  }
}
let N = 0, I80 = 0, I95 = 0, W = 0;
console.log(`${"dataset".padEnd(22)} ${"series".padStart(6)} ${"points".padStart(7)}  80% band  95% band  Winkler(80%)`);
for (const set of sets) {
  let n = 0, i80 = 0, i95 = 0, k = 0, w = 0;
  for (const s of set.series) {
    const r = runSeries(s, set.freq, set.h);
    if ("skip" in r) continue;
    k++; n += r.cover.n; i80 += r.cover.in80; i95 += r.cover.in95; w += r.cover.winkler80;
  }
  N += n; I80 += i80; I95 += i95; W += w;
  console.log(`${set.name.padEnd(22)} ${String(k).padStart(6)} ${String(n).padStart(7)}  ${(100 * i80 / (n || 1)).toFixed(1).padStart(7)}%  ${(100 * i95 / (n || 1)).toFixed(1).padStart(7)}%  ${(w / (n || 1)).toFixed(2).padStart(8)}`);
}
console.log(`${"all".padEnd(22)} ${" ".repeat(6)} ${String(N).padStart(7)}  ${(100 * I80 / (N || 1)).toFixed(1).padStart(7)}%  ${(100 * I95 / (N || 1)).toFixed(1).padStart(7)}%  ${(W / (N || 1)).toFixed(2).padStart(8)}`);

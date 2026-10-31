/**
 * Parity of our ETS and Theta with Nixtla's statsforecast (a port of R's forecast::ets and
 * thetaf), series by series, on the series that parity_statsforecast.py ran.
 *
 *   .venv-recipe-parity/Scripts/python.exe -I tools/ts-eval/parity_statsforecast.py <tsf folder> ref.json
 *   npx tsx tools/ts-eval/parity.ts <tsf folder> ref.json [dataset filter]
 *
 * Reports, per dataset: mean MASE of each implementation, how often the ETS form matches
 * (all three letters; and trend and season alone), and the median and mean relative gap
 * between the two forecasts, for ETS and for Theta.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { forecastsOf, readTsf, type FreqName } from "./lib.js";

interface RefRow { name: string; h: number; ets_method?: string; ets_fc?: number[]; ets_mase?: number; theta_fc?: number[]; theta_mase?: number }
const FREQ_OF: Record<string, FreqName> = { m3_monthly_dataset: "monthly", m3_quarterly_dataset: "quarterly", m3_yearly_dataset: "yearly", tourism_monthly_dataset: "monthly", tourism_quarterly_dataset: "quarterly", hospital_dataset: "monthly", m1_monthly_dataset: "monthly" };

const dir = process.argv[2], refPath = process.argv[3], filter = process.argv[4] ?? "";
if (!dir || !refPath) throw new Error("usage: npx tsx tools/ts-eval/parity.ts <tsf folder> <ref.json> [filter]");
const ref = JSON.parse(readFileSync(refPath, "utf8")) as Record<string, { m: number; h: number; series: RefRow[] }>;
const mean = (a: number[]): number => a.reduce((x, y) => x + y, 0) / (a.length || 1);
const median = (a: number[]): number => { const b = [...a].sort((x, y) => x - y); return b[b.length >> 1] ?? NaN; };
/** Mean absolute difference of two forecasts, as a share of the mean absolute level. */
const gap = (a: number[], b: number[]): number => mean(a.map((v, i) => Math.abs(v - b[i]!))) / (mean(b.map(Math.abs)) || 1);
/** statsforecast writes "ETS(M,Ad,M)"; ours is "A,Ad,N" (error, trend, season) or just "Ad,N" in older output. */
const parts = (method: string): [string, string, string] => { const m = /ETS\((\w),(\w+),(\w)\)/.exec(method); return m ? [m[1]!, m[2]!, m[3]!] : ["?", "?", "?"]; };

const totals = { ours: [] as number[], ref: [] as number[], oursT: [] as number[], refT: [] as number[] };
for (const [ds, entry] of Object.entries(ref)) {
  if (!ds.includes(filter)) continue;
  const { series } = readTsf(join(dir, `${ds}.tsf`));
  const byName = new Map(series.map((s) => [s.name, s]));
  let n = 0, full = 0, shape = 0;
  const oursE: number[] = [], refE: number[] = [], oursT: number[] = [], refT: number[] = [], gapE: number[] = [], gapT: number[] = [];
  const miss: Record<string, number> = {};
  for (const row of entry.series.slice(0, Number(process.env.PARITY_LIMIT ?? 0) || undefined)) {
    const s = byName.get(row.name);
    if (!s || !row.ets_fc || !row.theta_fc) continue;
    const mine = forecastsOf(s, FREQ_OF[ds]!, entry.h);
    if ("skip" in mine) continue;
    n++;
    oursE.push(mine.etsMase); refE.push(row.ets_mase!); oursT.push(mine.thetaMase); refT.push(row.theta_mase!);
    gapE.push(gap(mine.ets, row.ets_fc)); gapT.push(gap(mine.theta, row.theta_fc));
    const [e, t, se] = parts(row.ets_method ?? ""), ours = mine.spec.split(",");
    const o3 = ours.length === 3 ? ours : ["A", ...ours];
    if (o3[0] === e && o3[1] === t && o3[2] === se) full++;
    if (o3[1] === t && o3[2] === se) shape++;
    else { const k = `${t},${se} -> ${o3[1]},${o3[2]}`; miss[k] = (miss[k] ?? 0) + 1; }
  }
  totals.ours.push(...oursE); totals.ref.push(...refE); totals.oursT.push(...oursT); totals.refT.push(...refT);
  const top = Object.entries(miss).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${k} x${v}`).join("; ");
  console.log(`${ds.replace(/_dataset$/, "").padEnd(20)} n=${String(n).padStart(3)} | ETS MASE ours ${mean(oursE).toFixed(3)} ref ${mean(refE).toFixed(3)} (${((mean(oursE) / mean(refE) - 1) * 100).toFixed(1)}%) | form: all ${((full / n) * 100).toFixed(0)}%, trend+season ${((shape / n) * 100).toFixed(0)}% | forecast gap median ${(median(gapE) * 100).toFixed(1)}% mean ${(mean(gapE) * 100).toFixed(1)}% | Theta MASE ours ${mean(oursT).toFixed(3)} ref ${mean(refT).toFixed(3)} (${((mean(oursT) / mean(refT) - 1) * 100).toFixed(1)}%) gap median ${(median(gapT) * 100).toFixed(1)}%${top ? ` | differs: ${top}` : ""}`);
}
console.log(`\nALL  ETS MASE ours ${mean(totals.ours).toFixed(3)} ref ${mean(totals.ref).toFixed(3)} (${((mean(totals.ours) / mean(totals.ref) - 1) * 100).toFixed(1)}%) | Theta ours ${mean(totals.oursT).toFixed(3)} ref ${mean(totals.refT).toFixed(3)} (${((mean(totals.oursT) / mean(totals.refT) - 1) * 100).toFixed(1)}%) over ${totals.ours.length} series`);

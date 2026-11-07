/**
 * Would STL + ETS (forecast::stlf) earn a place beside the board's models? On each series of the Monash archive, on the archive's
 * protocol (train on all but the last h points, forecast h, MASE against the training data's seasonal naive), compare:
 *   - the board's own ETS and Combination, and what Auto picked;
 *   - STL + ETS: the season removed with STL (one period), ETS fitted to the adjusted series, the season's last cycle added back;
 *   - the average of STL + ETS and the Combination.
 * For seasons over 24 periods the board's ETS already is STL + ETS (see runModels), so those datasets check the two agree.
 *
 *   npx tsx tools/ts-eval/stlf.ts <folder of .tsf files> [max series per dataset, default 120] [dataset-name filter]
 */

import { join } from "node:path";
import { etsForecast, etsRun, etsSelect } from "../../src/data/timeseries/ets.js";
import { mstl } from "../../src/data/timeseries/stl.js";
import { FREQ, forecastsAll, mase, meanOf, readTsf, type FreqName } from "./lib.js";

const DATASETS: { id: string; freq: FreqName; h: number }[] = [
  { id: "m3_monthly_dataset", freq: "monthly", h: 18 }, { id: "m1_monthly_dataset", freq: "monthly", h: 18 },
  { id: "tourism_monthly_dataset", freq: "monthly", h: 24 }, { id: "hospital_dataset", freq: "monthly", h: 12 },
  { id: "fred_md_dataset", freq: "monthly", h: 12 }, { id: "m3_quarterly_dataset", freq: "quarterly", h: 8 },
  { id: "tourism_quarterly_dataset", freq: "quarterly", h: 8 }, { id: "m1_quarterly_dataset", freq: "quarterly", h: 8 },
  { id: "nn5_daily_dataset_with_missing_values", freq: "daily", h: 56 }, { id: "covid_deaths_dataset", freq: "daily", h: 30 },
  { id: "us_births_dataset", freq: "daily", h: 30 }, { id: "nn5_weekly_dataset", freq: "weekly", h: 8 },
  { id: "m4_weekly_dataset", freq: "weekly", h: 13 }, { id: "traffic_weekly_dataset", freq: "weekly", h: 8 },
  { id: "electricity_weekly_dataset", freq: "weekly", h: 8 }, { id: "m4_hourly_dataset", freq: "hourly", h: 48 },
];

/** STL + ETS on one training stretch: the season of the last cycle repeated, ETS on what is left. */
function stlEts(train: number[], m: number, H: number): number[] | null {
  const n = train.length;
  if (m < 2 || n < 2 * m + 2) return null;
  const dec = mstl(train, [m], 1);
  const seas = dec.seasonal[0]!;
  const adj = new Float64Array(n);
  for (let t = 0; t < n; t++) adj[t] = train[t]! - seas[t]!;
  const fit = etsSelect(adj, 0, n, 1, adj);
  const run = etsRun(adj, 0, n, fit, [], adj);
  const f = new Float64Array(H);
  etsForecast(run.final, fit, n, H, f, 0);
  return Array.from(f, (v, h) => v + seas[n - m + (h % m)]!);
}

const folder = process.argv[2] ?? "";
const cap = Number(process.argv[3] ?? 120);
const only = process.argv[4] ?? "";
if (folder === "") { console.error("usage: tsx tools/ts-eval/stlf.ts <folder of .tsf files> [max series per dataset] [filter]"); process.exit(1); }

const total: Record<string, number[]> = { ets: [], comb: [], auto: [], stlets: [], blend: [] };
const header = "dataset".padEnd(28) + "  n   m    ETS   Comb   Auto  STL+ETS  blend | STL+ETS beats ETS / Comb";
console.log(header);
for (const d of DATASETS) {
  if (only && !d.id.includes(only)) continue;
  let file;
  try { file = readTsf(join(folder, `${d.id}.tsf`)); } catch { console.log(`${d.id}: file not found`); continue; }
  const m = FREQ[d.freq].season;
  const stride = Math.max(1, Math.floor(file.series.length / cap));
  const rows: Record<string, number[]> = { ets: [], comb: [], auto: [], stlets: [], blend: [] };
  let beatEts = 0, beatComb = 0;
  for (let i = 0; i < file.series.length && rows.ets.length < cap; i += stride) {
    const s = file.series[i]!;
    const h = file.horizon ?? d.h;
    const r = forecastsAll(s, d.freq, h);
    if ("skip" in r) continue;
    const f = stlEts(r.train, m, h);
    if (f === null) continue;
    const sc = (x: ArrayLike<number>): number => mase(r.train, r.test, x, r.season);
    const ets = sc(r.F.ets), comb = sc(r.F.comb), auto = sc(r.F[r.auto]), stlets = sc(f);
    const blend = sc(f.map((v, k) => (v + r.F.comb[k]!) / 2));
    if (![ets, comb, auto, stlets, blend].every(Number.isFinite)) continue;
    rows.ets.push(ets); rows.comb.push(comb); rows.auto.push(auto); rows.stlets.push(stlets); rows.blend.push(blend);
    if (stlets < ets) beatEts++;
    if (stlets < comb) beatComb++;
  }
  const n = rows.ets.length;
  if (n === 0) continue;
  for (const k of Object.keys(total)) total[k]!.push(...rows[k]!);
  const f3 = (k: string): string => meanOf(rows[k]!).toFixed(3).padStart(6);
  console.log(`${d.id.replace(/_dataset.*$/, "").padEnd(28)}${String(n).padStart(4)} ${String(m).padStart(3)}  ${f3("ets")} ${f3("comb")} ${f3("auto")}  ${f3("stlets")} ${f3("blend")} | ${beatEts}/${n} ${beatComb}/${n}`);
}
const f3 = (k: string): string => meanOf(total[k]!).toFixed(3).padStart(6);
console.log(`${"ALL (mean of series)".padEnd(28)}${String(total.ets!.length).padStart(4)}      ${f3("ets")} ${f3("comb")} ${f3("auto")}  ${f3("stlets")} ${f3("blend")}`);

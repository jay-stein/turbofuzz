/**
 * Time Series evaluation across real series: runs the page's engine (models, lockbox,
 * Deep check, flexibility curve) on each series in a folder of CSVs and prints what the
 * Auto pick was, how it held up on the unseen lockbox fold, and what a "prefer the
 * simpler model when not significantly worse" rule would have picked instead.
 *
 *   npx tsx tools/ts-eval/run.ts <folder with the CSVs>
 *
 * The data is not in the repo (the app stays small and offline); see README.md for
 * where each file comes from.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { buildTable } from "../../src/data/timeseries/base.js";
import type { GrainId } from "../../src/data/timeseries/base.js";
import type { TsAgg } from "../../src/data/timeseries/aggregate.js";
import { defaultConfig, TsEngine } from "../../src/data/timeseries/engine.js";
import { MODEL_INFO, MODEL_KEYS, type ModelKey } from "../../src/data/timeseries/models.js";

interface Spec { name: string; file: string; time: string; value: string; group?: string; groupValue?: string; grain: GrainId; agg: TsAgg; parseTime?: (s: string) => number }

const iso = (s: string): number => Date.parse(s.replace(" ", "T").replace(/(T\d\d:\d\d:\d\d)$/, "$1Z").replace(/^(\d{4}-\d\d-\d\d)$/, "$1T00:00:00Z"));
const month = (s: string): number => { const [y, m] = s.split("-").map(Number); return Date.UTC(y!, m! - 1, 1); };

const SPECS: Spec[] = [
  { name: "Airline passengers (monthly)", file: "airline-passengers.csv", time: "Month", value: "Passengers", grain: "month", agg: "sum", parseTime: month },
  { name: "Car sales, Quebec (monthly)", file: "monthly-car-sales.csv", time: "Month", value: "Sales", grain: "month", agg: "sum", parseTime: month },
  { name: "Shampoo sales (monthly, 36)", file: "shampoo.csv", time: "Month", value: "Sales", grain: "month", agg: "sum", parseTime: (s) => { const [y, m] = s.split("-").map(Number); return Date.UTC(2000 + y!, m! - 1, 1); } },
  { name: "Sunspots (monthly, no season)", file: "monthly-sunspots.csv", time: "Month", value: "Sunspots", grain: "month", agg: "sum", parseTime: month },
  { name: "Min temperature, Melbourne (daily)", file: "daily-min-temperatures.csv", time: "Date", value: "Temp", grain: "day", agg: "mean" },
  { name: "Female births, California (daily)", file: "daily-total-female-births.csv", time: "Date", value: "Births", grain: "day", agg: "sum" },
  { name: "Gym occupancy (hourly)", file: "gym_stats.csv", time: "date", value: "number_people", grain: "hour", agg: "mean", parseTime: (s) => Date.parse(s.replace(" ", "T")) },
  ...["A", "B", "C", "E", "F"].map((p): Spec => ({ name: `Chadstone parking ${p} (hourly)`, file: "parking.csv", time: "retrieved_at", value: "occupied", group: "car_park", groupValue: p, grain: "hour", agg: "mean" })),
  { name: "Chadstone parking, all (hourly)", file: "parking.csv", time: "retrieved_at", value: "occupied", grain: "hour", agg: "sum" },
];

/** Simple CSV: these files have no quoted commas. */
function readCsv(path: string): { head: string[]; rows: string[][] } {
  const lines = readFileSync(path, "utf8").replace(/\r/g, "").trim().split("\n");
  const cells = (l: string): string[] => l.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
  return { head: cells(lines[0]!), rows: lines.slice(1).map(cells) };
}

const COMPLEXITY: Record<ModelKey, number> = { sn: 0, clim: 1, theta: 2, hw: 3, ets: 3, reg: 4, ens: 5 };
const name = (k: ModelKey): string => MODEL_INFO[k].name;
const dir = process.argv[2];
if (!dir) throw new Error("usage: npx tsx tools/ts-eval/run.ts <folder>");

const summary: { series: string; auto: ModelKey; autoRank: number; simple: ModelKey; simpleRank: number; tol2: ModelKey; tol2Rank: number; tol5: ModelKey; tol5Rank: number; flexBest: number; lbP: number; cov80: number }[] = [];
/** The simplest model whose selection MASE is within tol of the best. */
const withinTol = (models: Record<ModelKey, { mase: number }>, best: ModelKey, tol: number): ModelKey =>
  [...MODEL_KEYS].filter((k) => models[k].mase <= models[best].mase * (1 + tol)).sort((a, b) => COMPLEXITY[a] - COMPLEXITY[b] || models[a].mase - models[b].mase)[0] ?? best;
for (const spec of SPECS) {
  const path = join(dir, spec.file);
  if (!existsSync(path)) { console.log(`skip ${spec.name}: ${spec.file} not found`); continue; }
  const { head, rows } = readCsv(path);
  const ti = head.indexOf(spec.time), vi = head.indexOf(spec.value), gi = spec.group ? head.indexOf(spec.group) : -1;
  const keep = rows.filter((r) => gi < 0 || r[gi] === spec.groupValue);
  const parse = spec.parseTime ?? iso;
  const pairs = keep.map((r) => [parse(r[ti]!), Number(r[vi])] as const).filter(([t, v]) => Number.isFinite(t) && Number.isFinite(v)).sort((a, b) => a[0] - b[0]);
  const table = buildTable({ times: Float64Array.from(pairs, (p) => p[0]), cols: { value: Float64Array.from(pairs, (p) => p[1]) }, flags: {}, groups: ["all"], rowGroup: new Uint16Array(pairs.length), groupCol: null, dateCol: spec.time, dropped: 0 });
  if (!table) { console.log(`skip ${spec.name}: no table`); continue; }
  const engine = new TsEngine(table);
  const cfg = { ...defaultConfig(engine.info()), grain: spec.grain, agg: spec.agg, measure: "value" };
  const t0 = performance.now();
  const plain = engine.compute(cfg, "forecast");
  if ("error" in plain.models) { console.log(`skip ${spec.name}: ${plain.models.error}`); continue; }
  const auto = plain.models.best;
  const s = engine.compute(cfg, "forecast", { deep: auto, flexCurve: true });
  const ms = performance.now() - t0;
  const M = plain.models, d = s.deep!;
  const lockRank = (k: ModelKey): number => { const v = (x: ModelKey): number => M.models[x].lock?.mase ?? Infinity; return 1 + MODEL_KEYS.filter((x) => v(x) < v(k)).length; };
  // The simplest model the DM test cannot separate from the pick (p >= 0.05, or better).
  const simplerOk = d.dm.filter((t) => COMPLEXITY[t.other] < COMPLEXITY[auto] && t.other !== "sn" && (!(t.p < 0.05) || t.diff > 0));
  const simple = simplerOk.sort((a, b) => COMPLEXITY[a.other] - COMPLEXITY[b.other] || a.p - b.p)[0]?.other ?? auto;
  const curve = s.flexCurve ?? [];
  const flexBest = curve.length ? curve.reduce((p, q) => (q.mase < p.mase ? q : p)).flex : NaN;
  const ranked = [...MODEL_KEYS].sort((a, b) => M.models[a].mase - M.models[b].mase);
  console.log(`\n== ${spec.name}: ${M.T} ${plain.A.g.nouns}, season ${M.m}, horizon ${M.H}, ${M.origins.length} folds (${ms.toFixed(0)} ms)`);
  console.log(`   selection ranking (MASE): ${ranked.map((k) => `${name(k)} ${M.models[k].mase.toFixed(2)}`).join(" | ")}`);
  console.log(`   Auto: ${name(auto)}  lockbox rank #${lockRank(auto)}  vs repeat-last-cycle ${M.models[auto].ratio.toFixed(2)}x  folds beaten ${M.models[auto].folds.won}/${M.models[auto].folds.of}`);
  console.log(`   DM vs: ${d.dm.map((t) => `${name(t.other)} p=${t.p.toFixed(3)}${t.diff > 0 ? "(worse)" : ""}`).join(", ")}`);
  const tol2 = withinTol(M.models, auto, 0.02), tol5 = withinTol(M.models, auto, 0.05);
  console.log(`   simpler-when-not-significant pick: ${name(simple)}  lockbox rank #${lockRank(simple)}; within 2%: ${name(tol2)} #${lockRank(tol2)}; within 5%: ${name(tol5)} #${lockRank(tol5)}`);
  console.log(`   flexibility curve MASE: ${curve.map((c) => c.mase.toFixed(2)).join(" ")}  (best ${flexBest}; ETS spec ${M.models.ets.ets?.spec})`);
  console.log(`   residuals of Auto: Ljung-Box p=${d.resid?.lb.p.toFixed(3)}  80% coverage ${(d.calib[auto].cov80 * 100).toFixed(0)}%  95% ${(d.calib[auto].cov95 * 100).toFixed(0)}%`);
  summary.push({ series: spec.name, auto, autoRank: lockRank(auto), simple, simpleRank: lockRank(simple), tol2, tol2Rank: lockRank(tol2), tol5, tol5Rank: lockRank(tol5), flexBest, lbP: d.resid?.lb.p ?? NaN, cov80: d.calib[auto].cov80 });
}
console.log("\n== Summary");
for (const r of summary) console.log(`${r.series.padEnd(38)} Auto ${name(r.auto).padEnd(28)} #${r.autoRank}   simpler ${name(r.simple).padEnd(28)} #${r.simpleRank}   flex* ${r.flexBest}   LB p ${r.lbP.toFixed(3)}   cov80 ${(r.cov80 * 100).toFixed(0)}%`);
const mean = (f: (r: (typeof summary)[number]) => number): number => summary.reduce((a, r) => a + f(r), 0) / (summary.length || 1);
console.log(`\nmean lockbox rank: Auto ${mean((r) => r.autoRank).toFixed(2)}; DM simpler rule ${mean((r) => r.simpleRank).toFixed(2)} (switched ${summary.filter((r) => r.auto !== r.simple).length}); within 2% ${mean((r) => r.tol2Rank).toFixed(2)} (switched ${summary.filter((r) => r.auto !== r.tol2).length}); within 5% ${mean((r) => r.tol5Rank).toFixed(2)} (switched ${summary.filter((r) => r.auto !== r.tol5).length}) of ${summary.length}`);
for (const r of summary) if (r.auto !== r.tol2 || r.auto !== r.tol5) console.log(`  ${r.series}: Auto ${name(r.auto)} #${r.autoRank} -> 2%: ${name(r.tol2)} #${r.tol2Rank}, 5%: ${name(r.tol5)} #${r.tol5Rank}`);
console.log(`best flexibility per series: ${summary.map((r) => r.flexBest).join(", ")}`);

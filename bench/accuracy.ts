/**
 * Accuracy gate for the Time Series forecasts, the counterpart of bench:timeseries
 * (which guards speed). Runs the fixed series of test/fixtures/accuracy (about 60 series
 * from 20 Monash archive datasets) through the page's engine on the archive's protocol,
 * and compares each dataset's mean MASE with the stored baseline.
 *
 * The user-facing forecast ("auto") and the ETS + Theta + damped combination ("eth") must
 * not get more than 2% worse on any dataset. Every other model is printed for information.
 * A change that is meant to move the numbers (a better model, a new default) updates the
 * baseline with --update, and the changelog says why.
 *
 *   npm run bench:accuracy              check against the baseline
 *   npm run bench:accuracy -- --update  write a new baseline
 */

import { readFileSync, writeFileSync } from "node:fs";
import { KEYS, meanOf, runSeries, type FreqName, type Key } from "../tools/ts-eval/lib.js";

const TOLERANCE = 0.02;
const GATED: Key[] = ["auto", "eth"];
const BASELINE = "test/fixtures/accuracy/baseline.json";
const update = process.argv.includes("--update");

interface Fixture { series: { dataset: string; freq: FreqName; h: number; id: string; start: number; values: number[] }[] }
const fixture = JSON.parse(readFileSync("test/fixtures/accuracy/series.json", "utf8")) as Fixture;

const byDataset = new Map<string, Fixture["series"]>();
for (const s of fixture.series) byDataset.set(s.dataset, [...(byDataset.get(s.dataset) ?? []), s]);

const t0 = performance.now();
const scores: Record<string, Record<Key, number>> = {};
for (const [dataset, list] of byDataset) {
  const sums = Object.fromEntries(KEYS.map((k) => [k, [] as number[]])) as Record<Key, number[]>;
  for (const s of list) {
    const r = runSeries({ name: s.id, start: s.start, values: s.values }, s.freq, s.h);
    if ("skip" in r) { console.error(`${dataset} ${s.id}: engine could not forecast it (${r.skip})`); process.exit(1); }
    for (const k of KEYS) sums[k].push(r.mase[k]);
  }
  scores[dataset] = Object.fromEntries(KEYS.map((k) => [k, meanOf(sums[k])])) as Record<Key, number>;
}
const secs = ((performance.now() - t0) / 1000).toFixed(1);

if (update) {
  const rounded = Object.fromEntries(Object.entries(scores).map(([d, v]) => [d, Object.fromEntries(Object.entries(v).map(([k, x]) => [k, Math.round(x * 1e4) / 1e4]))]));
  writeFileSync(BASELINE, JSON.stringify(rounded, null, 1) + "\n");
  console.log(`Baseline written (${byDataset.size} datasets, ${fixture.series.length} series, ${secs} s) -> ${BASELINE}`);
  process.exit(0);
}

const baseline = JSON.parse(readFileSync(BASELINE, "utf8")) as Record<string, Record<Key, number>>;
let failed = 0;
console.log(`${"dataset".padEnd(22)} ${"n".padStart(2)}  ${GATED.map((k) => `${k} (now / baseline)`.padEnd(26)).join("")}  other models (MASE now)`);
for (const [dataset, now] of Object.entries(scores)) {
  const base = baseline[dataset];
  const cells = GATED.map((k) => {
    if (!base) return "new dataset".padEnd(26);
    const was = base[k], change = now[k] / was - 1, over = change > TOLERANCE;
    if (over) failed++;
    return `${over ? "OVER " : "ok   "}${now[k].toFixed(3)} / ${was.toFixed(3)} (${change >= 0 ? "+" : ""}${(change * 100).toFixed(1)}%)`.padEnd(26);
  });
  const others = (["ets", "theta", "hw", "reg", "sn"] as Key[]).map((k) => `${k} ${now[k].toFixed(2)}`).join(" ");
  console.log(`${dataset.padEnd(22)} ${String(byDataset.get(dataset)!.length).padStart(2)}  ${cells.join("")}  ${others}`);
}
const stale = Object.keys(baseline).filter((d) => !(d in scores));
if (stale.length) { console.log(`Baseline has datasets the fixture no longer holds: ${stale.join(", ")}`); failed++; }
console.log(`\n${fixture.series.length} series in ${secs} s`);
if (failed) {
  console.error(`Accuracy gate failed: ${failed} check(s) more than ${TOLERANCE * 100}% worse than the baseline. If the change is meant to move the numbers, run npm run bench:accuracy -- --update and explain it in the changelog.`);
  process.exit(1);
}
console.log("Accuracy gate passed.");

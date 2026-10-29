// Profiles files from any path through the app's own ingest + scoring modules
// and prints what the Data Quality page would flag. Nothing is copied into the repo.
// Usage: npx tsx scripts/corpus-profile.ts <file.csv> [more files...]
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { profileBuffer } from "./lib/profile.js";

for (const path of process.argv.slice(2)) {
  const file = readFileSync(path);
  const buffer = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer;
  const { dataset, metas, score, loadMs } = await profileBuffer(basename(path), buffer);
  console.log(`\n=== ${basename(path)}  ${dataset.rowCount.toLocaleString()} rows x ${metas.length} cols  load ${loadMs.toFixed(0)} ms`);
  console.log(`score ${score.overall?.toFixed(1)} ${score.band}  ` + score.dimensions.map((d) => `${d.abbreviation} ${d.score === null ? "n/a" : d.score.toFixed(1)}`).join("  "));
  const failing = score.dimensions.flatMap((d) => d.checks).filter((c) => c.fail > 0 && c.dimension !== "completeness");
  failing.sort((a, b) => b.fail - a.fail);
  for (const c of failing.slice(0, 12)) console.log(`  [${c.dimension}] ${c.label}: ${c.fail.toLocaleString()} — ${c.detail}`);
  const sem = metas.map((m, i) => `${m.name}:${dataset.columns[i].semantic?.type}`).filter((s) => !/:(measure|category|unknown|date)$/.test(s));
  console.log(`  semantic: ${sem.join(", ")}`);
  for (const [i, m] of metas.entries()) {
    for (const sg of m.suggestions) {
      if (sg.kind === "sentinel") console.log(`  review: ${m.name}: ${sg.count.toLocaleString()} x "${sg.value}"${sg.hint ? ` (${sg.hint})` : ""}`);
    }
  }
  const empty = metas.filter((m) => m.stats.nulls >= dataset.rowCount * 0.5).map((m) => `${m.name} (${((m.stats.nulls / dataset.rowCount) * 100).toFixed(0)}%)`);
  if (empty.length) console.log(`  mostly empty: ${empty.join(", ")}`);
}

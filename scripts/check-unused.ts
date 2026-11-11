/**
 * Fails when code gains an unused import, variable or private member. Older ones are listed in
 * scripts/unused-baseline.txt and may stay until someone removes them; the list may only shrink.
 *   npm run check:unused            check
 *   npm run check:unused -- --write rewrite the list (after removing some)
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const BASELINE = resolve(import.meta.dirname, "unused-baseline.txt");
const run = spawnSync("npx", ["tsc", "--noEmit", "--noUnusedLocals"], { encoding: "utf8", shell: true, cwd: resolve(import.meta.dirname, "..") });
const found = new Set<string>();
for (const line of `${run.stdout}\n${run.stderr}`.split(/\r?\n/)) {
  const match = /^(.+?)\(\d+,\d+\): error TS(?:6133|6196|6192): '?([^']*)'? is declared|^(.+?)\(\d+,\d+\): error TS6192/.exec(line);
  if (match === null) continue;
  found.add(`${(match[1] ?? match[3] ?? "").replace(/\\/g, "/")} ${match[2] ?? "(all imports)"}`);
}
if (process.argv.includes("--write")) {
  writeFileSync(BASELINE, [...found].sort().join("\n") + "\n");
  console.log(`unused baseline written: ${found.size}`);
  process.exit(0);
}
const known = new Set(readFileSync(BASELINE, "utf8").split(/\r?\n/).filter(Boolean));
const added = [...found].filter((entry) => !known.has(entry));
const gone = [...known].filter((entry) => !found.has(entry));
if (gone.length > 0) console.log(`${gone.length} listed item(s) are fixed; run with --write to shrink the list:\n  ${gone.join("\n  ")}`);
if (added.length > 0) {
  console.error(`New unused code (remove it, or use it):\n  ${added.join("\n  ")}`);
  process.exit(1);
}
console.log(`no new unused code (${known.size} older item(s) listed)`);

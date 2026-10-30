import { fuzzyScoreNormalized, normalizeForMatch } from "../src/search/fuzzy-match.js";
import { measure, ms } from "./bench-utils.js";

// One keystroke in a free-text filter scans every distinct value of the column for the
// best fits (the worker's suggestion scan: cheap tiers first, near-miss tier only when
// too few fit). Budgets are per keystroke, at 100k and 200k distinct values.
const BUDGETS: Record<number, number> = { 100_000: 40, 200_000: 80 };

let seed = 11;
const rnd = (): number => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const syl = ["lon", "don", "ber", "lin", "par", "is", "new", "york", "san", "fran", "cis", "co", "mel", "bourne", "syd", "ney", "tok", "yo", "ka", "ra"];
const name = (): string => Array.from({ length: 2 + Math.floor(rnd() * 3) }, () => syl[Math.floor(rnd() * syl.length)]).join("") + " " + Math.floor(rnd() * 5000);

function scan(keys: string[], q: string, limit: number): number {
  let hits = 0;
  for (const typo of [false, true]) {
    hits = 0;
    const best: number[] = [];
    for (let i = 0; i < keys.length; i++) {
      const score = fuzzyScoreNormalized(q, keys[i]!, typo);
      if (score === null) continue;
      hits++;
      if (best.length === limit && score <= best[limit - 1]!) continue;
      let at = best.length;
      while (at > 0 && best[at - 1]! < score) at--;
      best.splice(at, 0, score);
      if (best.length > limit) best.pop();
    }
    if (best.length >= limit) break;
  }
  return hits;
}

let failed = false;
for (const [n, budget] of Object.entries(BUDGETS)) {
  const keys = Array.from({ length: Number(n) }, () => normalizeForMatch(name()));
  // A query that fits plenty (fast path), and a misspelling that needs the near-miss tier (worst case).
  for (const [label, q] of [["a few letters", "lond"], ["a misspelling", "pasris"]] as const) {
    const r = measure(() => scan(keys, q, 8), { iterations: 6, warmup: 1 });
    const over = r.p95 > budget;
    if (over) failed = true;
    console.log(`${over ? "OVER" : "ok  "} ${`suggest ${label} over ${Number(n).toLocaleString()} values`.padEnd(46)} p95 ${ms(r.p95).padStart(7)} ms  budget ${budget} ms`);
  }
}
if (failed) {
  console.error("Fuzzy suggestion latency gate failed.");
  process.exitCode = 1;
}

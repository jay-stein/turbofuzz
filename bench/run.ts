import { writeFileSync } from "node:fs";
import { arch, cpus, platform, release } from "node:os";
import { FuzzyIndex } from "./fuzzy-index.js";
import { generateDataset } from "./data.js";
import { BitSet } from "./lib/bitset.js";
import { jaroWinkler } from "./lib/jaro-winkler.js";
import { normalize } from "./lib/normalize.js";
import { count, measure, memMB, ms, type Timing } from "./bench-utils.js";
import { LinearSubstringEngine } from "./baselines/linear.js";
import { FuseEngine } from "./baselines/fuse.js";
import { FlexSearchEngine } from "./baselines/flexsearch.js";
import { UFuzzyEngine } from "./baselines/ufuzzy.js";
import type { RowEngine } from "./baselines/types.js";

const THRESHOLD = 0.72;
const TOKEN_LIMIT = 100;
const ENGINE_RESULT_LIMIT = 1000;
const END_TO_END_CATEGORIES = new Set(["Active", "Trial"]);

interface QuerySpec {
  label: string;
  q: string;
}

const QUERIES: QuerySpec[] = [
  { label: "Johnson (exact)", q: "Johnson" },
  { label: "Jonson (1 substitution)", q: "Jonson" },
  { label: "Jhonson (1 insertion)", q: "Jhonson" },
  { label: "Johnston", q: "Johnston" },
  { label: "Johnsen", q: "Johnsen" },
  { label: "Smith (exact)", q: "Smith" },
  { label: "Smyth", q: "Smyth" },
  { label: "Jo (short prefix)", q: "Jo" },
  { label: "Xyzzy (no match)", q: "Xyzzy" },
];

function arg(name: string, fallback: string): string {
  const prefix = `--${name}=`;
  const found = process.argv.find((a) => a.startsWith(prefix));
  return found === undefined ? fallback : found.slice(prefix.length);
}

function parseNumericColumn(values: readonly string[]): Float64Array {
  const out = new Float64Array(values.length);
  for (let i = 0; i < values.length; i++) {
    const n = Number(values[i].replace(/,/g, ""));
    out[i] = Number.isFinite(n) ? n : NaN;
  }
  return out;
}

function rangeBits(values: Float64Array, min: number, max: number): BitSet {
  const bits = new BitSet(values.length);
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v >= min && v <= max) bits.set(i);
  }
  return bits;
}

function categoryBits(values: readonly string[], selected: ReadonlySet<string>): BitSet {
  const bits = new BitSet(values.length);
  for (let i = 0; i < values.length; i++) {
    if (selected.has(values[i])) bits.set(i);
  }
  return bits;
}

function groundTruthTokenIds(index: FuzzyIndex, query: string, threshold: number): number[] {
  const tokens = index.getTokens();
  const q = normalize(query);
  const out: number[] = [];
  for (let id = 0; id < tokens.length; id++) {
    if (jaroWinkler(q, tokens[id]) >= threshold) out.push(id);
  }
  return out;
}

function tokenRecall(matched: readonly number[], truth: readonly number[]): number {
  if (truth.length === 0) return 1;
  const set = new Set(truth);
  let hit = 0;
  for (const id of matched) if (set.has(id)) hit++;
  return hit / truth.length;
}

function table(headers: string[], rows: readonly string[][]): string {
  const lines = [`| ${headers.join(" | ")} |`, `| ${headers.map(() => "---").join(" | ")} |`];
  for (const row of rows) lines.push(`| ${row.join(" | ")} |`);
  return lines.join("\n");
}

const sizes = arg("sizes", "10000,50000,100000")
  .split(",")
  .map((s) => Number.parseInt(s.trim(), 10));
const seed = Number.parseInt(arg("seed", "42"), 10);
const iterations = Number.parseInt(arg("iterations", "25"), 10);
const outPath = arg("out", "");

const report: string[] = [];
report.push("# Fuzzy search benchmark");
report.push("");
report.push(`- Date: ${new Date().toISOString()}`);
report.push(`- Machine: ${cpus()[0]?.model ?? "unknown"}`);
report.push(`- Platform: ${platform()} ${release()} ${arch()}`);
report.push(`- Node: ${process.version}`);
report.push(`- Seed: ${seed}`);
report.push(`- Query iterations (max): ${iterations}`);
report.push(`- Scoring: Jaro-Winkler >= ${THRESHOLD}, top ${TOKEN_LIMIT} tokens`);
report.push("");

for (const size of sizes) {
  console.log(`\n=== ${count(size)} rows ===`);
  const data = generateDataset(size, seed);
  const names = data.columns.customer_name;

  const index = new FuzzyIndex();
  const stats = index.build(names);
  const mem1 = memMB();
  console.log(
    `  custom token index: ${count(stats.distinctTokens)} distinct tokens, ` +
      `${ms(stats.totalMs)} ms build, rss ${mem1.rssMB.toFixed(0)} MB`,
  );

  let usage: Float64Array = new Float64Array(0);
  let years: Float64Array = new Float64Array(0);
  const usageTiming = measure(() => {
    usage = parseNumericColumn(data.columns.annual_usage);
  }, { iterations: 1, warmup: 0 });
  const yearTiming = measure(() => {
    years = parseNumericColumn(data.columns.year);
  }, { iterations: 1, warmup: 0 });
  const catTiming = measure(() => {
    categoryBits(data.columns.status, END_TO_END_CATEGORIES);
  }, { iterations: 1, warmup: 0 });

  const engines: RowEngine[] = [
    new FlexSearchEngine(),
    new FuseEngine(),
    new UFuzzyEngine(),
    new LinearSubstringEngine(),
  ];
  const engineBuildRows: string[][] = [];
  for (const engine of engines) {
    const timing = measure(() => engine.build(names), { iterations: 1, warmup: 0 });
    engineBuildRows.push([engine.name, ms(timing.mean)]);
    console.log(`  built ${engine.name} in ${ms(timing.mean)} ms`);
  }

  const latencyRows: string[][] = [];
  const customRows: string[][] = [];
  const p95ByEngine = new Map<string, number[]>();
  const record = (label: string, engine: string, timing: Timing, matches: number) => {
    latencyRows.push([label, engine, ms(timing.p50), ms(timing.p95), count(matches)]);
    const list = p95ByEngine.get(engine) ?? [];
    list.push(timing.p95);
    p95ByEngine.set(engine, list);
  };

  for (const spec of QUERIES) {
    const qNorm = normalize(spec.q);
    const tokens = index.getTokens();
    const truth = qNorm.length >= 3 ? groundTruthTokenIds(index, qNorm, THRESHOLD) : [];
    const truthInWindow = truth.filter((id) => Math.abs(tokens[id].length - qNorm.length) <= 2);

    for (const k of [2, 1]) {
      let matches = 0;
      const timing = measure(() => {
        const result = index.search(spec.q, { maxDistance: k, threshold: THRESHOLD, limit: TOKEN_LIMIT });
        matches = result.rowBits.count();
      }, { iterations });
      record(spec.label, `custom token k=${k}`, timing, matches);
    }

    const profiled = index.search(spec.q, {
      maxDistance: 2,
      threshold: THRESHOLD,
      limit: TOKEN_LIMIT,
      profile: true,
    });
    const recallText = truthInWindow.length > 0
      ? `${(tokenRecall(profiled.tokenIds, truthInWindow) * 100).toFixed(0)}%`
      : "n/a";
    customRows.push([
      spec.label,
      count(profiled.candidateCount),
      count(profiled.scoredCount),
      ms(profiled.stages.candidatesMs),
      ms(profiled.stages.scoreMs),
      ms(profiled.stages.expandMs),
      recallText,
      count(truthInWindow.length),
      count(truth.length - truthInWindow.length),
    ]);

    for (const engine of engines) {
      let matches = 0;
      const timing = measure(() => {
        matches = engine.search(spec.q);
      }, { iterations });
      record(spec.label, engine.name, timing, matches);
    }
  }

  const usageRange = { min: 20000, max: 60000 };
  const yearRange = { min: 2022, max: 2025 };
  let e2eMatches = 0;
  const e2eTiming = measure(() => {
    const result = index.search("Jonson", { maxDistance: 2, threshold: THRESHOLD, limit: TOKEN_LIMIT });
    const bits = result.rowBits;
    bits.and(rangeBits(usage, usageRange.min, usageRange.max));
    bits.and(rangeBits(years, yearRange.min, yearRange.max));
    bits.and(categoryBits(data.columns.status, END_TO_END_CATEGORIES));
    e2eMatches = bits.count();
  }, { iterations });

  report.push(`## ${count(size)} rows`);
  report.push("");
  report.push(`- Distinct tokens: **${count(stats.distinctTokens)}** from ${count(size)} values`);
  report.push(`- Token postings: ${count(stats.totalPostings)}, bigrams indexed: ${count(stats.totalGrams)}`);
  report.push(`- Custom index build: ${ms(stats.dictMs)} ms dict + ${ms(stats.indexMs)} ms grams = **${ms(stats.totalMs)} ms**`);
  report.push(`- RSS after ingest (10 string columns) + index: ${mem1.rssMB.toFixed(0)} MB`);
  report.push(`- Column scans: usage parse ${ms(usageTiming.mean)} ms, year parse ${ms(yearTiming.mean)} ms, category bitset ${ms(catTiming.mean)} ms`);
  report.push("");
  report.push("### Baseline build times");
  report.push("");
  report.push(table(["engine", "build ms"], engineBuildRows));
  report.push("");
  report.push(`### Fuzzy query latency (p50 / p95 ms, matches capped at ${count(ENGINE_RESULT_LIMIT)})`);
  report.push("");
  report.push(table(["query", "engine", "p50", "p95", "matches"], latencyRows));
  report.push("");
  report.push("### Custom token index — stage breakdown and recall (k=2, profiled single run)");
  report.push("");
  report.push(table(
    [
      "query",
      "candidates",
      "scored",
      "cand ms",
      "score ms",
      "expand ms",
      "token recall vs JW>=0.72 (within ±k)",
      "GT tokens in window",
      "GT tokens outside window",
    ],
    customRows,
  ));
  report.push("");
  report.push(
    "Recall is measured against tokens scoring JW >= 0.72 that also fall inside the ±k length window. " +
      "Tokens outside the window (for example the short token \"john\" when searching \"johnston\") are " +
      "intentionally pruned to protect precision; the last column shows how many such tokens exist.",
  );
  report.push("");
  report.push("### Engine summary (mean of per-query p95)");
  report.push("");
  const summaryRows = [...p95ByEngine.entries()].map(([engine, values]) => {
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    return [engine, ms(mean)];
  });
  report.push(table(["engine", "mean p95 ms"], summaryRows));
  report.push("");
  report.push("### End-to-end combined query");
  report.push("");
  report.push(
    `Fuzzy "Jonson" (k=2) AND annual_usage ${usageRange.min}-${usageRange.max} ` +
      `AND year ${yearRange.min}-${yearRange.max} AND status in {${[...END_TO_END_CATEGORIES].join(", ")}}`,
  );
  report.push("");
  report.push(table(["p50", "p95", "matches"], [[ms(e2eTiming.p50), ms(e2eTiming.p95), count(e2eMatches)]]));
  report.push("");
}

const text = report.join("\n");
console.log(text);
if (outPath !== "") {
  writeFileSync(outPath, `${text}\n`, "utf8");
  console.log(`\nReport written to ${outPath}`);
}

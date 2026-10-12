import { writeFileSync } from "node:fs";
import { arch, cpus, platform, release } from "node:os";
import { computeAggregate, type ViewDef } from "../src/data/aggregate.js";
import { buildDataset, rebuildDataset } from "../src/data/build.js";
import { applyCleanOps } from "../src/data/clean-ops.js";
import { ColumnData } from "../src/data/column.js";
import { computeRelationships } from "../src/data/relationships.js";
import { textProfile } from "../src/data/text-profile.js";
import { computeDistributionChanges } from "../src/data/distribution.js";
import { QueryEngine } from "../src/search/query-engine.js";
import { generateDataset } from "./data.js";
import { count, measure, memMB, ms, type Timing } from "./bench-utils.js";

function arg(name: string, fallback: string): string {
  const prefix = `--${name}=`;
  const found = process.argv.find((argument) => argument.startsWith(prefix));
  return found === undefined ? fallback : found.slice(prefix.length);
}

const sizes = arg("rows", "100000")
  .split(",")
  .map((value) => Number.parseInt(value.trim(), 10))
  .filter((value) => Number.isFinite(value) && value > 0);
const iterations = Number.parseInt(arg("iterations", "10"), 10);
const outPath = arg("out", "");

const COLUMNS = ["customer_name", "suburb", "status", "install_date", "annual_usage", "year", "nmi"] as const;

interface BenchCase {
  label: string;
  budgetMs: number;
  run(): void;
}

function casesFor(size: number): { cases: BenchCase[]; buildMs: number; rssMB: number } {
  const generated = generateDataset(size, 42, COLUMNS);
  const headers: string[] = [...COLUMNS];
  const rows: string[][] = new Array(size);
  for (let row = 0; row < size; row++) {
    rows[row] = COLUMNS.map((name) => generated.columns[name][row] ?? "");
  }
  const buildStart = performance.now();
  const dataset = buildDataset("latency", headers, rows);
  const buildMs = performance.now() - buildStart;
  const rssMB = memMB().rssMB;

  const indexOf = (name: string): number => headers.indexOf(name);
  const allIds = Uint32Array.from({ length: size }, (_, index) => index);
  const view = (def: Partial<ViewDef> & Pick<ViewDef, "dimensions" | "measures">): ViewDef => ({
    id: "bench",
    name: "bench",
    fill: "none",
    sort: { key: "m0", dir: "desc" },
    limit: 500,
    respectFilters: true,
    ...def,
  });

  return {
    buildMs,
    rssMB,
    cases: [
      {
        label: "Active view: count + sum + mean by status (8 groups)",
        budgetMs: 50,
        run: () =>
          computeAggregate(
            view({
              dimensions: [{ column: indexOf("status"), by: "value" }],
              measures: [
                { column: null, agg: "count" },
                { column: indexOf("annual_usage"), agg: "sum" },
                { column: indexOf("annual_usage"), agg: "mean" },
              ],
            }),
            dataset.columns,
            dataset.rowCount,
            allIds,
          ),
      },
      {
        label: "Time view: rows + sum by install month (gap fill)",
        budgetMs: 50,
        run: () =>
          computeAggregate(
            view({
              dimensions: [{ column: indexOf("install_date"), by: { time: "month" } }],
              measures: [
                { column: null, agg: "count" },
                { column: indexOf("annual_usage"), agg: "sum" },
              ],
              fill: "zero",
              sort: { key: "dim0", dir: "asc" },
            }),
            dataset.columns,
            dataset.rowCount,
            allIds,
          ),
      },
      {
        label: "High cardinality: count by nmi (top 500 of many groups)",
        budgetMs: 100,
        run: () =>
          computeAggregate(
            view({
              dimensions: [{ column: indexOf("nmi"), by: "value" }],
              measures: [{ column: null, agg: "count" }],
            }),
            dataset.columns,
            dataset.rowCount,
            allIds,
          ),
      },
      {
        label: "Expression measure: sum(annual_usage) / count(*) by status",
        budgetMs: 50,
        run: () =>
          computeAggregate(
            view({
              dimensions: [{ column: indexOf("status"), by: "value" }],
              measures: [{ column: null, agg: "expr", expr: "sum(annual_usage) / count(*)" }],
            }),
            dataset.columns,
            dataset.rowCount,
            allIds,
          ),
      },
      {
        label: "Clean commit: trim one column and rebuild the dataset",
        budgetMs: 500,
        run: () => {
          const source = dataset.columns[0];
          const raw = applyCleanOps(source.raw, [{ kind: "trim" }]);
          const rebuilt = ColumnData.create(source.name, raw);
          const columns = dataset.columns.slice();
          columns[0] = rebuilt;
          rebuildDataset(dataset, columns);
        },
      },
      {
        label: "Relationships report: Pearson + Spearman + η² (lazy)",
        budgetMs: 750,
        run: () => {
          computeRelationships(dataset.columns, dataset.rowCount, allIds);
        },
      },
      {
        label: "Text mining: token profile of a text column (lazy)",
        budgetMs: 500,
        run: () => {
          const column = dataset.columns[indexOf("customer_name")];
          if (column !== undefined) textProfile(column.raw, column.nullMask, 30);
        },
      },
      {
        label: "Distribution changes: PSI / V across row halves (lazy)",
        budgetMs: 250,
        run: () => {
          const all = new Uint32Array(dataset.rowCount);
          for (let row = 0; row < all.length; row++) all[row] = row;
          computeDistributionChanges(dataset.columns, dataset.rowCount, all);
        },
      },
      {
        label: "Filter keystroke: contains scan + sort (QueryEngine)",
        budgetMs: 50,
        run: () => {
          const engine = new QueryEngine(dataset);
          engine.evaluate(
            new Map([[indexOf("suburb"), { kind: "text", mode: "contains", query: "North" }]]),
          );
        },
      },
    ],
  };
}

const report: string[] = [];
report.push("# TurboFuzz latency benchmark — views, edits and filters");
report.push("");
report.push(`- Date: ${new Date().toISOString()}`);
report.push(`- Machine: ${cpus()[0]?.model ?? "unknown"}`);
report.push(`- Platform: ${platform()} ${release()} ${arch()}`);
report.push(`- Node: ${process.version}`);
report.push(`- Iterations per case: ${iterations} (p50/p95 reported)`);
report.push("");

for (const size of sizes) {
  console.log(`\n=== ${count(size)} rows ===`);
  const { cases, buildMs, rssMB } = casesFor(size);
  report.push(`## ${count(size)} rows`);
  report.push("");
  report.push(`Dataset build: ${ms(buildMs)} ms · RSS after build ${rssMB.toFixed(0)} MB`);
  report.push("");
  report.push("| Operation | Budget | p50 | p95 | Verdict |");
  report.push("|---|---|---|---|---|");
  for (const bench of cases) {
    const timing: Timing = measure(() => bench.run(), { iterations, warmup: 2 });
    const pass = timing.p50 <= bench.budgetMs;
    console.log(
      `${(pass ? "PASS" : "SLOW").padEnd(5)} ${bench.label.padEnd(62)} p50 ${ms(timing.p50).padStart(6)} ms  p95 ${ms(timing.p95).padStart(7)} ms  (budget ${bench.budgetMs} ms)`,
    );
    report.push(
      `| ${bench.label} | ${bench.budgetMs} ms | ${ms(timing.p50)} ms | ${ms(timing.p95)} ms | ${
        pass ? "pass" : "**slow**"
      } |`,
    );
  }
  report.push("");
}

report.push("Budgets follow the review's section 7: active view recompute < 50 ms at");
report.push("100k rows (≤ 3 measures), > 10k groups never blocks > 100 ms, instant");
report.push("clean/transform commit < 500 ms. The 300k run is the paste-limit ceiling.");
report.push("");

if (outPath !== "") writeFileSync(outPath, `${report.join("\n")}\n`);
console.log(`\n${report.join("\n")}`);

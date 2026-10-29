import { ColumnData } from "../src/data/column.js";
import { encodeExport } from "../src/ui/export-formats.js";
import { measure, ms } from "./bench-utils.js";

// Latency budgets for the chart-group value lists (built lazily in the worker when
// the Chart view opens) and for export encoding. Plain CSV must stay near-free;
// converting formats is opt-in and gets a looser budget.
const ROWS = Number(process.argv.find((arg) => arg.startsWith("--rows="))?.split("=")[1] ?? 1_000_000);
const EXPORT_ROWS = 100_000;
const GROUP_BUDGET_MS = 250;
const CSV_BUDGET_MS = 50;
const CONVERT_BUDGET_MS = 1500;

let failed = false;
function report(label: string, p95: number, budget: number, detail = ""): void {
  const over = p95 > budget;
  if (over) failed = true;
  console.log(`${over ? "OVER" : "ok  "} ${label}  p95 ${ms(p95)} ms  budget ${budget} ms ${detail}`);
}

const year = ColumnData.create(
  "year",
  Array.from({ length: ROWS }, (_, i) => String(2000 + (i % 25))),
  undefined,
  "dot",
  { type: "integer", skipSuggestions: true },
);
const label = ColumnData.create(
  "region",
  Array.from({ length: ROWS }, (_, i) => `region-${i % 40}`),
  undefined,
  "dot",
  { type: "string", skipSuggestions: true },
);

for (const [name, column] of [["integer", year], ["text", label]] as const) {
  // First call is the real cost; later calls are cached, so measure fresh columns.
  const fresh = ColumnData.create(
    column.name,
    Array.from({ length: ROWS }, (_, i) => (name === "integer" ? String(2000 + (i % 25)) : `region-${i % 40}`)),
    undefined,
    "dot",
    { type: name === "integer" ? "integer" : "string", skipSuggestions: true },
  );
  const start = performance.now();
  fresh.categorySummary();
  const first = performance.now() - start;
  report(`group list, ${name}, ${ROWS.toLocaleString()} rows (first build)`, first, GROUP_BUDGET_MS);
  const cached = measure(() => fresh.categorySummary(), { iterations: 50, warmup: 1 });
  report(`group list, ${name} (cached)`, cached.p95, 1);
}

const csv =
  "id,region,amount,note\r\n" +
  Array.from({ length: EXPORT_ROWS }, (_, i) => `${i},region-${i % 40},${i * 1.5},"a, b"\r\n`).join("");
for (const [format, budget] of [
  ["csv", CSV_BUDGET_MS],
  ["tsv", CONVERT_BUDGET_MS],
  ["json", CONVERT_BUDGET_MS],
  ["jsonl", CONVERT_BUDGET_MS],
] as const) {
  const times: number[] = [];
  for (let i = 0; i < 3; i++) {
    const start = performance.now();
    await encodeExport(csv, format, "none", "bench");
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  report(`export ${format}, ${EXPORT_ROWS.toLocaleString()} rows`, times[times.length - 1]!, budget);
}

if (failed) {
  console.error("Groups/export latency gate failed.");
  process.exitCode = 1;
}

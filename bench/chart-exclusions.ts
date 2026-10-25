import { ColumnData } from "../src/data/column.js";
import { keepRows, type ChartExclusion } from "../src/data/chart-exclusions.js";
import { measure, ms } from "./bench-utils.js";

// Latency budget for chart-scoped exclusions (every chart request that has any
// runs this over the rows in scope). Targets the common case: one or two
// excluded category values, a range, a text term.
const ROWS = Number(process.argv.find((arg) => arg.startsWith("--rows="))?.split("=")[1] ?? 1_000_000);
const BUDGET_MS = 150;

const countries = Array.from({ length: 60 }, (_, i) => `country-${i}`);
const columns = [
  ColumnData.create("country", Array.from({ length: ROWS }, (_, i) => countries[i % 60]!), undefined, "dot", {
    type: "category",
    skipSuggestions: true,
  }),
  ColumnData.create("points", Array.from({ length: ROWS }, (_, i) => String(80 + ((i * 7) % 21))), undefined, "dot", {
    type: "integer",
    skipSuggestions: true,
  }),
  ColumnData.create("note", Array.from({ length: ROWS }, (_, i) => (i % 5 === 0 ? "red blend" : "white")), undefined, "dot", {
    type: "string",
    skipSuggestions: true,
  }),
];
const ids = Uint32Array.from({ length: ROWS }, (_, i) => i);

let failed = false;
const cases: [string, ChartExclusion[]][] = [
  ["one category value", [{ kind: "values", column: 0, labels: ["country-3"] }]],
  ["three category values", [{ kind: "values", column: 0, labels: ["country-3", "country-9", "country-20"] }]],
  ["numeric range", [{ kind: "range", column: 1, min: 90, max: null }]],
  ["text term", [{ kind: "text", column: 2, query: "red" }]],
  [
    "value + range + text",
    [
      { kind: "values", column: 0, labels: ["country-3"] },
      { kind: "range", column: 1, min: 90, max: null },
      { kind: "text", column: 2, query: "red" },
    ],
  ],
];
for (const [name, exclusions] of cases) {
  keepRows(ids, exclusions, columns); // warm the category/number caches, as the app does
  const timing = measure(() => void keepRows(ids, exclusions, columns), { iterations: 5, warmup: 0 });
  const over = timing.p95 > BUDGET_MS;
  if (over) failed = true;
  console.log(`${over ? "OVER" : "ok  "} exclude ${name}, ${ROWS.toLocaleString()} rows  p95 ${ms(timing.p95)} ms  budget ${BUDGET_MS} ms`);
}
if (failed) {
  console.error("Chart exclusion latency gate failed.");
  process.exitCode = 1;
}

import { generateDataset } from "./data.js";
import { parseDelimited } from "../src/parse/parse.js";
import { buildDataset } from "../src/data/build.js";
import { QueryEngine, type ColumnFilter } from "../src/search/query-engine.js";

const sizeArg = process.argv.find((argument) => argument.startsWith("--rows="));
const size = sizeArg === undefined ? 100_000 : Number.parseInt(sizeArg.slice("--rows=".length), 10);

const COLUMNS = ["customer_name", "suburb", "status", "annual_usage", "year"] as const;

function toCsv(columns: Record<string, string[]>, rowCount: number): string {
  const escape = (value: string): string => (value.includes(",") ? `"${value}"` : value);
  const lines = [COLUMNS.join(",")];
  for (let row = 0; row < rowCount; row++) {
    lines.push(COLUMNS.map((name) => escape(columns[name][row])).join(","));
  }
  return lines.join("\n");
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

const data = generateDataset(size, 42);
const csv = toCsv(data.columns as unknown as Record<string, string[]>, size);

let start = performance.now();
const parsed = parseDelimited(csv, { delimiter: "auto" });
const parseMs = performance.now() - start;

start = performance.now();
const dataset = buildDataset("smoke", parsed.headers, parsed.rows);
const buildMs = performance.now() - start;

start = performance.now();
dataset.columns[0].fuzzyIndex();
const fuzzyBuildMs = performance.now() - start;

start = performance.now();
dataset.columns[3].median();
const medianMs = performance.now() - start;

const engine = new QueryEngine(dataset);
const statusLabels = dataset.columns[2].categories().labels;
const activeIndex = statusLabels.indexOf("Active");
const filters = new Map<number, ColumnFilter>([
  [0, { kind: "text", mode: "fuzzy", query: "Jonson" }],
  [1, { kind: "text", mode: "contains", query: "malvern" }],
  [2, { kind: "values", selected: [activeIndex] }],
  [3, { kind: "range", min: 20000, max: 60000 }],
]);

console.log(`rows: ${size.toLocaleString()}`);
console.log(`columns: ${dataset.columnCount} (${dataset.columns.map((c) => `${c.name}:${c.type}`).join(", ")})`);
console.log(`parse (Papa + sniff):      ${parseMs.toFixed(0)} ms`);
console.log(`build (types + stats):     ${buildMs.toFixed(0)} ms`);
console.log(
  `  └ dataset stats:         ${dataset.stats.computeMs.toFixed(0)} ms ` +
    `(${dataset.stats.duplicateRows.toLocaleString()} duplicate rows, ` +
    `${dataset.stats.totalNullCells.toLocaleString()} empty cells)`,
);
console.log(`fuzzy index build (name):  ${fuzzyBuildMs.toFixed(0)} ms`);
console.log(`median (lazy, on stats):   ${medianMs.toFixed(0)} ms`);

engine.evaluate(filters);
const runs = 30;
const times: number[] = [];
let matches = 0;
for (let i = 0; i < runs; i++) {
  const t0 = performance.now();
  matches = engine.evaluate(filters).length;
  times.push(performance.now() - t0);
}
console.log(`combined filter matches:   ${matches.toLocaleString()}`);
console.log(`combined query median:     ${median(times).toFixed(2)} ms (over ${runs} runs)`);

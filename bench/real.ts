import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { buildDataset } from "../src/data/build.js";
import { parseDelimited } from "../src/parse/parse.js";
import { filteredHistogram, filtersSignature, HistogramCache } from "../src/search/aggregates.js";
import { QueryEngine, type ColumnFilter } from "../src/search/query-engine.js";
import { buildRank, orderIds } from "../src/search/order.js";
import type { TextMode } from "../src/types.js";
import { memMB, percentile } from "./bench-utils.js";

function arg(name: string, fallback: string): string {
  const prefix = `--${name}=`;
  const found = process.argv.find((argument) => argument.startsWith(prefix));
  return found === undefined ? fallback : found.slice(prefix.length);
}

const csvPath = arg("csv", "");
if (csvPath === "") {
  console.error(
    "Usage: npm run bench:real -- --csv=<path> [--rows=N] [--text=col] [--number=col] [--category=col]",
  );
  process.exit(1);
}

const maxRows = Number.parseInt(arg("rows", "0"), 10);
const label = arg("name", basename(csvPath).replace(/\.[^.]+$/, ""));

let text = readFileSync(csvPath, "utf8");
if (maxRows > 0) {
  let index = -1;
  let lines = 0;
  while (lines <= maxRows) {
    index = text.indexOf("\n", index + 1);
    if (index === -1) break;
    lines++;
  }
  if (index !== -1) text = text.slice(0, index);
}

let start = performance.now();
const parsed = parseDelimited(text, { delimiter: "auto", hasHeaders: true });
const parseMs = performance.now() - start;

start = performance.now();
const dataset = buildDataset(label, parsed.headers, parsed.rows);
const buildMs = performance.now() - start;
const rss = memMB().rssMB;

function pickTextColumn(): number {
  let fallback = -1;
  for (let i = 0; i < dataset.columns.length; i++) {
    const column = dataset.columns[i];
    if (column.type !== "string" && column.type !== "identifier" && column.type !== "category") {
      continue;
    }
    const length = column.stats.avgLength ?? 0;
    if (length >= 3 && length <= 30) return i;
    if (fallback === -1) fallback = i;
  }
  return fallback;
}

function firstOfType(types: readonly string[]): number {
  return dataset.columns.findIndex((column) => types.includes(column.type));
}

function resolveColumn(spec: string, fallback: number): number {
  if (spec === "") return fallback;
  const index = Number.parseInt(spec, 10);
  if (Number.isFinite(index) && String(index) === spec) return index;
  const byName = dataset.columns.findIndex((column) => column.name === spec);
  return byName >= 0 ? byName : fallback;
}

const textIndex = resolveColumn(arg("text", ""), pickTextColumn());
const numberIndex = resolveColumn(arg("number", ""), firstOfType(["integer", "number"]));
const categoryIndex = resolveColumn(arg("category", ""), firstOfType(["category", "boolean"]));

function sampleToken(columnIndex: number): string {
  const raw = dataset.columns[columnIndex].raw;
  const counts = new Map<string, number>();
  const limit = Math.min(raw.length, 20_000);
  for (let i = 0; i < limit; i++) {
    const tokens = raw[i].toLowerCase().split(/[^a-z0-9]+/g);
    for (const token of tokens) {
      if (token.length >= 6 && token.length <= 12) {
        counts.set(token, (counts.get(token) ?? 0) + 1);
      }
    }
  }
  let best = "search";
  let bestCount = 0;
  for (const [token, count] of counts) {
    if (count > bestCount) {
      best = token;
      bestCount = count;
    }
  }
  return best;
}

const engine = new QueryEngine(dataset);
const target = sampleToken(textIndex);

function timeIt(fn: () => void): number {
  const t0 = performance.now();
  fn();
  return performance.now() - t0;
}

function evalFilter(column: number, filter: ColumnFilter): number {
  return engine.evaluate(new Map([[column, filter]])).length;
}

interface Stats {
  p50: number;
  p95: number;
  max: number;
}

function stats(times: number[]): Stats {
  const sorted = [...times].sort((a, b) => a - b);
  return {
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    max: sorted[sorted.length - 1],
  };
}

const fmt = (value: number): string => value.toFixed(value >= 10 ? 0 : value >= 1 ? 1 : 2);

function typingTimes(mode: TextMode): number[] {
  const times: number[] = [];
  for (let length = 1; length <= target.length; length++) {
    const query = target.slice(0, length);
    times.push(timeIt(() => evalFilter(textIndex, { kind: "text", mode, query })));
  }
  return times;
}

const table: [string, number, Stats][] = [];
function record(name: string, times: number[]): void {
  if (times.length > 0) table.push([name, times.length, stats(times)]);
}

const textColumn = dataset.columns[textIndex];
const normalizedMs = timeIt(() => textColumn.normalized());
const indexBuildMs = timeIt(() => textColumn.fuzzyIndex());

record("typing: contains (fresh each key)", typingTimes("contains"));
record("typing: exact (fresh each key)", typingTimes("exact"));
record("typing: fuzzy (fresh each key)", typingTimes("fuzzy"));
record("typing: phonetic (fresh each key)", typingTimes("phonetic"));

evalFilter(textIndex, { kind: "text", mode: "contains", query: target });
record(
  "repeat: contains (cached)",
  Array.from({ length: 50 }, () =>
    timeIt(() => evalFilter(textIndex, { kind: "text", mode: "contains", query: target })),
  ),
);

let numericMin: number | null = null;
let numericMax: number | null = null;
if (numberIndex >= 0) {
  const column = dataset.columns[numberIndex];
  column.numbers();
  numericMin = column.stats.min;
  numericMax = column.stats.max;
  if (numericMin !== null && numericMax !== null) {
    const times: number[] = [];
    for (let step = 1; step <= 10; step++) {
      const minValue = numericMin + ((numericMax - numericMin) * step) / 20;
      times.push(timeIt(() => evalFilter(numberIndex, { kind: "range", min: minValue, max: null })));
    }
    record("slider: range drag (fresh each step)", times);

    const numberColumn = dataset.columns[numberIndex];
    const histogramCache = new HistogramCache();
    const histogramTimes: number[] = [];
    for (let step = 1; step <= 10; step++) {
      const minValue = numericMin + ((numericMax - numericMin) * step) / 20;
      const filterSet = new Map<number, ColumnFilter>([
        [numberIndex, { kind: "range", min: minValue, max: null }],
      ]);
      const signature = filtersSignature(filterSet, numberIndex);
      histogramTimes.push(
        timeIt(() => {
          if (histogramCache.get(numberIndex, signature) !== null) return;
          const baseBits = engine.evaluateBits(filterSet, numberIndex);
          const bins = filteredHistogram(numberColumn, baseBits, dataset.rowCount);
          if (bins !== null) histogramCache.set(numberIndex, signature, bins);
        }),
      );
    }
    record("slider: histogram (other-filter cached)", histogramTimes);
  }
}

let categoryLabels: string[] = [];
if (categoryIndex >= 0) {
  const categories = dataset.columns[categoryIndex].categories();
  categoryLabels = categories.labels;
  const times: number[] = [];
  for (let i = 0; i < Math.min(categories.labels.length, 10); i++) {
    const selected = categories.labels.map((_, index) => index).filter((index) => index !== i);
    times.push(timeIt(() => evalFilter(categoryIndex, { kind: "values", selected })));
  }
  record("facet: toggle a value", times);
}

if (numberIndex >= 0 && numericMin !== null && categoryLabels.length > 0) {
  const times: number[] = [];
  for (let length = 1; length <= target.length; length++) {
    const filters = new Map<number, ColumnFilter>([
      [textIndex, { kind: "text", mode: "contains", query: target.slice(0, length) }],
      [numberIndex, { kind: "range", min: numericMin, max: null }],
      [
        categoryIndex,
        {
          kind: "values",
          selected: categoryLabels.map((_, index) => index).filter((index) => index !== 0),
        },
      ],
    ]);
    times.push(timeIt(() => engine.evaluate(filters)));
  }
  record("combined: text + range + category", times);
}

const sortColumn = numberIndex >= 0 ? numberIndex : 0;
const bits = engine.evaluateBits(new Map());
const sortTimes: number[] = [];
sortTimes.push(timeIt(() => buildRank(dataset, sortColumn)));
const rank = buildRank(dataset, sortColumn);
sortTimes.push(timeIt(() => orderIds(bits, rank, 1)));
sortTimes.push(timeIt(() => orderIds(bits, rank, -1)));
record("sort: build asc / order asc / order desc", sortTimes);

const columnSummary = [
  `text=${dataset.columns[textIndex]?.name} (${dataset.columns[textIndex]?.type})`,
  numberIndex >= 0
    ? `number=${dataset.columns[numberIndex].name} (${dataset.columns[numberIndex].type})`
    : "number=none",
  categoryIndex >= 0
    ? `category=${dataset.columns[categoryIndex].name} (${dataset.columns[categoryIndex].type})`
    : "category=none",
].join(" · ");

console.log(`# TurboFuzz real-data benchmark — ${label}`);
console.log("");
console.log(`- Rows: ${parsed.rows.length.toLocaleString()} · Columns: ${parsed.headers.length}`);
console.log(`- Ingest: parse ${fmt(parseMs)} ms · build/types/stats ${fmt(buildMs)} ms · rss ${rss.toFixed(0)} MB`);
console.log(`- Warm: normalize ${fmt(normalizedMs)} ms · fuzzy+phonetic index ${fmt(indexBuildMs)} ms`);
console.log(`- Columns: ${columnSummary}`);
console.log(`- Typing target: "${target}"`);
console.log("");
console.log("| interaction | n | p50 ms | p95 ms | max ms |");
console.log("| --- | --- | --- | --- | --- |");
for (const [name, n, s] of table) {
  console.log(`| ${name} | ${n} | ${fmt(s.p50)} | ${fmt(s.p95)} | ${fmt(s.max)} |`);
}

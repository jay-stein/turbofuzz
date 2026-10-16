/**
 * Ingestion and large-file benchmark.
 *
 * Measures parse, column build + stats, time-to-first-preview, filter, sort,
 * transform and export at 100k / 500k / 1.5M rows across four fixture shapes
 * (narrow numeric, wide mixed, high-cardinality strings, messy). Memory is
 * reported as Node RSS — a labelled proxy, not a browser metric.
 *
 * Usage:
 *   npm run bench:ingest
 *   npm run bench:ingest -- --sizes=100000,500000 --shapes=narrow,strings
 *   npm run bench:ingest -- --out=bench/results-ingest.md --json=bench/results-ingest.json
 */
import { applyTransformOps } from "../src/data/transform-ops.js";
import { buildDataset } from "../src/data/build.js";
import type { Dataset } from "../src/data/dataset.js";
import { parseDelimited } from "../src/parse/parse.js";
import { QueryEngine } from "../src/search/query-engine.js";
import { buildRank, orderIds } from "../src/search/order.js";
import { buildCsv, csvEscape } from "../src/worker/csv.js";
import { ingestDataset } from "../src/worker/ingest.js";
import { count, memMB, measure, ms } from "./bench-utils.js";
import { mulberry32, pick, randInt } from "./lib/prng.js";

type ShapeName = "narrow" | "wide" | "strings" | "messy";
const ALL_SHAPES: readonly ShapeName[] = ["narrow", "wide", "strings", "messy"];

interface Fixture {
  text: string;
  headers: string[];
  rows: string[][];
  /** A text-ish column for the contains filter, or -1. */
  stringColumn: number;
  /** A numeric column for sort/transform, or -1. */
  numericColumn: number;
}

interface Result {
  shape: ShapeName;
  rows: number;
  columns: number;
  cells: number;
  parseMs: number;
  ingestMs: number;
  buildMs: number;
  previewMs: number;
  filterMs: number;
  sortMs: number;
  transformMs: number;
  exportRows: number;
  exportMs: number;
  rssAfterIngestMB: number;
  rssAfterBuildMB: number;
}

function argValue(name: string): string | null {
  const hit = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  return hit === undefined ? null : hit.slice(name.length + 3);
}

function csvFromGrid(headers: string[], rows: string[][]): string {
  const lines = [headers.map(csvEscape).join(",")];
  for (const row of rows) lines.push(row.map((value) => csvEscape(value ?? "")).join(","));
  return lines.join("\r\n");
}

const STATUSES = ["Active", "Trial", "Inactive", "Pending"];

function buildFixture(shape: ShapeName, rows: number, seed: number): Fixture {
  const rng = mulberry32(seed);
  const headers: string[] = [];
  const grid: string[][] = [];
  let stringColumn = -1;
  let numericColumn = -1;

  if (shape === "narrow") {
    headers.push("timestamp", "value", "meter_id");
    stringColumn = 2;
    numericColumn = 1;
    let stamp = Date.UTC(2024, 0, 1);
    for (let i = 0; i < rows; i++) {
      stamp += 60_000;
      grid.push([
        new Date(stamp).toISOString(),
        (rng() * 100).toFixed(2),
        `M${String(1_000_000 + (i % 500_000)).padStart(7, "0")}`,
      ]);
    }
  } else if (shape === "wide") {
    for (let c = 0; c < 40; c++) headers.push(`c${String(c).padStart(2, "0")}`);
    numericColumn = 0;
    stringColumn = 1;
    for (let i = 0; i < rows; i++) {
      const row: string[] = new Array(headers.length);
      for (let c = 0; c < headers.length; c++) {
        row[c] =
          c % 3 === 0
            ? (rng() * 10_000).toFixed(2)
            : c % 3 === 1
              ? `name-${randInt(rng, 0, 999)}-${randInt(rng, 0, 99)}`
              : `${STATUSES[randInt(rng, 0, STATUSES.length - 1)]}-${randInt(rng, 0, 4)}`;
      }
      grid.push(row);
    }
  } else if (shape === "strings") {
    headers.push("customer_name", "company", "suburb");
    stringColumn = 0;
    for (let i = 0; i < rows; i++) {
      grid.push([
        `Customer ${randInt(rng, 0, 99_999)}`,
        `${pick(rng, ["Aus", "Sun", "Star", "Blue", "Green", "Metro"])} ${pick(rng, ["Energy", "Power", "Solar", "Retail"])}`,
        pick(rng, ["Malvern", "Footscray", "Richmond", "Carlton", "Brunswick", "Hawthorn"]),
      ]);
    }
  } else {
    headers.push("when", "amount", "status", "notes");
    stringColumn = 3;
    numericColumn = 1;
    for (let i = 0; i < rows; i++) {
      const roll = rng();
      const when =
        roll < 0.9
          ? new Date(Date.UTC(2024, 0, 1) + i * 3_600_000).toISOString()
          : roll < 0.95
            ? "not a date"
            : "2024-13-40";
      grid.push([
        when,
        rng() < 0.1 ? "-999" : rng() < 0.1 ? "" : (rng() * 5_000).toFixed(2),
        rng() < 0.1 ? "TBC" : rng() < 0.1 ? "N/A" : pick(rng, STATUSES),
        rng() < 0.5
          ? `note ${i}: plain text`
          : `note "${i}", with comma and quote`,
        // Every 500th row carries an extra cell to exercise ragged padding.
        ...(i % 500 === 0 ? ["extra"] : []),
      ]);
    }
  }

  return { text: csvFromGrid(headers, grid), headers, rows: grid, stringColumn, numericColumn };
}

function shapeColumnCount(shape: ShapeName): number {
  if (shape === "wide") return 40;
  if (shape === "messy") return 4;
  return 3;
}

function runCase(shape: ShapeName, rows: number, seed: number, maxCells: number): Result | null {
  // Check the budget before materialising the fixture: a wide fixture can be
  // larger than the whole memory limit on its own.
  const plannedCells = rows * shapeColumnCount(shape);
  if (plannedCells > maxCells) {
    console.log(
      `  ${shape} ${count(rows)} rows: skipped (${count(plannedCells)} cells over --max-cells=${count(maxCells)})`,
    );
    return null;
  }
  const fixture = buildFixture(shape, rows, seed);
  const cells = rows * fixture.headers.length;

  const rssBefore = memMB().rssMB;
  const ingestStarted = performance.now();
  const ingested = ingestDataset({
    name: `bench-${shape}`,
    delimiter: "auto",
    hasHeaders: true,
    text: fixture.text,
  });
  const ingestMs = performance.now() - ingestStarted;
  const rssAfterIngestMB = memMB().rssMB;

  const parseStarted = performance.now();
  const parsed = parseDelimited(fixture.text, {
    delimiter: "auto",
    hasHeaders: false,
    normalizeRows: false,
  });
  const parseMs = performance.now() - parseStarted;

  const buildStarted = performance.now();
  const built = buildDataset(`bench-${shape}`, parsed.headers, parsed.rows);
  const buildMs = performance.now() - buildStarted;
  const rssAfterBuildMB = memMB().rssMB;
  void rssBefore;

  // Time to first useful preview: one filtered query plus the first page.
  const dataset: Dataset = built;
  const engine = new QueryEngine(dataset);
  const preview = measure(
    () => {
      const bits = engine.evaluateBits(new Map());
      const ids = orderIds(bits, null, 1);
      void ids.subarray(0, 40);
    },
    { iterations: 3, warmup: 1 },
  );

  const filterKey = fixture.stringColumn >= 0 ? fixture.stringColumn : 0;
  const filter = measure(
    () => {
      engine.evaluate(new Map([[filterKey, { kind: "text" as const, mode: "contains" as const, query: "mal" }]]));
    },
    { iterations: 5, warmup: 1 },
  );

  const sortColumn = fixture.numericColumn >= 0 ? fixture.numericColumn : 0;
  const sort = measure(
    () => {
      const rank = buildRank(dataset, sortColumn);
      orderIds(dataset.nullRowBits, rank, 1);
    },
    { iterations: 3, warmup: 1 },
  );

  const transformOp =
    fixture.numericColumn >= 0
      ? ({ kind: "round" as const, column: fixture.numericColumn, decimals: 2 })
      : ({ kind: "dedupe" as const, keep: "first" as const });
  const transform = measure(
    () => {
      applyTransformOps(dataset.name, dataset.columns, [transformOp]);
    },
    { iterations: 1, warmup: 0 },
  );

  const exportRows = Math.min(dataset.rowCount, 200_000);
  const ids = Uint32Array.from({ length: dataset.rowCount }, (_, index) => index);
  const exportStarted = performance.now();
  buildCsv(dataset, ids, 0, exportRows, true);
  const exportMs = performance.now() - exportStarted;

  void ingested;

  return {
    shape,
    rows: dataset.rowCount,
    columns: dataset.columnCount,
    cells,
    parseMs,
    ingestMs,
    buildMs,
    previewMs: preview.p50,
    filterMs: filter.p50,
    sortMs: sort.p50,
    transformMs: transform.p50,
    exportRows,
    exportMs,
    rssAfterIngestMB,
    rssAfterBuildMB,
  };
}

function formatReport(results: Result[], sizes: number[]): string {
  const lines: string[] = [];
  lines.push("# TurboFuzz ingestion benchmark", "");
  lines.push(`- Date: ${new Date().toISOString()}`);
  lines.push(`- Node: ${process.version}`);
  lines.push(`- Sizes: ${sizes.map((size) => count(size)).join(", ")} rows`);
  lines.push("- Memory: Node RSS (labelled proxy; not a browser metric)");
  lines.push("");
  lines.push(
    "| Shape | Rows | Cols | Cells | parse | ingest (parse+build+stats) | build+stats | preview p50 | filter p50 | sort p50 | transform | export (rows) | RSS after |",
  );
  lines.push("|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|");
  for (const result of results) {
    lines.push(
      `| ${result.shape} | ${count(result.rows)} | ${result.columns} | ${count(result.cells)} | ${ms(result.parseMs)} ms | ${ms(result.ingestMs)} ms | ${ms(result.buildMs)} ms | ${ms(result.previewMs)} ms | ${ms(result.filterMs)} ms | ${ms(result.sortMs)} ms | ${ms(result.transformMs)} ms | ${ms(result.exportMs)} ms (${count(result.exportRows)}) | ${Math.round(result.rssAfterBuildMB)} MB |`,
    );
  }
  lines.push("");
  return lines.join("\n");
}

const sizes = (argValue("sizes") ?? "100000,500000,1500000")
  .split(",")
  .map((value) => Number(value.trim()))
  .filter((value) => Number.isFinite(value) && value > 0);
const shapes = ((argValue("shapes") ?? ALL_SHAPES.join(",")).split(",") as ShapeName[]).filter(
  (shape): shape is ShapeName => (ALL_SHAPES as readonly string[]).includes(shape),
);
const maxCells = Number(argValue("max-cells") ?? 20_000_000);

console.log(`=== ingestion benchmark: ${sizes.map(count).join(", ")} rows ===`);
const results: Result[] = [];
for (const size of sizes) {
  for (const shape of shapes) {
    console.log(`${shape} ${count(size)}:`);
    const result = runCase(shape, size, 42, maxCells);
    if (result === null) continue;
    results.push(result);
    console.log(
      `  parse ${ms(result.parseMs)} ms · ingest ${ms(result.ingestMs)} ms · build+stats ${ms(result.buildMs)} ms · filter p50 ${ms(result.filterMs)} ms · RSS ${Math.round(result.rssAfterBuildMB)} MB`,
    );
  }
}

const report = formatReport(results, sizes);
console.log(report);

const jsonPath = argValue("json");
if (jsonPath !== null) {
  const { writeFileSync } = await import("node:fs");
  writeFileSync(jsonPath, `${JSON.stringify({ savedAt: new Date().toISOString(), sizes, results }, null, 2)}\n`);
  console.log(`wrote ${jsonPath}`);
}
const outPath = argValue("out");
if (outPath !== null) {
  const { writeFileSync } = await import("node:fs");
  writeFileSync(outPath, report);
  console.log(`wrote ${outPath}`);
}

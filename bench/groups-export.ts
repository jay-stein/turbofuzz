import { ColumnData } from "../src/data/column.js";
import { buildDataset } from "../src/data/build.js";
import { buildXlsxWorkbook } from "../src/worker/xlsx-export.js";
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
// Measured 2.8-4.9 s for 100,000 x 30 (about 1 us per cell); 8 s leaves headroom for a slower machine.
const XLSX_BUDGET_MS = 8000;

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

// Typed workbook: 100,000 rows x 30 columns (numbers, dates, datetimes, booleans, ids, text).
{
  const COLS = 30;
  const kinds = ["int", "num", "date", "datetime", "bool", "postcode", "text"] as const;
  const names = Array.from({ length: COLS }, (_, c) => `${kinds[c % kinds.length]}_${c}`);
  const cell = (kind: (typeof kinds)[number], i: number): string => {
    const day = String((i % 28) + 1).padStart(2, "0");
    switch (kind) {
      case "int": return String(i);
      case "num": return `${i}.25`;
      case "date": return `2026-03-${day}`;
      case "datetime": return `2026-03-${day}T13:45:30Z`;
      case "bool": return i % 2 === 0 ? "true" : "false";
      case "postcode": return `0${800 + (i % 90)}`;
      case "text": return `note ${i % 500}`;
    }
  };
  const rows = Array.from({ length: EXPORT_ROWS }, (_, i) => names.map((_n, c) => cell(kinds[c % kinds.length], i)));
  const dataset = buildDataset("bench", names, rows);
  const ids = Uint32Array.from({ length: EXPORT_ROWS }, (_, i) => i);
  const times: number[] = [];
  let bytes = 0;
  for (let i = 0; i < 3; i++) {
    const start = performance.now();
    bytes = (await buildXlsxWorkbook(dataset, ids, 0, EXPORT_ROWS, "bench")).bytes.length;
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  report(`export xlsx, ${EXPORT_ROWS.toLocaleString()} rows x ${COLS} columns`, times[times.length - 1]!, XLSX_BUDGET_MS, `(${(bytes / 1e6).toFixed(1)} MB, best ${ms(times[0]!)} ms)`);
}

if (failed) {
  console.error("Groups/export latency gate failed.");
  process.exitCode = 1;
}

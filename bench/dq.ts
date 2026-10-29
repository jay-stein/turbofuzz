import { ColumnData } from "../src/data/column.js";
import { computeRowsAffected } from "../src/data/dq-rows.js";
import { collectExceptions } from "../src/data/dq-exceptions.js";
import { evaluateRule, type Rule } from "../src/data/rules.js";
import { scansForSensitivity, scoreSensitivity, type ColumnSensitivityInput } from "../src/data/sensitivity.js";
import { embeddedShapes, textProfile } from "../src/data/text-profile.js";
import { measure, ms } from "./bench-utils.js";

// Latency budgets for the Data Quality page's worker work (plan constraints.performance).
// Wide shape: dataset D (71 columns, a few thousand rows) and a tall one (250k rows).
const ROWS = Number(process.argv.find((arg) => arg.startsWith("--rows="))?.split("=")[1] ?? 250_000);
const BUDGET = { firstInsight: 1500, fullProfile71: 3000, extra: 600 };

const cities = ["Sydney", "sydney", "SYDNEY", "Melbourne", "Perth", "Hobart"];
function tall(rows: number): Record<string, string[]> {
  return {
    id: Array.from({ length: rows }, (_, i) => `C${100000 + i}`),
    email: Array.from({ length: rows }, (_, i) => `user${i}@example.com`),
    city: Array.from({ length: rows }, (_, i) => cities[i % cities.length]!),
    age: Array.from({ length: rows }, (_, i) => (i % 500 === 0 ? "999" : String(18 + (i % 60)))),
    joined: Array.from({ length: rows }, (_, i) => (i % 9 === 0 ? `${1 + (i % 27)}/02/2023` : `2023-02-${String(1 + (i % 27)).padStart(2, "0")}`)),
    note: Array.from({ length: rows }, (_, i) => (i % 3 === 0 ? "" : `call ${i % 97}`)),
  };
}

function build(table: Record<string, string[]>): ColumnData[] {
  return Object.entries(table).map(([name, raw]) => ColumnData.create(name, raw));
}

let failed = false;
function gate(label: string, budget: number, fn: () => void, iterations = 3): void {
  const timing = measure(fn, { iterations, warmup: 1 });
  const over = timing.p95 > budget;
  if (over) failed = true;
  console.log(`${over ? "OVER" : "ok  "} ${label}  p95 ${ms(timing.p95)} ms  budget ${budget} ms`);
}

const data = tall(ROWS);
let columns: ColumnData[] = [];
gate(`first insight: load and profile ${ROWS.toLocaleString()} rows x 6 columns`, BUDGET.firstInsight, () => {
  columns = build(data);
}, 2);

gate(`rows affected, ${ROWS.toLocaleString()} rows`, BUDGET.extra, () => {
  computeRowsAffected(columns, ROWS, columns.map(() => null), columns.map(() => null));
});

gate(`exceptions export, ${ROWS.toLocaleString()} rows`, BUDGET.extra * 2, () => {
  collectExceptions(columns, ROWS, { maskColumns: new Set([1]), includeRaw: false, variantSources: columns.map(() => null), checkId: null, optional: new Set() });
});

const rules: Rule[] = [
  { id: "a", type: "notNull", column: "email", severity: "major", allowedFailure: 0 },
  { id: "b", type: "unique", column: "id", severity: "critical", allowedFailure: 0 },
  { id: "c", type: "range", column: "age", severity: "minor", allowedFailure: 0.005, min: 0, max: 120 },
  { id: "d", type: "inList", column: "city", severity: "major", allowedFailure: 0, values: ["Sydney", "Melbourne", "Perth", "Hobart"] },
  { id: "e", type: "regex", column: "email", severity: "major", allowedFailure: 0, pattern: "[^@]+@[^@]+\\.[a-z]+" },
];
gate(`rules evaluation (5 rules), ${ROWS.toLocaleString()} rows`, 300, () => {
  for (const rule of rules) evaluateRule(rule, columns, ROWS);
});

function sensitivityInputs(table: Record<string, string[]>): ColumnSensitivityInput[] {
  return Object.entries(table).map(([name, values], column) => {
    const data = ColumnData.create(name, values);
    const textual = scansForSensitivity(data.type, name);
    const profile = textual ? textProfile(values, data.nullMask, 1, false) : null;
    return {
      column,
      name,
      type: data.type,
      semantic: data.semantic,
      shapes: profile?.shapes ?? null,
      sampled: profile?.rows ?? 0,
      scanned: values.length - data.stats.nulls,
      embedded: profile !== null && profile.avgLength > 40 ? embeddedShapes(values, data.nullMask) : null,
    };
  });
}

// Dataset D: 71 columns, sampled sensitivity pass at the 5,000-value scan cap.
const wide: Record<string, string[]> = {};
for (let c = 0; c < 71; c++) {
  wide[`col${c}`] = Array.from({ length: 5000 }, (_, i) => (c % 5 === 0 ? `v${(i * 7 + c) % 311}@host.com` : String((i * 13 + c) % 997)));
}
gate("full profile + sensitivity pass, 71 columns x 5,000 rows", BUDGET.fullProfile71, () => {
  scoreSensitivity(sensitivityInputs(wide));
}, 2);

if (failed) {
  console.error("Data quality latency gate failed.");
  process.exitCode = 1;
}

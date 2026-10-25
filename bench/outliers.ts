import { ColumnData } from "../src/data/column.js";
import {
  computeOutlierAnalysis,
  type OutlierMethod,
  type OutlierMode,
} from "../src/data/outliers.js";
import { count, measure, ms } from "./bench-utils.js";

const QUICK_BUDGET_MS = 5_000;
const DEEP_BUDGET_MS = 30_000;

interface Case {
  method: OutlierMethod;
  mode: OutlierMode;
  rows: number;
  features: number;
}

const CASES: readonly Case[] = [
  { method: "isolationForest", mode: "quick", rows: 300_000, features: 16 },
  { method: "isolationForest", mode: "deep", rows: 300_000, features: 16 },
  { method: "pca", mode: "quick", rows: 100_000, features: 16 },
  { method: "pca", mode: "deep", rows: 250_000, features: 16 },
  { method: "lof", mode: "quick", rows: 20_000, features: 8 },
  { method: "lof", mode: "deep", rows: 50_000, features: 8 },
];

function buildColumns(rows: number, features: number): ColumnData[] {
  const values: string[][] = Array.from({ length: features }, () => new Array<string>(rows));
  for (let row = 0; row < rows; row++) {
    const cluster = row % 3;
    const base = Math.sin(row * 0.001) * 3 + cluster * 2;
    const outlier = row % 10_007 === 0;
    for (let feature = 0; feature < features; feature++) {
      const correlated = base * (feature % 4 === 0 ? 2 : 0.7);
      const noise = ((row * (feature + 11)) % 19) / 100;
      values[feature]![row] = String(
        outlier ? 90 + feature * 4 + cluster : correlated + noise,
      );
    }
  }
  return values.map((column, index) =>
    ColumnData.create(`metric_${index}`, column, undefined, "dot", {
      type: "number",
      skipSuggestions: true,
    }),
  );
}

let failed = false;
for (const entry of CASES) {
  const budget = entry.mode === "quick" ? QUICK_BUDGET_MS : DEEP_BUDGET_MS;
  const columns = buildColumns(entry.rows, entry.features);
  const ids = Uint32Array.from({ length: entry.rows }, (_, index) => index);
  let flagged = 0;
  const timing = measure(
    () => {
      const result = computeOutlierAnalysis(columns, ids, {
        method: entry.method,
        columns: Array.from({ length: entry.features }, (_, index) => index),
        contamination: 0.01,
        mode: entry.mode,
        seed: 42,
      });
      flagged = result.flagged;
    },
    { iterations: 3, warmup: 1 },
  );
  const over = timing.p95 > budget;
  if (over) failed = true;
  console.log(
    `${over ? "OVER" : "ok  "} outliers ${entry.method} ${entry.mode} ${count(
      entry.rows,
    )}×${entry.features} (${count(flagged)} flagged)  p50 ${ms(timing.p50)} ms  p95 ${ms(
      timing.p95,
    )} ms  budget ${count(budget)} ms`,
  );
}

// The deep route has a hard ceiling, independent of the percentile gate.
if (failed) {
  console.error("Outlier latency gate failed: quick must stay <= 5s and deep <= 30s.");
  process.exitCode = 1;
}

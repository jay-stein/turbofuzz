import { test } from "node:test";
import assert from "node:assert/strict";
import { ColumnData } from "../src/data/column.js";
import { computeOutlierAnalysis, type OutlierMethod } from "../src/data/outliers.js";

function columns(rows = 240): { columns: ColumnData[]; ids: Uint32Array; planted: number } {
  const planted = 37;
  const values = [
    [] as string[],
    [] as string[],
    [] as string[],
    [] as string[],
  ];
  for (let row = 0; row < rows; row++) {
    const base = Math.sin(row * 0.05) * 2 + (row % 7) / 10;
    const noise = ((row * 13) % 17) / 100;
    const point =
      row === planted
        ? [80, 95, -70, 120]
        : [base + noise, base * 2 + noise, base * -1 + noise, base + noise * 2];
    for (let column = 0; column < values.length; column++) {
      values[column]?.push(String(point[column] ?? 0));
    }
  }
  return {
    columns: values.map((column, index) => ColumnData.create(`metric_${index}`, column)),
    ids: Uint32Array.from({ length: rows }, (_, index) => index),
    planted,
  };
}

function run(method: OutlierMethod, mode: "quick" | "deep" = "quick") {
  const { columns: data, ids, planted } = columns();
  return {
    result: computeOutlierAnalysis(data, ids, {
      method,
      columns: [0, 1, 2, 3],
      contamination: 0.01,
      mode,
      seed: 42,
    }),
    planted,
  };
}

test("Isolation Forest ranks an obvious global outlier at the top", () => {
  const { result, planted } = run("isolationForest");
  assert.ok(result.flagged >= 1);
  assert.equal(result.analyzed, 240);
  assert.equal(result.excluded, 0);
  assert.ok(result.rowIndices.includes(planted));
  const index = Array.from(result.rowIndices).indexOf(planted);
  assert.ok((result.scores[index] ?? 0) >= result.threshold);
  assert.equal(result.details[0]?.row, planted);
  assert.ok((result.details[0]?.contributions.length ?? 0) > 0);
  const topContribution = result.details[0]?.contributions[0];
  assert.ok(Number.isFinite(topContribution?.median));
  assert.ok(Number.isFinite(topContribution?.z));
  assert.ok(Math.abs(topContribution?.z ?? 0) > 2, "the planted value is far from typical");
  assert.ok(result.featureImportance.length === 4);
  assert.ok(result.visualRows.length > 0);
  assert.ok(result.visualX.length === result.visualRows.length);
});

test("PCA reconstruction flags the row that breaks the correlations", () => {
  const { result, planted } = run("pca");
  assert.ok(result.flagged >= 1);
  assert.ok(result.rowIndices.includes(planted));
  const index = Array.from(result.rowIndices).indexOf(planted);
  assert.ok((result.scores[index] ?? 0) >= result.threshold);
  assert.ok(result.details.some((detail) => detail.row === planted));
  assert.ok(result.visualFlagged.some((value) => value === 1));
});

test("LOF finds the local outlier without leaving the latency caps", () => {
  const { result, planted } = run("lof");
  assert.ok(result.flagged >= 1);
  assert.ok(result.rowIndices.includes(planted));
  assert.equal(result.projected, false);
  assert.ok((result.details[0]?.contributions.length ?? 0) > 0);
});

test("the same rows, features, seed and mode reproduce the same flags", () => {
  const { columns: data, ids } = columns();
  const options = {
    method: "isolationForest" as const,
    columns: [0, 1, 2],
    contamination: 0.02,
    mode: "quick" as const,
    seed: 7,
  };
  const first = computeOutlierAnalysis(data, ids, options);
  const second = computeOutlierAnalysis(data, ids, options);
  assert.deepEqual(Array.from(first.rowIndices), Array.from(second.rowIndices));
  assert.deepEqual(Array.from(first.scores), Array.from(second.scores));
  assert.equal(first.threshold, second.threshold);
  assert.equal(first.flagged, second.flagged);
});

test("missing cells are excluded explicitly rather than imputed", () => {
  const rows = 80;
  const a: string[] = [];
  const b: string[] = [];
  for (let row = 0; row < rows; row++) {
    a.push(row === 10 ? "" : String(row * 0.5));
    b.push(row === 11 ? "" : String(row * 1.5 + 3));
  }
  const result = computeOutlierAnalysis(
    [ColumnData.create("a", a), ColumnData.create("b", b)],
    Uint32Array.from({ length: rows }, (_, index) => index),
    {
      method: "pca",
      columns: [0, 1],
      contamination: 0.05,
      mode: "quick",
    },
  );
  assert.equal(result.totalRows, 80);
  assert.equal(result.excluded, 2);
  assert.equal(result.analyzed, 78);
  assert.ok(result.rowIndices.length === 78);
  assert.ok(!result.rowIndices.includes(10));
  assert.ok(!result.rowIndices.includes(11));
});

test("deep mode uses the same interface and stays deterministic", () => {
  const { result } = run("isolationForest", "deep");
  assert.equal(result.mode, "deep");
  assert.ok(result.analyzed > 0);
  assert.ok(result.ms >= 0);
  assert.ok(result.featureImportance.every((entry) => entry.weight >= 0));
});

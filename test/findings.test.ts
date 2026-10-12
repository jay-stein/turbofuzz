import { test } from "node:test";
import assert from "node:assert/strict";
import {
  anomalyFindings,
  qualityFindings,
  relationshipFindings,
} from "../src/data/findings.js";
import type { DatasetStats } from "../src/data/stats.js";
import type { ColumnMeta } from "../src/worker/protocol.js";

function meta(overrides: Partial<ColumnMeta> = {}): ColumnMeta {
  return {
    name: "col",
    type: "string",
    numberLocale: "dot",
    dateOrder: "dmy",
    stats: {
      nulls: 0,
      distinct: 5,
      samples: [],
      topValues: [],
      min: null,
      max: null,
      mean: null,
      stddev: null,
      minLength: null,
      maxLength: null,
      avgLength: null,
    },
    anomalyCounts: { values: 0, lengths: 0 },
    similarGroups: 0,
    categories: null,
    histogram: null,
    valueFence: null,
    lengthFence: null,
    nullPolicy: { extra: [], keep: [] },
    nullTokens: [],
    suggestions: [],
    ...overrides,
  };
}

function stats(overrides: Partial<DatasetStats> = {}): DatasetStats {
  return {
    duplicateRows: 0,
    duplicateGroups: 0,
    rowsInDuplicateGroups: 0,
    emptyRows: 0,
    rowsWithNulls: 0,
    totalNullCells: 0,
    totalCells: 1000,
    valueAnomalyRows: 0,
    lengthAnomalyRows: 0,
    computeMs: 1,
    ...overrides,
  };
}

test("quality findings cover types, placeholders, missingness and constraints", () => {
  const columns = [
    meta({
      name: "Score",
      type: "integer",
      suggestions: [{ kind: "typeConflict", count: 339, sampled: 2000, example: "high", columnType: "integer" }],
    }),
    meta({
      name: "birth year",
      type: "integer",
      nullTokens: [{ label: "\\N", count: 6717 }],
      stats: { ...meta().stats, nulls: 6717 },
    }),
    meta({
      name: "amount",
      type: "number",
      stats: { ...meta().stats, min: -5, max: 100 },
    }),
    meta({ name: "city", type: "category", similarGroups: 3 }),
  ];
  const findings = qualityFindings(columns, stats({ duplicateGroups: 2, duplicateRows: 12 }));
  const ids = findings.map((finding) => finding.id);
  assert.ok(ids.includes("schema.0"), "type conflict surfaces");
  assert.ok(ids.includes("placeholders.1"));
  assert.ok(ids.includes("negative.2"), "negative amount is a constraint finding");
  assert.ok(ids.includes("categories.3"));
  assert.ok(ids.includes("duplicates"));
  const schema = findings.find((finding) => finding.id === "schema.0");
  assert.equal(schema?.severity, "fix");
  assert.equal(schema?.action?.kind, "suggestion");
  assert.match(schema?.title ?? "", /339 cells do not parse/);
});

test("relationship findings rank pairs by effect size and word them carefully", () => {
  const labels = ["orders", "revenue", "distance"];
  const values = Float64Array.from([
    1, 0.71, 0.18,
    0.71, 1, 0.05,
    0.18, 0.05, 1,
  ]);
  const counts = Uint32Array.from([100, 100, 100, 100, 100, 100, 100, 100, 100]);
  const findings = relationshipFindings(labels, [0, 1, 2], values, counts);
  assert.equal(findings.length, 1, "only the strong pair survives the 0.5 threshold");
  assert.match(findings[0].title, /orders.*associated with.*revenue|revenue.*associated with.*orders/);
  assert.match(findings[0].title, /ρ = 0.71/);
  assert.match(findings[0].title, /associated with/);
  assert.doesNotMatch(findings[0].title, /causes/);
  // A near-perfect pair is a redundancy review instead.
  const redundant = relationshipFindings(
    ["a", "b"],
    [0, 1],
    Float64Array.from([1, 0.99, 0.99, 1]),
    Uint32Array.from([50, 50, 50, 50]),
  );
  assert.equal(redundant[0].severity, "review");
  assert.match(redundant[0].title, /near-duplicate information/);
});

test("anomaly findings carry the method and a filter action", () => {
  const columns = [
    meta({
      name: "tripduration",
      anomalyCounts: { values: 204, lengths: 0 },
      valueFence: { lo: 60, hi: 5400, center: 544, method: "log", log: true },
    }),
  ];
  const findings = anomalyFindings(columns);
  assert.equal(findings.length, 1);
  assert.match(findings[0].title, /204 unusually large or small values/);
  assert.ok(findings[0].evidence.some((entry) => entry.metric === "method" && entry.value.includes("MAD")));
  assert.deepEqual(findings[0].action, {
    kind: "filterSpecial",
    column: 0,
    special: "valueAnomalies",
  });
});

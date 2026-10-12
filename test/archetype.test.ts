import { test } from "node:test";
import assert from "node:assert/strict";
import { detectArchetypes } from "../src/data/archetype.js";
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
    totalCells: 10_000,
    valueAnomalyRows: 0,
    lengthAnomalyRows: 0,
    computeMs: 1,
    ...overrides,
  };
}

test("dense timestamps with ids and categories read as an event log", () => {
  const columns = [
    meta({ name: "starttime", type: "date", stats: { ...meta().stats, distinct: 1800 } }),
    meta({ name: "endtime", type: "date", stats: { ...meta().stats, distinct: 1800 } }),
    meta({ name: "start station id", type: "integer", stats: { ...meta().stats, distinct: 329 } }),
    meta({ name: "usertype", type: "category", stats: { ...meta().stats, distinct: 2 } }),
    meta({ name: "tripduration", type: "number", stats: { ...meta().stats, distinct: 20_000 } }),
  ];
  const top = detectArchetypes(columns, stats(), 2000)[0];
  assert.equal(top.id, "eventLog");
  assert.ok(top.confidence >= 0.5);
  assert.ok(top.evidence.some((entry) => entry.includes("distinct timestamps")));
});

test("an amount column with a key and date reads as orders", () => {
  const columns = [
    meta({ name: "order id", type: "identifier", stats: { ...meta().stats, distinct: 5000 } }),
    meta({ name: "order date", type: "date", stats: { ...meta().stats, distinct: 200 } }),
    meta({ name: "customer name", type: "category", stats: { ...meta().stats, distinct: 300 } }),
    meta({ name: "amount", type: "number", stats: { ...meta().stats, distinct: 900 } }),
    meta({ name: "quantity", type: "integer", stats: { ...meta().stats, distinct: 40 } }),
  ];
  const guesses = detectArchetypes(columns, stats(), 5000);
  const orders = guesses.find((guess) => guess.id === "orders");
  assert.ok(orders !== undefined);
  assert.equal(guesses[0].id, "orders");
  assert.ok(orders.evidence.some((entry) => entry.includes("amount/price")));
});

test("many low-cardinality columns read as a survey", () => {
  const columns = [
    meta({ name: "respondent id", type: "identifier", stats: { ...meta().stats, distinct: 800 } }),
    ...Array.from({ length: 8 }, (_, index) =>
      meta({
        name: `q${index + 1}`,
        type: "category",
        stats: { ...meta().stats, distinct: 5, nulls: 2 },
      }),
    ),
  ];
  const top = detectArchetypes(columns, stats({ totalNullCells: 40 }), 800)[0];
  assert.equal(top.id, "survey");
  assert.ok(top.evidence.some((entry) => entry.includes("low-cardinality")));
});

test("mixed types and nulls surface the messy archetype", () => {
  const columns = [
    meta({
      name: "score",
      type: "integer",
      suggestions: [{ kind: "typeConflict", count: 40, sampled: 100, example: "high", columnType: "integer" }],
    }),
    meta({ name: "notes", type: "string", stats: { ...meta().stats, nulls: 30 } }),
  ];
  const guesses = detectArchetypes(columns, stats({ totalNullCells: 30 }), 1000);
  assert.equal(guesses[0].id, "messy");
  assert.ok(guesses[0].evidence.some((entry) => entry.includes("mixed types")));
});

test("a flat numeric block with a target reads as an ML dataset", () => {
  const columns = [
    ...Array.from({ length: 6 }, (_, index) =>
      meta({ name: `feature_${index}`, type: "number", stats: { ...meta().stats, distinct: 900 } }),
    ),
    meta({ name: "target", type: "category", stats: { ...meta().stats, distinct: 2 } }),
  ];
  const top = detectArchetypes(columns, stats(), 1000)[0];
  assert.equal(top.id, "ml");
});

test("weak signals fall back to General table", () => {
  const columns = [meta({ name: "blob", type: "string", stats: { ...meta().stats, distinct: 900 } })];
  const guesses = detectArchetypes(columns, stats(), 1000);
  assert.equal(guesses[0].id, "general");
  assert.equal(guesses[0].label, "General table");
});

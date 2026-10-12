import { test } from "node:test";
import assert from "node:assert/strict";
import { commandSuggestions, parseCommand } from "../src/ui/command-bar.js";
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

const columns: ColumnMeta[] = [
  meta({ name: "amount", type: "number" }),
  meta({ name: "region", type: "category" }),
  meta({ name: "start station id", type: "integer" }),
  meta({ name: "notes", type: "string" }),
];

test("column verbs parse into clean operations", () => {
  const upper = parseCommand("upper amount", columns);
  assert.equal(upper.kind, "clean");
  if (upper.kind === "clean") {
    assert.equal(upper.column, 0);
    assert.deepEqual(upper.op, { kind: "case", style: "upper" });
  }
  const trim = parseCommand("trim notes", columns);
  assert.equal(trim.kind, "clean");
  const date = parseCommand("convert date notes", columns);
  assert.equal(date.kind, "clean");
  const number = parseCommand("number amount", columns);
  assert.equal(number.kind, "clean");
});

test("multi-word column names resolve by fuzzy match", () => {
  const command = parseCommand("upper start station id", columns);
  assert.equal(command.kind, "clean");
  if (command.kind === "clean") assert.equal(command.column, 2);
});

test("round, fill and split parse into transform steps", () => {
  const round = parseCommand("round amount 2", columns);
  assert.equal(round.kind, "transform");
  if (round.kind === "transform") {
    assert.deepEqual(round.ops, [{ kind: "round", column: 0, decimals: 2 }]);
  }
  const fill = parseCommand("fill amount median", columns);
  assert.equal(fill.kind, "transform");
  if (fill.kind === "transform") {
    assert.deepEqual(fill.ops[0], {
      kind: "impute",
      column: 0,
      strategy: { kind: "median" },
      groupColumn: null,
    });
  }
  const split = parseCommand("split notes on ,", columns);
  assert.equal(split.kind, "transform");
  if (split.kind === "transform") {
    const op = split.ops[0];
    assert.equal(op?.kind, "splitColumn");
    if (op !== undefined && op.kind === "splitColumn") assert.equal(op.pattern, ",");
  }
});

test("group builds a group-by aggregate over parsed columns", () => {
  const command = parseCommand("group region sum amount", columns);
  assert.equal(command.kind, "transform");
  if (command.kind === "transform") {
    assert.deepEqual(command.ops, [
      { kind: "groupBy", dimension: 1, measure: 0, aggregate: "sum" },
    ]);
  }
  const count = parseCommand("group region count", columns);
  assert.equal(count.kind, "transform");
  if (count.kind === "transform") {
    assert.deepEqual(count.ops, [
      { kind: "groupBy", dimension: 1, measure: null, aggregate: "count" },
    ]);
  }
});

test("dedupe, drop and panel commands map to their actions", () => {
  const dedupe = parseCommand("dedupe last", columns);
  assert.equal(dedupe.kind, "dedupe");
  if (dedupe.kind === "dedupe") assert.equal(dedupe.keep, "last");
  const drop = parseCommand("drop notes", columns);
  assert.equal(drop.kind, "transform");
  if (drop.kind === "transform") assert.deepEqual(drop.ops, [{ kind: "drop", column: 3 }]);
  assert.equal(parseCommand("clean", columns).kind, "openClean");
  assert.equal(parseCommand("views", columns).kind, "views");
  assert.equal(parseCommand("export", columns).kind, "export");
});

test("unknown verbs and missing columns produce friendly errors", () => {
  const unknown = parseCommand("frobnicate amount", columns);
  assert.equal(unknown.kind, "error");
  const missing = parseCommand("upper", columns);
  assert.equal(missing.kind, "error");
  if (missing.kind === "error") assert.match(missing.message, /Which column/);
});

test("suggestions rank prefix matches first", () => {
  const suggestions = commandSuggestions("upp", columns);
  assert.equal(suggestions[0].usage, "upper amount");
  assert.match(suggestions[0].hint, /UPPERCASE/);
  const empty = commandSuggestions("", columns);
  assert.ok(empty.length >= 8);
});

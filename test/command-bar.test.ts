import { test } from "node:test";
import assert from "node:assert/strict";
import { commandState, commandSuggestions, parseCommand } from "../src/ui/command-bar.js";
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

test("datetime converts a column keeping the clock", () => {
  const command = parseCommand("datetime notes", columns);
  assert.equal(command.kind, "clean");
  if (command.kind === "clean") {
    assert.equal(command.column, 3);
    assert.deepEqual(command.op, { kind: "toDateTime", order: "dmy" });
    assert.match(command.label, /date & time/);
  }
  const alias = parseCommand("convert datetime notes", columns);
  assert.equal(alias.kind, "clean");
  if (alias.kind === "clean") {
    assert.equal(alias.op.kind, "toDateTime");
  }
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

test("timeseries prepares the date column and the measure in one command", () => {
  const withDates = [
    meta({ name: "when", type: "string", suggestions: [{ kind: "date", ratio: 0.9, sampled: 100 }] }),
    meta({ name: "kwh", type: "number" }),
  ];
  const command = parseCommand("timeseries", withDates);
  assert.equal(command.kind, "prepareTimeSeries");
  if (command.kind === "prepareTimeSeries") {
    assert.equal(command.dateColumn, 0);
    assert.equal(command.valueColumn, 1);
    assert.equal(command.dateOrder, "dmy");
    assert.equal(command.valueLocale, "dot");
    assert.match(command.label, /when × kwh/);
  }

  const noDates = parseCommand("time series", [meta({ name: "kwh", type: "number" })]);
  assert.equal(noDates.kind, "error");
  if (noDates.kind === "error") assert.match(noDates.message, /No date-like/);

  const noMeasure = parseCommand(
    "prepare time series",
    [meta({ name: "when", type: "date" })],
  );
  assert.equal(noMeasure.kind, "error");
  if (noMeasure.kind === "error") assert.match(noMeasure.message, /No numeric measure/);
});

test("suggestions rank prefix matches first", () => {
  const suggestions = commandSuggestions("upp", columns);
  // The example picks a column the verb applies to (a text column), not the
  // first column in the file.
  assert.equal(suggestions[0].usage, "upper region");
  assert.match(suggestions[0].hint, /UPPERCASE/);
  const empty = commandSuggestions("", columns);
  assert.ok(empty.length >= 8);
});

test("column completions finish any column name for a verb", () => {
  const round = commandSuggestions("round a", columns);
  assert.equal(round[0]?.usage, "round amount");
  assert.equal(round[0]?.command.kind, "transform");

  const upper = commandSuggestions("upper n", columns);
  assert.equal(upper[0]?.usage, "upper notes", "prefix matches outrank contains");

  const datetime = commandSuggestions("convert datetime not", columns);
  assert.equal(datetime[0]?.usage, "datetime notes");
  assert.equal(datetime[0]?.command.kind, "clean");

  const drop = commandSuggestions("drop", columns);
  assert.ok(drop.length > 0);
});

test("header casing and all-column cleans parse", () => {
  const snake = parseCommand("snakecase", columns);
  assert.equal(snake.kind, "headerCase");
  if (snake.kind === "headerCase") {
    assert.equal(snake.style, "snake");
    assert.match(snake.label, /Snake-cased/);
  }
  const camel = parseCommand("camel case", columns);
  assert.equal(camel.kind, "headerCase");
  if (camel.kind === "headerCase") assert.equal(camel.style, "camel");

  const upperAll = parseCommand("upper all", columns);
  assert.equal(upperAll.kind, "cleanAll");
  if (upperAll.kind === "cleanAll") {
    assert.deepEqual(upperAll.op, { kind: "case", style: "upper" });
    assert.match(upperAll.label, /every column/);
  }
  const trimAll = parseCommand("trim all", columns);
  assert.equal(trimAll.kind, "cleanAll");
  if (trimAll.kind === "cleanAll") assert.deepEqual(trimAll.op, { kind: "trim" });

  const completion = commandSuggestions("upper all", columns);
  assert.equal(completion[0]?.usage, "upper all");
  assert.match(completion[0]?.hint ?? "", /every column/);

  const snakeSuggestion = commandSuggestions("snake", columns);
  assert.equal(snakeSuggestion[0]?.usage, "snakecase");
});

test("keydup parses comma-separated key columns", () => {
  const command = parseCommand("keydup amount, region", columns);
  assert.equal(command.kind, "keyDuplicates");
  if (command.kind === "keyDuplicates") {
    assert.deepEqual(command.columns, [0, 1]);
    assert.match(command.label, /amount, region/);
  }
  const single = parseCommand("duplicate key notes", columns);
  assert.equal(single.kind, "keyDuplicates");
  const bad = parseCommand("keydup nope, region", columns);
  assert.equal(bad.kind, "error");
});

test("palette input state tracks verb and full-command recognition", () => {
  assert.equal(commandState("", columns), "empty");
  assert.equal(commandState("frobnicate", columns), "empty");
  assert.equal(commandState("round", columns), "verb");
  assert.equal(commandState("round amount", columns), "ready");
  assert.equal(commandState("trim notes", columns), "ready");
  assert.equal(commandState("convert datetime notes", columns), "ready");
});

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
  const constant = parseCommand("fill amount 0", columns);
  assert.equal(constant.kind, "transform");
  if (constant.kind === "transform") {
    assert.deepEqual(constant.ops[0], {
      kind: "impute",
      column: 0,
      strategy: { kind: "constant", value: "0" },
      groupColumn: null,
    });
  }
  const namedConstant = parseCommand("fill amount constant N/A", columns);
  assert.equal(namedConstant.kind, "transform");
  if (namedConstant.kind === "transform") {
    assert.deepEqual(namedConstant.ops[0], {
      kind: "impute",
      column: 0,
      strategy: { kind: "constant", value: "N/A" },
      groupColumn: null,
    });
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

test("melt, combine and KNN cover the missing transform operations", () => {
  const melt = parseCommand("melt keep region", columns);
  assert.equal(melt.kind, "transform");
  if (melt.kind === "transform") {
    assert.deepEqual(melt.ops, [
      { kind: "melt", idVars: [1], valueVars: [], varName: "variable", valueName: "value" },
    ]);
  }
  const meltAll = parseCommand("melt", columns);
  assert.equal(meltAll.kind, "transform");
  if (meltAll.kind === "transform") {
    const op = meltAll.ops[0];
    assert.equal(op?.kind, "melt");
    if (op?.kind === "melt") assert.deepEqual(op.idVars, []);
  }

  const dateParts = [
    meta({ name: "Year", type: "integer" }),
    meta({ name: "Month", type: "integer" }),
    meta({ name: "Day", type: "integer" }),
  ];
  const combine = parseCommand("combine dates", dateParts);
  assert.equal(combine.kind, "transform");
  if (combine.kind === "transform") {
    const op = combine.ops[0];
    assert.equal(op?.kind, "combineDate");
    if (op?.kind === "combineDate") {
      assert.equal(op.output, "date");
      assert.equal(op.parts.length, 3);
    }
  }

  const knn = parseCommand("knn amount 3", columns);
  assert.equal(knn.kind, "transform");
  if (knn.kind === "transform") {
    assert.deepEqual(knn.ops, [{ kind: "knn", fill: [0], predictors: [2], k: 3 }]);
  }
});

test("other missing clean, transform and worksheet commands parse", () => {
  const regex = parseCommand("splitregex notes on \\d+", columns);
  assert.equal(regex.kind, "transform");
  if (regex.kind === "transform") {
    const op = regex.ops[0];
    assert.equal(op?.kind, "splitColumn");
    if (op?.kind === "splitColumn") assert.equal(op.regex, true);
  }

  const repair = parseCommand("repair amount", columns);
  assert.equal(repair.kind, "clean");
  if (repair.kind === "clean") assert.equal(repair.op.kind, "repairDecimal");

  const replace = parseCommand('replace notes "N/A" with "Unknown"', columns);
  assert.equal(replace.kind, "clean");
  if (replace.kind === "clean") {
    assert.deepEqual(replace.op, {
      kind: "replace",
      find: "N/A",
      replacement: "Unknown",
      ignoreCase: false,
    });
  }

  assert.equal(parseCommand("type amount number", columns).kind, "type");
  assert.equal(parseCommand("rename notes memo", columns).kind, "rename");
  assert.equal(parseCommand("merge region", columns).kind, "merge");
  assert.equal(parseCommand("winsorize amount 1", columns).kind, "transform");
  assert.equal(parseCommand("flag amount", columns).kind, "transform");
});

test("sort, filter, view and output commands parse", () => {
  const sort = parseCommand("sort amount desc", columns);
  assert.equal(sort.kind, "sort");
  if (sort.kind === "sort") {
    assert.equal(sort.column, 0);
    assert.equal(sort.dir, -1);
  }
  assert.equal(parseCommand("sort none", columns).kind, "sort");

  const filter = parseCommand("filter region exact active", columns);
  assert.equal(filter.kind, "filter");
  if (filter.kind === "filter") {
    assert.deepEqual(filter.filter, { kind: "text", mode: "exact", query: "active" });
  }
  const range = parseCommand("filter amount 10..20", columns);
  assert.equal(range.kind, "filter");
  if (range.kind === "filter") {
    assert.deepEqual(range.filter, { kind: "range", min: 10, max: 20 });
  }
  assert.equal(parseCommand("clear filters", columns).kind, "clearFilters");

  for (const view of ["table", "overview", "outliers", "relationships"] as const) {
    const command = parseCommand(view, columns);
    assert.equal(command.kind, "openView");
    if (command.kind === "openView") assert.equal(command.view, view);
  }
  const chart = parseCommand("chart region", columns);
  assert.equal(chart.kind, "chart");
  if (chart.kind === "chart") assert.equal(chart.column, 1);
  assert.equal(parseCommand("stats", columns).kind, "stats");
  assert.equal(parseCommand("recipe", columns).kind, "recipe");
  assert.equal(parseCommand("help", columns).kind, "help");
  assert.equal(parseCommand("shuffle", columns).kind, "shuffle");
  assert.equal(parseCommand("copy", columns).kind, "copy");
  assert.equal(parseCommand("tiles", columns).kind, "tiles");
  const withEmpty = [
    ...columns,
    meta({ name: "blank", stats: { ...meta().stats, distinct: 0, nulls: 3 } }),
  ];
  const dropEmpty = parseCommand("dropempty", withEmpty);
  assert.equal(dropEmpty.kind, "transform");
  if (dropEmpty.kind === "transform") {
    assert.deepEqual(dropEmpty.ops, [{ kind: "drop", column: 4 }]);
  }
  const header = parseCommand("headercase snake", columns);
  assert.equal(header.kind, "headerCase");
  if (header.kind === "headerCase") assert.equal(header.style, "snake");
  const theme = parseCommand("theme dark", columns);
  assert.equal(theme.kind, "theme");
  if (theme.kind === "theme") assert.equal(theme.preference, "dark");
});

test("suggestions expose the new commands", () => {
  const melt = commandSuggestions("mel", columns);
  assert.equal(melt[0]?.usage, "melt keep amount");
  assert.equal(melt[0]?.command.kind, "transform");
  const all = commandSuggestions("", columns, 50);
  assert.ok(all.some((entry) => entry.usage.startsWith("melt")));
  assert.ok(all.some((entry) => entry.usage === "combine dates"));
});

test("palette input state tracks verb and full-command recognition", () => {
  assert.equal(commandState("", columns), "empty");
  assert.equal(commandState("frobnicate", columns), "empty");
  assert.equal(commandState("round", columns), "verb");
  assert.equal(commandState("round amount", columns), "ready");
  assert.equal(commandState("trim notes", columns), "ready");
  assert.equal(commandState("convert datetime notes", columns), "ready");
});

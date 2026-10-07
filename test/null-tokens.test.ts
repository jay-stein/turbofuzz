import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDataset } from "../src/data/build.js";
import { ColumnData } from "../src/data/column.js";
import {
  createNullPolicy,
  isNullToken,
  isNullWithPolicy,
  isNullWithWire,
} from "../src/parse/null-tokens.js";

const NULLISH = [
  "",
  " ",
  "\u00a0",
  "\u200b",
  "\ufeff",
  "NULL",
  "null",
  "Null",
  "N/A",
  "n/a",
  "N.A.",
  "n.a",
  "na",
  "NA",
  "N / A",
  "#N/A",
  "<NA>",
  "nil",
  "None",
  "none",
  "NaN",
  "nan",
  "undefined",
  "Undefined",
  "missing",
  "Unknown",
  "unknown",
  "TBD",
  "tba",
  "unspecified",
  "not available",
  "Not Applicable",
  "not provided",
  "not specified",
  "no data",
  "no value",
  "no response",
  "(null)",
  "[null]",
  "<null>",
  "(empty)",
  "blank",
  "null value",
  "none supplied",
  "\\N",
  "-",
  "--",
  "---",
  "—",
  "–",
  "?",
  "??",
  "...",
  "…",
  "####",
  "#VALUE!",
  "#DIV/0!",
  "#REF!",
  "#NAME?",
  "#NUM!",
  " null ",
  "NULL\n",
  "\u00a0N/A\u00a0",
];

const REAL_VALUES = [
  "no",
  "No",
  "NO",
  "N",
  "yes",
  "0",
  "0.0",
  "-1",
  "-999",
  "1e5",
  "Namibia",
  "NAB",
  "Nat",
  "Nate",
  "nullify",
  "nullable",
  "Nonexistent",
  "Ann",
  "unknown value",
  "N/A pending",
  "pending",
  "é",
  "😀",
  "München",
  "5 Braemor Drive",
];

test("recognises common null markers", () => {
  for (const value of NULLISH) {
    assert.equal(isNullToken(value), true, `expected null: ${JSON.stringify(value)}`);
  }
});

test("does not misclassify real values", () => {
  for (const value of REAL_VALUES) {
    assert.equal(isNullToken(value), false, `expected real: ${JSON.stringify(value)}`);
  }
});

test("null variants are excluded from inference and counted as empty", () => {
  const dataset = buildDataset("t", ["n"], [["1"], ["2"], ["N/A"], ["NULL"], ["-"], ["?"]]);
  assert.equal(dataset.columns[0].type, "integer");
  assert.equal(dataset.columns[0].stats.nulls, 4);
  assert.equal(dataset.columns[0].numbers()[0], 1);
  assert.ok(Number.isNaN(dataset.columns[0].numbers()[2]));
});

test("null policy can add custom tokens and un-null real values", () => {
  const policy = createNullPolicy(["-999"], ["NULL"]);
  assert.equal(isNullWithPolicy("N/A", policy), true);
  assert.equal(isNullWithPolicy("-999", policy), true);
  assert.equal(isNullWithPolicy("NULL", policy), false);
  assert.equal(isNullWithPolicy("Sydney", policy), false);
});

test("isNullWithWire mirrors the set-based policy", () => {
  assert.equal(isNullWithWire("NULL", [], ["NULL"]), false);
  assert.equal(isNullWithWire("-999", ["-999"], []), true);
  assert.equal(isNullWithWire("N/A", [], []), true);
});

test("a column policy changes null counts, categories and numeric stats", () => {
  const policy = createNullPolicy(["-999"], ["NULL"]);
  const column = ColumnData.create("town", ["NULL", "Sydney", "N/A", "-999"], policy);
  assert.equal(column.stats.nulls, 2); // N/A and -999
  assert.deepEqual(
    column.nullTokens.map((token) => token.label).sort(),
    ["-999", "N/A"],
  );
  assert.ok(column.categories().labels.includes("NULL"));
  assert.ok(Number.isNaN(column.numbers()[3])); // custom null excluded from stats
});

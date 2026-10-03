import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDataset } from "../src/data/build.js";
import { isNullToken } from "../src/parse/null-tokens.js";

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

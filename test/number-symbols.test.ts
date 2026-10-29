import { test } from "node:test";
import assert from "node:assert/strict";
import { summariseNumberSymbols } from "../src/data/number-symbols.js";

const none = (): boolean => false;

test("plain numbers only, or symbols only, are not mixed", () => {
  assert.equal(summariseNumberSymbols(["1", "2.5", "300"], none, "dot"), null);
  assert.equal(summariseNumberSymbols(["$1", "$2.50"], none, "dot"), null);
});

test("currency symbols on some values are counted exactly", () => {
  const summary = summariseNumberSymbols(["100", "$1,200", "150.5", "$99", "40"], none, "dot");
  assert.ok(summary !== null);
  assert.equal(summary.withSymbol, 2);
  assert.equal(summary.plain, 3);
  assert.equal(summary.minority, 2);
  assert.equal(summary.example, "$1,200");
});

test("natural thousands grouping is not a second style; grouping beside a plain 4-digit value is", () => {
  assert.equal(summariseNumberSymbols(["1,234", "5", "6"], none, "dot"), null, "1,234 beside 5 is ordinary formatting");
  assert.equal(summariseNumberSymbols(["1,234", "5000", "6"], none, "dot")?.withSymbol, 1);
  assert.equal(summariseNumberSymbols(["1.234", "5", "6"], none, "dot"), null, "1.234 is a decimal in dot locale");
  assert.equal(summariseNumberSymbols(["1.234", "5000", "6"], none, "comma")?.withSymbol, 1);
});

test("placeholders are ignored", () => {
  const summary = summariseNumberSymbols(["N/A", "$5", "6"], (v) => v === "N/A", "dot");
  assert.equal(summary?.total, 2);
});

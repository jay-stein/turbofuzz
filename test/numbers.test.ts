import { test } from "node:test";
import assert from "node:assert/strict";
import { parseNumber } from "../src/parse/numbers.js";

test("dot locale treats commas as thousands separators", () => {
  assert.equal(parseNumber("1,234.56"), 1234.56);
  assert.equal(parseNumber("$3,655.10"), 3655.1);
  // A comma that does not group thousands is never guessed at (owner decision 2026-11-13).
  assert.ok(Number.isNaN(parseNumber("198,72")));
  assert.ok(Number.isNaN(parseNumber("-55348,13")));
  assert.ok(Number.isNaN(parseNumber("12,34,567")));
});

test("comma locale treats dots as thousands separators", () => {
  assert.equal(parseNumber("198,72", "comma"), 198.72);
  assert.equal(parseNumber("0,5", "comma"), 0.5);
  assert.equal(parseNumber("1.234,56", "comma"), 1234.56);
  assert.equal(parseNumber("1.234", "comma"), 1234);
  assert.equal(parseNumber("1.234.567,89", "comma"), 1234567.89);
});

test("currency, percent and accounting forms follow the locale", () => {
  assert.equal(parseNumber("€1.234,50", "comma"), 1234.5);
  assert.equal(parseNumber("49 %", "comma"), 49);
  assert.equal(parseNumber("(1.234,50)", "comma"), -1234.5);
  assert.equal(parseNumber("42", "comma"), 42);
  assert.ok(Number.isNaN(parseNumber("N/A", "comma")));
  assert.ok(Number.isNaN(parseNumber("", "comma")));
});

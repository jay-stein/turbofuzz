import { test } from "node:test";
import assert from "node:assert/strict";
import { formatBound, parseBound } from "../src/ui/range-prompt.js";

test("parseBound accepts numbers, blanks and thousands separators, and rejects the rest", () => {
  assert.equal(parseBound("12.5"), 12.5);
  assert.equal(parseBound(" -3 "), -3);
  assert.equal(parseBound("1,250"), 1250);
  assert.equal(parseBound(""), null);
  assert.equal(parseBound("   "), null);
  assert.equal(parseBound("abc"), "invalid");
  assert.equal(parseBound("1e400"), "invalid");
});

test("formatBound keeps ordinary values readable", () => {
  assert.equal(formatBound(1234.5), "1,234.5");
  assert.equal(formatBound(0.000123456789), "0.000123");
  assert.equal(formatBound(Number.NaN), "—");
});

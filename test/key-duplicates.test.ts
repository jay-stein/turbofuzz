import { test } from "node:test";
import assert from "node:assert/strict";
import { ColumnData } from "../src/data/column.js";
import { computeKeyDuplicates } from "../src/data/key-duplicates.js";
import { EMPTY_NULL_POLICY } from "../src/parse/null-tokens.js";

function column(name: string, values: string[]): ColumnData {
  return ColumnData.create(name, values, EMPTY_NULL_POLICY);
}

test("composite keys flag duplicate combinations and skip null key parts", () => {
  const a = column("a", ["1", "1", "1", "2", "3", ""]);
  const b = column("b", ["x", "x", "y", "x", "z", "x"]);
  const result = computeKeyDuplicates([a, b], [0, 1], 6);
  assert.equal(result.counted, 5, "the row with a null key part is N.A.");
  assert.equal(result.duplicateRows, 1);
  assert.equal(result.duplicateGroups, 1);
  assert.equal(result.duplicateBits.get(0), true);
  assert.equal(result.duplicateBits.get(1), true);
  assert.equal(result.duplicateBits.get(2), false, "a different b is a different key");
  assert.equal(result.duplicateBits.get(5), false, "a null key part is never flagged");
});

test("a single-column key behaves like a uniqueness check", () => {
  const ids = column("id", ["7", "7", "8", "9", "9", "9"]);
  const result = computeKeyDuplicates([ids], [0], 6);
  assert.equal(result.duplicateRows, 3, "the second 7 plus two extra 9s");
  assert.equal(result.duplicateGroups, 2);
  assert.equal(result.duplicateBits.get(0), true);
  assert.equal(result.duplicateBits.get(1), true);
  assert.equal(result.duplicateBits.get(4), true);
  assert.equal(result.duplicateBits.get(5), true);
});

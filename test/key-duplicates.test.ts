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

test("with blanks matching, rows with empty cells are still compared, and blank meets blank", () => {
  // A whole row minus its id: the wine file's repeated reviews mostly have an empty region_2.
  const country = column("country", ["US", "US", "Italy", "Italy", "Italy", "France"]);
  const region = column("region_2", ["Sonoma", "Sonoma", "", "", "", ""]);
  const points = column("points", ["87", "87", "88", "88", "90", "88"]);
  const skipped = computeKeyDuplicates([country, region, points], [0, 1, 2], 6);
  assert.equal(skipped.duplicateRows, 1, "as a key, rows with a blank are not compared");
  const matched = computeKeyDuplicates([country, region, points], [0, 1, 2], 6, true);
  assert.equal(matched.counted, 6);
  assert.equal(matched.duplicateRows, 2, "the Sonoma repeat and the Italy, blank, 88 repeat");
  assert.equal(matched.duplicateGroups, 2);
  assert.equal(matched.duplicateBits.get(2), true);
  assert.equal(matched.duplicateBits.get(3), true);
  assert.equal(matched.duplicateBits.get(4), false, "different points");
  assert.equal(matched.duplicateBits.get(5), false, "different country");
});

test("with blanks matching, a blank never matches a value", () => {
  const a = column("a", ["x", "", "x"]);
  const b = column("b", ["", "y", ""]);
  const result = computeKeyDuplicates([a, b], [0, 1], 3, true);
  assert.equal(result.duplicateRows, 1, "rows 0 and 2 only");
  assert.equal(result.duplicateBits.get(1), false);
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

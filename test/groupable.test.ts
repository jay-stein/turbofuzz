import assert from "node:assert/strict";
import test from "node:test";
import { isGroupableColumn, MAX_GROUP_DISTINCT } from "../src/data/groupable.js";

test("groupable: everything but floats and identifiers when cardinality is small", () => {
  assert.equal(isGroupableColumn("category", 500), true);
  assert.equal(isGroupableColumn("boolean", 2), true);
  assert.equal(isGroupableColumn("integer", 7), true);
  assert.equal(isGroupableColumn("string", 40), true);
  assert.equal(isGroupableColumn("date", 30), true);
  assert.equal(isGroupableColumn("number", 3), false);
  assert.equal(isGroupableColumn("identifier", 3), false);
  assert.equal(isGroupableColumn("string", MAX_GROUP_DISTINCT + 1), false);
  assert.equal(isGroupableColumn("integer", 0), false);
});

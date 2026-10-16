import { test } from "node:test";
import assert from "node:assert/strict";
import { ColumnData } from "../src/data/column.js";
import { computePairViolations } from "../src/data/pair-checks.js";
import { EMPTY_NULL_POLICY } from "../src/parse/null-tokens.js";

function column(name: string, values: string[]): ColumnData {
  return ColumnData.create(name, values, EMPTY_NULL_POLICY);
}

test("pair checks compare numeric columns and skip missing pairs", () => {
  const order = column("order", ["1", "2", "3", "4", ""]);
  const delivery = column("delivery", ["2", "2", "2", "", "5"]);
  const result = computePairViolations([order, delivery], 0, 1, "gte", 0, 5);
  assert.equal(result.compared, 3, "rows 4 and 5 miss one side");
  assert.equal(result.violations, 1, "1 < 2 fails");
  assert.equal(result.violationBits.get(0), true);
  assert.equal(result.violationBits.get(1), false);
  assert.equal(result.violationBits.get(3), false, "a missing side is N.A.");
  assert.equal(result.violationBits.get(4), false, "a missing side is N.A.");
});

test("approx uses the tolerance", () => {
  const a = column("a", ["1.00", "1.05", "2.00"]);
  const b = column("b", ["1.01", "1.20", "2.00"]);
  const result = computePairViolations([a, b], 0, 1, "approx", 0.02, 3);
  assert.equal(result.compared, 3);
  assert.equal(result.violations, 1);
  assert.equal(result.violationBits.get(1), true);
});

test("date columns compare as instants, not strings", () => {
  const start = column("start", ["2024-01-01", "2024-02-01"]);
  const end = column("end", ["2024-01-15", "2024-01-20"]);
  const result = computePairViolations([start, end], 0, 1, "gte", 0, 2);
  assert.equal(result.compared, 2);
  assert.equal(result.violations, 1, "the first start is before its end");
  assert.equal(result.violationBits.get(0), true);
  assert.equal(result.violationBits.get(1), false);
});

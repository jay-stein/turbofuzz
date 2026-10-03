import { test } from "node:test";
import assert from "node:assert/strict";
import { ColumnData } from "../src/data/column.js";

function inferType(values: string[]): string {
  return ColumnData.create("column", values).type;
}

test("infers boolean", () => {
  assert.equal(inferType(["Yes", "No", "Yes", "No"]), "boolean");
  assert.equal(inferType(["true", "false", "true"]), "boolean");
});

test("infers integer", () => {
  assert.equal(inferType(["1", "2", "3", "42", "7"]), "integer");
  assert.equal(inferType(["2020", "2021", "2022"]), "integer");
});

test("infers identifier for leading zeros and long unique digits", () => {
  assert.equal(inferType(["007", "008", "009"]), "identifier");
  assert.equal(
    inferType(["12345678901", "12345678902", "12345678903"]),
    "identifier",
  );
});

test("infers number", () => {
  assert.equal(inferType(["1,200", "3,400", "500"]), "number");
  assert.equal(inferType(["1.5", "2.75", "3.125"]), "number");
});

test("infers date", () => {
  assert.equal(inferType(["2024-03-05", "2024-04-06", "2024-05-07"]), "date");
  assert.equal(inferType(["05/03/2024", "13/04/2024", "01/05/2024"]), "date");
});

test("infers category for repeated small sets", () => {
  assert.equal(inferType(["Active", "Inactive", "Active", "Pending", "Active"]), "category");
});

test("infers string for high-cardinality names", () => {
  const names = Array.from({ length: 20 }, (_, i) => `Person Number ${i} Xyz${i * 7}`);
  assert.equal(inferType(names), "string");
});

test("type override re-derives numeric data", () => {
  const column = ColumnData.create("usage", ["1,200", "3,400", "500"]);
  assert.equal(column.type, "number");
  const numbers = column.numbers();
  assert.equal(numbers[0], 1200);
  assert.equal(column.stats.min, 500);
  assert.equal(column.stats.max, 3400);

  column.setType("identifier");
  assert.equal(column.type, "identifier");

  column.setType("number");
  assert.equal(column.numbers()[1], 3400);
});

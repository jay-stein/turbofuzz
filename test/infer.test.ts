import { test } from "node:test";
import assert from "node:assert/strict";
import { ColumnData } from "../src/data/column.js";

function inferType(values: string[]): string {
  return ColumnData.create("column", values).type;
}

test("infers boolean", () => {
  assert.equal(inferType(["Yes", "No", "Yes", "No"]), "boolean");
  assert.equal(inferType(["true", "false", "true"]), "boolean");
  assert.equal(inferType(["0", "1", "1", "0"]), "boolean");
});

test("infers category for small non-negative code columns", () => {
  const codes = Array.from({ length: 120 }, (_, index) => String(index % 3));
  assert.equal(inferType(codes), "category");
  const ratings = Array.from({ length: 100 }, (_, index) => String((index % 5) + 1));
  assert.equal(inferType(ratings), "category");
});

test("whole-column parse promotes integer to number when decimals appear", () => {
  const values = Array.from({ length: 100 }, (_, index) => String(index));
  values[99] = "99.5";
  const column = ColumnData.create("mixed", values);
  assert.equal(column.type, "integer");
  column.numbers();
  assert.equal(column.type, "number");
});

test("a manually locked type survives the whole-column check", () => {
  const column = ColumnData.create("mixed", ["1", "2.5"]);
  column.setType("integer", true);
  column.numbers();
  assert.equal(column.type, "integer");
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

test("detects decimal-comma locale from the column sample", () => {
  const column = ColumnData.create("umsatz", ["198,72", "0,50", "999,99", "12,34"]);
  assert.equal(column.type, "number");
  assert.equal(column.numberLocale, "comma");
  const numbers = column.numbers();
  assert.equal(numbers[0], 198.72);
  assert.equal(column.stats.min, 0.5);
  assert.equal(column.stats.max, 999.99);
});

test("detects dot locale and ignores ambiguous thousands grouping", () => {
  const column = ColumnData.create("amount", ["1,234.56", "2,000.00", "3,655.10"]);
  assert.equal(column.type, "number");
  assert.equal(column.numberLocale, "dot");
  assert.equal(column.numbers()[0], 1234.56);

  const grouped = ColumnData.create("mixed", ["1.234", "5.678", "9.012"]);
  assert.equal(grouped.numberLocale, "dot");
});

test("locale prior decides on tied evidence", () => {
  const values = ["198,72", "1.23"];
  assert.equal(ColumnData.create("x", values, undefined, "comma").numberLocale, "comma");
  assert.equal(ColumnData.create("x", values, undefined, "dot").numberLocale, "dot");
});

test("number locale can be overridden after creation", () => {
  const column = ColumnData.create("umsatz", ["198,72", "12,34"]);
  assert.equal(column.numberLocale, "comma");
  column.setNumberLocale("dot");
  assert.equal(column.numberLocale, "dot");
  assert.equal(column.numbers()[0], 19872);
  column.setNumberLocale("comma");
  assert.equal(column.numbers()[0], 198.72);
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

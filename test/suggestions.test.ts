import { test } from "node:test";
import assert from "node:assert/strict";
import { detectSuggestions } from "../src/data/suggestions.js";

test("detects a repeated negative sentinel", () => {
  const values = [
    ...Array.from({ length: 100 }, (_, index) => String(index + 1)),
    ...Array.from({ length: 200 }, () => "-999"),
  ];
  const suggestions = detectSuggestions(values, "integer");
  const sentinel = suggestions.find((entry) => entry.kind === "sentinel");
  assert.ok(sentinel !== undefined);
  assert.equal(sentinel.value, "-999");
  assert.equal(sentinel.count, 200);
});

test("suggests extreme negatives even when they are not the top value", () => {
  const values = [
    ...Array.from({ length: 500 }, () => "1"),
    ...Array.from({ length: 100 }, () => "2"),
    ...Array.from({ length: 20 }, () => "-999"),
  ];
  const suggestions = detectSuggestions(values, "integer");
  const sentinel = suggestions.find((entry) => entry.kind === "sentinel");
  assert.ok(sentinel !== undefined);
  assert.equal(sentinel.value, "-999");
  assert.equal(sentinel.count, 20);
});

test("suggests placeholder shapes like TBC and all-zero dates", () => {
  const dates = [
    ...Array.from({ length: 200 }, (_, index) => `2024-01-${String((index % 28) + 1).padStart(2, "0")}`),
    ...Array.from({ length: 20 }, () => "TBC"),
    ...Array.from({ length: 12 }, () => "00/00/0000"),
  ];
  const suggestions = detectSuggestions(dates, "string");
  const sentinels = suggestions.filter((entry) => entry.kind === "sentinel");
  assert.deepEqual(
    sentinels.map((entry) => entry.value).sort(),
    ["00/00/0000", "TBC"],
  );
});

test("flags mixed decimal conventions in numeric columns", () => {
  const values = [
    ...Array.from({ length: 200 }, (_, index) => `1,${String(index).padStart(3, "0")}.56`),
    ...Array.from({ length: 10 }, (_, index) => `6${index},26`),
  ];
  const suggestions = detectSuggestions(values, "number", undefined, "dot");
  const mixed = suggestions.find((entry) => entry.kind === "mixedNumber");
  assert.ok(mixed !== undefined);
  assert.equal(mixed.locale, "dot");
  assert.equal(mixed.count, 10);
});

test("flags values that do not parse in a numeric column", () => {
  const values = [
    ...Array.from({ length: 200 }, (_, index) => String(index + 1)),
    ...Array.from({ length: 10 }, () => "high"),
  ];
  const suggestions = detectSuggestions(values, "integer");
  const conflict = suggestions.find((entry) => entry.kind === "typeConflict");
  assert.ok(conflict !== undefined);
  assert.equal(conflict.count, 10);
  assert.equal(conflict.example, "high");
  assert.equal(conflict.columnType, "integer");
});

test("flags formula-like cells in text columns", () => {
  const values = [
    ...Array.from({ length: 200 }, (_, index) => `user${index}@example.com`),
    ...Array.from({ length: 10 }, () => "=1+1"),
    ...Array.from({ length: 5 }, () => "@SUM(1,1)"),
  ];
  const suggestions = detectSuggestions(values, "string");
  const formula = suggestions.find((entry) => entry.kind === "formula");
  assert.ok(formula !== undefined);
  assert.equal(formula.count, 15);
  assert.equal(formula.example, "=1+1");
});

test("does not flag plain decimal points in a dot column", () => {
  const values = Array.from({ length: 200 }, (_, index) => `1,${String(index).padStart(3, "0")}.56`);
  assert.deepEqual(
    detectSuggestions(values, "number", undefined, "dot").filter(
      (entry) => entry.kind === "mixedNumber",
    ),
    [],
  );
});

test("does not flag ordinary small negative counts", () => {
  const values = Array.from({ length: 100 }, (_, index) => String(index % 3 === 0 ? -1 : index));
  assert.deepEqual(detectSuggestions(values, "integer"), []);
});

test("detects mixed boolean spellings", () => {
  const suggestions = detectSuggestions(["Y", "yes", "TRUE", "no", "N"], "category");
  const boolean = suggestions.find((entry) => entry.kind === "boolean");
  assert.ok(boolean !== undefined);
  assert.deepEqual(boolean.truthy, ["Y", "yes", "TRUE"]);
  assert.deepEqual(boolean.falsy, ["no", "N"]);
});

test("suggests number conversion for formatted text", () => {
  const suggestions = detectSuggestions(["$1.20", "$3.40", "$5.60", "$7.80", "free"], "string");
  const numeric = suggestions.find((entry) => entry.kind === "number");
  assert.ok(numeric !== undefined);
  assert.equal(numeric.hasSymbol, true);
});

test("stays quiet on plain text", () => {
  assert.deepEqual(detectSuggestions(["Alice", "Bob", "Carol"], "category"), []);
});

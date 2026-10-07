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

import { test } from "node:test";
import assert from "node:assert/strict";
import { isJsonName, parseJsonGrid } from "../src/parse/json.js";

test("parses an array of objects", () => {
  const grid = parseJsonGrid('[{"a":1,"b":"x"},{"a":2,"b":"y"}]', true);
  assert.deepEqual(grid.headers, ["a", "b"]);
  assert.deepEqual(grid.rows, [
    ["1", "x"],
    ["2", "y"],
  ]);
});

test("fills missing keys and flattens nested objects", () => {
  const grid = parseJsonGrid(
    '[{"a":1,"nested":{"x":true}},{"a":2,"nested":{"x":false,"y":"z"}}]',
    true,
  );
  assert.deepEqual(grid.headers, ["a", "nested.x", "nested.y"]);
  assert.deepEqual(grid.rows, [
    ["1", "true", ""],
    ["2", "false", "z"],
  ]);
});

test("parses an array of arrays honouring the header flag", () => {
  const withHeader = parseJsonGrid('[["name","age"],["Alice",30]]', true);
  assert.deepEqual(withHeader.headers, ["name", "age"]);
  assert.deepEqual(withHeader.rows, [["Alice", "30"]]);

  const without = parseJsonGrid('[["Alice",30]]', false);
  assert.deepEqual(without.headers, ["Column 1", "Column 2"]);
  assert.deepEqual(without.rows, [["Alice", "30"]]);
});

test("parses JSON Lines", () => {
  const grid = parseJsonGrid('{"a":1}\n{"a":2}\n', true);
  assert.deepEqual(grid.headers, ["a"]);
  assert.deepEqual(grid.rows, [["1"], ["2"]]);
});

test("parses a column-oriented object", () => {
  const grid = parseJsonGrid('{"a":[1,2],"b":["x","y"]}', true);
  assert.deepEqual(grid.headers, ["a", "b"]);
  assert.deepEqual(grid.rows, [
    ["1", "x"],
    ["2", "y"],
  ]);
});

test("nulls and booleans become strings", () => {
  const grid = parseJsonGrid('[{"a":null,"b":true}]', true);
  assert.deepEqual(grid.rows, [["", "true"]]);
});

test("rejects unsupported JSON", () => {
  assert.throws(() => parseJsonGrid("123", true));
  assert.throws(() => parseJsonGrid("[1,2,3]", true));
  assert.throws(() => parseJsonGrid("", true));
});

test("recognises JSON file names", () => {
  assert.equal(isJsonName("a/data.JSON"), true);
  assert.equal(isJsonName("a/data.jsonl"), true);
  assert.equal(isJsonName("a/data.ndjson"), true);
  assert.equal(isJsonName("a/data.csv"), false);
});

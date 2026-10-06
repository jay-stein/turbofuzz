import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isParquetName, readParquetGrid } from "../src/parse/parquet.js";

test("reads a parquet file into a string grid", async () => {
  const bytes = readFileSync(new URL("./fixtures/sample.parquet", import.meta.url));
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const grid = await readParquetGrid(buffer as ArrayBuffer);
  assert.deepEqual(grid.headers, ["id", "name", "score", "active"]);
  assert.deepEqual(grid.rows, [
    ["1", "Alice", "10.5", "true"],
    ["2", "Bob", "20.25", "false"],
    ["3", "Cara", "", "true"],
    ["4", "Dan", "40", ""],
  ]);
});

test("recognises parquet file names", () => {
  assert.equal(isParquetName("a/b/c.PARQUET"), true);
  assert.equal(isParquetName("data.csv"), false);
});

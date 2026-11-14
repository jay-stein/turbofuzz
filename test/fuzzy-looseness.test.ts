import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDataset } from "../src/data/build.js";
import { QueryEngine, type ColumnFilter } from "../src/search/query-engine.js";

const names = ["Katherine Smith", "Catherine Smyth", "Catherine Smith", "Katherine Smyth", "Catherine Schmitt", "Bob Jones"];

function rowsFor(looseness: "strict" | "normal" | "loose" | undefined): number[] {
  const engine = new QueryEngine(buildDataset("t", ["name"], names.map((n) => [n])));
  const filter: ColumnFilter = { kind: "text", mode: "fuzzy", query: "Katherin Smith", ...(looseness === undefined ? {} : { looseness }) };
  return [...engine.evaluate(new Map([[0, filter]]))];
}

test("a filter without looseness behaves exactly as Normal", () => {
  assert.deepEqual(rowsFor(undefined), rowsFor("normal"));
});

test("Strict never returns more rows than Normal, and Loose never fewer", () => {
  const strict = rowsFor("strict");
  const normal = rowsFor("normal");
  const loose = rowsFor("loose");
  assert.ok(strict.every((row) => normal.includes(row)));
  assert.ok(normal.every((row) => loose.includes(row)));
  assert.ok(strict.length < loose.length, `strict ${strict} vs loose ${loose}`);
  assert.ok(!strict.includes(4), "Strict leaves out Catherine Schmitt");
  assert.ok(strict.includes(0), "Strict keeps Katherine Smith");
});

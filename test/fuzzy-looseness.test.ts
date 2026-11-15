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

test("Normal keeps real typos but no longer pulls in different surnames", async () => {
  const { buildDataset } = await import("../src/data/build.js");
  const { QueryEngine } = await import("../src/search/query-engine.js");
  const { FUZZY_THRESHOLDS } = await import("../src/search/fuzzy-index.js");
  assert.ok(FUZZY_THRESHOLDS.loose < FUZZY_THRESHOLDS.normal && FUZZY_THRESHOLDS.normal < FUZZY_THRESHOLDS.strict);
  const ds = buildDataset("t", ["n"], [["Johnson"], ["Smith"], ["Cox"], ["Young"], ["Long"], ["Ross"]]);
  const engine = new QueryEngine(ds);
  const hits = (query: string) => [...engine.evaluate(new Map([[0, { kind: "text", mode: "fuzzy", query } as const]]))];
  assert.deepEqual(hits("Jonson"), [0]);
  assert.deepEqual(hits("Smyth"), [1]);
  assert.deepEqual(hits("Cook"), []);
  assert.deepEqual(hits("Long"), [4]);
});

test("the slider threshold widens monotonically and position 9 is the Normal default", async () => {
  const { thresholdForSlider, FUZZY_SLIDER_DEFAULT, FUZZY_THRESHOLDS } = await import("../src/search/fuzzy-index.js");
  assert.equal(thresholdForSlider(FUZZY_SLIDER_DEFAULT), FUZZY_THRESHOLDS.normal);
  const rows = (position: number): number[] => {
    const engine = new QueryEngine(buildDataset("t", ["name"], names.map((n) => [n])));
    const filter: ColumnFilter = { kind: "text", mode: "fuzzy", query: "Katherin Smith", threshold: thresholdForSlider(position) };
    return [...engine.evaluate(new Map([[0, filter]]))];
  };
  let previous = rows(0);
  for (let position = 3; position <= 27; position += 3) {
    const next = rows(position);
    assert.ok(previous.every((row) => next.includes(row)), `position ${position} lost a row`);
    previous = next;
  }
  assert.ok(rows(27).length > rows(0).length);
});

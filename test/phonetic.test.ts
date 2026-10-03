import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDataset } from "../src/data/build.js";
import { FuzzyIndex } from "../src/search/fuzzy-index.js";
import { QueryEngine } from "../src/search/query-engine.js";

test("phonetic search matches Smyth and Smith", () => {
  const index = new FuzzyIndex();
  index.build(["John Johnson", "Jane Jonson", "Anne Smyth", "Peter Smith", "Bob Brown"]);

  const { rowBits } = index.phoneticSearch("smyth");
  assert.equal(rowBits.get(2), true);
  assert.equal(rowBits.get(3), true);
  assert.equal(rowBits.get(0), false);
  assert.equal(rowBits.get(4), false);
});

test("phonetic search matches Johnson and Jonson", () => {
  const index = new FuzzyIndex();
  index.build(["John Johnson", "Jane Jonson", "Bob Brown"]);

  const { rowBits } = index.phoneticSearch("jonson");
  assert.equal(rowBits.get(0), true);
  assert.equal(rowBits.get(1), true);
  assert.equal(rowBits.get(2), false);
});

test("query engine phonetic mode returns matches", () => {
  const dataset = buildDataset("t", ["name"], [
    ["John Johnson"],
    ["Jane Jonson"],
    ["Anne Smyth"],
    ["Peter Smith"],
    ["Bob Brown"],
  ]);
  const engine = new QueryEngine(dataset);
  const hits = [
    ...engine.evaluate(new Map([[0, { kind: "text", mode: "phonetic", query: "smyth" }]])),
  ];
  assert.deepEqual(hits, [2, 3]);
});

test("query engine phonetic mode falls back to fuzzy when no code matches", () => {
  const dataset = buildDataset("t", ["name"], [["John Johnson"], ["Jane Jonson"], ["Bob Brown"]]);
  const engine = new QueryEngine(dataset);
  const hits = [
    ...engine.evaluate(new Map([[0, { kind: "text", mode: "phonetic", query: "Jhonson" }]])),
  ];
  assert.ok(hits.includes(0), `expected Johnson in ${JSON.stringify(hits)}`);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { normalize, tokenize } from "../src/search/normalize.js";
import { buildDataset } from "../src/data/build.js";
import { QueryEngine } from "../src/search/query-engine.js";

test("apostrophes are dropped, not split on", () => {
  assert.equal(normalize("McDonald's"), "mcdonalds");
  assert.equal(normalize("O’Brien"), "obrien");
  assert.equal(normalize("OʼBrien"), "obrien");
  assert.deepEqual(tokenize("O'Brien"), ["obrien"]);
  assert.equal(normalize("o'brien"), normalize("OBrien"));
});

test("non-decomposing letters fold to plain Latin", () => {
  assert.equal(normalize("Ørsted"), "orsted");
  assert.equal(normalize("Søren"), "soren");
  assert.equal(normalize("Łódź"), "lodz");
  assert.equal(normalize("Straße"), "strasse");
  assert.equal(normalize("Æble Œuvre"), "aeble oeuvre");
  assert.equal(normalize("Đorđe Þór Ðan"), "dorde thor dan");
});

test("look-alikes: hyphen and plain words are untouched", () => {
  assert.equal(normalize("Jean-Luc  Smith"), "jean-luc smith");
  assert.equal(normalize("  Plain "), "plain");
  assert.notEqual(normalize("Orsted"), normalize("Ostred"));
});

test("contains search finds folded and apostrophe values", () => {
  const ds = buildDataset("t", ["n"], [["McDonald's"], ["Ørsted"], ["Łódź"], ["Other"]]);
  const engine = new QueryEngine(ds);
  const hit = (q: string) => [...engine.evaluate(new Map([[0, { kind: "text", mode: "contains", query: q }]]))];
  assert.deepEqual(hit("mcdonalds"), [0]);
  assert.deepEqual(hit("orsted"), [1]);
  assert.deepEqual(hit("lodz"), [2]);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDataset } from "../src/data/build.js";
import { FuzzyIndex } from "../src/search/fuzzy-index.js";
import { QueryEngine } from "../src/search/query-engine.js";

test("fuzzy matches identifier prefixes at every query length", () => {
  const dataset = buildDataset(
    "t",
    ["code"],
    [["MAC000007"], ["MAC000008"], ["OTHER123"], ["MELB000123"]],
  );
  const engine = new QueryEngine(dataset);
  const target = dataset.columns[0].raw[0].toLowerCase();

  for (let length = 1; length <= target.length; length++) {
    const query = target.slice(0, length);
    const hits = [
      ...engine.evaluate(new Map([[0, { kind: "text", mode: "fuzzy", query }]])),
    ];
    assert.ok(hits.includes(0), `expected row 0 for "${query}"`);
  }
});

test("fuzzy short queries match tokens containing the text", () => {
  const dataset = buildDataset("t", ["code"], [["XMAB123"], ["OTHER"]]);
  const engine = new QueryEngine(dataset);
  const hits = [
    ...engine.evaluate(new Map([[0, { kind: "text", mode: "fuzzy", query: "MA" }]])),
  ];
  assert.ok(hits.includes(0), `expected XMAB123 in ${JSON.stringify(hits)}`);
});

test("fuzzy tolerates typos in identifiers", () => {
  const dataset = buildDataset(
    "t",
    ["code"],
    [["MAC000007"], ["MAC000008"], ["OTHER123"], ["MELB000123"]],
  );
  const engine = new QueryEngine(dataset);
  for (const query of ["MOC000007", "MAC00007", "MACOO0007"]) {
    const hits = [
      ...engine.evaluate(new Map([[0, { kind: "text", mode: "fuzzy", query }]])),
    ];
    assert.ok(hits.includes(0), `expected row 0 for "${query}"`);
  }
});

test("fuzzy index prefix candidates keep unrelated tokens out", () => {
  const index = new FuzzyIndex();
  index.build(["MAC000007", "MELB000123", "OTHER123"]);
  const { rowBits } = index.search("MAC");
  assert.equal(rowBits.get(0), true);
  assert.equal(rowBits.get(2), false);
});

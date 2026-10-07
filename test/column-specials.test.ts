import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDataset } from "../src/data/build.js";
import { QueryEngine } from "../src/search/query-engine.js";

test("column-scoped null specials filter only that column", () => {
  const dataset = buildDataset(
    "t",
    ["a", "b"],
    [
      ["", "x"],
      ["1", "x"],
      ["", "y"],
      ["1", ""],
    ],
  );
  const engine = new QueryEngine(dataset);

  engine.setColumnSpecial(0, "nulls", true);
  assert.deepEqual([...engine.evaluate(new Map())], [0, 2]);

  engine.setColumnSpecial(0, "nulls", false);
  engine.setColumnSpecial(1, "nulls", true);
  assert.deepEqual([...engine.evaluate(new Map())], [3]);
});

test("a column's own special is excluded from its facet base", () => {
  const dataset = buildDataset(
    "t",
    ["a", "b"],
    [
      ["", "x"],
      ["1", "x"],
      ["", "y"],
      ["1", ""],
    ],
  );
  const engine = new QueryEngine(dataset);
  engine.setColumnSpecial(0, "nulls", true);

  const ownBase = engine.evaluateBits(new Map(), 0);
  assert.equal(ownBase.count(), 4);
  const otherBase = engine.evaluateBits(new Map(), 1);
  assert.equal(otherBase.count(), 2);
});

test("value anomalies are scoped to the column that has the fence", () => {
  const rows: string[][] = [];
  for (let i = 0; i < 40; i++) {
    rows.push([String(i + 1), String(i + 1)]);
  }
  rows[39][1] = "1000000";
  const dataset = buildDataset("t", ["a", "b"], rows);

  assert.equal(dataset.valueColumnBits[0]?.count() ?? 0, 0);
  assert.ok((dataset.valueColumnBits[1]?.count() ?? 0) >= 1);

  const engine = new QueryEngine(dataset);
  engine.setColumnSpecial(1, "valueAnomalies", true);
  const hits = [...engine.evaluate(new Map())];
  assert.ok(hits.includes(39), `expected the planted outlier row in ${JSON.stringify(hits)}`);

  engine.setColumnSpecial(1, "valueAnomalies", false);
  assert.equal(engine.evaluate(new Map()).length, 40);
});

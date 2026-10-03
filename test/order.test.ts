import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDataset } from "../src/data/build.js";
import { buildRank, orderIds } from "../src/search/order.js";
import { QueryEngine } from "../src/search/query-engine.js";

test("orderIds walks the ascending rank forwards and backwards", () => {
  const dataset = buildDataset("t", ["n"], [["3"], ["1"], ["2"]]);
  const rank = buildRank(dataset, 0);
  assert.deepEqual([...rank], [1, 2, 0]);

  const engine = new QueryEngine(dataset);
  const bits = engine.evaluateBits(new Map());
  assert.deepEqual([...orderIds(bits, rank, 1)], [1, 2, 0]);
  assert.deepEqual([...orderIds(bits, rank, -1)], [0, 2, 1]);
});

test("rank order applies to filtered results without re-sorting", () => {
  const dataset = buildDataset("t", ["n"], [["30"], ["10"], ["20"], ["40"]]);
  const rank = buildRank(dataset, 0);
  const engine = new QueryEngine(dataset);
  const bits = engine.evaluateBits(
    new Map([[0, { kind: "range", min: 15, max: 35 }]]),
  );
  assert.deepEqual([...orderIds(bits, rank, 1)], [2, 0]);
  assert.deepEqual([...orderIds(bits, rank, -1)], [0, 2]);
});

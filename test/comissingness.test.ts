import { test } from "node:test";
import assert from "node:assert/strict";
import { BitSet } from "../src/search/bitset.js";
import { coMissingness } from "../src/data/comissingness.js";
import { coMissingnessFindings } from "../src/data/findings.js";

test("coMissingness counts pairwise joint nulls over the given rows", () => {
  const a = new BitSet(5);
  a.set(0);
  a.set(1);
  a.set(4);
  const b = new BitSet(5);
  b.set(0);
  b.set(1);
  const c = new BitSet(5);
  c.set(4);
  const ids = Uint32Array.from({ length: 5 }, (_, index) => index);
  const result = coMissingness([a, b, c], 5, ids);
  assert.deepEqual(result.nullCells, [3, 2, 1]);
  // Row-major 3×3: diagonal counts, off-diagonal joint counts.
  assert.equal(result.pairs[0], 3);
  assert.equal(result.pairs[1], 2);
  assert.equal(result.pairs[2], 1);
  assert.equal(result.pairs[4], 2);
  assert.equal(result.pairs[5], 0);
  assert.equal(result.pairs[8], 1);
});

test("coMissingness follows the filtered row order", () => {
  const a = new BitSet(3);
  a.set(2);
  const b = new BitSet(3);
  b.set(2);
  const subset = Uint32Array.from([0, 1]);
  assert.deepEqual(coMissingness([a, b], 3, subset).nullCells, [0, 0]);
  const full = Uint32Array.from([0, 1, 2]);
  assert.deepEqual(coMissingness([a, b], 3, full).nullCells, [1, 1]);
});

test("coMissingnessFindings reports rows missing together and ignores weak overlap", () => {
  const sameRows = coMissingnessFindings(
    [3, 4],
    ["birth year", "gender"],
    [100, 100],
    [100, 100, 100, 100],
  );
  assert.equal(sameRows.length, 1);
  assert.match(sameRows[0].title, /missing on the same 100 rows/);
  assert.equal(sameRows[0].impact.rows, 100);
  assert.deepEqual(sameRows[0].impact.columns, [3, 4]);
  assert.ok(sameRows[0].evidence.some((entry) => entry.metric === "method"));

  const weak = coMissingnessFindings(
    [3, 4],
    ["a", "b"],
    [100, 100],
    [100, 20, 20, 100],
  );
  assert.equal(weak.length, 0);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { missingnessGrid } from "../src/data/missingness.js";
import { BitSet } from "../src/search/bitset.js";

test("missingnessGrid buckets missing shares per column", () => {
  const present = new BitSet(10);
  const half = new BitSet(10);
  for (let row = 0; row < 5; row++) half.set(row);
  const grid = missingnessGrid([{ nullMask: present }, { nullMask: half }], 10, 2);
  assert.equal(grid.buckets, 2);
  assert.deepEqual([...grid.cells], [0, 255, 0, 0]);
});

test("missingnessGrid keeps one bucket per row when the table is small", () => {
  const mask = new BitSet(3);
  mask.set(1);
  const grid = missingnessGrid([{ nullMask: mask }], 3, 240);
  assert.equal(grid.buckets, 3);
  assert.deepEqual([...grid.cells], [0, 255, 0]);
});

test("missingnessGrid downsamples more rows than buckets", () => {
  const mask = new BitSet(100);
  for (let row = 0; row < 25; row++) mask.set(row);
  const grid = missingnessGrid([{ nullMask: mask }], 100, 4);
  assert.equal(grid.buckets, 4);
  assert.deepEqual([...grid.cells], [255, 0, 0, 0]);
});

test("missingnessGrid handles an empty dataset", () => {
  const grid = missingnessGrid([], 0, 240);
  assert.equal(grid.buckets, 1);
  assert.deepEqual([...grid.cells], []);
});

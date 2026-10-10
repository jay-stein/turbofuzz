import { test } from "node:test";
import assert from "node:assert/strict";
import { missingnessGrid } from "../src/data/missingness.js";
import { nullityProfile } from "../src/ui/missingness.js";
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

test("nullityProfile finds the most and least complete row blocks", () => {
  // 3 blocks × 2 columns: block 1 is fully missing, block 0 half, block 2 clean.
  const cells = Uint8Array.from([0, 255, 255, 255, 0, 0]);
  const profile = nullityProfile(cells, 3, 2);
  assert.equal(profile.maxBucket, 1);
  assert.equal(profile.maxRatio, 1);
  assert.equal(profile.minBucket, 2);
  assert.equal(profile.minRatio, 0);
  assert.ok(Math.abs(profile.ratios[0] - 0.5) < 1e-9);
  assert.deepEqual([...profile.ratios].map((r) => Math.round(r * 100)), [50, 100, 0]);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { missingnessGrid } from "../src/data/missingness.js";
import { bucketTooltip, nullityProfile } from "../src/ui/missingness.js";
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
  assert.deepEqual([...profile.affected], [1, 2, 0]);
  assert.ok(Math.abs(profile.ratios[0] - 0.5) < 1e-9);
  assert.deepEqual([...profile.ratios].map((r) => Math.round(r * 100)), [50, 100, 0]);
});

test("bucketTooltip reports the row range, affected columns and availability", () => {
  // 4 blocks of 10 rows, 3 columns; block 0 has one column with missing cells.
  const cells = Uint8Array.from([
    0, 5, 0,
    0, 0, 0,
    1, 2, 3,
    0, 0, 0,
  ]);
  assert.equal(
    bucketTooltip(cells, 3, 4, 40, 0),
    "Rows 1–10 · 1 of 3 columns has missing values · 66.7% available",
  );
  assert.equal(
    bucketTooltip(cells, 3, 4, 40, 1),
    "Rows 11–20 · 0 of 3 columns have missing values · 100% available",
  );
  assert.equal(
    bucketTooltip(cells, 3, 4, 40, 2),
    "Rows 21–30 · 3 of 3 columns have missing values · 0.0% available",
  );
});

test("bucketTooltip collapses single-row blocks", () => {
  const cells = Uint8Array.from([0, 0, 0]);
  assert.equal(
    bucketTooltip(cells, 1, 3, 3, 1),
    "Row 2 · 0 of 1 columns have missing values · 100% available",
  );
});

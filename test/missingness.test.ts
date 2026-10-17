import { test } from "node:test";
import assert from "node:assert/strict";
import { missingnessGrid } from "../src/data/missingness.js";
import { bucketTooltip, columnTooltip, nullityProfile } from "../src/ui/missingness.js";
import { BitSet } from "../src/search/bitset.js";

test("missingnessGrid buckets exact missing counts per column", () => {
  const present = new BitSet(10);
  const half = new BitSet(10);
  for (let row = 0; row < 5; row++) half.set(row);
  const grid = missingnessGrid([{ nullMask: present }, { nullMask: half }], 10, 2);
  assert.equal(grid.buckets, 2);
  assert.deepEqual([...grid.cells], [0, 5, 0, 0]);
});

test("missingnessGrid keeps one bucket per row when the table is small", () => {
  const mask = new BitSet(3);
  mask.set(1);
  const grid = missingnessGrid([{ nullMask: mask }], 3, 240);
  assert.equal(grid.buckets, 3);
  assert.deepEqual([...grid.cells], [0, 1, 0]);
});

test("missingnessGrid downsamples more rows than buckets", () => {
  const mask = new BitSet(100);
  for (let row = 0; row < 25; row++) mask.set(row);
  const grid = missingnessGrid([{ nullMask: mask }], 100, 4);
  assert.equal(grid.buckets, 4);
  assert.deepEqual([...grid.cells], [25, 0, 0, 0]);
});

test("missingnessGrid handles an empty dataset", () => {
  const grid = missingnessGrid([], 0, 240);
  assert.equal(grid.buckets, 1);
  assert.deepEqual([...grid.cells], []);
});

test("nullityProfile finds the most and least complete row blocks", () => {
  // 10 rows in 3 blocks (3/3/4 rows) × 2 columns.
  // Block 0 half missing, block 1 fully missing, block 2 clean.
  const cells = Uint16Array.from([0, 3, 3, 3, 0, 0]);
  const profile = nullityProfile(cells, 3, 2, 10);
  assert.equal(profile.maxBucket, 1);
  assert.equal(profile.maxRatio, 1);
  assert.equal(profile.minBucket, 2);
  assert.equal(profile.minRatio, 0);
  assert.deepEqual([...profile.affected], [1, 2, 0]);
  assert.ok(Math.abs(profile.ratios[0] - 0.5) < 1e-9);
  assert.deepEqual([...profile.ratios].map((r) => Math.round(r * 100)), [50, 100, 0]);
});

test("bucketTooltip reports the row range, missing cells and availability", () => {
  // 4 blocks of 10 rows, 3 columns = 30 cells per block.
  const cells = Uint16Array.from([
    0, 5, 0,
    0, 0, 0,
    1, 2, 3,
    0, 0, 0,
  ]);
  assert.equal(
    bucketTooltip(cells, 3, 4, 40, 0),
    "Rows 1–10 · 5 missing cells of 30 · 83.3% available",
  );
  assert.equal(
    bucketTooltip(cells, 3, 4, 40, 1),
    "Rows 11–20 · 0 missing cells of 30 · 100% available",
  );
  assert.equal(
    bucketTooltip(cells, 3, 4, 40, 2),
    "Rows 21–30 · 6 missing cells of 30 · 80.0% available",
  );
});

test("bucketTooltip availability moves with the block's missing density", () => {
  const cells = Uint16Array.from([
    0, 0,
    5, 5,
    10, 10,
  ]);
  const texts = [0, 1, 2].map((bucket) => bucketTooltip(cells, 2, 3, 30, bucket));
  assert.match(texts[0], /100% available$/);
  assert.match(texts[1], /50\.0% available$/);
  assert.match(texts[2], /0\.0% available$/);
  assert.equal(texts[1], "Rows 11–20 · 10 missing cells of 20 · 50.0% available");
});

test("bucketTooltip collapses single-row blocks", () => {
  const cells = Uint16Array.from([0, 0, 0]);
  assert.equal(
    bucketTooltip(cells, 1, 3, 3, 1),
    "Row 2 · 0 missing cells of 1 · 100% available",
  );
});

test("columnTooltip names the column and counts its missing cells", () => {
  // 4 blocks of 10 rows, 2 columns.
  const cells = Uint16Array.from([
    0, 5,
    0, 0,
    1, 0,
    0, 0,
  ]);
  assert.equal(
    columnTooltip(cells, 2, 4, 40, ["Car", "Price"], 0),
    "“Car” · 1 missing cell of 40 (2.5%)",
  );
  assert.equal(
    columnTooltip(cells, 2, 4, 40, ["Car", "Price"], 1),
    "“Price” · 5 missing cells of 40 (12.5%)",
  );
  assert.equal(
    columnTooltip(cells, 2, 4, 40, [null, "Price"], 0),
    "“Column 1” · 1 missing cell of 40 (2.5%)",
  );
  const complete = Uint16Array.from([1, 0, 0, 0, 0, 0, 0, 0]);
  assert.equal(
    columnTooltip(complete, 2, 4, 40, ["Car", "Price"], 1),
    "“Price” · complete — no missing cells",
  );
});

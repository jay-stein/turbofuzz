import { test } from "node:test";
import assert from "node:assert/strict";
import { actionsOverlap, type HitAction } from "../src/ui/chart-card.js";

const cat = (column: number, code: number): HitAction => ({ kind: "values", column, code });
const range = (column: number, min: number | null, max: number | null): HitAction => ({ kind: "range", column, min, max });

test("the same category in the same column overlaps; another column or code does not", () => {
  assert.equal(actionsOverlap([cat(2, 5)], [cat(2, 5)]), true);
  assert.equal(actionsOverlap([cat(2, 5)], [cat(2, 6)]), false);
  assert.equal(actionsOverlap([cat(2, 5)], [cat(3, 5)]), false);
});

test("ranges overlap when they share more than an edge", () => {
  assert.equal(actionsOverlap([range(0, 0, 10)], [range(0, 5, 15)]), true);
  assert.equal(actionsOverlap([range(0, 0, 10)], [range(0, 10, 20)]), false, "neighbouring bins are different slices");
  assert.equal(actionsOverlap([range(0, 0, 10)], [range(0, 11, 20)]), false);
  assert.equal(actionsOverlap([range(0, 10, 10)], [range(0, 0, 10)]), true, "a single value sits inside the bin");
});

test("a month hovered in one chart lights the weeks inside it in another", () => {
  const jan = range(1, Date.UTC(2024, 0, 1), Date.UTC(2024, 1, 1) - 1);
  const week = (d: number): HitAction => range(1, Date.UTC(2024, 0, d), Date.UTC(2024, 0, d + 7) - 1);
  assert.equal(actionsOverlap([jan], [week(8)]), true);
  assert.equal(actionsOverlap([jan], [range(1, Date.UTC(2024, 2, 1), Date.UTC(2024, 2, 8) - 1)]), false);
});

test("open-ended ranges and text actions", () => {
  assert.equal(actionsOverlap([range(0, 100, null)], [range(0, 500, 600)]), true);
  assert.equal(actionsOverlap([range(0, null, 10)], [range(0, 50, 60)]), false);
  assert.equal(actionsOverlap([{ kind: "text", column: 0, query: "a" }], [{ kind: "text", column: 0, query: "a" }]), false);
  assert.equal(actionsOverlap([], [cat(0, 0)]), false);
});

test("a two-category cell (heatmap) lights anything that shares either category", () => {
  assert.equal(actionsOverlap([cat(0, 1), cat(1, 2)], [cat(1, 2)]), true);
  assert.equal(actionsOverlap([cat(0, 1), cat(1, 2)], [cat(0, 9)]), false);
});

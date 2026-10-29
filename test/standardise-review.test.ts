import { test } from "node:test";
import assert from "node:assert/strict";
import { approvedCount, cellsChanged, groupCells, initGroups, pairsFor, resetToMostCommon, swapStandard } from "../src/data/standardise-review.js";

const groups = () =>
  initGroups([
    { spellings: [{ value: "Active", count: 50 }, { value: "active", count: 30 }, { value: "ACTIVE", count: 5 }] },
    { spellings: [{ value: "Sydney", count: 40 }, { value: "sydney", count: 60 }] },
    { spellings: [{ value: "solo", count: 3 }] },
  ]);

test("each group starts on its most common spelling, all approved; single-spelling groups are dropped", () => {
  const g = groups();
  assert.equal(g.length, 2);
  assert.deepEqual(pairsFor(g), [["active", "Active"], ["ACTIVE", "Active"], ["sydney", "Sydney"]].map(([a, b]) => [a, b]));
  assert.equal(cellsChanged(g), 30 + 5 + 60);
});

test("choosing another standard, swapping and typing your own change the pairs", () => {
  const g = groups();
  g[0]!.standard = "active";
  assert.deepEqual(pairsFor([g[0]!]).sort(), [["ACTIVE", "active"], ["Active", "active"]].sort());
  swapStandard(g[1]!);
  assert.equal(g[1]!.standard, "sydney");
  assert.deepEqual(pairsFor([g[1]!]), [["Sydney", "sydney"]]);
  swapStandard(g[0]!);
  assert.equal(g[0]!.standard, "active", "swap only applies to two-spelling groups");
  g[1]!.standard = "SYDNEY, NSW";
  assert.deepEqual(pairsFor([g[1]!]), [["Sydney", "SYDNEY, NSW"], ["sydney", "SYDNEY, NSW"]]);
  assert.equal(groupCells(g[1]!), 100);
});

test("an unapproved group or an empty custom standard changes nothing; reset restores the defaults", () => {
  const g = groups();
  g[0]!.approved = false;
  g[1]!.standard = "  ";
  assert.deepEqual(pairsFor(g), []);
  assert.equal(approvedCount(g), 1 - 1 + (groupCells(g[1]!) > 0 ? 1 : 0));
  resetToMostCommon(g);
  assert.equal(pairsFor(g).length, 3);
  assert.equal(approvedCount(g), 2);
});

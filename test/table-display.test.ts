import { test } from "node:test";
import assert from "node:assert/strict";
import { alignsAsNumber, autoGroups } from "../src/ui/table.js";
import type { ColumnMeta } from "../src/worker/protocol.js";

const cat = (labels: string[]) => ({ type: "category", categories: { labels, counts: labels.map(() => 1) } }) as unknown as ColumnMeta;

test("a category of plain numbers lines up as numbers; words, codes and mixed labels do not", () => {
  assert.equal(alignsAsNumber(cat(["1", "2", "3", ""])), true);
  assert.equal(alignsAsNumber(cat(["1.5", "-2"])), true);
  assert.equal(alignsAsNumber(cat(["1", "two"])), false);
  assert.equal(alignsAsNumber(cat(["A1", "B2"])), false);
  assert.equal(alignsAsNumber(cat([""])), false);
  assert.equal(alignsAsNumber({ type: "integer", categories: null } as unknown as ColumnMeta), true);
  assert.equal(alignsAsNumber({ type: "string", categories: null } as unknown as ColumnMeta), false);
});

test("thousands separators go on big number columns, not on IDs or small values", () => {
  const num = (name: string, max: number) => ({ name, type: "integer", role: null, stats: { min: 0, max } }) as unknown as ColumnMeta;
  assert.equal(autoGroups(num("price", 98_000_000)), true);
  assert.equal(autoGroups(num("listing_id", 105_000)), false);
  assert.equal(autoGroups(num("postcode", 20_000)), false);
  assert.equal(autoGroups(num("year", 2024)), false);
});

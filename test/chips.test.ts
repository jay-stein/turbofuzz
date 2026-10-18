import { test } from "node:test";
import assert from "node:assert/strict";
import {
  chipClass,
  chipCountLabel,
  chipText,
  collapsedFixLabel,
  suggestionChipLabel,
} from "../src/ui/chips.js";

test("shared chips distinguish filters from fixes", () => {
  assert.equal(chipText("filter", "2 empty cells"), "Filter: 2 empty cells");
  assert.equal(chipText("fix", "repair decimals"), "Fix: repair decimals");
  assert.equal(suggestionChipLabel("convert to number"), "Fix: convert to number");
  assert.match(chipClass("fix"), /fix/);
  assert.match(chipClass("filter"), /warn/);
});

test("sampled counts and collapsed fix labels are explicit", () => {
  assert.equal(chipCountLabel(55), "55");
  assert.equal(chipCountLabel(55, true), "~55");
  assert.equal(collapsedFixLabel(3), "Fix issues (3)");
});
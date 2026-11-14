import { test } from "node:test";
import assert from "node:assert/strict";
import { listKey } from "../src/ui/list-nav.js";

test("Enter picks the first match by default", () => {
  assert.deepEqual(listKey("Enter", 0, 1), { kind: "pick", index: 0 });
});

test("arrows move the highlight and clamp at the ends", () => {
  assert.deepEqual(listKey("ArrowDown", 0, 3), { kind: "move", active: 1 });
  assert.deepEqual(listKey("ArrowDown", 2, 3), { kind: "move", active: 2 });
  assert.deepEqual(listKey("ArrowUp", 0, 3), { kind: "move", active: 0 });
  assert.deepEqual(listKey("Enter", 2, 3), { kind: "pick", index: 2 });
});

test("Escape closes; an empty list ignores Enter and arrows", () => {
  assert.deepEqual(listKey("Escape", 0, 0), { kind: "close" });
  assert.deepEqual(listKey("Enter", 0, 0), { kind: "none" });
  assert.deepEqual(listKey("ArrowDown", 0, 0), { kind: "none" });
});

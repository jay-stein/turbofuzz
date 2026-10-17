import { test } from "node:test";
import assert from "node:assert/strict";
import { VIEW_ORDER, viewSwitchHint } from "../src/ui/view-tabs.js";

test("the keyboard hint follows the number of registered tabs", () => {
  assert.equal(VIEW_ORDER.length, 6);
  assert.equal(viewSwitchHint(), `switch anytime with 1–${VIEW_ORDER.length}`);
});

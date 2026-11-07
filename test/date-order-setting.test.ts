import { test } from "node:test";
import assert from "node:assert/strict";
import { setDateTieBreak } from "../src/parse/conventions.js";
import { dateOrderIsAmbiguous, detectDateOrder, parseDate } from "../src/parse/dates.js";

const both = ["01/02/2025", "03/04/2025", "05/06/2025"];

test("the data decides the order whenever it can, whatever the setting", () => {
  assert.equal(detectDateOrder(["14/03/2025", "01/02/2025"], "mdy"), "dmy");
  assert.equal(detectDateOrder(["03/14/2025", "01/02/2025"], "dmy"), "mdy");
  assert.equal(dateOrderIsAmbiguous(["14/03/2025", "01/02/2025"]), false);
});

test("when every value fits both orders the setting breaks the tie, and day-first is only the fallback", () => {
  assert.equal(dateOrderIsAmbiguous(both), true);
  assert.equal(detectDateOrder(both, "mdy"), "mdy");
  assert.equal(detectDateOrder(both, "dmy"), "dmy");
  assert.equal(detectDateOrder(both, null), "dmy");
  setDateTieBreak("mdy");
  try {
    assert.equal(detectDateOrder(both), "mdy", "the order set for this load applies without being passed");
    assert.equal(new Date(parseDate("01/02/2025", detectDateOrder(both))).toISOString().slice(0, 10), "2025-01-02");
  } finally {
    setDateTieBreak(null);
  }
  assert.equal(detectDateOrder(both), "dmy");
});

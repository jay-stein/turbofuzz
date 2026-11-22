import { test } from "node:test";
import assert from "node:assert/strict";
import { nudgeText } from "../src/ui/qa-nudge.js";

test("the nudge speaks only when something needs fixing", () => {
  assert.equal(nudgeText({ score: 100, fix: 0, review: 0 }), null);
  assert.equal(nudgeText({ score: 92.1, fix: 0, review: 3 }), null, "things to review alone are not pushed");
});

test("the nudge gives the score and the same counts as Data Quality", () => {
  assert.equal(nudgeText({ score: 71.44, fix: 1, review: 0 }), "Data quality 71.4: 1 thing needs fixing. Data Quality shows you how to fix these issues in a single click.");
  assert.equal(nudgeText({ score: 64, fix: 6, review: 2 }), "Data quality 64.0: 6 things need fixing and 2 things worth a look. Data Quality shows you how to fix these issues in a single click.");
});

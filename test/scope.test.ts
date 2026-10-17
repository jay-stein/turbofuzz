import { test } from "node:test";
import assert from "node:assert/strict";
import { describeScope } from "../src/ui/scope.js";

test("scope descriptions distinguish whole data, filtered rows and views", () => {
  assert.equal(describeScope({ total: 100 }), "Whole dataset (100 rows)");
  assert.equal(
    describeScope({ total: 100, visible: 40 }),
    "Current rows: 40 of 100",
  );
  assert.equal(
    describeScope({ total: 100, visible: 40, viewName: "Q3 sales" }),
    "View: Q3 sales",
  );
});

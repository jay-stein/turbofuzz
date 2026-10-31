import { test } from "node:test";
import assert from "node:assert/strict";
import { ifThenFormula, QUICK_PICKS } from "../src/ui/new-column-dialog.js";
import { compileFormula } from "../src/data/column-formula.js";
import type { ColumnType } from "../src/types.js";

const types = new Map<string, ColumnType>([["Status", "category"], ["Amount", "number"], ["Ordered", "date"]]);
const info = [...types].map(([name, type]) => ({ name, type }));

test("If / then writes nested IFs, comparing numbers and dates as such", () => {
  assert.equal(
    ifThenFormula([{ column: "Status", op: "is", value: "Closed", then: "Done" }], "Open", types),
    'IF([Status] = "Closed", "Done", "Open")',
  );
  assert.equal(
    ifThenFormula([
      { column: "Amount", op: "ge", value: "10000", then: "3" },
      { column: "Amount", op: "ge", value: "1000", then: "2" },
    ], "1", types),
    "IF([Amount] >= 10000, 3, IF([Amount] >= 1000, 2, 1))",
  );
  assert.equal(ifThenFormula([{ column: "Ordered", op: "lt", value: "2024-07-01", then: "early" }], "", types), 'IF([Ordered] < DATE(2024, 7, 1), "early", "")');
  assert.equal(ifThenFormula([{ column: "Status", op: "empty", value: "", then: "?" }], "", types), 'IF(ISBLANK([Status]), "?", "")');
  assert.equal(ifThenFormula([{ column: "Status", op: "contains", value: 'say "hi"', then: "x" }], "", types), 'IF(CONTAINS([Status], "say ""hi"""), "x", "")');
  assert.equal(ifThenFormula([], "", types), null);
  // Every builder output compiles.
  for (const f of ['IF([Status] = "Closed", "Done", "Open")', 'IF([Ordered] < DATE(2024, 7, 1), "early", "")']) assert.equal(compileFormula(f, info).ok, true);
});

test("every quick column writes a formula that compiles", () => {
  for (const p of QUICK_PICKS) {
    const a = p.needs === "date" ? "Ordered" : p.needs === "number" ? "Amount" : "Status";
    const f = p.formula(a, "Status", 5, " ");
    assert.equal(compileFormula(f, info).ok, true, `${p.id}: ${f}`);
    assert.ok(p.name(a, "Status").length > 0);
  }
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { suggestMeltRoles, suggestVariableName } from "../src/ui/melt-dialog.js";

const col = (name: string, numeric = false) => ({ name, numeric });

test("years, months and quarters in the headers are stacked, and everything else is kept", () => {
  assert.deepEqual(suggestMeltRoles([col("region"), col("2019", true), col("2020", true), col("2021", true)]), ["keep", "unpivot", "unpivot", "unpivot"]);
  assert.deepEqual(suggestMeltRoles([col("id"), col("Jan", true), col("Feb", true), col("note")]), ["keep", "unpivot", "unpivot", "keep"]);
  assert.deepEqual(suggestMeltRoles([col("id"), col("Q1", true), col("Q2", true)]), ["keep", "unpivot", "unpivot"]);
});

test("without period headers, number columns are stacked; with nothing to go on, the first is kept", () => {
  assert.deepEqual(suggestMeltRoles([col("name"), col("height", true), col("weight", true)]), ["keep", "unpivot", "unpivot"]);
  assert.deepEqual(suggestMeltRoles([col("a"), col("b"), col("c")]), ["keep", "unpivot", "unpivot"]);
});

test("the column of old headers is named for what the headers are", () => {
  assert.equal(suggestVariableName(["2019", "2020"]), "year");
  assert.equal(suggestVariableName(["Jan", "February", "Mar"]), "month");
  assert.equal(suggestVariableName(["Q1", "Q2"]), "quarter");
  assert.equal(suggestVariableName(["height", "weight"]), "variable");
});

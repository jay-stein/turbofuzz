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

import { matchColumns } from "../src/ui/melt-dialog.js";

test("columns are picked by part of the name, or by a pattern", () => {
  const names = ["site", "kwh_jan", "KWH_feb", "cost", "kwh total"];
  assert.deepEqual(matchColumns(names, "kwh", false), [1, 2, 4]);
  assert.deepEqual(matchColumns(names, "^kwh_", true), [1, 2]);
  assert.deepEqual(matchColumns(names, "", false), []);
  assert.equal(matchColumns(names, "(", true), null);
});

import { suggestSpread } from "../src/ui/spread-dialog.js";

test("spread guesses the headers column beside the values, else the column with the fewest repeats", () => {
  const schema = [col("site"), col("cost", true), col("year"), col("kwh", true)];
  assert.deepEqual(suggestSpread(schema, [2, 2, 3, 6]), { key: 2, value: 3 });
  assert.deepEqual(suggestSpread([col("id"), col("metric"), col("amount", true), col("n", true)], [100, 4, 90, 95]), { key: 1, value: 3 });
});

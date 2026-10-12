import { test } from "node:test";
import assert from "node:assert/strict";
import {
  matchColumns,
  parseRecipeFile,
  planReplay,
  type RecipeFile,
} from "../src/data/recipe-file.js";

function recipe(overrides: Partial<RecipeFile> = {}): RecipeFile {
  return {
    kind: "turbofuzz-recipe",
    version: 1,
    name: "sales.csv",
    savedAt: "2026-10-12T00:00:00.000Z",
    columns: ["Region", " Amount ", "when"],
    cleans: [
      { name: " Amount ", ops: [{ kind: "trim" }] },
      { name: "Gone", ops: [{ kind: "case", style: "upper" }] },
    ],
    nulls: [{ name: "when", extra: ["TBC"], keep: [] }],
    types: [{ name: "when", type: "date" }],
    baseSchema: [
      { name: "Region", numeric: false },
      { name: " Amount ", numeric: true },
    ],
    transforms: [{ kind: "round", column: 1, decimals: 2 }],
    ...overrides,
  };
}

test("matchColumns prefers exact names, then case/space folding", () => {
  const mapped = matchColumns(
    ["Region", " Amount ", "GONE"],
    ["region", "amount", "other"],
  );
  assert.deepEqual(mapped, [0, 1, null]);
});

test("planReplay maps steps by name and skips missing columns", () => {
  const plan = planReplay(recipe(), ["region ", "amount", "when"]);
  assert.deepEqual(
    plan.cleans.map((entry) => entry.column),
    [1],
  );
  assert.deepEqual(plan.nulls, [{ column: 2, extra: ["TBC"], keep: [] }]);
  assert.deepEqual(plan.types, [{ column: 2, type: "date" }]);
  assert.deepEqual(plan.transforms, [{ kind: "round", column: 1, decimals: 2 }]);
  assert.deepEqual(plan.skipped, ["Gone"]);
  assert.equal(plan.transformsSkipped, false);
});

test("planReplay flags transforms when a base column is missing", () => {
  const plan = planReplay(recipe(), ["region", "date"]);
  assert.equal(plan.transformsSkipped, true);
  assert.ok(plan.skipped.includes(" Amount "));
  assert.deepEqual(plan.transforms, []);
});

test("parseRecipeFile validates the file kind", () => {
  assert.equal(parseRecipeFile(JSON.stringify(recipe())).name, "sales.csv");
  assert.throws(() => parseRecipeFile("{"), /not valid JSON/);
  assert.throws(() => parseRecipeFile('{"kind":"something-else"}'), /not a TurboFuzz recipe/);
});

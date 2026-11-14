import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  MIN_VERIFIED_PANDAS,
  MIN_VERIFIED_POLARS,
  TESTED_PANDAS,
  TESTED_POLARS,
  supportHint,
} from "../src/data/recipe-support.js";
import { pandasRecipe } from "../src/data/recipe.js";
import { polarsRecipeScript } from "../src/data/recipe-polars.js";

const requirements = readFileSync(new URL("../tools/recipe-parity/requirements.txt", import.meta.url), "utf8");

function pin(name: string): string | undefined {
  return new RegExp(`^${name}==([^\\s]+)$`, "m").exec(requirements)?.[1];
}

const empty = { cleans: [], transforms: [], schema: [] } as never;

test("the tested versions in the scripts equal the pins the parity harness runs on", () => {
  assert.equal(TESTED_PANDAS, pin("pandas"));
  assert.equal(TESTED_POLARS, pin("polars"));
  const verified = /^# Also verified[^\n]*$/m.exec(requirements)?.[0] ?? "";
  assert.ok(verified.includes(`pandas==${MIN_VERIFIED_PANDAS}`), verified);
  assert.ok(verified.includes(`polars==${MIN_VERIFIED_POLARS}`), verified);
});

test("each script header names the version it is written for and was tested with", () => {
  assert.match(
    pandasRecipe(empty),
    /^# Written for pandas 3\.1 \(tested with pandas 3\.1\.1\)\. Install: pip install "pandas>=3\.1,<4"$/m,
  );
  assert.match(
    polarsRecipeScript(empty).code,
    /^# Written for Polars 2\.1 \(tested with Polars 2\.1\.0\)\. Install: pip install "polars>=2\.1,<3"$/m,
  );
});

test("the Recipe drawer's support line names the tested version", () => {
  assert.equal(supportHint("pandas", []), "No steps to export as pandas. Tested with pandas 3.1.1.");
  assert.equal(
    supportHint("polars", [{ label: "dedupe", status: "supported" }]),
    "1 of 1 steps export as executable polars · Tested with Polars 2.1.0",
  );
});

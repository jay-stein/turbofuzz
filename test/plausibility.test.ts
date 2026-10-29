import { test } from "node:test";
import assert from "node:assert/strict";
import { checkPlausibility } from "../src/data/plausibility.js";

const none = (): boolean => false;
const check = (name: string, values: string[], type: "integer" | "number" | "string" = "integer") =>
  checkPlausibility(name, type, values, none, "dot", 2026);

test("an age above 120 or below 0 is counted exactly; a sensible one is not", () => {
  const result = check("age", ["25", "40", "240", "31", "-3", "999"]);
  assert.equal(result?.count, 3);
  assert.equal(result?.checked, 6);
  assert.deepEqual(result?.examples, ["240", "-3", "999"]);
  assert.equal(check("age", ["25", "40", "31"]), null);
});

test("rules need the whole-word hint: package, image and percentage-style names do not trigger age", () => {
  for (const name of ["package", "image", "usage", "average", "page_count"]) {
    assert.equal(check(name, ["500", "600", "700"]), null, name);
  }
  assert.equal(check("age_years", ["30", "999"])?.count, 1);
  assert.equal(check("customerAge", ["30", "999"])?.count, 1);
});

test("percent only applies when the values look like percentages", () => {
  assert.equal(check("pct_complete", ["10", "20", "50", "60", "100", "130"], "number")?.count, 1);
  // 0 to 5000 counts named percent_of_total? Mostly outside 0-100, so the rule stays out of the way.
  assert.equal(check("percent", ["1500", "2500", "3000", "50"], "number"), null);
});

test("year uses the current year plus one as the upper bound", () => {
  assert.equal(check("signup_year", ["2020", "2025", "2028", "1850"])?.count, 2);
  assert.equal(check("signup_year", ["2020", "2031"])?.max, 2027);
  assert.equal(check("year", ["5", "7", "9"]), null, "values that do not look like years are left alone");
});

test("text columns and placeholders are ignored", () => {
  assert.equal(check("age", ["25", "999"], "string"), null);
  assert.equal(
    checkPlausibility("age", "integer", ["25", "N/A", "30"], (v) => v === "N/A", "dot", 2026),
    null,
  );
});

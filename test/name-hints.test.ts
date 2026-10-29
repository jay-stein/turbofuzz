import { test } from "node:test";
import assert from "node:assert/strict";
import { firstHint, nameHas, nameTokens } from "../src/data/name-hints.js";

test("names split on separators, camelCase and acronyms", () => {
  assert.deepEqual(nameTokens("customerPhone_2"), ["customer", "phone", "2"]);
  assert.deepEqual(nameTokens("BloodPressure"), ["blood", "pressure"]);
  assert.deepEqual(nameTokens("HTMLParser"), ["html", "parser"]);
  assert.deepEqual(nameTokens("Price Per Unit"), ["price", "per", "unit"]);
});

test("age does not match percentage, image, package or manage", () => {
  for (const name of ["percentage", "image", "package", "manage", "usage_message"]) {
    assert.equal(nameHas(name, "nonNegative"), false, name);
    assert.equal(firstHint(name, "zeroImplausible"), null, name);
  }
  assert.equal(nameHas("age", "nonNegative"), true);
  assert.equal(nameHas("Age_Years", "nonNegative"), true);
});

test("rate does not match generate, count does not match discount", () => {
  assert.equal(nameHas("generate", "measurement"), false);
  assert.equal(nameHas("birth_rate", "measurement"), true);
  assert.equal(nameHas("discount", "nonNegative"), false);
  assert.equal(nameHas("item_count", "nonNegative"), true);
  assert.equal(nameHas("discount", "chartMeasure"), true, "discount is its own chart word");
});

test("duration does not match ratio, size does not match resize", () => {
  assert.equal(nameHas("duration", "measurement"), true);
  assert.equal(nameHas("resize", "measurement"), false);
  assert.equal(nameHas("ratio", "measurement"), true);
});

test("plural forms match their singular hint", () => {
  assert.equal(nameHas("units_sold", "nonNegative"), true);
  assert.equal(nameHas("amounts", "measurement"), true);
  assert.equal(nameHas("sales", "chartMeasure"), true);
});

test("ordinary column names never trigger sensitive or zero hints", () => {
  for (const name of ["zone", "batch", "type", "flag_1", "product_name", "region"]) {
    for (const group of ["phone", "email", "government", "financial", "health", "dateOfBirth", "zeroImplausible"] as const) {
      assert.equal(nameHas(name, group), false, `${name} / ${group}`);
    }
  }
});

test("a person qualifier makes name personal, product does not", () => {
  assert.equal(nameHas("customer_name", "personQualifier"), true);
  assert.equal(nameHas("product_name", "personQualifier"), false);
  assert.equal(nameHas("ip_address", "address"), true);
});

test("sensitive groups cover the plan's examples", () => {
  assert.equal(nameHas("TFN", "government"), true);
  assert.equal(nameHas("date_of_birth", "dateOfBirth"), true);
  assert.equal(nameHas("birth_date", "dateOfBirth"), true);
  assert.equal(nameHas("Medicare No", "government"), true);
  assert.equal(nameHas("card_number", "financial"), true);
});

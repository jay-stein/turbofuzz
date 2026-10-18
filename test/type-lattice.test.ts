import { test } from "node:test";
import assert from "node:assert/strict";
import { castCompatibility, commonType } from "../src/data/type-lattice.js";

test("the type lattice only promotes lossless pairs", () => {
  assert.equal(commonType(["integer", "number"]).type, "number");
  assert.equal(commonType(["integer", "number"]).conflict, false);
  assert.equal(commonType(["date", "datetime"]).type, "datetime");
  assert.equal(commonType(["boolean", "category"]).type, "category");
  assert.equal(commonType(["category", "category"]).type, "category");
});

test("incompatible types fall back to text with a stable reason", () => {
  const mixed = commonType(["number", "date"]);
  assert.equal(mixed.type, "string");
  assert.equal(mixed.conflict, true);
  assert.match(mixed.reason, /Number \+ Date/);
  assert.match(mixed.reason, /text/);
  const identified = commonType(["identifier", "integer"]);
  assert.equal(identified.type, "string");
  assert.equal(identified.conflict, true);
});

test("cast compatibility explains lossy and invalid conversions", () => {
  assert.equal(castCompatibility("integer", "number").risk, "safe");
  assert.equal(castCompatibility("number", "integer").risk, "lossy");
  assert.equal(castCompatibility("datetime", "date").risk, "lossy");
  assert.equal(castCompatibility("string", "boolean").risk, "invalid");
  assert.match(castCompatibility("string", "boolean").reason, /failure policy/);
});
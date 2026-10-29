import { test } from "node:test";
import assert from "node:assert/strict";
import { maskValue } from "../src/data/mask-value.js";
import { clearSensitiveMarks, getSensitiveMark, setSensitiveMark } from "../src/ui/sensitive-marks.js";

test("emails keep the first letter and the domain", () => {
  assert.equal(maskValue("jane.doe@example.com"), "j***@example.com");
  assert.equal(maskValue("  a@b.co "), "a***@b.co");
});

test("other values keep the first character and the last two", () => {
  assert.equal(maskValue("0412345678"), "0*******78");
  assert.equal(maskValue("4111 1111 1111 1111"), "4********11");
  assert.equal(maskValue("abc"), "***");
  assert.equal(maskValue(""), "");
  assert.ok(!maskValue("Smith Jones").includes("mith J"));
});

test("sensitive decisions are keyed by column name and type", () => {
  clearSensitiveMarks();
  assert.deepEqual(getSensitiveMark("email", "string"), {});
  setSensitiveMark("email", "string", { dismissed: true });
  setSensitiveMark("email", "string", { label: "restricted" });
  assert.deepEqual(getSensitiveMark("email", "string"), { dismissed: true, label: "restricted" });
  assert.deepEqual(getSensitiveMark("email", "category"), {}, "a different type is a different column");
  assert.deepEqual(getSensitiveMark("phone", "string"), {});
  setSensitiveMark("email", "string", { dismissed: false, label: undefined });
  assert.deepEqual(getSensitiveMark("email", "string"), {});
  clearSensitiveMarks();
});

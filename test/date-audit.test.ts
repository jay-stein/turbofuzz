import { test } from "node:test";
import assert from "node:assert/strict";
import { auditDates, dateShape, isSwappable } from "../src/data/date-audit.js";

test("a date's shape keeps its form, not its value", () => {
  assert.equal(dateShape("2014-07-07 00:00:00"), "9999-99-99 99:99:99");
  assert.equal(dateShape(" 7 Jul 2014 "), "9 a 9999");
});

test("day and month can be swapped only when both are 12 or less and differ", () => {
  assert.equal(isSwappable("03/04/2020"), true);
  assert.equal(isSwappable("13/04/2020"), false);
  assert.equal(isSwappable("04/04/2020"), false);
  assert.equal(isSwappable("2020-03-04"), false, "year first is ISO: no doubt");
});

test("the audit lists the file's text beside what it was read as, and counts problems over the whole column", () => {
  const text = ["2014-07-07 00:00:00", "", "NA", "03/04/2020", "soon", "2014-08-14 18:45:00"];
  const values = [Date.UTC(2014, 6, 7), Number.NaN, Number.NaN, Date.UTC(2020, 3, 3), Number.NaN, Date.UTC(2014, 7, 14, 18, 45)];
  const result = auditDates(text, values, (row) => row === 2, 2);
  assert.equal(result.nonEmpty, 4);
  assert.equal(result.blanks, 2, "empty text and the NA token are blanks, not failures");
  assert.equal(result.unreadable, 1);
  assert.equal(result.ambiguous, 1);
  assert.equal(result.timed, 1, "one value has a time other than midnight");
  assert.deepEqual(result.rows.map((row) => [row.row, row.flag]), [[0, "ok"], [3, "ambiguous"]]);
  assert.deepEqual(result.problems.map((row) => [row.row, row.flag]), [[3, "ambiguous"], [4, "unreadable"]]);
  assert.deepEqual(result.shapes[0], { shape: "9999-99-99 99:99:99", count: 2, example: "2014-07-07 00:00:00" });
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { formatForText } from "../src/data/formula-text.js";

const T = Date.UTC(2024, 2, 5, 14, 7, 9); // Tuesday 5 March 2024, 14:07:09
const general = (n: number): string => String(n);

function dateText(format: string, at = T): string {
  const r = formatForText(at, format, true, general);
  assert.ok(r.ok, `${format}: ${r.ok ? "" : r.reason}`);
  return r.text;
}

function numberText(value: number, format: string): string {
  const r = formatForText(value, format, false, general);
  assert.ok(r.ok, `${format}: ${r.ok ? "" : r.reason}`);
  return r.text;
}

test("dates: names, padding, and the 12-hour clock", () => {
  assert.equal(dateText("dddd"), "Tuesday");
  assert.equal(dateText("ddd, d mmm yyyy"), "Tue, 5 Mar 2024");
  assert.equal(dateText("dd/mm/yy"), "05/03/24");
  assert.equal(dateText("yyyy-mm-dd hh:mm:ss"), "2024-03-05 14:07:09");
  assert.equal(dateText("mmmm"), "March");
  assert.equal(dateText("mmmmm"), "M");
  assert.equal(dateText("h:mm AM/PM"), "2:07 PM");
  assert.equal(dateText("hh:mm am/pm"), "02:07 pm");
  assert.equal(dateText("h A/P"), "2 P");
  assert.equal(dateText("h:mm AM/PM", Date.UTC(2024, 0, 1, 0, 5)), "12:05 AM");
});

test("dates: m is the minute after an hour or before a second, and the month anywhere else", () => {
  assert.equal(dateText("hh:mm"), "14:07");
  assert.equal(dateText("mm:ss"), "07:09");
  assert.equal(dateText("h:m:s"), "14:7:9");
  assert.equal(dateText("mm/dd"), "03/05");
  assert.equal(dateText("m/d/yyyy"), "3/5/2024");
});

test("dates: quoted and escaped text is left alone, and a number is read as days from 1970", () => {
  assert.equal(dateText('d "of" mmmm'), "5 of March");
  assert.equal(dateText("yyyy\\m"), "2024m");
  // 19787 days after 1970-01-01 is 2024-03-05.
  assert.deepEqual(formatForText(19787, "yyyy-mm-dd", false, general), { ok: true, text: "2024-03-05" });
});

test("numbers: places, thousands, percent, currency and the three sections", () => {
  assert.equal(numberText(1234.567, "#,##0.00"), "1,234.57");
  assert.equal(numberText(0.256, "0%"), "26%");
  assert.equal(numberText(0.256, "0.0%"), "25.6%");
  assert.equal(numberText(5, "000"), "005");
  assert.equal(numberText(1234.5, "$#,##0"), "$1,235");
  assert.equal(numberText(-5, "0;(0)"), "(5)");
  assert.equal(numberText(0, "0;-0;zero"), "zero");
  assert.equal(numberText(-3.14159, "0.00"), "-3.14");
  assert.equal(numberText(-5, "$0"), "-$5");
  assert.equal(numberText(1e6, "#,##0"), "1,000,000");
  assert.equal(numberText(12, '0 "kg"'), "12 kg");
});

test("numbers: # places are optional, 0 places are not, and halves round away from zero", () => {
  assert.equal(numberText(1.5, "0.0#"), "1.5");
  assert.equal(numberText(1.256, "0.0#"), "1.26");
  assert.equal(numberText(0.5, "#.00"), ".50");
  assert.equal(numberText(0, "#"), "");
  assert.equal(numberText(1.005, "0.00"), "1.01");
  assert.equal(numberText(2.5, "0"), "3");
  assert.equal(numberText(-2.5, "0"), "-3");
});

test("General is the number as the app shows it, and text-only formats print their text", () => {
  assert.deepEqual(formatForText(1234.5, " general ", false, (n) => `<${n}>`), { ok: true, text: "<1234.5>" });
  assert.equal(numberText(5, "abc"), "abc");
});

test("what is not supported says so, instead of guessing", () => {
  for (const format of ["0.00E+00", "0,", "0-0", "#.#.#"]) {
    const r = formatForText(5, format, false, general);
    assert.equal(r.ok, false, format);
    if (!r.ok) assert.match(r.reason, /does not support/);
  }
  assert.equal(formatForText(1e16, "0", false, general).ok, false, "a number too large for the digits it can place");
});

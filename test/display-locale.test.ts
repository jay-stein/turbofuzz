import { test } from "node:test";
import assert from "node:assert/strict";
import { setNumberLocale, suggestNumberFormat } from "../src/data/display-locale.js";

// Built before any choice is made, as the module-level formats across the app are.
const early = new Intl.NumberFormat("en", { maximumFractionDigits: 2 });

test("one number format drives every call, including formats built earlier", () => {
  setNumberLocale("en-US");
  assert.equal(early.format(1234567.891), "1,234,567.89");
  assert.equal((1234567.891).toLocaleString("en-GB", { maximumFractionDigits: 2 }), "1,234,567.89");
  setNumberLocale("de-DE");
  assert.equal(early.format(1234567.891), "1.234.567,89");
  assert.equal((1234567.891).toLocaleString(undefined, { maximumFractionDigits: 2 }), "1.234.567,89");
  assert.equal(new Intl.NumberFormat("en").format(1234), "1.234");
  setNumberLocale("en-IN");
  assert.equal((1234567).toLocaleString("en"), "12,34,567");
});

test("a call that names another language on purpose keeps it", () => {
  setNumberLocale("en-US");
  assert.equal((1234.5).toLocaleString("de-DE"), "1.234,5");
});

test("the browser's language suggests an option, never applies it", () => {
  assert.equal(suggestNumberFormat("de"), "de-DE");
  assert.equal(suggestNumberFormat("de-CH"), "de-CH");
  assert.equal(suggestNumberFormat("en-AU"), "en-US");
  assert.equal(suggestNumberFormat("ja-JP"), "");
});

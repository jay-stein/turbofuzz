import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDataset } from "../src/data/build.js";
import { buildCsv, csvEscape } from "../src/worker/csv.js";

test("csvEscape quotes separators, quotes and newlines", () => {
  assert.equal(csvEscape("plain"), "plain");
  assert.equal(csvEscape("a,b"), '"a,b"');
  assert.equal(csvEscape('say "hi"'), '"say ""hi"""');
  assert.equal(csvEscape("line1\nline2"), '"line1\nline2"');
  assert.equal(csvEscape("carriage\rreturn"), '"carriage\rreturn"');
});

test("buildCsv writes header and escapes rows", () => {
  const dataset = buildDataset("t", ["name", "note"], [
    ["x,y", 'q"z'],
    ["plain", ""],
  ]);
  const ids = Uint32Array.from([0, 1]);
  const text = buildCsv(dataset, ids, 0, 2, true);
  assert.equal(text, 'name,note\r\n"x,y","q""z"\r\nplain,\r\n');
});

test("buildCsv chunks concatenate cleanly", () => {
  const dataset = buildDataset("t", ["a"], [["1"], ["2"]]);
  const ids = Uint32Array.from([0, 1]);
  const first = buildCsv(dataset, ids, 0, 1, true);
  const second = buildCsv(dataset, ids, 1, 2, false);
  assert.equal(first, "a\r\n1\r\n");
  assert.equal(second, "2\r\n");
  assert.equal(first + second, "a\r\n1\r\n2\r\n");
});

test("exports typed numeric and date values with blanks for missing", () => {
  const dataset = buildDataset("t", ["item_price", "day"], [
    ["$2.39 ", "2024-07-01"],
    ["NULL", "2024-07-02"],
  ]);
  const ids = Uint32Array.from([0, 1]);
  assert.equal(
    buildCsv(dataset, ids, 0, 2, true),
    "item_price,day\r\n2.39,2024-07-01\r\n,2024-07-02\r\n",
  );
});

test("exports european decimals as canonical numbers", () => {
  const dataset = buildDataset("t", ["umsatz"], [["198,72"], ["0,50"]], undefined, "comma");
  const ids = Uint32Array.from([0, 1]);
  assert.equal(buildCsv(dataset, ids, 0, 2, true), "umsatz\r\n198.72\r\n0.5\r\n");
});

test("nullAsBlank controls text null handling", () => {
  const dataset = buildDataset("t", ["city"], [["NULL"], ["Perth"]]);
  const ids = Uint32Array.from([0, 1]);
  assert.equal(
    buildCsv(dataset, ids, 0, 2, true, { nullAsBlank: false }),
    "city\r\nNULL\r\nPerth\r\n",
  );
  assert.equal(
    buildCsv(dataset, ids, 0, 2, true, { nullAsBlank: true }),
    "city\r\n\r\nPerth\r\n",
  );
});

test("escapeFormulas guards formula-like cells but keeps plain numbers", () => {
  const dataset = buildDataset("t", ["email", "amount"], [
    ["=1+1", "-999"],
    ["@SUM(1,1)", "12.5"],
    ["+1+2", "-20"],
    ["-2+3", "7"],
  ]);
  const ids = Uint32Array.from([0, 1, 2, 3]);
  assert.equal(
    buildCsv(dataset, ids, 0, 4, true, { escapeFormulas: true }),
    "email,amount\r\n'=1+1,-999\r\n\"'@SUM(1,1)\",12.5\r\n'+1+2,-20\r\n'-2+3,7\r\n",
  );
  // Off by default: values are exported untouched.
  assert.match(buildCsv(dataset, ids, 0, 4, true), /^email,amount\r\n=1\+1,-999/);
});

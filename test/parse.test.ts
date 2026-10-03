import { test } from "node:test";
import assert from "node:assert/strict";
import { detectDelimiter } from "../src/parse/delimiter.js";
import { parseDelimited } from "../src/parse/parse.js";
import { parseNumber } from "../src/parse/numbers.js";
import { detectDateOrder, parseDate } from "../src/parse/dates.js";

test("detectDelimiter finds common delimiters", () => {
  assert.equal(detectDelimiter("a,b,c\n1,2,3"), ",");
  assert.equal(detectDelimiter("a\tb\tc\n1\t2\t3"), "\t");
  assert.equal(detectDelimiter("a;b;c\n1;2;3"), ";");
  assert.equal(detectDelimiter("a|b|c\n1|2|3"), "|");
});

test("detectDelimiter ignores delimiters inside quotes", () => {
  assert.equal(detectDelimiter('name,notes\n"Smith, John","a,b"'), ",");
});

test("parseDelimited handles headers and quoted fields", () => {
  const table = parseDelimited('name,usage\n"Smith, John","1,234"\n');
  assert.deepEqual(table.headers, ["name", "usage"]);
  assert.deepEqual(table.rows, [["Smith, John", "1,234"]]);
  assert.equal(table.delimiter, ",");
});

test("parseDelimited without headers names columns", () => {
  const table = parseDelimited("1,2\n3,4", { hasHeaders: false });
  assert.deepEqual(table.headers, ["Column 1", "Column 2"]);
  assert.deepEqual(table.rows, [
    ["1", "2"],
    ["3", "4"],
  ]);
});

test("parseDelimited pads and truncates ragged rows", () => {
  const table = parseDelimited("a,b,c\n1,2\n3,4,5,6");
  assert.deepEqual(table.rows, [
    ["1", "2", ""],
    ["3", "4", "5"],
  ]);
});

test("parseNumber handles separators, currency and negatives", () => {
  assert.equal(parseNumber("1,234.5"), 1234.5);
  assert.equal(parseNumber("$1,200"), 1200);
  assert.equal(parseNumber("(500)"), -500);
  assert.equal(parseNumber("12%"), 12);
  assert.equal(parseNumber("-3.5"), -3.5);
  assert.ok(Number.isNaN(parseNumber("abc")));
  assert.ok(Number.isNaN(parseNumber("")));
});

test("parseDate handles ISO, day-first and month-first", () => {
  assert.equal(parseDate("2024-03-05"), Date.UTC(2024, 2, 5));
  assert.equal(parseDate("05/03/2024", "dmy"), Date.UTC(2024, 2, 5));
  assert.equal(parseDate("03/05/2024", "mdy"), Date.UTC(2024, 2, 5));
  assert.ok(Number.isNaN(parseDate("not a date")));
});

test("detectDateOrder infers from unambiguous days", () => {
  assert.equal(detectDateOrder(["13/02/2024", "01/02/2024"]), "dmy");
  assert.equal(detectDateOrder(["02/13/2024", "01/02/2024"]), "mdy");
});

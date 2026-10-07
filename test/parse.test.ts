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

test("detectDelimiter ignores a delimiter-free title row", () => {
  assert.equal(
    detectDelimiter("Notes offered by Prospectus\n\nname,age,amount\nAlice,30,100\nBob,40,200"),
    ",",
  );
  assert.equal(
    detectDelimiter("Annual report 2013\nid;city;value\n1;Perth;10\n2;Sydney;20"),
    ";",
  );
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
  assert.deepEqual(table.ragged, { paddedRows: 1, extraCellRows: 1, extraCells: 1 });
});

test("parseDelimited can keep raw row lengths for raggedness checks", () => {
  const table = parseDelimited("a,b,c\n1,2\n3,4,5,6", { normalizeRows: false });
  assert.deepEqual(table.rows, [
    ["1", "2"],
    ["3", "4", "5", "6"],
  ]);
  assert.deepEqual(table.ragged, { paddedRows: 1, extraCellRows: 1, extraCells: 1 });
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

test("parseNumber fast path agrees with plain and edge values", () => {
  assert.equal(parseNumber("123"), 123);
  assert.equal(parseNumber("-4.5"), -4.5);
  assert.equal(parseNumber("+7"), 7);
  assert.equal(parseNumber(".5"), 0.5);
  assert.equal(parseNumber("5."), 5);
  assert.equal(parseNumber("1e5"), 100000);
  assert.equal(parseNumber("00"), 0);
  assert.equal(parseNumber("1 234"), 1234);
  assert.equal(parseNumber(" 42 "), 42);
  assert.ok(Number.isNaN(parseNumber("0x10")));
  assert.ok(Number.isNaN(parseNumber("0b101")));
  assert.ok(Number.isNaN(parseNumber("Infinity")));
  assert.ok(Number.isNaN(parseNumber("-")));
  assert.ok(Number.isNaN(parseNumber("1..2")));
});

test("parseDate handles ISO, day-first and month-first", () => {
  assert.equal(parseDate("2024-03-05"), Date.UTC(2024, 2, 5));
  assert.equal(parseDate("05/03/2024", "dmy"), Date.UTC(2024, 2, 5));
  assert.equal(parseDate("03/05/2024", "mdy"), Date.UTC(2024, 2, 5));
  assert.ok(Number.isNaN(parseDate("not a date")));
});

test("parseDate normalises month-name dates to UTC", () => {
  assert.equal(parseDate("1 Mar 2024", "dmy"), Date.UTC(2024, 2, 1));
  assert.equal(parseDate("March 1, 2024", "dmy"), Date.UTC(2024, 2, 1));
});

test("detectDateOrder infers from unambiguous days", () => {
  assert.equal(detectDateOrder(["13/02/2024", "01/02/2024"]), "dmy");
  assert.equal(detectDateOrder(["02/13/2024", "01/02/2024"]), "mdy");
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { detectDelimiter } from "../src/parse/delimiter.js";
import { parseDelimited, sameHeaderRow } from "../src/parse/parse.js";
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

test("parseDate accepts month-name formats", () => {
  assert.equal(parseDate("15 Mar 2024"), Date.UTC(2024, 2, 15));
  assert.equal(parseDate("Mar 15, 2024"), Date.UTC(2024, 2, 15));
  assert.equal(parseDate("March 15 2024"), Date.UTC(2024, 2, 15));
  assert.equal(parseDate("Tue, 15 Mar 2024"), Date.UTC(2024, 2, 15));
  assert.equal(parseDate("1st March 2024"), Date.UTC(2024, 2, 1));
  assert.equal(parseDate("15 Mar 2024 14:35"), Date.UTC(2024, 2, 15, 14, 35));
  assert.equal(parseDate("Mar 15, 2024 2:35 PM"), Date.UTC(2024, 2, 15, 14, 35));
});

test("parseDate rejects ID-like and bare-number strings", () => {
  assert.ok(Number.isNaN(parseDate("ORD-00001")));
  assert.ok(Number.isNaN(parseDate("INV-1001")));
  assert.ok(Number.isNaN(parseDate("Room 12")));
  assert.ok(Number.isNaN(parseDate("2024")));
});

test("detectDateOrder infers from unambiguous days", () => {
  assert.equal(detectDateOrder(["13/02/2024", "01/02/2024"]), "dmy");
  assert.equal(detectDateOrder(["02/13/2024", "01/02/2024"]), "mdy");
});

test("sameHeaderRow folds case and whitespace for the Import all check", () => {
  assert.equal(sameHeaderRow(["name", "total"], [" Name ", "TOTAL"]), true);
  assert.equal(sameHeaderRow(["name", "total"], ["name", "amount"]), false);
  assert.equal(sameHeaderRow(["name"], ["name", "total"]), false);
  assert.equal(sameHeaderRow([], []), true);
});

test("a CRLF header over LF rows still splits into rows", () => {
  const parsed = parseDelimited("id,site,volume\r\n1,10001,3\n2,10001,1\n3,10002,7\n");
  assert.deepEqual(parsed.headers, ["id", "site", "volume"]);
  assert.deepEqual(parsed.rows, [["1", "10001", "3"], ["2", "10001", "1"], ["3", "10002", "7"]]);
});

test("CRLF rows with a line break inside a quoted cell keep it in the cell", () => {
  const parsed = parseDelimited('id,note\r\n1,"two\nlines"\r\n2,plain\r\n');
  assert.deepEqual(parsed.rows, [["1", "two\nlines"], ["2", "plain"]]);
});

test("line endings that change part way through a big file still split into rows", () => {
  const start = "x,y\r\n" + "1,2\r\n".repeat(300_000);
  const parsed = parseDelimited(start + "5,6\n7,8\n");
  assert.equal(parsed.rows.length, 300_002);
  assert.deepEqual(parsed.rows.at(-1), ["7", "8"]);
});

test("a quote that never closes is dropped, the rows after it read normally, and its line is reported", () => {
  const parsed = parseDelimited('a,b\n1,"ok, fine"\n2,"oops\n3,4\n5,"x""y"\n');
  assert.deepEqual(parsed.rows, [["1", "ok, fine"], ["2", "oops"], ["3", "4"], ["5", 'x"y']]);
  assert.deepEqual(parsed.ragged.strayQuoteLines, [3]);
  assert.equal(parseDelimited('a,b\n1,"fine"\n').ragged.strayQuoteLines, undefined);
});

test("a stray quote before a later quoted cell is repaired, and so is an inches mark that opens a cell", () => {
  const parsed = parseDelimited('a,b\n1,"oops\n2,3\n4,"five, six"\n6,7\n');
  assert.deepEqual(parsed.rows, [["1", "oops"], ["2", "3"], ["4", "five, six"], ["6", "7"]]);
  assert.deepEqual(parsed.ragged.strayQuoteLines, [2]);
  // Papaparse would read everything after "5" into one cell.
  const inches = parseDelimited('a,b\n1,"5" long\n2,3\n');
  assert.deepEqual(inches.rows, [["1", '5" long'], ["2", "3"]]);
  assert.deepEqual(inches.ragged.strayQuoteLines, [2]);
});

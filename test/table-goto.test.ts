import { test } from "node:test";
import assert from "node:assert/strict";
import { parseGoTo } from "../src/ui/table-goto.js";
import { orderText } from "../src/ui/table-nav.js";

const columns = ["Customer Name", "Suburb", "Annual Usage", "Status"];

test("rows by position, from the end, and a share of the way down", () => {
  assert.deepEqual(parseGoTo("250", 12480, columns), { kind: "row", position: 249 });
  assert.deepEqual(parseGoTo("12,480", 12480, columns), { kind: "row", position: 12479 });
  assert.deepEqual(parseGoTo("-1", 12480, columns), { kind: "row", position: 12479 });
  assert.deepEqual(parseGoTo("-10", 12480, columns), { kind: "row", position: 12470 });
  assert.deepEqual(parseGoTo("50%", 101, columns), { kind: "row", position: 50 });
  assert.deepEqual(parseGoTo("0%", 101, columns), { kind: "row", position: 0 });
  assert.deepEqual(parseGoTo("100 %", 101, columns), { kind: "row", position: 100 });
  assert.deepEqual(parseGoTo("top", 10, columns), { kind: "row", position: 0 });
  assert.deepEqual(parseGoTo("Bottom", 10, columns), { kind: "row", position: 9 });
});

test("rows by their number in the file", () => {
  assert.deepEqual(parseGoTo("file 1234", 50, columns), { kind: "file", row: 1233 });
  assert.deepEqual(parseGoTo("File row #1,234", 50, columns), { kind: "file", row: 1233 });
  assert.equal(parseGoTo("file 0", 50, columns).kind, "error");
});

test("columns by name, exactly or close enough", () => {
  assert.deepEqual(parseGoTo("suburb", 10, columns), { kind: "column", index: 1 });
  assert.deepEqual(parseGoTo("anual usage", 10, columns), { kind: "column", index: 2 });
  assert.deepEqual(parseGoTo("cust", 10, columns), { kind: "column", index: 0 });
});

test("what cannot be reached is said plainly", () => {
  assert.match((parseGoTo("0", 10, columns) as { message: string }).message, /start at 1/);
  assert.match((parseGoTo("11", 10, columns) as { message: string }).message, /10 rows/);
  assert.match((parseGoTo("-11", 10, columns) as { message: string }).message, /10 rows/);
  assert.match((parseGoTo("150%", 10, columns) as { message: string }).message, /0% to 100%/);
  assert.match((parseGoTo("5", 0, columns) as { message: string }).message, /filters leave none/);
  assert.match((parseGoTo("", 10, columns) as { message: string }).message, /row number/);
  assert.match((parseGoTo("zzzz", 10, columns) as { message: string }).message, /No row or column/);
});

test("the order reads as words", () => {
  assert.equal(orderText({ column: null, dir: 1, reversed: false, shuffled: false }), "file order");
  assert.equal(orderText({ column: null, dir: 1, reversed: true, shuffled: false }), "file order, reversed");
  assert.equal(orderText({ column: "Amount", dir: -1, reversed: false, shuffled: false }), "sorted by Amount ↓");
  assert.equal(orderText({ column: "Amount", dir: 1, reversed: true, shuffled: false }), "sorted by Amount ↑, reversed");
  assert.equal(orderText({ column: null, dir: 1, reversed: false, shuffled: true }), "shuffled");
});

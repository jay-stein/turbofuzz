import { test } from "node:test";
import assert from "node:assert/strict";
import { detectTable } from "../src/parse/header-detect.js";

test("skips title rows and finds a single header row", () => {
  const grid = [
    ["DOMESTIC AIRLINES"],
    [""],
    ["Monthly totals"],
    ["Month", "Passengers", "RPK"],
    ["Jul-04", "3,458,588", "3,954,548,750"],
    ["Aug-04", "3,428,529", "3,849,417,952"],
  ];

  const detected = detectTable(grid);
  assert.equal(detected.skipRows, 3);
  assert.equal(detected.headerRows, 1);
  assert.deepEqual(detected.headers, ["Month", "Passengers", "RPK"]);
  assert.equal(detected.rows.length, 2);
  assert.equal(detected.title, "DOMESTIC AIRLINES");
});

test("merges a two-level header when numeric data follows", () => {
  const grid = [
    ["DOMESTIC MONTHLY REPORT"],
    ["CITY PAIR STATISTICS"],
    ["Monthly totals"],
    ["City Pair Route", "", "Year", "Month", "Revenue", "Aircraft"],
    ["", "", "", "", "Passengers", "Trips"],
    ["ABX", "SYD", "2004", "7", "12,720", "430"],
    ["ABX", "SYD", "2004", "8", "13,507", "445"],
  ];

  const detected = detectTable(grid);
  assert.equal(detected.skipRows, 3);
  assert.equal(detected.headerRows, 2);
  assert.deepEqual(detected.headers, [
    "City Pair Route",
    "",
    "Year",
    "Month",
    "Revenue Passengers",
    "Aircraft Trips",
  ]);
  assert.equal(detected.rows.length, 2);
});

test("keeps a single header for all-text tables", () => {
  const grid = [
    ["Name", "City"],
    ["Alice", "Melbourne"],
    ["Bob", "Sydney"],
  ];

  const detected = detectTable(grid);
  assert.equal(detected.skipRows, 0);
  assert.equal(detected.headerRows, 1);
  assert.deepEqual(detected.headers, ["Name", "City"]);
  assert.equal(detected.rows.length, 2);
});

test("an all-numeric table is header-less and keeps its first record", () => {
  const grid = [
    ["1", "2"],
    ["3", "4"],
    ["5", "6"],
  ];

  const detected = detectTable(grid);
  assert.equal(detected.skipRows, 0);
  assert.equal(detected.headerRows, 0);
  assert.deepEqual(detected.headers, ["Column 1", "Column 2"]);
  assert.equal(detected.rows.length, 3);
  assert.deepEqual(detected.rows[0], ["1", "2"]);
});

test("falls back to the first non-empty row when nothing looks like a header", () => {
  const grid = [
    ["red", "blue"],
    ["red", "green"],
    ["blue", "green"],
  ];

  const detected = detectTable(grid);
  assert.equal(detected.skipRows, 0);
  assert.equal(detected.headerRows, 1);
  assert.deepEqual(detected.headers, ["red", "blue"]);
});

test("de-duplicates values repeated across header levels", () => {
  const grid = [
    ["Region", "Total"],
    ["Region", "Q1"],
    ["North", "10"],
    ["South", "20"],
  ];

  const detected = detectTable(grid);
  assert.equal(detected.headerRows, 2);
  assert.deepEqual(detected.headers, ["Region", "Total Q1"]);
});

test("handles an empty grid", () => {
  const detected = detectTable([]);
  assert.equal(detected.headerRows, 0);
  assert.deepEqual(detected.rows, []);
});

test("keeps a trailing blank-header column that data populates", () => {
  // The last column has no header but every row has a value; a middle column
  // is empty, so the populated-cell count equals the header count (17 vs 17
  // in the torture fixture). Width must follow the column extent, not the
  // populated count, or the last column is silently dropped.
  const grid = [
    ["id", "name", "legacy", ""],
    ["1", "Alice", "", "x"],
    ["2", "Bob", "", "x"],
  ];

  const detected = detectTable(grid);
  assert.deepEqual(detected.headers, ["id", "name", "legacy", ""]);
  assert.equal(detected.rows[0].length, 4);
});

test("a user layout overrides the automatic guess", () => {
  const grid = [
    ["Quarterly report", "", ""],
    ["Prepared by finance", "", ""],
    ["Region", "Sales", "Units"],
    ["North", "10", "2"],
    ["South", "20", "3"],
  ];
  const auto = detectTable(grid);
  assert.deepEqual(auto.headers, ["Region", "Sales", "Units"]);

  const manual = detectTable(grid, { skipRows: 1, headerRows: 2 });
  assert.equal(manual.skipRows, 1);
  assert.equal(manual.headerRows, 2);
  assert.equal(manual.rows.length, 2);
  assert.equal(manual.headers.length, 3);

  const none = detectTable(grid, { skipRows: 3, headerRows: 0 });
  assert.deepEqual(none.headers, ["Column 1", "Column 2", "Column 3"]);
  assert.equal(none.rows.length, 2);

  const clamped = detectTable(grid, { skipRows: 99, headerRows: 1 });
  assert.equal(clamped.rows.length, 0);
});

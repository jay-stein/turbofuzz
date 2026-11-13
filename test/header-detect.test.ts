import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

const statcan = (): string[][] => [
  ["Usual hours worked by industry, monthly 1 2"],
  ["Frequency: Monthly"],
  [""],
  ["Geography 3", "Canada", "", "", "", ""],
  ["Gender 5 6", "Total - Gender", "", "", "", ""],
  ["Industry 8", "June 2026", "July 2026", "August 2026", "September 2026", "October 2026"],
  ["", "Hours", "", "", "", ""],
  ["Total employed, all industries 9", "35.8", "36.0", "36.0", "35.6", "35.4"],
  ["Agriculture 11", "42.7", "42.3", "41.9", "42.4", "42.6"],
  ["Public administration", "37.1", "37.1", "37.3", "36.7", "36.6"],
  [""],
  [""],
  ["Footnotes:"],
  ["1", "Estimates below a threshold are suppressed."],
  ["2", 'Caution when "comparing", over time', "1,500", "x"],
  [""],
  ["How to cite: Statistics Canada. Table 14-10-0034-01"],
  ["https://www150.statcan.gc.ca/t1/tbl1/en/tv.action?pid=1410003401"],
];

test("metadata lines are not header levels, a units line is skipped, the footnotes are cut", () => {
  const detected = detectTable(statcan());
  assert.equal(detected.skipRows, 5);
  assert.equal(detected.headerRows, 1);
  assert.equal(detected.skipAfter, 1);
  assert.deepEqual(detected.headers, [
    "Industry 8",
    "June 2026",
    "July 2026",
    "August 2026",
    "September 2026",
    "October 2026",
  ]);
  assert.equal(detected.rows.length, 3);
  assert.equal(detected.rows[2][0], "Public administration");
  assert.ok(detected.footerRows >= 4);
});

test("a block after a blank row with the table's columns still filled is kept", () => {
  const grid = [
    ["Region", "Sales", "Units"],
    ["North", "10", "2"],
    ["", "", ""],
    ["South", "20", "3"],
    ["East", "30", "4"],
  ];
  assert.equal(detectTable(grid).rows.length, 4);
});

test("a lone sparse last record is kept when nothing marks it as a footer", () => {
  const grid = [
    ["Region", "Sales", "Units", "Share"],
    ["North", "10", "2", "5"],
    ["South", "20", "3", "6"],
    ["Other", "", "", ""],
  ];
  const detected = detectTable(grid);
  assert.equal(detected.rows.length, 3);
  assert.equal(detected.footerRows, 0);
});

test("a Source line after the data ends the table without a blank row", () => {
  const grid = [
    ["Region", "Sales", "Units", "Share"],
    ["North", "10", "2", "5"],
    ["South", "20", "3", "6"],
    ["Source: the survey"],
  ];
  const detected = detectTable(grid);
  assert.equal(detected.rows.length, 2);
  assert.equal(detected.footerRows, 1);
});

test("the end of the data can be set by hand", () => {
  const grid = statcan();
  const base = { skipRows: 5, headerRows: 1, skipAfter: 1 };
  assert.equal(detectTable(grid, { ...base, dataEnd: "file" }).rows.length, 11);
  assert.equal(detectTable(grid, { ...base, dataEnd: "blank" }).rows.length, 3);
  // Record numbers count from the top of the file: rows 1-9 leave two data rows.
  assert.equal(detectTable(grid, { ...base, dataEnd: 9 }).rows.length, 2);
  assert.equal(detectTable(grid, { ...base, dataEnd: 2 }).rows.length, 0);
  assert.equal(detectTable(grid, base).rows.length, 3);
});

test("columns can be left out of the table by position, after the header is read", () => {
  const grid = [["Title"], ["id", "name", "notes", "score"], ["1", "a", "x", "10"], ["2", "b", "y", "20"]];
  const t = detectTable(grid, { skipRows: 1, headerRows: 1, skipColumns: [2] });
  assert.deepEqual(t.headers, ["id", "name", "score"]);
  assert.deepEqual(t.rows, [["1", "a", "10"], ["2", "b", "20"]]);
  assert.deepEqual(detectTable(grid, { skipRows: 1, headerRows: 1 }).headers, ["id", "name", "notes", "score"]);
});

import { statedMissingCodes } from "../src/parse/header-detect.js";

test("a code the file's own notes say means missing is read from the rows above the table", () => {
  assert.deepEqual(statedMissingCodes([["Note: A value of '-9' is used for a missing/unknown value."]]), ["-9"]);
  assert.deepEqual(statedMissingCodes([["999 = unknown"], ["Missing values are coded as -99"]]).sort(), ["-99", "999"]);
  assert.deepEqual(statedMissingCodes([["Australian Road Deaths Database"], ["(Data current to September 2026)"]]), []);
});

test("trailing Total rows are left out as summary rows, not data", () => {
  const card = detectTable([
    ["Txn ID", "Date", "Merchant", "Amount"],
    ["TXN1", "2024-01-01", "Tesco", "-18.46"],
    ["TXN2", "2024-01-02", "Uber", "-8.87"],
    ["TOTAL", "", "", "-27.33"],
  ]);
  assert.equal(card.rows.length, 2);
  assert.equal(card.footerRows, 1);

  const budget = detectTable([
    ["Dept", "Jan", "Feb"],
    ["Sales", "100", "120"],
    ["Ops", "80", "90"],
    [],
    ["Grand total:", "180", "210"],
  ]);
  assert.equal(budget.rows.length, 2);

  const lookalike = detectTable([
    ["Supplier", "Amount"],
    ["Shell", "10"],
    ["TotalEnergies", "12"],
  ]);
  assert.equal(lookalike.rows.length, 2);
  assert.equal(lookalike.rows[1][0], "TotalEnergies");
});

test("a two-level header carries the upper label across its merged span, and names stay unique", () => {
  const table = detectTable([
    ["FY2025 Budget vs Actual"],
    [],
    ["", "", "Jan", "", "Feb", ""],
    ["Dept", "Cost centre", "Budget", "Actual", "Budget", "Actual"],
    ["Sales", "CC870", "69,000", "65,957", "49,000", "53,795"],
    ["Ops", "CC542", "118,000", "105,576", "200,000", "192,376"],
  ]);
  assert.deepEqual(table.headers, ["Dept", "Cost centre", "Jan Budget", "Jan Actual", "Feb Budget", "Feb Actual"]);

  const flat = detectTable([
    ["Region", "Actual", "Actual", "Actual 2"],
    ["North", "1", "2", "3"],
    ["South", "4", "5", "6"],
  ]);
  assert.deepEqual(flat.headers, ["Region", "Actual", "Actual 3", "Actual 2"]);
});

test("a record that only looks like a header loses to the real header above it", () => {
  // First 30 lines of the 2026-11-12 card export: title lines, the header, then
  // text-heavy records. Row 17 ("TXN100379, 02/11/2023, BRITISH GAS, -, …") used
  // to win, dropping the real header and 13 transactions.
  const grid = JSON.parse(readFileSync("test/fixtures/card-export-head.json", "utf8")) as string[][];
  const table = detectTable(grid);
  assert.equal(table.headers[0], "Txn ID");
  assert.equal(table.skipRows, 3);
});

test("a merged Excel title spread across the row is not taken as the header", () => {
  const table = detectTable([
    ["Q1 payments", "Q1 payments", "Q1 payments", "Q1 payments"],
    [],
    ["Date", "Payee", "Amount", "Posted"],
    ["2025-01-01", "Payee 1", "-1234.5", "2025-01-01 09:30"],
    ["2025-01-02", "Payee 2", "-2469", "2025-01-02 09:30"],
    ["2025-01-03", "Payee 3", "-3703.5", "2025-01-03 09:30"],
    ["2025-01-04", "Payee 0", "-4938", "2025-01-04 09:30"],
  ]);
  assert.deepEqual(table.headers, ["Date", "Payee", "Amount", "Posted"]);
  assert.equal(table.rows.length, 4);
});

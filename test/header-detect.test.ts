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

test("a table whose every row starts with Total is data, not a footer", () => {
  const grid: string[][] = [["Concept", "Province", "Period", "Value"]];
  for (let i = 0; i < 40; i++) grid.push(["Total Nacional", `P${i % 5}`, `2024M${(i % 12) + 1}`, String(100 + i)]);
  assert.equal(detectTable(grid).rows.length, 40);
});

test("a short trailing Total block is still dropped", () => {
  const grid: string[][] = [["Month", "Passengers"]];
  for (let i = 0; i < 12; i++) grid.push([`M${i}`, String(10 + i)]);
  grid.push(["Total", "999"]);
  const detected = detectTable(grid);
  assert.equal(detected.rows.length, 12);
  assert.equal(detected.footerRows, 1);
});

// Layouts from real published files (World Bank, Eurostat, RBA, ONS, US Census, EIA, AER), cut down to their shape.

test("a header of years is the header, under title rows (World Bank download)", () => {
  const years = Array.from({ length: 8 }, (_, i) => String(1960 + i));
  const grid = [
    ["Data Source", "World Development Indicators", ""],
    [""],
    ["Last Updated Date", "2026-11-11", ""],
    [""],
    ["Country Name", "Country Code", ...years],
    ["Aruba", "ABW", "54922", "55578", "56320", "57002", "57619", "58190", "58694", "58990"],
    ["Afghanistan", "AFG", "9035043", "9214083", "9404406", "9604487", "9814318", "10036008", "10266395", "10505959"],
    ["Angola", "AGO", "5231654", "5301583", "5354310", "5408320", "5464187", "5521981", "5581386", "5641807"],
  ];
  const t = detectTable(grid);
  assert.equal(t.skipRows, 4);
  assert.deepEqual(t.headers.slice(0, 3), ["Country Name", "Country Code", "1960"]);
  assert.equal(t.rows.length, 3);
});

test("a first row of years is a header, not a header-less record (Eurostat TSV)", () => {
  const grid = [
    ["geo\\TIME_PERIOD", "2019 ", "2020 ", "2021 ", "2022 "],
    ["AL", "2862427 ", "2845955 ", "2829741 ", "2793592 "],
    ["AT", "8858775 ", "8901064 ", "8932664 ", "8978929 "],
    ["BE", "11455519 ", "11522440 ", "11554767 ", "11617623 "],
  ];
  const t = detectTable(grid);
  assert.equal(t.headerRows, 1);
  assert.equal(t.headers[1], "2019");
  assert.equal(t.rows.length, 3);
});

test("years repeated in groups under a super-header make a two-level header (AER)", () => {
  const grid = [
    ["", "", "Customers", "Customers", "Customers", "Share", "Share", "Share"],
    ["DNSP", "State", "2023", "2024", "2025", "2023", "2024", "2025"],
    ["Ausgrid", "NSW", "1774204", "1783052", "1792704", "0.10", "0.11", "0.13"],
    ["Energex", "QLD", "1535400", "1569750", "1602119", "0.40", "0.41", "0.42"],
    ["Jemena", "VIC", "369331", "374388", "378889", "0.13", "0.15", "0.16"],
  ];
  const t = detectTable(grid);
  assert.equal(t.headerRows, 2);
  assert.equal(t.headers[2], "Customers 2023");
  assert.equal(t.headers[7], "Share 2025");
});

test("a metadata block under the header is skipped, not read as records (RBA, ABS)", () => {
  const grid = [
    ["F1.1 INTEREST RATES AND YIELDS"],
    ["Title", "Cash Rate Target", "Interbank Rate", "BAB 1-month"],
    ["Description", "Cash Rate Target; monthly average", "Interbank Overnight Cash Rate", "1-month BABs/NCDs"],
    ["Frequency", "Monthly", "Monthly", "Monthly"],
    ["Units", "Per cent", "Per cent", "Per cent"],
    ["", "", "", ""],
    ["Source", "RBA", "RBA", "ASX"],
    ["Publication date", "02-Nov-2026", "02-Nov-2026", "02-Nov-2026"],
    ["Series ID", "FIRMMCRT", "FIRMMCRI", "FIRMMBAB30"],
    ["31/01/2011", "4.75", "4.74", "4.89"],
    ["28/02/2011", "4.75", "4.75", "4.92"],
    ["31/03/2011", "4.75", "4.74", "4.91"],
  ];
  const t = detectTable(grid);
  assert.equal(t.skipRows, 1);
  assert.equal(t.headerRows, 1);
  assert.equal(t.skipAfter, 7);
  assert.deepEqual(t.headers, ["Title", "Cash Rate Target", "Interbank Rate", "BAB 1-month"]);
  assert.equal(t.rows.length, 3);
  assert.equal(t.rows[0]![0], "31/01/2011");
});

test("a two-column key/value preamble is skipped before the dated values (ONS time series)", () => {
  const grid = [
    ["Title", "CPIH ANNUAL RATE 00: ALL ITEMS 2015=100"],
    ["CDID", "L55O"],
    ["Source dataset ID", "MM23"],
    ["PreUnit", ""],
    ["Unit", "%"],
    ["Release date", "18-11-2026"],
    ["Important notes", ""],
    ["1989", "5.7"],
    ["1990", "8.0"],
    ["1991", "7.5"],
  ];
  const t = detectTable(grid);
  assert.equal(t.skipAfter, 6);
  assert.equal(t.rows.length, 3);
  assert.equal(t.headers[1], "CPIH ANNUAL RATE 00: ALL ITEMS 2015=100");
});

test("merged titles stay out of a super-header over a row of years (US Census)", () => {
  const title = Array.from({ length: 5 }, () => "Annual Estimates of the Resident Population");
  const grid = [
    title,
    title,
    ["Geographic Area", "Base", "Population Estimate", "Population Estimate", "Population Estimate"],
    ["Geographic Area", "Base", "2021", "2022", "2023"],
    ["United States", "331464948", "332048977", "333271411", "334914895"],
    ["Northeast", "57614141", "57243423", "57026847", "56983517"],
    ["Midwest", "68987296", "68850246", "68783028", "68909283"],
  ];
  const t = detectTable(grid);
  assert.equal(t.skipRows, 2);
  assert.equal(t.headerRows, 2);
  assert.equal(t.headers[2], "Population Estimate 2021");
  assert.equal(t.rows.length, 3);
});

test("label rows above the header that span nothing are skipped, not joined (EIA)", () => {
  const grid = [
    ["Back to Contents", "Data 1: Cushing, OK WTI Spot Price"],
    ["Sourcekey", "RWTC"],
    ["Date", "Cushing, OK WTI Spot Price FOB (Dollars per Barrel)"],
    ["Jan-1986", "22.93"],
    ["Feb-1986", "15.46"],
    ["Mar-1986", "12.61"],
  ];
  const t = detectTable(grid);
  assert.equal(t.skipRows, 2);
  assert.equal(t.headerRows, 1);
  assert.deepEqual(t.headers, ["Date", "Cushing, OK WTI Spot Price FOB (Dollars per Barrel)"]);
});

test("a table under a chart-sized gap is found, and a stray far cell does not empty it (AER report sheet)", () => {
  const grid: string[][] = [["Export service customers"]];
  for (let i = 0; i < 30; i++) grid.push([""]);
  grid.push(["DNSP", "State", "2023", "2024", "2025"]);
  grid.push(["Ausgrid", "NSW", "1774204", "1783052", "1792704"]);
  grid.push(["Energex", "QLD", "1535400", "1569750", "1602119"]);
  grid.push(["Jemena", "VIC", "369331", "374388", "378889"]);
  grid.push(["", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "x"]);
  const t = detectTable(grid);
  assert.equal(t.skipRows, 31);
  assert.equal(t.headers[0], "DNSP");
  assert.ok(t.rows.length >= 3, `kept ${t.rows.length} rows`);
});

test("a row of column numbers and a menu of links above the header are not the header (AER tariff sheet)", () => {
  const grid = [
    ["", "2026-27 pricing"],
    ["", "", "", "Ausgrid", "", "AusNet", "", "CitiPower"],
    ["", "", "", "", "Evoenergy", "", "Jemena", ""],
    ["", "", "", "0", "1", "2", "3", "4", "5"],
    ["", "Tariff", "Code", "Fixed charge", "Energy charge", "Peak charge", "Off-peak charge", "Demand", "Capacity"],
    ["", "", "", "cents/day", "cents/kWh", "cents/kWh", "cents/kWh", "cents/kW", "cents/kVA"],
    ["", "Residential flat", "EA010", "50.86", "12.70", "0", "0", "0", "0"],
    ["", "Residential TOU", "EA025", "63.23", "0", "32.52", "5.36", "0", "0"],
    ["", "Small business", "EA050", "202.31", "11.33", "0", "0", "0", "0"],
  ];
  const t = detectTable(grid);
  assert.equal(t.skipRows, 4);
  assert.equal(t.headers[1], "Tariff");
  assert.equal(t.rows.at(-1)![1], "Small business");
});

test("on a sheet of stacked sections the first section's header is used, not none (AER metering)", () => {
  const section = (name: string): string[][] => [
    ["", `${name} 2026-27 Metering prices`, "", "Tariff code", "Unit", "Charge", "Price"],
    ["", "", "", "", "", "", ""],
    ["", "1", "Residential", "0", "$dollars", "per year", "28.54"],
    ["", "2", "Small business", "0", "$dollars", "per year", "39.54"],
    ["", "3", "Large business", "0", "$dollars", "per year", "57.40"],
    ["", "", "", "", "", "", ""],
  ];
  const grid = [["", "Metering prices"], ["", "", "Ausgrid", "", "AusNet"], ...section("Ausgrid"), ...section("AusNet Services"), ...section("CitiPower")];
  const t = detectTable(grid);
  assert.equal(t.headerRows, 1);
  assert.equal(t.headers[3], "Tariff code");
  assert.equal(t.skipRows, 2);
});

test("a footer cut that would take most of the table is not made unless a Notes or Source line opens it", () => {
  const grid = [["Region", "Sales", "Units", "Share", "", "", "", "", "", "", "", "x"]];
  for (let i = 0; i < 6; i++) grid.push([`R${i}`, String(10 + i), "", "", "", "", "", "", "", "", "", ""]);
  grid.push(["", "", "", "", "", "", "", "", "", "", "", ""]);
  for (let i = 0; i < 6; i++) grid.push([`S${i}`, String(20 + i), "", "", "", "", "", "", "", "", "", ""]);
  const t = detectTable(grid);
  assert.equal(t.rows.filter((row) => row.some((cell) => cell !== "")).length, 12);
});

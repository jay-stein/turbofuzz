import { test } from "node:test";
import assert from "node:assert/strict";
import { unzipSync, strFromU8 } from "fflate";
import { ColumnData } from "../src/data/column.js";
import { pairColumns } from "../src/data/compare/columns.js";
import { changeTables } from "../src/data/compare/export.js";
import { suggestKeys } from "../src/data/compare/keys.js";
import { matchRows } from "../src/data/compare/match.js";
import { buildReport } from "../src/data/compare/report.js";
import { DEFAULT_RULES, compareColumn, type CompareSide } from "../src/data/compare/types.js";
import { exportBaseName, reportHtml, tableCsv } from "../src/ui/compare/compare-export.js";
import type { ReportInput } from "../src/ui/compare/compare-report.js";
import { buildXlsx, columnLetters, sheetName } from "../src/ui/xlsx-writer.js";

function side(name: string, table: Record<string, string[]>): CompareSide {
  const columns = Object.entries(table).map(([column, raw]) => compareColumn(ColumnData.create(column, raw)));
  return { name, rowCount: columns[0]?.raw.length ?? 0, columns };
}
const info = (s: CompareSide) => ({ name: s.name, rowCount: s.rowCount, columns: s.columns.map((c) => ({ name: c.name, type: c.type })) });

const A = side("sept orders.csv", { id: ["1", "2", "3"], code: ["007", "008", "009"], note: ["a", "=SUM(A1)", "c, d"] });
const B = side("oct orders.csv", { id: ["1", "3", "4"], code: ["007", "010", "011"], note: ["a", "c, d", "<b>&"] });

function run() {
  const pairing = pairColumns(A, B);
  const match = matchRows(A, B, pairing, [pairing.pairs[0]!], DEFAULT_RULES);
  const input: ReportInput = {
    setup: { type: "compareSetup", requestId: 0, a: info(A), b: info(B), pairing, keys: suggestKeys(A, B, pairing, DEFAULT_RULES), ms: 1 },
    report: buildReport(A, B, pairing, match),
    ms: 12,
    key: { kind: "pairs", pairs: [0] },
    rules: DEFAULT_RULES,
  };
  return { pairing, match, input, tables: changeTables(A, B, pairing, match, [0]) };
}

test("the changes table has one line per changed cell and one per row only one side has", () => {
  const { tables } = run();
  assert.deepEqual(tables.changes.headers, ["id", "A row", "B row", "status", "column", "value in A", "value in B"]);
  assert.deepEqual(tables.changes.rows, [
    ["2", "2", "", "only in A", "", "", ""],
    ["3", "3", "2", "changed", "code", "009", "010"],
    ["4", "", "3", "only in B", "", "", ""],
  ]);
  assert.equal(tables.truncated, 0);
  const { pairing, match } = run();
  const capped = changeTables(A, B, pairing, match, [0], 1);
  assert.equal(capped.changes.rows.length, 1);
  assert.equal(capped.truncated, 2);
});

test("the CSV escapes formula-like cells and quotes commas, with a BOM for Excel", () => {
  const csv = tableCsv({ headers: ["a", "b"], rows: [["=SUM(A1)", "c, d"], ['say "hi"', "007"]] });
  assert.equal(csv, '﻿a,b\r\n\'=SUM(A1),"c, d"\r\n"say ""hi""",007\r\n');
});

test("the workbook opens as Office Open XML: sheets, bold headers, text kept as text", async () => {
  const bytes = await buildXlsx([
    { name: "Changes", headers: ["code", "n"], rows: [["007", 3], ["<b>&\u0001", ""]] },
    { name: "Only in A?", headers: ["x"], rows: [] },
  ]);
  const files = unzipSync(bytes);
  assert.ok(files["[Content_Types].xml"] !== undefined);
  const workbook = strFromU8(files["xl/workbook.xml"]!);
  assert.match(workbook, /<sheet name="Changes" sheetId="1"/);
  assert.match(workbook, /<sheet name="Only in A" sheetId="2"/, "? is not allowed in a sheet name");
  const sheet = strFromU8(files["xl/worksheets/sheet1.xml"]!);
  assert.match(sheet, /<c r="A1" t="inlineStr" s="1"><is><t xml:space="preserve">code<\/t>/);
  assert.match(sheet, /<c r="A2" t="inlineStr"><is><t xml:space="preserve">007<\/t>/, "leading zeros survive as text");
  assert.match(sheet, /<c r="B2"><v>3<\/v><\/c>/);
  assert.match(sheet, /&lt;b&gt;&amp;<\/t>/, "escaped, and the control character dropped");
  assert.deepEqual([columnLetters(0), columnLetters(25), columnLetters(26), columnLetters(701)], ["A", "Z", "AA", "ZZ"]);
  const taken = new Set<string>();
  assert.deepEqual([sheetName("Data", taken), sheetName("data", taken)], ["Data", "data 2"]);
});

test("the export file name is made from both file names", () => {
  assert.equal(exportBaseName(run().input), "compare_sept_orders_vs_oct_orders");
});

test("the HTML report is one page with the counts and summaries, escaped, and no scripts", () => {
  const { input } = run();
  const html = reportHtml(input, null, new Date("2026-11-08T10:30:00Z"));
  assert.match(html, /^<!doctype html>/);
  assert.match(html, /<h1>sept orders\.csv → oct orders\.csv<\/h1>/);
  assert.match(html, /Matched on key id · extra spaces ignored · compared in 12 ms · made 2026-11-08 10:30 UTC/);
  assert.match(html, /<td>code<\/td><td class="n">1<\/td>/);
  assert.match(html, /009 → 010 ×1/);
  assert.doesNotMatch(html, /<script/i);
  assert.doesNotMatch(html, /<b>&/, "cell values never reach the page unescaped");
});

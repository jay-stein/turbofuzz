import { test } from "node:test";
import assert from "node:assert/strict";
import { unzipSync, strFromU8 } from "fflate";
import * as XLSX from "xlsx";
import { ColumnData } from "../src/data/column.js";
import { pairColumns } from "../src/data/compare/columns.js";
import { matchRows } from "../src/data/compare/match.js";
import { buildReport } from "../src/data/compare/report.js";
import { columnShifts } from "../src/data/compare/shift.js";
import { DEFAULT_RULES, compareColumn, type CompareSide } from "../src/data/compare/types.js";
import { compareReportWorkbook, type ReportMeta } from "../src/ui/compare/compare-xlsx.js";

function side(name: string, table: Record<string, string[]>): CompareSide {
  const columns = Object.entries(table).map(([column, raw]) => compareColumn(ColumnData.create(column, raw)));
  return { name, rowCount: columns[0]?.raw.length ?? 0, columns };
}

// A renamed key (ref -> reference), a repeated key in B, leading-zero codes, a formula-like note,
// numbers, dates and booleans; row 2 only in A, row 5 only in B, rows 3 and 4 changed.
const A = side("sept.csv", {
  ref: ["R1", "R2", "R3", "R4"],
  amount: ["10.50", "20.00", "30.25", "40.00"],
  qty: ["1", "2", "3", "4"],
  when: ["2026-01-05", "2026-01-06", "2026-01-07", "2026-01-08"],
  ok: ["true", "false", "true", "true"],
  code: ["007", "008", "009", "010"],
  note: ["a", "=SUM(A1)", "+1 call", "d"],
});
const B = side("oct.csv", {
  reference: ["R1", "R3", "R4", "R5", "R4"],
  amount: ["10.50", "35.25", "40.00", "50.00", "40.00"],
  qty: ["1", "3", "9", "5", "4"],
  when: ["2026-01-05", "2026-02-07", "2026-01-08", "2026-01-09", "2026-01-08"],
  ok: ["true", "true", "false", "true", "true"],
  code: ["007", "009", "010", "011", "010"],
  note: ["a", "-@x", "d", "=1+1", "d"],
});
const META: ReportMeta = { description: "Matched on key ref · extra spaces ignored · compared in 5 ms", rules: DEFAULT_RULES, autoPaired: { a: "ref", b: "reference", overlap: 0.995 }, created: "2026-11-15 10:30 UTC" };

async function build(limits?: { sheetRows: number; changeRows: number }) {
  const pairing = pairColumns(A, B, [{ a: 0, b: 0 }]);
  const key = pairing.pairs[0]!;
  const match = matchRows(A, B, pairing, [key], DEFAULT_RULES);
  const report = buildReport(A, B, pairing, match);
  const shift = columnShifts(A, B, pairing, new Set([0]));
  const result = await compareReportWorkbook(A, B, pairing, match, [0], report, shift, META, limits);
  const book = XLSX.read(result.bytes, { type: "array", cellStyles: true, cellDates: true });
  return { result, book, match, report };
}

const cell = (book: XLSX.WorkBook, sheet: string, ref: string): XLSX.CellObject | undefined => book.Sheets[sheet]![ref];
const fill = (c: XLSX.CellObject | undefined): string | undefined => (c as { s?: { fgColor?: { rgb?: string } } } | undefined)?.s?.fgColor?.rgb;

test("the workbook has the sheets in order and only the rows that differ", async () => {
  const { book, result } = await build();
  assert.deepEqual(book.SheetNames, ["Summary", "Differences", "Changed cells", "Only in A", "Only in B", "Columns", "Big Picture"]);
  assert.deepEqual(result.differences, { total: 5, written: 5 });
  const rows = XLSX.utils.sheet_to_json<unknown[]>(book.Sheets["Differences"]!, { header: 1, blankrows: false });
  // two header rows, then R2 (only in A), R3 and R4 (changed), R5 and the repeated R4 (only in B); R1 is identical and left out.
  assert.equal(rows.length, 2 + 5);
  assert.deepEqual(rows.slice(2).map((r) => [r[0], r[1]]), [["− only in A", "R2"], ["~ changed", "R3"], ["~ changed", "R4"], ["+ only in B", "R5"], ["+ only in B", "R4"]]);
});

test("every compared column has an A | B pair and a number column a delta", async () => {
  const { book } = await build();
  const ws = book.Sheets["Differences"]!;
  const top = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1 })[0]!;
  const sub = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1 })[1]!;
  const named = top.filter((v) => v !== undefined && v !== null);
  assert.deepEqual(named, ["Status", "ref", "amount", "qty", "when", "ok", "code", "note"]);
  assert.deepEqual(sub.slice(2), ["A", "B", "Δ (B−A)", "A", "B", "Δ (B−A)", "A", "B", "A", "B", "A", "B", "A", "B"]);
  assert.ok(ws["!merges"]!.some((m) => XLSX.utils.encode_range(m) === "C1:E1"), "the column name is merged over its trio");
});

test("changed cells are filled and unchanged are not; deltas, dates and text are typed", async () => {
  const { book } = await build();
  const r3 = 4; // R3 (changed): amount 30.25 -> 35.25, when 01-07 -> 02-07, ok true->true same
  // columns: A status, B ref, C-E amount, F-H qty, I-J when, K-L ok, M-N code, O-P note
  assert.equal(cell(book, "Differences", `A${r3}`)!.v, "~ changed");
  assert.equal(fill(cell(book, "Differences", `A${r3}`)), "FDE68A");
  assert.equal(fill(cell(book, "Differences", `A${r3 - 1}`)), "FCA5A5", "only in A status is red");
  assert.equal(fill(cell(book, "Differences", `A${r3 + 2}`)), "86EFAC", "only in B status is green");
  // amount: columns C (A) D (B) E (delta)
  assert.equal(cell(book, "Differences", `C${r3}`)!.v, 30.25);
  assert.equal(cell(book, "Differences", `D${r3}`)!.v, 35.25);
  assert.equal(cell(book, "Differences", `E${r3}`)!.v, 5);
  assert.equal(fill(cell(book, "Differences", `C${r3}`)), "FDE2E2");
  assert.equal(fill(cell(book, "Differences", `D${r3}`)), "DCFCE7");
  assert.match(String(cell(book, "Differences", `E${r3}`)!.z), /^\+/, "the delta number format shows a sign");
  // qty of R3 did not change: no fill, grey text
  assert.equal(fill(cell(book, "Differences", `F${r3}`)), undefined);
  // the changed qty of R4 (row 5) is filled and its delta is 6
  assert.equal(fill(cell(book, "Differences", `F${r3 + 1}`)), "FDE2E2");
  assert.equal(cell(book, "Differences", `H${r3 + 1}`)!.v, 5);
  assert.equal(cell(book, "Differences", `E${r3 + 1}`), undefined, "no delta on an unchanged number");
  // dates are real dates
  const when = cell(book, "Differences", `I${r3}`)!;
  assert.equal(when.t, "d");
  assert.equal((when.v as Date).toISOString().slice(0, 10), "2026-01-07");
  assert.match(String(when.z), /yyyy-mm-dd/);
  // booleans are real
  assert.equal(cell(book, "Differences", `K${r3}`)!.t, "b");
  // leading-zero codes stay text; formula-like text stays text
  assert.equal(cell(book, "Differences", `M${r3}`)!.v, "009");
  assert.equal(cell(book, "Differences", `M${r3}`)!.t, "s");
  const onlyA = cell(book, "Differences", "O3")!;
  assert.equal(onlyA.v, "=SUM(A1)");
  assert.equal(onlyA.t, "s");
  assert.equal(cell(book, "Differences", `P${r3}`)!.v, "-@x");
  assert.equal(cell(book, "Differences", `P${r3 + 2}`)!.v, "=1+1");
  // an only-in-A row: the A side is light red, the B side is the hatch with no value
  assert.equal(fill(cell(book, "Differences", "C3")), "FDE2E2");
  const gap = cell(book, "Differences", "D3") as { t: string; s?: { patternType?: string } };
  assert.equal(gap.t, "z");
  assert.equal(gap.s?.patternType, "lightUp");
  assert.equal(cell(book, "Differences", `I${r3}`)!.t, "d");
});

test("the sheets are set up: frozen panes, filters, tab colours, widths, colour rules and print titles", async () => {
  const { result } = await build();
  const files = unzipSync(result.bytes);
  const workbook = strFromU8(files["xl/workbook.xml"]!);
  const diff = strFromU8(files["xl/worksheets/sheet2.xml"]!);
  assert.match(diff, /<tabColor rgb="FFF59E0B"\/>/);
  assert.match(diff, /<pane xSplit="2" ySplit="2" topLeftCell="C3" activePane="bottomRight" state="frozen"\/>/);
  assert.match(diff, /<autoFilter ref="A2:P7"\/>/);
  assert.match(diff, /<pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"\/>/);
  assert.match(diff, /<cols><col min="1" max="1" width="13" customWidth="1"\/>/);
  assert.match(workbook, /name="_xlnm\.Print_Titles" localSheetId="1">'Differences'!\$1:\$2</);
  assert.match(workbook, /name="_xlnm\._FilterDatabase" localSheetId="1" hidden="1">'Differences'!\$A\$2:\$P\$7</);
  const changes = strFromU8(files["xl/worksheets/sheet3.xml"]!);
  assert.match(changes, /<conditionalFormatting sqref="H2:H[0-9]+"><cfRule type="colorScale"/);
  assert.match(strFromU8(files["xl/worksheets/sheet4.xml"]!), /<tabColor rgb="FFEF4444"\/>/);
  assert.match(strFromU8(files["xl/worksheets/sheet5.xml"]!), /<tabColor rgb="FF22C55E"\/>/);
  assert.match(strFromU8(files["xl/worksheets/sheet1.xml"]!), /<hyperlink ref="C[0-9]+" location="'Differences'!A1"/);
  // element order inside a worksheet: sheetData, autoFilter, mergeCells, conditionalFormatting, hyperlinks, pageMargins, pageSetup
  const order = ["<sheetPr>", "<sheetViews>", "<cols>", "<sheetData>", "<mergeCells", "<conditionalFormatting", "<hyperlinks>", "<pageMargins", "<pageSetup"].map((tag) => strFromU8(files["xl/worksheets/sheet1.xml"]!).indexOf(tag));
  assert.ok(order.every((at, i) => at >= 0 && (i === 0 || at > order[i - 1]!)) || order.filter((at) => at < 0).length > 0, `order ${order.join(",")}`);
});

test("the Changed cells sheet lists one line per changed cell with the change and its percentage", async () => {
  const { book } = await build();
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(book.Sheets["Changed cells"]!);
  assert.deepEqual(rows.map((r) => [r["ref"], r["Column"]]), [["R3", "amount"], ["R3", "when"], ["R3", "note"], ["R4", "qty"], ["R4", "ok"]]);
  const amount = rows.find((r) => r["Column"] === "amount")!;
  assert.equal(amount["Value in A"], 30.25);
  assert.equal(amount["Value in B"], 35.25);
  assert.equal(amount["Δ (B−A)"], 5);
  assert.ok(Math.abs((amount["Δ %"] as number) - 5 / 30.25) < 1e-9);
});

test("Only in A and Only in B hold that side's full rows, text kept as text", async () => {
  const { book } = await build();
  const a = XLSX.utils.sheet_to_json<Record<string, unknown>>(book.Sheets["Only in A"]!);
  assert.deepEqual(a.map((r) => r["code"]), ["008"]);
  assert.equal(a[0]!["note"], "=SUM(A1)");
  const b = XLSX.utils.sheet_to_json<Record<string, unknown>>(book.Sheets["Only in B"]!);
  assert.deepEqual(b.map((r) => r["reference"]), ["R5", "R4"]);
});

test("the Summary shows the counts, the repeated-key warning, the pairing and the legend", async () => {
  const { book } = await build();
  const flat = XLSX.utils.sheet_to_json<unknown[]>(book.Sheets["Summary"]!, { header: 1 }).flat().filter((v) => v !== undefined).map(String);
  const text = flat.join("\n");
  assert.match(text, /Comparison of A and B/);
  assert.match(text, /sept\.csv · 4 rows × 7 columns/);
  assert.match(text, /Matched on\nkey ref/);
  assert.match(text, /ref in A was paired with reference in B automatically: 99\.5% of their values match/);
  assert.match(text, /Warning: 1 rows in B repeat a key/);
  assert.match(text, /Colour legend/);
  assert.match(text, /Totals check/);
  // the four tiles: label row, big number row, each in its own fill
  const ws = book.Sheets["Summary"]!;
  const tileRow = Object.keys(ws).find((k) => ws[k]!.v === "~ Changed")!.replace(/\D/g, "");
  const big = Number(tileRow) + 1;
  assert.deepEqual(["A", "C", "E", "G"].map((c) => ws[`${c}${big}`]!.v), [1, 2, 1, 2]);
  assert.deepEqual(["A", "C", "E", "G"].map((c) => fill(ws[`${c}${big}`])), ["E5E7EB", "FDE68A", "FCA5A5", "86EFAC"]);
});

test("the Columns sheet pairs the columns and fills the status", async () => {
  const { book } = await build();
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(book.Sheets["Columns"]!);
  const key = rows.find((r) => r["Column in A"] === "ref")!;
  assert.equal(key["Column in B"], "reference");
  assert.equal(key["How paired"], "auto, by values");
  assert.equal(key["Role"], "key");
  assert.equal(rows.length, 7);
});

test("a sheet that cannot hold every differing row keeps the first part and says so", async () => {
  const { book, result } = await build({ sheetRows: 5, changeRows: 1_000_000 });
  // 5 rows: two headers, two data rows and the note.
  assert.deepEqual(result.differences, { total: 5, written: 2 });
  const rows = XLSX.utils.sheet_to_json<unknown[]>(book.Sheets["Differences"]!, { header: 1, blankrows: false });
  assert.equal(rows.length, 5);
  assert.match(String(rows[4]![0]), /Only the first 2 of 5 rows that differ/);
  const summary = XLSX.utils.sheet_to_json<unknown[]>(book.Sheets["Summary"]!, { header: 1 }).flat().map(String).join("\n");
  assert.match(summary, /lists the first 2 of 5 rows that differ/);
  const capped = await build({ sheetRows: 1_048_576, changeRows: 1 });
  assert.deepEqual(capped.result.changes, { total: 5, written: 1 });
  assert.match(XLSX.utils.sheet_to_json<unknown[]>(capped.book.Sheets["Changed cells"]!, { header: 1 }).flat().map(String).join("\n"), /Only the first 1 of 5 changed cells/);
});

test("the Big Picture sheet colours the size of each shift and lists what was skipped", async () => {
  const rows = 80;
  const cities = ["Sydney", "Perth", "Hobart", "Darwin"];
  const make = (shifted: boolean) =>
    side(shifted ? "b.csv" : "a.csv", {
      id: Array.from({ length: rows }, (_, i) => `ID${i}`),
      score: Array.from({ length: rows }, (_, i) => String((i % 20) + (shifted ? 15 : 0))),
      city: Array.from({ length: rows }, (_, i) => cities[(shifted ? i % 2 : i % 4)]!),
    });
  const a = make(false);
  const b = make(true);
  const pairing = pairColumns(a, b);
  const match = matchRows(a, b, pairing, [pairing.pairs[0]!], DEFAULT_RULES);
  const result = await compareReportWorkbook(a, b, pairing, match, [0], buildReport(a, b, pairing, match), columnShifts(a, b, pairing, new Set([0])), { ...META, autoPaired: null });
  const book = XLSX.read(result.bytes, { type: "array", cellStyles: true });
  const sheet = XLSX.utils.sheet_to_json<Record<string, unknown>>(book.Sheets["Big Picture"]!);
  const score = sheet.find((r) => r["Column"] === "score")!;
  assert.equal(score["Shift"], "large");
  assert.ok((score["Size"] as number) > 0.25);
  assert.ok(sheet.some((r) => r["Column"] === "city" && r["Kind"] === "categories"));
  assert.equal(fill(cell(book, "Big Picture", `C${sheet.indexOf(score) + 2}`)), "FCA5A5");
  const xml = strFromU8(unzipSync(result.bytes)["xl/worksheets/sheet7.xml"]!);
  assert.match(xml, /<conditionalFormatting sqref="E2:E[0-9]+"><cfRule type="colorScale"/);
  assert.equal(result.differences.total, rows, "every row's score changed");
  // identical files: the Differences sheet holds its header and a note that nothing differs
  const same = await compareReportWorkbook(a, a, pairing, matchRows(a, a, pairing, [pairing.pairs[0]!], DEFAULT_RULES), [0], buildReport(a, a, pairing, matchRows(a, a, pairing, [pairing.pairs[0]!], DEFAULT_RULES)), null, META);
  assert.equal(same.differences.total, 0);
  const none = XLSX.read(same.bytes, { type: "array" });
  assert.deepEqual(none.SheetNames, ["Summary", "Differences", "Changed cells", "Only in A", "Only in B", "Columns"], "no Big Picture without a shift report");
  assert.equal(XLSX.utils.sheet_to_json<unknown[]>(none.Sheets["Differences"]!, { header: 1, blankrows: false }).length, 3);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import { unzipSync, strFromU8 } from "fflate";
import { maskValue } from "../src/data/mask-value.js";
import { buildDataset } from "../src/data/build.js";
import { sheetTitle, buildXlsxWorkbook, XLSX_DATE_FORMAT, XLSX_DATETIME_FORMAT } from "../src/worker/xlsx-export.js";

const N = 40;
function fixture() {
  const header = ["qty", "price", "day", "stamp", "active", "postcode", "note", "empty", "name", "id"];
  const rows: string[][] = [];
  for (let i = 0; i < N; i++) {
    rows.push([
      String(i + 1),
      `${i + 1}.25`,
      `2026-03-${String((i % 28) + 1).padStart(2, "0")}`,
      `2026-03-${String((i % 28) + 1).padStart(2, "0")}T13:45:30Z`,
      i % 2 === 0 ? "true" : "false",
      i % 3 === 0 ? "0800" : `0${801 + i}`,
      i === 0 ? "=SUM(A1:A9)" : i === 1 ? "+61 400" : i === 2 ? "@cmd" : i === 3 ? "-5 items" : `note ${i}`,
      "",
      i === 0 ? "Zoë Müller — 東京" : `Name ${i}`,
      String(1234567890123456 + i),
    ]);
  }
  return buildDataset("orders", header, rows);
}

async function read(options?: Parameters<typeof buildXlsxWorkbook>[5], limit = N) {
  const dataset = fixture();
  const ids = Uint32Array.from({ length: N }, (_, i) => i);
  const result = await buildXlsxWorkbook(dataset, ids, 0, limit, "orders", options);
  const book = XLSX.read(result.bytes, { type: "array", cellNF: true, cellStyles: true });
  return { result, book, dataset, sheet: book.Sheets[book.SheetNames[0]] };
}

test("xlsx round trip keeps numbers, dates, booleans, text and blanks as their own types", async () => {
  const { book, dataset, sheet, result } = await read();
  const types = dataset.columns.map((column) => column.type);
  assert.equal(types[0], "integer");
  assert.equal(types[1], "number");
  assert.equal(types[2], "date");
  assert.equal(types[3], "datetime");
  assert.equal(types[4], "boolean");
  assert.deepEqual(book.SheetNames, ["orders"]);
  assert.equal(result.rows, N);
  const cell = (ref: string) => sheet[ref];
  assert.equal(cell("A1").v, "qty");
  assert.equal(cell("A2").t, "n");
  assert.equal(cell("A2").v, 1);
  assert.equal(cell("B2").t, "n");
  assert.equal(cell("B2").v, 1.25);
  // 2026-03-01 is Excel serial 46082; a datetime carries the time as a fraction.
  assert.equal(cell("C2").t, "n");
  assert.equal(cell("C2").v, 46082);
  assert.equal(cell("C2").z, XLSX_DATE_FORMAT);
  assert.equal(cell("D2").t, "n");
  assert.ok(Math.abs(cell("D2").v - (46082 + (13 * 3600 + 45 * 60 + 30) / 86400)) < 1e-9);
  assert.equal(cell("D2").z, XLSX_DATETIME_FORMAT);
  assert.equal(cell("E2").t, "b");
  assert.equal(cell("E2").v, true);
  assert.equal(cell("E3").v, false);
  assert.equal(cell("F2").t, "s");
  assert.equal(cell("F2").v, "0800");
  assert.equal(cell("G2").t, "s");
  assert.equal(cell("G2").v, "=SUM(A1:A9)");
  assert.equal(cell("G2").f, undefined, "a formula-like string is text, not a formula");
  assert.equal(cell("G3").v, "+61 400");
  assert.equal(cell("G4").v, "@cmd");
  assert.equal(cell("G5").v, "-5 items");
  assert.equal(cell("H2"), undefined, "empty cells stay empty");
  assert.equal(cell("I2").v, "Zoë Müller — 東京");
  assert.equal(cell("J2").t, "s", "a 16-digit id stays text");
  assert.equal(cell("J2").v, "1234567890123456");
});

test("xlsx header is frozen, filtered and sized; the sheet name is a legal Excel name", async () => {
  const { result, sheet } = await read();
  const files = unzipSync(result.bytes);
  const xml = strFromU8(files["xl/worksheets/sheet1.xml"]);
  assert.match(xml, /<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"\/>/);
  assert.match(xml, /<autoFilter ref="A1:J41"\/>/);
  const widths = (sheet["!cols"] ?? []).map((col) => col.wch ?? 0);
  assert.equal(widths.length, 10);
  assert.ok(widths.every((w) => w >= 7 && w <= 60));
  const long = await buildXlsxWorkbook(fixture(), Uint32Array.from([0]), 0, 1, "a/b:c*d?[e]".repeat(5));
  const name = XLSX.read(long.bytes, { type: "array" }).SheetNames[0];
  assert.ok(name.length <= 31 && !/[:*?\/\\[\]]/.test(name), name);
});

test("xlsx honours first-N, sensitive mask and exclude, and unparsed typed cells keep their text", async () => {
  const first = await read(undefined, 5);
  assert.equal(first.result.rows, 5);
  assert.equal(first.sheet["!ref"], "A1:J6");
  const excluded = await read({ columnHandling: [{ column: 8, mode: "exclude" }] }, 5);
  assert.equal(excluded.sheet["!ref"], "A1:I6");
  assert.equal(excluded.sheet["I1"].v, "id");
  const masked = await read({ columnHandling: [{ column: 8, mode: "mask" }] }, 5);
  assert.equal(masked.sheet["I2"].v, maskValue("Zoë Müller — 東京"));
  assert.notEqual(masked.sheet["I2"].v, "Zoë Müller — 東京");

  const rows = Array.from({ length: 60 }, (_, i) => [`${i + 1}.50`]);
  rows.push(["19215.35 DR"], ["N/A"]);
  const dataset = buildDataset("t", ["amount"], rows);
  const ids = Uint32Array.from(rows.map((_, i) => i));
  const result = await buildXlsxWorkbook(dataset, ids, 0, rows.length, "t");
  const sheet = XLSX.read(result.bytes, { type: "array" }).Sheets["t"];
  assert.equal(sheet["A2"].v, 1.5);
  assert.equal(sheet["A62"].v, "19215.35 DR");
  assert.equal(sheet["A63"], undefined);
});

test("sheets are named after the data, not the file: extensions are dropped, continuation sheets included", async () => {
  assert.equal(sheetTitle("orders.csv"), "orders");
  assert.equal(sheetTitle("orders.csv.gz"), "orders");
  assert.equal(sheetTitle("a.b.xlsx"), "a.b");
  assert.equal(sheetTitle("report.parquet"), "report");
  const result = await buildXlsxWorkbook(fixture(), Uint32Array.from([0]), 0, 1, "orders.csv");
  assert.deepEqual(XLSX.read(result.bytes, { type: "array" }).SheetNames, ["orders"]);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { strToU8, zipSync } from "fflate";
import { listWorkbookSheets, readWorkbookSheet } from "../src/parse/xlsx.js";

interface SheetSpec {
  name: string;
  sheetXml: string;
  mergeCells?: string;
  absoluteTarget?: boolean;
}

function buildWorkbook(sheets: SheetSpec[], shared?: string): ArrayBuffer {
  const files: Record<string, Uint8Array> = {};

  files["xl/workbook.xml"] = strToU8(
    '<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
      sheets
        .map((sheet, index) => `<sheet name="${sheet.name}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`)
        .join("") +
      "</sheets></workbook>",
  );

  files["xl/_rels/workbook.xml.rels"] = strToU8(
    "<Relationships>" +
      sheets
        .map((sheet, index) => {
          const target = sheet.absoluteTarget
            ? `/xl/worksheets/sheet${index + 1}.xml`
            : `worksheets/sheet${index + 1}.xml`;
          return `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="${target}"/>`;
        })
        .join("") +
      "</Relationships>",
  );

  sheets.forEach((sheet, index) => {
    files[`xl/worksheets/sheet${index + 1}.xml`] = strToU8(
      `<worksheet><sheetData>${sheet.sheetXml}</sheetData>${sheet.mergeCells ?? ""}</worksheet>`,
    );
  });

  if (shared !== undefined) files["xl/sharedStrings.xml"] = strToU8(shared);

  const zipped = zipSync(files);
  return zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength) as ArrayBuffer;
}

test("lists sheets in workbook order with actual data extents", async () => {
  const buffer = buildWorkbook([
    {
      name: "Sales",
      sheetXml:
        '<dimension ref="A1:C500"/>' +
        '<row r="1"><c r="A1" t="inlineStr"><is><t>H</t></is></c><c r="B1" t="inlineStr"><is><t>H2</t></is></c></row>' +
        '<row r="2"><c r="A2"><v>1</v></c><c r="B2"><v>2</v></c></row>' +
        '<row r="3"><c r="A3"><v>3</v></c><c r="B3"><v>4</v></c></row>',
    },
    { name: "Empty", sheetXml: '<dimension ref="A1:Z1000"/>' },
    {
      name: "R&amp;D",
      sheetXml: '<row r="1"><c r="A1"><v>9</v></c></row>',
      absoluteTarget: true,
    },
  ]);

  const listing = await listWorkbookSheets(buffer, 50);
  assert.equal(listing.total, 3);
  assert.deepEqual(listing.sheets, [
    { name: "Sales", rows: 3, columns: 2 },
    { name: "R&D", rows: 1, columns: 1 },
  ]);
});

test("ignores formatting-only rows when measuring", async () => {
  const buffer = buildWorkbook([
    {
      name: "Messy",
      sheetXml:
        '<row r="1"><c r="A1"><v>1</v></c><c r="B1"><v>2</v></c></row>' +
        '<row r="2"><c r="A2"><v>3</v></c><c r="B2"><v>4</v></c></row>' +
        '<row r="3"><c r="A3" s="1"/><c r="H3" s="1"/></row>',
    },
  ]);

  const listing = await listWorkbookSheets(buffer);
  assert.deepEqual(listing.sheets, [{ name: "Messy", rows: 2, columns: 2 }]);
});

test("returns the first sheets in order, up to the limit", async () => {
  const sheets = Array.from({ length: 55 }, (_, index) => ({
    name: `S${index + 1}`,
    sheetXml: '<row r="1"><c r="A1"><v>1</v></c></row>',
  }));

  const listing = await listWorkbookSheets(buildWorkbook(sheets), 50);
  assert.equal(listing.total, 55);
  assert.equal(listing.sheets.length, 50);
  assert.equal(listing.sheets[0].name, "S1");
  assert.equal(listing.sheets[49].name, "S50");
});

test("reads cell values, formulas, booleans and merges", async () => {
  const buffer = buildWorkbook(
    [
      {
        name: "Data",
        sheetXml:
          '<dimension ref="A1:C4"/>' +
          '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>' +
          '<row r="2"><c r="A2"><v>42</v></c><c r="B2" t="b"><v>1</v></c><c r="C2" t="inlineStr"><is><t>Inline</t></is></c></row>' +
          '<row r="3"><c r="A3" t="str"><v>Formula</v></c></row>' +
          '<row r="4"><c r="A4" t="inlineStr"><is><t>Merged</t></is></c></row>' +
          '<row r="5"/>',
        mergeCells: '<mergeCells count="1"><mergeCell ref="A4:B4"/></mergeCells>',
      },
    ],
    "<sst><si><t>Hello</t></si><si><t>World</t></si></sst>",
  );

  const grid = await readWorkbookSheet(buffer, "Data");
  assert.deepEqual(grid, [
    ["Hello", "World", ""],
    ["42", "TRUE", "Inline"],
    ["Formula", "", ""],
    ["Merged", "Merged", ""],
  ]);
});

test("returns an empty grid for unknown sheet names", async () => {
  const buffer = buildWorkbook([
    { name: "Only", sheetXml: '<dimension ref="A1:A1"/>' },
  ]);
  assert.deepEqual(await readWorkbookSheet(buffer, "Missing"), []);
  assert.deepEqual(await readWorkbookSheet(buffer, "Only"), []);
});

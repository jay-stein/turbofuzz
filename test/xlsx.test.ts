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

test("lists sheets with sizes from the dimension element, biggest first", async () => {
  const buffer = buildWorkbook([
    {
      name: "Sales",
      sheetXml: '<dimension ref="A1:C5"/><row r="1"><c r="A1" t="inlineStr"><is><t>H</t></is></c></row>',
    },
    {
      name: "R&amp;D",
      sheetXml: '<dimension ref="A1:B2"/>',
      absoluteTarget: true,
    },
  ]);

  const sheets = await listWorkbookSheets(buffer);
  assert.deepEqual(sheets, [
    { name: "Sales", rows: 5, columns: 3 },
    { name: "R&D", rows: 2, columns: 2 },
  ]);
});

test("falls back to row/cell counting when dimension is missing", async () => {
  const buffer = buildWorkbook([
    {
      name: "Messy",
      sheetXml:
        '<row r="1"><c r="A1"><v>1</v></c><c r="B1"><v>2</v></c></row>' +
        '<row r="2"><c r="A2"><v>3</v></c><c r="B2"><v>4</v></c></row>' +
        '<row r="3"><c r="A3"><v>5</v></c><c r="B3"><v>6</v></c></row>',
    },
  ]);

  const sheets = await listWorkbookSheets(buffer);
  assert.equal(sheets.length, 1);
  assert.equal(sheets[0].rows, 3);
  assert.equal(sheets[0].columns, 2);
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

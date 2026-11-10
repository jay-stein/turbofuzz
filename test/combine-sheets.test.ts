import { test } from "node:test";
import assert from "node:assert/strict";
import { combineSheets } from "../src/parse/combine-sheets.js";

const jan = { name: "Jan", grid: [["id", "amount", "region"], ["1", "10", "North"], ["2", "20", "South"]] };
const feb = { name: "Feb", grid: [["id", "amount", "region"], ["3", "30", "East"]] };

test("worksheets with the same columns stack, each row saying its sheet", () => {
  const result = combineSheets([jan, feb], { hasHeaders: true, sheetColumn: true });
  assert.deepEqual(result, {
    ok: true,
    hasHeaders: true,
    rows: 3,
    sheetColumn: "excel_worksheetname",
    table: [
      ["id", "amount", "region", "excel_worksheetname"],
      ["1", "10", "North", "Jan"],
      ["2", "20", "South", "Jan"],
      ["3", "30", "East", "Feb"],
    ],
    gaps: [],
  });
  const plain = combineSheets([jan, feb], { hasHeaders: true, sheetColumn: false });
  assert.ok(plain.ok);
  if (plain.ok) assert.deepEqual(plain.table[0], ["id", "amount", "region"]);
});

test("the same columns in another order line up by name, and title rows above the header are skipped", () => {
  const mar = { name: "Mar", grid: [["March sales report"], [], ["region", "id", "amount"], ["West", "4", "40"]] };
  const result = combineSheets([jan, mar], { hasHeaders: true, sheetColumn: true });
  assert.ok(result.ok);
  if (result.ok) assert.deepEqual(result.table.at(-1), ["4", "40", "West", "Mar"]);
});

test("a sheet that already has excel_worksheetname gets excel_worksheetname_2", () => {
  const a = { name: "A", grid: [["id", "excel_worksheetname"], ["1", "x"]] };
  const b = { name: "B", grid: [["id", "excel_worksheetname"], ["2", "y"]] };
  const result = combineSheets([a, b], { hasHeaders: true, sheetColumn: true });
  assert.ok(result.ok);
  if (result.ok) {
    assert.deepEqual(result.table[0], ["id", "excel_worksheetname", "excel_worksheetname_2"]);
    assert.deepEqual(result.table[2], ["2", "y", "B"]);
  }
});

test("sheets with different columns stack like files: lined up by name, a column some lack left empty, and the gaps named", () => {
  const odd = { name: "Notes", grid: [["ID", "Amount ", "comment"], ["9", "1", "hi"]] };
  const result = combineSheets([jan, odd], { hasHeaders: true, sheetColumn: true });
  assert.ok(result.ok);
  if (!result.ok) return;
  // Case and spacing aside, "ID" is "id": the first spelling is kept.
  assert.deepEqual(result.table[0], ["id", "amount", "region", "comment", "excel_worksheetname"]);
  assert.deepEqual(result.table[1], ["1", "10", "North", "", "Jan"]);
  assert.deepEqual(result.table.at(-1), ["9", "1", "", "hi", "Notes"]);
  assert.deepEqual(result.gaps, [
    { column: "region", missingIn: ["Notes"] },
    { column: "comment", missingIn: ["Jan"] },
  ]);
});

test("without a header row, sheets of the same width stack and the sheet name is the last cell", () => {
  const a = { name: "A", grid: [["1", "x"], ["2", "y"]] };
  const b = { name: "B", grid: [["3", "z"]] };
  assert.deepEqual(combineSheets([a, b], { hasHeaders: false, sheetColumn: true }), {
    ok: true,
    hasHeaders: false,
    rows: 3,
    sheetColumn: "excel_worksheetname",
    table: [["1", "x", "A"], ["2", "y", "A"], ["3", "z", "B"]],
    gaps: [],
  });
  // A wider sheet still stacks: the narrower ones are padded with empty cells.
  const wide = { name: "W", grid: [["1", "2", "3"]] };
  const padded = combineSheets([a, wide], { hasHeaders: false, sheetColumn: false });
  assert.ok(padded.ok);
  if (padded.ok) assert.deepEqual(padded.table, [["1", "x", ""], ["2", "y", ""], ["1", "2", "3"]]);
});

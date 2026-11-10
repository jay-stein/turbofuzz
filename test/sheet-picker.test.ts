import { test } from "node:test";
import assert from "node:assert/strict";
import { planSheets, type SheetChoice } from "../src/ui/sheet-picker.js";

const sheets: SheetChoice[] = [
  { name: "Contents", rows: 12, columns: 1 },
  { name: "Jan", rows: 121, columns: 3 },
  { name: "Feb", rows: 96, columns: 3 },
  { name: "Mar", rows: 141, columns: 3 },
  { name: "Notes", rows: 5, columns: 2 },
];
const tick = (...names: string[]) => new Set(names);

test("nothing ticked, one ticked, or several with the same columns", () => {
  assert.deepEqual(planSheets(sheets, tick(), true), { action: "none", note: "Tick the worksheets to load." });
  assert.deepEqual(planSheets(sheets, tick("Feb"), true), { action: "one", sheet: "Feb", button: "Load “Feb”" });
  assert.deepEqual(planSheets(sheets, tick("Jan", "Feb", "Mar"), true), {
    action: "combine",
    sheets: ["Jan", "Feb", "Mar"],
    button: "Combine 3 worksheets",
    note: "About 355 rows × 3 columns, stacked in the order listed.",
  });
  // Without a header row every listed row is data.
  const plain = planSheets(sheets, tick("Jan", "Feb"), false);
  assert.ok(plain.action === "combine" && plain.note.startsWith("About 217 rows"));
});

test("a sheet that stands out (a contents page) is named so it can be unticked, but does not stop combining", () => {
  const four = planSheets(sheets, tick("Contents", "Jan", "Feb", "Mar"), true);
  assert.equal(four.action, "combine");
  assert.ok(four.action === "combine" && four.warn === true);
  assert.equal(
    four.action === "combine" ? four.note : "",
    "“Contents” has 1 column and the others have 3. Columns are lined up by name and missing cells left empty; untick it if it isn't part of the table.",
  );
  const five = planSheets(sheets, tick("Contents", "Jan", "Feb", "Mar", "Notes"), true);
  assert.equal(
    five.action === "combine" ? five.note : "",
    "“Contents”, “Notes” have different columns from the others (3). Columns are lined up by name and missing cells left empty; untick them if they aren't part of the table.",
  );
  // Two widths tied on count: the one with more rows is the table, the other stands out.
  const tied = planSheets(sheets, tick("Contents", "Mar"), true);
  assert.ok(tied.action === "combine" && tied.note.startsWith("“Contents” has 1 column and the others have 3."));
});

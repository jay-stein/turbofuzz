import { test } from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import { ColumnData } from "../src/data/column.js";
import { sampleExceptions, collectExceptions } from "../src/data/dq-exceptions.js";
import type { DQReport } from "../src/data/dq-report.js";
import { EXCEPTIONS_PER_CHECK, qualityReportWorkbook, type QualityWorkbookInput } from "../src/ui/quality-xlsx.js";

const REPORT: DQReport = {
  dataset: "wine.csv",
  rows: 4,
  columns: 3,
  generatedAt: "2026-11-15T10:30:00.000Z",
  overall: 82.4,
  band: "fair",
  bandReason: "Fair because 25% of rows fail at least one check",
  dimensions: [
    { dimension: "completeness", label: "Completeness", score: 91.7, weight: 1, pass: 11, fail: 1, na: 0, note: null },
    { dimension: "timeliness", label: "Timeliness", score: null, weight: 1, pass: 0, fail: 0, na: 0, note: "No date column" },
  ],
  checks: [{ dimension: "completeness", label: "“country” is populated", detail: "1 of 4 empty", pass: 3, fail: 1, na: 0 }],
  sensitive: [{ name: "taster", class: "person", label: "Person name" }],
  rules: [{ text: "points between 80 and 100", fail: 0, compared: 4, severity: "critical" }],
};

const INPUT: QualityWorkbookInput = {
  report: REPORT,
  created: "2026-11-15 10:30",
  issues: [
    { severity: "fix", dimension: "Completeness", column: "country", title: "1 row has no country", evidence: "1 of 4 rows", impact: null, rows: 1, fix: null },
    { severity: "review", dimension: "Review", column: "taster", title: "Possibly sensitive", evidence: "", impact: "Mask before sharing", rows: 3, fix: "Mask" },
  ],
  columns: [
    { name: "country", type: "category", typeLabel: "Category", meaning: "Country", score: 75, nulls: 1, distinct: 2, min: null, max: null, mean: null, minLength: 2, maxLength: 5, top: [{ label: "Italy", count: 2 }], example: "Italy", fixRows: 1, reviewRows: 0, flags: [], sensitive: false },
    { name: "points", type: "integer", typeLabel: "Integer", meaning: "", score: 100, nulls: 0, distinct: 3, min: 82, max: 95, mean: 88.5, minLength: null, maxLength: null, top: [], example: "88", fixRows: 0, reviewRows: 0, flags: [], sensitive: false },
    { name: "taster", type: "string", typeLabel: "Text", meaning: "Person name", score: 100, nulls: 0, distinct: 3, min: null, max: null, mean: null, minLength: 8, maxLength: 12, top: [{ label: "K••••", count: 2 }], example: "K••••", fixRows: 0, reviewRows: 3, flags: [], sensitive: true },
  ],
  relations: [{ kind: "Blank together", columns: ["country", "region"], title: "country and region are empty in the same rows", rows: 1 }],
  variants: [{ column: "country", spellings: [{ value: "Italy", count: 2 }, { value: "italy ", count: 1 }] }],
  sensitiveExamples: { taster: ["K••••"] },
  rawValues: false,
};

test("the workbook has every sheet, in order, and the summary states the whole-file scope", async () => {
  const built = await qualityReportWorkbook(INPUT, []);
  const book = XLSX.read(built.bytes, { type: "array" });
  assert.deepEqual(book.SheetNames, ["Summary", "Columns", "Findings", "Checks & rules", "Exceptions", "Relationships", "Sensitive", "About"]);
  const summary = XLSX.utils.sheet_to_json<unknown[]>(book.Sheets["Summary"]!, { header: 1, blankrows: false }).flat().map(String);
  assert.ok(summary.some((t) => t.includes("Scope: the whole file, 4 rows × 3 columns")));
  assert.ok(summary.includes("82.4"));
  const findings = XLSX.utils.sheet_to_json<unknown[]>(book.Sheets["Findings"]!, { header: 1, blankrows: false });
  assert.ok(findings.some((row) => row.includes("1 row has no country")));
  assert.deepEqual(built.exceptions, { total: 0, written: 0 });
});

test("the score tile shows the engine's band, even when a column problem holds it below the number", async () => {
  const capped = { ...INPUT, report: { ...REPORT, overall: 96.1, band: "fair", bandReason: "Fair because “region_2” is 61% empty" } };
  const built = await qualityReportWorkbook(capped, []);
  const summary = XLSX.utils.sheet_to_json<unknown[]>(XLSX.read(built.bytes, { type: "array" }).Sheets["Summary"]!, { header: 1, blankrows: false }).flat().map(String);
  assert.ok(summary.includes("FAIR · out of 100"));
  assert.ok(!summary.includes("GOOD · out of 100"));
});

test("exceptions are sampled per check, masked, and empty cells left to the Columns sheet", async () => {
  const bad = Array.from({ length: EXCEPTIONS_PER_CHECK + 20 }, (_, i) => (i % 2 === 0 ? "12" : "twelve"));
  const columns = [ColumnData.create("qty", [...bad, ...Array.from({ length: 4000 }, () => "7")]), ColumnData.create("who", Array.from({ length: bad.length + 4000 }, (_, i) => (i === 0 ? "" : "Kerin O'Keefe")))];
  const rowCount = bad.length + 4000;
  const options = { maskColumns: new Set([1]), includeRaw: false, optional: new Set<number>(), variantSources: [null, null] };
  const groups = sampleExceptions(columns, rowCount, { ...options, perCheck: EXCEPTIONS_PER_CHECK, skipEmpty: true });
  const all = collectExceptions(columns, rowCount, { ...options, checkId: null });
  // The CSV has the same failing cells plus the one empty cell.
  assert.equal(groups.reduce((sum, g) => sum + g.total, 0), all.count - 1);
  for (const g of groups) assert.ok(g.rows.length <= EXCEPTIONS_PER_CHECK);
  assert.ok(groups.every((g) => !g.check.startsWith("completeness.")));

  const built = await qualityReportWorkbook(INPUT, groups);
  assert.equal(built.exceptions.written, groups.reduce((sum, g) => sum + g.rows.length, 0));
  const rows = XLSX.utils.sheet_to_json<unknown[]>(XLSX.read(built.bytes, { type: "array" }).Sheets["Exceptions"]!, { header: 1, blankrows: false });
  assert.ok(rows.length >= built.exceptions.written);
});

test("sensitive values are masked in sampled exceptions unless raw values are asked for", () => {
  const raw = [...Array.from({ length: 60 }, (_, i) => String(i + 1)), "twelve thousand"];
  const columns = [ColumnData.create("n", raw)];
  const run = (includeRaw: boolean) =>
    sampleExceptions(columns, raw.length, { maskColumns: new Set([0]), includeRaw, optional: new Set(), variantSources: [null], perCheck: 10, skipEmpty: true }).flatMap((g) => g.rows.map((r) => r.value));
  assert.deepEqual(run(true), ["twelve thousand"]);
  const masked = run(false);
  assert.equal(masked.length, 1);
  assert.notEqual(masked[0], "twelve thousand");
});

test("the Summary sets the raw load against the cleaned data when a step was applied", async () => {
  const cleaning = {
    before: { overall: 68.2, band: "poor", rows: 4, rowsAffected: 3, emptyCells: 2, duplicateRows: 1, issues: 4, dimensions: [{ dimension: "completeness", label: "Completeness", score: 70 }], columns: [] },
    after: { overall: 82.4, band: "fair", rows: 4, rowsAffected: 1, emptyCells: 1, duplicateRows: 0, issues: 2, dimensions: [{ dimension: "completeness", label: "Completeness", score: 91.7 }], columns: [] },
    steps: [{ label: "country: Fill with “Unknown”", overall: 82.4, points: 14.2 }],
  };
  const built = await qualityReportWorkbook({ ...INPUT, report: { ...REPORT, cleaning } }, []);
  const rows = XLSX.utils.sheet_to_json<unknown[]>(XLSX.read(built.bytes, { type: "array" }).Sheets["Summary"]!, { header: 1, blankrows: false }).map((row) => row.filter((cell) => cell !== undefined && cell !== null && cell !== "").map(String));
  assert.ok(rows.some((row) => row[0] === "BEFORE AND AFTER CLEANING"));
  assert.ok(rows.some((row) => row.join("|") === "Score|68.2|82.4|+14.2"));
  assert.ok(rows.some((row) => row.join("|") === "Rows failing a check|3|1|−2"));
  assert.ok(rows.some((row) => row.join("|") === "Completeness|70.0|91.7|+21.7"));
  assert.ok(rows.some((row) => row.join("|") === "1|country: Fill with “Unknown”|82.4|+14.2"));
  // Without a step the section is left out.
  const plain = await qualityReportWorkbook({ ...INPUT, report: { ...REPORT, cleaning: { ...cleaning, steps: [] } } }, []);
  const text = XLSX.utils.sheet_to_json<unknown[]>(XLSX.read(plain.bytes, { type: "array" }).Sheets["Summary"]!, { header: 1, blankrows: false }).flat().map(String);
  assert.ok(!text.includes("BEFORE AND AFTER CLEANING"));
});

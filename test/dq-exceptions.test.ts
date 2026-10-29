import { test } from "node:test";
import assert from "node:assert/strict";
import { collectExceptions } from "../src/data/dq-exceptions.js";
import { computeRowsAffected } from "../src/data/dq-rows.js";
import { summariseDateFormats } from "../src/data/date-formats.js";
import { summariseNumberSymbols } from "../src/data/number-symbols.js";
import { BitSet } from "../src/search/bitset.js";
import type { ColumnData } from "../src/data/column.js";

function column(name: string, raw: string[], extra: Partial<ColumnData>): ColumnData {
  const nullMask = new BitSet(raw.length);
  raw.forEach((value, row) => {
    if (value === "") nullMask.set(row);
  });
  return {
    name,
    role: null,
    raw,
    nullMask,
    nullTokens: [],
    conformance: null,
    numberLocale: "dot",
    dateOrder: "dmy",
    dateFormats: null,
    numberSymbols: null,
    rangeViolation: null,
    ...extra,
  } as unknown as ColumnData;
}

const dates = ["2023-01-01", "2023-01-02", "2023-01-03", "25/12/2023", "2023-01-05"];
const amounts = ["10", "$20", "30", "40", ""];
const columns = [
  column("when", dates, { dateFormats: summariseDateFormats(dates, () => false) }),
  column("amount, usd", amounts, { numberSymbols: summariseNumberSymbols(amounts, () => false, "dot") }),
];
const base = { variantSources: [null, null], checkId: null, optional: new Set<number>() };

test("one exception row per failing cell, matching the rows-affected count", () => {
  const result = collectExceptions(columns, 5, { ...base, maskColumns: new Set(), includeRaw: false });
  const affected = computeRowsAffected(columns, 5, [null, null], [null, null]);
  // Two failing cells in two rows, plus the empty amount (completeness, info).
  assert.equal(result.count, 3);
  assert.equal(result.csv.trim().split("\n").length, 4);
  assert.equal(affected.count, 2);
  assert.match(result.csv, /^4,when,validity\.dateformat\.0,validity,review,25\/12\/2023,/m);
  assert.match(result.csv, /"amount, usd"/);
});

test("sensitive columns are masked by default and shown only on request", () => {
  const masked = collectExceptions(columns, 5, { ...base, maskColumns: new Set([0]), includeRaw: false });
  assert.doesNotMatch(masked.csv, /25\/12\/2023/);
  const raw = collectExceptions(columns, 5, { ...base, maskColumns: new Set([0]), includeRaw: true });
  assert.match(raw.csv, /25\/12\/2023/);
});

test("a check id narrows the file; optional columns drop their empty cells", () => {
  const one = collectExceptions(columns, 5, { ...base, maskColumns: new Set(), includeRaw: false, checkId: "validity.symbols.1" });
  assert.equal(one.count, 1);
  const optional = collectExceptions(columns, 5, { ...base, maskColumns: new Set(), includeRaw: false, optional: new Set([1]) });
  assert.equal(optional.count, 2);
});

test("values that look like formulas are neutralised for spreadsheets", () => {
  const bad = ["1", "2", "3", "=SUM(A1)", "5"];
  const col = column("n", bad, {
    conformance: { intended: "number" } as ColumnData["conformance"],
  });
  const out = collectExceptions([col], 5, { ...base, variantSources: [null], maskColumns: new Set(), includeRaw: false });
  assert.doesNotMatch(out.csv, /,=SUM/);
});

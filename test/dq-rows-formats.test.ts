import { test } from "node:test";
import assert from "node:assert/strict";
import { computeRowsAffected } from "../src/data/dq-rows.js";
import { summariseDateFormats } from "../src/data/date-formats.js";
import { summariseNumberSymbols } from "../src/data/number-symbols.js";
import { BitSet } from "../src/search/bitset.js";
import type { ColumnData } from "../src/data/column.js";

function column(raw: string[], extra: Partial<ColumnData>): ColumnData {
  const nullMask = new BitSet(raw.length);
  return {
    role: null,
    raw,
    nullMask,
    nullTokens: [],
    conformance: null,
    numberLocale: "dot",
    dateOrder: "dmy",
    dateFormats: null,
    numberSymbols: null,
    ...extra,
  } as unknown as ColumnData;
}

test("rows in a minority date format or number style count as affected, once", () => {
  const dates = ["2023-01-01", "2023-01-02", "2023-01-03", "25/12/2023", "2023-01-05"];
  const amounts = ["10", "$20", "30", "40", "50"];
  const result = computeRowsAffected(
    [
      column(dates, { dateFormats: summariseDateFormats(dates, () => false) }),
      column(amounts, { numberSymbols: summariseNumberSymbols(amounts, () => false, "dot") }),
    ],
    5,
    [null, null],
    [null, null],
  );
  assert.equal(result.count, 2, "row 3 (date) and row 1 (symbol)");
  assert.equal(result.bits.get(1), true);
  assert.equal(result.bits.get(3), true);
  assert.equal(result.bits.get(0), false);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { computeRowsAffected } from "../src/data/dq-rows.js";
import { BitSet } from "../src/search/bitset.js";
import type { ColumnData } from "../src/data/column.js";

function column(raw: string[], extra: Partial<ColumnData>): ColumnData {
  return {
    role: null,
    raw,
    nullMask: new BitSet(raw.length),
    nullTokens: [],
    conformance: null,
    numberLocale: "dot",
    dateOrder: "dmy",
    dateFormats: null,
    numberSymbols: null,
    ...extra,
  } as unknown as ColumnData;
}

// Column 0: rows 0-1 are spelling variants. Column 1: row 2 is the placeholder "n/a", row 3 does not read as a number.
const status = column(["active", "active", "Active", "Active", "Active"], {});
const qtyNulls = new BitSet(5);
qtyNulls.set(2);
const qty = column(["1", "2", "n/a", "oops", "5"], {
  nullMask: qtyNulls,
  nullTokens: [{ label: "n/a", count: 1 }] as unknown as ColumnData["nullTokens"],
  conformance: { intended: "integer", nonConforming: 2 } as unknown as ColumnData["conformance"],
});
const sources = [new Set(["active"]), null];
const count = (aside: string[] = []) => computeRowsAffected([status, qty], 5, [null, null], sources, new Set(aside));

test("with nothing set aside every failing row counts", () => {
  assert.equal(count().count, 4);
});

test("a set-aside check stops counting its rows and no others", () => {
  const variants = count(["consistency.variants.0"]);
  assert.equal(variants.count, 2, "only the placeholder and the unreadable value remain");
  assert.equal(variants.bits.get(0), false);
  const validity = count(["validity.1"]);
  assert.equal(validity.count, 3, "the unreadable value is out; the placeholder and variants stay");
  assert.equal(validity.bits.get(3), false);
  assert.equal(validity.bits.get(2), true);
  const placeholder = count(["completeness.1"]);
  assert.equal(placeholder.bits.get(2), false, "a placeholder is a completeness failure");
});

test("a row failing two checks still counts while one of them is live", () => {
  const both = column(["Active", "active"], {});
  const bad = column(["1", "oops"], { conformance: { intended: "integer", nonConforming: 1 } as unknown as ColumnData["conformance"] });
  const args = [[both, bad], 2, [null, null], [new Set(["active"]), null]] as const;
  assert.equal(computeRowsAffected(...args, new Set(["validity.1"])).count, 1);
  assert.equal(computeRowsAffected(...args, new Set(["validity.1", "consistency.variants.0"])).count, 0);
});

test("setting everything aside leaves no rows affected", () => {
  assert.equal(count(["consistency.variants.0", "validity.1", "completeness.1"]).count, 0);
});

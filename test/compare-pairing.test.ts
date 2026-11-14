import { test } from "node:test";
import assert from "node:assert/strict";
import { ColumnData } from "../src/data/column.js";
import { columnNameKey, pairColumns } from "../src/data/compare/columns.js";
import { suggestKeys } from "../src/data/compare/keys.js";
import { suggestColumnPairs } from "../src/data/compare/pair-suggest.js";
import { matchRows } from "../src/data/compare/match.js";
import { diffColumns, mostChangedColumn, sortDiffPositions } from "../src/data/compare/diffs.js";
import { differencesTable } from "../src/data/compare/export.js";
import { filterPositions } from "../src/data/compare/view.js";
import { DEFAULT_RULES, compareColumn, type CompareSide } from "../src/data/compare/types.js";

function side(name: string, table: Record<string, string[]>): CompareSide {
  const columns = Object.entries(table).map(([column, raw]) => compareColumn(ColumnData.create(column, raw)));
  return { name, rowCount: columns[0]?.raw.length ?? 0, columns };
}

const ids = Array.from({ length: 60 }, (_, i) => `C${String(i + 1).padStart(7, "0")}`);
const amounts = ids.map((_, i) => String(100 + (i % 10)));

/** B: the key renamed, ids 1-2 removed, two new ones, amounts of rows 5, 6 and 7 changed (6 the most, then 5; 7 by a little). */
function renamedPair() {
  const a = side("a", { id: ids, amount: amounts, qty: ids.map((_, i) => String(i % 5)) });
  const bIds = [...ids.slice(2), "C0000901", "C0000902"];
  const bAmounts = [...amounts.slice(2), "1", "2"];
  bAmounts[3] = String(Number(bAmounts[3]) + 5); // C4 (aRow 5-2... row index 3 in B is id 6)
  bAmounts[4] = String(Number(bAmounts[4]) + 50);
  bAmounts[5] = String(Number(bAmounts[5]) + 1);
  const b = side("b", { customer_id: bIds, amount: bAmounts, qty: [...ids.slice(2).map((_, i) => String((i + 2) % 5)), "0", "0"] });
  return { a, b };
}

test("names differing only in case, spaces, underscores, hyphens or camel case pair by name", () => {
  for (const name of ["Customer ID", "customer_id", "CustomerId", "customer-id"]) assert.equal(columnNameKey(name), "customerid");
  const pairing = pairColumns(side("a", { "Customer ID": ["1"] }), side("b", { CustomerId: ["1"] }));
  assert.equal(pairing.pairs.length, 1);
});

test("a key column renamed between A and B is suggested as a pair, and pairing it makes it the key", () => {
  const { a, b } = renamedPair();
  const pairing = pairColumns(a, b);
  assert.deepEqual(suggestKeys(a, b, pairing, DEFAULT_RULES), [], "no key without the pairing");
  const found = suggestColumnPairs(a, b, pairing, DEFAULT_RULES);
  assert.equal(found.length, 1);
  assert.deepEqual([found[0].a, found[0].b], [0, 0]);
  assert.ok(found[0].overlap >= 0.9 && found[0].overlap < 1);
  assert.ok(found[0].keyLike);
  const paired = pairColumns(a, b, [{ a: found[0].a, b: found[0].b }]);
  const keys = suggestKeys(a, b, paired, DEFAULT_RULES);
  const index = paired.pairs.findIndex((pair) => pair.a === 0 && pair.b === 0);
  assert.deepEqual(keys[0].pairs, [index]);
  const match = matchRows(a, b, paired, [paired.pairs[index]], DEFAULT_RULES);
  assert.deepEqual(match.counts, { identical: 55, changed: 3, onlyA: 2, onlyB: 2 });
});

test("two label columns that share a few values are not suggested as a pair", () => {
  const rows = 200;
  const a = side("a", { id: ids.concat(ids, ids, ids.slice(0, 20)).slice(0, rows), flag: Array.from({ length: rows }, (_, i) => (i % 2 ? "Yes" : "No")) });
  const b = side("b", { id: a.columns[0].raw.slice(), answer: Array.from({ length: rows }, (_, i) => (i % 3 ? "Yes" : "No")) });
  assert.deepEqual(suggestColumnPairs(a, b, pairColumns(a, b), DEFAULT_RULES), []);
  // Plenty of values but few shared: a different column.
  const c = side("c", { id: ids, code: ids.map((_, i) => `X${i}`) });
  const d = side("d", { id: ids, other: ids.map((_, i) => `Y${i}`) });
  assert.deepEqual(suggestColumnPairs(c, d, pairColumns(c, d), DEFAULT_RULES), []);
});

test("a renamed column that repeats its values is suggested but would not be a key", () => {
  const labels = Array.from({ length: 120 }, (_, i) => `Town ${i % 30}`);
  const a = side("a", { id: ids.concat(ids).slice(0, 120).map((v, i) => `${v}-${i}`), town: labels });
  const b = side("b", { id: a.columns[0].raw.slice(), city: labels });
  const found = suggestColumnPairs(a, b, pairColumns(a, b), DEFAULT_RULES);
  assert.equal(found.length, 1);
  assert.equal(found[0].keyLike, false);
});

test("value differences open on the column with the most changes, the largest change first, and rows that did not change are left out", () => {
  const { a, b } = renamedPair();
  const pairing = pairColumns(a, b, [{ a: 0, b: 0 }]);
  const keyPairs = [pairing.pairs.findIndex((pair) => pair.a === 0)];
  const match = matchRows(a, b, pairing, [pairing.pairs[keyPairs[0]]], DEFAULT_RULES);
  const columns = diffColumns(a, b, pairing);
  const most = mostChangedColumn(columns, match)!;
  assert.equal(a.columns[pairing.pairs[most].a].name, "amount");
  const changed = filterPositions(match, { show: "changed", pairs: [] });
  const matched = filterPositions(match, { show: "matched", pairs: [] });
  assert.equal(changed.length, 3);
  assert.equal(matched.length, 58);
  const size = (positions: Int32Array): number[] =>
    [...positions].map((at) => Math.abs(Number(b.columns[1].raw[match.bRow[at]]) - Number(a.columns[1].raw[match.aRow[at]])));
  assert.deepEqual(size(sortDiffPositions(a, b, pairing, match, most, changed, "sub", "desc")), [50, 5, 1]);
  assert.deepEqual(size(sortDiffPositions(a, b, pairing, match, most, changed, "sub", "asc")), [1, 5, 50]);
  // Over every matched row the changed ones still lead, and the unchanged follow.
  const all = size(sortDiffPositions(a, b, pairing, match, most, matched, "sub", "desc"));
  assert.deepEqual(all.slice(0, 3), [50, 5, 1]);
  assert.ok(all.slice(3).every((n) => n === 0));
});

test("the differences table has _change, the key, a column of A, B and B − A for each changed column, and unchanged columns once", () => {
  const { a, b } = renamedPair();
  const pairing = pairColumns(a, b, [{ a: 0, b: 0 }]);
  const key = pairing.pairs.findIndex((pair) => pair.a === 0);
  const match = matchRows(a, b, pairing, [pairing.pairs[key]], DEFAULT_RULES);
  const table = differencesTable(a, b, pairing, match, [key]);
  assert.deepEqual(table.headers.slice(0, 5), ["_change", "id", "amount (A)", "amount (B)", "amount (B − A)"]);
  assert.equal(table.rows.length, 3 + 2 + 2);
  const count = (status: string): number => table.rows.filter((row) => row[0] === status).length;
  assert.deepEqual([count("changed"), count("only in A"), count("only in B")], [3, 2, 2]);
  const changed = table.rows.filter((row) => row[0] === "changed").find((row) => row[4] === "50")!;
  assert.equal(changed[1], "C0000007");
  // Rows with one side only leave the other side's cells and the difference blank.
  const onlyB = table.rows.find((row) => row[0] === "only in B")!;
  assert.deepEqual([onlyB[2], onlyB[4]], ["", ""]);
  // Row counts agree with the Changes (CSV) export's statuses.
  assert.equal(match.counts.changed + match.counts.onlyA + match.counts.onlyB, table.rows.length);
});

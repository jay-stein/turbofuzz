import { test } from "node:test";
import assert from "node:assert/strict";
import { ColumnData } from "../src/data/column.js";
import { pairColumns, columnNameKey } from "../src/data/compare/columns.js";
import { suggestKeys } from "../src/data/compare/keys.js";
import { matchRows } from "../src/data/compare/match.js";
import { buildReport } from "../src/data/compare/report.js";
import {
  DEFAULT_RULES,
  ROW_CHANGED,
  ROW_IDENTICAL,
  ROW_ONLY_A,
  ROW_ONLY_B,
  compareColumn,
  type CompareRules,
  type CompareSide,
} from "../src/data/compare/types.js";

function side(name: string, table: Record<string, string[]>): CompareSide {
  const columns = Object.entries(table).map(([column, raw]) => compareColumn(ColumnData.create(column, raw)));
  return { name, rowCount: columns[0]?.raw.length ?? 0, columns };
}

function compare(a: CompareSide, b: CompareSide, key: string[] | null, rules: CompareRules = DEFAULT_RULES) {
  const pairing = pairColumns(a, b);
  const keyPairs = key === null ? null : key.map((name) => pairing.pairs.find((pair) => a.columns[pair.a].name === name)!);
  const match = matchRows(a, b, pairing, keyPairs, rules);
  return { pairing, match, report: buildReport(a, b, pairing, match) };
}

/** Aligned rows as "aRow/bRow:status" for easy reading. */
function aligned(match: ReturnType<typeof matchRows>): string[] {
  const names = ["same", "changed", "onlyA", "onlyB"];
  return [...match.aRow].map((ar, i) => `${ar}/${match.bRow[i]}:${names[match.status[i]]}`);
}

test("columns pair by exact name, then loosely, then by hand; the rest are added or removed", () => {
  assert.equal(columnNameKey("Order ID"), columnNameKey("order_id"));
  const a = side("a", { "Order ID": ["1"], Amount: ["2"], region: ["x"], legacy: ["y"] });
  const b = side("b", { order_id: ["1"], amount: ["2"], area: ["x"], extra: ["z"] });
  const auto = pairColumns(a, b);
  assert.deepEqual(auto.pairs.map((pair) => [pair.a, pair.b]), [[0, 0], [1, 1]]);
  assert.deepEqual(auto.onlyA, [2, 3]);
  assert.deepEqual(auto.onlyB, [2, 3]);
  const manual = pairColumns(a, b, [{ a: 2, b: 2 }]);
  assert.deepEqual(manual.pairs.map((pair) => [pair.a, pair.b, pair.manual]), [[0, 0, false], [1, 1, false], [2, 2, true]]);
  assert.deepEqual(manual.onlyA, [3]);
});

test("an exact name wins over a loose one", () => {
  const a = side("a", { Name: ["1"], name: ["2"] });
  const b = side("b", { name: ["2"] });
  assert.deepEqual(pairColumns(a, b).pairs.map((pair) => [pair.a, pair.b]), [[1, 0]]);
});

test("the key suggestion prefers a filled, unique, id-like column shared by both", () => {
  const a = side("a", { customer_id: ["C1", "C2", "C3", "C4"], price: ["1.5", "2.5", "3.5", "4.5"], city: ["x", "y", "x", "z"] });
  const b = side("b", { customer_id: ["C2", "C1", "C3", "C5"], price: ["1.5", "2.5", "3.5", "9.5"], city: ["x", "y", "x", "z"] });
  const pairing = pairColumns(a, b);
  const keys = suggestKeys(a, b, pairing, DEFAULT_RULES);
  assert.deepEqual(keys[0].pairs, [0]);
  assert.equal(keys[0].overlap, 0.75);
  assert.ok(!keys.some((key) => key.pairs.includes(2)), "a repeating column is never a key");
});

test("with no single key, two columns together are suggested; with none at all, nothing", () => {
  const a = side("a", { store: ["s1", "s1", "s2", "s2"], day: ["mon", "tue", "mon", "tue"], sales: ["5", "5", "7", "7"] });
  const b = side("b", { store: ["s1", "s2", "s1", "s2"], day: ["mon", "mon", "tue", "tue"], sales: ["5", "7", "6", "7"] });
  const pairing = pairColumns(a, b);
  assert.deepEqual(suggestKeys(a, b, pairing, DEFAULT_RULES)[0].pairs, [0, 1]);
  const flat = side("f", { v: ["1", "1", "2"] });
  assert.deepEqual(suggestKeys(flat, flat, pairColumns(flat, flat), DEFAULT_RULES), []);
});

test("rows match on the key: changed cells, rows only in A or B, aligned like a diff", () => {
  const a = side("a", { id: ["1", "2", "3", "4"], name: ["Ada", "Alan", "Grace", "Edsger"], amount: ["10", "20", "30", "40"] });
  const b = side("b", { id: ["1", "3", "4", "5"], name: ["Ada", "Grace", "Edsger W.", "Barbara"], amount: ["10", "31", "40", "50"] });
  const { match, report } = compare(a, b, ["id"]);
  assert.equal(match.mode, "key");
  assert.deepEqual(aligned(match), ["0/0:same", "1/-1:onlyA", "2/1:changed", "3/2:changed", "-1/3:onlyB"]);
  assert.deepEqual(match.counts, { identical: 1, changed: 2, onlyA: 1, onlyB: 1 });
  assert.equal(match.changed[1].count(), 1, "one name changed");
  assert.equal(match.changed[2].count(), 1, "one amount changed");
  assert.deepEqual(report.rows, { a: 4, b: 4, matched: 3, identical: 1, changed: 2, onlyA: 1, onlyB: 1 });
  assert.deepEqual(report.changes.map((change) => [change.name, change.changed, change.top[0]]), [
    ["name", 1, { from: "Edsger", to: "Edsger W.", count: 1 }],
    ["amount", 1, { from: "30", to: "31", count: 1 }],
  ]);
});

test("a shuffled B still lines up by key, and number keys compare as numbers (1.0 = 1)", () => {
  const a = side("a", { id: ["1", "2", "3"], v: ["a", "b", "c"] });
  const b = side("b", { id: ["3", "1.0", "2"], v: ["c", "a", "b"] });
  const { match } = compare(a, b, ["id"]);
  assert.deepEqual(match.counts, { identical: 3, changed: 0, onlyA: 0, onlyB: 0 });
  assert.deepEqual([...match.bRow], [0, 1, 2]);
  assert.deepEqual([...match.aRow], [2, 0, 1]);
});

test("leading-zero codes are text: 007 does not match 7", () => {
  const a = side("a", { code: ["007", "008"], v: ["a", "b"] });
  const b = side("b", { code: ["7", "8"], v: ["a", "b"] });
  assert.equal(compare(a, b, ["code"]).match.counts.identical, 0);
});

test("repeated and empty keys are counted; repeats pair in order", () => {
  const a = side("a", { id: ["1", "1", "", "2"], v: ["x", "y", "z", "w"] });
  const b = side("b", { id: ["1", "1", "1", ""], v: ["x", "y", "q", "z"] });
  const { match } = compare(a, b, ["id"]);
  assert.deepEqual(match.duplicateKeys, { a: 1, b: 2 });
  assert.deepEqual(match.emptyKeys, { a: 1, b: 1 });
  assert.deepEqual(aligned(match), ["0/0:same", "1/1:same", "-1/2:onlyB", "-1/3:onlyB", "2/-1:onlyA", "3/-1:onlyA"]);
});

test("value rules: number tolerance, case, spaces, and whether empty equals empty", () => {
  const a = side("a", { id: ["1", "2", "3", "4", "5"], n: ["100", "100", "1.0", "", "7"], t: ["Oslo", " Rome ", "Paris", "", "x"] });
  const b = side("b", { id: ["1", "2", "3", "4", "5"], n: ["100.4", "102", "1", "", "7"], t: ["OSLO", "Rome", "paris", "", "x"] });
  const strict = compare(a, b, ["id"], { ...DEFAULT_RULES, trimSpaces: false });
  assert.equal(strict.match.changed[1].count(), 2, "100 vs 100.4 and 100 vs 102 differ; 1.0 equals 1");
  assert.equal(strict.match.changed[2].count(), 3, "case and spaces count when not ignored");
  const loose = compare(a, b, ["id"], { ...DEFAULT_RULES, numberAbs: 0.5, ignoreCase: true, trimSpaces: true });
  assert.equal(loose.match.changed[1].count(), 1, "only 100 vs 102 is beyond 0.5");
  assert.equal(loose.match.changed[2].count(), 0);
  const relative = compare(a, b, ["id"], { ...DEFAULT_RULES, numberRel: 0.05 });
  assert.equal(relative.match.changed[1].count(), 0, "2% is within 5%");
  const nulls = compare(a, b, ["id"], { ...DEFAULT_RULES, emptyEqualsEmpty: false });
  assert.equal(nulls.match.status[3], ROW_CHANGED, "empty vs empty counts as a change when asked");
});

test("dates compare as dates whatever their spelling, and never with the number tolerance", () => {
  const a = side("a", { id: ["1", "2"], d: ["2024-03-01", "2024-03-02"] });
  const b = side("b", { id: ["1", "2"], d: ["2024-03-01", "2024-03-03"] });
  const { match } = compare(a, b, ["id"], { ...DEFAULT_RULES, numberAbs: 1e12 });
  assert.deepEqual([...match.status], [ROW_IDENTICAL, ROW_CHANGED]);
});

test("with no key, whole rows match in any order; a changed row is removed and added", () => {
  const a = side("a", { name: ["Ada", "Alan", "Grace", "Ada"], city: ["L", "M", "N", "L"] });
  const b = side("b", { name: ["Grace", "Ada", "Alan", "Ada"], city: ["N", "L", "Manchester", "L"] });
  const { match, report } = compare(a, b, null);
  assert.equal(match.mode, "content");
  assert.deepEqual(match.counts, { identical: 3, changed: 0, onlyA: 1, onlyB: 1 });
  assert.equal(report.changes.length, 0);
  const onlyA = [...match.status].map((status, i) => (status === ROW_ONLY_A ? match.aRow[i] : -1)).filter((row) => row >= 0);
  const onlyB = [...match.status].map((status, i) => (status === ROW_ONLY_B ? match.bRow[i] : -1)).filter((row) => row >= 0);
  assert.deepEqual([onlyA, onlyB], [[1], [2]]);
});

test("the report lists column changes and totals over all and matched rows", () => {
  const a = side("a", { id: ["1", "2", "3"], amount: ["10", "20", "30"], code: ["1", "2", "3"], old: ["x", "y", "z"] });
  const b = side("b", { id: ["1", "2", "4"], amount: ["10", "25", "100"], code: ["A", "B", "C"], new: ["p", "q", "r"] });
  const { report } = compare(a, b, ["id"]);
  assert.deepEqual(report.columns.added, ["new"]);
  assert.deepEqual(report.columns.removed, ["old"]);
  assert.deepEqual(report.columns.retyped, [{ name: "code", a: "integer", b: "category" }]);
  const amount = report.totals.find((total) => total.name === "amount")!;
  assert.deepEqual(amount.a, { sum: 60, mean: 20, count: 3 });
  assert.deepEqual(amount.b, { sum: 135, mean: 45, count: 3 });
  assert.deepEqual(amount.matched, { a: 30, b: 35 });
  assert.ok(!report.totals.some((total) => total.name === "code"), "a column that is text on one side has no totals");
});

test("a key with a few empty or repeated rows is still suggested, with the problems counted", () => {
  const ids = Array.from({ length: 300 }, (_, i) => `K${i}`);
  const bIds = [...ids.slice(0, 297), "", "K5", "K6"];
  const a = side("a", { order_id: ids, v: ids.map((_, i) => String(i % 7)) });
  const b = side("b", { order_id: bIds, v: bIds.map((_, i) => String(i % 7)) });
  const keys = suggestKeys(a, b, pairColumns(a, b), DEFAULT_RULES);
  assert.deepEqual(keys[0].pairs, [0]);
  assert.deepEqual(keys[0].problems, { emptyA: 0, emptyB: 1, duplicateA: 0, duplicateB: 2 });
  // Beyond 1% of the rows it is not a key.
  const worse = side("w", { order_id: [...ids.slice(0, 290), ...Array(10).fill("")], v: ids.map((_, i) => String(i % 7)) });
  assert.deepEqual(suggestKeys(a, worse, pairColumns(a, worse), DEFAULT_RULES), []);
});

test("the side-by-side view filters aligned rows, cuts a window with both sides' cells, and finds differences", async () => {
  const { filterPositions, rowWindow, findDifference } = await import("../src/data/compare/view.js");
  const a = side("a", { id: ["1", "2", "3", "4"], name: ["Ada", "Alan", "Grace", "Edsger"], old: ["x", "y", "z", "w"] });
  const b = side("b", { id: ["1", "3", "4", "5"], name: ["Ada", "Grace", "Edsger W.", "Barbara"], new: ["p", "q", "r", "s"] });
  const { pairing, match } = compare(a, b, ["id"]);
  // Aligned: 0/0 same, 1/-1 only A, 2/1 same, 3/2 changed (name), -1/3 only B.
  const all = filterPositions(match, { show: "all", pair: null });
  assert.deepEqual([...all], [0, 1, 2, 3, 4]);
  assert.deepEqual([...filterPositions(match, { show: "changed", pair: null })], [3]);
  assert.deepEqual([...filterPositions(match, { show: "onlyB", pair: null })], [4]);
  assert.deepEqual([...filterPositions(match, { show: "all", pair: 1 })], [3], "rows where name changed");
  assert.deepEqual([...filterPositions(match, { show: "identical", pair: null })], [0, 2]);

  const window = rowWindow(a, b, pairing, match, all, 1, 4);
  assert.equal(window.start, 1);
  assert.equal(window.total, 5);
  assert.deepEqual(window.a, [["2", "Alan", "y"], ["3", "Grace", "z"], ["4", "Edsger", "w"]], "pairs, then A's own columns");
  assert.deepEqual(window.b, [null, ["3", "Grace", "q"], ["4", "Edsger W.", "r"]], "a gap where B has no row");
  assert.deepEqual([...window.changed], [0, 0, 0, 0, 0, 1], "rows × pairs");
  assert.deepEqual(rowWindow(a, b, pairing, match, all, 4, 99).b, [["5", "Barbara", "s"]], "the end is clamped");

  assert.equal(findDifference(match, all, -1, 1), 1);
  assert.equal(findDifference(match, all, 1, 1), 3);
  assert.equal(findDifference(match, all, 4, 1), -1);
  assert.equal(findDifference(match, all, 3, -1), 1);
});

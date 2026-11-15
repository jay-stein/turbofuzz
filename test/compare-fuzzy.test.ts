import { test } from "node:test";
import assert from "node:assert/strict";
import { ColumnData } from "../src/data/column.js";
import { pairColumns } from "../src/data/compare/columns.js";
import { keySimilarity, prepareKey } from "../src/data/compare/fuzzy-match.js";
import { matchRows } from "../src/data/compare/match.js";
import { DEFAULT_RULES, compareColumn, type CompareSide } from "../src/data/compare/types.js";

function side(name: string, table: Record<string, string[]>): CompareSide {
  const columns = Object.entries(table).map(([column, raw]) => compareColumn(ColumnData.create(column, raw)));
  return { name, rowCount: columns[0]?.raw.length ?? 0, columns };
}

function run(a: CompareSide, b: CompareSide, threshold: number | null, rejected: string[] = []) {
  const pairing = pairColumns(a, b);
  const keyPairs = [pairing.pairs.find((pair) => a.columns[pair.a].name === "Supplier")!];
  return matchRows(a, b, pairing, keyPairs, DEFAULT_RULES, false, threshold === null ? null : { threshold, rejected: new Set(rejected) });
}

const ledger = side("ledger", {
  Supplier: ["Acme Pty Ltd", "John Smith, 12 High St", "Globex Corporation", "Initech", "Hooli"],
  Amount: ["100", "250", "75", "10", "5"],
});
const bank = side("bank", {
  Supplier: ["ACME Pty. Limited", "Smith John, 12 High Street", "Globex Corp", "Initech", "Wayne Enterprises"],
  Amount: ["100", "250", "80", "10", "999"],
});

test("keys are compared as names: suffixes, abbreviations, punctuation and word order do not matter", () => {
  assert.equal(keySimilarity(prepareKey("Acme Pty Ltd"), prepareKey("ACME Pty. Limited")), 1);
  assert.equal(keySimilarity(prepareKey("John Smith, 12 High St"), prepareKey("Smith John, 12 High Street")), 1);
  assert.equal(keySimilarity(prepareKey("278 Lake Road"), prepareKey("267 Lake Rd")), 0, "different street numbers are different");
});

test("without similar-key matching, renamed suppliers fall out as removed plus added", () => {
  const match = run(ledger, bank, null);
  assert.equal(match.fuzzy ?? null, null);
  assert.equal(match.counts.onlyA, 4);
  assert.equal(match.counts.onlyB, 4);
});

test("similar keys pair up, with the amount as the second check", () => {
  const match = run(ledger, bank, 0.88);
  assert.ok(match.fuzzy);
  const pairs = match.fuzzy!.pairs.map((pair) => [pair.aRow, pair.bRow, pair.tier]);
  assert.deepEqual(pairs.sort(), [[0, 0, "confident"], [1, 1, "confident"], [2, 2, "confident"]]);
  // Initech matched exactly; Hooli and Wayne stay unmatched.
  assert.equal(match.counts.onlyA, 1);
  assert.equal(match.counts.onlyB, 1);
  const globex = match.fuzzy!.pairs.find((pair) => pair.aRow === 2)!;
  assert.equal(globex.agree, 0, "the amount differs (75 vs 80)");
  assert.equal(match.fuzzy!.at.filter((at) => at >= 0).length, 3);
});

test("a stricter slider pairs fewer rows, and rejected pairs stay apart", () => {
  const loose = run(ledger, bank, 0.7).fuzzy!.pairs.length;
  const strict = run(ledger, bank, 0.97).fuzzy!.pairs.length;
  assert.ok(strict <= loose);
  const rejected = run(ledger, bank, 0.88, ["0:0"]);
  assert.ok(!rejected.fuzzy!.pairs.some((pair) => pair.aRow === 0 && pair.bRow === 0));
  assert.equal(rejected.counts.onlyA, 2);
});

test("a loosely similar name with a contradicting amount is left for review", () => {
  const a = side("a", { Supplier: ["Northern Plumbers Group"], Amount: ["100"] });
  const b = side("b", { Supplier: ["Northern Plumbing Supply"], Amount: ["9000"] });
  const match = run(a, b, 0.8);
  assert.equal(match.fuzzy!.pairs.length, 1);
  assert.equal(match.fuzzy!.pairs[0].tier, "review");
});

test("two close candidates make a pairing ambiguous and one to one", () => {
  const a = side("a", { Supplier: ["Smith Plumbing"], Amount: ["1"] });
  const b = side("b", { Supplier: ["Smyth Plumbing", "Smith Plumbing Co"], Amount: ["2", "3"] });
  const match = run(a, b, 0.8);
  assert.equal(match.fuzzy!.pairs.length, 1);
});

test("the report lists the review pairs first, with both keys and the evidence", async () => {
  const { buildReport } = await import("../src/data/compare/report.js");
  const a = side("a", { Supplier: ["Northern Plumbers Group", "Acme Pty Ltd"], Amount: ["100", "5"] });
  const b = side("b", { Supplier: ["Northern Plumbing Supply", "ACME Limited"], Amount: ["9000", "5"] });
  const pairing = pairColumns(a, b);
  const match = run(a, b, 0.8);
  const report = buildReport(a, b, pairing, match);
  assert.equal(report.fuzzy?.review, 1);
  assert.equal(report.fuzzy?.confident, 1);
  assert.equal(report.fuzzy?.pairs[0].tier, "review");
  assert.equal(report.fuzzy?.pairs[0].aKey, "Northern Plumbers Group");
  assert.equal(report.rows.matched, 2);
  assert.equal(buildReport(a, b, pairing, run(a, b, null)).fuzzy, null);
});

test("matching 50,000 leftover names a side stays fast", () => {
  const first = ["Acme", "Globex", "Initech", "Hooli", "Umbrella", "Stark", "Wayne", "Wonka", "Soylent", "Tyrell"];
  const second = ["Trading", "Plumbing", "Logistics", "Foods", "Energy", "Holdings", "Partners", "Systems", "Media", "Works"];
  const name = (i: number, noisy: boolean) => `${first[i % 10]} ${second[Math.floor(i / 10) % 10]} ${i}${noisy ? " Pty Ltd" : ""}`;
  const n = 50_000;
  const a = side("a", { Supplier: Array.from({ length: n }, (_, i) => name(i, false)), Amount: Array.from({ length: n }, (_, i) => String(i)) });
  const b = side("b", { Supplier: Array.from({ length: n }, (_, i) => name(i, true)), Amount: Array.from({ length: n }, (_, i) => String(i)) });
  const started = performance.now();
  const match = run(a, b, 0.88);
  const ms = performance.now() - started;
  assert.equal(match.fuzzy!.pairs.length, n);
  console.log(`fuzzy key match, ${n} per side: ${Math.round(ms)} ms`);
  assert.ok(ms < 8000, `took ${ms} ms`);
});

test("the Similar keys filter keeps only the rows paired by similarity, and the report says where each one sits", async () => {
  const { filterPositions } = await import("../src/data/compare/view.js");
  const { buildReport } = await import("../src/data/compare/report.js");
  const match = run(ledger, bank, 0.88);
  const positions = [...filterPositions(match, { show: "similar", pairs: [] })];
  assert.equal(positions.length, 3);
  assert.ok(positions.every((at) => match.fuzzy!.at[at]! >= 0));
  // Exact-key rows (Initech) and unmatched rows are not in it.
  assert.ok(positions.every((at) => match.bRow[at] !== 3));
  const report = buildReport(ledger, bank, pairColumns(ledger, bank), match);
  assert.deepEqual(report.fuzzy!.pairs.map((pair) => pair.index).sort(), [0, 1, 2]);
  assert.equal(filterPositions(run(ledger, bank, null), { show: "similar", pairs: [] }).length, 0);
});

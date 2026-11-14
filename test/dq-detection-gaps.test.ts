import { test } from "node:test";
import assert from "node:assert/strict";
import { ColumnData } from "../src/data/column.js";
import { buildIssues } from "../src/data/dq-issues.js";
import { keyRepeatFinding, reviewFindings } from "../src/data/findings.js";
import { detectArchetypes } from "../src/data/archetype.js";
import { computeDQScore, type ScoreCheck } from "../src/data/score.js";
import { columnVariants, recodePairs } from "../src/data/variants.js";
import { computeRowsAffected } from "../src/data/dq-rows.js";
import { computePairViolations, suggestPairs } from "../src/data/pair-checks.js";
import type { DatasetStats } from "../src/data/stats.js";
import type { ColumnMeta } from "../src/worker/protocol.js";

/** Small fixtures for the detection gaps an assessment of a planted-defect orders table found. */

const rows = (n: number, make: (i: number) => string): string[] => Array.from({ length: n }, (_, i) => make(i));

/** Mirrors the worker's metaFor closely enough for detection (variants for categories and text). */
function metaOf(column: ColumnData): ColumnMeta {
  if (column.type === "integer" || column.type === "number" || column.type === "date") column.numbers();
  const built = column.type === "category" || column.type === "boolean" ? column.categories() : null;
  return {
    name: column.name,
    type: column.type,
    numberLocale: column.numberLocale,
    dateOrder: column.dateOrder,
    stats: column.stats,
    anomalyCounts: { values: 0, lengths: 0 },
    similarGroups: 0,
    categories: built === null ? null : { labels: built.labels, counts: built.counts },
    histogram: column.histogram(),
    valueFence: null,
    lengthFence: null,
    nullPolicy: { extra: [], keep: [] },
    nullTokens: [...column.nullTokens],
    suggestions: column.suggestions,
    typeDowngrade: column.typeDowngrade,
    conformance: column.conformance,
    rangeViolation: column.rangeViolation,
    semantic: column.semantic,
    variants: columnVariants(column),
  };
}

const stats = (rowCount: number, duplicateRows = 0): DatasetStats => ({
  duplicateRows, duplicateGroups: duplicateRows, rowsInDuplicateGroups: duplicateRows * 2, emptyRows: 0, rowsWithNulls: 0,
  totalNullCells: 0, totalCells: rowCount, valueAnomalyRows: 0, lengthAnomalyRows: 0, computeMs: 1,
});

function issuesFor(columns: ColumnData[], rowCount: number, extraChecks: ScoreCheck[] = [], duplicateRows = 0) {
  const metas = columns.map(metaOf);
  const score = computeDQScore(metas, stats(rowCount, duplicateRows), rowCount, {}, extraChecks);
  return {
    metas,
    issues: buildIssues({ score, metas, rowCount, review: reviewFindings(metas, stats(rowCount, duplicateRows), rowCount), sensitiveColumns: new Set() }),
  };
}

// --- 1. a record key that repeats ---------------------------------------------------------

const N = 2000;
/** ORD-0000001.. with ids 1..30 used twice (60 rows share an id, 30 ids). */
const orderIds = rows(N, (i) => `ORD-${String(i < 60 ? (i % 30) + 1 : i + 1).padStart(7, "0")}`);
const customerIds = rows(N, (i) => `C${100 + (i % 100)}`);

test("a key-named, 98%+ distinct column that repeats is a fix item with Show rows", () => {
  const { issues } = issuesFor(
    [ColumnData.create("order_id", orderIds), ColumnData.create("customer_id", customerIds), ColumnData.create("amount", rows(N, (i) => String(i % 97)))],
    N,
    [],
    12,
  );
  const key = issues.find((issue) => issue.kind === "keyDuplicates");
  assert.ok(key, "the repeating key is reported");
  assert.equal(key.severity, "fix");
  assert.equal(key.columnName, "order_id");
  assert.equal(key.title, "“order_id” looks like the key but 60 rows share an id with another row (30 ids)");
  assert.equal(key.rows, 60);
  assert.equal(key.fixLabel, "Show rows");
  assert.equal(key.finding?.action?.kind, "keyDuplicates");
  assert.match(key.evidence, /exact duplicate rows \(listed separately\)/);
  // Kept apart from the exact-duplicate-rows item.
  const dup = issues.find((issue) => issue.kind === "duplicates");
  assert.ok(dup, "exact duplicate rows are still their own item");
  assert.notEqual(dup.id, key.id);
  assert.equal(issues.filter((issue) => issue.kind === "keyDuplicates").length, 1, "customer_id never fires");
});

test("a repeating foreign key, a unique key, or a non-key name never fires", () => {
  const unique = rows(N, (i) => `ORD-${i}`);
  // Unique order_id beside a near-unique line_ref: the key exists, line_ref is not it.
  assert.equal(
    keyRepeatFinding([ColumnData.create("order_id", unique), ColumnData.create("line_ref", orderIds)].map(metaOf), N),
    null,
  );
  // Foreign key alone: 5% distinct.
  assert.equal(keyRepeatFinding([ColumnData.create("customer_id", customerIds)].map(metaOf), N), null);
  // Near-unique values under a name that is not a key (an email, a full name).
  assert.equal(keyRepeatFinding([ColumnData.create("email", orderIds.map((id) => `${id}@x.test`))].map(metaOf), N), null);
  // 90% distinct id: too many repeats to be a broken key; reads as a reference.
  const lowish = rows(N, (i) => `T${i < 400 ? i % 200 : i}`);
  assert.equal(keyRepeatFinding([ColumnData.create("ticket_id", lowish)].map(metaOf), N), null);
});

test("the archetype line never calls a repeating id column unique", () => {
  const metas = [ColumnData.create("order_id", orderIds), ColumnData.create("phone", rows(N, (i) => `04${String(10000000 + (i % 1990)).padStart(8, "0")}`)), ColumnData.create("amount", rows(N, (i) => String(i % 97)))].map(metaOf);
  const evidence = detectArchetypes(metas, stats(N), N).flatMap((guess) => guess.evidence);
  assert.ok(!evidence.includes("unique key column"), evidence.join(" | "));
  assert.ok(evidence.includes("identifier column"), evidence.join(" | "));
  const unique = [ColumnData.create("order_id", rows(N, (i) => `ORD-${i}`)), ColumnData.create("amount", rows(N, (i) => String(i % 97)))].map(metaOf);
  assert.ok(detectArchetypes(unique, stats(N), N).flatMap((guess) => guess.evidence).includes("unique key column"));
});

// --- 2. date columns whose names imply an order --------------------------------------------

/** The check app.ts adds for each suggested pair (refreshSuggestedPairs), from the worker's counts. */
function suggestedCheck(columns: ColumnData[], a: number, b: number): ScoreCheck {
  const result = computePairViolations(columns, a, b, "gte", 0, columns[0]!.raw.length);
  return {
    id: `consistency.suggested.${a}.${b}`, dimension: "consistency", label: "suggested", detail: "",
    pass: result.compared - result.violations, fail: result.violations, na: 0, column: null, filter: null, fixLabel: null, suggested: true,
  };
}

const day = (i: number): string => `2024-03-${String(1 + (i % 20)).padStart(2, "0")}`;

test("order_date / ship_date is proposed, and rows shipped before ordering are worth reviewing", () => {
  const columns = [
    ColumnData.create("order_date", rows(400, (i) => day(i))),
    ColumnData.create("ship_date", rows(400, (i) => (i < 7 ? "2024-02-01" : i === 7 ? "" : `2024-03-${String(2 + (i % 20)).padStart(2, "0")}`))),
  ];
  const pairs = suggestPairs(columns.map(metaOf));
  assert.deepEqual(pairs.map((p) => [p.a, p.b]), [[1, 0]], "ship_date >= order_date is proposed");
  const { issues } = issuesFor(columns, 400, [suggestedCheck(columns, 1, 0)]);
  const issue = issues.find((entry) => entry.kind === "pairOrder");
  assert.ok(issue, "the failing pair becomes an issue");
  assert.equal(issue.severity, "review");
  assert.equal(issue.title, "“ship_date” is before “order_date” in 7 rows");
  assert.match(issue.evidence, /^7 of 399 rows with both values/);
  assert.equal(issue.fixLabel, "Show rows");
  assert.deepEqual(issue.finding?.action, { kind: "pairCheck", a: 1, b: 0, operator: "gte" });
  assert.equal(issue.batchSafe, false);
});

test("pairs in order, unrelated date names or a text column raise nothing", () => {
  const ordered = [ColumnData.create("order_date", rows(400, day)), ColumnData.create("ship_date", rows(400, (i) => day(i + 1).replace("-03-01", "-03-21")))];
  const fine = issuesFor(ordered, 400, [suggestedCheck(ordered, 1, 0)]);
  assert.equal(fine.issues.filter((entry) => entry.kind === "pairOrder").length, 0, "no row out of order, no issue");
  const m = (name: string, type: string): ColumnMeta => ({ name, type }) as unknown as ColumnMeta;
  assert.deepEqual(suggestPairs([m("order_date", "date"), m("invoice_date", "date")]), [], "no implied order");
  assert.deepEqual(suggestPairs([m("order_date", "date"), m("ship_mode", "category")]), [], "different families");
  assert.equal(suggestPairs([m("birth_date", "date"), m("death_date", "date")]).length, 1);
  assert.equal(suggestPairs([m("opened", "date"), m("closed", "date")]).length, 1);
});

// --- 3. leading and trailing spaces ---------------------------------------------------------

test("a trailing-space copy of a category value is a variant, fixed by trimming to the common spelling", () => {
  const state = ColumnData.create("state", rows(1000, (i) => (i < 12 ? "NSW " : i < 15 ? " VIC" : ["NSW", "VIC", "QLD", "WA"][i % 4]!)));
  assert.equal(state.type, "category");
  const { issues } = issuesFor([state], 1000);
  const issue = issues.find((entry) => entry.kind === "variants");
  assert.ok(issue, "padded copies are reported");
  assert.equal(issue.title, "“state” has 4 spellings of 2 values");
  assert.equal(issue.rows, 15);
  assert.equal(issue.batchSafe, true);
  const step = issue.fixes[0];
  assert.ok(step !== undefined && step.kind === "standardise");
  // The recode step trims before it looks a value up, so a self-pair is what trims "NSW ".
  assert.deepEqual([...step.pairs].sort(), [["NSW", "NSW"], ["VIC", "VIC"]]);
  assert.ok(step.preview.some((line) => line.from === "NSW␣" && line.to === "NSW" && line.count === 12), "spaces are visible in the preview");
  assert.ok(issue.dist?.now.some((row) => row.label === "NSW␣"));
});

test("padded text values join their group; the canonical spelling stays the most common one", () => {
  const names = ["Ann Lee", "Bo Chan", "Cy Diaz", "Di Eve", "Ed Fox", "Flo Gee", "Gus Ho", "Hal Ivy", "Ian Jo", "Jo Kim", "Kai Lu", "Lou Ma"];
  const values = rows(1200, (i) => names[i % names.length]!);
  for (let i = 0; i < 30; i++) values[i] = `${values[i]}  `;
  const column = ColumnData.create("customer_name", values);
  const variants = columnVariants(column);
  assert.ok(variants, "padded names are variants");
  assert.equal(variants.minorityRows, 30);
  assert.ok(variants.mappings.every((m) => m.to === m.from.trim() && m.to !== m.from), "each maps to its unpadded, more common spelling");
  // Most common wins even when it is padded; the target never keeps the space.
  const mostlyPadded = columnVariants(ColumnData.create("state", rows(300, (i) => (i < 200 ? "SA " : i < 250 ? "SA" : "NT"))));
  assert.deepEqual(mostlyPadded?.mappings, [{ from: "SA", to: "SA", count: 50 }]);
  assert.deepEqual(recodePairs([["SA", "SA"]]), [["SA", "SA"]]);
});

test("rows affected and exceptions count padded cells, never the canonical ones", () => {
  const state = ColumnData.create("state", rows(400, (i) => (i < 5 ? "WA " : ["WA", "SA"][i % 2]!)));
  const sources = [new Set(columnVariants(state)!.mappings.map((m) => m.from))];
  assert.equal(computeRowsAffected([state], 400, [null], sources).count, 5);
});

test("a column with no stray spaces and no case variants raises no variants issue", () => {
  const clean = ColumnData.create("state", rows(1000, (i) => ["NSW", "VIC", "QLD", "WA"][i % 4]!));
  assert.equal(columnVariants(clean), null);
  assert.equal(issuesFor([clean], 1000).issues.filter((entry) => entry.kind === "variants").length, 0);
});

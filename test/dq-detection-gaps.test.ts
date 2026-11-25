import { test } from "node:test";
import assert from "node:assert/strict";
import { ColumnData } from "../src/data/column.js";
import { buildIssues } from "../src/data/dq-issues.js";
import { keyRepeatFinding, reviewFindings } from "../src/data/findings.js";
import { detectArchetypes } from "../src/data/archetype.js";
import { computeDQScore, type ScoreCheck } from "../src/data/score.js";
import { columnVariants, recodePairs } from "../src/data/variants.js";
import { computeRowsAffected } from "../src/data/dq-rows.js";
import { detectNinesCode } from "../src/data/hidden-missing.js";
import { computeAnomalies } from "../src/data/anomalies.js";
import { scoreSensitivity } from "../src/data/sensitivity.js";
import { textProfile } from "../src/data/text-profile.js";
import { recommendRules } from "../src/data/rules.js";
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
  assert.equal(dup.severity, "review", "a step on the Clean page, not an aside");
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

// --- 5. yes/no columns spelled many ways -----------------------------------------------------

test("Yes/No/Y/N/TRUE/FALSE/yes/no in one column are two values, with one standardise fix", () => {
  const spellings = ["Yes", "No", "No", "No", "No", "No", "No", "No", "Y", "N", "TRUE", "FALSE", "yes", "no"];
  const returned = ColumnData.create("returned", rows(1400, (i) => spellings[i % spellings.length]!));
  const { issues } = issuesFor([returned], 1400);
  const issue = issues.find((entry) => entry.kind === "variants");
  assert.ok(issue);
  assert.equal(issue.title, "“returned” has 8 spellings of 2 values");
  const step = issue.fixes[0];
  assert.ok(step !== undefined && step.kind === "standardise");
  const to = new Map(step.pairs);
  assert.equal(to.get("Y"), "Yes");
  assert.equal(to.get("TRUE"), "Yes");
  assert.equal(to.get("FALSE"), "No");
  assert.equal(to.get("N"), "No");
});

test("a column that only partly holds yes/no words, or holds one spelling each, merges nothing", () => {
  // Sizes: T and F sit beside other letters, so they are not yes/no.
  const sizes = ColumnData.create("size", rows(400, (i) => ["S", "M", "L", "T", "F", "true"][i % 6]!));
  assert.equal(columnVariants(sizes), null);
  const flags = ColumnData.create("active", rows(400, (i) => (i % 3 === 0 ? "Y" : "N")));
  assert.equal(columnVariants(flags), null);
});

// --- 6. a share written as a fraction with a few percentages ----------------------------------

test("discount_pct in 0..0.25 with a few values of 5..25 is worth reviewing, with Show rows", () => {
  const values = rows(2000, (i) => (i % 200 === 0 ? String(5 + (i % 4) * 5) : String((i % 26) / 100)));
  const { issues } = issuesFor([ColumnData.create("discount_pct", values)], 2000);
  const issue = issues.find((entry) => entry.id === "review.scale.0");
  assert.ok(issue, "the scale mix is reported");
  assert.equal(issue.severity, "review");
  assert.equal(issue.title, "“discount_pct” is a fraction (0 to 1) in most rows but 10 values are above 1, probably written as percentages");
  assert.deepEqual(issue.finding?.action, { kind: "filterRange", column: 0, min: 1 + Number.EPSILON, max: null });
});

test("a clean fraction, a 0..100 percentage, or a rate that is not a share raises nothing", () => {
  const quiet = (name: string, make: (i: number) => string): void => {
    const { issues } = issuesFor([ColumnData.create(name, rows(2000, make))], 2000);
    assert.equal(issues.filter((entry) => entry.id.startsWith("review.scale.")).length, 0, name);
  };
  quiet("discount_pct", (i) => String((i % 26) / 100));
  quiet("tax_rate", (i) => String(5 + (i % 20)));
  quiet("heart_rate", (i) => String(55 + (i % 60)));
  quiet("discount", (i) => (i % 200 === 0 ? "15" : String((i % 26) / 100)));
});

// --- 7. a run of nines that stands for "unknown" ----------------------------------------------

test("-999 repeated in an amount column with real negatives is a missing-value code to review", () => {
  const values = rows(5000, (i) => (i % 50 === 0 ? "-999" : i % 97 === 0 ? `-${(10 + (i % 300)).toFixed(2)}` : (100 + ((i * 37) % 5000) + 0.25).toFixed(2)));
  const revenue = ColumnData.create("revenue", values);
  const sentinel = revenue.suggestions.find((s) => s.kind === "sentinel" && s.value === "-999");
  assert.ok(sentinel, "the code is suggested");
  assert.equal(sentinel.kind === "sentinel" && sentinel.count, 100);
  const { issues } = issuesFor([revenue], 5000);
  const issue = issues.find((entry) => entry.id === "review.sentinel.0.-999");
  assert.ok(issue);
  assert.equal(issue.severity, "review");
  assert.equal(issue.fixLabel, "Treat as missing");
  assert.equal(issue.batchSafe, false, "never applied without a click");
});

test("999 as a common price among its neighbours, or a rare nine, is not a code", () => {
  // The full-column pass leaves it alone (the older sampled pass judges frequent 999s on its own terms).
  const prices = rows(3000, (i) => ["899", "949", "999", "1049", "1099", "950", "1000"][i % 7]!);
  assert.equal(detectNinesCode("integer", prices, (v) => v === "", "dot"), null);
  const rare = ColumnData.create("revenue", rows(3000, (i) => (i < 3 ? "-999" : (50 + (i % 400)).toFixed(2))));
  assert.ok(!rare.suggestions.some((s) => s.kind === "sentinel" && s.value === "-999"), "three cells are not a pattern");
});

// --- 8. false positives -------------------------------------------------------------------------

test("lat and lon are never value outliers; the same spread under another name still is", () => {
  // Most rows in two cities, a few in far smaller towns: geography, not error.
  const lat = rows(3000, (i) => (i % 60 === 0 ? String(-12.4 - (i % 7)) : String(-33.86 - (i % 10) / 100)));
  const flagged = (name: string): number => computeAnomalies([ColumnData.create(name, lat)], 3000).valueColumnBits[0]?.count() ?? 0;
  assert.equal(flagged("lat"), 0);
  assert.equal(flagged("Longitude"), 0);
  assert.ok(flagged("depth") > 0, "a measure with the same values keeps its outliers");
});

test("product_name beside an email column is not personal data; customer_name and a bare name still are", () => {
  const input = (column: number, name: string, values: string[]) => {
    const data = ColumnData.create(name, values);
    return { column, name, type: data.type, semantic: data.semantic, shapes: textProfile(values, data.nullMask, 1, false).shapes, sampled: values.length, scanned: values.length, embedded: null };
  };
  const emails = rows(300, (i) => `user${i}@example.com`);
  const things = rows(300, (i) => ["Stapler", "Webcam", "Desk Lamp", "Monitor Arm"][i % 4]!);
  const people = rows(300, (i) => ["Ann Lee", "Bo Chan", "Cy Diaz", "Di Eve", "Ed Fox"][i % 5]!);
  const found = scoreSensitivity([input(0, "email", emails), input(1, "product_name", things), input(2, "file_name", things), input(3, "customer_name", people), input(4, "name", people)]);
  const names = found.filter((f) => f.class === "personal_name").map((f) => f.name);
  assert.ok(!names.includes("product_name") && !names.includes("file_name"), names.join(","));
  assert.ok(names.includes("customer_name") && names.includes("name"), names.join(","));
});

test("suggested allowed values list the standard spellings only when the column has variants", () => {
  const segment = ColumnData.create("segment", rows(1000, (i) => (i % 50 === 0 ? "consumer" : i % 77 === 0 ? "smb" : ["Consumer", "Corporate", "SMB"][i % 3]!)));
  const inList = recommendRules([metaOf(segment)], 1000).find((rule) => rule.type === "inList");
  assert.deepEqual(inList?.values, ["Consumer", "Corporate", "SMB"]);
  const clean = ColumnData.create("channel", rows(1000, (i) => ["Online", "Phone", "Retail"][i % 3]!));
  assert.deepEqual(recommendRules([metaOf(clean)], 1000).find((rule) => rule.type === "inList")?.values, ["Online", "Phone", "Retail"]);
});

// --- 4. dotted and long forms of the same value -------------------------------------------------

test("N.S.W., W.A. and long state names are worth reviewing, mapped to the dominant form", () => {
  const forms = ["NSW", "NSW", "NSW", "VIC", "VIC", "WA", "WA", "QLD"];
  const state = ColumnData.create("state", rows(2000, (i) => (i % 100 === 0 ? "N.S.W." : i % 100 === 1 ? "New South Wales" : i % 100 === 2 ? "W.A." : i % 100 === 3 ? "Victoria" : forms[i % forms.length]!)));
  const { issues } = issuesFor([state], 2000);
  const loose = issues.find((entry) => entry.id === "variantsLoose.0");
  assert.ok(loose);
  assert.equal(loose.severity, "review");
  assert.equal(loose.batchSafe, false);
  const step = loose.fixes[0];
  assert.ok(step !== undefined && step.kind === "standardise");
  assert.deepEqual(new Map(step.pairs), new Map([["N.S.W.", "NSW"], ["New South Wales", "NSW"], ["W.A.", "WA"], ["Victoria", "VIC"]]));
  assert.match(loose.evidence, /bundled state list/);
  assert.equal(issues.filter((entry) => entry.id.startsWith("variants.")).length, 0, "nothing certain to fix");
  // The suggested allowed list keeps the standard forms only.
  assert.deepEqual(recommendRules([metaOf(state)], 2000).find((rule) => rule.type === "inList")?.values, ["NSW", "QLD", "VIC", "WA"]);
});

test("long names stay apart without a state-like column name, and version numbers keep their dots", () => {
  const region = ColumnData.create("team", rows(1000, (i) => ["NSW", "Victoria", "WA"][i % 3]!));
  assert.equal(columnVariants(region), null, "no list applies to a team column");
  const versions = ColumnData.create("release", rows(1000, (i) => ["1.0", "10", "2.1"][i % 3]!));
  assert.equal(columnVariants(versions)?.loose, undefined);
  // A short category list of state names gets no "long values" chip.
  const state = ColumnData.create("state", rows(3000, (i) => (i % 40 === 0 ? "Western Australia" : ["NSW", "VIC", "QLD"][i % 3]!)));
  assert.equal(computeAnomalies([state], 3000).lengthColumnBits[0]?.count() ?? 0, 0);
});

test("an undecided decimal mark is reported as a Data Quality check, not left as a silently clean text column", async () => {
  const { profileBuffer } = await import("../scripts/lib/profile.js");
  const lines = ["Region;Index"];
  for (let i = 0; i < 30; i++) lines.push(`R${i % 3};${100 + i},${String(120 + i * 7).slice(-3).padStart(3, "0")}`);
  const bytes = new TextEncoder().encode(lines.join("\n"));
  const profile = await profileBuffer("ine.csv", bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  const index = profile.metas.find((meta) => meta.name === "Index")!;
  assert.equal(index.type, "string");
  assert.equal(index.typeDowngrade?.ambiguous, true);
  assert.ok(profile.score.overall !== null && profile.score.overall < 100, "the score must not say 100 while nothing is decided");
});

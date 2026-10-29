import { test } from "node:test";
import assert from "node:assert/strict";
import { ColumnData } from "../src/data/column.js";
import { computeDQScore } from "../src/data/score.js";
import { looksLikeFormula } from "../src/data/formula.js";
import { isNullToken } from "../src/parse/null-tokens.js";
import { classifyDateValue } from "../src/parse/dates.js";
import { clusterSimilar } from "../src/search/similar.js";
import type { DatasetStats } from "../src/data/stats.js";
import type { ColumnMeta } from "../src/worker/protocol.js";

const JUNK = "n0pe";

function metaOf(column: ColumnData): ColumnMeta {
  return {
    name: column.name,
    type: column.type,
    numberLocale: column.numberLocale,
    dateOrder: column.dateOrder,
    stats: column.stats,
    anomalyCounts: { values: 0, lengths: 0 },
    similarGroups: 0,
    categories: null,
    histogram: null,
    valueFence: null,
    lengthFence: null,
    nullPolicy: { extra: [], keep: [] },
    nullTokens: [...column.nullTokens],
    suggestions: column.suggestions,
    typeDowngrade: column.typeDowngrade,
    conformance: column.conformance,
  };
}

function stats(rows: number): DatasetStats {
  return {
    duplicateRows: 0,
    duplicateGroups: 0,
    rowsInDuplicateGroups: 0,
    emptyRows: 0,
    rowsWithNulls: 0,
    totalNullCells: 0,
    totalCells: rows,
    valueAnomalyRows: 0,
    lengthAnomalyRows: 0,
    computeMs: 1,
  };
}

/** Deterministic column with `junkPct`% of cells replaced by junk. */
function build(kind: "integer" | "decimal", rows: number, junkPct: number): string[] {
  const values: string[] = [];
  const junkCells = Math.round((rows * junkPct) / 100);
  const every = junkCells === 0 ? Infinity : rows / junkCells;
  let placed = 0;
  for (let i = 0; i < rows; i++) {
    if (placed < junkCells && i >= Math.floor(placed * every)) {
      values.push(JUNK);
      placed++;
    } else if (kind === "integer") values.push(String((i % 5) + 1));
    else values.push(((i % 97) + 0.25).toFixed(2));
  }
  return values;
}

function validity(raw: string[]) {
  const column = ColumnData.create("Quantity", raw);
  const score = computeDQScore([metaOf(column)], stats(raw.length), raw.length);
  const check = score.dimensions
    .find((d) => d.dimension === "validity")!
    .checks.find((c) => c.id === "validity.0")!;
  return { score: score.overall!, fail: check.fail, column };
}

for (const kind of ["integer", "decimal"] as const) {
  test(`more junk never raises the score or lowers failures (${kind})`, () => {
    let previousScore = Infinity;
    let previousFail = -1;
    for (let pct = 0; pct <= 20; pct++) {
      const raw = build(kind, 5000, pct);
      const expected = raw.filter((value) => value === JUNK).length;
      const { score, fail } = validity(raw);
      assert.equal(fail, expected, `${pct}% junk: reported failures equal exact count`);
      assert.ok(score <= previousScore + 1e-9, `${pct}% junk raised the score`);
      assert.ok(fail >= previousFail, `${pct}% junk lowered the failure count`);
      previousScore = score;
      previousFail = fail;
    }
  });
}

test("a numeric column with 12% junk stays numeric-intended, not a hidden category", () => {
  const raw = build("integer", 5000, 12);
  const { column, fail } = validity(raw);
  assert.equal(column.conformance?.intended, "integer");
  assert.equal(column.conformance?.nonConforming, 600);
  assert.equal(fail, 600);
});

test("counts are exact, not sampled, for large columns", () => {
  const raw = build("decimal", 10000, 0);
  for (let i = 0; i < 420; i++) raw[i * 23] = JUNK;
  const { column, fail } = validity(raw);
  assert.equal(column.conformance?.nonConforming, 420);
  assert.equal(fail, 420);
  const conflict = column.suggestions.find((s) => s.kind === "typeConflict");
  assert.equal(conflict?.kind === "typeConflict" ? conflict.count : -1, 420);
});

test("stored-as-text is evidence on one check, not a second failing check", () => {
  const raw = build("integer", 5000, 12);
  const column = ColumnData.create("Quantity", raw);
  const score = computeDQScore([metaOf(column)], stats(5000), 5000);
  const checks = score.dimensions.find((d) => d.dimension === "validity")!.checks;
  assert.equal(checks.length, 1);
});

test("identifiers and word categories get no intended type", () => {
  const phones = Array.from({ length: 200 }, (_, i) => `04${String(10000000 + i * 7)}`);
  assert.equal(ColumnData.create("mobile", phones).conformance, null);
  const words = Array.from({ length: 200 }, (_, i) => ["red", "green", "blue"][i % 3]);
  assert.equal(ColumnData.create("colour", words).conformance, null);
});

test("ERROR is a missing-value token", () => {
  assert.equal(isNullToken("ERROR"), true);
  assert.equal(isNullToken("#error"), true);
  assert.equal(isNullToken("errors in file"), false);
});

test("dd-Mon-yyyy dates parse", () => {
  assert.notEqual(classifyDateValue("18-Jun-1996"), null);
  assert.notEqual(classifyDateValue("3-Mar-96"), null);
  assert.equal(classifyDateValue("18-Foo-1996"), null);
});

test("ISO 8601 durations are not formula-like", () => {
  assert.equal(looksLikeFormula("-P1D"), false);
  assert.equal(looksLikeFormula("-PT30M"), false);
  assert.equal(looksLikeFormula("-SUM(A1)"), true);
  assert.equal(looksLikeFormula("=1+1"), true);
});

test("formula-like cells are not a validity failure", () => {
  const raw = Array.from({ length: 100 }, (_, i) => (i < 20 ? `-cmd${i}` : `name ${i}`));
  const column = ColumnData.create("note", raw);
  const score = computeDQScore([metaOf(column)], stats(100), 100);
  const check = score.dimensions
    .find((d) => d.dimension === "validity")!
    .checks.find((c) => c.id === "validity.0")!;
  assert.equal(check.fail, 0);
});

test("similarity does not cluster dates or numbers", () => {
  const clusters = clusterSimilar([
    { value: "22/08/1976", count: 3 },
    { value: "22/02/1974", count: 2 },
    { value: "1234567", count: 2 },
    { value: "1234576", count: 1 },
  ]);
  assert.equal(clusters.length, 0);
  assert.equal(
    clusterSimilar([
      { value: "Finance", count: 5 },
      { value: "finance", count: 2 },
    ]).length,
    1,
  );
});

import { qualityFindings } from "../src/data/findings.js";
import { spellingVariants } from "../src/data/variants.js";

test("spelling variants are scored, listed in findings, and counts agree", () => {
  const labels = ["FINANCE", "finance", "Finance", "Sales", "HR"];
  const counts = [172, 165, 164, 300, 50];
  const variants = spellingVariants(labels, counts);
  assert.equal(variants?.groups, 1);
  assert.equal(variants?.minorityRows, 329);

  const raw: string[] = [];
  labels.forEach((label, i) => {
    for (let n = 0; n < counts[i]; n++) raw.push(label);
  });
  const column = ColumnData.create("department", raw);
  const meta = { ...metaOf(column), variants };
  const score = computeDQScore([meta], stats(raw.length), raw.length);
  const consistency = score.dimensions.find((d) => d.dimension === "consistency")!;
  assert.notEqual(consistency.score, null);
  const check = consistency.checks[0];
  assert.equal(check.fail, 329);

  const findings = qualityFindings([meta], stats(raw.length) as DatasetStats, raw.length);
  const finding = findings.find((f) => f.id === "variants.0");
  assert.equal(finding?.impact.rows, check.fail);
});

test("typo-free categories report no variants", () => {
  assert.equal(spellingVariants(["a", "b", "c"], [1, 2, 3]), null);
});

import { computePatternProfiles } from "../src/data/mask-profile.js";

test("m/d/yyyy timestamps with a clock time are datetimes (survey exports)", () => {
  assert.notEqual(classifyDateValue("4/27/2021 11:02:10", "mdy"), null);
  assert.equal(classifyDateValue("4/27/2021 11:02:10", "dmy"), null);
  const raw = Array.from({ length: 300 }, (_, i) => `4/${(i % 28) + 1}/2021 ${9 + (i % 10)}:0${i % 10}:10`);
  assert.equal(ColumnData.create("Timestamp", raw).type, "datetime");
});

test("a few percent of real decimals make a number column, not an integer one", () => {
  const raw = Array.from({ length: 2000 }, (_, i) => (i % 50 === 0 ? "1.5" : String(i % 7)));
  const column = ColumnData.create("TOTAL_TONS", raw, undefined, "comma");
  assert.equal(column.type, "number");
  assert.equal(column.numberLocale, "dot");
});

test("band labels in a short category column are not a format failure", () => {
  const bands = ["0_to_16", "17_to_25", "26_to_39", "40_to_64", "65_to_74", "75_or_older", "-9"];
  const raw = Array.from({ length: 700 }, (_, i) => bands[i % bands.length]);
  const column = ColumnData.create("Age Group", raw);
  assert.deepEqual(computePatternProfiles([column], raw.length), []);
});

test("completely empty columns are reported once and not scored", () => {
  const filled = ColumnData.create("id", Array.from({ length: 50 }, (_, i) => String(i)));
  const blank = ColumnData.create("padding", Array.from({ length: 50 }, () => ""));
  const score = computeDQScore([metaOf(filled), metaOf(blank)], stats(50), 50);
  assert.deepEqual(score.emptyColumns, [{ column: 1, name: "padding" }]);
  const checks = score.dimensions.flatMap((d) => d.checks);
  assert.ok(!checks.some((c) => c.column === 1));
  assert.equal(score.overall, 100);
});

test("case variants are found in high-cardinality text columns", () => {
  const raw = Array.from({ length: 400 }, (_, i) => `Job ${i % 150}`);
  raw.push("job 3", "JOB 3", "Job 3 ");
  const column = ColumnData.create("Job title", raw);
  assert.equal(column.type, "string");
  const variants = column.spellingVariants();
  assert.equal(variants?.groups, 1);
  assert.equal(variants?.minorityRows, 2 + 0);
  assert.equal(column.spellingVariants(), variants);
});

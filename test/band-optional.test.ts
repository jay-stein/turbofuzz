import { test } from "node:test";
import assert from "node:assert/strict";
import { computeDQScore } from "../src/data/score.js";
import { detectOptionalColumns, effectiveOptional } from "../src/data/optional-columns.js";
import type { DatasetStats } from "../src/data/stats.js";
import type { ColumnMeta } from "../src/worker/protocol.js";

const ROWS = 100;

function meta(name: string, nulls = 0): ColumnMeta {
  return {
    name,
    type: "string",
    numberLocale: "dot",
    dateOrder: "dmy",
    stats: {
      nulls,
      distinct: 5,
      samples: [],
      topValues: [],
      min: null,
      max: null,
      mean: null,
      stddev: null,
      minLength: null,
      maxLength: null,
      avgLength: null,
    },
    anomalyCounts: { values: 0, lengths: 0 },
    similarGroups: 0,
    categories: null,
    histogram: null,
    valueFence: null,
    lengthFence: null,
    nullPolicy: { extra: [], keep: [] },
    nullTokens: [],
    suggestions: [],
  };
}

const stats: DatasetStats = {
  duplicateRows: 0,
  duplicateGroups: 0,
  rowsInDuplicateGroups: 0,
  emptyRows: 0,
  rowsWithNulls: 0,
  totalNullCells: 0,
  totalCells: 400,
  valueAnomalyRows: 0,
  lengthAnomalyRows: 0,
  computeMs: 1,
};

/** Ten complete columns, so one empty column barely moves the mean. */
const many = (extra: ColumnMeta[]): ColumnMeta[] => [
  ...["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"].map((name) => meta(name)),
  ...extra,
];
/** A second, moderately empty column (like Titanic's Age) keeps a lone column from reading as optional. */
const required = (name: string, nulls: number): ColumnMeta[] => [meta("Age", 20), meta(name, nulls)];

test("a good-looking number with a 77% empty column cannot read good, and says why", () => {
  const score = computeDQScore(many(required("Cabin", 77)), stats, ROWS, { capBand: false });
  assert.equal(score.band, "good", "the number alone would read good");
  const capped = computeDQScore(many(required("Cabin", 60)), stats, ROWS);
  assert.notEqual(capped.band, "good");
  assert.equal(capped.bandCap?.band, "fair");
  assert.match(capped.bandCap?.reason ?? "", /“Cabin” is 60% empty/);
  // 77% empty is above the poor threshold of 75%.
  assert.equal(computeDQScore(many(required("Cabin", 77)), stats, ROWS).band, "poor");
});

test("band caps: 60% empty is fair, 80% empty is poor, 10% is untouched", () => {
  assert.equal(computeDQScore(many(required("x", 60)), stats, ROWS).bandCap?.band, "fair");
  assert.equal(computeDQScore(many(required("x", 80)), stats, ROWS).bandCap?.band, "poor");
  const clean = computeDQScore(many([meta("x", 10)]), stats, ROWS);
  assert.equal(clean.bandCap, null);
  assert.equal(clean.band, "good");
});

test("capBand false keeps the plain number band", () => {
  const score = computeDQScore(many(required("x", 80)), stats, ROWS, { capBand: false });
  assert.notEqual(score.band, "poor");
  assert.equal(score.bandCap, null);
});

test("an invalid-heavy column caps the band", () => {
  const bad = meta("age");
  bad.type = "integer";
  bad.conformance = { intended: "integer", nonConforming: 30, conforming: 70 } as ColumnMeta["conformance"];
  const score = computeDQScore(many([bad]), stats, ROWS);
  assert.equal(score.bandCap?.band, "fair");
  assert.match(score.bandCap?.reason ?? "", /“age” has 30% invalid/);
});

test("optional columns: named, or >30% empty in an otherwise complete table", () => {
  const named = detectOptionalColumns(many([meta("notes", 90)]), ROWS);
  assert.ok(named.has(10));
  const lone = detectOptionalColumns(many([meta("extra", 40)]), ROWS);
  assert.ok(lone.has(10), "the only incomplete column is probably blank by design");
  // Titanic shape: Age is also 20% empty, so Cabin is NOT auto-optional.
  const titanic = detectOptionalColumns(many([meta("Age", 20), meta("Cabin", 77)]), ROWS);
  assert.equal(titanic.size, 0);
});

test("user overrides win both ways", () => {
  const columns = many([meta("notes", 90)]);
  assert.equal(effectiveOptional(columns, ROWS, { notes: false }).has(10), false);
  const cabin = many([meta("Age", 20), meta("Cabin", 77)]);
  assert.equal(effectiveOptional(cabin, ROWS, { Cabin: true }).has(11), true);
});

test("an optional column does not drive the band and counts a fraction towards completeness", () => {
  const plain = computeDQScore(many([meta("extra", 40)]), stats, ROWS, { optional: { extra: false } });
  const optional = computeDQScore(many([meta("extra", 40)]), stats, ROWS);
  assert.ok((optional.overall ?? 0) > (plain.overall ?? 0));
  assert.deepEqual(optional.optionalColumns, [10]);
  const capped = computeDQScore(many([meta("notes", 90)]), stats, ROWS);
  assert.equal(capped.bandCap, null, "blank-by-design notes never cap the band");
  // The cells still show their real count.
  const check = optional.dimensions[0]?.checks.find((c) => c.id === "completeness.10");
  assert.equal(check?.fail, 40);
  assert.equal(check?.optional, true);
});

test("a column's score uses the dataset formula on its own checks; completeness is the column's own pass rate", async () => {
  const { columnScore } = await import("../src/data/score.js");
  const only = [meta("name", 20)];
  const score = computeDQScore(only, stats, ROWS);
  const mine = columnScore(score, 0);
  assert.ok(mine.score !== null && mine.score <= 100);
  const completeness = mine.parts.find((part) => part.dimension === "completeness");
  assert.ok(completeness !== undefined && Math.abs(completeness.rate - 80) < 1e-9, "20 of 100 blank = 80%");
  // Dataset-level checks (duplicate rows) have no column, so they stay out of a column's score.
  assert.ok(mine.parts.every((part) => part.weight > 0));
  assert.equal(columnScore(score, 5).score, null, "a column with no checks has no score");
});

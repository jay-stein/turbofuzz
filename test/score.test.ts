import { test } from "node:test";
import assert from "node:assert/strict";
import { computeDQScore } from "../src/data/score.js";
import type { DatasetStats } from "../src/data/stats.js";
import type { ColumnMeta } from "../src/worker/protocol.js";

function meta(overrides: Partial<ColumnMeta> = {}): ColumnMeta {
  return {
    name: "col",
    type: "string",
    numberLocale: "dot",
    dateOrder: "dmy",
    stats: {
      nulls: 0,
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
    ...overrides,
  };
}

function stats(overrides: Partial<DatasetStats> = {}): DatasetStats {
  return {
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
    ...overrides,
  };
}

test("weights applicable dimensions and excludes N.A. ones", () => {
  const columns = [
    meta({ name: "city" }),
    meta({ name: "email", stats: { ...meta().stats, nulls: 20 } }),
    meta({
      name: "score",
      type: "integer",
      suggestions: [
        { kind: "typeConflict", count: 10, sampled: 100, example: "high", columnType: "integer" },
      ],
    }),
    meta({
      name: "phone",
      pattern: { mask: "+9 9 9", share: 0.97, total: 100, offCount: 5, examples: ["x"] },
    }),
  ];
  const score = computeDQScore(columns, stats(), 100);

  const completeness = score.dimensions.find((d) => d.dimension === "completeness");
  assert.ok(completeness !== undefined);
  assert.equal(completeness.score, 95, "20 empty of 400 cells");

  const validity = score.dimensions.find((d) => d.dimension === "validity");
  assert.ok(validity !== undefined);
  assert.ok(
    Math.abs((validity.score ?? 0) - (365 / 380) * 100) < 1e-6,
    "15 invalid of 380 non-null",
  );
  assert.equal(validity.checks.find((c) => c.id === "validity.3")?.filter, "pattern");

  const uniqueness = score.dimensions.find((d) => d.dimension === "uniqueness");
  assert.equal(uniqueness?.score, 100);

  for (const na of ["consistency", "timeliness", "accuracy"] as const) {
    const dimension = score.dimensions.find((d) => d.dimension === na);
    assert.equal(dimension?.score, null, `${na} is N.A.`);
    assert.ok((dimension?.note ?? "").length > 0, `${na} explains why it is N.A.`);
  }
  assert.match(
    score.dimensions.find((d) => d.dimension === "accuracy")?.note ?? "",
    /reference/,
  );

  assert.ok(score.overall !== null);
  assert.ok(
    Math.abs(score.overall - (30 * 95 + 30 * (365 / 380) * 100 + 15 * 100) / 75) < 1e-6,
    "weighted over three dimensions",
  );
  assert.equal(score.band, "good");

  // Advisory-only signals never move the score.
  const quiet = computeDQScore(
    [meta({ name: "city" })],
    stats({ valueAnomalyRows: 50, lengthAnomalyRows: 20 }),
    100,
  );
  assert.equal(quiet.dimensions.find((d) => d.dimension === "completeness")?.score, 100);
});

test("user-run checks score consistency and timeliness", () => {
  const userChecks = [
    {
      id: "consistency.pair",
      dimension: "consistency" as const,
      label: "“a” ≤ “b”",
      detail: "90 rows compared",
      pass: 90,
      fail: 10,
      na: 0,
      column: null,
      filter: "pairCheck" as const,
      fixLabel: "Show failing",
    },
    {
      id: "timeliness.freshness",
      dimension: "timeliness" as const,
      label: "“day” is fresh (≤ 30 days)",
      detail: "newest value 2026-10-01",
      pass: 0,
      fail: 1,
      na: 0,
      column: null,
      filter: null,
      fixLabel: null,
    },
  ];
  const score = computeDQScore([meta({ name: "city" })], stats(), 100, {}, userChecks);

  const consistency = score.dimensions.find((d) => d.dimension === "consistency");
  assert.equal(consistency?.score, 90, "pair violations become the dimension score");
  assert.equal(consistency?.note, null, "the N.A. note disappears once a check runs");
  assert.equal(consistency?.checks[0]?.id, "consistency.pair");
  assert.equal(consistency?.checks[0]?.filter, "pairCheck");
  assert.equal(score.dimensions.find((d) => d.dimension === "timeliness")?.score, 0);

  // 30·100 + 30·100 + 15·100 + 15·90 + 10·0 over a weight sum of 100.
  assert.ok(score.overall !== null && Math.abs(score.overall - 88.5) < 1e-6);
  assert.equal(score.band, "fair");

  // Weights and bands come from the config.
  const strict = computeDQScore(
    [meta({ name: "city" })],
    stats(),
    100,
    { bandGood: 85 },
    userChecks,
  );
  assert.equal(strict.band, "good", "a lower good-band reclassifies the same score");
  const noValidity = computeDQScore(
    [meta({ name: "city", stats: { ...meta().stats, nulls: 10 } })],
    stats(),
    100,
    { weights: { completeness: 100, validity: 0 } },
  );
  assert.ok(
    noValidity.overall !== null &&
      Math.abs(noValidity.overall - (100 * 90 + 15 * 100) / 115) < 1e-6,
    "zero-weight dimensions drop out of the overall",
  );
});

test("a text fallback that could be integer lowers validity", () => {
  const downgraded = meta({
    name: "amount",
    type: "string",
    typeDowngrade: { candidate: "integer", share: 0.94, ok: 94, total: 100, examples: ["TBC"] },
  });
  const score = computeDQScore([downgraded], stats(), 100);
  const validity = score.dimensions.find((d) => d.dimension === "validity");
  assert.ok(validity !== undefined);
  const check = validity.checks.find((c) => c.id === "validity.downgrade.0");
  assert.ok(check !== undefined, "the downgrade check exists");
  assert.equal(check.fail, 6, "6% of non-null rows do not fit");
  assert.equal(check.convertTo, "integer");
  assert.equal(check.fixLabel, "Convert to Integer");
  assert.match(check.label, /stored as Text/);
  assert.ok((validity.score ?? 0) < 100, "validity drops below a clean text column");
  assert.equal(validity.score, 97, "clean check 100% + downgrade 94% over both check counts");

  const clean = computeDQScore([meta({ name: "amount", type: "string" })], stats(), 100);
  assert.equal(clean.dimensions.find((d) => d.dimension === "validity")?.score, 100);
});

test("provenance columns are excluded from the quality score", () => {
  const score = computeDQScore(
    [
      meta({ name: "value", stats: { ...meta().stats, nulls: 0 } }),
      meta({ name: "_input_filename", role: "provenance", stats: { ...meta().stats, nulls: 50 } }),
    ],
    stats({ totalCells: 200 }),
    100,
  );
  const checks = score.dimensions.flatMap((dimension) => dimension.checks);
  assert.ok(checks.some((check) => check.label.includes("value")));
  assert.equal(checks.some((check) => check.label.includes("_input_filename")), false);
});
test("a range check the analyst reviewed stops counting, and comes back when more rows are affected", () => {
  const year = (count: number) => meta({
    name: "birth year",
    type: "integer",
    rangeViolation: { rule: "year", sentence: "A year is between 1900 and 2027", min: 1900, max: 2027, count, checked: 100, examples: ["-63", "14"] },
  });
  const rangeCheck = (config: Parameters<typeof computeDQScore>[3], count: number) =>
    computeDQScore([year(count)], stats({ totalCells: 100 }), 100, config).dimensions.flatMap((d) => d.checks).find((c) => c.id === "validity.range.0");
  const plain = rangeCheck({}, 9);
  assert.equal(plain?.fail, 9);
  // Reviewed at 9 rows: set aside, counted as passing.
  const setAside = rangeCheck({ reviewed: { "validity.range.0": 9 } }, 9);
  assert.equal(setAside?.fail, 0);
  assert.equal(setAside?.pass, 100);
  assert.match(setAside?.detail ?? "", /reviewed and set aside/);
  // Fewer rows later: still set aside. More rows: it counts again.
  assert.equal(rangeCheck({ reviewed: { "validity.range.0": 9 } }, 4)?.fail, 0);
  assert.equal(rangeCheck({ reviewed: { "validity.range.0": 9 } }, 12)?.fail, 12);
});

// A 100,000-row table whose cells are almost all fine (weighted dimensions near 99) but 10% of rows fail a check.
function orders(): { columns: ColumnMeta[]; rows: number } {
  const rows = 100000;
  const columns = Array.from({ length: 30 }, (_, i) => meta({ name: `c${i}` }));
  columns[0] = meta({ name: "email", stats: { ...meta().stats, nulls: 20000 } });
  return { columns, rows };
}

test("the headline is held to the share of clean rows, so 10% failing rows is not good", () => {
  const { columns, rows } = orders();
  const cellsOnly = computeDQScore(columns, stats({ totalCells: rows * 30 }), rows);
  assert.ok((cellsOnly.overall ?? 0) > 99, "the cell average alone reads as nearly perfect");
  assert.equal(cellsOnly.rowLimit, null, "no limit until the rows are counted");
  const limited = computeDQScore(columns, stats({ totalCells: rows * 30 }), rows, {
    rowsAffected: { count: 10114, total: rows },
  });
  assert.ok(Math.abs((limited.overall ?? 0) - 80.8) < 0.1, `100 × 0.8989² ≈ 80.8; got ${limited.overall}`);
  assert.equal(limited.band, "fair");
  assert.equal(limited.bandReason, "Fair because 10% of rows fail at least one check");
  assert.equal(limited.rowLimit?.limiting, true);
  // Per-dimension scores are untouched.
  assert.equal(limited.dimensions[0]?.score, cellsOnly.dimensions[0]?.score);
});

test("fixing rows moves the headline: 1% reads about 98, a clean table 100", () => {
  const { columns, rows } = orders();
  const at = (count: number) =>
    computeDQScore(columns.map((c) => meta({ name: c.name })), stats({ totalCells: rows * 30 }), rows, {
      rowsAffected: { count, total: rows },
    });
  assert.equal(at(0).overall, 100);
  assert.equal(at(0).bandReason, null);
  assert.ok(Math.abs((at(1000).overall ?? 0) - 98.01) < 0.01);
  assert.equal(at(1000).band, "good");
  assert.equal(at(1000).bandReason, null, "the number alone, no row reason when the band is unchanged");
  assert.ok((at(5000).overall ?? 0) > 90 && (at(10000).overall ?? 0) < 90);
});

test("a stale row count, from another table size, is ignored", () => {
  const columns = [meta({ name: "a" })];
  const score = computeDQScore(columns, stats(), 100, { rowsAffected: { count: 50, total: 80 } });
  assert.equal(score.overall, 100);
  assert.equal(score.rowLimit, null);
});

test("user weights keep their meaning: the row ceiling only ever lowers the weighted mean", () => {
  const columns = [
    meta({ name: "a", stats: { ...meta().stats, nulls: 50 } }),
    meta({ name: "b", stats: { ...meta().stats, nulls: 50 } }),
  ];
  const heavy = { weights: { completeness: 100, validity: 0, uniqueness: 0, consistency: 0, timeliness: 0 } };
  const noRows = computeDQScore(columns, stats(), 100, heavy);
  assert.equal(noRows.overall, 50);
  const rows = computeDQScore(columns, stats(), 100, { ...heavy, rowsAffected: { count: 5, total: 100 } });
  assert.equal(rows.overall, 50, "a ceiling of 90.25 does not lift a 50");
  assert.equal(rows.rowLimit?.limiting, false);
});

test("a column cap keeps its own reason when it is what lowers the band", () => {
  const columns = [meta({ name: "Region", stats: { ...meta().stats, nulls: 60 } }), meta({ name: "b", stats: { ...meta().stats, nulls: 10 } }), ...Array.from({ length: 12 }, (_, i) => meta({ name: `x${i}` }))];
  const score = computeDQScore(columns, stats(), 100, { rowsAffected: { count: 5, total: 100 } });
  assert.equal(score.band, "fair");
  assert.match(score.bandReason ?? "", /^Fair because “Region” is 60% empty/);
});

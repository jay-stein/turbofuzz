import { test } from "node:test";
import assert from "node:assert/strict";
import { computeDQScore } from "../src/data/score.js";
import {
  buildDQReport,
  dqReportCsv,
  dqReportMarkdown,
  emitDQChecks,
} from "../src/data/dq-report.js";
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

function stats(): DatasetStats {
  return {
    duplicateRows: 0,
    duplicateGroups: 0,
    rowsInDuplicateGroups: 0,
    emptyRows: 0,
    rowsWithNulls: 0,
    totalNullCells: 0,
    totalCells: 300,
    valueAnomalyRows: 0,
    lengthAnomalyRows: 0,
    computeMs: 1,
  };
}

test("the report serialises the score as markdown, json and csv", () => {
  const columns = [
    meta({ name: "city" }),
    meta({ name: "email", stats: { ...meta().stats, nulls: 20 } }),
  ];
  const score = computeDQScore(columns, stats(), 100);
  const report = buildDQReport(score, "melb", 100, 2, "2026-10-16T00:00:00.000Z");

  const markdown = dqReportMarkdown(report);
  assert.match(markdown, /# Data quality report — melb/);
  assert.match(markdown, /\| Completeness \| 90\.0 \| 30 \|/);
  assert.match(markdown, /“email” is populated/);

  const csv = dqReportCsv(report);
  assert.match(csv.split("\n")[0] ?? "", /dimension,check,detail,pass,fail,na/);
  assert.match(csv, /"“email” is populated"/);
});

test("emitters translate discovered checks and note what they cannot", () => {
  const columns = [
    meta({ name: "city" }),
    meta({ name: "id", type: "identifier" }),
    meta({ name: "email", stats: { ...meta().stats, nulls: 20 } }),
    meta({
      name: "phone",
      pattern: { mask: "+9 9 9", share: 0.97, total: 100, offCount: 5, examples: ["x"] },
    }),
  ];
  const emitted = emitDQChecks(columns, "melb data!");

  assert.match(emitted.sodacl, /checks for melb_data:/);
  assert.match(emitted.sodacl, /missing_count\("city"\) = 0/);
  assert.ok(!emitted.sodacl.includes('missing_count("email")'), "failing columns are not emitted");

  assert.match(emitted.dbt, /data_tests: \[not_null\]/);
  assert.match(emitted.dbt, /name: id[\s\S]*data_tests: \[unique\]/);

  const gx = JSON.parse(emitted.gx) as { melb_data: { expectations: unknown[] } };
  assert.ok(gx.melb_data.expectations.length >= 3);

  assert.match(emitted.dqdl, /IsComplete "city"/);
  assert.match(emitted.dqdl, /IsUnique "id"/);

  const support = emitted.support.join("\n");
  assert.match(support, /“email”: 20 empty cells/);
  assert.match(support, /“phone”: dominant format/);
});

test("the HTML report is self-contained, escapes text and hides values of flagged columns", async () => {
  const { buildDQReport, dqReportHtml } = await import("../src/data/dq-report.js");
  const score = {
    overall: 80,
    band: "fair",
    dimensions: [
      {
        dimension: "validity",
        label: "Validity",
        abbreviation: "Val",
        score: 80,
        weight: 1,
        note: null,
        checks: [
          { id: "validity.range.2", dimension: "validity", label: "age in range", detail: "2 values outside (e.g. 4111111111111111)", pass: 8, fail: 2, na: 0, column: 2, filter: null, fixLabel: null },
          { id: "validity.3", dimension: "validity", label: "city ok", detail: "1 odd (e.g. Syd)", pass: 9, fail: 1, na: 0, column: 3, filter: null, fixLabel: null },
        ],
      },
    ],
  } as unknown as Parameters<typeof buildDQReport>[0];
  const report = buildDQReport(score, "<b>sales</b>.csv", 10, 4, "2026-10-29T00:00:00.000Z", {
    sensitiveColumns: new Set([2]),
    issues: [
      { severity: "fix", title: "card has odd values", evidence: "4111111111111111", rows: 2, column: 2 },
      { severity: "fix", title: "city has 2 spellings", evidence: "Syd, Sydney", rows: 3, column: 3 },
    ],
    trend: [{ at: 0, overall: 70 }],
  });
  const html = dqReportHtml(report);
  assert.doesNotMatch(html, /4111111111111111/);
  assert.match(html, /Syd, Sydney/);
  assert.match(html, /&lt;b&gt;sales&lt;\/b&gt;/);
  assert.doesNotMatch(html, /<script|<link|src=/);
  assert.equal(report.scoreVersion, 4);
});

test("the HTML and Markdown reports carry the raw load beside the cleaned data, and each step's points add up", async () => {
  const { buildDQReport, dqReportHtml, dqReportMarkdown } = await import("../src/data/dq-report.js");
  const side = (overall: number, extra: Record<string, unknown> = {}) => ({
    overall,
    band: overall >= 90 ? "good" : overall >= 75 ? "fair" : "poor",
    rowCount: 100,
    rowsAffected: 30,
    emptyCells: 40,
    duplicateRows: 5,
    dimensions: [{ dimension: "completeness", label: "Completeness", score: 61.04 }],
    columns: [{ name: "region", type: "category", score: 58.2, fill: 0.85 }],
    groups: [],
    issues: 6,
    ...extra,
  });
  const score = { overall: 91.66, band: "good", dimensions: [] } as unknown as Parameters<typeof buildDQReport>[0];
  const cleaning = {
    before: side(68.21) as never,
    after: side(91.66, { rowsAffected: 4, emptyCells: 2, duplicateRows: 0, rowCount: 95, issues: 1, dimensions: [{ dimension: "completeness", label: "Completeness", score: 93.8 }], columns: [{ name: "region", type: "category", score: 99, fill: 1 }] }) as never,
    steps: [{ label: "Junk data", overall: 74.04 }, { label: "<Fill> region", overall: 91.66 }],
  };
  const report = buildDQReport(score, "people.csv", 95, 1, "2026-11-23T00:00:00.000Z", {
    cleaning,
    columnTable: [{ column: 0, name: "region", type: "category", score: 99, fill: 1 }],
  });
  assert.deepEqual(report.cleaning?.steps.map((step) => step.points), [5.8, 17.7]);
  const total = report.cleaning!.steps.reduce((sum, step) => sum + (step.points ?? 0), 0);
  assert.equal(Math.round(total * 10) / 10, Math.round((report.cleaning!.after.overall! - report.cleaning!.before.overall!) * 10) / 10);
  const html = dqReportHtml(report);
  assert.match(html, /<small>Raw load<\/small><b>68\.2<\/b>/);
  assert.match(html, /After cleaning \(2 steps\)<\/small><b>91\.7<\/b> \/ 100 good <span class="up">\+23\.5<\/span>/);
  assert.match(html, /<h2>Before and after cleaning<\/h2>/);
  assert.match(html, /<td>Rows failing a check<\/td><td>30<\/td><td>4<\/td><td>−26<\/td>/);
  assert.match(html, /<td>Completeness<\/td><td>61\.0<\/td><td>93\.8<\/td><td>\+32\.8<\/td>/);
  assert.match(html, /<td>2<\/td><td>&lt;Fill&gt; region<\/td><td>91\.7<\/td><td>\+17\.7<\/td>/);
  assert.match(html, /<th>Score at load<\/th>/);
  assert.match(html, /<td>region<\/td><td>category<\/td><td>58<\/td><td>99<\/td><td>85%<\/td><td>100%<\/td>/);
  const markdown = dqReportMarkdown(report);
  assert.match(markdown, /## Before and after cleaning/);
  assert.match(markdown, /\| Score \| 68\.2 \| 91\.7 \| \+23\.5 \|/);
  assert.match(markdown, /\| 1 \| Junk data \| 74\.0 \| \+5\.8 \|/);
  // No step yet: no before-and-after section, the single score as before.
  const untouched = dqReportHtml(buildDQReport(score, "people.csv", 95, 1, "2026-11-23T00:00:00.000Z", { cleaning: { ...cleaning, steps: [] } }));
  assert.doesNotMatch(untouched, /Before and after cleaning/);
  assert.match(untouched, /<span class="score">91\.7<\/span>/);
});

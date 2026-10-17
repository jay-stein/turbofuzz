import { test } from "node:test";
import assert from "node:assert/strict";
import { computeDQScore } from "../src/data/score.js";
import {
  buildDQReport,
  dqReportCsv,
  dqReportJson,
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

  const json = JSON.parse(dqReportJson(report)) as { dataset: string; overall: number };
  assert.equal(json.dataset, "melb");
  assert.ok(json.overall > 80);

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

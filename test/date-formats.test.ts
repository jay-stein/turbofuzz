import { test } from "node:test";
import assert from "node:assert/strict";
import { summariseDateFormats } from "../src/data/date-formats.js";
import { computeDQScore } from "../src/data/score.js";
import { buildIssues } from "../src/data/dq-issues.js";
import type { ColumnMeta } from "../src/worker/protocol.js";
import type { DatasetStats } from "../src/data/stats.js";

const none = (): boolean => false;

test("one format yields no summary", () => {
  assert.equal(summariseDateFormats(["2023-01-02", "2023-02-03"], none), null);
  assert.equal(summariseDateFormats([], none), null);
});

test("iso plus slashed dates: exact split, order from an unambiguous value", () => {
  const values = ["2023-01-02", "2023-03-04", "2023-05-06", "25/12/2023", "03/04/2023"];
  const summary = summariseDateFormats(values, none);
  assert.ok(summary !== null);
  assert.equal(summary.total, 5);
  assert.equal(summary.minority, 2);
  assert.equal(summary.formats[0]?.label, "yyyy-mm-dd");
  assert.equal(summary.formats[1]?.label, "dd/mm/yyyy");
  assert.equal(summary.order, "dmy");
  assert.equal(summary.ambiguous, false);
});

test("slashed dates with day and month both <= 12 are ambiguous", () => {
  const summary = summariseDateFormats(["2023-01-02", "2023-02-03", "03/04/2023"], none);
  assert.ok(summary !== null);
  assert.equal(summary.ambiguous, true);
  assert.equal(summary.order, null);
  assert.match(summary.formats[1]?.label ?? "", /dd\/mm\/yyyy or mm\/dd\/yyyy/);
});

test("missing placeholders are not counted as a format", () => {
  const summary = summariseDateFormats(["2023-01-02", "N/A", "2023-02-03", "13/02/2023"], (v) => v === "N/A");
  assert.equal(summary?.total, 3);
});

function dateMeta(): ColumnMeta {
  const values = ["2023-01-02", "2023-03-04", "2023-05-06", "2023-07-08", "25/12/2023"];
  return {
    name: "signup_date",
    type: "date",
    numberLocale: "dot",
    dateOrder: "dmy",
    stats: {
      nulls: 0, distinct: 5, samples: values, topValues: [], min: null, max: null, mean: null,
      stddev: null, minLength: null, maxLength: null, avgLength: null,
    },
    anomalyCounts: { values: 0, lengths: 0 },
    similarGroups: 0, categories: null, histogram: null, valueFence: null, lengthFence: null,
    nullPolicy: { extra: [], keep: [] }, nullTokens: [], suggestions: [],
    dateFormats: summariseDateFormats(values, none),
  };
}

const stats: DatasetStats = {
  duplicateRows: 0, duplicateGroups: 0, rowsInDuplicateGroups: 0, emptyRows: 0, rowsWithNulls: 0,
  totalNullCells: 0, totalCells: 5, valueAnomalyRows: 0, lengthAnomalyRows: 0, computeMs: 1,
};

test("mixed date formats lower Validity and become one fixable issue with a toDate step", () => {
  const metas = [dateMeta()];
  const score = computeDQScore(metas, stats, 5);
  const check = score.dimensions.flatMap((d) => d.checks).find((c) => c.id === "validity.dateformat.0");
  assert.equal(check?.fail, 1);
  assert.equal(check?.pass, 4);
  const issues = buildIssues({ score, metas, rowCount: 5, review: [], sensitiveColumns: new Set() });
  const issue = issues.find((i) => i.kind === "dateFormat");
  assert.ok(issue !== undefined);
  assert.equal(issue.severity, "fix");
  assert.equal(issue.fixes[0]?.kind, "dateFormat");
  assert.equal(issue.dist?.after[0]?.count, 5, "AFTER CLEAN sums to every dated row");
  assert.ok((issue.points ?? 0) > 0);
});

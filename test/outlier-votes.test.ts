import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreOfRow, votesForRow } from "../src/data/outlier-votes.js";
import type { OutlierAnalysisMessage, OutlierMethod } from "../src/worker/protocol.js";

function result(
  method: OutlierMethod,
  rows: number[],
  scores: number[],
  threshold: number,
  z = 8,
): OutlierAnalysisMessage {
  return {
    type: "outlierAnalysis",
    requestId: 1,
    method,
    mode: "quick",
    labels: ["amount"],
    columns: [0],
    scores: Float32Array.from(scores),
    rowIndices: Uint32Array.from(rows),
    threshold,
    flagged: scores.filter((score) => score >= threshold).length,
    analyzed: rows.length,
    excluded: 0,
    sampled: false,
    totalRows: rows.length,
    projected: false,
    projectionComponents: 0,
    omittedFeatures: 0,
    details: [
      {
        row: 2,
        score: scores[rows.indexOf(2)] ?? 0,
        contributions: [
          { column: 0, label: "amount", value: 900, median: 20, z, contribution: 1 },
        ],
        values: ["900"],
      },
    ],
    featureImportance: [],
    visualRows: new Uint32Array(0),
    visualX: new Float32Array(0),
    visualY: new Float32Array(0),
    visualFlagged: new Uint8Array(0),
    ms: 1,
  };
}

const describe = (c: { label: string; value: number }): string => `${c.label} ${c.value} is far above typical`;

test("scoreOfRow finds rows by binary search and returns null for unscored rows", () => {
  const r = result("pca", [0, 2, 5, 9], [0.1, 0.9, 0.3, 0.2], 0.5);
  assert.ok(Math.abs((scoreOfRow(r, 2) ?? 0) - 0.9) < 1e-6);
  assert.equal(scoreOfRow(r, 3), null);
  const shuffled = result("pca", [5, 2, 9], [0.3, 0.9, 0.2], 0.5);
  assert.ok(Math.abs((scoreOfRow(shuffled, 2) ?? 0) - 0.9) < 1e-6, "falls back to a scan");
});

test("a row flagged by every method that ran is high confidence", () => {
  const rows = [0, 1, 2, 3];
  const votes = votesForRow(
    2,
    {
      isolationForest: result("isolationForest", rows, [0.1, 0.1, 0.9, 0.2], 0.5),
      pca: result("pca", rows, [0.1, 0.2, 0.8, 0.1], 0.5),
      lof: result("lof", rows, [0.2, 0.1, 0.7, 0.3], 0.5),
    },
    describe,
  );
  assert.equal(votes.ran, 4, "three methods plus the extreme-value voter");
  assert.equal(votes.flagged, 4);
  assert.equal(votes.confidence, "high");
  assert.match(votes.headline, /4 of 4 methods flag this row/);
  assert.match(votes.voters[0]?.why ?? "", /isolated unusually quickly/);
  assert.match(votes.voters[0]?.why ?? "", /mostly amount 900 is far above typical/);
});

test("one dissenting method lowers confidence and explains the disagreement", () => {
  const rows = [0, 1, 2, 3];
  const votes = votesForRow(
    2,
    {
      isolationForest: result("isolationForest", rows, [0.1, 0.1, 0.9, 0.2], 0.5, 1),
      pca: result("pca", rows, [0.1, 0.2, 0.1, 0.1], 0.5, 1),
      lof: result("lof", rows, [0.2, 0.1, 0.2, 0.3], 0.5, 1),
    },
    describe,
  );
  assert.equal(votes.flagged, 1);
  assert.equal(votes.confidence, "low");
  const pca = votes.voters.find((voter) => voter.id === "pca");
  assert.equal(pca?.flagged, false);
  assert.match(pca?.why ?? "", /Looks normal/);
  const extreme = votes.voters.find((voter) => voter.id === "extreme");
  assert.equal(extreme?.flagged, false, "z of 1 is not an extreme value");
});

test("methods that have not run are not counted", () => {
  const rows = [0, 1, 2, 3];
  const votes = votesForRow(
    2,
    { isolationForest: result("isolationForest", rows, [0.1, 0.1, 0.9, 0.2], 0.5) },
    describe,
  );
  assert.equal(votes.voters.find((voter) => voter.id === "pca")?.ran, false);
  assert.equal(votes.ran, 2, "Isolation Forest plus the extreme-value voter");
  const alone = votesForRow(2, {}, describe);
  assert.equal(alone.confidence, "unknown");
  assert.equal(alone.ran, 0);
});

test("rows with missing values cannot be scored", () => {
  const votes = votesForRow(
    7,
    { isolationForest: result("isolationForest", [0, 1, 2], [0.1, 0.2, 0.9], 0.5) },
    describe,
  );
  const forest = votes.voters.find((voter) => voter.id === "isolationForest");
  assert.equal(forest?.ran, false);
  assert.match(forest?.why ?? "", /missing values/);
});

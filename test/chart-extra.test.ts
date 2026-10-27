import { test } from "node:test";
import assert from "node:assert/strict";
import {
  dotAxis,
  foldGroups,
  dotPlotRows,
  panelGrid,
  shareRows,
  slopeLines,
  splitMatrix,
  spreadLabels,
  waterfallSteps,
} from "../src/ui/chart-extra.js";

// Three buckets (2023, 2024, 2025) x groups East, West. West is missing 2024.
const bucketLabels = ["2023", "2023", "2024", "2025", "2025"];
const groupLabels = ["East", "West", "East", "East", "West"];
const values = [10, 30, 20, 40, 10];

test("splitMatrix pivots bucket x group and orders groups by size", () => {
  const m = splitMatrix(bucketLabels, groupLabels, values, 5);
  assert.deepEqual(m.buckets, ["2023", "2024", "2025"]);
  assert.deepEqual(m.groups, ["East", "West"], "East totals 70, West 40");
  assert.deepEqual([...m.values[0]], [10, 20, 40]);
  assert.ok(Number.isNaN(m.values[1][1]), "a missing bucket stays NaN");
  assert.deepEqual(m.totals, [70, 40]);
});

test("dotPlotRows sorts largest first, caps and drops non-finite values", () => {
  const rows = dotPlotRows(["a", "b", "c", "d"], [5, Number.NaN, 9, 7], 4, 2);
  assert.deepEqual(rows.map((r) => r.label), ["c", "d"]);
  assert.equal(rows[0].index, 2, "keeps the position in the aggregate");
});

test("dotAxis starts at zero only when that is honest", () => {
  assert.deepEqual(dotAxis([2, 10]), { min: 0, max: 10.5, fromZero: true });
  const tight = dotAxis([95, 100, 98]);
  assert.ok(tight.min > 80 && tight.min < 95, "values near each other get a padded, non-zero axis");
  assert.equal(tight.fromZero, false);
  assert.deepEqual(dotAxis([]), { min: 0, max: 1, fromZero: true });
});

test("shareRows turn each bucket into shares that sum to 1", () => {
  const rows = shareRows(splitMatrix(bucketLabels, groupLabels, values, 5));
  assert.deepEqual(rows.map((r) => r.label), ["2023", "2024", "2025"]);
  assert.deepEqual(rows[0].shares, [0.25, 0.75]);
  assert.deepEqual(rows[1].shares, [1, 0], "a missing group is a zero share");
  for (const row of rows) assert.ok(Math.abs(row.shares.reduce((a, b) => a + b, 0) - 1) < 1e-9);
});

test("waterfallSteps run a total and close with a total bar", () => {
  const steps = waterfallSteps(["Start", "Gain", "Loss"], [100, 40, -30], 3);
  assert.deepEqual(
    steps.map((s) => [s.label, s.start, s.end, s.total]),
    [["Start", 0, 100, false], ["Gain", 100, 140, false], ["Loss", 140, 110, false], ["Total", 0, 110, true]],
  );
  assert.equal(waterfallSteps(["a"], [Number.NaN], 1)[0].delta, 0);
});

test("slopeLines connect two moments and skip groups missing an end", () => {
  const { lines, from, to, skipped } = slopeLines(splitMatrix(bucketLabels, groupLabels, values, 5));
  assert.equal(from, "2023");
  assert.equal(to, "2025");
  assert.deepEqual(lines, [
    { label: "East", from: 10, to: 40 },
    { label: "West", from: 30, to: 10 },
  ]);
  assert.equal(skipped, 0);
  const one = slopeLines(splitMatrix(["x", "x"], ["a", "b"], [1, 2], 2));
  assert.equal(one.lines.length, 0, "one bucket has no slope");
});

test("slopeLines pick ends where the lines have data and avoid incomplete periods", () => {
  // Sparse first week (only A), full middle weeks, partial last week.
  const buckets = ["w1", "w2", "w2", "w3", "w3", "w4"];
  const groups = ["A", "A", "B", "A", "B", "A"];
  const m = splitMatrix(buckets, groups, [1, 2, 4, 3, 5, 9], 6);
  const sparse = slopeLines(m);
  assert.deepEqual([sparse.from, sparse.to], ["w2", "w3"], "ends are the first and last buckets with every line");
  assert.equal(sparse.lines.length, 2, "no line is dropped for a sparse edge");
  const avoided = slopeLines(m, new Set(["w1", "w4"]));
  assert.deepEqual([avoided.from, avoided.to], ["w2", "w3"]);
  assert.equal(avoided.periods, 4);
});

test("spreadLabels keeps labels apart, inside bounds, in input order", () => {
  const out = spreadLabels([50, 51, 52, 200], 14, 10, 220);
  const sorted = [...out].sort((a, b) => a - b);
  for (let i = 1; i < sorted.length; i++) assert.ok(sorted[i] - sorted[i - 1] >= 14 - 1e-9);
  assert.ok(out.every((y) => y >= 10 && y <= 220));
  assert.ok(out[0] <= out[1] && out[1] <= out[2], "relative order survives");
});

test("panelGrid lays out equal panels without overflowing", () => {
  const { cols, rows, cells } = panelGrid(6, 600, 300, 8);
  assert.equal(cells.length, 6);
  assert.ok(cols * rows >= 6);
  for (const c of cells) assert.ok(c.x + c.w <= 600 + 1e-9 && c.y + c.h <= 300 + 1e-9);
  assert.equal(panelGrid(1, 300, 200, 8).cells[0].w, 300);
});

test("foldGroups keeps the largest groups and sums the rest into Other", () => {
  // Totals: z = 6, x = 5, y = 3, so z is kept and x + y fold together.
  const m = splitMatrix(["a", "a", "a", "b"], ["x", "y", "z", "z"], [5, 3, 2, 4], 4);
  const folded = foldGroups(m, 1);
  assert.deepEqual(folded.groups, ["z", "Other"]);
  assert.equal(folded.values[1][0], 8, "x and y add up in bucket a");
  assert.ok(Number.isNaN(folded.values[1][1]), "bucket b has no x or y rows");
  assert.equal(folded.totals[1], 8);
  assert.equal(foldGroups(m, 5), m, "nothing to fold leaves the matrix alone");
});

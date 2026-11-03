import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDataset } from "../src/data/build.js";
import { knnEvaluate, knnImputeDetailed, knnKindOf, knnPredictorScores } from "../src/data/knn.js";

/** Area is roughly rooms x 40 plus noise; some areas are missing. Region goes with the rooms. */
function houses(count = 400) {
  const headers = ["rooms", "price", "region", "area", "id"];
  const rows: string[][] = [];
  for (let i = 0; i < count; i++) {
    const rooms = 1 + (i % 5);
    const noise = ((i * 7919) % 13) - 6;
    const area = rooms * 40 + noise;
    const region = rooms >= 4 ? "North" : rooms >= 2 ? "Central" : "South";
    rows.push([String(rooms), String(rooms * 100_000 + noise * 1000), region, i % 4 === 0 ? "" : String(area), String(i)]);
  }
  return buildDataset("houses", headers, rows);
}

test("KNN fills the empty cells of a number column from similar rows and says which cells it filled", () => {
  const data = houses();
  const result = knnImputeDetailed(data.columns, [3], [0, 1], 5);
  const mask = result.filled.get(3);
  assert.ok(mask);
  const empties = data.columns[3].raw.filter((value) => value === "").length;
  assert.equal(mask.reduce((sum, flag) => sum + flag, 0), empties);
  // Rooms drive area here, so the filled value tracks the rooms (40 per room, give or take the noise).
  for (let row = 0; row < data.rowCount; row++) {
    if (mask[row] !== 1) continue;
    const rooms = Number(data.columns[0].raw[row]);
    assert.ok(Math.abs(Number(result.columns[3].raw[row]) - rooms * 40) <= 8, `row ${row}`);
  }
  // Cells that were known are untouched.
  assert.equal(result.columns[3].raw[1], data.columns[3].raw[1]);
});

test("the column being filled is never used to measure similarity", () => {
  const data = houses();
  const alone = knnImputeDetailed(data.columns, [3], [3, 0, 1], 5);
  const without = knnImputeDetailed(data.columns, [3], [0, 1], 5);
  assert.deepEqual(alone.columns[3].raw, without.columns[3].raw);
});

test("KNN can fill a text column with the most common value among the nearest rows", () => {
  const rows: string[][] = [];
  for (let i = 0; i < 300; i++) {
    const rooms = 1 + (i % 5);
    const region = rooms >= 4 ? "North" : rooms >= 2 ? "Central" : "South";
    rows.push([String(rooms), i % 6 === 0 ? "" : region]);
  }
  const data = buildDataset("t", ["rooms", "region"], rows);
  assert.equal(knnKindOf(data.columns[1]), "category");
  const result = knnImputeDetailed(data.columns, [1], [0], 5);
  for (let row = 0; row < rows.length; row++) {
    const rooms = 1 + (row % 5);
    const expected = rooms >= 4 ? "North" : rooms >= 2 ? "Central" : "South";
    assert.equal(result.columns[1].raw[row], expected, `row ${row}`);
  }
  assert.equal(result.filled.get(1)?.reduce((sum, flag) => sum + flag, 0), 50);
});

test("category predictors take part in the distance", () => {
  const rows: string[][] = [];
  for (let i = 0; i < 300; i++) {
    const kind = i % 2 === 0 ? "A" : "B";
    rows.push([kind, i % 5 === 0 ? "" : kind === "A" ? "10" : "90"]);
  }
  const data = buildDataset("t", ["kind", "value"], rows);
  const result = knnImputeDetailed(data.columns, [1], [0], 3);
  for (let row = 0; row < rows.length; row += 5) {
    assert.equal(result.columns[1].raw[row], row % 2 === 0 ? "10" : "90", `row ${row}`);
  }
});

test("the test hides known values and beats the plain median, and a k is suggested", () => {
  const data = houses();
  const evaluation = knnEvaluate(data.columns, 3, [0, 1]);
  assert.ok(evaluation);
  assert.equal(evaluation.kind, "number");
  assert.equal(evaluation.missing, 100);
  assert.ok(evaluation.tested >= 30);
  assert.ok(evaluation.results.length >= 3);
  const best = Math.min(...evaluation.results.map((entry) => entry.score));
  assert.ok(best < evaluation.baseline.score / 2, `KNN ${best} against the median ${evaluation.baseline.score}`);
  assert.ok(evaluation.results.some((entry) => entry.k === evaluation.bestK));
  assert.ok(evaluation.preview.length > 0);
  for (const sample of evaluation.preview) {
    assert.equal(data.columns[3].raw[sample.row], "");
    assert.ok(sample.neighbours.length > 0);
    assert.notEqual(data.columns[3].raw[sample.neighbours[0]], "");
  }
  // The same test gives the same answer twice.
  assert.deepEqual(knnEvaluate(data.columns, 3, [0, 1])?.results, evaluation.results);
});

test("a text column is tested by how often the fill matches the hidden truth", () => {
  const rows: string[][] = [];
  for (let i = 0; i < 400; i++) {
    const rooms = 1 + (i % 5);
    rows.push([String(rooms), i % 7 === 0 ? "" : rooms >= 4 ? "North" : rooms >= 2 ? "Central" : "South"]);
  }
  const data = buildDataset("t", ["rooms", "region"], rows);
  const evaluation = knnEvaluate(data.columns, 1, [0]);
  assert.ok(evaluation);
  assert.equal(evaluation.kind, "category");
  assert.ok(Math.max(...evaluation.results.map((entry) => entry.score)) > 0.95);
  assert.ok(evaluation.baseline.score < 0.5);
});

test("predictors are ranked by how strongly they go with the column and unusable ones say why", () => {
  const data = houses();
  const scores = knnPredictorScores(data.columns, 3);
  const byName = new Map(scores.map((entry) => [entry.name, entry]));
  assert.equal(byName.get("area")?.reason, "this is the column being filled");
  // Rooms is stored as a category here but holds numbers, so it counts as one.
  assert.equal(byName.get("rooms")?.kind, "number");
  assert.ok((byName.get("rooms")?.relatedness ?? 0) > 0.9);
  assert.ok((byName.get("price")?.relatedness ?? 0) > 0.9);
  assert.ok((byName.get("region")?.relatedness ?? 0) > 0.7);
  assert.match(byName.get("id")?.reason ?? "", /ID/);
});

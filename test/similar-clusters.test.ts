import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDataset } from "../src/data/build.js";
import { computeSimilarClusters } from "../src/data/similar-clusters.js";
import { similarClusterFindings } from "../src/data/findings.js";

function ids(count: number): Uint32Array {
  return Uint32Array.from({ length: count }, (_, index) => index);
}

test("near-duplicate values cluster under phonetic blocking", () => {
  const rows: string[][] = [];
  for (let i = 0; i < 5; i++) rows.push(["Brunswick", "1"]);
  for (let i = 0; i < 2; i++) rows.push(["Brunsick", "2"]);
  for (let i = 0; i < 3; i++) rows.push(["Preston", "3"]);
  rows.push(["Prestton", "4"]);
  for (let i = 0; i < 4; i++) rows.push(["Northcote", "5"]);
  const data = buildDataset("suburbs", ["suburb", "n"], rows);
  const entries = computeSimilarClusters(data.columns, data.rowCount, ids(data.rowCount));
  assert.equal(entries.length, 1);
  const entry = entries[0];
  assert.equal(entry?.label, "suburb");
  assert.equal(entry?.clusters.length, 2);
  assert.equal(entry?.truncated, false);
  const first = entry?.clusters[0];
  assert.equal(first?.suggested, "Brunswick");
  assert.deepEqual(
    first?.values.map((member) => member.value),
    ["Brunswick", "Brunsick"],
  );
  assert.equal(first?.rows, 7);
});

test("identifier-like columns are not clustered", () => {
  const rows: string[][] = [];
  for (let i = 0; i < 60; i++) rows.push([`Person ${i}`, "1"]);
  const data = buildDataset("ids", ["name", "n"], rows);
  const entries = computeSimilarClusters(data.columns, data.rowCount, ids(data.rowCount));
  assert.deepEqual(entries, []);
});

test("only the filtered rows are scanned", () => {
  const rows: string[][] = [];
  for (let i = 0; i < 5; i++) rows.push(["Brunswick", "1"]);
  for (let i = 0; i < 2; i++) rows.push(["Brunsick", "2"]);
  const data = buildDataset("suburbs", ["suburb", "n"], rows);
  // Only the clean rows: the typo rows 5 and 6 are filtered out.
  const cleanOnly = Uint32Array.from([0, 1, 2, 3, 4]);
  const entries = computeSimilarClusters(data.columns, data.rowCount, cleanOnly);
  assert.deepEqual(entries, []);
});

test("findings summarise clusters with the seed spelling and an analysed label", () => {
  const rows: string[][] = [];
  for (let i = 0; i < 5; i++) rows.push(["Brunswick", "1"]);
  for (let i = 0; i < 2; i++) rows.push(["Brunsick", "2"]);
  const data = buildDataset("suburbs", ["suburb", "n"], rows);
  const entries = computeSimilarClusters(data.columns, data.rowCount, ids(data.rowCount));
  const findings = similarClusterFindings(entries);
  assert.equal(findings.length, 1);
  const finding = findings[0];
  assert.equal(finding?.severity, "review");
  assert.match(finding?.title ?? "", /1 cluster of near-duplicate values/);
  assert.match(finding?.title ?? "", /Brunswick/);
  assert.ok(finding?.evidence.some((item) => item.metric === "keep (most common)"));
  assert.ok(finding?.evidence.some((item) => item.metric === "analysed"));
  assert.deepEqual(finding?.action, { kind: "merge", column: 0 });
});

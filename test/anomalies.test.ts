import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDataset } from "../src/data/build.js";
import { QueryEngine } from "../src/search/query-engine.js";

const cleanValues = Array.from({ length: 20 }, (_, i) => String(i + 1));

test("flags a numeric MAD outlier", () => {
  const dataset = buildDataset("t", ["n"], [...cleanValues, "1000"].map((v) => [v]));
  assert.equal(dataset.stats.valueAnomalyRows, 1);
  assert.equal(dataset.stats.lengthAnomalyRows, 0);
  assert.notEqual(dataset.valueFences[0], null);
  assert.equal(dataset.valueAnomalyBits.get(20), true);
});

test("leaves a clean numeric column unflagged", () => {
  const dataset = buildDataset("t", ["n"], cleanValues.map((v) => [v]));
  assert.equal(dataset.stats.valueAnomalyRows, 0);
});

test("falls back to mean deviation when MAD is zero", () => {
  const values = [...Array.from({ length: 19 }, () => "5"), "100"];
  const dataset = buildDataset("t", ["n"], values.map((v) => [v]));
  assert.equal(dataset.stats.valueAnomalyRows, 1);
  assert.equal(dataset.valueAnomalyBits.get(19), true);
});

test("constant numeric columns have no fence", () => {
  const values = Array.from({ length: 10 }, () => "7");
  const dataset = buildDataset("t", ["n"], values.map((v) => [v]));
  assert.equal(dataset.valueFences[0], null);
  assert.equal(dataset.stats.valueAnomalyRows, 0);
});

test("right-skewed positive columns use log fences", () => {
  const values: string[] = [];
  for (let i = 0; i < 40; i++) values.push(String(100 + (i % 10) * 11));
  for (let i = 0; i < 20; i++) values.push(String(500 + (i % 10) * 22));
  values.push("100000");
  const dataset = buildDataset("t", ["price"], values.map((v) => [v]));
  assert.equal(dataset.valueFences[0]?.log, true);
  assert.equal(dataset.stats.valueAnomalyRows, 1);
  assert.equal(dataset.valueAnomalyBits.get(values.length - 1), true);
});

test("flags a text length outside the per-column fences", () => {
  const rows: string[][] = [];
  for (let i = 0; i < 10; i++) rows.push(["abc"]);
  for (let i = 0; i < 10; i++) rows.push(["abcd"]);
  rows.push(["x".repeat(40)]);
  const dataset = buildDataset("t", ["code"], rows);
  assert.equal(dataset.stats.lengthAnomalyRows, 1);
  assert.equal(dataset.lengthAnomalyBits.get(20), true);
  assert.notEqual(dataset.lengthFences[0], null);
});

test("flags lengths above three times the P90 length", () => {
  const rows: string[][] = [];
  for (let i = 0; i < 990; i++) rows.push(["abcdefghij"]);
  for (let i = 0; i < 10; i++) rows.push(["x".repeat(40)]);
  const dataset = buildDataset("t", ["code"], rows);
  assert.equal(dataset.stats.lengthAnomalyRows, 10);
  assert.equal(dataset.lengthFences[0]?.hi, 30);
});

test("uniform text lengths have no outliers", () => {
  const rows = Array.from({ length: 10 }, () => ["abc"]);
  const dataset = buildDataset("t", ["code"], rows);
  assert.equal(dataset.stats.lengthAnomalyRows, 0);
  assert.equal(dataset.lengthFences[0]?.hi, 9);
});

test("valueAnomalies special filter narrows to outlier rows", () => {
  const dataset = buildDataset("t", ["n"], [...cleanValues, "1000"].map((v) => [v]));
  const engine = new QueryEngine(dataset);
  engine.setSpecial("valueAnomalies", true);
  const bits = engine.evaluateBits(new Map());
  assert.equal(bits.count(), 1);
  assert.equal(bits.get(20), true);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { accuracyChecks, candidateKinds, checkReference, indexReference, loadReference, normaliseReference } from "../src/data/reference.js";
import type { ColumnMeta } from "../src/worker/protocol.js";

const meta = (name: string, labels: string[], counts: number[]): ColumnMeta =>
  ({ name, type: "category", role: null, categories: { labels, counts }, stats: { nulls: 0, distinct: labels.length } }) as unknown as ColumnMeta;

test("names point at lists, whole words only", () => {
  assert.deepEqual(candidateKinds("country"), ["country"]);
  assert.ok(candidateKinds("Billing State").includes("auState"));
  assert.deepEqual(candidateKinds("county_name"), []);
  assert.deepEqual(candidateKinds("currencyCode"), ["currency"]);
});

test("a misspelt country is found and a close suggestion is offered", async () => {
  const index = indexReference(await loadReference("country"));
  const result = checkReference("country", ["Australia", "Austrlia", "United States", "USA", "Atlantis"], [50, 3, 40, 5, 1], index);
  assert.ok(result);
  assert.equal(result.invalid, 4);
  assert.equal(result.misses.find((m) => m.value === "Austrlia")?.suggestion, "Australia");
  assert.equal(result.misses.find((m) => m.value === "Atlantis")?.suggestion, null);
  assert.equal(result.checked, 99);
});

test("aliases and accents count as valid", async () => {
  const index = indexReference(await loadReference("country"));
  const result = checkReference("country", ["UK", "U.S.A.", "Côte d'Ivoire", "Holland"], [1, 1, 1, 1], index);
  assert.equal(result?.invalid, 0);
  assert.equal(normaliseReference("Côte d'Ivoire"), "cote d ivoire");
});

test("a column that is not mostly on the list is left alone", async () => {
  const index = indexReference(await loadReference("country"));
  assert.equal(checkReference("country", ["red", "green", "blue", "Peru"], [1, 1, 1, 1], index), null);
  assert.equal(checkReference("country", Array.from({ length: 500 }, (_, i) => `x${i}`), Array(500).fill(1), index), null);
});

test("accuracy checks become applicable only for recognised columns, and state picks the better list", async () => {
  const checks = await accuracyChecks([
    meta("country", ["Australia", "Austrlia", "France"], [10, 2, 5]),
    meta("state", ["NSW", "VIC", "QLD", "WA"], [5, 5, 5, 5]),
    meta("colour", ["red", "blue"], [1, 1]),
  ]);
  assert.equal(checks.length, 2);
  assert.equal(checks[0].dimension, "accuracy");
  assert.equal(checks[0].fail, 2);
  assert.match(checks[0].detail, /did you mean Australia/);
  assert.match(checks[1].label, /Australian states/);
  assert.equal(checks[1].fail, 0);
});

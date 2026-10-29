import { test } from "node:test";
import assert from "node:assert/strict";
import { FITNESS_PROFILES, fitnessProfile } from "../src/data/fitness.js";
import { DEFAULT_DQ_CONFIG } from "../src/data/score.js";

test("every profile weights all six dimensions, and general matches the default", () => {
  for (const profile of FITNESS_PROFILES) {
    assert.deepEqual(Object.keys(profile.weights).sort(), Object.keys(DEFAULT_DQ_CONFIG.weights).sort(), profile.id);
    assert.ok(Object.values(profile.weights).every((w) => w >= 0 && w <= 100));
  }
  assert.deepEqual(fitnessProfile("general").weights, DEFAULT_DQ_CONFIG.weights);
  assert.equal(fitnessProfile("nonsense").id, "general");
});

test("profiles move the weights the description promises; only sharing flips the export default", () => {
  const base = DEFAULT_DQ_CONFIG.weights;
  assert.ok(fitnessProfile("finance").weights.uniqueness > base.uniqueness);
  assert.ok(fitnessProfile("finance").weights.accuracy > base.accuracy);
  assert.ok(fitnessProfile("ml").weights.completeness > base.completeness);
  assert.deepEqual(FITNESS_PROFILES.filter((p) => p.exportMaskDefault).map((p) => p.id), ["sharing"]);
});

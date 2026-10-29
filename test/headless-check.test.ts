import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runCheck } from "../scripts/lib/check.js";
import { profileBuffer } from "../scripts/lib/profile.js";
import { serialiseRules, type Rule } from "../src/data/rules.js";

import { existsSync } from "node:fs";

const titanic = "test/fixtures/real-world/titanic/data.csv";
const skip = !existsSync(titanic) && "local corpus data not present (data.csv files are not in git)";

test("the headless score equals the page's profiling and scoring on a fixture", { skip }, async () => {
  const bytes = readFileSync(titanic);
  const direct = await profileBuffer("data.csv", bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  const headless = await runCheck(titanic);
  assert.equal(headless.overall, direct.score.overall);
  assert.equal(headless.band, direct.score.band);
  assert.equal(headless.rows, direct.dataset.rowCount);
  assert.ok(headless.exceptionCount > 0);
  assert.equal(headless.exceptionsCsv.trim().split("\n").length, headless.exceptionCount + 1);
});

test("rules fail the run beyond their allowance, and the minimum score gates it", { skip }, async () => {
  const base = await runCheck(titanic);
  const rules: Rule[] = [
    { id: "a", type: "notNull", column: "Cabin", severity: "major", allowedFailure: 0 },
    { id: "b", type: "range", column: "Age", severity: "minor", allowedFailure: 0, min: 0, max: 120 },
    { id: "c", type: "unique", column: "PassengerId", severity: "critical", allowedFailure: 0 },
  ];
  const text = serialiseRules(rules, base.profile.metas);
  const result = await runCheck(titanic, { rulesText: text, minScore: 99 });
  assert.equal(result.ruleResults.length, 3);
  assert.equal(result.ruleResults.find((r) => r.rule.column === "Cabin")?.failed, true);
  assert.equal(result.ruleResults.find((r) => r.rule.column === "PassengerId")?.failed, false);
  assert.ok(result.failed);
  assert.ok(result.failures.some((line) => line.includes("below the minimum 99")));
  const lenient = await runCheck(titanic, { rulesText: serialiseRules([rules[2]], base.profile.metas) });
  assert.equal(lenient.failed, false);
});

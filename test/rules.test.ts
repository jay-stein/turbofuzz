import { test } from "node:test";
import assert from "node:assert/strict";
import {
  describeRule,
  emitRules,
  evaluateRule,
  parseRulesFile,
  recommendRules,
  ruleToCheck,
  schemaFingerprint,
  serialiseRules,
  validateRule,
  type Rule,
} from "../src/data/rules.js";
import { emitDQChecks } from "../src/data/dq-report.js";
import { BitSet } from "../src/search/bitset.js";
import type { ColumnData } from "../src/data/column.js";
import type { ColumnMeta } from "../src/worker/protocol.js";

function column(name: string, raw: string[]): ColumnData {
  const nullMask = new BitSet(raw.length);
  raw.forEach((value, row) => {
    if (value === "") nullMask.set(row);
  });
  const numbers = Float64Array.from(raw.map((value) => (value === "" ? Number.NaN : Number(value))));
  return { name, raw, nullMask, numbers: () => numbers } as unknown as ColumnData;
}

const base = { severity: "major" as const, allowedFailure: 0 };
const rule = (partial: Partial<Rule> & Pick<Rule, "type" | "column">): Rule => ({ id: "r1", ...base, ...partial });

test("each rule type counts exactly the failing cells", () => {
  const age = column("age", ["20", "30", "130", "", "-1"]);
  const city = column("city", ["Perth", "Perth", "Sydney", "Hobart", ""]);
  const id = column("id", ["a", "b", "a", "c", "d"]);
  const code = column("code", ["AB1", "AB2", "xx", "AB3", "AB4"]);
  const cols = [age, city, id, code];
  assert.equal(evaluateRule(rule({ type: "notNull", column: "age" }), cols, 5).fail, 1);
  assert.equal(evaluateRule(rule({ type: "unique", column: "id" }), cols, 5).fail, 1);
  const range = evaluateRule(rule({ type: "range", column: "age", min: 0, max: 120 }), cols, 5);
  assert.deepEqual([range.fail, range.compared, range.examples], [2, 4, ["130", "-1"]]);
  assert.equal(evaluateRule(rule({ type: "inList", column: "city", values: ["Perth", "Sydney"] }), cols, 5).fail, 1);
  assert.equal(evaluateRule(rule({ type: "regex", column: "code", pattern: "AB\\d" }), cols, 5).fail, 1);
  assert.equal(evaluateRule(rule({ type: "length", column: "code", min: 3, max: 3 }), cols, 5).fail, 1);
});

test("a cross-column comparison skips rows where either side is empty", () => {
  const start = column("start", ["1", "5", "", "9"]);
  const end = column("end", ["2", "4", "7", "9"]);
  const result = evaluateRule(rule({ type: "compare", column: "end", other: "start", operator: "gte" }), [start, end], 4);
  assert.deepEqual([result.fail, result.compared], [1, 3]);
  assert.equal(evaluateRule(rule({ type: "compare", column: "end", other: "start", operator: "gt" }), [start, end], 4).fail, 2);
});

test("unsafe or broken rules never run", () => {
  assert.match(validateRule(rule({ type: "regex", column: "x", pattern: "(a+)+$" })) ?? "", /hang/);
  assert.match(validateRule(rule({ type: "regex", column: "x", pattern: "(" })) ?? "", /not valid/);
  assert.match(validateRule(rule({ type: "range", column: "x", min: 5, max: 1 })) ?? "", /above/);
  assert.match(evaluateRule(rule({ type: "notNull", column: "missing" }), [], 0).error ?? "", /not in this file/);
});

test("the allowed-failure share lets a rule pass, and the check says so", () => {
  const result = { id: "r1", fail: 1, compared: 400, examples: ["9"], error: null };
  const strict = ruleToCheck(rule({ type: "range", column: "x", min: 0 }), result, 0);
  assert.equal(strict.fail, 1);
  const tolerant = ruleToCheck(rule({ type: "range", column: "x", min: 0, allowedFailure: 0.005 }), result, 0);
  assert.equal(tolerant.fail, 0);
  assert.match(tolerant.detail, /0.5% may fail/);
});

function meta(name: string, type: string, stats: Partial<ColumnMeta["stats"]>, categories: ColumnMeta["categories"] = null): ColumnMeta {
  return { name, type, role: null, categories, suggestions: [], pattern: null, stats: { nulls: 0, distinct: 0, min: null, max: null, ...stats } } as unknown as ColumnMeta;
}

test("the recommender proposes a sensible set and none of it fails on the data it learned from", () => {
  const rows = 100;
  const age = Array.from({ length: rows }, (_, i) => String(20 + (i % 50)));
  const team = Array.from({ length: rows }, (_, i) => ["Red", "Blue"][i % 2]);
  const id = Array.from({ length: rows }, (_, i) => `K${i}`);
  const metas = [
    meta("id", "identifier", { distinct: rows }),
    meta("age", "integer", { distinct: 50, min: 20, max: 69 }),
    meta("team", "category", { distinct: 2 }, { labels: ["Red", "Blue"], counts: [50, 50] }),
  ];
  const proposed = recommendRules(metas, rows);
  const types = proposed.map((r) => `${r.type}:${r.column}`);
  for (const expected of ["unique:id", "notNull:age", "range:age", "inList:team"]) assert.ok(types.includes(expected), expected);
  const cols = [column("id", id), column("age", age), column("team", team)];
  for (const r of proposed) assert.equal(evaluateRule(r, cols, rows).fail, 0, describeRule(r));
});

test("a rules file round-trips and drops rules that fail validation", () => {
  const metas = [meta("a", "integer", {}), meta("b", "string", {})];
  const text = serialiseRules([rule({ type: "range", column: "a", min: 1, max: 9, suggested: true })], metas);
  const parsed = parseRulesFile(text);
  assert.ok(!("error" in parsed));
  if ("error" in parsed) return;
  assert.equal(parsed.file.fingerprint, schemaFingerprint(metas));
  assert.equal(parsed.file.rules.length, 1);
  assert.equal(parsed.file.rules[0].suggested, undefined);
  const hostile = JSON.stringify({ version: 1, rules: [{ type: "regex", column: "a", pattern: "(a+)+$", severity: "minor" }, { type: "bogus" }] });
  const result = parseRulesFile(hostile);
  assert.ok(!("error" in result) && result.dropped === 2 && result.file.rules.length === 0);
  assert.ok("error" in parseRulesFile("not json"));
  assert.notEqual(schemaFingerprint(metas), schemaFingerprint([metas[0]]));
});

test("rules reach the pipeline emitters, and what cannot be translated is listed", () => {
  const rules = [
    rule({ type: "notNull", column: "a" }),
    rule({ type: "inList", column: "b", values: ["x", "y"] }),
    rule({ type: "length", column: "b", min: 1, max: 3 }),
  ];
  const emitted = emitRules(rules);
  assert.ok(emitted.sodacl.some((line) => line.includes('missing_count("a") = 0')));
  assert.ok(emitted.dbt.some((entry) => entry.test.startsWith("accepted_values")));
  assert.ok(emitted.support.some((line) => line.includes("characters long")));
  const all = emitDQChecks([meta("a", "integer", {}), meta("b", "string", {})], "t", rules);
  assert.match(all.sodacl, /accepted|valid values/);
  assert.match(all.dqdl, /ColumnValues "b" in \["x", "y"\]/);
  assert.match(all.gx, /expect_column_values_to_be_in_set/);
});

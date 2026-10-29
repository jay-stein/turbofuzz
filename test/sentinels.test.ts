import { test } from "node:test";
import assert from "node:assert/strict";
import { ColumnData } from "../src/data/column.js";
import { qualityFindings } from "../src/data/findings.js";
import { isNullToken } from "../src/parse/null-tokens.js";

// The synthetic readings repeat, so ignore repeated-digit codes like 111 and look at "0" only.
const sentinels = (column: ColumnData) =>
  column.suggestions.filter((s) => s.kind === "sentinel" && !/^(\d)\1{2,}$/.test(s.value));

// Deterministic spread of plausible readings, with `zeros` zero cells mixed in.
function readings(rows: number, zeros: number, base: number): string[] {
  const out = Array.from({ length: rows }, (_, i) => String(base + ((i * 7) % 60)));
  for (let k = 0; k < zeros; k++) out[k * Math.floor(rows / zeros)] = "0";
  return out;
}

test("ERROR and friends are missing-value tokens", () => {
  for (const token of ["ERROR", "n/a", "#N/A", "NULL", "None", "NIL", "UNKNOWN", "unspecified", "TBD", "?", "-", "--", "n.a.", "missing"]) {
    assert.equal(isNullToken(token), true, token);
  }
});

test("zeros in a column that cannot be zero are flagged with an exact count", () => {
  const insulin = ColumnData.create("Insulin", readings(768, 374, 80));
  const [zero] = sentinels(insulin);
  assert.equal(zero?.kind === "sentinel" ? zero.value : "", "0");
  assert.equal(zero?.kind === "sentinel" ? zero.count : 0, 374);
  assert.match(zero?.kind === "sentinel" ? (zero.hint ?? "") : "", /insulin/);

  const bp = ColumnData.create("BloodPressure", readings(768, 35, 60));
  assert.equal(sentinels(bp).length, 1);
  const bmi = ColumnData.create("BMI", readings(768, 11, 20));
  assert.equal(sentinels(bmi).length, 1);
});

test("zeros are left alone where zero is a real value", () => {
  assert.equal(sentinels(ColumnData.create("Pregnancies", readings(768, 100, 1))).length, 0);
  assert.equal(sentinels(ColumnData.create("percentage", readings(768, 100, 1))).length, 0);
  // Too few to matter, and mostly-zero columns are counts.
  assert.equal(sentinels(ColumnData.create("price", readings(500, 3, 5))).length, 0);
  assert.equal(sentinels(ColumnData.create("age", Array.from({ length: 300 }, (_, i) => (i % 10 === 0 ? "5" : "0")))).length, 0);
});

test("placeholder dates are flagged when they repeat", () => {
  const raw = Array.from({ length: 250 }, (_, i) => `2019-0${(i % 9) + 1}-${10 + (i % 18)}`);
  for (let i = 0; i < 15; i++) raw[i * 16] = "1970-01-01";
  const column = ColumnData.create("date_of_decision", raw);
  const [placeholder] = sentinels(column);
  assert.equal(placeholder?.kind === "sentinel" ? placeholder.value : "", "1970-01-01");
  assert.equal(placeholder?.kind === "sentinel" ? placeholder.count : 0, 15);
});

test("sentinel counts are exact on large columns", () => {
  const raw = Array.from({ length: 6000 }, (_, i) => String(20 + (i % 50)));
  for (let i = 0; i < 300; i++) raw[i * 20] = "-9";
  const column = ColumnData.create("score", raw);
  const [code] = sentinels(column);
  assert.equal(code?.kind === "sentinel" ? code.value : "", "-9");
  assert.equal(code?.kind === "sentinel" ? code.count : 0, 300);
});

test("99 inside a 0-100 score is a real value, but stands out among ages", () => {
  const scores = Array.from({ length: 400 }, (_, i) => String(i % 101));
  assert.equal(sentinels(ColumnData.create("exam", scores)).length, 0);
  const ages = Array.from({ length: 400 }, (_, i) => String(18 + (i % 60)));
  for (let i = 0; i < 20; i++) ages[i * 20] = "99";
  assert.equal(sentinels(ColumnData.create("years", ages)).length, 1);
});

test("sentinels become review findings, never silent changes", () => {
  const column = ColumnData.create("Insulin", readings(768, 374, 80));
  const meta = {
    name: "Insulin", type: column.type, numberLocale: column.numberLocale, dateOrder: column.dateOrder,
    stats: column.stats, anomalyCounts: { values: 0, lengths: 0 }, similarGroups: 0, categories: null,
    histogram: null, valueFence: null, lengthFence: null, nullPolicy: { extra: [], keep: [] },
    nullTokens: [], suggestions: column.suggestions,
  };
  const findings = qualityFindings([meta], { duplicateRows: 0, duplicateGroups: 0, rowsInDuplicateGroups: 0, emptyRows: 0, rowsWithNulls: 0, totalNullCells: 0, totalCells: 768, valueAnomalyRows: 0, lengthAnomalyRows: 0, computeMs: 1 }, 768);
  const finding = findings.find((f) => f.id.startsWith("sentinel."));
  assert.equal(finding?.severity, "review");
  assert.equal(finding?.impact.rows, 374);
});

import { reviewFindings } from "../src/data/findings.js";

test("reviewFindings keeps only unscored advisory items", () => {
  const column = ColumnData.create("Insulin", readings(768, 374, 80));
  const meta = {
    name: "Insulin", type: column.type, numberLocale: column.numberLocale, dateOrder: column.dateOrder,
    stats: column.stats, anomalyCounts: { values: 0, lengths: 0 }, similarGroups: 2, categories: null,
    histogram: null, valueFence: null, lengthFence: null, nullPolicy: { extra: [], keep: [] },
    nullTokens: [], suggestions: column.suggestions,
  };
  const stats = { duplicateRows: 40, duplicateGroups: 4, rowsInDuplicateGroups: 80, emptyRows: 0, rowsWithNulls: 0, totalNullCells: 0, totalCells: 768, valueAnomalyRows: 0, lengthAnomalyRows: 0, computeMs: 1 };
  const ids = reviewFindings([meta], stats, 768).map((f) => f.id.split(".")[0]);
  assert.ok(ids.includes("sentinel"));
  // Duplicates, fuzzy pairs and schema items are covered elsewhere on the page.
  assert.ok(!ids.includes("duplicates") && !ids.includes("categories") && !ids.includes("pattern"));
});

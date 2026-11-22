import { test } from "node:test";
import assert from "node:assert/strict";
import { companyKey, spellingVariants } from "../src/data/variants.js";
import { ColumnData } from "../src/data/column.js";
import { buildIssues } from "../src/data/dq-issues.js";
import { computeDQScore } from "../src/data/score.js";
import type { DatasetStats } from "../src/data/stats.js";
import type { ColumnMeta } from "../src/worker/protocol.js";

test("a company's legal ending is written one way, and only the ending changes", () => {
  assert.equal(companyKey("acme proprietary limited"), "acme pty ltd");
  assert.equal(companyKey("acme pty limited"), "acme pty ltd");
  assert.equal(companyKey("acme p/l"), "acme pty ltd");
  assert.equal(companyKey("acme pty ltd"), "acme pty ltd");
  assert.equal(companyKey("globex limited"), "globex ltd");
  assert.equal(companyKey("initech, incorporated"), "initech inc");
  assert.equal(companyKey("umbrella corporation"), "umbrella corp");
  assert.equal(companyKey("smith & co"), "smith and co");
  assert.equal(companyKey("smith and company"), "smith and co");
  assert.equal(companyKey("tata private limited"), "tata pte ltd");
  // The name itself is never dropped or shortened.
  assert.equal(companyKey("acme"), "acme");
  assert.equal(companyKey("limited edition records pty ltd"), "limited edition records pty ltd");
});

const SUPPLIERS: [string, number][] = [
  ["Acme Pty Ltd", 40],
  ["ACME PTY. LTD.", 6],
  ["Acme Proprietary Limited", 3],
  ["Acme", 5],
  ["Globex Limited", 20],
  ["Globex Ltd", 4],
  ["Initech Inc", 12],
  ["Initech, Incorporated", 2],
  ["Smith & Co", 9],
  ["Smith and Co", 1],
];

test("company names whose endings are written differently are offered as one value to check, never a bare name", () => {
  const summary = spellingVariants(SUPPLIERS.map(([value]) => value), SUPPLIERS.map(([, count]) => count), "supplier");
  const loose = summary?.loose;
  assert.ok(loose !== undefined);
  assert.equal(loose.companyForm, true);
  assert.equal(loose.longForm, false);
  const to = new Map(loose.mappings.map((m) => [m.from, m.to]));
  assert.equal(to.get("Acme Proprietary Limited"), "Acme Pty Ltd");
  assert.equal(to.get("ACME PTY. LTD."), "Acme Pty Ltd");
  assert.equal(to.get("Globex Ltd"), "Globex Limited");
  assert.equal(to.get("Initech, Incorporated"), "Initech Inc");
  assert.equal(to.get("Smith and Co"), "Smith & Co");
  assert.equal(to.has("Acme"), false, "a bare name may be another entity");
  assert.equal(loose.rows, 6 + 3 + 4 + 2 + 1);
});

test("people and places keep their endings: no company reading without company names", () => {
  const people: [string, number][] = [["Jordan Co", 3], ["Jordan Company", 1], ["Sam Lee", 10], ["Ana Ruiz", 9], ["Kim Park", 8], ["Lee Wong", 7], ["Max Bell", 6], ["Ola Nord", 5], ["Ivy Chan", 4], ["Bo Tran", 2]];
  const summary = spellingVariants(people.map(([value]) => value), people.map(([, count]) => count), "contact");
  assert.equal(summary?.loose?.mappings.some((m) => m.from === "Jordan Company"), undefined);
});

function metaOf(column: ColumnData): ColumnMeta {
  return {
    name: column.name,
    type: column.type,
    numberLocale: column.numberLocale,
    dateOrder: column.dateOrder,
    stats: column.stats,
    anomalyCounts: { values: 0, lengths: 0 },
    similarGroups: 0,
    categories: null,
    histogram: null,
    valueFence: null,
    lengthFence: null,
    nullPolicy: { extra: [], keep: [] },
    nullTokens: [...column.nullTokens],
    suggestions: column.suggestions,
    typeDowngrade: column.typeDowngrade,
    conformance: column.conformance,
    semantic: column.semantic,
    variants: column.spellingVariants(),
  };
}

test("the Clean page lists them under Standardise as a review, saying why", () => {
  const values = SUPPLIERS.flatMap(([value, count]) => Array.from({ length: count }, () => value));
  const meta = metaOf(ColumnData.create("supplier", values));
  const stats: DatasetStats = { duplicateRows: 0, duplicateGroups: 0, rowsInDuplicateGroups: 0, emptyRows: 0, rowsWithNulls: 0, totalNullCells: 0, totalCells: values.length, valueAnomalyRows: 0, lengthAnomalyRows: 0, computeMs: 1 };
  const score = computeDQScore([meta], stats, values.length);
  const issue = buildIssues({ score, metas: [meta], rowCount: values.length, review: [], sensitiveColumns: new Set() }).find((entry) => entry.id === "variantsLoose.0");
  assert.ok(issue !== undefined);
  assert.equal(issue.severity, "review");
  assert.equal(issue.batchSafe, false, "never part of Fix all safe");
  assert.match(issue.evidence, /company ending/);
  assert.equal(issue.kind, "variants");
});

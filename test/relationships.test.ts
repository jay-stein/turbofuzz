import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDataset } from "../src/data/build.js";
import { computeRelationships, rankColumn } from "../src/data/relationships.js";
import { relationshipDataFindings } from "../src/data/findings.js";

function dataset() {
  const rows: string[][] = [];
  for (let index = 0; index < 60; index++) {
    const group = index < 30 ? "A" : "B";
    rows.push([
      String(index),
      String(2 * index + (index % 4)),
      group,
      index < 30 ? "p" : "q",
    ]);
  }
  return buildDataset("t", ["x", "y", "group", "bucket"], rows);
}

test("rankColumn averages ties", () => {
  const numbers = Float64Array.from([10, 20, 20, 30]);
  const ids = Uint32Array.from([0, 1, 2, 3]);
  const ranks = rankColumn(numbers, ids, 4);
  assert.deepEqual([...ranks], [1, 2.5, 2.5, 4]);
  const withMissing = rankColumn(Float64Array.from([5, Number.NaN, 1]), ids, 3);
  assert.equal(withMissing[1], Number.NaN);
  assert.equal(withMissing[0], 2);
  assert.equal(withMissing[2], 1);
});

test("computeRelationships covers Pearson, Spearman, Cramér's V and η²", () => {
  const ds = dataset();
  const ids = Uint32Array.from({ length: ds.rowCount }, (_, index) => index);
  const relationships = computeRelationships(ds.columns, ds.rowCount, ids);
  const find = (kind: string, a: string, b: string) =>
    relationships.find(
      (entry) => entry.kind === kind && entry.aLabel === a && entry.bLabel === b,
    );

  const pearson = find("pearson", "x", "y");
  assert.ok(pearson !== undefined);
  assert.ok(pearson.effect > 0.9, `Pearson ${pearson.effect}`);

  const spearman = find("spearman", "x", "y");
  assert.ok(spearman !== undefined);
  assert.ok(spearman.effect > 0.9, `Spearman ${spearman.effect}`);

  const v = find("cramersV", "group", "bucket");
  assert.ok(v !== undefined);
  assert.ok(v.effect > 0.9, `Cramér's V ${v.effect}`);

  const eta = find("eta2", "y", "group");
  assert.ok(eta !== undefined);
  assert.ok(eta.effect > 0.6, `η² ${eta.effect}`);

  // Ranked by effect size.
  const effects = relationships.map((entry) => Math.abs(entry.effect));
  assert.deepEqual(effects, [...effects].sort((a, b) => b - a));
});

test("relationshipDataFindings words each method carefully", () => {
  const findings = relationshipDataFindings([
    {
      kind: "spearman",
      aColumn: 0,
      bColumn: 1,
      aLabel: "orders",
      bLabel: "revenue",
      effect: 0.71,
      n: 1200,
    },
    {
      kind: "eta2",
      aColumn: 2,
      bColumn: 3,
      aLabel: "delivery time",
      bLabel: "region",
      effect: 0.35,
      n: 900,
    },
    {
      kind: "cramersV",
      aColumn: 4,
      bColumn: 5,
      aLabel: "channel",
      bLabel: "plan",
      effect: 0.98,
      n: 800,
    },
  ]);
  assert.match(findings[0]?.title ?? "", /“orders” is associated with “revenue” \(Spearman ρ = 0.71\)/);
  assert.ok(findings[0]?.evidence.some((entry) => entry.metric === "method" && entry.value.includes("Spearman")));
  assert.match(findings[1]?.title ?? "", /differs across “region” groups \(η² = 0.35\)/);
  assert.match(findings[2]?.title ?? "", /are associated \(Cramér's V = 0.98\)/);
  assert.equal(findings[2]?.severity, "review");
  assert.doesNotMatch(findings[2]?.title ?? "", /cause/);
});

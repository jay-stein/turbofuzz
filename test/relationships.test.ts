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
      String(index + 0.25),
      String(2 * index + (index % 4) + 0.5),
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

function numericFixture(names: string[], make: (i: number) => string[]) {
  const rows: string[][] = [];
  for (let i = 0; i < 80; i++) rows.push(make(i));
  const ds = buildDataset("t", names, rows);
  const ids = Uint32Array.from({ length: ds.rowCount }, (_, index) => index);
  return computeRelationships(ds.columns, ds.rowCount, ids, { minAbs: 0.3 });
}

test("code-like digit columns take no part in correlations; real quantities still do", () => {
  const make = (i: number) => [String(10000 + i * 7), String(5000 + i * 3), String(i * 2 + (i % 3)), String(i + (i % 5))];
  assert.equal(numericFixture(["zipcode", "bbl", "units", "area"], make).some((r) => r.aLabel === "zipcode" || r.bLabel === "zipcode" || r.aLabel === "bbl" || r.bLabel === "bbl"), false);
  const quantities = numericFixture(["revenue", "spend", "units", "area"], make);
  assert.ok(quantities.some((r) => r.kind === "pearson" && r.aLabel === "units" && r.bLabel === "area"));
});

test("coordinate zeros do not fake a correlation and latitude against longitude is skipped", () => {
  const rows = (i: number) => {
    const placeholder = i % 10 === 0;
    return [placeholder ? "0" : String(40 + (i % 17) * 0.5), placeholder ? "0" : String(-74 + (i % 13) * 0.25), String((i * 37) % 11)];
  };
  const found = numericFixture(["latitude", "longitude", "other"], rows);
  assert.equal(found.some((r) => r.aLabel === "latitude" && r.bLabel === "longitude"), false);
  const plain = numericFixture(["a_value", "b_value", "other"], rows);
  assert.ok(plain.some((r) => r.kind === "pearson" && Math.abs(r.effect) > 0.9), "without a coordinate name the zeros do drive a strong line");
});

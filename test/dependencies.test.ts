import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDataset } from "../src/data/build.js";
import { computeDependencies } from "../src/data/dependencies.js";
import { dependencyFindings } from "../src/data/findings.js";

function rows(): string[][] {
  const out: string[][] = [];
  const cities = ["North", "South", "East", "West"];
  for (let index = 0; index < 40; index++) {
    const id = `S${(index % 4) + 1}`;
    out.push([id, `Station ${(index % 4) + 1}`, cities[index % 4] ?? "North"]);
  }
  // One broken mapping: S2 with the wrong station name.
  out.push(["S2", "Station 9", "South"]);
  return out;
}

test("computeDependencies finds what a key determines and counts conflicts", () => {
  const dataset = buildDataset("t", ["station id", "station name", "city"], rows());
  const pairs = computeDependencies(dataset.columns, dataset.rowCount);
  const name = pairs.find((pair) => pair.determinantLabel === "station id" && pair.dependentLabel === "station name");
  assert.ok(name !== undefined, `expected the station id → name pair, got ${pairs.map((p) => `${p.determinantLabel}→${p.dependentLabel}`).join(", ")}`);
  assert.equal(name?.rows, 41);
  assert.equal(name?.violations, 1);
  assert.equal(name?.examples[0]?.determinant, "S2");
  assert.deepEqual(name?.examples[0]?.values.sort(), ["Station 2", "Station 9"]);

  const city = pairs.find((pair) => pair.dependentLabel === "city");
  assert.ok(city !== undefined);
  assert.equal(city?.violations, 0);
});

test("computeDependencies follows an explicit row subset", () => {
  const dataset = buildDataset(
    "subset",
    ["station id", "station name"],
    [
      ["A", "Alpha"],
      ["A", "Alpha"],
      ["B", "Beta"],
      ["B", "Beta"],
      ["C", "Gamma"],
    ],
  );
  const all = computeDependencies(dataset.columns, 5);
  assert.ok(all.some((pair) => pair.violations === 0));
  const subset = computeDependencies(
    dataset.columns,
    5,
    {},
    Uint32Array.from([0, 2]),
  );
  assert.equal(subset[0]?.rows, 2, "only the supplied rows are counted");
  assert.equal(subset[0]?.violations, 0);
});

test("dependencyFindings distinguishes clean keys from broken mappings", () => {
  const findings = dependencyFindings([
    {
      determinantColumn: 0,
      dependentColumn: 1,
      determinantLabel: "station id",
      dependentLabel: "station name",
      rows: 41,
      violations: 1,
      examples: [{ determinant: "S2", values: ["Station 2", "Station 9"] }],
    },
    {
      determinantColumn: 0,
      dependentColumn: 2,
      determinantLabel: "station id",
      dependentLabel: "city",
      rows: 41,
      violations: 0,
      examples: [],
    },
  ]);
  assert.equal(findings[0]?.severity, "review");
  assert.match(findings[0]?.title ?? "", /almost determines “station name”/);
  assert.match(
    findings[0]?.evidence.find((entry) => entry.metric === "example")?.value ?? "",
    /S2 → Station 2 \/ Station 9/,
  );
  assert.equal(findings[1]?.severity, "info");
  assert.match(findings[1]?.title ?? "", /determines “city”/);
  assert.equal(findings[1]?.impact.rows, 0);
});

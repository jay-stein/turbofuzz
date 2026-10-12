import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDataset } from "../src/data/build.js";
import { computeGroupAnomalies } from "../src/data/group-anomalies.js";
import { groupAnomalyFindings } from "../src/data/findings.js";

function rows(): string[][] {
  const out: string[][] = [];
  // Region A: a tight spread around 100 with one huge outlier.
  for (let index = 0; index < 30; index++) {
    out.push(["A", String(95 + (index % 11))]);
  }
  out.push(["A", "5000"]);
  // Region B: a tight spread around 5, no outliers.
  for (let index = 0; index < 30; index++) {
    out.push(["B", String(4 + (index % 3))]);
  }
  return out;
}

test("group-relative anomalies flag the peer-relative outlier only", () => {
  const dataset = buildDataset("t", ["region", "amount"], rows());
  const result = computeGroupAnomalies(dataset.columns, dataset.rowCount);
  assert.equal(result.totalFlagged, 1);
  assert.equal(result.pairs.length, 1);
  const pair = result.pairs[0];
  assert.equal(pair?.valueColumn, 1);
  assert.equal(pair?.groupColumn, 0);
  assert.equal(pair?.valueLabel, "amount");
  assert.equal(pair?.groupLabel, "region");
  assert.equal(pair?.flagged, 1);
  assert.equal(pair?.groupsAnalysed, 2);
  assert.equal(pair?.examples[0]?.group, "A");
  assert.equal(pair?.examples[0]?.value, 5000);
  assert.ok((pair?.examples[0]?.z ?? 0) > 3.5);
  // The filter bits cover exactly the outlier row.
  const bits = result.columnBits[1];
  assert.ok(bits !== null);
  assert.equal(bits?.count(), 1);
  assert.equal(bits?.get(30), true);
  assert.equal(bits?.get(0), false);
  assert.equal(result.combined.count(), 1);
});

test("tiny groups never flag half their rows", () => {
  const dataset = buildDataset("t", ["region", "amount"], [
    ["A", "10"],
    ["A", "1000"],
    ["B", "20"],
    ["B", "2000"],
  ]);
  const result = computeGroupAnomalies(dataset.columns, dataset.rowCount);
  assert.equal(result.totalFlagged, 0);
  assert.equal(result.pairs.length, 0);
});

test("groupAnomalyFindings states the method and offers a filter action", () => {
  const findings = groupAnomalyFindings([
    {
      valueColumn: 2,
      groupColumn: 1,
      valueLabel: "amount",
      groupLabel: "category",
      flagged: 23,
      groupsAnalysed: 4,
      examples: [{ group: "Electronics", value: 48_200, median: 310, z: 61.2 }],
    },
  ]);
  assert.equal(findings.length, 1);
  assert.match(findings[0].title, /23 “amount” values are unusual within “category”/);
  assert.ok(
    findings[0].evidence.some((entry) => entry.metric === "method" && entry.value.includes("robust z")),
  );
  assert.match(
    findings[0].evidence.find((entry) => entry.metric === "example")?.value ?? "",
    /Electronics: 48,200 vs median 310 \(z 61.2\)/,
  );
  assert.deepEqual(findings[0].action, {
    kind: "filterSpecial",
    column: 2,
    special: "groupAnomalies",
  });
  assert.equal(findings[0].fixLabel, "Show rows");
});

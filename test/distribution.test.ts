import { test } from "node:test";
import assert from "node:assert/strict";
import { ColumnData } from "../src/data/column.js";
import { computeDistributionChanges } from "../src/data/distribution.js";
import { distributionFindings } from "../src/data/findings.js";

function ids(count: number): Uint32Array {
  const out = new Uint32Array(count);
  for (let index = 0; index < count; index++) out[index] = index;
  return out;
}

test("numeric columns shifting halfway report a high PSI with the moving bucket", () => {
  const values: string[] = [];
  for (let index = 0; index < 100; index++) values.push(String(index));
  for (let index = 0; index < 100; index++) values.push(String(100 + index));
  const column = ColumnData.create("amount", values);
  const changes = computeDistributionChanges([column], values.length, ids(values.length));
  assert.equal(changes.length, 1);
  const change = changes[0];
  assert.equal(change?.kind, "numeric");
  assert.equal(change?.column, 0);
  assert.ok((change?.effect ?? 0) > 0.5, `PSI should be large, got ${change?.effect}`);
  assert.match(change?.detail ?? "", /moved from/);

  const findings = distributionFindings(changes);
  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.severity, "review");
  assert.match(findings[0]?.title ?? "", /numeric distribution of “amount” shifted/);
  assert.ok(findings[0]?.evidence.some((entry) => entry.metric === "PSI"));
});

test("stable numeric columns stay below the reporting threshold", () => {
  const values: string[] = [];
  for (let index = 0; index < 200; index++) values.push(String(index % 100));
  const column = ColumnData.create("amount", values);
  const changes = computeDistributionChanges([column], values.length, ids(values.length));
  assert.equal(changes.length, 0);
});

test("category mixes shifting halfway report Cramér's V and the moving category", () => {
  const values: string[] = [];
  for (let index = 0; index < 100; index++) values.push(index % 2 === 0 ? "north" : "south");
  for (let index = 0; index < 20; index++) values.push("north");
  for (let index = 0; index < 80; index++) values.push("south");
  const column = ColumnData.create("region", values);
  const changes = computeDistributionChanges([column], values.length, ids(values.length));
  assert.equal(changes.length, 1);
  const change = changes[0];
  assert.equal(change?.kind, "category");
  assert.ok((change?.effect ?? 0) > 0.2, `V should be meaningful, got ${change?.effect}`);
  assert.match(change?.detail ?? "", /“south” moved from 50\.0% to 80\.0%/);

  const findings = distributionFindings(changes);
  assert.equal(findings[0]?.severity, "review");
  assert.match(findings[0]?.title ?? "", /category mix of “region” shifted/);
  assert.ok(findings[0]?.evidence.some((entry) => entry.metric === "V"));
});

test("windowed comparison needs enough rows on both sides", () => {
  const values: string[] = [];
  for (let index = 0; index < 60; index++) values.push(String(index));
  const column = ColumnData.create("amount", values);
  assert.deepEqual(computeDistributionChanges([column], values.length, ids(values.length)), []);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDataset } from "../src/data/build.js";
import { computeColumnNetwork } from "../src/data/column-network.js";

function dataset() {
  const rows: string[][] = [];
  for (let index = 0; index < 120; index++) {
    const first = index < 60;
    rows.push([
      String(index + 1),
      first ? String(10 + (index % 5)) : String(100 + (index % 5)),
      first ? "A" : "B",
      first ? `urgent delivery delay ref ${index}` : `routine pickup ref ${index}`,
      first ? `delivery delay customer ${index}` : `pickup customer ${index}`,
      `zeta eta theta ${index}`,
    ]);
  }
  return buildDataset(
    "network",
    ["customer_id", "amount", "region", "notes", "message", "comment"],
    rows,
  );
}

test("column network includes text nodes and text association methods", () => {
  const ds = dataset();
  const ids = Uint32Array.from({ length: ds.rowCount }, (_, index) => index);
  const network = computeColumnNetwork(ds.columns, ids, ds.rowCount);

  const labels = network.nodes.map((node) => node.label);
  assert.ok(labels.includes("notes"));
  assert.ok(labels.includes("message"));
  assert.ok(labels.includes("region"));
  assert.ok(labels.includes("amount"));
  assert.ok(!labels.includes("customer_id"), "numeric identifiers are excluded");

  const notes = network.nodes.find((node) => node.label === "notes");
  assert.equal(notes?.role, "text");

  const find = (method: string, a: string, b: string) =>
    network.edges.find(
      (edge) =>
        edge.method === method &&
        ((edge.aLabel === a && edge.bLabel === b) ||
          (edge.aLabel === b && edge.bLabel === a)),
    );

  const overlap = find("tokenOverlap", "notes", "message");
  assert.ok(overlap !== undefined, "text-to-text token overlap is present");
  assert.ok(overlap.effect > 0.2, `token overlap ${overlap.effect}`);

  const category = find("cramersV", "notes", "region");
  assert.ok(category !== undefined, "text-to-category association is present");
  assert.ok(category.effect > 0.8, `Cramér's V ${category.effect}`);

  const numeric = find("eta2", "notes", "amount");
  assert.ok(numeric !== undefined, "text-to-numeric association is present");
  assert.ok(numeric.effect > 0.8, `eta2 ${numeric.effect}`);

  assert.equal(network.analyzedRows, 120);
  assert.equal(network.totalRows, 120);
  assert.equal(network.sampled, false);
});

test("column network samples rows deterministically and reports the scope", () => {
  const ds = dataset();
  const ids = Uint32Array.from({ length: ds.rowCount }, (_, index) => index);
  const network = computeColumnNetwork(ds.columns, ids, ds.rowCount, { rowLimit: 100 });

  assert.equal(network.sampled, true);
  assert.equal(network.analyzedRows, 100);
  assert.equal(network.totalRows, 120);
  assert.ok(network.edges.length > 0);

  const again = computeColumnNetwork(ds.columns, ids, ds.rowCount, { rowLimit: 100 });
  assert.deepEqual(
    again.edges.map((edge) => [edge.aLabel, edge.bLabel, edge.method]),
    network.edges.map((edge) => [edge.aLabel, edge.bLabel, edge.method]),
  );
});

test("column network keeps working on a filtered sparse row set", () => {
  const ds = dataset();
  const ids = Uint32Array.from({ length: 40 }, (_, index) => index * 3);
  const network = computeColumnNetwork(ds.columns, ids, ds.rowCount);
  assert.equal(network.totalRows, 40);
  assert.ok(network.nodes.some((node) => node.role === "text"));
  assert.ok(network.edges.some((edge) => edge.method === "tokenOverlap"));
});

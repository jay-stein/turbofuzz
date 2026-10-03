import { test } from "node:test";
import assert from "node:assert/strict";
import { ingestDataset } from "../src/worker/ingest.js";

test("ingestDataset parses text and reports progress", () => {
  const phases: string[] = [];
  const details: string[] = [];
  const dataset = ingestDataset({
    name: "test",
    delimiter: "auto",
    hasHeaders: true,
    text: "name,age\nAlice,30\nBob,40\nCara,50",
    onProgress: (progress) => {
      phases.push(progress.phase);
      if (progress.detail !== undefined) details.push(progress.detail);
    },
  });

  assert.equal(dataset.rowCount, 3);
  assert.equal(dataset.columnCount, 2);
  assert.equal(dataset.name, "test");
  assert.deepEqual(
    dataset.columns.map((column) => column.type),
    ["category", "integer"],
  );
  assert.ok(phases.includes("parse"));
  assert.ok(phases.includes("build"));
  assert.ok(details.some((detail) => detail.includes("Building columns")));
  assert.ok(details.includes("Computing dataset stats…"));
});

test("ingestDataset decodes transferred array buffers", () => {
  const encoded = new TextEncoder().encode("a,b\n1,2\n3,4");
  const buffer = encoded.buffer.slice(
    encoded.byteOffset,
    encoded.byteOffset + encoded.byteLength,
  ) as ArrayBuffer;

  const dataset = ingestDataset({
    name: "buffer",
    delimiter: "auto",
    hasHeaders: true,
    buffer,
  });

  assert.equal(dataset.rowCount, 2);
  assert.deepEqual(dataset.columns.map((column) => column.name), ["a", "b"]);
});

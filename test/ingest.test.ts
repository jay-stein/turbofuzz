import { test } from "node:test";
import assert from "node:assert/strict";
import { ingestDataset } from "../src/worker/ingest.js";

test("ingestDataset parses text and reports progress", () => {
  const phases: string[] = [];
  const details: string[] = [];
  const { dataset, encoding } = ingestDataset({
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
  assert.equal(encoding, null);
  assert.deepEqual(
    dataset.columns.map((column) => column.type),
    ["category", "integer"],
  );
  assert.ok(phases.includes("parse"));
  assert.ok(phases.includes("build"));
  assert.ok(details.some((detail) => detail.includes("Building columns")));
  assert.ok(details.includes("Computing dataset stats…"));
});

test("ingestDataset decodes transferred UTF-8 array buffers", () => {
  const encoded = new TextEncoder().encode("a,b\n1,2\n3,4");
  const buffer = encoded.buffer.slice(
    encoded.byteOffset,
    encoded.byteOffset + encoded.byteLength,
  ) as ArrayBuffer;

  const { dataset, encoding } = ingestDataset({
    name: "buffer",
    delimiter: "auto",
    hasHeaders: true,
    buffer,
  });

  assert.equal(dataset.rowCount, 2);
  assert.equal(encoding, "utf-8");
  assert.deepEqual(dataset.columns.map((column) => column.name), ["a", "b"]);
});

test("ingestDataset skips title rows and keeps the full width", () => {
  const { dataset } = ingestDataset({
    name: "loans",
    delimiter: "auto",
    hasHeaders: true,
    text: [
      "Notes offered by Prospectus (lendingclub.com)",
      "",
      "id,loan_amnt,term,grade",
      "1,5000,36 months,A",
      "2,10000,60 months,B",
    ].join("\n"),
  });

  assert.equal(dataset.rowCount, 2);
  assert.equal(dataset.columnCount, 4);
  assert.deepEqual(
    dataset.columns.map((column) => column.name),
    ["id", "loan_amnt", "term", "grade"],
  );
  assert.equal(dataset.columns[0].raw[0], "1");
});

test("ingestDataset builds datasets from scraped tables", () => {
  const { dataset, encoding } = ingestDataset({
    name: "scraped",
    delimiter: "auto",
    hasHeaders: true,
    table: {
      rows: [
        ["Name", "Age"],
        ["Alice", "30"],
        ["Bob"],
      ],
      hasHeaders: true,
    },
  });

  assert.equal(encoding, null);
  assert.deepEqual(
    dataset.columns.map((column) => column.name),
    ["Name", "Age"],
  );
  assert.equal(dataset.rowCount, 2);
  assert.deepEqual(dataset.columns[1].raw, ["30", ""]);
});

test("ingestDataset falls back to windows-1252 for legacy files", () => {
  // quoted: "price\n"\x80343,000"\n" -> price "€343,000" in windows-1252
  const bytes = Uint8Array.from([
    0x70, 0x72, 0x69, 0x63, 0x65, 0x0a, 0x22, 0x80, 0x33, 0x34, 0x33, 0x2c, 0x30, 0x30, 0x30,
    0x22, 0x0a,
  ]);
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;

  const { dataset, encoding } = ingestDataset({
    name: "legacy",
    delimiter: "auto",
    hasHeaders: true,
    buffer,
  });

  assert.equal(encoding, "windows-1252");
  assert.equal(dataset.columns[0].raw[0], "€343,000");
  assert.equal(dataset.columns[0].type, "number");
  assert.equal(dataset.columns[0].numbers()[0], 343000);
});

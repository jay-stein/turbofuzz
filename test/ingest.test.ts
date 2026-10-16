import { test } from "node:test";
import assert from "node:assert/strict";
import { ingestDataset } from "../src/worker/ingest.js";

test("ingestDataset parses text and reports progress", () => {
  const phases: string[] = [];
  const details: string[] = [];
  const steps: { phase: string; detail?: string; current?: number; total?: number }[] = [];
  const { dataset, encoding } = ingestDataset({
    name: "test",
    delimiter: "auto",
    hasHeaders: true,
    text: "name,age\nAlice,30\nBob,40\nCara,50",
    onProgress: (progress) => {
      phases.push(progress.phase);
      if (progress.detail !== undefined) details.push(progress.detail);
      if (progress.current !== undefined) steps.push(progress);
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
  const build = steps.filter((step) => step.phase === "build");
  assert.deepEqual(
    build.map((step) => [step.current, step.total]),
    [
      [1, 2],
      [2, 2],
    ],
  );
  const stats = steps.filter((step) => step.phase === "stats");
  assert.ok(stats.some((step) => step.detail?.includes("Hashing rows")));
  assert.ok(stats.some((step) => step.detail?.includes("Checking outliers")));
  assert.ok(stats.every((step) => step.total === 2));
});

test("ingestDataset decodes transferred UTF-8 array buffers", () => {  const encoded = new TextEncoder().encode("a,b\n1,2\n3,4");
  const buffer = encoded.buffer.slice(
    encoded.byteOffset,
    encoded.byteOffset + encoded.byteLength,
  ) as ArrayBuffer;

  const { dataset, encoding, delimiter } = ingestDataset({
    name: "buffer",
    delimiter: "auto",
    hasHeaders: true,
    buffer,
  });

  assert.equal(dataset.rowCount, 2);
  assert.equal(encoding, "utf-8");
  assert.equal(delimiter, ",");
  assert.deepEqual(dataset.columns.map((column) => column.name), ["a", "b"]);
});

test("ingestDataset reports the detected delimiter for semicolon files", () => {
  const { delimiter } = ingestDataset({
    name: "euro.csv",
    delimiter: "auto",
    hasHeaders: true,
    text: "name;qty;price\nx;1;1,50\ny;2;2,25",
  });
  assert.equal(delimiter, ";");

  const json = ingestDataset({
    name: "rows.json",
    delimiter: "auto",
    hasHeaders: true,
    text: '[{"a": 1, "b": 2}]',
  });
  assert.equal(json.delimiter, null);
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

test("ingestDataset builds datasets from pre-structured grids", () => {
  const { dataset, encoding } = ingestDataset({
    name: "worksheet",
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

test("ingestDataset keeps a blank-header column that data populates", () => {
  const { dataset, ragged } = ingestDataset({
    name: "blank-header.csv",
    delimiter: "auto",
    hasHeaders: true,
    text: "id,name,notes,\n1,Alice,,x\n2,Bob,,x\n",
  });

  assert.deepEqual(
    dataset.columns.map((column) => column.name),
    ["id", "name", "notes", "Column 4"],
  );
  assert.deepEqual(dataset.columns[3].raw, ["x", "x"]);
  assert.deepEqual(ragged, { paddedRows: 0, extraCellRows: 0, extraCells: 0 });
});

test("ingestDataset reports padded and trimmed ragged rows", () => {
  const lines = ["a,b,c", "1,2", "3,4,5"];
  for (let i = 0; i < 30; i++) lines.push(`${i},x,y`);
  lines.push("99,x,y,EXTRA");

  const { dataset, ragged } = ingestDataset({
    name: "ragged.csv",
    delimiter: "auto",
    hasHeaders: true,
    text: lines.join("\n") + "\n",
  });

  assert.equal(dataset.columnCount, 3);
  assert.equal(dataset.rowCount, 33);
  assert.deepEqual(ragged, { paddedRows: 1, extraCellRows: 1, extraCells: 1 });
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

test("ingestDataset keeps prefixed ID columns out of Date", () => {
  const rows = Array.from(
    { length: 20 },
    (_, i) => `ORD-${String(i + 1).padStart(5, "0")},15 Mar 2024`,
  );
  const { dataset } = ingestDataset({
    name: "orders.csv",
    delimiter: "auto",
    hasHeaders: true,
    text: `order_id,order_date\n${rows.join("\n")}\n`,
  });

  assert.equal(dataset.columns[0].type, "string");
  assert.equal(dataset.columns[1].type, "date");
});

test("ingestDataset parses JSON by file name", () => {
  const { dataset } = ingestDataset({
    name: "data.json",
    delimiter: "auto",
    hasHeaders: true,
    text: '[{"city":"Sydney","sales":10},{"city":"Melbourne","sales":20}]',
  });
  assert.deepEqual(
    dataset.columns.map((column) => column.name),
    ["city", "sales"],
  );
  assert.equal(dataset.rowCount, 2);
  assert.deepEqual(dataset.columns[0].raw, ["Sydney", "Melbourne"]);
});

test("ingestDataset sniffs pasted JSON", () => {
  const { dataset } = ingestDataset({
    name: "Pasted data",
    delimiter: "auto",
    hasHeaders: true,
    text: '[{"a":1},{"a":2}]',
  });
  assert.deepEqual(
    dataset.columns.map((column) => column.name),
    ["a"],
  );
  assert.equal(dataset.rowCount, 2);
});

test("maxRows previews only the first rows of delimited text", () => {
  const rows = Array.from({ length: 50 }, (_, index) => `${index},value-${index}`).join("\n");
  const { dataset } = ingestDataset({
    name: "sample",
    delimiter: "auto",
    hasHeaders: false,
    text: `a,b\n${rows}`,
    maxRows: 10,
  });
  assert.equal(dataset.rowCount, 10, "only the preview rows are materialised");
  assert.equal(dataset.columnCount, 2);
});

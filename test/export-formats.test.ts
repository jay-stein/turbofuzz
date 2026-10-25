import { test } from "node:test";
import assert from "node:assert/strict";
import { gunzipSync, unzipSync } from "fflate";
import {
  buildExportFileName,
  encodeExport,
  stripExportExtension,
  timestampString,
} from "../src/ui/export-formats.js";

const CSV = 'id,name,note\r\n1,Ann,"a, b"\r\n02,Bo,\r\n';

test("timestampString is local YYYYMMDDHHMMSS", () => {
  assert.equal(timestampString(new Date(2026, 9, 26, 0, 40, 30)), "20261026004030");
});

test("file names get the format extension and an optional date-time prefix", () => {
  const now = new Date(2026, 9, 26, 0, 40, 30);
  assert.equal(
    buildExportFileName("sales.csv", "x", "json", "none", true, now),
    "20261026004030_sales.json",
  );
  assert.equal(buildExportFileName("sales", "x", "csv", "gzip", false, now), "sales.csv.gz");
  assert.equal(buildExportFileName("  ", "fallback-cleaned", "xlsx", "none", true, now), "20261026004030_fallback-cleaned.xlsx");
  assert.equal(buildExportFileName("a/b:c", "x", "tsv", "none", false, now), "a-b-c.tsv");
  assert.equal(stripExportExtension("data.csv.gz"), "data");
});

test("csv passes through with a BOM; tsv and semicolon re-delimit", async () => {
  const csv = await encodeExport(CSV, "csv", "none", "x.csv");
  const head = new Uint8Array(await csv.blob.arrayBuffer()).slice(0, 3);
  assert.deepEqual([...head], [0xef, 0xbb, 0xbf], "UTF-8 BOM so Excel reads accents");
  const tsv = await (await encodeExport(CSV, "tsv", "none", "x.tsv")).blob.text();
  assert.match(tsv, /id\tname\tnote/);
  assert.match(tsv, /1\tAnn\ta, b/);
  const semi = await (await encodeExport(CSV, "csv-semicolon", "none", "x.csv")).blob.text();
  assert.match(semi, /id;name;note/);
});

test("json keeps leading-zero ids as text and writes plain numbers as numbers", async () => {
  const json = JSON.parse(await (await encodeExport(CSV, "json", "none", "x.json")).blob.text());
  assert.deepEqual(json, [
    { id: 1, name: "Ann", note: "a, b" },
    { id: "02", name: "Bo", note: null },
  ]);
  const lines = (await (await encodeExport(CSV, "jsonl", "none", "x.jsonl")).blob.text())
    .trim()
    .split("\n");
  assert.equal(lines.length, 2);
  assert.equal(JSON.parse(lines[0]).name, "Ann");
});

test("gzip and zip wrap the encoded file", async () => {
  const gz = await encodeExport(CSV, "tsv", "gzip", "x.tsv.gz");
  const text = new TextDecoder().decode(gunzipSync(new Uint8Array(await gz.blob.arrayBuffer())));
  assert.match(text, /id\tname\tnote/);
  const zip = await encodeExport(CSV, "tsv", "zip", "x.tsv.zip");
  const files = unzipSync(new Uint8Array(await zip.blob.arrayBuffer()));
  assert.deepEqual(Object.keys(files), ["x.tsv"]);
});

test("xlsx produces a workbook the reader can open", async () => {
  const xlsx = await encodeExport(CSV, "xlsx", "none", "x.xlsx");
  const XLSX = await import("xlsx");
  const book = XLSX.read(new Uint8Array(await xlsx.blob.arrayBuffer()), { type: "array" });
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(book.Sheets[book.SheetNames[0]]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].id, 1);
  assert.equal(rows[1].id, "02");
});

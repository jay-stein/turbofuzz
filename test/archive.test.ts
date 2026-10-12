import { test } from "node:test";
import assert from "node:assert/strict";
import { zipSync } from "fflate";
import { listArchiveEntries, readArchiveEntries, readArchiveEntry, readArchivePrefixes } from "../src/parse/archive.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

test("lists supported files in a zip and skips junk", async () => {
  const zip = zipSync({
    "sales/north.csv": encoder.encode("name,total\nA,1\nB,2"),
    "notes.txt": encoder.encode("hello"),
    "images/logo.png": encoder.encode("not really a png"),
    "__MACOSX/._north.csv": encoder.encode("junk"),
    "sales/._north.csv": encoder.encode("junk"),
    ".DS_Store": encoder.encode("junk"),
  });
  const entries = await listArchiveEntries(toBuffer(zip));
  assert.deepEqual(
    entries.map((entry) => entry.path),
    ["notes.txt", "sales/north.csv"],
  );
  assert.ok(entries.every((entry) => entry.size > 0));
});

test("extracts a single entry by path", async () => {
  const zip = zipSync({
    "a.csv": encoder.encode("x\n1"),
    "b.csv": encoder.encode("y\n2"),
  });
  const buffer = toBuffer(zip);
  const bytes = await readArchiveEntry(buffer, "b.csv");
  assert.equal(decoder.decode(bytes), "y\n2");
});

test("reads several entries in one pass for Import all", async () => {
  const zip = zipSync({
    "jan.csv": encoder.encode("region,total\nNorth,10"),
    "feb.csv": encoder.encode("region,total\nSouth,5"),
    "logo.png": encoder.encode("not really a png"),
  });
  const files = await readArchiveEntries(toBuffer(zip), ["jan.csv", "feb.csv"]);
  assert.equal(files.size, 2);
  assert.equal(decoder.decode(files.get("jan.csv")), "region,total\nNorth,10");
  assert.equal(decoder.decode(files.get("feb.csv")), "region,total\nSouth,5");
  assert.equal(files.has("logo.png"), false, "unrequested entries are not inflated");
});

test("reads only the first bytes of several entries for header checks", async () => {
  const zip = zipSync({
    "big.csv": encoder.encode("name,total\nA,1234567890"),
    "other.csv": encoder.encode("name,total\nB,9876543210"),
  });
  const prefixes = await readArchivePrefixes(toBuffer(zip), ["big.csv", "other.csv"], 12);
  assert.equal(decoder.decode(prefixes.get("big.csv")), "name,total\nA");
  assert.equal(decoder.decode(prefixes.get("other.csv")), "name,total\nB");
  assert.equal(prefixes.size, 2);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { gzipSync, zipSync } from "fflate";
import { resolveSource, unreadableReason } from "../src/ui/source-resolver.js";

const file = (name: string, bytes: Uint8Array) => ({
  name,
  arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
});
const text = (buffer: ArrayBuffer) => new TextDecoder().decode(buffer);
const csv = new TextEncoder().encode("a,b\n1,2\n");

test("plain, gzipped and zipped tables resolve to their text, without asking", async () => {
  assert.equal(text((await resolveSource(file("t.csv", csv)))!.buffer), "a,b\n1,2\n");
  const gz = await resolveSource(file("t.csv.gz", gzipSync(csv)));
  assert.deepEqual([gz!.name, text(gz!.buffer)], ["t.csv", "a,b\n1,2\n"]);
  const zipped = await resolveSource(file("t.zip", zipSync({ "dir/t.csv": csv })));
  assert.deepEqual([zipped!.name, text(zipped!.buffer)], ["t.csv", "a,b\n1,2\n"]);
});

test("an archive with no tables, and an unknown type, say so", async () => {
  await assert.rejects(resolveSource(file("e.zip", zipSync({ "readme.pdf": csv }))), /No tables found/);
  assert.match(unreadableReason("photo.png") ?? "", /not a CSV/);
  for (const name of ["a.csv", "a.xlsx", "a.xls", "a.zip", "a.gz", "a.bz2", "a.parquet"]) assert.equal(unreadableReason(name), null);
});

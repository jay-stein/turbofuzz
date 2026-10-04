import { test } from "node:test";
import assert from "node:assert/strict";
import { decompressBzip2 } from "../src/parse/bz2.js";

// bz2 of "name,total\nA,1\nB,2\n" (generated with Python's bz2 module).
const FIXTURE =
  "QlpoOTFBWSZTWVp11JgAAAfdgAAQAAQwADAAIgeEACAAIaTT0E2kIBoAvpiboUNSQJ2fi7kinChILTrqTAA=";

function toBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

test("decompresses bzip2 data", async () => {
  const buffer = toBuffer(new Uint8Array(Buffer.from(FIXTURE, "base64")));
  const output = await decompressBzip2(buffer);
  assert.equal(new TextDecoder().decode(output), "name,total\nA,1\nB,2\n");
});

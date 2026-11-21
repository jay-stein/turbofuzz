import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeText } from "../src/parse/encoding.js";

function utf16(text: string, order: "le" | "be", bom: boolean): ArrayBuffer {
  const bytes = new Uint8Array((text.length + (bom ? 1 : 0)) * 2);
  const put = (at: number, code: number): void => {
    bytes[at + (order === "le" ? 0 : 1)] = code & 255;
    bytes[at + (order === "le" ? 1 : 0)] = code >> 8;
  };
  if (bom) put(0, 0xfeff);
  for (let i = 0; i < text.length; i++) put((i + (bom ? 1 : 0)) * 2, text.charCodeAt(i));
  return bytes.buffer;
}

test("UTF-16 files decode by their byte-order mark, or by the zero bytes when there is none", () => {
  const text = "name\tcity\nZoë\tMünchen\n";
  assert.deepEqual(decodeText(utf16(text, "le", true)), { text, encoding: "utf-16le" });
  assert.deepEqual(decodeText(utf16(text, "be", true)), { text, encoding: "utf-16be" });
  assert.deepEqual(decodeText(utf16(text, "le", false)), { text, encoding: "utf-16le" });
  // Plain UTF-8 and Western text are unaffected.
  assert.equal(decodeText(new TextEncoder().encode("a,b\n1,2\n").buffer).encoding, "utf-8");
});

test("a stray NUL byte in a UTF-8 file does not turn it into UTF-16", () => {
  // S13-21: one zero byte at an odd offset in a short file read as UTF-16 LE: header "ⱡ੢ⰱx…", no rows.
  const decoded = decodeText(new TextEncoder().encode("a,b\n1,x\u0000y\n2,z\n").buffer);
  assert.equal(decoded.encoding, "utf-8");
  assert.ok(decoded.text.startsWith("a,b\n1,x"));
});

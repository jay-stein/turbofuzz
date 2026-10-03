import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeText } from "../src/parse/encoding.js";
import { normalize, tokenize } from "../src/search/normalize.js";

function bytes(...values: number[]): ArrayBuffer {
  const array = Uint8Array.from(values);
  return array.buffer.slice(array.byteOffset, array.byteOffset + array.byteLength) as ArrayBuffer;
}

test("decodeText reads UTF-8 and strips a BOM", () => {
  const utf8 = new TextEncoder().encode("café,€");
  const decoded = decodeText(
    utf8.buffer.slice(utf8.byteOffset, utf8.byteOffset + utf8.byteLength) as ArrayBuffer,
  );
  assert.equal(decoded.encoding, "utf-8");
  assert.equal(decoded.text, "café,€");

  const withBom = decodeText(bytes(0xef, 0xbb, 0xbf, 0x61, 0x2c, 0x62));
  assert.equal(withBom.encoding, "utf-8");
  assert.equal(withBom.text, "a,b");
});

test("decodeText falls back to windows-1252 for invalid UTF-8", () => {
  const decoded = decodeText(bytes(0x43, 0x61, 0x66, 0xe9, 0x2c, 0x20, 0x80));
  assert.equal(decoded.encoding, "windows-1252");
  assert.equal(decoded.text, "Café, €");
});

test("normalize strips Latin/Greek/Cyrillic diacritics only", () => {
  assert.equal(normalize("José Müller Ångström"), "jose muller angstrom");
  assert.equal(normalize("naïve café"), "naive cafe");
  assert.equal(normalize("İstanbul"), "istanbul");
  assert.equal(normalize("Straße"), "straße");
  assert.equal(normalize("Москва"), "москва");
});

test("normalize preserves Indic combining marks", () => {
  const hindi = normalize("हिन्दी");
  assert.ok(hindi.includes("\u093f"), "Devanagari vowel sign survives normalization");
});

test("tokenize keeps non-ASCII letters as single tokens", () => {
  assert.deepEqual(tokenize("Straße"), ["straße"]);
  assert.deepEqual(tokenize("Müller GmbH & Co. KG"), ["muller", "gmbh", "co", "kg"]);
  assert.deepEqual(tokenize("Москва, Россия"), ["москва", "россия"]);
  assert.deepEqual(tokenize("東京タワー"), ["東京タワー"]);
  assert.deepEqual(tokenize("emoji 🚀 test"), ["emoji", "test"]);
});

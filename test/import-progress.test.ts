import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDelimited, parseDelimitedAsync } from "../src/parse/parse.js";

function bigCsv(rows: number, strayAt = -1): string {
  const lines = ["id,name,qty"];
  for (let i = 0; i < rows; i++) lines.push(i === strayAt ? `${i},"unclosed,3` : `${i},"item ${i}",${i % 7}`);
  return lines.join("\n");
}

test("the chunked read gives exactly what the plain read gives", async () => {
  const text = bigCsv(300_000);
  assert.ok(text.length > 4_000_000, "big enough to be read in chunks");
  const chunked = await parseDelimitedAsync(text, { hasHeaders: false, normalizeRows: false });
  const plain = parseDelimited(text, { hasHeaders: false, normalizeRows: false });
  assert.ok(chunked !== null);
  assert.equal(chunked.rows.length, plain.rows.length);
  assert.deepEqual(chunked.rows.slice(0, 5), plain.rows.slice(0, 5));
  assert.deepEqual(chunked.rows.at(-1), plain.rows.at(-1));
  assert.deepEqual(chunked.ragged, plain.ragged);
});

test("a stray quote is found and named at the same line in the chunked read", async () => {
  const text = bigCsv(300_000, 120_000);
  const chunked = await parseDelimitedAsync(text, { hasHeaders: false, normalizeRows: false });
  const plain = parseDelimited(text, { hasHeaders: false, normalizeRows: false });
  assert.ok(chunked !== null);
  assert.equal(plain.ragged.strayQuoteLines?.length, 1, "the plain read finds the stray quote");
  assert.deepEqual(chunked.ragged.strayQuoteLines, plain.ragged.strayQuoteLines);
  assert.equal(chunked.rows.length, plain.rows.length);
});

test("the chunked read reports rows so far, and stops when cancelled", async () => {
  const text = bigCsv(300_000);
  const seen: number[] = [];
  const full = await parseDelimitedAsync(text, {}, { onChunk: (rows) => seen.push(rows) });
  assert.ok(full !== null);
  assert.ok(seen.length >= 2, "more than one report on a big file");
  assert.ok(seen.every((rows, i) => i === 0 || rows > seen[i - 1]), "rows only grow");

  let cancelNow = false;
  const stopped = await parseDelimitedAsync(
    text,
    {},
    { onChunk: () => (cancelNow = true), cancelled: () => cancelNow },
  );
  assert.equal(stopped, null);
});

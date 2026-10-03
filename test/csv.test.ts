import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDataset } from "../src/data/build.js";
import { buildCsv, csvEscape } from "../src/worker/csv.js";

test("csvEscape quotes separators, quotes and newlines", () => {
  assert.equal(csvEscape("plain"), "plain");
  assert.equal(csvEscape("a,b"), '"a,b"');
  assert.equal(csvEscape('say "hi"'), '"say ""hi"""');
  assert.equal(csvEscape("line1\nline2"), '"line1\nline2"');
  assert.equal(csvEscape("carriage\rreturn"), '"carriage\rreturn"');
});

test("buildCsv writes header and escapes rows", () => {
  const dataset = buildDataset("t", ["name", "note"], [
    ["x,y", 'q"z'],
    ["plain", ""],
  ]);
  const ids = Uint32Array.from([0, 1]);
  const text = buildCsv(dataset, ids, 0, 2, true);
  assert.equal(text, 'name,note\r\n"x,y","q""z"\r\nplain,\r\n');
});

test("buildCsv chunks concatenate cleanly", () => {
  const dataset = buildDataset("t", ["a"], [["1"], ["2"]]);
  const ids = Uint32Array.from([0, 1]);
  const first = buildCsv(dataset, ids, 0, 1, true);
  const second = buildCsv(dataset, ids, 1, 2, false);
  assert.equal(first, "a\r\n1\r\n");
  assert.equal(second, "2\r\n");
  assert.equal(first + second, "a\r\n1\r\n2\r\n");
});

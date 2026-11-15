import { test } from "node:test";
import assert from "node:assert/strict";
import { charDiff } from "../src/data/compare/char-diff.js";

const marked = (segments: { text: string; differs: boolean }[]): string => segments.filter((s) => s.differs).map((s) => s.text).join("|");

test("marks only the letters that differ", () => {
  const diff = charDiff("Acme Pty Ltd", "Acme Pty Limited");
  assert.equal(marked(diff.a), "");
  assert.equal(marked(diff.b), "imi|e");
});

test("case alone is not a difference, and the text is kept as written", () => {
  const diff = charDiff("ACME", "Acme");
  assert.equal(marked(diff.a), "");
  assert.equal(diff.a.map((s) => s.text).join(""), "ACME");
  assert.equal(diff.b.map((s) => s.text).join(""), "Acme");
});

test("a swapped letter marks one on each side", () => {
  const diff = charDiff("Smith", "Smyth");
  assert.equal(marked(diff.a), "i");
  assert.equal(marked(diff.b), "y");
});

test("very long text is returned plain", () => {
  const long = "x".repeat(500);
  assert.equal(marked(charDiff(long, `${long}y`).b), "");
});

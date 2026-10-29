import { test } from "node:test";
import assert from "node:assert/strict";
import { applyCleanOps, describeCleanOp } from "../src/data/clean-ops.js";
import { maskEdges } from "../src/data/mask-value.js";
import { pandasRecipeScript } from "../src/data/recipe.js";
import { polarsRecipeScript } from "../src/data/recipe-polars.js";
import { sha256Hex } from "../src/data/sha256.js";

test("sha256 matches the standard test vectors", () => {
  assert.equal(sha256Hex(""), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  assert.equal(sha256Hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assert.equal(
    sha256Hex("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"),
    "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
  );
  // Multi-byte text hashes its UTF-8 bytes; long input crosses block boundaries.
  assert.equal(sha256Hex("a".repeat(1000)).length, 64);
  assert.notEqual(sha256Hex("Muñeca"), sha256Hex("Muneca"));
});

test("mask keeps the edges, hides the middle and leaves emails readable by domain", () => {
  assert.equal(maskEdges("0412345678", 2, 2), "04******78");
  assert.equal(maskEdges("jane.doe@example.com", 1, 2), "j***@example.com");
  assert.equal(maskEdges("jane.doe@example.com", 3, 0), "jan***@example.com");
  assert.equal(maskEdges("abcd", 2, 2), "****", "nothing left to keep");
  assert.equal(maskEdges("", 1, 1), "");
});

test("mask and hash ops rewrite values but never gaps", () => {
  const values = ["jane@example.com", "", "N/A", "0412345678", "  Ann Lee  "];
  const masked = applyCleanOps(values, [{ kind: "mask", keepFirst: 1, keepLast: 2 }]);
  assert.deepEqual(masked, ["j***@example.com", "", "N/A", "0*******78", "A****ee"]);

  const hashed = applyCleanOps(values, [{ kind: "hash", salt: "s1" }]);
  assert.equal(hashed[1], "");
  assert.equal(hashed[2], "N/A");
  assert.match(hashed[0], /^[0-9a-f]{16}$/);
  assert.equal(hashed[0], sha256Hex("s1\u0000jane@example.com").slice(0, 16));
  // Whitespace around a value does not change its hash, so joins still line up.
  assert.equal(hashed[4], applyCleanOps(["Ann Lee"], [{ kind: "hash", salt: "s1" }])[0]);
  // A different salt gives a different pseudonym; the same salt is repeatable.
  assert.notEqual(applyCleanOps(["x"], [{ kind: "hash", salt: "a" }])[0], applyCleanOps(["x"], [{ kind: "hash", salt: "b" }])[0]);
  assert.deepEqual(applyCleanOps(values, [{ kind: "hash", salt: "s1" }]), hashed);
});

test("the ops describe themselves in plain language", () => {
  assert.match(describeCleanOp({ kind: "mask", keepFirst: 1, keepLast: 2 }), /Mask values/);
  assert.match(describeCleanOp({ kind: "hash", salt: "x" }), /SHA-256/);
});

test("both script targets emit runnable code and report the placeholder difference", () => {
  const input = {
    cleans: [
      { name: "email", ops: [{ kind: "mask", keepFirst: 1, keepLast: 2 } as const] },
      { name: "phone", ops: [{ kind: "hash", salt: "s1" } as const] },
    ],
    nulls: [],
    types: [],
    transforms: [],
    schema: [
      { name: "email", numeric: false },
      { name: "phone", numeric: false },
    ],
  };
  const polars = polarsRecipeScript(input).code;
  assert.match(polars, /def _tf_mask\(v, first, last\):/);
  assert.match(polars, /map_elements\(lambda v: _tf_mask\(v, 1, 2\)/);
  assert.match(polars, /hashlib\.sha256\(\("s1" \+ "\\x00" \+ v\.strip\(\)\)\.encode\("utf-8"\)\)\.hexdigest\(\)\[:16\]/);
  assert.match(polars, /leaves missing-value markers/);
  const pandas = pandasRecipeScript(input).code;
  assert.match(pandas, /def _tf_mask\(v, first, last\):/);
  assert.match(pandas, /email = .*map\(lambda v: _tf_mask\(v, 1, 2\)\)|\["email"\].*_tf_mask/);
  assert.match(pandas, /import hashlib/);
});

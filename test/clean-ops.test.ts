import { test } from "node:test";
import assert from "node:assert/strict";
import { applyCleanOps, describeCleanOp } from "../src/data/clean-ops.js";

test("trims and collapses whitespace", () => {
  assert.deepEqual(applyCleanOps(["  a   b ", " c "], [{ kind: "trim" }]), ["a b", "c"]);
});

test("applies case styles", () => {
  assert.deepEqual(applyCleanOps(["hello world"], [{ kind: "case", style: "upper" }]), [
    "HELLO WORLD",
  ]);
  assert.deepEqual(applyCleanOps(["Hello World"], [{ kind: "case", style: "lower" }]), [
    "hello world",
  ]);
  assert.deepEqual(applyCleanOps(["hello WORLD"], [{ kind: "case", style: "title" }]), [
    "Hello World",
  ]);
});

test("literal replace", () => {
  assert.deepEqual(
    applyCleanOps(["a-b-c"], [{ kind: "replace", find: "-", replacement: " ", ignoreCase: false }]),
    ["a b c"],
  );
});

test("case-insensitive replace", () => {
  assert.deepEqual(
    applyCleanOps(["Foo foo FOO"], [
      { kind: "replace", find: "foo", replacement: "bar", ignoreCase: true },
    ]),
    ["bar bar bar"],
  );
});

test("replace treats regex metacharacters literally", () => {
  assert.deepEqual(
    applyCleanOps(["a.b.c"], [{ kind: "replace", find: ".", replacement: "_", ignoreCase: true }]),
    ["a_b_c"],
  );
  assert.deepEqual(
    applyCleanOps(["$100"], [{ kind: "replace", find: "$", replacement: "", ignoreCase: false }]),
    ["100"],
  );
});

test("empty find is a no-op", () => {
  assert.deepEqual(
    applyCleanOps(["abc"], [{ kind: "replace", find: "", replacement: "x", ignoreCase: false }]),
    ["abc"],
  );
});

test("ops apply in sequence", () => {
  assert.deepEqual(
    applyCleanOps(["  hello  "], [{ kind: "trim" }, { kind: "case", style: "upper" }]),
    ["HELLO"],
  );
});

test("does not mutate the input array", () => {
  const input = ["  x  "];
  const result = applyCleanOps(input, [{ kind: "trim" }]);
  assert.deepEqual(input, ["  x  "]);
  assert.deepEqual(result, ["x"]);
});

test("rounds numeric cells to fixed decimal places", () => {
  assert.deepEqual(
    applyCleanOps(["1.2345", "2", "1,234.567", "$5.5"], [{ kind: "round", decimals: 2 }]),
    ["1.23", "2.00", "1234.57", "5.50"],
  );
});

test("round to zero decimals drops the fraction", () => {
  assert.deepEqual(applyCleanOps(["2.5", "-1.4"], [{ kind: "round", decimals: 0 }]), ["3", "-1"]);
});

test("round leaves non-numeric cells untouched", () => {
  assert.deepEqual(
    applyCleanOps(["abc", "N/A", ""], [{ kind: "round", decimals: 1 }]),
    ["abc", "N/A", ""],
  );
});

test("describeCleanOp summarises operations", () => {
  assert.equal(describeCleanOp({ kind: "trim" }), "Trim whitespace");
  assert.equal(describeCleanOp({ kind: "case", style: "upper" }), "UPPERCASE");
  assert.equal(describeCleanOp({ kind: "round", decimals: 2 }), "Round to 2 decimal places");
  assert.equal(describeCleanOp({ kind: "round", decimals: 1 }), "Round to 1 decimal place");
  assert.match(
    describeCleanOp({ kind: "replace", find: "a", replacement: "b", ignoreCase: true }),
    /Replace/,
  );
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { applyCleanOps, describeCleanOp, describeCleanOpDetail } from "../src/data/clean-ops.js";

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

test("converts formatted text to numbers", () => {
  assert.deepEqual(
    applyCleanOps(["$1,234.56", "44%", " (1,000) ", "n/a"], [
      { kind: "toNumber", locale: "dot" },
    ]),
    ["1234.56", "44", "-1000", "n/a"],
  );
  assert.deepEqual(
    applyCleanOps(["1.234,56", "49 %", "kein Wert"], [{ kind: "toNumber", locale: "comma" }]),
    ["1234.56", "49", "kein Wert"],
  );
});

test("converts mixed date text to ISO dates", () => {
  assert.deepEqual(
    applyCleanOps(["05/03/2024", "2024-12-31", "1 Mar 2024", "bogus"], [
      { kind: "toDate", order: "dmy" },
    ]),
    ["2024-03-05", "2024-12-31", "2024-03-01", "bogus"],
  );
});

test("describeCleanOp summarises operations", () => {
  assert.equal(describeCleanOp({ kind: "trim" }), "Trim whitespace (strip ends, collapse runs)");
  assert.equal(describeCleanOp({ kind: "case", style: "upper" }), "Change case to UPPERCASE");
  assert.match(
    describeCleanOp({ kind: "replace", find: "a", replacement: "b", ignoreCase: true }),
    /Replace text “a” → “b” \(case-insensitive\)/,
  );
  assert.match(describeCleanOp({ kind: "toNumber", locale: "comma" }), /1\.234,56/);
  assert.match(describeCleanOp({ kind: "toDate", order: "dmy" }), /DD\/MM\/YYYY/);
});

test("describeCleanOpDetail exposes the technical signature", () => {
  assert.equal(describeCleanOpDetail({ kind: "trim" }), "trim()");
  assert.equal(
    describeCleanOpDetail({ kind: "replace", find: "a", replacement: "b", ignoreCase: true }),
    'replace(find="a", with="b", ignoreCase=true)',
  );
  assert.equal(describeCleanOpDetail({ kind: "toDate", order: "dmy" }), "toDate(order=dmy)");
});

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyCleanOps,
  applyCleanOpsIncremental,
  describeCleanOp,
  describeCleanOpDetail,
} from "../src/data/clean-ops.js";

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

test("repairs values written in the other decimal convention only", () => {
  assert.deepEqual(
    applyCleanOps(["613,26", "1,234.56", "42", "1.157e+04", "(4,752.34)"], [
      { kind: "repairDecimal", locale: "dot" },
    ]),
    ["613.26", "1,234.56", "42", "1.157e+04", "(4,752.34)"],
  );
  assert.deepEqual(
    applyCleanOps(["1.23", "1,5", "1234,5"], [{ kind: "repairDecimal", locale: "comma" }]),
    ["1,23", "1,5", "1234,5"],
  );
});

test("escapes formula-like cells only", () => {
  assert.deepEqual(
    applyCleanOps(["=1+1", "@SUM(1,1)", "-999", "-2+3", "plain"], [
      { kind: "escapeFormulas" },
    ]),
    ["'=1+1", "'@SUM(1,1)", "-999", "'-2+3", "plain"],
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

test("converts date-times to canonical UTC ISO and keeps the clock", () => {
  assert.deepEqual(
    applyCleanOps(
      ["2013-08-15 00:18:08+00", "2013-08-15T00:18:08+02", "2024-12-31 09:30", "bogus"],
      [{ kind: "toDateTime", order: "dmy" }],
    ),
    ["2013-08-15T00:18:08Z", "2013-08-14T22:18:08Z", "2024-12-31T09:30:00Z", "bogus"],
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
  assert.match(describeCleanOp({ kind: "toDate", order: "dmy" }), /date only/);
  assert.match(describeCleanOp({ kind: "toDateTime", order: "dmy" }), /keeps the clock/);
});

test("cast ops apply pandas-style invalid-value policies", () => {
  assert.deepEqual(
    applyCleanOps(["1", "2.5", "T", ""], [
      { kind: "cast", target: "integer", policy: "coerce" },
    ]),
    ["1", "", "", ""],
  );
  assert.deepEqual(
    applyCleanOps(["1", "2.5", "T"], [
      { kind: "cast", target: "integer", policy: "keep" },
    ]),
    ["1", "2.5", "T"],
  );
  assert.deepEqual(
    applyCleanOps(["1", "2.5", "T"], [
      { kind: "cast", target: "integer", policy: "reject" },
    ]),
    ["1", "2.5", "T"],
  );
});

test("describeCleanOpDetail exposes the technical signature", () => {
  assert.equal(describeCleanOpDetail({ kind: "trim" }), "trim()");
  assert.equal(
    describeCleanOpDetail({ kind: "replace", find: "a", replacement: "b", ignoreCase: true }),
    'replace(find="a", with="b", ignoreCase=true)',
  );
  assert.equal(describeCleanOpDetail({ kind: "toDate", order: "dmy" }), "toDate(order=dmy)");
  assert.equal(
    describeCleanOpDetail({ kind: "toDateTime", order: "mdy" }),
    "toDateTime(order=mdy)",
  );
  assert.equal(
    describeCleanOpDetail({
      kind: "cast",
      target: "number",
      policy: "coerce",
      locale: "comma",
    }),
    "cast(target=number, policy=coerce, locale=comma, order=auto)",
  );
});

test("incremental clean applies only the new suffix and matches full replay", () => {
  const source = ["  a  ", " b "];
  const first = [{ kind: "trim" }] as const;
  const second = [
    { kind: "trim" },
    { kind: "case", style: "upper" },
  ] as const;
  const current = applyCleanOps(source, first);
  const incremental = applyCleanOpsIncremental(current, source, first, second);
  assert.equal(incremental.replayed, false);
  assert.deepEqual(incremental.values, applyCleanOps(source, second));

  const removed = applyCleanOpsIncremental(incremental.values, source, second, first);
  assert.equal(removed.replayed, true);
  assert.deepEqual(removed.values, current);

  const reordered = applyCleanOpsIncremental(
    incremental.values,
    source,
    second,
    [{ kind: "case", style: "upper" }, { kind: "trim" }],
  );
  assert.equal(reordered.replayed, true);
  assert.deepEqual(
    reordered.values,
    applyCleanOps(source, [{ kind: "case", style: "upper" }, { kind: "trim" }]),
  );
});
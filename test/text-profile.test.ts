import { test } from "node:test";
import assert from "node:assert/strict";
import { BitSet } from "../src/search/bitset.js";
import { textProfile } from "../src/data/text-profile.js";
import { textProfileFindings } from "../src/data/findings.js";

function mask(values: readonly string[], nulls: readonly number[] = []): BitSet {
  const bits = new BitSet(values.length);
  for (const row of nulls) bits.set(row);
  return bits;
}

test("textProfile counts terms, drops stopwords and detects shapes", () => {
  const values = [
    "The delivery was late and the delivery was cold",
    "delivery late again",
    "jane@example.com",
    "https://example.com/help",
    "+1 (555) 123-4567",
    "INVOICE PAID",
    "",
  ];
  const profile = textProfile(values, mask(values, [6]));
  assert.equal(profile.rows, 6, "empty cells are skipped");
  assert.equal(profile.shapes.email, 1);
  assert.equal(profile.shapes.url, 1);
  assert.equal(profile.shapes.phone, 1);
  assert.equal(profile.shapes.uppercase, 1);
  assert.equal(profile.shapes.hasDigits, 1);
  const top = profile.topTerms[0];
  assert.equal(top?.term, "delivery");
  assert.equal(top?.count, 3);
  assert.equal(
    profile.topTerms.some((entry) => entry.term === "the"),
    false,
    "stopwords are filtered",
  );
  assert.ok(profile.totalTokens >= 10);
  assert.ok(profile.distinctTerms >= 6);
  assert.ok(Math.abs(profile.avgLength - profile.characters / 6) < 1e-9);
});

test("textProfile drops core function words from Top terms", () => {
  const values = Array.from(
    { length: 5 },
    (_, index) => `quality of service is good and it is fast for users ${index}`,
  );
  const profile = textProfile(values, mask(values));
  const terms = profile.topTerms.map((entry) => entry.term);
  for (const stopword of ["of", "is", "it", "and", "for"]) {
    assert.equal(terms.includes(stopword), false, `"${stopword}" is filtered`);
  }
  assert.ok(terms.includes("quality"));
  assert.ok(terms.includes("service"));
});

test("textProfile detects sensitive shapes and can skip term counting", () => {
  const values = [
    "jane@example.com",
    "+1 (555) 123-4567",
    "4111 1111 1111 1111",
    "GB82 WEST 1234 5698 7654 32",
    "123-45-6789",
    "ordinary text",
  ];
  const profile = textProfile(values, mask(values), 30, false);
  assert.equal(profile.shapes.email, 1);
  assert.equal(profile.shapes.phone, 1);
  assert.equal(profile.shapes.creditCard, 1);
  assert.equal(profile.shapes.iban, 1);
  assert.equal(profile.shapes.governmentId, 1);
  assert.deepEqual(profile.topTerms, [], "shape-only scans skip term counting");
  assert.equal(profile.totalTokens, 0);
});

test("textProfile handles numeric-looking text without counting it as terms", () => {
  const values = ["1.5", "2", "3", "north", "south", "north"];
  const profile = textProfile(values, mask(values));
  assert.equal(profile.shapes.numeric, 3);
  assert.deepEqual(
    profile.topTerms.map((entry) => entry.term),
    ["north", "south"],
  );
});

test("textProfileFindings summarises free text and flags shaped mixes", () => {
  const values: string[] = [];
  for (let index = 0; index < 12; index++) {
    values.push(`delivery number ${index} arrived late again`);
  }
  for (let index = 0; index < 8; index++) {
    values.push(`person${index}@example.com`);
  }
  const profile = textProfile(values, mask(values));
  const findings = textProfileFindings([{ column: 2, label: "notes", profile }]);
  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.severity, "review", "8 of 20 shaped values is a mix");
  assert.match(findings[0]?.title ?? "", /mixes 40% shaped values/);
  assert.ok(
    findings[0]?.evidence.some(
      (entry) => entry.metric === "shaped values" && entry.value.includes("8 email"),
    ),
  );
  assert.ok(
    findings[0]?.evidence.some((entry) => entry.metric === "method"),
  );

  const proseValues: string[] = [];
  for (let index = 0; index < 24; index++) {
    proseValues.push(`Prose line ${index} about foxes wandering through northern yards`);
  }
  const prose = textProfile(proseValues, mask(proseValues));
  const info = textProfileFindings([{ column: 3, label: "review", profile: prose }]);
  assert.equal(info.length, 1);
  assert.equal(info[0]?.severity, "info");
  assert.match(info[0]?.title ?? "", /is free text/);
  assert.equal(info[0]?.impact.columns[0], 3);
});

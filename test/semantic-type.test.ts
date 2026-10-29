import { test } from "node:test";
import assert from "node:assert/strict";
import { ColumnData } from "../src/data/column.js";
import { computePatternProfiles } from "../src/data/mask-profile.js";
import { textProfile } from "../src/data/text-profile.js";
import { nameTokens } from "../src/data/semantic-type.js";

const rows = (n: number, make: (i: number) => string) => Array.from({ length: n }, (_, i) => make(i));

test("name tokens split on separators and camelCase, whole words only", () => {
  assert.deepEqual(nameTokens("customerPhone_2"), ["customer", "phone", "2"]);
  assert.ok(!nameTokens("percentage").includes("age"));
});

test("phone, ticket and subject-id columns are blocked from conversion", () => {
  const mobile = ColumnData.create("mobile", rows(300, (i) => (i % 3 === 0 ? `+61 4${10000000 + i}` : `04${10000000 + i}`)));
  assert.equal(mobile.semantic?.type, "phone");
  assert.equal(mobile.conformance, null);
  assert.equal(mobile.typeDowngrade, null);
  assert.ok(!mobile.suggestions.some((s) => s.kind === "number"));

  const ticket = ColumnData.create("Ticket", rows(300, (i) => (i % 2 ? `PC ${17000 + i}` : String(300000 + i))));
  assert.equal(ticket.semantic?.type, "code");
  assert.equal(ticket.conformance, null);
  assert.equal(ticket.typeDowngrade, null);
  assert.ok(!ticket.suggestions.some((s) => s.kind === "number"));

  const subject = ColumnData.create("USUBJID", rows(300, (i) => `STUDY1-${1000 + i}`));
  assert.equal(subject.semantic?.type, "identifier");
});

test("ISO dates are date-shaped, never phone or TFN", () => {
  const nulls = ColumnData.create("d", ["x"]).nullMask;
  const dates = rows(200, (i) => `2023-0${(i % 9) + 1}-${10 + (i % 18)}`);
  const profile = textProfile(dates, nulls, 5, false);
  assert.equal(profile.shapes.phone, 0);
  assert.equal(profile.shapes.taxFileNumber, 0);
  assert.equal(profile.shapes.dateLike, 200);
});

test("URL and person-name columns get no format-mask failures", () => {
  const urls = ColumnData.create("picture", rows(200, (i) => (i % 10 === 0 ? `https://x.org/${i}.svg?v=1` : `https://x.org/a/${i}.svg`)));
  assert.equal(urls.semantic?.type, "url");
  assert.equal(computePatternProfiles([urls], 200).length, 0);
  const names = ColumnData.create("victim_name", rows(200, (i) => (i % 7 === 0 ? `Ann B Lee Jr ${i}` : `Ann Lee${i % 50}`)));
  assert.equal(names.semantic?.type, "person_name");
  assert.equal(computePatternProfiles([names], 200).length, 0);
});

test("a numeric measure column is a measure and still converts", () => {
  const q = ColumnData.create("Quantity", rows(300, (i) => String((i % 5) + 1)));
  assert.equal(q.semantic?.type, "category");
  const price = ColumnData.create("Price", rows(300, (i) => `${i}.5`));
  assert.equal(price.semantic?.type, "measure");
});

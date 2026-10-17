import { test } from "node:test";
import assert from "node:assert/strict";
import { ColumnData } from "../src/data/column.js";
import { computePatternProfiles, maskFor } from "../src/data/mask-profile.js";
import { EMPTY_NULL_POLICY } from "../src/parse/null-tokens.js";

function column(name: string, values: string[], type?: ColumnData["type"]): ColumnData {
  const col = ColumnData.create(name, values, EMPTY_NULL_POLICY);
  if (type !== undefined) col.type = type;
  return col;
}

test("maskFor collapses runs of letters, digits and separators", () => {
  assert.equal(maskFor("AB-1234"), "A-9");
  assert.equal(maskFor("CD-5678"), "A-9");
  assert.equal(maskFor("John Smith"), "A A");
  assert.equal(maskFor("smith"), "A");
  assert.equal(maskFor("2000"), "9");
  assert.equal(maskFor("A--12"), "A-9");
  assert.equal(maskFor("+61  400"), "+9 9");
  assert.equal(maskFor("Émile"), "A");
  assert.equal(maskFor("   "), "");
});

test("flags values that break the dominant format", () => {
  const values = Array.from({ length: 100 }, (_, i) => `+61 400 ${String(100000 + i)}`);
  values.push("call me", "0400-000-000", "");
  const col = column("phone", values, "string");
  const profiles = computePatternProfiles([col], values.length);
  assert.equal(profiles.length, 1);
  const profile = profiles[0];
  assert.ok(profile !== undefined);
  assert.equal(profile.mask, "+9 9 9");
  assert.equal(profile.total, 102);
  assert.equal(profile.offCount, 2);
  assert.equal(profile.offBits.count(), 2);
  assert.ok(Math.abs(profile.share - 100 / 102) < 1e-9);
  assert.deepEqual(profile.examples, ["call me", "0400-000-000"]);
});

test("skips free text with mixed word counts", () => {
  const names = Array.from({ length: 60 }, (_, i) => (i % 2 === 0 ? "John Smith" : "Madonna"));
  assert.deepEqual(computePatternProfiles([column("name", names, "string")], names.length), []);
});

test("skips a clean column with no off-pattern cells", () => {
  const values = Array.from({ length: 80 }, (_, i) => `AB-${String(1000 + i)}`);
  assert.deepEqual(computePatternProfiles([column("code", values, "string")], values.length), []);
});

test("skips single-run dominant masks (pure digits or letters)", () => {
  const values = Array.from({ length: 100 }, (_, i) => String(200000 + i));
  values[0] = "20-0000";
  assert.deepEqual(computePatternProfiles([column("zip", values, "string")], values.length), []);
});

test("ignores numeric and date columns", () => {
  const values = Array.from({ length: 100 }, (_, i) => `${1000 + i}-01-02`);
  const dateCol = column("when", values, "date");
  const numberCol = column("amount", values, "number");
  assert.deepEqual(computePatternProfiles([dateCol, numberCol], values.length), []);
});

test("needs enough cells and share before reporting", () => {
  const few = Array.from({ length: 40 }, (_, i) => `AB-${1000 + i}`);
  few.push("oops");
  assert.deepEqual(computePatternProfiles([column("tiny", few, "string")], few.length), []);

  const mixed = Array.from({ length: 100 }, (_, i) => (i < 60 ? `AB-${1000 + i}` : `A${1000 + i}`));
  assert.deepEqual(computePatternProfiles([column("mixed", mixed, "string")], mixed.length), []);
});

test("off-pattern bits never mark null rows", () => {
  const values = Array.from({ length: 60 }, (_, i) => `AB-${1000 + i}`);
  values.push("", "n/a", "broken");
  const col = column("code", values, "string");
  const profiles = computePatternProfiles([col], values.length);
  const profile = profiles[0];
  assert.ok(profile !== undefined);
  assert.equal(profile.offCount, 1);
  assert.deepEqual(profile.examples, ["broken"]);
  assert.equal(profile.offBits.count(), 1);
  assert.equal(profile.offBits.get(values.length - 3), false);
  assert.equal(profile.offBits.get(values.length - 2), false);
  assert.equal(profile.offBits.get(values.length - 1), true);
});

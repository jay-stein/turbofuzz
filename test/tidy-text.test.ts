import { test } from "node:test";
import assert from "node:assert/strict";
import { applyCleanOps } from "../src/data/clean-ops.js";
import { planTidyColumn, tidyOps, tidyableType } from "../src/data/tidy-text.js";

const counts = (entries: [string, number][]): Map<string, number> => new Map(entries);

test("capitals become the column's most common form, and stray spaces go with them", () => {
  const groups = planTidyColumn(counts([["NSW", 40], ["nsw", 3], ["Nsw", 1], [" NSW ", 2], ["VIC", 30]]));
  assert.equal(groups.length, 1, "VIC is already tidy");
  assert.equal(groups[0]!.to, "NSW");
  assert.equal(groups[0]!.kind, "capitals");
  assert.equal(groups[0]!.rows, 6);
  assert.deepEqual(groups[0]!.from.map((f) => f.value), ["nsw", " NSW ", "Nsw"]);
});

test("a value written one way but padded is trimmed; doubled inner spaces close up", () => {
  const groups = planTidyColumn(counts([["Smith ", 1], ["New  York", 2], ["Jones", 5]]));
  assert.deepEqual(groups.map((g) => [g.from[0]!.value, g.to, g.kind]), [["New  York", "New York", "spaces"], ["Smith ", "Smith", "spaces"]]);
});

test("on a tie, Title Case wins over SHOUTING, but a short code stays in capitals", () => {
  assert.equal(planTidyColumn(counts([["ACTIVE", 2], ["Active", 2]]))[0]!.to, "Active");
  assert.equal(planTidyColumn(counts([["US", 2], ["us", 2]]))[0]!.to, "US");
  assert.equal(planTidyColumn(counts([["nsw", 1], ["NSW", 1], ["Nsw", 1]]))[0]!.to, "NSW");
});

test("the steps do exactly what the preview showed, and an unticked group is left as it is", () => {
  const values = ["NSW", "NSW", "nsw", " Nsw", "Smith ", "New  York", "us", "US", "US"];
  const tally = new Map<string, number>();
  for (const v of values) tally.set(v, (tally.get(v) ?? 0) + 1);
  const groups = planTidyColumn(tally);
  const all = tidyOps(groups, () => true);
  assert.equal(all[0]!.kind, "trim", "every ends-only group ticked: one Trim step, first");
  assert.deepEqual(applyCleanOps(values, all), ["NSW", "NSW", "NSW", "NSW", "Smith", "New York", "US", "US", "US"]);
  // "us" is a real word in this column: leave its group out.
  const keepUs = tidyOps(groups, (g) => g.to !== "US");
  assert.deepEqual(applyCleanOps(values, keepUs), ["NSW", "NSW", "NSW", "NSW", "Smith", "New York", "us", "US", "US"]);
  // An ends-only group unticked: no Trim step, so that value keeps its space.
  const keepSmith = tidyOps(groups, (g) => g.to !== "Smith");
  assert.ok(keepSmith.every((op) => op.kind !== "trim"));
  assert.deepEqual(applyCleanOps(values, keepSmith), ["NSW", "NSW", "NSW", "NSW", "Smith ", "New York", "US", "US", "US"]);
});

test("only words and labels are tidied, never ids, numbers or dates", () => {
  assert.equal(tidyableType("string"), true);
  assert.equal(tidyableType("category"), true);
  assert.equal(tidyableType("identifier"), false);
  assert.equal(tidyableType("number"), false);
  assert.equal(tidyableType("date"), false);
});

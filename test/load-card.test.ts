import { test } from "node:test";
import assert from "node:assert/strict";
import { stageOf } from "../src/ui/load-card.js";
import { buildDatasetAsync } from "../src/data/build.js";
import type { BuildProgress } from "../src/data/build.js";

test("each load report lands on its stage of the card", () => {
  assert.equal(stageOf({ phase: "read" }), 0);
  assert.equal(stageOf({ phase: "parse" }), 1);
  assert.equal(stageOf({ phase: "infer" }), 2);
  // Splitting rows into columns carries no types; building them does.
  assert.equal(stageOf({ phase: "build", detail: "Splitting rows into columns" }), 2);
  assert.equal(stageOf({ phase: "build", types: [] }), 3);
  assert.equal(stageOf({ phase: "stats" }), 4);
  // Index and sort reports come after a load (a first search, a sort): not load stages.
  assert.equal(stageOf({ phase: "index" }), null);
  assert.equal(stageOf({ phase: "sort" }), null);
});

test("building columns reports each column's type as it is worked out, ending with all of them", async () => {
  const reports: BuildProgress[] = [];
  const rows = [["1", "Ann", "2024-01-03"], ["2", "Bo", "2024-02-11"], ["3", "Cy", "2024-03-09"]];
  await buildDatasetAsync("t", ["id", "name", "when"], rows, (report) => reports.push(report));
  const typed = reports.filter((report) => report.types !== undefined);
  assert.deepEqual(typed.map((report) => report.types!.length), [0, 1, 2, 3]);
  const last = typed.at(-1)!;
  assert.equal(last.current, last.total);
  assert.equal(last.types![2], "date");
});

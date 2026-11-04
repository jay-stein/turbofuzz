import { test } from "node:test";
import assert from "node:assert/strict";
import { dataWarnings, parseWorkspaceFile, WORKSPACE_KIND, WORKSPACE_VERSION, type WorkspaceFile } from "../src/data/workspace-file.js";

function sample(over: Partial<WorkspaceFile> = {}): WorkspaceFile {
  return {
    kind: WORKSPACE_KIND,
    version: WORKSPACE_VERSION,
    savedAt: "2026-11-04T00:00:00.000Z",
    data: { name: "titanic.csv", columns: ["Name", "Age", "Sex"], rows: 891 },
    pipeline: { phases: [], after: { cleans: [], nulls: [], types: [] } },
    removedRows: [],
    removedRowsLost: 0,
    mode: "general",
    view: "table",
    table: { filters: [], sort: null, hidden: [], frozenThrough: null },
    views: null,
    charts: null,
    quality: { rules: [], reviewed: {}, optional: {} },
    ...over,
  };
}

test("a workspace file round-trips through JSON", () => {
  const file = sample({ pipeline: { phases: [{ cleans: [{ name: "Sex", ops: [{ kind: "trim" }] }], nulls: [], types: [], transforms: [{ kind: "dedupe", keep: "first" }] }], after: { cleans: [], nulls: [], types: [] } } });
  const back = parseWorkspaceFile(JSON.stringify(file));
  assert.deepEqual(back.pipeline.phases[0].transforms, [{ kind: "dedupe", keep: "first" }]);
  assert.equal(back.data.name, "titanic.csv");
});

test("a file that is not a workspace says what it is", () => {
  assert.throws(() => parseWorkspaceFile("not json"), /not valid JSON/);
  assert.throws(() => parseWorkspaceFile(JSON.stringify({ kind: "turbofuzz-recipe" })), /not a TurboFuzz workspace/);
  assert.throws(() => parseWorkspaceFile(JSON.stringify({ ...sample(), version: 9 })), /version 9/);
});

test("optional parts default when an older or hand-made file leaves them out", () => {
  const raw: Record<string, unknown> = { ...sample() };
  delete raw.table;
  delete raw.quality;
  delete raw.removedRows;
  const back = parseWorkspaceFile(JSON.stringify(raw));
  assert.deepEqual(back.table.filters, []);
  assert.deepEqual(back.quality.rules, []);
  assert.deepEqual(back.removedRows, []);
});

test("the data in hand is checked against the data the workspace was saved on", () => {
  const file = sample();
  assert.deepEqual(dataWarnings(file, ["Name", "Age", "Sex"], 891), []);
  const warnings = dataWarnings(file, ["Name", "Age"], 100);
  assert.equal(warnings.length, 2);
  assert.match(warnings[0], /no column “Sex”/);
  assert.match(warnings[1], /891 rows.*100/);
  assert.match(dataWarnings(sample({ removedRowsLost: 3 }), ["Name", "Age", "Sex"], 891)[0], /3 rows removed by hand/);
});

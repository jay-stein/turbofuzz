import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSnapshot, diffSnapshots, historyKey, isDuplicateLoad, memoryStore, MAX_SNAPSHOTS } from "../src/data/history.js";
import type { ColumnMeta } from "../src/worker/protocol.js";
import type { DQScore } from "../src/data/score.js";

const meta = (name: string, type: string, nulls: number, labels?: string[]): ColumnMeta =>
  ({
    name,
    type,
    role: null,
    categories: labels === undefined ? null : { labels, counts: labels.map(() => 1) },
    stats: { nulls, distinct: labels?.length ?? 10 },
  }) as unknown as ColumnMeta;

const score = (overall: number): DQScore =>
  ({ overall, dimensions: [{ label: "Completeness", score: overall }] }) as unknown as DQScore;

test("a snapshot stores rates and small label sets, never labels of sensitive columns", () => {
  const metas = [meta("status", "category", 0, ["a", "b"]), meta("email", "category", 0, ["x@y.com", "z@y.com"]), meta("big", "category", 0, Array.from({ length: 40 }, (_, i) => `v${i}`))];
  const snap = buildSnapshot("Sales.CSV", metas, 100, score(90), new Set(["email"]));
  assert.equal(snap.key, "sales.csv");
  assert.deepEqual(snap.columns[0].labels, ["a", "b"]);
  assert.equal(snap.columns[1].labels, undefined, "sensitive: no labels");
  assert.equal(snap.columns[2].labels, undefined, "too many values: no labels");
  assert.doesNotMatch(JSON.stringify(snap), /x@y\.com/);
});

test("the diff reports added, removed, retyped, fill shifts, new categories and row change", () => {
  const before = buildSnapshot("f", [meta("a", "integer", 0), meta("b", "string", 0), meta("s", "category", 0, ["x"]), meta("gone", "string", 0)], 100, score(90), new Set(), {}, 1);
  const after = buildSnapshot("f", [meta("a", "string", 0), meta("b", "string", 30), meta("s", "category", 0, ["x", "y"]), meta("fresh", "string", 0)], 120, score(85), new Set(), {}, 2);
  const diff = diffSnapshots(before, after);
  assert.deepEqual(diff.added, ["fresh"]);
  assert.deepEqual(diff.removed, ["gone"]);
  assert.deepEqual(diff.retyped, [{ name: "a", from: "integer", to: "string" }]);
  assert.equal(diff.fillShifts[0].name, "b");
  assert.deepEqual(diff.newCategories, [{ name: "s", labels: ["y"] }]);
  assert.equal(diff.rowDelta, 20);
  assert.equal(diff.scoreDelta, -5);
  assert.equal(diffSnapshots(before, before).unchanged, true);
});

test("the store keeps the newest snapshots, clears completely, and ignores an immediate reload", async () => {
  const store = memoryStore();
  const metas = [meta("a", "integer", 0)];
  for (let i = 0; i < MAX_SNAPSHOTS + 5; i++) await store.add(buildSnapshot("f", metas, i, score(90), new Set(), {}, i * 120_000));
  const list = await store.list(historyKey("f"));
  assert.equal(list.length, MAX_SNAPSHOTS);
  assert.equal(list[0].rowCount, 5);
  assert.equal(isDuplicateLoad(list[list.length - 1], { ...list[list.length - 1], at: list[list.length - 1].at + 1000 }), true);
  assert.equal(isDuplicateLoad(undefined, list[0]), false);
  await store.clear();
  assert.equal((await store.list(historyKey("f"))).length, 0);
});

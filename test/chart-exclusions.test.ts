import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDataset } from "../src/data/build.js";
import {
  addExclusion,
  exclusionChips,
  keepRows,
  removeChip,
  sanitizeExclusions,
  type ChartExclusion,
} from "../src/data/chart-exclusions.js";

function data() {
  const rows = [
    ["Spain", "10", "red wine"],
    ["France", "20", "white wine"],
    ["Spain", "30", "rosé"],
    ["Italy", "40", "red blend"],
    ["France", "50", ""],
  ];
  return buildDataset("t", ["country", "points", "style"], rows);
}
const all = (n: number): Uint32Array => Uint32Array.from({ length: n }, (_, i) => i);

test("excluding a category value drops exactly its rows", () => {
  const ds = data();
  const out = keepRows(all(5), [{ kind: "values", column: 0, labels: ["Spain"] }], ds.columns);
  assert.deepEqual([...out], [1, 3, 4]);
});

test("several values and several exclusions combine", () => {
  const ds = data();
  const out = keepRows(
    all(5),
    [
      { kind: "values", column: 0, labels: ["Spain", "Italy"] },
      { kind: "range", column: 1, min: 40, max: null },
    ],
    ds.columns,
  );
  assert.deepEqual([...out], [1], "France 20 stays; France 50 is excluded by the range");
});

test("a range exclusion is inclusive and keeps rows it cannot judge", () => {
  const ds = buildDataset("t", ["v"], [["1"], ["5"], ["10"], ["n/a"], [""]]);
  const out = keepRows(all(5), [{ kind: "range", column: 0, min: 5, max: 10 }], ds.columns);
  assert.deepEqual([...out], [0, 3, 4]);
});

test("a text exclusion removes rows containing the term, ignoring case", () => {
  const ds = data();
  const out = keepRows(all(5), [{ kind: "text", column: 2, query: "RED" }], ds.columns);
  assert.deepEqual([...out], [1, 2, 4]);
});

test("unknown labels, missing columns and no exclusions leave rows alone", () => {
  const ds = data();
  const ids = all(5);
  assert.equal(keepRows(ids, undefined, ds.columns), ids);
  assert.equal(keepRows(ids, [], ds.columns), ids);
  assert.deepEqual([...keepRows(ids, [{ kind: "values", column: 0, labels: ["Peru"] }], ds.columns)], [0, 1, 2, 3, 4]);
  assert.deepEqual([...keepRows(ids, [{ kind: "values", column: 9, labels: ["Spain"] }], ds.columns)], [0, 1, 2, 3, 4]);
});

test("addExclusion merges value labels per column and ignores repeats", () => {
  let list: ChartExclusion[] = [];
  list = addExclusion(list, { kind: "values", column: 0, labels: ["Spain"] });
  list = addExclusion(list, { kind: "values", column: 0, labels: ["Italy", "Spain"] });
  list = addExclusion(list, { kind: "values", column: 1, labels: ["x"] });
  assert.deepEqual(list, [
    { kind: "values", column: 0, labels: ["Spain", "Italy"] },
    { kind: "values", column: 1, labels: ["x"] },
  ]);
  list = addExclusion(list, { kind: "range", column: 2, min: 1, max: 2 });
  assert.equal(addExclusion(list, { kind: "range", column: 2, min: 1, max: 2 }).length, 3);
});

test("chips list each excluded value and removing one keeps the rest", () => {
  const list: ChartExclusion[] = [
    { kind: "values", column: 0, labels: ["Spain", "Italy"] },
    { kind: "range", column: 1, min: 40, max: null },
    { kind: "text", column: 2, query: "red" },
  ];
  const chips = exclusionChips(list, (column) => ["country", "points", "style"][column] ?? "?");
  assert.deepEqual(
    chips.map((chip) => chip.text),
    ["country: Spain", "country: Italy", "points: ≥ 40", "style contains “red”"],
  );
  const afterSpain = removeChip(list, chips[0]!);
  assert.deepEqual(afterSpain[0], { kind: "values", column: 0, labels: ["Italy"] });
  const afterItaly = removeChip(afterSpain, chips[1]!);
  assert.equal(afterItaly.length, 2, "an exclusion with no labels left disappears");
  assert.equal(removeChip(list, chips[2]!).length, 2, "a range chip removes the whole exclusion");
});

test("sanitize drops exclusions for columns that no longer exist", () => {
  const list: ChartExclusion[] = [
    { kind: "values", column: 0, labels: ["a"] },
    { kind: "values", column: 5, labels: ["b"] },
  ];
  assert.equal(sanitizeExclusions(list, 3).length, 1);
  assert.deepEqual(sanitizeExclusions(undefined, 3), []);
});

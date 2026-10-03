import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDataset } from "../src/data/build.js";
import { QueryEngine, type ColumnFilter } from "../src/search/query-engine.js";

function makeDataset(rows = 500) {
  let seed = 12345;
  const rand = (): number => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const words = ["alpha", "alpine", "alto", "beta", "betamax", "gamma", "garden", "delta", "alphabet"];
  const statuses = ["Active", "Inactive", "Pending", "Trial", "Closed"];
  const data: string[][] = [];
  for (let i = 0; i < rows; i++) {
    const word = words[Math.floor(rand() * words.length)];
    data.push([
      `${word}-${Math.floor(rand() * 1000)}`,
      statuses[Math.floor(rand() * statuses.length)],
      String(Math.floor(rand() * 1000)),
    ]);
  }
  return buildDataset("t", ["name", "status", "n"], data);
}

function evalIds(engine: QueryEngine, column: number, filter: ColumnFilter): number[] {
  return [...engine.evaluate(new Map([[column, filter]]))];
}

test("contains prefix narrowing matches full scans while typing and deleting", () => {
  const dataset = makeDataset();
  const incremental = new QueryEngine(dataset);
  const target = "alpine";

  for (let length = 1; length <= target.length; length++) {
    const query = target.slice(0, length);
    const got = evalIds(incremental, 0, { kind: "text", mode: "contains", query });
    const expected = evalIds(new QueryEngine(dataset), 0, {
      kind: "text",
      mode: "contains",
      query,
    });
    assert.deepEqual(got, expected, `typing ${query}`);
  }

  for (let length = target.length - 1; length >= 1; length--) {
    const query = target.slice(0, length);
    const got = evalIds(incremental, 0, { kind: "text", mode: "contains", query });
    const expected = evalIds(new QueryEngine(dataset), 0, {
      kind: "text",
      mode: "contains",
      query,
    });
    assert.deepEqual(got, expected, `backspace ${query}`);
  }
});

test("exact and contains share the prefix stack correctly", () => {
  const dataset = makeDataset();
  const engine = new QueryEngine(dataset);
  const value = dataset.columns[0].raw[0];
  const query = value.toLowerCase();

  const contains = evalIds(engine, 0, { kind: "text", mode: "contains", query });
  const exact = evalIds(engine, 0, { kind: "text", mode: "exact", query });
  const expectedExact = evalIds(new QueryEngine(dataset), 0, {
    kind: "text",
    mode: "exact",
    query,
  });

  assert.deepEqual(exact, expectedExact);
  assert.ok(exact.includes(0));
  assert.ok(contains.length >= exact.length);

  const containsAgain = evalIds(engine, 0, { kind: "text", mode: "contains", query });
  assert.deepEqual(containsAgain, contains);
});

test("facet delta updates match full recomputation", () => {
  const dataset = makeDataset();
  const engine = new QueryEngine(dataset);
  const categories = dataset.columns[1].categories();
  const all = categories.labels.map((_, index) => index);

  const sequence: number[][] = [
    all,
    all.filter((id) => id !== 0),
    all.filter((id) => id !== 0 && id !== 2),
    all.filter((id) => id !== 2),
    all.filter((id) => id !== 2 && id !== 4),
    all,
    [0, 1],
  ];

  for (const selected of sequence) {
    const got = evalIds(engine, 1, { kind: "values", selected });
    const expected = evalIds(new QueryEngine(dataset), 1, { kind: "values", selected });
    assert.deepEqual(got, expected, `selection ${selected.join(",")}`);
  }
});

test("range narrowing matches full scans while dragging", () => {
  const dataset = makeDataset();
  const engine = new QueryEngine(dataset);
  const steps: [number | null, number | null][] = [
    [0, 1000],
    [100, null],
    [200, null],
    [300, 900],
    [350, 700],
    [50, 500],
    [null, 400],
    [null, null],
  ];
  for (const [min, max] of steps) {
    const got = evalIds(engine, 2, { kind: "range", min, max });
    const expected = evalIds(new QueryEngine(dataset), 2, { kind: "range", min, max });
    assert.deepEqual(got, expected, `range ${min}..${max}`);
  }
});

test("special duplicate and null filters intersect with column filters", () => {
  const dataset = buildDataset(
    "t",
    ["a", "b"],
    [
      ["1", "x"],
      ["1", "x"],
      ["2", ""],
      ["3", "z"],
    ],
  );
  const engine = new QueryEngine(dataset);

  engine.setSpecial("duplicates", true);
  assert.deepEqual([...engine.evaluate(new Map())], [0, 1]);

  engine.setSpecial("nulls", true);
  assert.deepEqual([...engine.evaluate(new Map())], []);

  engine.setSpecial("duplicates", false);
  assert.deepEqual([...engine.evaluate(new Map())], [2]);

  engine.setSpecial("nulls", false);
  assert.deepEqual([...engine.evaluate(new Map())], [0, 1, 2, 3]);
});

test("earlier facet results stay correct after later deltas", () => {
  const dataset = makeDataset();
  const engine = new QueryEngine(dataset);
  const first = evalIds(engine, 1, { kind: "values", selected: [0, 1, 2] });
  evalIds(engine, 1, { kind: "values", selected: [0] });
  const again = evalIds(engine, 1, { kind: "values", selected: [0, 1, 2] });
  assert.deepEqual(again, first);
});

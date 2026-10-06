import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDataset } from "../src/data/build.js";
import {
  applyTransformOps,
  describeTransformOp,
  schemaAfter,
} from "../src/data/transform-ops.js";

const ROWS = [
  ["a", "10"],
  ["b", "25"],
  ["a", "10"],
  ["c", "5"],
];

function base() {
  return buildDataset("t", ["name", "amount"], ROWS);
}

test("dedupe keeps the first copy of each row", () => {
  const out = applyTransformOps("t", base().columns, [{ kind: "dedupe", keep: "first" }]);
  assert.equal(out.rowCount, 3);
  assert.deepEqual(out.columns[0].raw, ["a", "b", "c"]);
});

test("dedupe keeps the last copy of each row", () => {
  const out = applyTransformOps("t", base().columns, [{ kind: "dedupe", keep: "last" }]);
  assert.equal(out.rowCount, 3);
  assert.deepEqual(out.columns[0].raw, ["b", "a", "c"]);
});

test("dedupe removes every copy of a duplicated row", () => {
  const out = applyTransformOps("t", base().columns, [{ kind: "dedupe", keep: "none" }]);
  assert.equal(out.rowCount, 2);
  assert.deepEqual(out.columns[0].raw, ["b", "c"]);
});

test("round with positive decimals keeps fixed precision and leaves text alone", () => {
  const ds = buildDataset("t", ["v"], [["1.2345"], ["2"], ["abc"]]);
  const out = applyTransformOps("t", ds.columns, [{ kind: "round", column: 0, decimals: 2 }]);
  assert.deepEqual(out.columns[0].raw, ["1.23", "2.00", "abc"]);
});

test("round with negative decimals rounds to the left", () => {
  const ds = buildDataset("t", ["v"], [["12"], ["25"], ["5"], ["-14"]]);
  const out = applyTransformOps("t", ds.columns, [{ kind: "round", column: 0, decimals: -1 }]);
  assert.deepEqual(out.columns[0].raw, ["10", "30", "10", "-10"]);
});

test("groupBy counts and sums per dimension", () => {
  const counts = applyTransformOps("t", base().columns, [
    { kind: "groupBy", dimension: 0, measure: null, aggregate: "count" },
  ]);
  assert.equal(counts.rowCount, 3);
  assert.equal(counts.columnCount, 2);
  assert.deepEqual(counts.columns[0].raw, ["a", "b", "c"]);
  assert.deepEqual(counts.columns[1].raw, ["2", "1", "1"]);
  assert.equal(counts.columns[1].name, "Count");

  const sums = applyTransformOps("t", base().columns, [
    { kind: "groupBy", dimension: 0, measure: 1, aggregate: "sum" },
  ]);
  assert.deepEqual(sums.columns[1].raw, ["20", "25", "5"]);
  assert.equal(sums.columns[1].name, "Sum(amount)");
});

test("groupBy mean and median aggregate numeric values", () => {
  const ds = buildDataset("t", ["g", "v"], [["a", "1"], ["a", "2"], ["a", "9"], ["b", "4"]]);
  const mean = applyTransformOps("t", ds.columns, [
    { kind: "groupBy", dimension: 0, measure: 1, aggregate: "mean" },
  ]);
  assert.deepEqual(mean.columns[1].raw, ["4", "4"]);
  const median = applyTransformOps("t", ds.columns, [
    { kind: "groupBy", dimension: 0, measure: 1, aggregate: "median" },
  ]);
  assert.deepEqual(median.columns[1].raw, ["2", "4"]);
});

test("chained ops compose (round then groupBy)", () => {
  const ds = buildDataset("t", ["g", "v"], [["a", "1.4"], ["a", "1.4"], ["b", "2.6"]]);
  const out = applyTransformOps("t", ds.columns, [
    { kind: "round", column: 1, decimals: 0 },
    { kind: "groupBy", dimension: 0, measure: 1, aggregate: "sum" },
  ]);
  assert.deepEqual(out.columns[0].raw, ["a", "b"]);
  assert.deepEqual(out.columns[1].raw, ["2", "3"]);
});

test("schemaAfter models the schema change of each step", () => {
  const schema = [
    { name: "a", numeric: false },
    { name: "b", numeric: true },
  ];
  assert.deepEqual(schemaAfter(schema, { kind: "dedupe", keep: "first" }), schema);
  assert.deepEqual(schemaAfter(schema, { kind: "round", column: 1, decimals: 1 }), schema);
  assert.deepEqual(
    schemaAfter(schema, { kind: "groupBy", dimension: 0, measure: 1, aggregate: "sum" }),
    [
      { name: "a", numeric: false },
      { name: "Sum(b)", numeric: true },
    ],
  );
  assert.deepEqual(
    schemaAfter(schema, { kind: "groupBy", dimension: 0, measure: null, aggregate: "count" }),
    [
      { name: "a", numeric: false },
      { name: "Count", numeric: true },
    ],
  );
  assert.deepEqual(
    schemaAfter(schema, {
      kind: "melt",
      idVars: [0],
      valueVars: [1],
      varName: "metric",
      valueName: "amount",
    }),
    [
      { name: "a", numeric: false },
      { name: "metric", numeric: false },
      { name: "amount", numeric: true },
    ],
  );
});

test("impute fills missing cells with the mean and median", () => {
  const ds = buildDataset("t", ["v"], [["1"], ["2"], ["N/A"], ["9"], [""]]);
  const mean = applyTransformOps("t", ds.columns, [
    { kind: "impute", column: 0, strategy: { kind: "mean" }, groupColumn: null },
  ]);
  assert.deepEqual(mean.columns[0].raw, ["1", "2", "4", "9", "4"]);

  const median = applyTransformOps("t", ds.columns, [
    { kind: "impute", column: 0, strategy: { kind: "median" }, groupColumn: null },
  ]);
  assert.deepEqual(median.columns[0].raw, ["1", "2", "2", "9", "2"]);
});

test("impute fills with the mode and a constant", () => {
  const ds = buildDataset("t", ["c"], [["red"], ["blue"], ["red"], ["N/A"], ["blue"], ["red"]]);
  const mode = applyTransformOps("t", ds.columns, [
    { kind: "impute", column: 0, strategy: { kind: "mode" }, groupColumn: null },
  ]);
  assert.deepEqual(mode.columns[0].raw, ["red", "blue", "red", "red", "blue", "red"]);

  const constant = applyTransformOps("t", ds.columns, [
    { kind: "impute", column: 0, strategy: { kind: "constant", value: "unknown" }, groupColumn: null },
  ]);
  assert.deepEqual(constant.columns[0].raw, ["red", "blue", "red", "unknown", "blue", "red"]);
});

test("impute carries values forward and backward", () => {
  const ds = buildDataset("t", ["v"], [["1"], [""], [""], ["4"]]);
  const forward = applyTransformOps("t", ds.columns, [
    { kind: "impute", column: 0, strategy: { kind: "forward" }, groupColumn: null },
  ]);
  assert.deepEqual(forward.columns[0].raw, ["1", "1", "1", "4"]);

  const backward = applyTransformOps("t", ds.columns, [
    { kind: "impute", column: 0, strategy: { kind: "backward" }, groupColumn: null },
  ]);
  assert.deepEqual(backward.columns[0].raw, ["1", "4", "4", "4"]);
});

test("impute can fill within groups", () => {
  const ds = buildDataset(
    "t",
    ["city", "sales"],
    [["a", "10"], ["a", ""], ["b", "20"], ["b", "30"], ["b", ""]],
  );
  const out = applyTransformOps("t", ds.columns, [
    { kind: "impute", column: 1, strategy: { kind: "mean" }, groupColumn: 0 },
  ]);
  assert.deepEqual(out.columns[1].raw, ["10", "10", "20", "30", "25"]);
});

test("knn imputes numeric cells from the nearest complete rows", () => {
  const ds = buildDataset(
    "t",
    ["x", "y"],
    [["0", "0"], ["1", "1"], ["2", "2"], ["10", "10"], ["11", "11"], ["", "11"]],
  );
  const out = applyTransformOps("t", ds.columns, [{ kind: "knn", columns: [0, 1], k: 2 }]);
  assert.equal(out.columns[0].raw[5], "11");
  assert.equal(out.columns[1].raw[5], "11");
});

test("melt unpivots value columns keeping id columns", () => {
  const ds = buildDataset("t", ["id", "jan", "feb"], [["a", "10", "20"], ["b", "30", "40"]]);
  const out = applyTransformOps("t", ds.columns, [
    { kind: "melt", idVars: [0], valueVars: [1, 2], varName: "month", valueName: "sales" },
  ]);
  assert.equal(out.rowCount, 4);
  assert.deepEqual(
    out.columns.map((column) => column.name),
    ["id", "month", "sales"],
  );
  assert.deepEqual(out.columns[0].raw, ["a", "b", "a", "b"]);
  assert.deepEqual(out.columns[1].raw, ["jan", "jan", "feb", "feb"]);
  assert.deepEqual(out.columns[2].raw, ["10", "30", "20", "40"]);
});

test("melt defaults value columns to every non-id column", () => {
  const ds = buildDataset("t", ["id", "x", "y"], [["a", "1", "2"]]);
  const out = applyTransformOps("t", ds.columns, [
    { kind: "melt", idVars: [0], valueVars: [], varName: "name", valueName: "value" },
  ]);
  assert.equal(out.rowCount, 2);
  assert.deepEqual(
    out.columns.map((column) => column.name),
    ["id", "name", "value"],
  );
});

test("describeTransformOp names columns via the pre-step headers", () => {
  assert.equal(describeTransformOp({ kind: "dedupe", keep: "none" }, ["a"]), "Remove all copies");
  assert.match(
    describeTransformOp({ kind: "round", column: 0, decimals: -1 }, ["amount"]),
    /amount/,
  );
  assert.equal(
    describeTransformOp({ kind: "groupBy", dimension: 0, measure: 1, aggregate: "sum" }, [
      "city",
      "sales",
    ]),
    "Sum of sales by city",
  );
  assert.match(
    describeTransformOp(
      { kind: "impute", column: 1, strategy: { kind: "median" }, groupColumn: 0 },
      ["city", "sales"],
    ),
    /Fill sales with median by city/,
  );
  assert.match(
    describeTransformOp({ kind: "knn", columns: [0, 1], k: 5 }, ["a", "b"]),
    /KNN impute 2 columns/,
  );
  assert.match(
    describeTransformOp(
      { kind: "melt", idVars: [0], valueVars: [1, 2], varName: "month", valueName: "sales" },
      ["id", "jan", "feb"],
    ),
    /Melt 2 columns/,
  );
});

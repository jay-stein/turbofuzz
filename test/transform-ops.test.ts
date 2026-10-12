import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDataset } from "../src/data/build.js";
import { viewToPandas } from "../src/data/recipe.js";
import { pandasRecipe } from "../src/data/recipe.js";
import {
  applyTransformOps,
  describeTransformOp,
  describeTransformOpDetail,
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

test("drop removes a column and shifts later indexes", () => {
  const ds = buildDataset("t", ["a", "b", "c"], [
    ["1", "2", "3"],
    ["4", "5", "6"],
  ]);
  const out = applyTransformOps("t", ds.columns, [{ kind: "drop", column: 1 }]);
  assert.deepEqual(out.columns.map((column) => column.name), ["a", "c"]);
  assert.deepEqual(out.columns[1].raw, ["3", "6"]);
  assert.equal(describeTransformOp({ kind: "drop", column: 1 }, ["a", "b", "c"]), "Drop column “b”");
  assert.deepEqual(
    schemaAfter(
      [
        { name: "a", numeric: false },
        { name: "b", numeric: true },
        { name: "c", numeric: true },
      ],
      { kind: "drop", column: 0 },
    ).map((entry) => entry.name),
    ["b", "c"],
  );
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
  const out = applyTransformOps("t", ds.columns, [
    { kind: "knn", fill: [0, 1], predictors: [0, 1], k: 2 },
  ]);
  assert.equal(out.columns[0].raw[5], "11");
  assert.equal(out.columns[1].raw[5], "11");
});

test("knn can fill a column using predictors it does not modify", () => {
  const ds = buildDataset(
    "t",
    ["x", "y"],
    [["0", "0"], ["1", "1"], ["2", "2"], ["10", "10"], ["11", "11"], ["", "11"]],
  );
  const out = applyTransformOps("t", ds.columns, [
    { kind: "knn", fill: [0], predictors: [1], k: 2 },
  ]);
  assert.equal(out.columns[0].raw[5], "11");
  assert.deepEqual(out.columns[1].raw, ["0", "1", "2", "10", "11", "11"]);
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
  assert.equal(
    describeTransformOp({ kind: "dedupe", keep: "none" }, ["a"]),
    "Remove duplicate rows (remove all copies)",
  );
  assert.match(
    describeTransformOp({ kind: "round", column: 0, decimals: -1 }, ["amount"]),
    /Round “amount” to -1 decimal places/,
  );
  assert.equal(
    describeTransformOp({ kind: "groupBy", dimension: 0, measure: 1, aggregate: "sum" }, [
      "city",
      "sales",
    ]),
    "Sum of “sales” grouped by “city”",
  );
  assert.match(
    describeTransformOp(
      { kind: "impute", column: 1, strategy: { kind: "median" }, groupColumn: 0 },
      ["city", "sales"],
    ),
    /Fill missing values in “sales” using median, computed within “city”/,
  );
  assert.match(
    describeTransformOp({ kind: "knn", fill: [0], predictors: [1], k: 5 }, ["a", "b"]),
    /KNN impute 1 column \(k=5\) — fill: “a”/,
  );
  assert.match(
    describeTransformOp(
      { kind: "melt", idVars: [0], valueVars: [1, 2], varName: "month", valueName: "sales" },
      ["id", "jan", "feb"],
    ),
    /Melt to long: 2 value columns \(id: “id”\)/,
  );
});

test("describeTransformOpDetail exposes the technical signature", () => {
  assert.equal(
    describeTransformOpDetail({ kind: "groupBy", dimension: 0, measure: 1, aggregate: "sum" }, [
      "city",
      "sales",
    ]),
    'groupBy(dimension="city", measure="sales", aggregate=sum)',
  );
  assert.equal(
    describeTransformOpDetail(
      { kind: "impute", column: 1, strategy: { kind: "constant", value: "0" }, groupColumn: null },
      ["city", "sales"],
    ),
    'impute(column="sales", strategy=constant("0"), groupColumn=null)',
  );
});

test("aggregate groups multiple dimensions and measures", () => {
  const ds = buildDataset("t", ["region", "month", "amount", "qty"], [
    ["North", "2024-01-05", "10", "2"],
    ["North", "2024-01-20", "5", "1"],
    ["North", "2024-02-01", "7", "3"],
    ["South", "2024-01-03", "4", "1"],
  ]);
  const out = applyTransformOps("t", ds.columns, [
    {
      kind: "aggregate",
      dimensions: [{ column: 0, by: "value" }, { column: 1, by: { time: "month" } }],
      measures: [
        { column: 2, agg: "sum" },
        { column: 3, agg: "mean" },
      ],
      fill: "zero",
    },
  ]);
  assert.equal(out.rowCount, 3);
  assert.deepEqual(out.columns.map((column) => column.name), [
    "region",
    "month (month)",
    "sum(amount)",
    "mean(qty)",
  ]);
  assert.deepEqual(out.columns[0].raw, ["North", "North", "South"]);
  assert.deepEqual(out.columns[1].raw, ["2024-01", "2024-02", "2024-01"]);
  assert.deepEqual(out.columns[2].raw, ["15", "7", "4"]);
  assert.deepEqual(out.columns[3].raw, ["1.5", "3", "1"]);
  assert.equal(out.columns[2].type, "number");
  assert.equal(out.columns[3].type, "number");
  assert.equal(
    describeTransformOp(
      { kind: "aggregate", dimensions: [{ column: 0, by: "value" }], measures: [{ column: 1, agg: "sum" }] },
      ["region", "amount"],
    ),
    "Aggregate: sum of “amount” grouped by “region”",
  );
  assert.deepEqual(
    schemaAfter(
      [
        { name: "region", numeric: false },
        { name: "month", numeric: false },
        { name: "amount", numeric: true },
      ],
      {
        kind: "aggregate",
        dimensions: [{ column: 0, by: "value" }, { column: 1, by: { time: "month" } }],
        measures: [{ column: 2, agg: "sum" }],
      },
    ),
    [
      { name: "region", numeric: false },
      { name: "month (month)", numeric: false },
      { name: "sum(amount)", numeric: true },
    ],
  );
});

test("viewToPandas emits a named group-by recipe", () => {
  const recipe = viewToPandas(
    {
      id: "v1",
      name: "Monthly sales",
      dimensions: [{ column: 0, by: { time: "month" } }],
      measures: [
        { column: 1, agg: "sum" },
        { column: null, agg: "count" },
      ],
      fill: "zero",
      sort: { key: "dim0", dir: "asc" },
      limit: 500,
      respectFilters: true,
    },
    ["when", "amount"],
  );
  assert.match(recipe, /# View: Monthly sales/);
  assert.match(recipe, /_group0 = pd\.to_datetime\(df\["when"\]\)\.dt\.to_period\("M"\)\.dt\.to_timestamp\(\)/);
  assert.match(recipe, /df = df\.groupby\(\[_group0\], as_index=False\)\.agg\(\*\*\{/);
  assert.match(recipe, /"sum\(amount\)": \("amount", "sum"\),/);
  assert.match(recipe, /"count\(\*\)": \("when", "size"\),/);
});

test("viewToPandas computes expression measures from named terms", () => {
  const recipe = viewToPandas(
    {
      id: "v2",
      name: "Revenue per order",
      dimensions: [{ column: 0, by: "value" }],
      measures: [
        { column: null, agg: "expr", expr: "sum(amount) / count(*)" },
        { column: 1, agg: "sum" },
      ],
      fill: "none",
      sort: { key: "m0", dir: "desc" },
      limit: 500,
      respectFilters: true,
    },
    ["region", "amount"],
  );
  assert.match(recipe, /"sum\(amount\)": \("amount", "sum"\),/);
  assert.match(recipe, /"count\(\*\)": \("region", "size"\),/);
  assert.match(
    recipe,
    /df\["sum\(amount\) \/ count\(\*\)"\] = df\["sum\(amount\)"\] \/ df\["count\(\*\)"\]/,
  );
  // sum(amount) is also a standalone measure, so only the count helper drops.
  assert.match(recipe, /df = df\.drop\(columns=\["count\(\*\)"\]\)/);
  assert.equal(recipe.match(/"sum\(amount\)":/g)?.length, 1, "no duplicate named-agg keys");
});

test("viewToPandas computes weighted means from helper columns", () => {
  const recipe = viewToPandas(
    {
      id: "v3",
      name: "Weighted price",
      dimensions: [{ column: 0, by: "value" }],
      measures: [{ column: 1, agg: "mean", weight: 2 }],
      fill: "none",
      sort: { key: "m0", dir: "desc" },
      limit: 500,
      respectFilters: true,
    },
    ["region", "amount", "w"],
  );
  assert.match(
    recipe,
    /df\["_wx_0"\] = pd\.to_numeric\(df\["amount"\], errors="coerce"\) \* pd\.to_numeric\(df\["w"\], errors="coerce"\)/,
  );
  assert.match(recipe, /"_agg_0": \("_wx_0", "sum"\),/);
  assert.match(recipe, /"_aggw_0": \("w", "sum"\),/);
  assert.match(recipe, /df\["mean\(amount\)"\] = df\["_agg_0"\] \/ df\["_aggw_0"\]/);
  assert.match(recipe, /df = df\.drop\(columns=\["_agg_0", "_wx_0", "_aggw_0"\]\)/);
});

test("winsorize clamps extreme values at the symmetric percentile fences", () => {
  const rows: string[][] = [];
  for (let i = 0; i < 98; i++) rows.push([String(10 + (i % 20))]);
  rows.push(["1000000"]);
  rows.push(["-1000000"]);
  const ds = buildDataset("w", ["amount"], rows);
  const out = applyTransformOps("w", ds.columns, [
    { kind: "winsorize", column: 0, percent: 1 },
  ]);
  const column = out.columns[0];
  const numbers = column.numbers();
  const max = Math.max(...numbers);
  const min = Math.min(...numbers);
  assert.ok(max < 1000000, "the extreme high value is clamped");
  assert.ok(min > -1000000, "the extreme low value is clamped");
  const normal = new Set<number>();
  for (let i = 0; i < 98; i++) normal.add(Number(rows[i][0]));
  for (const finite of numbers.values()) {
    if (finite > 0) assert.ok(normal.has(finite) || finite <= max);
  }
});

test("flagAnomalies appends a Yes/No column without changing the originals", () => {
  const rows: string[][] = [];
  for (let i = 0; i < 98; i++) rows.push([String(10 + (i % 20))]);
  rows.push(["1000000"]);
  rows.push(["-1000000"]);
  const ds = buildDataset("f", ["amount"], rows);
  const out = applyTransformOps("f", ds.columns, [
    { kind: "flagAnomalies", column: 0 },
  ]);
  assert.equal(out.columns.length, 2);
  assert.equal(out.columns[1].name, "flag: amount");
  const flags = out.columns[1].raw;
  assert.equal(flags.length, 100);
  assert.ok(flags.filter((value) => value === "Yes").length >= 1);
  assert.deepEqual(out.columns[0].raw, ds.columns[0].raw, "the source column is untouched");
});

test("the pandas recipe covers winsorize and flags", () => {
  const ds = buildDataset("r", ["amount"], [["1"], ["2"]]);
  const recipe = pandasRecipe({
    cleans: [],
    transforms: [
      { kind: "winsorize", column: 0, percent: 1 },
      { kind: "flagAnomalies", column: 0 },
    ],
    schema: ds.columns.map((column) => ({ name: column.name, numeric: true })),
  });
  assert.match(recipe, /clip\(lower=.*quantile\(0\.01\)/);
  assert.match(recipe, /outlier flags/);
});

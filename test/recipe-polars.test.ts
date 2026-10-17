import { test } from "node:test";
import assert from "node:assert/strict";
import { pandasRecipeScript, type RecipeInput } from "../src/data/recipe.js";
import { polarsRecipeScript } from "../src/data/recipe-polars.js";

test("golden Polars script: cleans, null policy, types, transforms", () => {
  const script = polarsRecipeScript({
    cleans: [{ name: "city", ops: [{ kind: "trim" }, { kind: "escapeFormulas" }] }],
    nulls: [{ name: "town", extra: ["TBC"], keep: ["NULL"] }],
    types: [{ name: "amount", type: "number" }],
    transforms: [
      { kind: "dedupe", keep: "first" },
      { kind: "melt", idVars: [0], valueVars: [], varName: "", valueName: "" },
    ],
    schema: [
      { name: "city", numeric: false },
      { name: "amount", numeric: true },
    ],
  });
  const expected = String.raw`# TurboFuzz Polars recipe — generated from the applied Recipe.
# Requirements: pip install polars  (polars >= 1.0)
# Input: the app does not record the source file format; point the reader at your data.
# Conventions: date → pl.Date; datetime → pl.Datetime (naive stays naive);
#   time → pl.Time; duration → pl.Duration; unparseable values → null (strict=False).
# Non-equivalent steps (review before trusting the output):
#   ! nulls: keep “NULL” as a value in “town” — the default reader maps it to null before the value can be recovered; adjust the reader

import polars as pl

# Input: replace with your own path/reader (CSV, Excel, JSON, Parquet…).
df = pl.read_csv("input.csv")

# Clean: city
df = df.with_columns(pl.col("city").str.strip_chars().str.replace_all(r"\s+", " ").alias("city"))
df = df.with_columns(
    pl.when(
        pl.col("city").cast(pl.Utf8, strict=False).str.contains(r"^[=@\t\r]")
        | (
            pl.col("city").cast(pl.Utf8, strict=False).str.contains(r"^[+-]")
            & (pl.col("city").cast(pl.Utf8, strict=False).str.len_chars() > 1)
            & ~pl.col("city").cast(pl.Utf8, strict=False).str.contains(r"^[+-][0-9.,\s]+$")
        )
    )
    .then("'" + pl.col("city").cast(pl.Utf8, strict=False))
    .otherwise(pl.col("city"))
    .alias("city")
)

# Missing-value policy
df = df.with_columns(pl.when(pl.col("town").is_in(["TBC"])).then(None).otherwise(pl.col("town")).alias("town"))
# “town”: “NULL” stays a value — read with null_values=[] and list the real missing tokens for this column

# Logical types
df = df.with_columns(pl.col("amount").cast(pl.Float64, strict=False).alias("amount"))

# Transform
df = df.unique(keep="first", maintain_order=True)
df = df.unpivot(index=["city"], on=["amount"], variable_name="variable", value_name="value")

df.write_csv("cleaned.csv")`;
  assert.equal(script.code, expected);
  assert.equal(script.target, "polars");
});

test("both targets read the same history and report every step", () => {
  const input: RecipeInput = {
    cleans: [
      { name: "name", ops: [{ kind: "trim" }, { kind: "replace", find: "a", replacement: "b", ignoreCase: true }] },
    ],
    nulls: [{ name: "town", extra: ["TBC"], keep: [] }],
    types: [{ name: "when", type: "datetime" }],
    transforms: [
      { kind: "dedupe", keep: "none" },
      { kind: "groupBy", dimension: 0, measure: 1, aggregate: "mean" },
      { kind: "knn", fill: [1], predictors: [0], k: 4 },
    ],
    schema: [
      { name: "name", numeric: false },
      { name: "value", numeric: true },
    ],
    deletedRows: 3,
  };
  const pandas = pandasRecipeScript(input);
  const polars = polarsRecipeScript(input);
  assert.equal(pandas.entries.length, polars.entries.length);
  assert.ok(pandas.entries.every((entry) => entry.label.length > 0));
  assert.ok(polars.entries.every((entry) => entry.label.length > 0));
  assert.ok(
    pandas.entries.filter((entry) => entry.status === "manual_step_required").length >= 2,
  );
  assert.ok(
    polars.entries.filter((entry) => entry.status === "manual_step_required").length >= 2,
  );
  assert.match(polars.code, /df = df\.unique\(keep=None, maintain_order=True\)/);
  assert.match(polars.code, /KNN impute Mean\(value\) from name \(k=4\)/);
  assert.match(polars.code, /3 rows were deleted interactively/);
  assert.doesNotMatch(polars.code, /undefined/);
});

test("Polars quotes column names safely and parses temporal types natively", () => {
  const script = polarsRecipeScript({
    cleans: [],
    types: [
      { name: "first name", type: "date" },
      { name: 'odd "quoted"', type: "datetime" },
      { name: "sûr_name", type: "time" },
      { name: "elapsed", type: "duration" },
      { name: "flag", type: "boolean" },
    ],
    transforms: [],
    schema: [],
  });
  assert.match(script.code, /pl\.col\("first name"\)\.str\.to_datetime\(strict=False\)\.dt\.date\(\)/);
  assert.match(script.code, /pl\.col\("odd \\"quoted\\""\)\.str\.to_datetime\(strict=False\)/);
  assert.match(script.code, /pl\.col\("sûr_name"\)\.str\.to_time\(strict=False\)/);
  assert.match(script.code, /pl\.col\("elapsed"\)\.str\.to_duration\(strict=False\)/);
  assert.match(script.code, /“flag” was read as boolean/);
  assert.equal(
    script.entries.filter((entry) => entry.status === "manual_step_required").length,
    1,
  );
});

test("Polars melt, aggregate and split stay executable", () => {
  const script = polarsRecipeScript({
    cleans: [],
    transforms: [
      { kind: "melt", idVars: [0], valueVars: [], varName: "metric", valueName: "reading" },
      {
        kind: "aggregate",
        dimensions: [{ column: 0, by: "value" }],
        measures: [
          { column: null, agg: "count" },
          { column: 1, agg: "sum" },
        ],
      },
      { kind: "splitColumn", column: 0, pattern: ",", regex: false, dropEmpty: false, dropOriginal: true, prefix: "part" },
    ],
    schema: [
      { name: "city", numeric: false },
      { name: "sales", numeric: true },
    ],
  });
  assert.match(script.code, /df = df\.unpivot\(index=\["city"\], on=\["sales"\], variable_name="metric", value_name="reading"\)/);
  assert.match(script.code, /df = df\.group_by\(\[pl\.col\("city"\)\]\)\.agg\(\[/);
  assert.match(script.code, /pl\.len\(\)\.alias\("count\(\*\)"\)/);
  assert.match(script.code, /pl\.col\("metric"\)\.sum\(\)\.alias\("sum\(metric\)"\)/);
  assert.match(script.code, /df = df\.unnest\("_split"\)/);
  assert.match(script.code, /df = df\.drop\("city"\)/);
  assert.doesNotMatch(script.code, /undefined/);
});

test("Polars combineDate builds pl.datetime with day defaults and drops parts", () => {
  const script = polarsRecipeScript({
    cleans: [],
    transforms: [
      {
        kind: "combineDate",
        parts: [
          { column: 0, role: "year" },
          { column: 1, role: "month" },
          { column: 2, role: "hour" },
        ],
        output: "date",
        outputName: "day",
        order: "auto",
        timeZone: "naive",
        dropParts: true,
      },
    ],
    schema: [
      { name: "y", numeric: true },
      { name: "m", numeric: true },
      { name: "h", numeric: true },
    ],
  });
  assert.match(
    script.code,
    /pl\.datetime\(year=pl\.col\("y"\)\.cast\(pl\.Int32, strict=False\), month=pl\.col\("m"\)\.cast\(pl\.Int32, strict=False\), day=1, hour=pl\.col\("h"\)\.cast\(pl\.Int32, strict=False\)\)\.dt\.date\(\)/,
  );
  assert.match(script.code, /df = df\.drop\(\["y", "m", "h"\]\)/);
});

test("Polars reports regex splits without groups as manual", () => {
  const script = polarsRecipeScript({
    cleans: [],
    transforms: [
      { kind: "splitColumn", column: 0, pattern: "-+", regex: true, dropEmpty: true, dropOriginal: false, prefix: "" },
    ],
    schema: [{ name: "code", numeric: false }],
  });
  assert.match(script.code, /regex split without capture groups/);
  assert.ok(
    script.entries.some(
      (entry) => entry.status === "manual_step_required" && /no groups/.test(entry.label),
    ),
  );
});

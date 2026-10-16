import { test } from "node:test";
import assert from "node:assert/strict";
import { pandasRecipe, pandasRecipeScript } from "../src/data/recipe.js";

test("generates pandas lines for clean ops", () => {
  const recipe = pandasRecipe({
    cleans: [
      {
        name: "city",
        ops: [
          { kind: "trim" },
          { kind: "case", style: "title" },
          { kind: "replace", find: "Fremantel", replacement: "Fremantle", ignoreCase: false },
          { kind: "toNumber", locale: "comma" },
        ],
      },
    ],
    transforms: [],
    schema: [],
  });
  assert.match(recipe, /df\["city"\] = df\["city"\]\.str\.strip\(\)/);
  assert.match(recipe, /df\["city"\] = df\["city"\]\.str\.title\(\)/);
  assert.match(recipe, /str\.replace\("Fremantel", "Fremantle", regex=False\)/);
  assert.match(recipe, /pd\.to_numeric\(/);
  assert.match(recipe, /df\.to_csv\("cleaned\.csv", index=False\)/);
});

test("generates pandas lines for transforms with schema tracking", () => {
  const recipe = pandasRecipe({
    cleans: [],
    transforms: [
      { kind: "dedupe", keep: "first" },
      { kind: "groupBy", dimension: 0, measure: 1, aggregate: "sum" },
      { kind: "melt", idVars: [0], valueVars: [1], varName: "variable", valueName: "value" },
    ],
    schema: [
      { name: "region", numeric: false },
      { name: "sales", numeric: true },
    ],
  });
  assert.match(recipe, /df = df\.drop_duplicates\(keep="first"\)/);
  assert.match(recipe, /df\.groupby\("region", as_index=False\)\["sales"\]\.sum\(\)/);
  assert.match(recipe, /df\.rename\(columns=\{"sales": "Sum\(sales\)"\}\)/);
  assert.match(recipe, /value_vars=\["Sum\(sales\)"\]/);
});

test("generates a pandas drop line for dropped columns", () => {
  const recipe = pandasRecipe({
    cleans: [],
    transforms: [{ kind: "drop", column: 1 }],
    schema: [
      { name: "region", numeric: false },
      { name: "sales", numeric: true },
      { name: "note", numeric: false },
    ],
  });
  assert.match(recipe, /df = df\.drop\(columns=\["sales"\]\)/);
});

test("emits a comment for knn imputation", () => {
  const recipe = pandasRecipe({
    cleans: [],
    transforms: [{ kind: "knn", fill: [0], predictors: [1], k: 5 }],
    schema: [
      { name: "a", numeric: true },
      { name: "b", numeric: true },
    ],
  });
  assert.match(recipe, /KNN impute a from b \(k=5\)/);
});

test("emits pandas lines for combining date/time columns", () => {
  const recipe = pandasRecipe({
    cleans: [],
    transforms: [
      {
        kind: "combineDate",
        parts: [
          { column: 0, role: "year" },
          { column: 1, role: "month" },
          { column: 2, role: "day" },
          { column: 3, role: "hour" },
        ],
        output: "datetime",
        outputName: "placed_at",
        order: "auto",
        timeZone: "Australia/Sydney",
        dropParts: false,
      },
    ],
    schema: [
      { name: "year", numeric: true },
      { name: "month", numeric: true },
      { name: "day", numeric: true },
      { name: "hour", numeric: true },
    ],
  });
  assert.match(
    recipe,
    /df\["placed_at"\] = pd\.to_datetime\(dict\(year=df\["year"\], month=df\["month"\], day=df\["day"\], hour=df\["hour"\]\), errors="coerce"\)/,
  );
  assert.match(recipe, /tz_localize\("Australia\/Sydney"/);
});

test("golden pandas script: cleans, null policy, types, transforms", () => {
  const script = pandasRecipeScript({
    cleans: [
      { name: "city", ops: [{ kind: "trim" }, { kind: "escapeFormulas" }] },
    ],
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
  const expected = String.raw`# TurboFuzz pandas recipe — generated from the applied Recipe.
# Requirements: pip install pandas  (pandas >= 2.0 for format="mixed" parsing)
# Input: the app does not record the source file format; point the reader at your data.
# Conventions: date → Python date objects (datetime64, midnight);
#   datetime → datetime64[ns] (naive timestamps are read as UTC);
#   time → Python time; duration → timedelta64.
# Nulls: pandas NaN/NaT; unparseable values become NaN/NaT via errors="coerce".
# Non-equivalent steps (review before trusting the output):
#   ! nulls: keep “NULL” as a value in “town” — the default reader nulls it before the value can be recovered; adjust the reader

import re

import pandas as pd

# Input: replace with your own path/reader (CSV, Excel, JSON, Parquet…).
df = pd.read_csv("input.csv")

# Clean: city
df["city"] = df["city"].str.strip().str.replace(r"\s+", " ", regex=True)
df["city"] = df["city"].map(lambda v: ("'" + v) if isinstance(v, str) and v != "" and (v[0] in "=@\t\r" or (v[0] in "+-" and v[1:] != "" and not re.fullmatch(r"[0-9.,\s]+", v[1:]))) else v)

# Missing-value policy
df["town"] = df["town"].replace(["TBC"], pd.NA)
# “town”: “NULL” stays a value — read with keep_default_na=False and list the real missing tokens of this column in na_values

# Logical types
df["amount"] = pd.to_numeric(df["amount"], errors="coerce")

# Transform
df = df.drop_duplicates(keep="first")
df = df.melt(id_vars=["city"], value_vars=["amount"], var_name="variable", value_name="value")

df.to_csv("cleaned.csv", index=False)`;
  assert.equal(script.code, expected);
  assert.deepEqual(
    script.entries.map((entry) => entry.status),
    ["supported", "supported", "supported", "manual_step_required", "supported", "supported", "supported"],
  );
});

test("no applied step is silently dropped: unsupported steps stay in the report", () => {
  const script = pandasRecipeScript({
    cleans: [],
    transforms: [
      { kind: "knn", fill: [0], predictors: [1], k: 3 },
      { kind: "flagAnomalies", column: 0 },
      { kind: "drop", column: 99 },
    ],
    schema: [
      { name: "a", numeric: true },
      { name: "b", numeric: true },
    ],
    deletedRows: 5,
  });
  assert.equal(script.entries.length, 4);
  assert.ok(script.entries.every((entry) => entry.status === "manual_step_required"));
  assert.match(script.code, /KNN impute a from b \(k=3\)/);
  assert.match(script.code, /outlier flags for a/);
  assert.match(script.code, /drop skipped in the script/);
  assert.match(script.code, /5 rows were deleted interactively/);
  assert.doesNotMatch(script.code, /undefined/);
});

test("combineDate drops its parts and reports warnings", () => {
  const script = pandasRecipeScript({
    cleans: [],
    transforms: [
      {
        kind: "combineDate",
        parts: [
          { column: 0, role: "year" },
          { column: 1, role: "auto" },
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
      { name: "extra", numeric: false },
    ],
  });
  assert.match(script.code, /df\["day"\] = pd\.to_datetime\(dict\(year=df\["y"\]\), errors="coerce"\)/);
  assert.match(script.code, /df\["day"\] = df\["day"\]\.dt\.date/);
  assert.match(script.code, /df = df\.drop\(columns=\["y", "extra"\]\)/);
  assert.ok(
    script.entries.some(
      (entry) => entry.status === "manual_step_required" && /auto role/.test(entry.label),
    ),
  );
});

test("grouped mode impute is executable with a tie-breaking warning", () => {
  const script = pandasRecipeScript({
    cleans: [],
    transforms: [{ kind: "impute", column: 1, strategy: { kind: "mode" }, groupColumn: 0 }],
    schema: [
      { name: "g", numeric: false },
      { name: "v", numeric: true },
    ],
  });
  assert.match(
    script.code,
    /df\["v"\] = df\.groupby\(df\["g"\]\)\["v"\]\.transform\(lambda s: s\.fillna\(s\.mode\(\)\.iloc\[0\]\) if not s\.mode\(\)\.empty else s\)/,
  );
  assert.ok(script.entries.some((entry) => entry.status === "supported_with_warning"));
});


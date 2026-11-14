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
# Written for Polars 2.1 (tested with Polars 2.1.0). Install: pip install "polars>=2.1,<3"
#   Also passes the same checks on Polars 1.44.2; versions older than that are untested.
# Input: the app does not record the source file format; point the reader at your data.
# Conventions: date → pl.Date; datetime → pl.Datetime (naive stays naive);
#   time → pl.Time; duration → pl.Duration; unparseable values → null (strict=False).
# Non-equivalent steps (review before trusting the output):
#   ! nulls: keep “NULL” as a value in “town” — the default reader maps it to null before the value can be recovered; adjust the reader

import polars as pl

# Input: replace with your own path/reader (CSV, Excel, JSON, Parquet…).
df = pl.read_csv("input.csv")

# Missing values as TurboFuzz counts them (any case, padded with spaces)
_tf_missing = ["-", "--", "---", "----", "—", "–", "?", "??", "???", "...", "…", "####", "null", "nil", "none", "nan", "na", "n/a", "n.a", "n.a.", "#n/a", "undefined", "missing", "unknown", "unspecified", "tbd", "tba", "empty", "blank", "(empty)", "(blank)", "(null)", "[empty]", "[blank]", "[null]", "<na>", "<null>", "<none>", "not available", "not applicable", "not provided", "not specified", "no data", "no value", "no answer", "no response", "null value", "none supplied", "\\n", "#value!", "#div/0!", "#ref!", "#name?", "#num!", "#null!", "#error!", "error", "#error"]
_tf_keep = {"town": ["NULL"]}
df = df.with_columns([
    pl.when(pl.col(c).str.strip_chars().str.to_lowercase().is_in(_tf_missing) & ~pl.col(c).is_in(_tf_keep.get(c, [])))
    .then(None).otherwise(pl.col(c)).alias(c)
    for c in df.columns if df.schema[c] == pl.Utf8
])

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
  assert.doesNotMatch(polars.code, /(?<!")undefined(?!")/);
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
  assert.match(script.code, /pl\.coalesce\(\[_tf_read\("first name", f\) for f in _tf_formats\]\)\.dt\.replace_time_zone\(None\)\.dt\.date\(\)/);
  assert.match(script.code, /_tf_read\("odd \\"quoted\\"", f\)/);
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
  assert.doesNotMatch(script.code, /(?<!")undefined(?!")/);
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

const mixedDateInput = {
  cleans: [{ name: "order_date", ops: [{ kind: "toDate", order: "dmy" }] }],
  transforms: [],
  schema: [
    { name: "postcode", numeric: false, type: "identifier" },
    { name: "qty", numeric: true, type: "integer" },
    { name: "order_date", numeric: false, type: "date" },
  ],
} as const;

test("Polars date clean coalesces every layout in a mixed column, day first, and keeps unreadable text", () => {
  const { code } = polarsRecipeScript(mixedDateInput as never);
  assert.match(code, /_tf_formats = \["%Y-%m-%d".*"%d\/%m\/%Y".*"%d\/%m\/%y"/);
  assert.doesNotMatch(code, /"%m\/%d\/%Y"/);
  assert.match(code, /pl\.coalesce\(pl\.coalesce\(\[_tf_read\("order_date", f\) for f in _tf_formats\]\)\.dt\.strftime\("%Y-%m-%d"\), pl\.col\("order_date"\)\)/);
  assert.match(polarsRecipeScript({ ...mixedDateInput, cleans: [{ name: "order_date", ops: [{ kind: "toDate", order: "mdy" }] }] } as never).code, /"%m\/%d\/%Y"/);
});

test("Polars reader keeps identifier and date columns as text", () => {
  const { code } = polarsRecipeScript(mixedDateInput as never);
  assert.match(code, /df = pl\.read_csv\("input\.csv", schema_overrides=\{"postcode": pl\.Utf8, "order_date": pl\.Utf8\}\)/);
});

const bucketInput = (by: unknown, dateOrders?: Record<string, string>) =>
  ({
    cleans: [],
    transforms: [{ kind: "aggregate", dimensions: [{ column: 0, by }], measures: [{ column: 1, agg: "sum" }] }],
    schema: [
      { name: "day", numeric: false },
      { name: "qty", numeric: true },
    ],
    dateOrders,
  }) as never;

test("Polars time buckets and date parts read a mixed-layout date column with the shared reader", () => {
  const month = polarsRecipeScript(bucketInput({ time: "month" })).code;
  assert.match(month, /_tf_formats = \[.*"%d\/%m\/%Y"/);
  assert.match(month, /pl\.coalesce\(\[_tf_read\("day", f\) for f in _tf_formats\]\)\.dt\.replace_time_zone\(None\)\.dt\.truncate\("1mo"\)/);
  assert.doesNotMatch(month, /\.str\.to_datetime\(strict=False\)/);
  const part = polarsRecipeScript(bucketInput({ datePart: "month" })).code;
  assert.match(part, /_tf_read\("day", f\).*\.dt\.month\(\)/);
});

test("the day/month order the app read the column in reaches the Polars readers", () => {
  const month = polarsRecipeScript(bucketInput({ time: "month" }, { day: "mdy" })).code;
  assert.match(month, /"%m\/%d\/%Y"/);
  assert.doesNotMatch(month, /"%d\/%m\/%Y"/);
  const typed = polarsRecipeScript({
    cleans: [],
    transforms: [],
    schema: [{ name: "when", numeric: false, type: "date" }],
    types: [{ name: "when", type: "date" }],
    dateOrders: { when: "mdy" },
  } as never);
  assert.match(typed.code, /"%m\/%d\/%Y"/);
  assert.equal(typed.entries.find((entry) => entry.label.startsWith("type: when"))?.status, "supported");
  const unknown = polarsRecipeScript({ cleans: [], transforms: [], schema: [], types: [{ name: "when", type: "date" }] } as never);
  assert.match(unknown.code, /"%d\/%m\/%Y"/);
  assert.equal(unknown.entries[0].status, "supported_with_warning");
});

test("Polars combineDate reads a timestamp part with the shared reader", () => {
  const { code } = polarsRecipeScript({
    cleans: [],
    transforms: [
      { kind: "combineDate", parts: [{ column: 0, role: "datetime" }], output: "datetime", outputName: "when", order: "dmy", timeZone: "naive", dropParts: false },
    ],
    schema: [{ name: "raw", numeric: false }],
  } as never);
  assert.match(code, /_tf_read\("raw", f\) for f in _tf_formats/);
  assert.doesNotMatch(code, /\.str\.to_datetime\(strict=False\)/);
});

test("Polars toDateTime keeps milliseconds only where there are some", () => {
  const { code } = polarsRecipeScript({ cleans: [{ name: "t", ops: [{ kind: "toDateTime", order: "dmy" }] }], transforms: [], schema: [] } as never);
  assert.match(code, /strftime\("%Y-%m-%dT%H:%M:%S%\.3f"\)\.str\.replace\(r"\\.000\$", ""\), pl\.lit\("Z"\)/);
});

test("Polars blanks the missing-value markers the app counts, except tokens the user kept", () => {
  const { code } = polarsRecipeScript({ cleans: [], transforms: [], schema: [], nulls: [{ name: "town", extra: [], keep: ["NULL"] }] } as never);
  assert.match(code, /_tf_missing = \[.*"n\/a".*"unknown"/);
  assert.match(code, /_tf_keep = \{"town": \["NULL"\]\}/);
  assert.match(code, /is_in\(_tf_missing\) & ~pl\.col\(c\)\.is_in\(_tf_keep\.get\(c, \[\]\)\)/);
});

test("Polars time buckets, date parts and cohorts are assigned group keys with the app's name and labels", () => {
  const month = polarsRecipeScript(bucketInput({ time: "month" })).code;
  assert.match(month, /df = df\.group_by\(\[pl\.coalesce\(.*\.dt\.truncate\("1mo"\)\.alias\("_group0"\)\]\)/);
  assert.doesNotMatch(month, /^pl\.coalesce/m);
  assert.match(month, /df = df\.with_columns\(pl\.col\("_group0"\)\.dt\.strftime\("%Y-%m"\)\.alias\("_group0"\)\)\ndf = df\.rename\(\{"_group0": "day \(month\)"\}\)/);
  const part = polarsRecipeScript(bucketInput({ datePart: "dow" })).code;
  assert.match(part, /replace_strict\(\{0: "Mon", 1: "Tue"/);
  const cohort = polarsRecipeScript(bucketInput({ cohort: { entity: 1, grain: "month" } }));
  assert.match(cohort.code, /\.min\(\)\.over\(pl\.col\("qty"\)\)\.dt\.truncate\("1mo"\)/);
  assert.ok(cohort.entries.every((entry) => entry.status !== "manual_step_required"));
});

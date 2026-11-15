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
  // The app capitalises after whitespace only; .str.title() would also capitalise after an apostrophe.
  assert.match(recipe, /df\["city"\] = df\["city"\]\.map\(_tf_title\)/);
  assert.doesNotMatch(recipe, /\.str\.title\(\)/);
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

test("pandas combineDate reads a year-first date part as ISO before the day-first read", () => {
  // pandas 3's format="mixed" with dayfirst=True turns 2024-03-05 into 3 May.
  const recipe = pandasRecipe({
    cleans: [],
    transforms: [
      {
        kind: "combineDate",
        parts: [
          { column: 0, role: "date" },
          { column: 1, role: "hour" },
        ],
        output: "datetime",
        outputName: "at",
        order: "dmy",
        timeZone: "",
        dropParts: false,
      },
    ],
    schema: [
      { name: "d", numeric: false },
      { name: "h", numeric: true },
    ],
  } as never);
  assert.match(
    recipe,
    /_part\d+ = pd\.to_datetime\(df\["d"\], format="ISO8601", errors="coerce"\)\.fillna\(pd\.to_datetime\(df\["d"\], format="mixed", dayfirst=True, errors="coerce"\)\)/,
  );
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
# Written for pandas 3.1 (tested with pandas 3.1.1). Install: pip install "pandas>=3.1,<4"
#   Also passes the same checks on pandas 2.3.3; versions older than that are untested.
#   Dates: year-first values are read with format="ISO8601" before format="mixed", because on
#   pandas 3 format="mixed" with dayfirst=True reads 2024-03-05 as 3 May (both need pandas >= 2.0).
# Input: the app does not record the source file format; point the reader at your data.
# Conventions: date → Python date objects (datetime64, midnight);
#   datetime → datetime64 (naive timestamps are read as UTC; pandas 3 stores µs, 2.x ns);
#   time → Python time; duration → timedelta64.
# Nulls: pandas NaN/NaT; unparseable values become NaN/NaT via errors="coerce".
# Non-equivalent steps (review before trusting the output):
#   ! nulls: keep “NULL” as a value in “town” — the default reader nulls it before the value can be recovered; adjust the reader

import re

import pandas as pd

# Input: replace with your own path/reader (CSV, Excel, JSON, Parquet…).
df = pd.read_csv("input.csv")

# Missing values as TurboFuzz counts them (any case, padded with spaces)
_tf_missing = ["-", "--", "---", "----", "—", "–", "?", "??", "???", "...", "…", "####", "null", "nil", "none", "nan", "na", "n/a", "n.a", "n.a.", "#n/a", "undefined", "missing", "unknown", "unspecified", "tbd", "tba", "empty", "blank", "(empty)", "(blank)", "(null)", "[empty]", "[blank]", "[null]", "<na>", "<null>", "<none>", "not available", "not applicable", "not provided", "not specified", "no data", "no value", "no answer", "no response", "null value", "none supplied", "\\n", "#value!", "#div/0!", "#ref!", "#name?", "#num!", "#null!", "#error!", "error", "#error"]
_tf_keep = {"town": ["NULL"]}
for _c in df.columns:
    if df[_c].dtype == object or pd.api.types.is_string_dtype(df[_c]):
        df[_c] = df[_c].mask(df[_c].str.strip().str.lower().isin(_tf_missing) & ~df[_c].isin(_tf_keep.get(_c, [])))

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
  assert.doesNotMatch(script.code, /(?<!")undefined(?!")/);
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


test("keep only numbers and keep only text export as helpers the pandas script defines", () => {
  const recipe = pandasRecipe({
    cleans: [{ name: "price", ops: [{ kind: "keepNumbers", locale: "comma" }, { kind: "keepText" }] }],
    transforms: [],
    schema: [],
  });
  assert.match(recipe, /^import re$/m);
  assert.match(recipe, /^def _keep_number\(v, mark\):$/m);
  assert.match(recipe, /df\["price"\] = df\["price"\]\.map\(lambda v: _keep_number\(v, ","\) if isinstance\(v, str\) else v\)/);
  assert.match(recipe, /^def _keep_text\(v\):$/m);
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

test("pandas date clean reads every layout in a mixed column and keeps what it cannot read", () => {
  const { code } = pandasRecipeScript(mixedDateInput as never);
  assert.match(
    code,
    /_parsed = pd\.to_datetime\(df\["order_date"\], format="ISO8601", utc=True, errors="coerce"\)\.fillna\(pd\.to_datetime\(df\["order_date"\], format="mixed", dayfirst=True, utc=True, errors="coerce"\)\)/,
  );
  assert.match(code, /df\["order_date"\] = _parsed\.dt\.strftime\("%Y-%m-%d"\)\.where\(_parsed\.notna\(\), df\["order_date"\]\)/);
});

test("pandas reader keeps identifier and date columns as text, numbers untouched", () => {
  const { code } = pandasRecipeScript(mixedDateInput as never);
  assert.match(code, /df = pd\.read_csv\("input\.csv", dtype=\{"postcode": str, "order_date": str\}\)/);
  assert.doesNotMatch(code, /"qty": str/);
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

test("pandas time buckets, date parts and cohorts read a mixed-layout date column", () => {
  const month = pandasRecipeScript(bucketInput({ time: "month" })).code;
  assert.match(month, /pd\.to_datetime\(df\["day"\], format="mixed", dayfirst=True, utc=True, errors="coerce"\)\)\.dt\.tz_localize\(None\)\.dt\.to_period\("M"\)/);
  assert.match(pandasRecipeScript(bucketInput({ datePart: "month" })).code, /format="mixed", dayfirst=True.*\.dt\.month/);
  const cohort = pandasRecipeScript(bucketInput({ cohort: { entity: 1, grain: "month" } })).code;
  assert.match(cohort, /_first0 = pd\.to_datetime\(df\["day"\], format="ISO8601".*format="mixed"/);
  assert.doesNotMatch(cohort, /pd\.to_datetime\(df\["day"\]\)/);
});

test("the day/month order the app read the column in reaches every pandas date read", () => {
  const month = pandasRecipeScript(bucketInput({ time: "month" }, { day: "mdy" })).code;
  assert.match(month, /format="mixed", dayfirst=False/);
  const typed = pandasRecipeScript({
    cleans: [],
    transforms: [],
    schema: [{ name: "when", numeric: false, type: "date" }],
    types: [{ name: "when", type: "date" }],
    dateOrders: { when: "mdy" },
  } as never);
  assert.match(
    typed.code,
    /df\["when"\] = pd\.to_datetime\(df\["when"\], format="ISO8601", utc=True, errors="coerce"\)\.fillna\(pd\.to_datetime\(df\["when"\], format="mixed", dayfirst=False, utc=True, errors="coerce"\)\)\.dt\.tz_localize\(None\)\.dt\.date/,
  );
  assert.equal(typed.entries.find((entry) => entry.label.startsWith("type: when"))?.status, "supported");
  const unknown = pandasRecipeScript({ cleans: [], transforms: [], schema: [], types: [{ name: "when", type: "date" }] } as never);
  assert.match(unknown.code, /dayfirst=True/);
  assert.equal(unknown.entries[0].status, "supported_with_warning");
});

test("pandas toDateTime keeps milliseconds only where there are some", () => {
  const { code } = pandasRecipeScript({ cleans: [{ name: "t", ops: [{ kind: "toDateTime", order: "dmy" }] }], transforms: [], schema: [] } as never);
  assert.match(code, /strftime\("%Y-%m-%dT%H:%M:%S\.%f"\)\.str\[:-3\]\.str\.replace\(r"\\.000\$", "", regex=True\) \+ "Z"/);
});

test("the script blanks the missing-value markers the app counts, except tokens the user kept", () => {
  const { code } = pandasRecipeScript({ cleans: [], transforms: [], schema: [], nulls: [{ name: "town", extra: [], keep: ["NULL"] }] } as never);
  assert.match(code, /_tf_missing = \[.*"n\/a".*"unknown"/);
  assert.match(code, /_tf_keep = \{"town": \["NULL"\]\}/);
  assert.match(code, /df\[_c\]\.str\.strip\(\)\.str\.lower\(\)\.isin\(_tf_missing\) & ~df\[_c\]\.isin\(_tf_keep\.get\(_c, \[\]\)\)/);
});

test("pandas time buckets and date parts are real key columns that keep the app's name and labels", () => {
  const month = pandasRecipeScript(bucketInput({ time: "month" })).code;
  assert.match(month, /df\["_group0"\] = pd\.to_datetime/);
  assert.match(month, /df = df\.groupby\(\["_group0"\], as_index=False\)/);
  assert.match(month, /df\["_group0"\] = df\["_group0"\]\.dt\.strftime\("%Y-%m"\)\ndf = df\.rename\(columns=\{"_group0": "day \(month\)"\}\)/);
  const part = pandasRecipeScript(bucketInput({ datePart: "month" })).code;
  assert.match(part, /df\["_group0"\]\.map\(\{1: "Jan", 2: "Feb"/);
  assert.match(part, /rename\(columns=\{"_group0": "day \(month\)"\}\)/);
  const since = pandasRecipeScript(bucketInput({ since: { entity: 1, grain: "month" } })).code;
  assert.match(since, /"P" \+ df\["_group0"\]\.astype\(str\)/);
  assert.match(since, /"_group0": "periods since first qty \(month\)"/);
});

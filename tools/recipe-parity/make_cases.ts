/**
 * Generates executable parity fixtures for the recipe exporters.
 *
 * For each case this writes:
 *   cases/<name>/input.csv    — the raw input (verbatim cell text)
 *   cases/<name>/expected.csv — TurboFuzz's own result for the same history
 *   cases/<name>/pandas.py    — the generated pandas script
 *   cases/<name>/polars.py    — the generated Polars script
 *
 * `run_parity.py` executes both scripts in a Python environment and compares
 * the outputs with expected.csv. Run from the repo root:
 *   npx tsx tools/recipe-parity/make_cases.ts
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { applyCleanOps, type CleanOp } from "../../src/data/clean-ops.js";
import { ColumnData } from "../../src/data/column.js";
import { datasetFromColumns } from "../../src/data/build.js";
import { applyTransformOps, type TransformOp } from "../../src/data/transform-ops.js";
import { createNullPolicy } from "../../src/parse/null-tokens.js";
import { buildCsv, csvEscape } from "../../src/worker/csv.js";
import { pandasRecipeScript, type RecipeInput } from "../../src/data/recipe.js";
import { polarsRecipeScript } from "../../src/data/recipe-polars.js";
import type { ColumnType } from "../../src/types.js";

interface CaseSpec {
  name: string;
  description: string;
  headers: string[];
  rows: string[][];
  cleans?: { column: number; ops: CleanOp[] }[];
  nulls?: { column: number; extra: string[]; keep: string[] }[];
  types?: { column: number; type: ColumnType }[];
  transforms?: TransformOp[];
}

const CASES: CaseSpec[] = [
  {
    name: "cleanup",
    description: "trim, title case and replace across two text columns",
    headers: ["name", "city"],
    rows: [
      ["  john   smith ", " north   malvern "],
      ["JANE JONSON", "footscray"],
      ["Bob  Smyth", "Fremantel"],
    ],
    cleans: [
      {
        column: 0,
        ops: [
          { kind: "trim" },
          { kind: "case", style: "title" },
        ],
      },
      {
        column: 1,
        ops: [
          { kind: "trim" },
          { kind: "case", style: "title" },
          { kind: "replace", find: "Fremantel", replacement: "Fremantle", ignoreCase: false },
        ],
      },
    ],
  },
  {
    name: "null-tokens-and-numbers",
    description: "comma locale conversion plus an extra missing token",
    headers: ["amount", "note"],
    rows: [
      ["1.234,56", "paid"],
      ["2.000,00", "TBC"],
      ["999,99", "paid"],
    ],
    cleans: [{ column: 0, ops: [{ kind: "toNumber", locale: "comma" }] }],
    nulls: [{ column: 1, extra: ["TBC"], keep: [] }],
  },
  {
    name: "dates",
    description: "date logical type conversion",
    headers: ["when"],
    rows: [["2024-03-05"], ["2024-12-31"], ["2024-06-15"]],
    types: [{ column: 0, type: "date" }],
  },
  {
    name: "dedupe",
    description: "keep the first copy of each duplicated row",
    headers: ["city", "status"],
    rows: [
      ["Sydney", "Active"],
      ["Sydney", "Active"],
      ["Melbourne", "Trial"],
    ],
    transforms: [{ kind: "dedupe", keep: "first" }],
  },
  {
    name: "impute-mean",
    description: "mean imputation over a numeric column with blanks",
    headers: ["city", "score"],
    rows: [
      ["Sydney", "5"],
      ["Melbourne", ""],
      ["Perth", "15"],
    ],
    transforms: [
      { kind: "impute", column: 1, strategy: { kind: "mean" }, groupColumn: null },
    ],
  },
  {
    name: "melt",
    description: "melt defaults value_vars to every non-id column",
    headers: ["city", "jan", "feb"],
    rows: [
      ["Sydney", "10", "20"],
      ["Perth", "30", "40"],
    ],
    transforms: [{ kind: "melt", idVars: [0], valueVars: [], varName: "month", valueName: "sales" }],
  },
  {
    name: "groupby-mean",
    description: "group by a category and average a measure",
    headers: ["city", "sales"],
    rows: [
      ["Sydney", "10"],
      ["Perth", "30"],
      ["Sydney", "20"],
    ],
    transforms: [{ kind: "groupBy", dimension: 0, measure: 1, aggregate: "mean" }],
  },
  {
    name: "split",
    description: "delimiter split with generated part columns",
    headers: ["code"],
    rows: [["a-b-c"], ["x-y"], ["z"]],
    transforms: [
      {
        kind: "splitColumn",
        column: 0,
        pattern: "-",
        regex: false,
        dropEmpty: false,
        dropOriginal: false,
        prefix: "part",
      },
    ],
  },
  {
    name: "combine-date",
    description: "combine year/month/day parts into a date and drop the parts",
    headers: ["year", "month", "day"],
    rows: [
      ["2024", "3", "5"],
      ["2024", "12", "31"],
    ],
    transforms: [
      {
        kind: "combineDate",
        parts: [
          { column: 0, role: "year" },
          { column: 1, role: "month" },
          { column: 2, role: "day" },
        ],
        output: "date",
        outputName: "when",
        order: "auto",
        timeZone: "naive",
        dropParts: true,
      },
    ],
  },
  {
    name: "cell-edits",
    description: "cells edited by hand in the Table (setCells)",
    headers: ["name", "region"],
    rows: [["Ada", "North"], ["Alan", "South"], ["Grace", "East"]],
    cleans: [{ column: 1, ops: [{ kind: "setCells", edits: [{ row: 0, from: "North", to: "West" }, { row: 2, from: "East", to: "" }] }] }],
  },
  {
    name: "formulas",
    description: "new columns from Excel-style formulas: every function, blanks, errors, dates",
    headers: ["first", "last", "price", "qty", "status", "email", "ordered", "shipped", "solar"],
    rows: [
      ["Ada", "Lovelace", "10", "3", "Closed", "ada@x.org", "2024-01-15", "2024-01-20", "Yes"],
      ["Alan", "Turing", "2.5", "4", "open", "alan@y.com", "2024-02-29", "2024-03-01", "No"],
      ["", "Hopper", "", "5", "Open", "nobody", "", "2024-01-01", ""],
      ["Grace", "", "4", "0", "", "", "2023-12-31", "2023-12-31", "Yes"],
    ],
    types: [
      { column: 2, type: "number" },
      { column: 3, type: "integer" },
      { column: 6, type: "date" },
      { column: 7, type: "date" },
      { column: 8, type: "boolean" },
    ],
    transforms: [
      { kind: "derive", name: "total", at: 99, formula: "[price] * [qty]" },
      { kind: "derive", name: "ratio", at: 99, formula: "[price] / [qty]" },
      { kind: "derive", name: "power", at: 99, formula: "-[qty] ^ 2 + 0.1 + 0.2" },
      { kind: "derive", name: "full", at: 99, formula: '[first] & " " & [last]' },
      { kind: "derive", name: "joined", at: 99, formula: "CONCAT([first], [qty], TRUE)" },
      { kind: "derive", name: "upper", at: 99, formula: "UPPER([first])" },
      { kind: "derive", name: "lower", at: 99, formula: "LOWER([status])" },
      { kind: "derive", name: "trimmed", at: 99, formula: 'TRIM("  a   b ") & [last]' },
      { kind: "derive", name: "len", at: 99, formula: "LEN([last])" },
      { kind: "derive", name: "left", at: 99, formula: "LEFT([last], 3)" },
      { kind: "derive", name: "right", at: 99, formula: "RIGHT([last])" },
      { kind: "derive", name: "mid", at: 99, formula: "MID([last], 2, 3)" },
      { kind: "derive", name: "at", at: 99, formula: 'FIND("@", [email])' },
      { kind: "derive", name: "user", at: 99, formula: 'LEFT([email], FIND("@", [email]) - 1)' },
      { kind: "derive", name: "has", at: 99, formula: 'CONTAINS([email], "X.ORG")' },
      { kind: "derive", name: "is_open", at: 99, formula: '[status] = "open"' },
      { kind: "derive", name: "not_open", at: 99, formula: '[status] <> "open"' },
      { kind: "derive", name: "big", at: 99, formula: "[price] > 3" },
      { kind: "derive", name: "label", at: 99, formula: 'IF([status] = "closed", "Done", "Open")' },
      { kind: "derive", name: "maybe", at: 99, formula: 'IF([price] >= 4, "Big")' },
      { kind: "derive", name: "mixed", at: 99, formula: 'IF([qty] > 3, [qty], "few")' },
      { kind: "derive", name: "both", at: 99, formula: "AND([qty] > 0, [solar])" },
      { kind: "derive", name: "either", at: 99, formula: "OR([qty] = 0, [solar])" },
      { kind: "derive", name: "no_solar", at: 99, formula: "NOT([solar])" },
      { kind: "derive", name: "no_first", at: 99, formula: "ISBLANK([first])" },
      { kind: "derive", name: "name", at: 99, formula: 'COALESCE([first], [last], "?")' },
      { kind: "derive", name: "status2", at: 99, formula: 'IFBLANK([status], "Unknown")' },
      { kind: "derive", name: "r0", at: 99, formula: "ROUND(2.5) + ROUND(-2.5)" },
      { kind: "derive", name: "r2", at: 99, formula: "ROUND([price] * 1.07, 2)" },
      { kind: "derive", name: "rneg", at: 99, formula: "ROUND(1234, -2)" },
      { kind: "derive", name: "abs", at: 99, formula: "ABS(-[qty])" },
      { kind: "derive", name: "lo", at: 99, formula: "MIN([price], [qty])" },
      { kind: "derive", name: "hi", at: 99, formula: "MAX([price], [qty])" },
      { kind: "derive", name: "year", at: 99, formula: "YEAR([ordered])" },
      { kind: "derive", name: "month", at: 99, formula: "MONTH([ordered])" },
      { kind: "derive", name: "day", at: 99, formula: "DAY([ordered])" },
      { kind: "derive", name: "wd1", at: 99, formula: "WEEKDAY([ordered])" },
      { kind: "derive", name: "wd2", at: 99, formula: "WEEKDAY([ordered], 2)" },
      { kind: "derive", name: "wd3", at: 99, formula: "WEEKDAY([ordered], 3)" },
      { kind: "derive", name: "days", at: 99, formula: "[shipped] - [ordered]" },
      { kind: "derive", name: "later", at: 99, formula: "[ordered] + 30" },
      { kind: "derive", name: "dd", at: 99, formula: 'DATEDIF([ordered], [shipped], "d")' },
      { kind: "derive", name: "yy", at: 99, formula: 'DATEDIF(DATE(2020, 2, 29), [shipped], "y")' },
      { kind: "derive", name: "mm", at: 99, formula: 'DATEDIF(DATE(2024, 1, 31), [shipped], "m")' },
      { kind: "derive", name: "bad", at: 99, formula: 'DATEDIF([shipped], [ordered], "d")' },
      { kind: "derive", name: "made", at: 99, formula: "DATE(2024, 13, 1)" },
      { kind: "derive", name: "age", at: 99, formula: 'DATEDIF(DATE(2000, 1, 1), TODAY(), "y") > 20' },
      { kind: "derive", name: "n", at: 99, formula: "ROWNUMBER()" },
      { kind: "derive", name: "rank", at: 99, formula: "RANK([price])" },
      { kind: "derive", name: "share", at: 99, formula: "PERCENTOFTOTAL([price])" },
      { kind: "derive", name: "running", at: 99, formula: "RUNNINGSUM([qty])" },
      { kind: "derive", name: "change", at: 99, formula: "[qty] - PREVIOUS([qty])" },
      { kind: "derive", name: "prev_name", at: 99, formula: "PREVIOUS([first])" },
      { kind: "derive", name: "band", at: 99, formula: "BIN([qty], 3)" },
    ],
  },
];

function rawCsv(spec: CaseSpec): string {
  const lines = [spec.headers.map(csvEscape).join(",")];
  for (const row of spec.rows) {
    lines.push(spec.headers.map((_, index) => csvEscape(row[index] ?? "")).join(","));
  }
  return `${lines.join("\r\n")}\r\n`;
}

function buildCaseColumns(spec: CaseSpec): ColumnData[] {
  return spec.headers.map((name, index) => {
    const raw = spec.rows.map((row) => row[index] ?? "");
    const clean = spec.cleans?.find((entry) => entry.column === index);
    const cleaned = clean === undefined ? raw : applyCleanOps(raw, clean.ops);
    const nullSpec = spec.nulls?.find((entry) => entry.column === index);
    const column = ColumnData.create(
      name,
      cleaned,
      nullSpec === undefined ? undefined : createNullPolicy(nullSpec.extra, nullSpec.keep),
    );
    const type = spec.types?.find((entry) => entry.column === index);
    if (type !== undefined) column.setType(type.type);
    return column;
  });
}

function expectedCsv(spec: CaseSpec): string {
  const baseColumns = buildCaseColumns(spec);
  const base = datasetFromColumns(spec.name, baseColumns);
  const transforms = spec.transforms ?? [];
  const dataset =
    transforms.length === 0
      ? base
      : applyTransformOps(spec.name, base.columns, transforms);
  const ids = Uint32Array.from({ length: dataset.rowCount }, (_, index) => index);
  return buildCsv(dataset, ids, 0, dataset.rowCount, true);
}

function recipeInput(spec: CaseSpec): RecipeInput {
  const columns = buildCaseColumns(spec);
  return {
    cleans: (spec.cleans ?? []).map((entry) => ({
      name: columns[entry.column]?.name ?? `Column ${entry.column + 1}`,
      ops: entry.ops,
    })),
    transforms: spec.transforms ?? [],
    schema: columns.map((column) => ({
      name: column.name,
      numeric: column.type === "integer" || column.type === "number",
      type: column.type,
    })),
    types: (spec.types ?? []).map((entry) => ({
      name: columns[entry.column]?.name ?? `Column ${entry.column + 1}`,
      type: entry.type,
    })),
    nulls: (spec.nulls ?? []).map((entry) => ({
      name: columns[entry.column]?.name ?? `Column ${entry.column + 1}`,
      extra: entry.extra,
      keep: entry.keep,
    })),
  };
}

const here = dirname(fileURLToPath(import.meta.url));
const outRoot = join(here, "cases");
rmSync(outRoot, { recursive: true, force: true });

for (const spec of CASES) {
  const dir = join(outRoot, spec.name);
  mkdirSync(dir, { recursive: true });
  const input = recipeInput(spec);
  writeFileSync(join(dir, "input.csv"), rawCsv(spec), "utf8");
  writeFileSync(join(dir, "expected.csv"), expectedCsv(spec), "utf8");
  writeFileSync(join(dir, "pandas.py"), `${pandasRecipeScript(input).code}\n`, "utf8");
  writeFileSync(join(dir, "polars.py"), `${polarsRecipeScript(input).code}\n`, "utf8");
  writeFileSync(
    join(dir, "case.json"),
    `${JSON.stringify({ name: spec.name, description: spec.description }, null, 2)}\n`,
    "utf8",
  );
  console.log(`case ${spec.name}: input, expected, pandas.py, polars.py`);
}

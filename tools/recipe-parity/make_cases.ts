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

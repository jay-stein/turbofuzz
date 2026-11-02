import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { ColumnData } from "../src/data/column.js";
import { compileFormula, evaluateFormula } from "../src/data/column-formula.js";
import { FORMULA_PRELUDE, formulaPython } from "../src/data/formula-export.js";
import type { ColumnType } from "../src/types.js";

/**
 * The pandas and Polars recipes carry a Python port of every formula function. This runs each
 * formula in the app and in that Python, over the same cells, and requires the same text back:
 * the recipe must give the cell the app gave. Skipped where Python is not installed.
 */

const python = ["python", "python3"].find((cmd) => spawnSync(cmd, ["-I", "-c", "print(1)"], { encoding: "utf8" }).status === 0);

function col(name: string, type: ColumnType, raw: string[]): ColumnData {
  const c = ColumnData.create(name, raw);
  c.setType(type, true);
  return c;
}

const ROWS = 10;
const columns = [
  col("n", "number", ["1234.567", "0.256", "-5", "0", "2", "", "2.5", "-2.5", "1.005", "1000000"]),
  col("d", "datetime", ["2024-03-05 14:07:09", "2024-12-31 00:00:00", "2023-01-01 23:59:59", "2024-02-29 12:30:00", "", "2024-01-15 09:05:00", "2021-06-30 18:45:30", "2020-02-29 00:00:01", "2019-12-30 12:00:00", "2024-10-27 03:04:05"]),
  col("dt", "date", ["2024-03-05", "2024-12-31", "2023-01-01", "2024-02-29", "", "2024-01-15", "2021-06-30", "2020-02-29", "2019-12-30", "2024-10-27"]),
  col("s", "string", ["john o'brien", "  a b  ", "x-y-z", "1,234.5", "12%", "abc", "$5", "-1,000", "A-b-C-d", "hello world"]),
  col("q", "integer", ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"]),
  col("b", "boolean", ["Yes", "No", "", "Yes", "No", "Yes", "", "No", "Yes", "No"]),
];
const info = columns.map((c) => ({ name: c.name, type: c.type }));
const NOW = Date.UTC(2026, 10, 2, 9, 30);

const FORMULAS = [
  // TEXT: dates
  'TEXT([d], "dddd")', 'TEXT([d], "ddd, d mmm yyyy")', 'TEXT([d], "dd/mm/yy")', 'TEXT([dt], "mmmm d, yyyy")', 'TEXT([d], "yyyy-mm-dd hh:mm:ss")',
  'TEXT([d], "h:mm AM/PM")', 'TEXT([d], "hh:mm am/pm")', 'TEXT([d], "h:mm A/P")', 'TEXT([d], "mm:ss")', 'TEXT([d], "hh:mm")', 'TEXT([d], "m/d")', 'TEXT([d], "mmmmm")',
  'TEXT([d], "d mmm ""at"" h")', 'TEXT([d], "yyyy\\mm")', 'TEXT([q], "dd/mm/yyyy")', 'TEXT([d], "0.0")',
  // TEXT: numbers
  'TEXT([n], "#,##0.00")', 'TEXT([n], "0%")', 'TEXT([n], "0.0%")', 'TEXT([n], "000")', 'TEXT([n], "$#,##0")', 'TEXT([n], "0;(0)")', 'TEXT([n], "0;-0;zero")', 'TEXT([n], "0.0#")',
  'TEXT([n], "#.00")', 'TEXT([n], "0 ""kg""")', 'TEXT([n], "General")', 'TEXT([n], "0.00E+00")', 'TEXT([n], "0.##")', 'TEXT([n], "#,##0")', 'TEXT([n], "0.000")', 'TEXT([n], "abc")',
  'TEXT([n], "0,")', 'TEXT([n], "0-0")', 'TEXT([s], "0.00")', 'TEXT([b], "0")', 'TEXT([n] * 1e12, "0")',
  // text
  "VALUE([s])", "PROPER([s])", 'SUBSTITUTE([s], "-", "")', 'SUBSTITUTE([s], "-", "_", 2)', 'SUBSTITUTE([s], "-", "_", 9)', 'SUBSTITUTE([s], "-", "_", 0)', 'SUBSTITUTE([s], "", "_")', 'REPLACE([s], 2, 3, "ZZ")', "REPLACE([s], 20, 3, \"ZZ\")",
  'SEARCH("B", [s])', 'SEARCH("b", [s], 5)', 'TEXTBEFORE([s], "-")', 'TEXTBEFORE([s], "-", -1)', 'TEXTBEFORE([s], "-", 2)', 'TEXTAFTER([s], "-")', 'TEXTAFTER([s], "-", -1)', 'TEXTAFTER([s], "-", -2)', 'TEXTAFTER([s], "-", 0)',
  'TEXTJOIN("/", TRUE, [s], [n])', 'TEXTJOIN("/", FALSE, [s], [n])', 'TEXTJOIN("", TRUE, [s])', 'EXACT([s], "abc")', 'EXACT([s], [s])',
  // maths
  "INT([n])", "TRUNC([n], 1)", "TRUNC([n])", "TRUNC([n], -2)", "ROUNDUP([n], 1)", "ROUNDDOWN([n], 0)", "ROUNDUP([n], -2)", "MOD([n], 3)", "MOD(-7, 3)", "MOD(7, -3)", "MOD([n], 0)", "SQRT([n])", "POWER([n], 2)", "POWER([n], 0.5)", "POWER([n], 99999)", "LN([n])",
  "CEILING([n], 0.5)", "FLOOR([n], 0.5)", "CEILING([n])", "FLOOR([n], 10)", "CEILING([n], -2)", "FLOOR(-2.5, -2)", "CEILING(-2.5, 2)", "FLOOR(-2.5, 2)", "SUM([n], [q])", "SUM([s])", "AVERAGE([n], [q], 1)", "AVERAGE([n])",
  // logic
  'IFS([n] > 100, "big", [n] > 0, "small")', 'IFS([n] > 100, "big", TRUE, "other")', 'SWITCH([q], 1, "one", 2, "two", "many")', 'SWITCH([s], "abc", 1, "ABC", 2)', "SWITCH([n], 2, 20, 0, 0, -1)", 'IFERROR(1 / [n], -1)', 'IFERROR([n] + [s], "bad")', "IFERROR(VALUE([s]), 0)",
  "ISNUMBER([n])", "ISNUMBER([s])", "ISNUMBER([d])", "ISTEXT([s])", "ISTEXT([n])", "ISNUMBER(VALUE([s]))",
  // dates
  "HOUR([d])", "MINUTE([d])", "SECOND([d])", "HOUR([dt])", "HOUR(0.75)", "EDATE([d], 1)", "EDATE([dt], -1)", "EDATE([dt], 12)", "EOMONTH([d], 0)", "EOMONTH([dt], 1)", "EOMONTH([dt], -13)",
  "WEEKNUM([d])", "WEEKNUM([d], 2)", "WEEKNUM([d], 21)", "WEEKNUM([d], 5)", "DAYS([d], DATE(2024, 1, 1))", "DAYS([dt], [d])",
  // whole column
  "COLUMNMEAN([n])", "COLUMNMEDIAN([n])", "COLUMNSTDEV([n])", "([n] - COLUMNMEAN([n])) / COLUMNSTDEV([n])", "COLUMNMEDIAN([q])", "COLUMNSTDEV([q])", "COLUMNMEAN([s])",
];

test("every formula gives the same cells in the app and in the exported Python", { skip: python === undefined ? "Python is not installed" : false }, () => {
  const rows = Array.from({ length: ROWS }, (_, r) =>
    Object.fromEntries(columns.map((c) => [c.name, c.nullMask.get(r) ? null : c.raw[r] ?? null])),
  );
  const cases = FORMULAS.map((formula) => {
    const compiled = compileFormula(formula, info);
    if (!compiled.ok) return { formula, skip: compiled.error } as const;
    const py = formulaPython(formula, info);
    assert.ok(py !== null, formula);
    const app = evaluateFormula(compiled, columns, ROWS, null, NOW);
    return { formula, py, app: app.raw.map((cell) => (cell === "" ? null : cell)) } as const;
  });
  const compiledCases = cases.filter((c): c is Extract<typeof c, { py: unknown }> => "py" in c);
  assert.ok(compiledCases.length > 120, `${compiledCases.length} formulas compile`);
  const script = [
    ...FORMULA_PRELUDE,
    "import json",
    `rows = json.loads(${JSON.stringify(JSON.stringify(rows))})`,
    "out = []",
    ...compiledCases.flatMap((c, k) => [
      `def _f${k}(r, i, W):`,
      `    return ${c.py.expr}`,
      `out.append(_derive(rows, _f${k}, ${JSON.stringify(c.py.type)}, ${c.py.windows}))`,
    ]),
    "print(json.dumps(out))",
  ].join("\n");
  // On stdin: a long script does not fit on a Windows command line.
  const run = spawnSync(python!, ["-I", "-"], { input: script, encoding: "utf8", maxBuffer: 1 << 26 });
  assert.equal(run.status, 0, `${run.stderr}${run.error ?? ""}`);
  const got = JSON.parse(run.stdout) as (string | null)[][];
  const wrong: string[] = [];
  compiledCases.forEach((c, k) => {
    for (let r = 0; r < ROWS; r++) {
      if (got[k]![r] !== c.app[r]) wrong.push(`${c.formula}  row ${r}: app ${JSON.stringify(c.app[r])}  python ${JSON.stringify(got[k]![r])}`);
    }
  });
  assert.deepEqual(wrong, [], `\n${wrong.slice(0, 40).join("\n")}`);
});

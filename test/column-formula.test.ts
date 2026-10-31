import { test } from "node:test";
import assert from "node:assert/strict";
import { ColumnData } from "../src/data/column.js";
import { compileFormula, evaluateFormula, renameInFormula } from "../src/data/column-formula.js";
import type { ColumnType } from "../src/types.js";

function col(name: string, type: ColumnType, raw: string[]): ColumnData {
  const c = ColumnData.create(name, raw);
  c.setType(type, true);
  return c;
}

const columns = [
  col("Price", "number", ["10", "2.5", "", "4"]),
  col("Qty", "integer", ["3", "4", "5", "0"]),
  col("Status", "category", ["Closed", "open", "Open", ""]),
  col("First", "string", ["Ada", "Alan", "", "Grace"]),
  col("Last", "string", ["Lovelace", "Turing", "Hopper", ""]),
  col("Order date", "date", ["2024-01-15", "2024-02-29", "", "2023-12-31"]),
  col("Ship date", "date", ["2024-01-20", "2024-03-01", "2024-01-01", "2023-12-31"]),
  col("Solar", "boolean", ["Yes", "No", "", "Yes"]),
  col("Email", "string", ["ada@x.org", "alan@y.com", "nobody", ""]),
];
const info = columns.map((c) => ({ name: c.name, type: c.type }));
const NOW = Date.UTC(2026, 9, 31, 15, 0);

function run(formula: string): { raw: string[]; type: string; errors: Record<string, number> } {
  const compiled = compileFormula(formula, info);
  if (!compiled.ok) throw new Error(`${formula}: ${compiled.error}`);
  const r = evaluateFormula(compiled, columns, 4, null, NOW);
  return { raw: r.raw, type: r.type, errors: Object.fromEntries(r.errors) };
}

test("arithmetic: blank in, blank out; divide by zero is an error left empty", () => {
  // Whole-number results make an integer column.
  assert.deepEqual(run("[Price] * [Qty]"), { raw: ["30", "10", "", "0"], type: "integer", errors: {} });
  assert.equal(run("[Price] * 1.5").type, "number");
  assert.deepEqual(run("[Qty] + 1").raw, ["4", "5", "6", "1"]);
  assert.equal(run("[Qty] + 1").type, "integer");
  assert.deepEqual(run("[Price] / [Qty]").raw, ["3.33333333333333", "0.625", "", ""]);
  assert.deepEqual(run("[Price] / [Qty]").errors, { "divide by zero": 1 });
  assert.deepEqual(run("-[Qty] ^ 2").raw, ["9", "16", "25", "0"]);
  assert.deepEqual(run("0.1 + 0.2").raw[0], "0.3");
  assert.deepEqual(run("2 + 3 * 4 ^ 2").raw[0], "50");
});

test("text: & and CONCAT join; blanks join as nothing", () => {
  assert.deepEqual(run('[First] & " " & [Last]').raw, ["Ada Lovelace", "Alan Turing", " Hopper", "Grace "]);
  assert.deepEqual(run("CONCAT([First], [Qty])").raw, ["Ada3", "Alan4", "5", "Grace0"]);
  assert.deepEqual(run("UPPER([First])").raw, ["ADA", "ALAN", "", "GRACE"]);
  assert.deepEqual(run("LOWER([Status])").raw, ["closed", "open", "open", ""]);
  assert.deepEqual(run('TRIM("  a   b ")').raw[0], "a b");
  assert.deepEqual(run("LEN([Last])").raw, ["8", "6", "6", "0"]);
  assert.deepEqual(run("LEFT([Last], 3)").raw, ["Lov", "Tur", "Hop", ""]);
  assert.deepEqual(run("RIGHT([Last])").raw, ["e", "g", "r", ""]);
  assert.deepEqual(run("MID([Last], 2, 3)").raw, ["ove", "uri", "opp", ""]);
  assert.deepEqual(run('FIND("@", [Email])').raw, ["4", "5", "", ""]);
  assert.deepEqual(run('FIND("@", [Email])').errors, { "“@” not found": 1 });
  assert.deepEqual(run('LEFT([Email], FIND("@", [Email]) - 1)').raw, ["ada", "alan", "", ""]);
  assert.deepEqual(run('CONTAINS([Email], "X.ORG")').raw, ["TRUE", "FALSE", "FALSE", "FALSE"]);
});

test("comparisons ignore case; a blank compares FALSE except <>", () => {
  assert.deepEqual(run('[Status] = "open"').raw, ["FALSE", "TRUE", "TRUE", "FALSE"]);
  assert.deepEqual(run('[Status] <> "open"').raw, ["TRUE", "FALSE", "FALSE", "TRUE"]);
  assert.deepEqual(run("[Price] > 3").raw, ["TRUE", "FALSE", "FALSE", "TRUE"]);
  assert.deepEqual(run("[Price] <> 3").raw, ["TRUE", "TRUE", "TRUE", "TRUE"]);
  assert.equal(run("[Price] > 3").type, "boolean");
});

test("IF, AND, OR, NOT, ISBLANK, COALESCE and IFBLANK", () => {
  assert.deepEqual(run('IF([Status] = "closed", "Done", "Open")').raw, ["Done", "Open", "Open", "Open"]);
  assert.deepEqual(run('IF([Price] >= 4, "Big")').raw, ["Big", "", "", "Big"]);
  assert.deepEqual(run('IF([Qty] > 3, [Qty], "few")').type, "string");
  assert.deepEqual(run("AND([Qty] > 0, [Solar])").raw, ["TRUE", "FALSE", "FALSE", "FALSE"]);
  assert.deepEqual(run("OR([Qty] = 0, [Solar])").raw, ["TRUE", "FALSE", "FALSE", "TRUE"]);
  assert.deepEqual(run("NOT([Solar])").raw, ["FALSE", "TRUE", "TRUE", "FALSE"]);
  assert.deepEqual(run("ISBLANK([First])").raw, ["FALSE", "FALSE", "TRUE", "FALSE"]);
  assert.deepEqual(run("COALESCE([First], [Last], \"?\")").raw, ["Ada", "Alan", "Hopper", "Grace"]);
  assert.deepEqual(run('IFBLANK([Status], "Unknown")').raw, ["Closed", "open", "Open", "Unknown"]);
});

test("ROUND halves away from zero, ABS, MIN and MAX skip blanks", () => {
  assert.deepEqual(run("ROUND(2.5)").raw[0], "3");
  assert.deepEqual(run("ROUND(-2.5)").raw[0], "-3");
  assert.deepEqual(run("ROUND(2.675, 2)").raw[0], "2.68");
  assert.deepEqual(run("ROUND(1234, -2)").raw[0], "1200");
  assert.deepEqual(run("ABS(-[Qty])").raw, ["3", "4", "5", "0"]);
  assert.deepEqual(run("MIN([Price], [Qty])").raw, ["3", "2.5", "5", "0"]);
  assert.deepEqual(run("MAX([Price], [Qty])").raw, ["10", "4", "5", "4"]);
});

test("dates: parts, weekdays, differences, DATE and TODAY", () => {
  assert.deepEqual(run("YEAR([Order date])").raw, ["2024", "2024", "", "2023"]);
  assert.deepEqual(run("MONTH([Order date])").raw, ["1", "2", "", "12"]);
  assert.deepEqual(run("DAY([Order date])").raw, ["15", "29", "", "31"]);
  // 15 Jan 2024 was a Monday; 31 Dec 2023 a Sunday.
  assert.deepEqual(run("WEEKDAY([Order date])").raw, ["2", "5", "", "1"]);
  assert.deepEqual(run("WEEKDAY([Order date], 2)").raw, ["1", "4", "", "7"]);
  assert.deepEqual(run("WEEKDAY([Order date], 3)").raw, ["0", "3", "", "6"]);
  assert.deepEqual(run("[Ship date] - [Order date]").raw, ["5", "1", "", "0"]);
  assert.deepEqual(run("[Order date] + 30").raw, ["2024-02-14", "2024-03-30", "", "2024-01-30"]);
  assert.equal(run("[Order date] + 30").type, "date");
  assert.deepEqual(run('DATEDIF([Order date], [Ship date], "d")').raw, ["5", "1", "", "0"]);
  assert.deepEqual(run('DATEDIF(DATE(2020, 2, 29), [Ship date], "y")').raw, ["3", "4", "3", "3"]);
  assert.deepEqual(run('DATEDIF(DATE(2024, 1, 31), [Ship date], "m")').raw[1], "1");
  assert.deepEqual(run('DATEDIF([Ship date], [Order date], "d")').errors, { "DATEDIF start is after the end": 2 });
  assert.deepEqual(run("TODAY()").raw[0], "2026-10-31");
  assert.equal(run("DATE(2024, 13, 1)").raw[0], "2025-01-01");
});

test("mistakes are pointed at, with a suggestion", () => {
  const err = (f: string) => {
    const c = compileFormula(f, info);
    assert.equal(c.ok, false, f);
    return c.ok ? null : c;
  };
  assert.match(err("[Pirce] * 2")!.error, /No column \[Pirce\]\. Did you mean \[Price\]\?/);
  assert.deepEqual([err("[Pirce] * 2")!.at, err("[Pirce] * 2")!.end], [0, 7]);
  assert.match(err("UPPR([First])")!.error, /Did you mean UPPER\?/);
  assert.match(err("Price * 2")!.error, /brackets: \[Price\]/);
  assert.match(err("LEFT([First], 1, 2, 3)")!.error, /LEFT takes 1 to 2 values/);
  assert.match(err("([Qty] + 1")!.error, /closing \)/);
  assert.match(err("[Qty] 2")!.error, /operator .* missing/);
  assert.match(err('"open')!.error, /closing "/);
  assert.match(err("")!.error, /Type a formula/);
  // Semicolons separate arguments too (European Excel).
  assert.equal(compileFormula("ROUND([Price]; 1)", info).ok, true);
});

test("a rename keeps formulas pointing at the column", () => {
  assert.equal(renameInFormula('[price] * [Qty] & "[Price]"', "Price", "Unit price"), '[Unit price] * [Qty] & "[Price]"');
});

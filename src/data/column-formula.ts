/**
 * Excel-style formulas for new columns (DEC-2026-10-31-01): `[Price] * [Qty]`,
 * `IF([Status] = "Closed", "Done", "Open")`, `UPPER([First] & " " & [Last])`,
 * `YEAR([Order date])`. Parsed to a tree, checked against the columns' types, then
 * compiled to closures evaluated row by row in the worker. No JavaScript is ever run
 * from the formula text.
 *
 * Rules, the same in the pandas and Polars exports:
 * - a blank in arithmetic gives a blank (blank in, blank out);
 * - a comparison with a blank is FALSE, except `<>`, which is TRUE;
 * - text compares without regard to case, as in Excel;
 * - date - date is days; date + number is a date (days);
 * - an error (divide by zero, text that is not a number) leaves the cell empty and is
 *   counted, with its reason, for the preview.
 */

import type { ColumnType } from "../types.js";
import { fuzzyRank } from "../search/fuzzy-match.js";
import { isoWeek } from "./aggregate.js";
import { formatForText } from "./formula-text.js";

export type FType = "number" | "text" | "bool" | "date" | "datetime" | "any";
export type CellValue = number | string | boolean | null;

/** A runtime error in one cell: the cell is left empty and the reason counted. */
export class CellError {
  constructor(readonly reason: string) {}
}

export type Node =
  | { k: "num"; v: number; at: number }
  | { k: "str"; v: string; at: number }
  | { k: "bool"; v: boolean; at: number }
  | { k: "col"; index: number; name: string; at: number }
  | { k: "un"; op: "-" | "+"; a: Node; at: number }
  | { k: "bin"; op: BinOp; a: Node; b: Node; at: number }
  | { k: "call"; fn: string; args: Node[]; at: number };

export type BinOp = "+" | "-" | "*" | "/" | "^" | "&" | "=" | "<>" | "<" | "<=" | ">" | ">=";

export interface FormulaColumnInfo {
  name: string;
  type: ColumnType;
}

export type Compiled =
  | { ok: true; ast: Node; type: FType; refs: number[] }
  | { ok: false; error: string; at: number; end: number };

/** Function names with their argument counts (max -1 for any number). */
export const FUNCTIONS: Readonly<Record<string, { min: number; max: number; sig: string; help: string; example: string }>> = {
  IF: { min: 2, max: 3, sig: "IF(test, then, else)", help: "One value when the test is true, another when not (blank if no else).", example: 'IF([Amount] > 1000, "Large", "Small")' },
  AND: { min: 1, max: -1, sig: "AND(test1, test2, …)", help: "TRUE when every test is true.", example: 'AND([Qty] > 0, [Status] = "Open")' },
  OR: { min: 1, max: -1, sig: "OR(test1, test2, …)", help: "TRUE when any test is true.", example: 'OR([Region] = "North", [Region] = "East")' },
  NOT: { min: 1, max: 1, sig: "NOT(test)", help: "The opposite of a test.", example: "NOT(ISBLANK([Email]))" },
  ROUND: { min: 1, max: 2, sig: "ROUND(number, digits)", help: "Rounds to that many decimals, halves away from zero (as Excel).", example: "ROUND([Price] * 1.1, 2)" },
  ABS: { min: 1, max: 1, sig: "ABS(number)", help: "The number without its sign.", example: "ABS([Change])" },
  MIN: { min: 1, max: -1, sig: "MIN(value1, value2, …)", help: "The smallest of the values on the row; blanks are skipped.", example: "MIN([Q1], [Q2], [Q3])" },
  MAX: { min: 1, max: -1, sig: "MAX(value1, value2, …)", help: "The largest of the values on the row; blanks are skipped.", example: "MAX([Q1], [Q2], [Q3])" },
  LEN: { min: 1, max: 1, sig: "LEN(text)", help: "The number of characters.", example: "LEN([Code])" },
  LEFT: { min: 1, max: 2, sig: "LEFT(text, count)", help: "The first characters (one if no count).", example: "LEFT([Postcode], 2)" },
  RIGHT: { min: 1, max: 2, sig: "RIGHT(text, count)", help: "The last characters (one if no count).", example: "RIGHT([Phone], 4)" },
  MID: { min: 3, max: 3, sig: "MID(text, start, count)", help: "Characters from a position (the first is 1).", example: "MID([Code], 3, 2)" },
  FIND: { min: 2, max: 3, sig: "FIND(find, text, start)", help: "Where the text first appears (1 is the first character); an error when it does not. Case matters.", example: 'FIND("@", [Email])' },
  UPPER: { min: 1, max: 1, sig: "UPPER(text)", help: "Capital letters.", example: "UPPER([Country])" },
  LOWER: { min: 1, max: 1, sig: "LOWER(text)", help: "Small letters.", example: "LOWER([Email])" },
  TRIM: { min: 1, max: 1, sig: "TRIM(text)", help: "Removes spaces at the ends and runs of spaces inside.", example: "TRIM([Name])" },
  CONCAT: { min: 1, max: -1, sig: "CONCAT(text1, text2, …)", help: "Joins texts; the same as &.", example: 'CONCAT([First], " ", [Last])' },
  CONTAINS: { min: 2, max: 2, sig: "CONTAINS(text, find)", help: "TRUE when the text includes the other, whatever the case.", example: 'CONTAINS([Notes], "urgent")' },
  YEAR: { min: 1, max: 1, sig: "YEAR(date)", help: "The year of a date.", example: "YEAR([Order date])" },
  MONTH: { min: 1, max: 1, sig: "MONTH(date)", help: "The month of a date, 1 to 12.", example: "MONTH([Order date])" },
  DAY: { min: 1, max: 1, sig: "DAY(date)", help: "The day of the month, 1 to 31.", example: "DAY([Order date])" },
  WEEKDAY: { min: 1, max: 2, sig: "WEEKDAY(date, type)", help: "Day of the week: type 1 (default) Sunday = 1 to Saturday = 7; type 2 Monday = 1 to Sunday = 7; type 3 Monday = 0 to Sunday = 6.", example: "WEEKDAY([Order date], 2)" },
  DATEDIF: { min: 3, max: 3, sig: 'DATEDIF(start, end, "d" | "m" | "y")', help: "Whole days, months or years between two dates; an error when the start is after the end.", example: 'DATEDIF([Start], [End], "d")' },
  DATE: { min: 3, max: 3, sig: "DATE(year, month, day)", help: "A date from its parts.", example: "DATE(2024, 7, 1)" },
  TODAY: { min: 0, max: 0, sig: "TODAY()", help: "Today's date (UTC), when the column is made.", example: 'DATEDIF([Joined], TODAY(), "y")' },
  ISBLANK: { min: 1, max: 1, sig: "ISBLANK(value)", help: "TRUE when the cell is empty.", example: "ISBLANK([Phone])" },
  COALESCE: { min: 1, max: -1, sig: "COALESCE(value1, value2, …)", help: "The first value that is not empty.", example: "COALESCE([Phone], [Mobile])" },
  IFBLANK: { min: 2, max: 2, sig: "IFBLANK(value, fallback)", help: "The value, or the fallback when it is empty (the same as COALESCE).", example: 'IFBLANK([Region], "Unknown")' },
  ROWNUMBER: { min: 0, max: 0, sig: "ROWNUMBER()", help: "1, 2, 3… down the table's stored order (the file's order).", example: "ROWNUMBER()" },
  RANK: { min: 1, max: 1, sig: "RANK([column])", help: "1 for the largest value; ties share the best rank; blanks stay blank.", example: "RANK([Sales])" },
  PERCENTOFTOTAL: { min: 1, max: 1, sig: "PERCENTOFTOTAL([column])", help: "The value as a percentage of the column's total.", example: "PERCENTOFTOTAL([Sales])" },
  RUNNINGSUM: { min: 1, max: 1, sig: "RUNNINGSUM([column])", help: "The total so far, down the stored order; blanks add nothing and stay blank.", example: "RUNNINGSUM([Sales])" },
  PREVIOUS: { min: 1, max: 1, sig: "PREVIOUS([column])", help: "The value on the row above in the stored order (blank on the first row).", example: "[Sales] - PREVIOUS([Sales])" },
  TEXT: { min: 2, max: 2, sig: 'TEXT(value, "format")', help: 'A number or date written in a format: "dddd" Monday, "d mmm yyyy", "yyyy-mm-dd", "#,##0.00", "0%". Text passes through.', example: 'TEXT([Order date], "dddd")' },
  VALUE: { min: 1, max: 1, sig: "VALUE(text)", help: "Text read as a number: 1,234.5, 12% and $5 all read; an error when it is not a number.", example: "VALUE([Price text])" },
  SUBSTITUTE: { min: 3, max: 4, sig: "SUBSTITUTE(text, old, new, instance)", help: "Swaps the old text for the new, everywhere or only the nth time. Case matters.", example: 'SUBSTITUTE([Phone], "-", "")' },
  REPLACE: { min: 4, max: 4, sig: "REPLACE(text, start, count, new)", help: "Swaps count characters from a position (the first is 1) for the new text.", example: 'REPLACE([Code], 1, 2, "XX")' },
  PROPER: { min: 1, max: 1, sig: "PROPER(text)", help: "A capital letter at the start of each word and small letters after it.", example: "PROPER([Name])" },
  SEARCH: { min: 2, max: 3, sig: "SEARCH(find, text, start)", help: "Where the text first appears, whatever the case (1 is the first character); an error when it does not.", example: 'SEARCH("unit", [Address])' },
  EXACT: { min: 2, max: 2, sig: "EXACT(text1, text2)", help: "TRUE when the two texts match, case included.", example: "EXACT([Code], [Other code])" },
  TEXTBEFORE: { min: 2, max: 3, sig: "TEXTBEFORE(text, delimiter, instance)", help: "Everything before the delimiter: the first one, the nth, or counting from the end when negative. An error when it is not there. Case matters.", example: 'TEXTBEFORE([Email], "@")' },
  TEXTAFTER: { min: 2, max: 3, sig: "TEXTAFTER(text, delimiter, instance)", help: "Everything after the delimiter: the first one, the nth, or counting from the end when negative. An error when it is not there. Case matters.", example: 'TEXTAFTER([Email], "@")' },
  TEXTJOIN: { min: 3, max: -1, sig: "TEXTJOIN(delimiter, skip_empty, text1, …)", help: "Joins texts with a delimiter between them; TRUE leaves empty ones out.", example: 'TEXTJOIN(", ", TRUE, [City], [State], [Country])' },
  INT: { min: 1, max: 1, sig: "INT(number)", help: "The number rounded down to a whole number (-2.5 gives -3).", example: "INT([Price])" },
  TRUNC: { min: 1, max: 2, sig: "TRUNC(number, digits)", help: "Cuts off decimals without rounding (-2.5 gives -2).", example: "TRUNC([Price], 1)" },
  MOD: { min: 2, max: 2, sig: "MOD(number, divisor)", help: "The remainder after dividing; it takes the divisor's sign.", example: "MOD([Qty], 12)" },
  SQRT: { min: 1, max: 1, sig: "SQRT(number)", help: "The square root; an error for a negative number.", example: "SQRT([Area])" },
  POWER: { min: 2, max: 2, sig: "POWER(number, power)", help: "The number raised to a power; the same as ^.", example: "POWER([Side], 2)" },
  LN: { min: 1, max: 1, sig: "LN(number)", help: "The natural logarithm; an error for 0 or less.", example: "LN([Sales])" },
  ROUNDUP: { min: 1, max: 2, sig: "ROUNDUP(number, digits)", help: "Rounds away from zero to that many decimals.", example: "ROUNDUP([Hours], 0)" },
  ROUNDDOWN: { min: 1, max: 2, sig: "ROUNDDOWN(number, digits)", help: "Rounds toward zero to that many decimals.", example: "ROUNDDOWN([Hours], 0)" },
  CEILING: { min: 1, max: 2, sig: "CEILING(number, multiple)", help: "Rounds up to the next multiple (1 if no multiple).", example: "CEILING([Minutes], 15)" },
  FLOOR: { min: 1, max: 2, sig: "FLOOR(number, multiple)", help: "Rounds down to a multiple (1 if no multiple).", example: "FLOOR([Age], 10)" },
  SUM: { min: 1, max: -1, sig: "SUM(value1, value2, …)", help: "The total of the values on the row; blanks are skipped.", example: "SUM([Q1], [Q2], [Q3], [Q4])" },
  AVERAGE: { min: 1, max: -1, sig: "AVERAGE(value1, value2, …)", help: "The mean of the values on the row; blanks are skipped.", example: "AVERAGE([Q1], [Q2], [Q3])" },
  IFS: { min: 2, max: -1, sig: "IFS(test1, value1, test2, value2, …)", help: "The value of the first test that is true; an error when none is (finish with TRUE for an else).", example: 'IFS([Score] >= 90, "A", [Score] >= 80, "B", TRUE, "C")' },
  SWITCH: { min: 3, max: -1, sig: "SWITCH(value, match1, result1, …, else)", help: "The result of the first match. One more value after the pairs is the else.", example: 'SWITCH([Code], "N", "North", "S", "South", "Other")' },
  IFERROR: { min: 2, max: 2, sig: "IFERROR(value, fallback)", help: "The value, or the fallback when the value is an error.", example: "IFERROR([Total] / [Qty], 0)" },
  ISNUMBER: { min: 1, max: 1, sig: "ISNUMBER(value)", help: "TRUE when the value is a number or a date (text that looks like a number is text).", example: "ISNUMBER([Id])" },
  ISTEXT: { min: 1, max: 1, sig: "ISTEXT(value)", help: "TRUE when the value is text.", example: "ISTEXT([Id])" },
  HOUR: { min: 1, max: 1, sig: "HOUR(datetime)", help: "The hour of a time, 0 to 23.", example: "HOUR([Opened])" },
  MINUTE: { min: 1, max: 1, sig: "MINUTE(datetime)", help: "The minute of a time, 0 to 59.", example: "MINUTE([Opened])" },
  SECOND: { min: 1, max: 1, sig: "SECOND(datetime)", help: "The second of a time, 0 to 59.", example: "SECOND([Opened])" },
  EDATE: { min: 2, max: 2, sig: "EDATE(date, months)", help: "The date that many months later (earlier when negative), on the same day of the month or the month's last day.", example: "EDATE([Start], 6)" },
  EOMONTH: { min: 2, max: 2, sig: "EOMONTH(date, months)", help: "The last day of the month that many months away (0 is this month).", example: "EOMONTH([Date], 0)" },
  WEEKNUM: { min: 1, max: 2, sig: "WEEKNUM(date, type)", help: "The week of the year: type 1 (default) weeks start on Sunday, 2 on Monday, 21 is the ISO week.", example: "WEEKNUM([Date], 2)" },
  DAYS: { min: 2, max: 2, sig: "DAYS(end, start)", help: "Whole days from the start date to the end date.", example: "DAYS([Shipped], [Ordered])" },
  NOW: { min: 0, max: 0, sig: "NOW()", help: "The date and time now (UTC), when the column is made.", example: 'DATEDIF([Joined], NOW(), "y")' },
  COLUMNMEAN: { min: 1, max: 1, sig: "COLUMNMEAN([column])", help: "The mean of the whole column, the same on every row.", example: "[Score] - COLUMNMEAN([Score])" },
  COLUMNMEDIAN: { min: 1, max: 1, sig: "COLUMNMEDIAN([column])", help: "The median of the whole column, the same on every row.", example: "[Score] - COLUMNMEDIAN([Score])" },
  COLUMNSTDEV: { min: 1, max: 1, sig: "COLUMNSTDEV([column])", help: "The sample standard deviation of the whole column; z-score is ([x] - COLUMNMEAN([x])) / COLUMNSTDEV([x]).", example: "([Score] - COLUMNMEAN([Score])) / COLUMNSTDEV([Score])" },
  BIN: { min: 2, max: 2, sig: "BIN([column], count)", help: "Which of count equal-width bands from the smallest to the largest value (1 = lowest).", example: "BIN([Age], 5)" },
};

/** Functions that read a whole column (worked out once, then read row by row). */
export const WINDOW_FUNCTIONS: ReadonlySet<string> = new Set(["RANK", "PERCENTOFTOTAL", "RUNNINGSUM", "PREVIOUS", "BIN", "COLUMNMEAN", "COLUMNMEDIAN", "COLUMNSTDEV"]);

// ---------------------------------------------------------------- tokenizer

type Tok =
  | { t: "num"; v: number; at: number; end: number }
  | { t: "str"; v: string; at: number; end: number }
  | { t: "col"; v: string; at: number; end: number }
  | { t: "id"; v: string; at: number; end: number }
  | { t: "op"; v: string; at: number; end: number };

class ParseError extends Error {
  constructor(message: string, readonly at: number, readonly end: number) {
    super(message);
  }
}

function tokenize(text: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  let skippedEquals = false;
  while (i < text.length) {
    const ch = text[i]!;
    if (/\s/.test(ch)) { i++; continue; }
    // A formula typed the Excel way starts with =; it means nothing here, and skipping it keeps every position true.
    if (ch === "=" && out.length === 0 && !skippedEquals) { skippedEquals = true; i++; continue; }
    const start = i;
    if (ch === "[") {
      let name = "";
      i++;
      for (;;) {
        if (i >= text.length) throw new ParseError("A column name is missing its closing ]", start, text.length);
        if (text[i] === "]") {
          if (text[i + 1] === "]") { name += "]"; i += 2; continue; }
          i++;
          break;
        }
        name += text[i++];
      }
      out.push({ t: "col", v: name, at: start, end: i });
    } else if (ch === '"') {
      let s = "";
      i++;
      for (;;) {
        if (i >= text.length) throw new ParseError("A text in quotes is missing its closing \"", start, text.length);
        if (text[i] === '"') {
          if (text[i + 1] === '"') { s += '"'; i += 2; continue; }
          i++;
          break;
        }
        s += text[i++];
      }
      out.push({ t: "str", v: s, at: start, end: i });
    } else if (/[0-9.]/.test(ch)) {
      const m = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(text.slice(i));
      if (!m) throw new ParseError(`Unexpected “${ch}”`, i, i + 1);
      i += m[0].length;
      out.push({ t: "num", v: Number(m[0]), at: start, end: i });
    } else if (/[A-Za-z_]/.test(ch)) {
      const m = /^[A-Za-z_][A-Za-z0-9_.]*/.exec(text.slice(i))!;
      i += m[0].length;
      out.push({ t: "id", v: m[0], at: start, end: i });
    } else {
      const two = text.slice(i, i + 2);
      if (two === "<>" || two === "<=" || two === ">=") { out.push({ t: "op", v: two, at: i, end: i + 2 }); i += 2; continue; }
      if ("+-*/^&=<>(),;".includes(ch)) { out.push({ t: "op", v: ch === ";" ? "," : ch, at: i, end: i + 1 }); i++; continue; }
      throw new ParseError(`Unexpected “${ch}”`, i, i + 1);
    }
  }
  return out;
}

// ---------------------------------------------------------------- parser (Excel precedence)

const COMPARE = new Set(["=", "<>", "<", "<=", ">", ">="]);

function parse(text: string, columns: readonly FormulaColumnInfo[]): Node {
  const toks = tokenize(text);
  if (toks.length === 0) throw new ParseError("Type a formula, e.g. [Price] * [Qty]", 0, 0);
  let p = 0;
  const peek = (): Tok | undefined => toks[p];
  const isOp = (v: string): boolean => { const t = peek(); return t !== undefined && t.t === "op" && t.v === v; };
  const expect = (v: string, what: string): void => {
    const t = peek();
    if (!t || t.t !== "op" || t.v !== v) {
      const at = t ? t.at : text.length;
      throw new ParseError(`Expected ${what}`, at, t ? t.end : text.length);
    }
    p++;
  };

  const lower = columns.map((c) => c.name.toLowerCase());
  const column = (name: string, at: number, end: number): Node => {
    const index = lower.indexOf(name.trim().toLowerCase());
    if (index < 0) {
      const near = fuzzyRank(columns, name, (c) => c.name)[0];
      throw new ParseError(`No column [${name}]${near ? `. Did you mean [${near.name}]?` : ""}`, at, end);
    }
    return { k: "col", index, name: columns[index]!.name, at };
  };

  function compare(): Node {
    let a = concat();
    for (let t = peek(); t !== undefined && t.t === "op" && COMPARE.has(t.v); t = peek()) {
      p++;
      a = { k: "bin", op: t.v as BinOp, a, b: concat(), at: t.at };
    }
    return a;
  }
  function concat(): Node {
    let a = additive();
    while (isOp("&")) { const at = toks[p++]!.at; a = { k: "bin", op: "&", a, b: additive(), at }; }
    return a;
  }
  function additive(): Node {
    let a = term();
    while (isOp("+") || isOp("-")) { const t = toks[p++]!; a = { k: "bin", op: t.v as BinOp, a, b: term(), at: t.at }; }
    return a;
  }
  function term(): Node {
    let a = power();
    while (isOp("*") || isOp("/")) { const t = toks[p++]!; a = { k: "bin", op: t.v as BinOp, a, b: power(), at: t.at }; }
    return a;
  }
  function power(): Node {
    const a = unary();
    if (isOp("^")) { const at = toks[p++]!.at; return { k: "bin", op: "^", a, b: power(), at }; }
    return a;
  }
  function unary(): Node {
    if (isOp("-") || isOp("+")) { const t = toks[p++]!; return { k: "un", op: t.v as "-" | "+", a: unary(), at: t.at }; }
    return primary();
  }
  function primary(): Node {
    const t = peek();
    if (!t) throw new ParseError("The formula stops too soon", text.length, text.length);
    if (t.t === "num") { p++; return { k: "num", v: t.v, at: t.at }; }
    if (t.t === "str") { p++; return { k: "str", v: t.v, at: t.at }; }
    if (t.t === "col") { p++; return column(t.v, t.at, t.end); }
    if (t.t === "op" && t.v === "(") {
      p++;
      const inner = compare();
      expect(")", "a closing )");
      return inner;
    }
    if (t.t === "id") {
      p++;
      const name = t.v.toUpperCase();
      if (name === "TRUE" || name === "FALSE") return { k: "bool", v: name === "TRUE", at: t.at };
      if (!isOp("(")) {
        const asColumn = lower.indexOf(t.v.toLowerCase());
        throw new ParseError(
          asColumn >= 0 ? `Put column names in brackets: [${columns[asColumn]!.name}]` : FUNCTIONS[name] ? `${name} needs brackets: ${FUNCTIONS[name]!.sig}` : `Unknown name “${t.v}”. Columns go in brackets, e.g. [${t.v}]`,
          t.at,
          t.end,
        );
      }
      const spec = FUNCTIONS[name];
      if (!spec) {
        const near = fuzzyRank(Object.keys(FUNCTIONS), name, (f) => f)[0];
        throw new ParseError(`Unknown function ${t.v}${near ? `. Did you mean ${near}?` : ""}`, t.at, t.end);
      }
      p++;
      const args: Node[] = [];
      if (!isOp(")")) {
        args.push(compare());
        while (isOp(",")) { p++; args.push(compare()); }
      }
      expect(")", `a closing ) for ${name}`);
      if (WINDOW_FUNCTIONS.has(name) && args[0] !== undefined && args[0].k !== "col") {
        throw new ParseError(`${name} reads a whole column: ${spec.sig}`, t.at, t.end);
      }
      if (name === "IFS" && args.length % 2 !== 0) {
        throw new ParseError("IFS takes pairs of a test and a value: IFS(test1, value1, test2, value2, …)", t.at, t.end);
      }
      if (name === "BIN" && args[1] !== undefined && args[1].k !== "num") {
        throw new ParseError("BIN needs a count of bands as a number, e.g. BIN([Age], 5)", t.at, t.end);
      }
      if (args.length < spec.min || (spec.max >= 0 && args.length > spec.max)) {
        throw new ParseError(`${name} takes ${spec.min === spec.max ? spec.min : spec.max < 0 ? `${spec.min} or more` : `${spec.min} to ${spec.max}`} value${spec.max === 1 ? "" : "s"}: ${spec.sig}`, t.at, t.end);
      }
      return { k: "call", fn: name, args, at: t.at };
    }
    throw new ParseError(`Unexpected “${t.v}”`, t.at, t.end);
  }

  const root = compare();
  if (p < toks.length) {
    const t = toks[p]!;
    throw new ParseError(t.t === "op" && t.v === ")" ? "A ) without its (" : `Unexpected “${String(t.v)}”: an operator such as + or & may be missing`, t.at, t.end);
  }
  return root;
}

// ---------------------------------------------------------------- types

export function columnFType(type: ColumnType): FType {
  switch (type) {
    case "integer":
    case "number":
    case "duration":
    case "time":
      return "number";
    case "date":
      return "date";
    case "datetime":
      return "datetime";
    case "boolean":
      return "bool";
    default:
      return "text";
  }
}

const isDate = (t: FType): boolean => t === "date" || t === "datetime";

function unify(a: FType, b: FType): FType {
  if (a === b) return a;
  if (a === "any") return b;
  if (b === "any") return a;
  if (isDate(a) && isDate(b)) return "datetime";
  return "text";
}

export function typeOf(node: Node, columns: readonly FormulaColumnInfo[]): FType {
  switch (node.k) {
    case "num": return "number";
    case "str": return node.v === "" ? "any" : "text";
    case "bool": return "bool";
    case "col": return columnFType(columns[node.index]!.type);
    case "un": return "number";
    case "bin": {
      if (node.op === "&") return "text";
      if (COMPARE.has(node.op)) return "bool";
      const a = typeOf(node.a, columns), b = typeOf(node.b, columns);
      if (node.op === "-" && isDate(a) && isDate(b)) return "number";
      if ((node.op === "+" || node.op === "-") && isDate(a) && !isDate(b)) return a;
      if (node.op === "+" && isDate(b) && !isDate(a)) return b;
      return "number";
    }
    case "call": {
      const args = node.args.map((n) => typeOf(n, columns));
      switch (node.fn) {
        case "IF": return unify(args[1]!, args[2] ?? "any");
        case "AND": case "OR": case "NOT": case "CONTAINS": case "ISBLANK": case "EXACT": case "ISNUMBER": case "ISTEXT": return "bool";
        case "MIN": case "MAX": return args.every(isDate) ? args.reduce(unify) : "number";
        case "LEFT": case "RIGHT": case "MID": case "UPPER": case "LOWER": case "TRIM": case "CONCAT": return "text";
        case "TEXT": case "SUBSTITUTE": case "REPLACE": case "PROPER": case "TEXTBEFORE": case "TEXTAFTER": case "TEXTJOIN": return "text";
        case "DATE": case "TODAY": case "EDATE": case "EOMONTH": return "date";
        case "NOW": return "datetime";
        case "COALESCE": case "IFBLANK": case "IFERROR": return args.reduce(unify);
        case "IFS": return args.filter((_, i) => i % 2 === 1).reduce(unify);
        case "SWITCH": {
          // Results sit at 2, 4, …; one value past the pairs is the else.
          const results = args.filter((_, i) => i >= 2 && i % 2 === 0);
          if (args.length % 2 === 0) results.push(args[args.length - 1]!);
          return results.reduce(unify);
        }
        case "PREVIOUS": return args[0]!;
        default: return "number";
      }
    }
  }
}

/** Parses and type-checks a formula against the columns it may read. */
export function compileFormula(text: string, columns: readonly FormulaColumnInfo[]): Compiled {
  let ast: Node;
  try {
    ast = parse(text, columns);
  } catch (error) {
    if (error instanceof ParseError) return { ok: false, error: error.message, at: error.at, end: error.end };
    throw error;
  }
  const refs = new Set<number>();
  const walk = (n: Node): void => {
    if (n.k === "col") refs.add(n.index);
    else if (n.k === "un") walk(n.a);
    else if (n.k === "bin") { walk(n.a); walk(n.b); }
    else if (n.k === "call") n.args.forEach(walk);
  };
  walk(ast);
  const type = typeOf(ast, columns);
  return { ok: true, ast, type: type === "any" ? "text" : type, refs: [...refs].sort((a, b) => a - b) };
}

// ---------------------------------------------------------------- evaluation

/** What evaluation reads from a column (ColumnData satisfies it). */
export interface FormulaSource {
  readonly name: string;
  readonly type: ColumnType;
  readonly raw: readonly string[];
  readonly nullMask: { get(row: number): boolean };
  numbers(): Float64Array;
}

const DAY_MS = 86_400_000;
const TRUE_WORDS = new Set(["true", "yes", "y", "1", "t"]);
const FALSE_WORDS = new Set(["false", "no", "n", "0", "f"]);

type Fn = (row: number) => CellValue | CellError;

/** Numbers as text the way the app shows them: 15 significant digits, no trailing .0. */
export function numberText(v: number): string {
  if (!Number.isFinite(v)) return "";
  return String(Number(v.toPrecision(15)));
}

function dateText(ms: number, withTime: boolean): string {
  const iso = new Date(ms).toISOString();
  return withTime ? `${iso.slice(0, 10)} ${iso.slice(11, 19)}` : iso.slice(0, 10);
}

function asText(v: CellValue, t: FType): string {
  if (v === null) return "";
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (typeof v === "number") return isDate(t) ? dateText(v, t === "datetime" && v % DAY_MS !== 0) : numberText(v);
  return v;
}

function asNumber(v: CellValue): number | null | CellError {
  if (v === null) return null;
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  const t = v.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : new CellError(`“${t.length > 20 ? t.slice(0, 20) + "…" : t}” is not a number`);
}

const NUMBER_PLAIN = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/;
const NUMBER_GROUPED = /^[+-]?\d{1,3}(,\d{3})+(\.\d*)?$/;

/** VALUE: 1,234.5, 12% and $5 read as numbers; anything else is an error. The Python port is _value. */
function parseNumberText(s: string): number | CellError {
  let t = s.trim();
  let percent = false;
  if (t.endsWith("%")) {
    percent = true;
    t = t.slice(0, -1).trim();
  }
  t = t.replace(/^([+-]?)\s*[$€£]\s*/, "$1");
  if (NUMBER_GROUPED.test(t)) t = t.replace(/,/g, "");
  const x = NUMBER_PLAIN.test(t) ? Number(t) : Number.NaN;
  if (!Number.isFinite(x)) return new CellError(`“${s.length > 20 ? s.slice(0, 20) + "…" : s}” is not a number`);
  return percent ? x / 100 : x;
}

function asBool(v: CellValue): boolean {
  if (v === null) return false;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  return TRUE_WORDS.has(v.trim().toLowerCase());
}

/** Compiles the checked tree to closures over the columns' typed values. */
export function evaluator(ast: Node, columns: readonly FormulaSource[], now = Date.now()): Fn {
  const infos = columns.map((c) => ({ name: c.name, type: c.type }));
  const t = (n: Node): FType => typeOf(n, infos);

  const build = (n: Node): Fn => {
    switch (n.k) {
      case "num": { const v = n.v; return () => v; }
      case "str": { const v = n.v === "" ? null : n.v; return () => v; }
      case "bool": { const v = n.v; return () => v; }
      case "col": {
        const c = columns[n.index]!;
        const ft = columnFType(c.type);
        if (ft === "number" || isDate(ft)) {
          const nums = c.numbers();
          return (row) => { const v = nums[row]!; return Number.isFinite(v) ? v : null; };
        }
        if (ft === "bool") {
          return (row) => {
            if (c.nullMask.get(row)) return null;
            const s = (c.raw[row] ?? "").trim().toLowerCase();
            return TRUE_WORDS.has(s) ? true : FALSE_WORDS.has(s) ? false : null;
          };
        }
        return (row) => (c.nullMask.get(row) ? null : c.raw[row] ?? null);
      }
      case "un": {
        const a = build(n.a);
        return (row) => {
          const v = a(row);
          if (v instanceof CellError) return v;
          const x = asNumber(v);
          return x instanceof CellError || x === null ? x : n.op === "-" ? -x : x;
        };
      }
      case "bin": return buildBin(n);
      case "call": return buildCall(n);
    }
  };

  const buildBin = (n: Extract<Node, { k: "bin" }>): Fn => {
    const a = build(n.a), b = build(n.b);
    const ta = t(n.a), tb = t(n.b);
    if (n.op === "&") {
      return (row) => {
        const x = a(row), y = b(row);
        if (x instanceof CellError) return x;
        if (y instanceof CellError) return y;
        const s = asText(x, ta) + asText(y, tb);
        return s === "" ? null : s;
      };
    }
    if (COMPARE.has(n.op)) {
      const textual = (ta === "text" || tb === "text") && !(ta === "number" && tb === "number");
      const op = n.op;
      return (row) => {
        const x = a(row), y = b(row);
        if (x instanceof CellError) return x;
        if (y instanceof CellError) return y;
        if (x === null || y === null) return op === "<>";
        let cmp: number;
        if (textual) {
          const p = asText(x, ta).toLowerCase(), q = asText(y, tb).toLowerCase();
          cmp = p < q ? -1 : p > q ? 1 : 0;
        } else {
          const p = typeof x === "boolean" ? (x ? 1 : 0) : (asNumber(x) as number), q = typeof y === "boolean" ? (y ? 1 : 0) : (asNumber(y) as number);
          if (typeof p !== "number" || typeof q !== "number") return op === "<>";
          cmp = p < q ? -1 : p > q ? 1 : 0;
        }
        switch (op) {
          case "=": return cmp === 0;
          case "<>": return cmp !== 0;
          case "<": return cmp < 0;
          case "<=": return cmp <= 0;
          case ">": return cmp > 0;
          default: return cmp >= 0;
        }
      };
    }
    // Arithmetic; dates count in days.
    const op = n.op;
    const dateDiff = op === "-" && isDate(ta) && isDate(tb);
    const scaleB = (op === "+" || op === "-") && isDate(ta) && !isDate(tb) ? DAY_MS : 1;
    const scaleA = op === "+" && isDate(tb) && !isDate(ta) ? DAY_MS : 1;
    return (row) => {
      const xv = a(row), yv = b(row);
      if (xv instanceof CellError) return xv;
      if (yv instanceof CellError) return yv;
      const x = asNumber(xv), y = asNumber(yv);
      if (x instanceof CellError) return x;
      if (y instanceof CellError) return y;
      if (x === null || y === null) return null;
      switch (op) {
        case "+": return x * scaleA + y * scaleB;
        case "-": return dateDiff ? (x - y) / DAY_MS : x - y * scaleB;
        case "*": return x * y;
        case "/": return y === 0 ? new CellError("divide by zero") : x / y;
        default: {
          const r = Math.pow(x, y);
          return Number.isFinite(r) ? r : new CellError("the power is out of range");
        }
      }
    };
  };

  const buildCall = (n: Extract<Node, { k: "call" }>): Fn => {
    const fs = n.args.map(build);
    const ts = n.args.map(t);
    const num = (k: number, row: number): number | null | CellError => {
      const v = fs[k]!(row);
      return v instanceof CellError ? v : asNumber(v);
    };
    const text = (k: number, row: number): string | null | CellError => {
      const v = fs[k]!(row);
      if (v instanceof CellError) return v;
      return v === null ? null : asText(v, ts[k]!);
    };
    const date = (k: number, row: number): Date | null | CellError => {
      const v = num(k, row);
      return v instanceof CellError || v === null ? v : new Date(isDate(ts[k]!) ? v : v * DAY_MS);
    };
    const opt = (k: number, row: number, fallback: number): number | CellError => {
      if (fs[k] === undefined) return fallback;
      const v = num(k, row);
      return v instanceof CellError ? v : v === null ? fallback : v;
    };
    switch (n.fn) {
      case "IF":
        return (row) => {
          const c = fs[0]!(row);
          if (c instanceof CellError) return c;
          return asBool(c) ? fs[1]!(row) : fs[2] ? fs[2](row) : null;
        };
      case "AND":
      case "OR": {
        const all = n.fn === "AND";
        return (row) => {
          for (const f of fs) {
            const v = f(row);
            if (v instanceof CellError) return v;
            if (asBool(v) !== all) return !all;
          }
          return all;
        };
      }
      case "NOT":
        return (row) => { const v = fs[0]!(row); return v instanceof CellError ? v : !asBool(v); };
      case "ROUND":
        return (row) => {
          const x = num(0, row);
          const d = opt(1, row, 0);
          if (x instanceof CellError || x === null) return x;
          if (d instanceof CellError) return d;
          const f = Math.pow(10, Math.trunc(d));
          return (Math.sign(x) * Math.round(Math.abs(x) * f + 1e-9)) / f;
        };
      case "ABS":
        return (row) => { const x = num(0, row); return x instanceof CellError || x === null ? x : Math.abs(x); };
      case "MIN":
      case "MAX": {
        const max = n.fn === "MAX";
        return (row) => {
          let best: number | null = null;
          for (let k = 0; k < fs.length; k++) {
            const x = num(k, row);
            if (x instanceof CellError) return x;
            if (x !== null && (best === null || (max ? x > best : x < best))) best = x;
          }
          return best;
        };
      }
      case "LEN":
        return (row) => { const s = text(0, row); return s instanceof CellError ? s : s === null ? 0 : [...s].length; };
      case "LEFT":
      case "RIGHT":
        return (row) => {
          const s = text(0, row), k = opt(1, row, 1);
          if (s instanceof CellError || s === null) return s;
          if (k instanceof CellError) return k;
          if (k < 0) return new CellError(`${n.fn} needs a count of 0 or more`);
          const chars = [...s];
          const out = n.fn === "LEFT" ? chars.slice(0, Math.trunc(k)) : chars.slice(Math.max(0, chars.length - Math.trunc(k)));
          return out.length ? out.join("") : null;
        };
      case "MID":
        return (row) => {
          const s = text(0, row), st = num(1, row), k = num(2, row);
          if (s instanceof CellError || s === null) return s;
          if (st instanceof CellError) return st;
          if (k instanceof CellError) return k;
          if (st === null || k === null || st < 1 || k < 0) return new CellError("MID needs a start of 1 or more and a count of 0 or more");
          const out = [...s].slice(Math.trunc(st) - 1, Math.trunc(st) - 1 + Math.trunc(k)).join("");
          return out === "" ? null : out;
        };
      case "FIND":
        return (row) => {
          const needle = text(0, row), hay = text(1, row), st = opt(2, row, 1);
          if (needle instanceof CellError) return needle;
          if (hay instanceof CellError) return hay;
          if (st instanceof CellError) return st;
          if (hay === null) return null;
          const at = [...hay].join("").indexOf(needle ?? "", Math.max(0, Math.trunc(st) - 1));
          return at < 0 ? new CellError(`“${needle ?? ""}” not found`) : at + 1;
        };
      case "UPPER":
      case "LOWER":
      case "TRIM": {
        const fn = n.fn;
        return (row) => {
          const s = text(0, row);
          if (s instanceof CellError || s === null) return s;
          const out = fn === "UPPER" ? s.toUpperCase() : fn === "LOWER" ? s.toLowerCase() : s.replace(/ +/g, " ").trim();
          return out === "" ? null : out;
        };
      }
      case "CONCAT":
        return (row) => {
          let s = "";
          for (let k = 0; k < fs.length; k++) {
            const part = text(k, row);
            if (part instanceof CellError) return part;
            s += part ?? "";
          }
          return s === "" ? null : s;
        };
      case "CONTAINS":
        return (row) => {
          const s = text(0, row), f = text(1, row);
          if (s instanceof CellError) return s;
          if (f instanceof CellError) return f;
          return s !== null && s.toLowerCase().includes((f ?? "").toLowerCase());
        };
      case "YEAR":
      case "MONTH":
      case "DAY": {
        const fn = n.fn;
        return (row) => {
          const d = date(0, row);
          if (d instanceof CellError || d === null) return d;
          return fn === "YEAR" ? d.getUTCFullYear() : fn === "MONTH" ? d.getUTCMonth() + 1 : d.getUTCDate();
        };
      }
      case "WEEKDAY":
        return (row) => {
          const d = date(0, row), kind = opt(1, row, 1);
          if (d instanceof CellError || d === null) return d;
          if (kind instanceof CellError) return kind;
          const w = d.getUTCDay(); // 0 = Sunday
          if (kind === 2) return w === 0 ? 7 : w;
          if (kind === 3) return (w + 6) % 7;
          if (kind === 1) return w + 1;
          return new CellError("WEEKDAY type is 1, 2 or 3");
        };
      case "DATEDIF":
        return (row) => {
          const a = date(0, row), b = date(1, row), u = text(2, row);
          if (a instanceof CellError || a === null) return a;
          if (b instanceof CellError || b === null) return b;
          if (u instanceof CellError) return u;
          if (a.getTime() > b.getTime()) return new CellError("DATEDIF start is after the end");
          const unit = (u ?? "").toLowerCase();
          if (unit === "d") return Math.floor((b.getTime() - a.getTime()) / DAY_MS);
          let months = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
          if (b.getUTCDate() < a.getUTCDate()) months--;
          if (unit === "m") return months;
          if (unit === "y") return Math.floor(months / 12);
          return new CellError('DATEDIF unit is "d", "m" or "y"');
        };
      case "DATE":
        return (row) => {
          const y = num(0, row), m = num(1, row), d = num(2, row);
          for (const v of [y, m, d]) if (v instanceof CellError || v === null) return v as CellError | null;
          return Date.UTC(Math.trunc(y as number), Math.trunc(m as number) - 1, Math.trunc(d as number));
        };
      case "TODAY": {
        const today = Math.floor(now / DAY_MS) * DAY_MS;
        return () => today;
      }
      case "ROWNUMBER":
        return (row) => row + 1;
      case "RANK":
      case "PERCENTOFTOTAL":
      case "RUNNINGSUM":
      case "PREVIOUS":
      case "COLUMNMEAN":
      case "COLUMNMEDIAN":
      case "COLUMNSTDEV":
      case "BIN": {
        // Worked out over every row on first use, then read by row.
        let values: (CellValue | CellError)[] | null = null;
        const rowCount = columns[0]?.raw.length ?? 0;
        const count = n.fn === "BIN" ? (n.args[1] as { v: number }).v : 0;
        return (row) => {
          if (values === null) {
            const read: CellValue[] = [];
            for (let i = 0; i < rowCount; i++) { const v = fs[0]!(i); read.push(v instanceof CellError ? null : v); }
            values = windowValues(n.fn, read, count);
          }
          return values[row] ?? null;
        };
      }
      case "TEXT":
        return (row) => {
          const v = fs[0]!(row), f = text(1, row);
          if (v instanceof CellError) return v;
          if (f instanceof CellError) return f;
          if (v === null || f === null) return null;
          if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
          if (typeof v === "string") return v;
          const r = formatForText(v, f, isDate(ts[0]!), numberText);
          return r.ok ? (r.text === "" ? null : r.text) : new CellError(r.reason);
        };
      case "VALUE":
        return (row) => {
          const s = text(0, row);
          return s instanceof CellError || s === null ? s : parseNumberText(s);
        };
      case "SUBSTITUTE":
        return (row) => {
          const s = text(0, row), from = text(1, row), to = text(2, row);
          const which = fs[3] === undefined ? 0 : num(3, row);
          if (s instanceof CellError || s === null) return s;
          if (from instanceof CellError) return from;
          if (to instanceof CellError) return to;
          if (which instanceof CellError) return which;
          if (from === null) return s;
          let out: string;
          if (fs[3] === undefined) {
            out = s.split(from).join(to ?? "");
          } else {
            if (which === null || which < 1) return new CellError("SUBSTITUTE needs an instance of 1 or more");
            let at = -1, next = 0;
            for (let c = 0; c < Math.trunc(which); c++) {
              at = s.indexOf(from, next);
              if (at < 0) break;
              next = at + from.length;
            }
            out = at < 0 ? s : s.slice(0, at) + (to ?? "") + s.slice(at + from.length);
          }
          return out === "" ? null : out;
        };
      case "REPLACE":
        return (row) => {
          const s = text(0, row), st = num(1, row), k = num(2, row), to = text(3, row);
          if (s instanceof CellError || s === null) return s;
          if (st instanceof CellError) return st;
          if (k instanceof CellError) return k;
          if (to instanceof CellError) return to;
          if (st === null || k === null || st < 1 || k < 0) return new CellError("REPLACE needs a start of 1 or more and a count of 0 or more");
          const chars = [...s];
          const out = chars.slice(0, Math.trunc(st) - 1).join("") + (to ?? "") + chars.slice(Math.trunc(st) - 1 + Math.trunc(k)).join("");
          return out === "" ? null : out;
        };
      case "PROPER":
        return (row) => {
          const s = text(0, row);
          if (s instanceof CellError || s === null) return s;
          return s.toLowerCase().replace(/(\p{L})(\p{L}*)/gu, (_, first: string, rest: string) => first.toUpperCase() + rest);
        };
      case "SEARCH":
        return (row) => {
          const needle = text(0, row), hay = text(1, row), st = opt(2, row, 1);
          if (needle instanceof CellError) return needle;
          if (hay instanceof CellError) return hay;
          if (st instanceof CellError) return st;
          if (hay === null) return null;
          const at = hay.toLowerCase().indexOf((needle ?? "").toLowerCase(), Math.max(0, Math.trunc(st) - 1));
          return at < 0 ? new CellError(`“${needle ?? ""}” not found`) : at + 1;
        };
      case "EXACT":
        return (row) => {
          const a = text(0, row), b = text(1, row);
          if (a instanceof CellError) return a;
          if (b instanceof CellError) return b;
          return (a ?? "") === (b ?? "");
        };
      case "TEXTBEFORE":
      case "TEXTAFTER": {
        const before = n.fn === "TEXTBEFORE";
        return (row) => {
          const s = text(0, row), d = text(1, row), which = opt(2, row, 1);
          if (s instanceof CellError) return s;
          if (d instanceof CellError) return d;
          if (which instanceof CellError) return which;
          if (s === null) return null;
          if (d === null) return new CellError(`${n.fn} needs a delimiter`);
          const k = Math.trunc(which);
          if (k === 0) return new CellError(`${n.fn} needs an instance other than 0`);
          let at = -1;
          if (k > 0) {
            let next = 0;
            for (let c = 0; c < k; c++) {
              at = s.indexOf(d, next);
              if (at < 0) break;
              next = at + d.length;
            }
          } else {
            // From the end, one match after another that does not overlap the last.
            at = s.lastIndexOf(d);
            for (let c = 1; c < -k && at >= 0; c++) at = at - d.length >= 0 ? s.lastIndexOf(d, at - d.length) : -1;
          }
          if (at < 0) return new CellError(`“${d}” not found`);
          const out = before ? s.slice(0, at) : s.slice(at + d.length);
          return out === "" ? null : out;
        };
      }
      case "TEXTJOIN":
        return (row) => {
          const d = text(0, row), skipValue = fs[1]!(row);
          if (d instanceof CellError) return d;
          if (skipValue instanceof CellError) return skipValue;
          const skip = asBool(skipValue);
          const parts: string[] = [];
          for (let k = 2; k < fs.length; k++) {
            const part = text(k, row);
            if (part instanceof CellError) return part;
            if (part === null && skip) continue;
            parts.push(part ?? "");
          }
          const out = parts.join(d ?? "");
          return out === "" ? null : out;
        };
      case "INT":
        return (row) => { const x = num(0, row); return x instanceof CellError || x === null ? x : Math.floor(x); };
      case "TRUNC":
      case "ROUNDDOWN":
      case "ROUNDUP": {
        const up = n.fn === "ROUNDUP";
        return (row) => {
          const x = num(0, row), d = opt(1, row, 0);
          if (x instanceof CellError || x === null) return x;
          if (d instanceof CellError) return d;
          const f = Math.pow(10, Math.trunc(d));
          const scaled = Math.abs(x) * f;
          return (Math.sign(x) * (up ? Math.ceil(scaled - 1e-9) : Math.floor(scaled + 1e-9))) / f;
        };
      }
      case "MOD":
        return (row) => {
          const a = num(0, row), b = num(1, row);
          if (a instanceof CellError) return a;
          if (b instanceof CellError) return b;
          if (a === null || b === null) return null;
          return b === 0 ? new CellError("divide by zero") : a - b * Math.floor(a / b);
        };
      case "SQRT":
        return (row) => {
          const x = num(0, row);
          if (x instanceof CellError || x === null) return x;
          return x < 0 ? new CellError("SQRT needs a number of 0 or more") : Math.sqrt(x);
        };
      case "POWER":
        return (row) => {
          const a = num(0, row), b = num(1, row);
          if (a instanceof CellError) return a;
          if (b instanceof CellError) return b;
          if (a === null || b === null) return null;
          const r = Math.pow(a, b);
          return Number.isFinite(r) ? r : new CellError("the power is out of range");
        };
      case "LN":
        return (row) => {
          const x = num(0, row);
          if (x instanceof CellError || x === null) return x;
          return x > 0 ? Math.log(x) : new CellError("LN needs a number above 0");
        };
      case "CEILING":
      case "FLOOR": {
        const up = n.fn === "CEILING";
        return (row) => {
          const x = num(0, row), m = opt(1, row, 1);
          if (x instanceof CellError || x === null) return x;
          if (m instanceof CellError) return m;
          if (m === 0 || x === 0) return 0;
          if (x > 0 && m < 0) return new CellError(`${n.fn} needs a positive multiple for a positive number`);
          return up ? Math.ceil(x / m - 1e-9) * m : Math.floor(x / m + 1e-9) * m;
        };
      }
      case "SUM":
      case "AVERAGE": {
        const mean = n.fn === "AVERAGE";
        return (row) => {
          let total = 0, count = 0;
          for (let k = 0; k < fs.length; k++) {
            const x = num(k, row);
            if (x instanceof CellError) return x;
            if (x !== null) { total += x; count++; }
          }
          if (!mean) return total;
          return count === 0 ? new CellError("AVERAGE needs at least one number") : total / count;
        };
      }
      case "IFS":
        return (row) => {
          for (let k = 0; k + 1 < fs.length; k += 2) {
            const c = fs[k]!(row);
            if (c instanceof CellError) return c;
            if (asBool(c)) return fs[k + 1]!(row);
          }
          return new CellError("IFS: no test is true");
        };
      case "SWITCH": {
        // Each match is the same comparison as =, so text ignores case and numbers compare as numbers.
        const matches: Fn[] = [];
        for (let k = 1; k + 1 < n.args.length; k += 2) matches.push(buildBin({ k: "bin", op: "=", a: n.args[0]!, b: n.args[k]!, at: n.at }));
        const hasElse = n.args.length % 2 === 0;
        return (row) => {
          for (let i = 0; i < matches.length; i++) {
            const m = matches[i]!(row);
            if (m instanceof CellError) return m;
            if (m === true) return fs[2 + 2 * i]!(row);
          }
          return hasElse ? fs[fs.length - 1]!(row) : new CellError("SWITCH: no case matches");
        };
      }
      case "IFERROR":
        return (row) => { const v = fs[0]!(row); return v instanceof CellError ? fs[1]!(row) : v; };
      case "ISNUMBER":
        return (row) => typeof fs[0]!(row) === "number";
      case "ISTEXT":
        return (row) => typeof fs[0]!(row) === "string";
      case "HOUR":
      case "MINUTE":
      case "SECOND": {
        const fn = n.fn;
        return (row) => {
          const d = date(0, row);
          if (d instanceof CellError || d === null) return d;
          return fn === "HOUR" ? d.getUTCHours() : fn === "MINUTE" ? d.getUTCMinutes() : d.getUTCSeconds();
        };
      }
      case "EDATE":
      case "EOMONTH": {
        const end = n.fn === "EOMONTH";
        return (row) => {
          const d = date(0, row), m = num(1, row);
          if (d instanceof CellError || d === null) return d;
          if (m instanceof CellError) return m;
          if (m === null) return null;
          const total = d.getUTCFullYear() * 12 + d.getUTCMonth() + Math.trunc(m);
          const year = Math.floor(total / 12), month = total - year * 12;
          const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
          return end ? Date.UTC(year, month, last) : Date.UTC(year, month, Math.min(d.getUTCDate(), last));
        };
      }
      case "WEEKNUM":
        return (row) => {
          const d = date(0, row), kind = opt(1, row, 1);
          if (d instanceof CellError || d === null) return d;
          if (kind instanceof CellError) return kind;
          if (kind === 21) return isoWeek(d.getTime());
          if (kind !== 1 && kind !== 2) return new CellError("WEEKNUM type is 1, 2 or 21");
          const year = d.getUTCFullYear();
          const dayOfYear = Math.floor((Date.UTC(year, d.getUTCMonth(), d.getUTCDate()) - Date.UTC(year, 0, 1)) / DAY_MS);
          const jan1 = (new Date(Date.UTC(year, 0, 1)).getUTCDay() - (kind === 1 ? 0 : 1) + 7) % 7;
          return Math.floor((dayOfYear + jan1) / 7) + 1;
        };
      case "DAYS":
        return (row) => {
          const e = date(0, row), b = date(1, row);
          if (e instanceof CellError || e === null) return e;
          if (b instanceof CellError || b === null) return b;
          return Math.floor(e.getTime() / DAY_MS) - Math.floor(b.getTime() / DAY_MS);
        };
      case "NOW": {
        const stamp = Math.floor(now);
        return () => stamp;
      }
      case "ISBLANK":
        return (row) => { const v = fs[0]!(row); return v instanceof CellError ? v : v === null || v === ""; };
      case "COALESCE":
      case "IFBLANK":
        return (row) => {
          for (const f of fs) {
            const v = f(row);
            if (v instanceof CellError) return v;
            if (v !== null && v !== "") return v;
          }
          return null;
        };
    }
    return () => new CellError(`${n.fn} is not available`);
  };

  return build(ast);
}

/**
 * A whole-column function over the column's values in stored order. The pandas and
 * Polars recipes port this exactly (formula-export.ts, _window).
 */
export function windowValues(fn: string, values: readonly CellValue[], count = 0): (CellValue | CellError)[] {
  const nums = values.map((v) => { const x = asNumber(v); return x instanceof CellError ? null : x; });
  switch (fn) {
    case "PREVIOUS":
      return values.map((_, i) => (i === 0 ? null : values[i - 1] ?? null));
    case "RUNNINGSUM": {
      let total = 0;
      return nums.map((x) => (x === null ? null : (total += x)));
    }
    case "PERCENTOFTOTAL": {
      const total = nums.reduce<number>((s, x) => s + (x ?? 0), 0);
      return nums.map((x) => (x === null ? null : total === 0 ? new CellError("divide by zero") : (x / total) * 100));
    }
    case "RANK": {
      const sorted = nums.filter((x): x is number => x !== null).sort((a, b) => b - a);
      const first = new Map<number, number>();
      sorted.forEach((x, i) => { if (!first.has(x)) first.set(x, i + 1); });
      return nums.map((x) => (x === null ? null : first.get(x)!));
    }
    case "COLUMNMEAN":
    case "COLUMNMEDIAN":
    case "COLUMNSTDEV": {
      const present = nums.filter((x): x is number => x !== null);
      if (present.length === 0) return nums.map(() => null);
      let total = 0;
      for (const x of present) total += x;
      const mean = total / present.length;
      let result: number | CellError;
      if (fn === "COLUMNMEAN") result = mean;
      else if (fn === "COLUMNMEDIAN") {
        const sorted = [...present].sort((a, b) => a - b);
        const mid = sorted.length >> 1;
        result = sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
      } else if (present.length < 2) result = new CellError("COLUMNSTDEV needs at least two values");
      else {
        let squares = 0;
        for (const x of present) squares += (x - mean) * (x - mean);
        result = Math.sqrt(squares / (present.length - 1));
      }
      return nums.map(() => result);
    }
    case "BIN": {
      const present = nums.filter((x): x is number => x !== null);
      if (count < 1) return nums.map(() => new CellError("BIN needs a count of 1 or more"));
      // A loop, not Math.min(...values): a million arguments would overflow the stack.
      let lo = Infinity, hi = -Infinity;
      for (const x of present) { if (x < lo) lo = x; if (x > hi) hi = x; }
      const width = (hi - lo) / Math.trunc(count);
      return nums.map((x) => (x === null ? null : width === 0 ? 1 : Math.max(1, Math.ceil((x - lo) / width))));
    }
  }
  return values.map(() => new CellError(`${fn} is not available`));
}

/** The new column's type for the app, from the formula's result type. */
export function outputColumnType(type: FType, values: readonly CellValue[] | null = null): ColumnType {
  switch (type) {
    case "number":
      return values !== null && values.every((v) => v === null || (typeof v === "number" && Number.isInteger(v))) ? "integer" : "number";
    case "date": return "date";
    case "datetime": return "datetime";
    case "bool": return "boolean";
    default: return "string";
  }
}

export interface FormulaResult {
  /** Cell text per row ("" for blank or error). */
  raw: string[];
  type: ColumnType;
  /** Rows whose cell is an error, by reason. */
  errors: Map<string, number>;
  errorCount: number;
  blanks: number;
}

/** Evaluates a compiled formula over rows [0, rowCount) (or the listed rows). */
export function evaluateFormula(
  compiled: Extract<Compiled, { ok: true }>,
  columns: readonly FormulaSource[],
  rowCount: number,
  rows: readonly number[] | null = null,
  now = Date.now(),
): FormulaResult {
  const f = evaluator(compiled.ast, columns, now);
  const n = rows === null ? rowCount : rows.length;
  const raw = new Array<string>(n);
  const errors = new Map<string, number>();
  let errorCount = 0, blanks = 0, allIntegers = true;
  for (let k = 0; k < n; k++) {
    const v = f(rows === null ? k : rows[k]!);
    if (v instanceof CellError) {
      errorCount++;
      errors.set(v.reason, (errors.get(v.reason) ?? 0) + 1);
      raw[k] = "";
      continue;
    }
    if (v === null || v === "") { blanks++; raw[k] = ""; continue; }
    if (typeof v === "number" && !Number.isInteger(v)) allIntegers = false;
    raw[k] = asText(v, compiled.type);
  }
  const type = compiled.type === "number" ? (allIntegers ? "integer" : "number") : outputColumnType(compiled.type);
  return { raw, type, errors, errorCount, blanks };
}

/** Rewrites the formula's column names after a rename; text in quotes is left alone. */
export function renameInFormula(text: string, from: string, to: string): string {
  const target = from.trim().toLowerCase();
  const replacement = `[${to.replace(/]/g, "]]")}]`;
  let out = "";
  for (let i = 0; i < text.length; ) {
    const ch = text[i]!;
    if (ch === '"') {
      // Copy a quoted text as it is ("" is a quote inside it).
      let j = i + 1;
      while (j < text.length && !(text[j] === '"' && text[j + 1] !== '"')) j += text[j] === '"' ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j + 1;
    } else if (ch === "[") {
      let j = i + 1, name = "";
      while (j < text.length && !(text[j] === "]" && text[j + 1] !== "]")) {
        name += text[j] === "]" ? "]" : text[j];
        j += text[j] === "]" ? 2 : 1;
      }
      out += name.trim().toLowerCase() === target ? replacement : text.slice(i, j + 1);
      i = j + 1;
    } else {
      out += ch;
      i++;
    }
  }
  return out;
}

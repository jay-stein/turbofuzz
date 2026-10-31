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
};

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
  while (i < text.length) {
    const ch = text[i]!;
    if (/\s/.test(ch)) { i++; continue; }
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
        case "AND": case "OR": case "NOT": case "CONTAINS": case "ISBLANK": return "bool";
        case "MIN": case "MAX": return args.every(isDate) ? args.reduce(unify) : "number";
        case "LEFT": case "RIGHT": case "MID": case "UPPER": case "LOWER": case "TRIM": case "CONCAT": return "text";
        case "DATE": case "TODAY": return "date";
        case "COALESCE": case "IFBLANK": return args.reduce(unify);
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

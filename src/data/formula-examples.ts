/**
 * New column "from examples" (Power Query's Column From Examples, Excel's Flash Fill):
 * the person types the result for a few rows, and the formulas that give exactly those
 * results are found by trying a small, ordered set of rules, simplest first. The answer
 * is an ordinary formula the person can read and edit.
 */

import { compileFormula, evaluateFormula, type FormulaColumnInfo, type FormulaSource } from "./column-formula.js";

const DELIMITERS = [" ", ",", "@", "-", "/", ".", "_", ":", ";"];
const SEPARATORS = ["", " ", ", ", "-", "_", "/", " - ", ": "];
/** Columns tried in pairs (the first ones, to keep the search quick on wide tables). */
const PAIR_COLUMNS = 14;

const ref = (name: string): string => `[${name.replace(/]/g, "]]")}]`;
const quote = (v: string): string => `"${v.replace(/"/g, '""')}"`;

/** Candidate formulas over the columns, simplest first. */
export function candidateFormulas(columns: readonly FormulaColumnInfo[]): string[] {
  const out: string[] = [];
  const isNum = (t: string): boolean => t === "integer" || t === "number";
  const isDate = (t: string): boolean => t === "date" || t === "datetime";
  for (const c of columns) {
    const r = ref(c.name);
    out.push(r);
    if (isDate(c.type)) {
      out.push(`YEAR(${r})`, `MONTH(${r})`, `DAY(${r})`, `WEEKDAY(${r}, 2)`);
      continue;
    }
    if (isNum(c.type)) {
      out.push(`ROUND(${r})`, `ROUND(${r}, 1)`, `ROUND(${r}, 2)`, `ABS(${r})`);
    }
    out.push(`UPPER(${r})`, `LOWER(${r})`, `TRIM(${r})`, `LEN(${r})`);
    for (const d of DELIMITERS) {
      out.push(`LEFT(${r}, FIND(${quote(d)}, ${r}) - 1)`, `MID(${r}, FIND(${quote(d)}, ${r}) + 1, 1000)`);
    }
    for (let k = 1; k <= 8; k++) out.push(`LEFT(${r}, ${k})`, `RIGHT(${r}, ${k})`);
    for (const d of DELIMITERS) out.push(`UPPER(LEFT(${r}, FIND(${quote(d)}, ${r}) - 1))`, `LOWER(MID(${r}, FIND(${quote(d)}, ${r}) + 1, 1000))`);
  }
  const pairs = columns.slice(0, PAIR_COLUMNS);
  for (const a of pairs) {
    for (const b of pairs) {
      if (a === b) continue;
      for (const sep of SEPARATORS) out.push(sep === "" ? `${ref(a.name)} & ${ref(b.name)}` : `${ref(a.name)} & ${quote(sep)} & ${ref(b.name)}`);
      if (isNum(a.type) && isNum(b.type)) {
        out.push(`${ref(a.name)} + ${ref(b.name)}`, `${ref(a.name)} - ${ref(b.name)}`, `${ref(a.name)} * ${ref(b.name)}`, `${ref(a.name)} / ${ref(b.name)}`);
      }
    }
  }
  return out;
}

/** The typed result and the formula's agree: same text, or the same number. */
function same(got: string, want: string): boolean {
  const g = got.trim(), w = want.trim();
  if (g === w) return true;
  const a = Number(g.replace(/,/g, "")), b = Number(w.replace(/,/g, ""));
  return g !== "" && w !== "" && Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b));
}

/**
 * Formulas that give every example (row index into the columns, wanted text), simplest
 * first, at most `limit`.
 */
export function formulasFromExamples(
  columns: readonly FormulaSource[],
  rowCount: number,
  examples: readonly { row: number; output: string }[],
  limit = 6,
): string[] {
  const wanted = examples.filter((e) => e.output.trim() !== "");
  if (wanted.length === 0) return [];
  const info = columns.map((c) => ({ name: c.name, type: c.type }));
  const rows = wanted.map((e) => e.row);
  const found: string[] = [];
  for (const formula of candidateFormulas(info)) {
    const compiled = compileFormula(formula, info);
    if (!compiled.ok) continue;
    const result = evaluateFormula(compiled, columns, rowCount, rows);
    if (wanted.every((e, k) => same(result.raw[k] ?? "", e.output))) {
      found.push(formula);
      if (found.length >= limit) break;
    }
  }
  return found;
}

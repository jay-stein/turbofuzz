import type { ColumnType } from "../../types.js";
import type { CompareColumn, CompareRules } from "./types.js";

/**
 * The family a pair of columns compares in: numbers and dates compare as
 * parsed values, everything else (or a mix of families) as text.
 */
export type CompareFamily = "number" | "date" | "time" | "duration" | "text";

function familyOf(type: ColumnType): CompareFamily {
  switch (type) {
    case "integer":
    case "number":
      return "number";
    case "date":
    case "datetime":
      return "date";
    case "time":
      return "time";
    case "duration":
      return "duration";
    default:
      return "text";
  }
}

export function pairFamily(a: CompareColumn, b: CompareColumn): CompareFamily {
  const fa = familyOf(a.type);
  return fa === familyOf(b.type) ? fa : "text";
}

/** Two spaces in a row, or a tab or line break: spacing the trim rule would change. */
const UNTIDY_SPACE = /\s\s|[\t\n\r\f\v ]/;

/** Text as the rules see it: spaces trimmed and collapsed, case folded. */
export function textForm(value: string, rules: CompareRules): string {
  let out = value;
  // Most values need no trimming: test before allocating a new string.
  if (rules.trimSpaces && out !== "" && (out.charCodeAt(0) <= 32 || out.charCodeAt(out.length - 1) <= 32 || UNTIDY_SPACE.test(out))) {
    out = out.trim().replace(/\s+/g, " ");
  }
  if (rules.ignoreCase) out = out.toLowerCase();
  return out;
}

export function numbersEqual(x: number, y: number, rules: CompareRules): boolean {
  if (x === y) return true;
  const diff = Math.abs(x - y);
  if (diff <= rules.numberAbs) return true;
  return rules.numberRel > 0 && diff <= rules.numberRel * Math.max(Math.abs(x), Math.abs(y));
}

/** A cell comparison for one column pair: true when row aRow of A equals row bRow of B under the rules. */
export function cellComparer(
  a: CompareColumn,
  b: CompareColumn,
  rules: CompareRules,
): (aRow: number, bRow: number) => boolean {
  const family = pairFamily(a, b);
  const aNums = family === "text" ? null : a.numbers();
  const bNums = family === "text" ? null : b.numbers();
  // Numbers use the tolerance; dates, times and durations must agree exactly.
  const numberRules: CompareRules = family === "number" ? rules : { ...rules, numberAbs: 0, numberRel: 0 };
  const aRaw = a.raw;
  const bRaw = b.raw;
  return (aRow, bRow) => {
    const aEmpty = a.isEmpty(aRow);
    const bEmpty = b.isEmpty(bRow);
    if (aEmpty || bEmpty) return aEmpty && bEmpty && rules.emptyEqualsEmpty;
    const av = aRaw[aRow];
    const bv = bRaw[bRow];
    if (av === bv) return true;
    if (aNums !== null && bNums !== null) {
      const x = aNums[aRow];
      const y = bNums[bRow];
      if (x === x && y === y) return numbersEqual(x, y, numberRules);
    }
    return textForm(av, rules) === textForm(bv, rules);
  };
}

/**
 * The value a cell contributes to a row key: parsed numbers and dates as
 * their canonical number, text as the rules see it; null when empty.
 * Keys never use the number tolerance.
 */
export function keyTokenizer(
  column: CompareColumn,
  family: CompareFamily,
  rules: CompareRules,
): (row: number) => string | null {
  const nums = family === "text" ? null : column.numbers();
  const raw = column.raw;
  return (row) => {
    if (column.isEmpty(row)) return null;
    if (nums !== null) {
      const value = nums[row];
      if (value === value) return String(value);
    }
    return textForm(raw[row], rules);
  };
}

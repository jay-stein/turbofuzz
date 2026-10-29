import { BitSet } from "../search/bitset.js";
import type { ColumnData } from "./column.js";
import type { ColumnMeta } from "../worker/protocol.js";

export type PairOperator = "gte" | "gt" | "eq" | "approx";

export interface PairCheckResult {
  /** Rows where both values are present and the comparison fails. */
  violationBits: BitSet;
  violations: number;
  /** Rows where both values are present (null on either side is N.A.). */
  compared: number;
}

/**
 * Cross-column consistency: compares two typed columns row by row and flags
 * failures. Numeric and date columns both work — date columns carry epoch ms
 * in numbers(), so "delivery ≥ order" compares instants, not strings. Rows
 * with a missing value on either side are N.A. and never flagged.
 */
export function computePairViolations(
  columns: readonly ColumnData[],
  columnA: number,
  columnB: number,
  operator: PairOperator,
  tolerance: number,
  rowCount: number,
): PairCheckResult {
  const violationBits = new BitSet(rowCount);
  const a = columns[columnA];
  const b = columns[columnB];
  if (a === undefined || b === undefined) {
    return { violationBits, violations: 0, compared: 0 };
  }
  const left = a.numbers();
  const right = b.numbers();
  let violations = 0;
  let compared = 0;
  for (let row = 0; row < rowCount; row++) {
    const x = left[row];
    const y = right[row];
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    compared++;
    let fails: boolean;
    switch (operator) {
      case "gte":
        fails = !(x >= y);
        break;
      case "gt":
        fails = !(x > y);
        break;
      case "eq":
        fails = x !== y;
        break;
      case "approx":
        fails = Math.abs(x - y) > tolerance;
        break;
    }
    if (fails) {
      violationBits.set(row);
      violations++;
    }
  }
  return { violationBits, violations, compared };
}

export interface SuggestedPair {
  /** The column that should be greater than or equal to `b`. */
  a: number;
  b: number;
  operator: PairOperator;
  label: string;
}

/** [later, earlier] name stems: the first should never be below the second. */
const PAIR_STEMS: readonly (readonly [string, string])[] = [
  ["end", "start"],
  ["updated", "created"],
  ["to", "from"],
  ["close", "open"],
  ["max", "min"],
  ["modified", "created"],
  ["finish", "start"],
];

const words = (name: string): string[] =>
  name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

const FAMILY: Record<string, string> = {
  date: "time",
  datetime: "time",
  integer: "number",
  number: "number",
};

/**
 * Consistency checks worth proposing from column names alone: end after start,
 * updated after created, max above min. Both columns must be typed and in the same
 * family (dates with dates, numbers with numbers) and share the rest of their name
 * ("order_start" / "order_end"). Never searches combinations beyond name pairs.
 */
export function suggestPairs(metas: readonly ColumnMeta[]): SuggestedPair[] {
  const out: SuggestedPair[] = [];
  const split = metas.map((meta) => words(meta.name));
  for (const [later, earlier] of PAIR_STEMS) {
    metas.forEach((hi, a) => {
      const wa = split[a];
      if (wa === undefined || !wa.includes(later) || FAMILY[hi.type] === undefined) return;
      const rest = wa.filter((w) => w !== later).join(" ");
      metas.forEach((lo, b) => {
        if (a === b || FAMILY[lo.type] !== FAMILY[hi.type]) return;
        const wb = split[b];
        if (wb === undefined || !wb.includes(earlier)) return;
        if (wb.filter((w) => w !== earlier).join(" ") !== rest) return;
        if (out.some((pair) => pair.a === a && pair.b === b)) return;
        out.push({ a, b, operator: "gte", label: `“${hi.name}” ≥ “${lo.name}”` });
      });
    });
  }
  return out.slice(0, 4);
}

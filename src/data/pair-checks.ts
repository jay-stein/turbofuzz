import { BitSet } from "../search/bitset.js";
import type { ColumnData } from "./column.js";

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

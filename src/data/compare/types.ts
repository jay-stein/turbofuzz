import type { BitSet } from "../../search/bitset.js";
import type { ColumnType } from "../../types.js";
import type { ColumnData } from "../column.js";

/** One column of a side being compared: what the engine reads, nothing more. */
export interface CompareColumn {
  name: string;
  type: ColumnType;
  raw: readonly string[];
  /** True when the cell is empty (blank or a null token). */
  isEmpty(row: number): boolean;
  /** Parsed values (dates as epoch ms); NaN where a cell is empty or does not parse. Numeric-like types only. */
  numbers(): Float64Array;
}

export interface CompareSide {
  name: string;
  rowCount: number;
  columns: CompareColumn[];
}

/** How strictly two values must agree. */
export interface CompareRules {
  /** Numbers within this absolute difference are equal. */
  numberAbs: number;
  /** Numbers within this share of the larger magnitude are equal (0.01 = 1%). */
  numberRel: number;
  ignoreCase: boolean;
  /** Ignore leading and trailing spaces, and treat runs of spaces as one. */
  trimSpaces: boolean;
  /** Two empty cells are equal (otherwise they count as a change). */
  emptyEqualsEmpty: boolean;
}

export const DEFAULT_RULES: CompareRules = {
  numberAbs: 0,
  numberRel: 0,
  ignoreCase: false,
  trimSpaces: true,
  emptyEqualsEmpty: true,
};

/** A column present on both sides, by index into each side's columns. */
export interface ColumnPair {
  a: number;
  b: number;
  /** Matched by hand (a rename), not by name. */
  manual: boolean;
}

export interface ColumnPairing {
  pairs: ColumnPair[];
  /** Columns of A with no partner in B (removed), and of B with none in A (added). */
  onlyA: number[];
  onlyB: number[];
}

/** Row status in the aligned result. */
export const ROW_IDENTICAL = 0;
export const ROW_CHANGED = 1;
export const ROW_ONLY_A = 2;
export const ROW_ONLY_B = 3;

export interface MatchResult {
  /** "key" when rows matched on key columns, "content" when whole rows were matched. */
  mode: "key" | "content";
  /** Aligned rows in display order: the row in A and in B, -1 for a gap. */
  aRow: Int32Array;
  bRow: Int32Array;
  status: Uint8Array;
  /** Per column pair: which aligned rows have a changed cell there. */
  changed: BitSet[];
  counts: { identical: number; changed: number; onlyA: number; onlyB: number };
  /** Rows whose key repeats on that side (each extra copy counts once). */
  duplicateKeys: { a: number; b: number };
  /** Rows with an empty key cell on that side; they cannot be matched. */
  emptyKeys: { a: number; b: number };
}

/** Adapts a loaded column to the engine. */
export function compareColumn(column: ColumnData): CompareColumn {
  return {
    name: column.name,
    type: column.type,
    raw: column.raw,
    isEmpty: (row) => column.nullMask.get(row),
    numbers: () => column.numbers(),
  };
}

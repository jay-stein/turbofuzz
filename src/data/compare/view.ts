import { ROW_IDENTICAL, ROW_ONLY_A, ROW_ONLY_B, ROW_CHANGED, type ColumnPairing, type CompareSide, type MatchResult } from "./types.js";

/** Which aligned rows the side-by-side view shows; `pairs` narrows to rows where any of those column pairs changed (empty: no narrowing). */
export interface RowFilter {
  /** "differences" is every row that is not identical: changed, only in A or only in B. */
  show: "all" | "differences" | "changed" | "onlyA" | "onlyB" | "identical";
  pairs: readonly number[];
}

/** A slice of the filtered rows, ready to draw: each side's cells, the row status and the changed cells. */
export interface RowWindow {
  /** Index of the first row in the filtered list, and how many rows the filter holds. */
  start: number;
  total: number;
  /** Aligned positions and the row in A and in B (-1 for a gap). */
  positions: Int32Array;
  aRow: Int32Array;
  bRow: Int32Array;
  status: Uint8Array;
  /** Cells per row: the paired columns, then the columns only that side has; null for a gap. */
  a: (string[] | null)[];
  b: (string[] | null)[];
  /** rows × pairs: 1 where that pair's cell changed. */
  changed: Uint8Array;
}

const WANT: Record<RowFilter["show"], number> = {
  all: -1,
  differences: -2,
  changed: ROW_CHANGED,
  onlyA: ROW_ONLY_A,
  onlyB: ROW_ONLY_B,
  identical: ROW_IDENTICAL,
};

/** The aligned positions a filter keeps, in display order. */
export function filterPositions(match: MatchResult, filter: RowFilter): Int32Array {
  const want = WANT[filter.show];
  const bits = filter.pairs.map((pair) => match.changed[pair]).filter((set) => set !== undefined);
  const n = match.status.length;
  if (want === -1 && bits.length === 0) {
    const all = new Int32Array(n);
    for (let i = 0; i < n; i++) all[i] = i;
    return all;
  }
  const out = new Int32Array(n);
  let length = 0;
  for (let i = 0; i < n; i++) {
    if (want >= 0 && match.status[i] !== want) continue;
    if (want === -2 && match.status[i] === ROW_IDENTICAL) continue;
    if (bits.length > 0 && !bits.some((set) => set.get(i))) continue;
    out[length++] = i;
  }
  return out.slice(0, length);
}

/** Rows [start, end) of a filtered list, with each side's cells. */
export function rowWindow(
  a: CompareSide,
  b: CompareSide,
  pairing: ColumnPairing,
  match: MatchResult,
  positions: Int32Array,
  start: number,
  end: number,
): RowWindow {
  const from = Math.max(0, Math.min(start, positions.length));
  const to = Math.max(from, Math.min(end, positions.length));
  const size = to - from;
  const aColumns = [...pairing.pairs.map((pair) => a.columns[pair.a]!), ...pairing.onlyA.map((index) => a.columns[index]!)];
  const bColumns = [...pairing.pairs.map((pair) => b.columns[pair.b]!), ...pairing.onlyB.map((index) => b.columns[index]!)];
  const pairs = pairing.pairs.length;
  const window: RowWindow = {
    start: from,
    total: positions.length,
    positions: positions.slice(from, to),
    aRow: new Int32Array(size),
    bRow: new Int32Array(size),
    status: new Uint8Array(size),
    a: new Array(size),
    b: new Array(size),
    changed: new Uint8Array(size * pairs),
  };
  for (let i = 0; i < size; i++) {
    const at = positions[from + i]!;
    const ar = match.aRow[at]!;
    const br = match.bRow[at]!;
    window.aRow[i] = ar;
    window.bRow[i] = br;
    window.status[i] = match.status[at]!;
    window.a[i] = ar < 0 ? null : aColumns.map((column) => column.raw[ar] ?? "");
    window.b[i] = br < 0 ? null : bColumns.map((column) => column.raw[br] ?? "");
    for (let p = 0; p < pairs; p++) if (match.changed[p]!.get(at)) window.changed[i * pairs + p] = 1;
  }
  return window;
}

/**
 * The next (dir 1) or previous (dir -1) row after `from` in the filtered list
 * that is a difference (changed, only in A or only in B), or -1 when none.
 */
export function findDifference(match: MatchResult, positions: Int32Array, from: number, dir: 1 | -1): number {
  for (let i = from + dir; i >= 0 && i < positions.length; i += dir) {
    if (match.status[positions[i]!] !== ROW_IDENTICAL) return i;
  }
  return -1;
}

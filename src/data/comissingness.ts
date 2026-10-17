import type { BitSet } from "../search/bitset.js";

export interface CoMissingnessResult {
  /** Missing-cell count per candidate column. */
  nullCells: number[];
  /** Row-major K×K counts: pairs[i * K + j] = rows where i and j are both missing. */
  pairs: number[];
}

/**
 * Pairwise co-missingness counts over the current result order: one pass that
 * collects each row's null columns and increments their pairs. K is capped by
 * the caller (the UI only asks for columns that actually have nulls).
 */
export function coMissingness(
  masks: readonly BitSet[],
  rowCount: number,
  ids: Uint32Array,
): CoMissingnessResult {
  const k = masks.length;
  const nullCells = new Array<number>(k).fill(0);
  const pairs = new Array<number>(k * k).fill(0);
  if (k === 0) return { nullCells, pairs };
  const rowNulls: number[] = [];

  for (let position = 0; position < ids.length; position++) {
    const row = ids[position];
    if (row >= rowCount) continue;
    rowNulls.length = 0;
    for (let column = 0; column < k; column++) {
      if (masks[column].get(row)) rowNulls.push(column);
    }
    if (rowNulls.length === 0) continue;
    for (const a of rowNulls) {
      nullCells[a]++;
      const base = a * k;
      for (const b of rowNulls) pairs[base + b]++;
    }
  }
  return { nullCells, pairs };
}

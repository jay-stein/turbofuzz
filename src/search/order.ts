import type { Dataset } from "../data/dataset.js";
import type { BitSet } from "./bitset.js";
import { isNumericLikeType } from "../types.js";

/** How many rows at the end of each rank are empty (blank or junk text read as missing). */
const emptyTail = new WeakMap<Uint32Array, number>();

/**
 * Builds the ascending row order for a column. Cache and reverse for desc. Empty cells (blank, or
 * junk text such as "NA" read as missing) go after every value, and `orderIds` keeps them last in
 * both directions, so a sort always opens on real values.
 */
export function buildRank(dataset: Dataset, columnIndex: number): Uint32Array {
  const column = dataset.columns[columnIndex];
  const rowCount = dataset.rowCount;
  const { nullMask } = column;
  let empty = 0;
  for (let i = 0; i < rowCount; i++) if (nullMask.get(i)) empty++;
  const values = new Uint32Array(rowCount - empty);
  const ordered = new Uint32Array(rowCount);
  let v = 0;
  let e = rowCount - empty;
  for (let i = 0; i < rowCount; i++) {
    if (nullMask.get(i)) ordered[e++] = i;
    else values[v++] = i;
  }

  if (isNumericLikeType(column.type)) {
    const numbers = column.numbers();
    values.sort((a, b) => {
      const va = numbers[a];
      const vb = numbers[b];
      const na = Number.isNaN(va);
      const nb = Number.isNaN(vb);
      if (na && nb) return 0;
      if (na) return 1;
      if (nb) return -1;
      return va - vb;
    });
  } else {
    const raw = column.raw;
    values.sort((a, b) => {
      const va = raw[a];
      const vb = raw[b];
      return va < vb ? -1 : va > vb ? 1 : 0;
    });
  }
  ordered.set(values, 0);
  emptyTail.set(ordered, empty);
  return ordered;
}

/**
 * Collects the rows that pass `bits` in rank order. Direction -1 walks the
 * ascending rank backwards, so descending sorts never re-sort; the empty
 * cells at the rank's end stay last either way.
 */
export function orderIds(bits: BitSet, rank: Uint32Array | null, dir: 1 | -1 = 1): Uint32Array {
  if (rank === null) return bits.toIndices();
  const out = new Uint32Array(bits.count());
  let k = 0;
  const valueEnd = rank.length - (emptyTail.get(rank) ?? 0);
  if (dir === 1) {
    for (let i = 0; i < valueEnd; i++) {
      const row = rank[i];
      if (bits.get(row)) out[k++] = row;
    }
  } else {
    for (let i = valueEnd - 1; i >= 0; i--) {
      const row = rank[i];
      if (bits.get(row)) out[k++] = row;
    }
  }
  for (let i = valueEnd; i < rank.length; i++) {
    const row = rank[i];
    if (bits.get(row)) out[k++] = row;
  }
  return out;
}


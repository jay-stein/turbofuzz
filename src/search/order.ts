import type { Dataset } from "../data/dataset.js";
import type { BitSet } from "./bitset.js";

/** Builds the ascending row order for a column. Cache and reverse for desc. */
export function buildRank(dataset: Dataset, columnIndex: number): Uint32Array {
  const column = dataset.columns[columnIndex];
  const rowCount = dataset.rowCount;
  const ordered = new Uint32Array(rowCount);
  for (let i = 0; i < rowCount; i++) ordered[i] = i;

  const numeric =
    column.type === "integer" || column.type === "number" || column.type === "date";
  if (numeric) {
    const numbers = column.numbers();
    ordered.sort((a, b) => {
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
    ordered.sort((a, b) => {
      const va = raw[a];
      const vb = raw[b];
      return va < vb ? -1 : va > vb ? 1 : 0;
    });
  }
  return ordered;
}

/**
 * Collects the rows that pass `bits` in rank order. Direction -1 walks the
 * ascending rank backwards, so descending sorts never re-sort.
 */
export function orderIds(bits: BitSet, rank: Uint32Array | null, dir: 1 | -1 = 1): Uint32Array {
  if (rank === null) return bits.toIndices();
  const out = new Uint32Array(bits.count());
  let k = 0;
  if (dir === 1) {
    for (let i = 0; i < rank.length; i++) {
      const row = rank[i];
      if (bits.get(row)) out[k++] = row;
    }
  } else {
    for (let i = rank.length - 1; i >= 0; i--) {
      const row = rank[i];
      if (bits.get(row)) out[k++] = row;
    }
  }
  return out;
}

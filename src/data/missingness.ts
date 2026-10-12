import type { BitSet } from "../search/bitset.js";

export interface MissingnessColumn {
  nullMask: BitSet;
}

export interface MissingnessGrid {
  /** Row buckets actually used (never more than the row count). */
  buckets: number;
  /** Row-major missing-cell counts per bucket × column. */
  cells: Uint16Array;
}

/**
 * Downsamples a table's null masks into a small grid for the Missing values
 * map: each cell holds the number of missing values in one run of rows for
 * one column, so a whole table fits in a few hundred pixels while the counts
 * stay exact for row-level tooltips.
 */
export function missingnessGrid(
  columns: readonly MissingnessColumn[],
  rowCount: number,
  maxBuckets: number,
): MissingnessGrid {
  const columnCount = columns.length;
  const limit = Math.max(1, Math.min(1024, Math.floor(maxBuckets) || 1));
  const buckets = rowCount === 0 ? 1 : Math.min(limit, rowCount);
  const cells = new Uint16Array(buckets * columnCount);
  if (rowCount === 0 || columnCount === 0) {
    return { buckets, cells };
  }
  for (let c = 0; c < columnCount; c++) {
    const mask = columns[c].nullMask;
    for (let bucket = 0; bucket < buckets; bucket++) {
      const start = Math.floor((bucket * rowCount) / buckets);
      const end = Math.max(start + 1, Math.floor(((bucket + 1) * rowCount) / buckets));
      let missing = 0;
      for (let row = start; row < end; row++) {
        if (mask.get(row)) missing++;
      }
      cells[bucket * columnCount + c] = missing;
    }
  }
  return { buckets, cells };
}

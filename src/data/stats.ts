import { BitSet } from "../search/bitset.js";
import type { ColumnData } from "./column.js";

export interface DatasetStats {
  duplicateRows: number;
  duplicateGroups: number;
  rowsInDuplicateGroups: number;
  emptyRows: number;
  rowsWithNulls: number;
  totalNullCells: number;
  totalCells: number;
  computeMs: number;
}

export interface IngestStats {
  stats: DatasetStats;
  duplicateBits: BitSet;
  nullRowBits: BitSet;
}

function hashRow(columns: readonly ColumnData[], row: number, columnCount: number): number {
  let hash = 0x811c9dc5;
  for (let c = 0; c < columnCount; c++) {
    const value = columns[c].raw[row];
    for (let i = 0; i < value.length; i++) {
      hash ^= value.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    hash ^= 0x2f;
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function rowsEqual(
  columns: readonly ColumnData[],
  a: number,
  b: number,
  columnCount: number,
): boolean {
  for (let c = 0; c < columnCount; c++) {
    if (columns[c].raw[a] !== columns[c].raw[b]) return false;
  }
  return true;
}

/**
 * One-time O(rows) pass. Duplicate detection hashes each row and only falls
 * back to exact comparison for rows that land in the same hash bucket, so it
 * is exact without building full row-key strings. Also produces the row masks
 * used by the "show duplicates" / "show null rows" toggles.
 */
export function computeDatasetStats(
  columns: readonly ColumnData[],
  rowCount: number,
): IngestStats {
  const started = performance.now();
  const columnCount = columns.length;
  const buckets = new Map<number, number[]>();
  const duplicateBuckets = new Set<number>();
  const duplicateBits = new BitSet(rowCount);
  let duplicateRows = 0;

  for (let row = 0; row < rowCount; row++) {
    const hash = hashRow(columns, row, columnCount);
    const bucket = buckets.get(hash);
    if (bucket === undefined) {
      buckets.set(hash, [row]);
      continue;
    }
    let isDuplicate = false;
    for (let i = 0; i < bucket.length; i++) {
      if (rowsEqual(columns, row, bucket[i], columnCount)) {
        duplicateBits.set(row);
        duplicateBits.set(bucket[i]);
        isDuplicate = true;
        break;
      }
    }
    if (isDuplicate) {
      duplicateRows++;
      duplicateBuckets.add(hash);
    } else {
      bucket.push(row);
    }
  }

  const duplicateGroups = duplicateBuckets.size;

  let emptyRows = 0;
  for (let row = 0; row < rowCount; row++) {
    let empty = true;
    for (let c = 0; c < columnCount; c++) {
      if (!columns[c].nullMask.get(row)) {
        empty = false;
        break;
      }
    }
    if (empty) emptyRows++;
  }

  const nullRowBits = new BitSet(rowCount);
  for (const column of columns) nullRowBits.or(column.nullMask);

  let totalNullCells = 0;
  for (const column of columns) totalNullCells += column.stats.nulls;

  return {
    stats: {
      duplicateRows,
      duplicateGroups,
      rowsInDuplicateGroups: duplicateBits.count(),
      emptyRows,
      rowsWithNulls: nullRowBits.count(),
      totalNullCells,
      totalCells: rowCount * columnCount,
      computeMs: performance.now() - started,
    },
    duplicateBits,
    nullRowBits,
  };
}

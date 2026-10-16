import { BitSet } from "../search/bitset.js";
import { computeAnomalies, type LengthFence, type ValueFence } from "./anomalies.js";
import type { ColumnData } from "./column.js";

export interface DatasetStats {
  duplicateRows: number;
  duplicateGroups: number;
  rowsInDuplicateGroups: number;
  emptyRows: number;
  rowsWithNulls: number;
  totalNullCells: number;
  totalCells: number;
  valueAnomalyRows: number;
  lengthAnomalyRows: number;
  computeMs: number;
}

export interface IngestStats {
  stats: DatasetStats;
  duplicateBits: BitSet;
  nullRowBits: BitSet;
  rowHashes: Uint32Array;
  valueAnomalyBits: BitSet;
  lengthAnomalyBits: BitSet;
  valueColumnBits: (BitSet | null)[];
  lengthColumnBits: (BitSet | null)[];
  valueFences: (ValueFence | null)[];
  lengthFences: (LengthFence | null)[];
}

/** Row hash progress: called once per column with 1-based progress. */
export type ColumnProgress = (phase: string, current: number, total: number) => void;

/**
 * Row hashes are accumulated column by column so each column's string array
 * is read sequentially (wide tables otherwise thrash the cache).
 */
export function hashRows(
  columns: readonly ColumnData[],
  rowCount: number,
  onColumn?: ColumnProgress,
): Uint32Array {
  const hashes = new Uint32Array(rowCount);
  hashes.fill(0x811c9dc5);
  for (let c = 0; c < columns.length; c++) {
    onColumn?.("Hashing rows", c + 1, columns.length);
    const raw = columns[c].raw;
    for (let row = 0; row < rowCount; row++) {
      let hash = hashes[row];
      const value = raw[row];
      for (let i = 0; i < value.length; i++) {
        hash ^= value.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
      }
      hash ^= 0x2f;
      hash = Math.imul(hash, 0x01000193);
      hashes[row] = hash;
    }
  }
  return hashes;
}

export function rowsEqual(
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
  onProgress?: ColumnProgress,
): IngestStats {
  const started = performance.now();
  const columnCount = columns.length;
  const duplicateBits = new BitSet(rowCount);
  const hashes = hashRows(columns, rowCount, onProgress);
  let duplicateRows = 0;

  // Count hash occurrences first: rows whose hash is unique (the common case
  // in wide and ID-heavy files) never need a bucket array, so the pass keeps
  // one number per distinct hash instead of one array per row.
  const counts = new Map<number, number>();
  for (let row = 0; row < rowCount; row++) {
    const hash = hashes[row];
    counts.set(hash, (counts.get(hash) ?? 0) + 1);
  }

  const buckets = new Map<number, number[]>();
  const duplicateBuckets = new Set<number>();
  for (let row = 0; row < rowCount; row++) {
    const hash = hashes[row];
    if ((counts.get(hash) ?? 0) < 2) continue;
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
  counts.clear();

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

  const anomalies = computeAnomalies(columns, rowCount, onProgress);

  return {
    stats: {
      duplicateRows,
      duplicateGroups,
      rowsInDuplicateGroups: duplicateBits.count(),
      emptyRows,
      rowsWithNulls: nullRowBits.count(),
      totalNullCells,
      totalCells: rowCount * columnCount,
      valueAnomalyRows: anomalies.valueBits.count(),
      lengthAnomalyRows: anomalies.lengthBits.count(),
      computeMs: performance.now() - started,
    },
    duplicateBits,
    nullRowBits,
    rowHashes: hashes,
    valueAnomalyBits: anomalies.valueBits,
    lengthAnomalyBits: anomalies.lengthBits,
    valueColumnBits: anomalies.valueColumnBits,
    lengthColumnBits: anomalies.lengthColumnBits,
    valueFences: anomalies.columns.map((entry) => entry.valueFence),
    lengthFences: anomalies.columns.map((entry) => entry.lengthFence),
  };
}

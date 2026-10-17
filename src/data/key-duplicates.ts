import { BitSet } from "../search/bitset.js";
import type { ColumnData } from "./column.js";

export interface KeyDuplicateResult {
  /** Rows that participate in a duplicated key combination. */
  duplicateBits: BitSet;
  /** Rows beyond the first copy of each duplicated key. */
  duplicateRows: number;
  duplicateGroups: number;
  /** Rows whose key is fully populated (null key parts are N.A. and skipped). */
  counted: number;
}

/**
 * Composite-key uniqueness: hashes the selected columns per row and flags
 * rows whose key combination repeats. Exact comparison backs the hash buckets,
 * mirroring the whole-row duplicate pass in stats.ts. Rows with a missing key
 * part are "Not populated" — excluded rather than counted as duplicates.
 */
export function computeKeyDuplicates(
  columns: readonly ColumnData[],
  keyColumns: readonly number[],
  rowCount: number,
): KeyDuplicateResult {
  const duplicateBits = new BitSet(rowCount);
  const keys = keyColumns.filter(
    (column) => column >= 0 && column < columns.length,
  );
  if (keys.length === 0) {
    return { duplicateBits, duplicateRows: 0, duplicateGroups: 0, counted: 0 };
  }

  const hashes = new Uint32Array(rowCount);
  hashes.fill(0x811c9dc5);
  const populated = new Uint8Array(rowCount).fill(1);
  let counted = 0;

  for (const columnIndex of keys) {
    const column = columns[columnIndex];
    if (column === undefined) continue;
    const raw = column.raw;
    for (let row = 0; row < rowCount; row++) {
      const value = raw[row];
      if (column.isNull(value)) {
        populated[row] = 0;
        continue;
      }
      let hash = hashes[row];
      for (let i = 0; i < value.length; i++) {
        hash ^= value.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
      }
      hash ^= 0x2f;
      hash = Math.imul(hash, 0x01000193);
      hashes[row] = hash;
    }
  }
  for (let row = 0; row < rowCount; row++) if (populated[row] === 1) counted++;

  const counts = new Map<number, number>();
  for (let row = 0; row < rowCount; row++) {
    if (populated[row] === 0) continue;
    const hash = hashes[row];
    counts.set(hash, (counts.get(hash) ?? 0) + 1);
  }

  const buckets = new Map<number, number[]>();
  const duplicateBuckets = new Set<number>();
  let duplicateRows = 0;
  for (let row = 0; row < rowCount; row++) {
    if (populated[row] === 0) continue;
    const hash = hashes[row];
    if ((counts.get(hash) ?? 0) < 2) continue;
    const bucket = buckets.get(hash);
    if (bucket === undefined) {
      buckets.set(hash, [row]);
      continue;
    }
    let isDuplicate = false;
    for (const other of bucket) {
      if (keysEqual(columns, keys, row, other)) {
        duplicateBits.set(row);
        duplicateBits.set(other);
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

  return {
    duplicateBits,
    duplicateRows,
    duplicateGroups: duplicateBuckets.size,
    counted,
  };
}

/** Exact comparison over the key columns only (hash collisions happen). */
function keysEqual(
  columns: readonly ColumnData[],
  keyColumns: readonly number[],
  a: number,
  b: number,
): boolean {
  for (const columnIndex of keyColumns) {
    const column = columns[columnIndex];
    if (column === undefined) continue;
    if (column.raw[a] !== column.raw[b]) return false;
  }
  return true;
}

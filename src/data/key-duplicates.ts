import { BitSet } from "../search/bitset.js";
import { nameTokens } from "./name-hints.js";
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
 *
 * With `blanksMatch` the columns are a whole row minus its id (not a key): an
 * empty cell is a value like any other and matches another empty cell, as in
 * the whole-row pass, so a row with a blank is still compared.
 */
export function computeKeyDuplicates(
  columns: readonly ColumnData[],
  keyColumns: readonly number[],
  rowCount: number,
  blanksMatch = false,
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
      const blank = column.isNull(raw[row]);
      if (blank && !blanksMatch) {
        populated[row] = 0;
        continue;
      }
      // Every blank hashes alike ("" and "N/A" are both empty), so blank meets blank.
      const value = blank ? "" : raw[row];
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
      if (keysEqual(columns, keys, row, other, blanksMatch)) {
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
  blanksMatch: boolean,
): boolean {
  for (const columnIndex of keyColumns) {
    const column = columns[columnIndex];
    if (column === undefined) continue;
    const x = column.raw[a];
    const y = column.raw[b];
    if (x === y) continue;
    if (blanksMatch && column.isNull(x) && column.isNull(y)) continue;
    return false;
  }
  return true;
}

/** Whole words that make a column name read as a record key (order_id, invoice_no, ticket_code). */
const KEY_WORDS = new Set(["id", "ids", "key", "uuid", "guid", "number", "no", "num", "nr", "code", "ref", "reference"]);
const NOT_KEY_COMPACT = /(paid|valid|void|grid|solid|fluid|rapid|humid|arid|android)$/;

/** Does the column name say it identifies a record? (orderid and OrderID count; "paid" does not.) */
export function looksLikeKeyName(name: string): boolean {
  if (nameTokens(name).some((token) => KEY_WORDS.has(token))) return true;
  const compact = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  return compact.length > 3 && compact.endsWith("id") && !NOT_KEY_COMPACT.test(compact);
}

/** A key column must be at least this distinct before a repeat reads as a defect rather than a foreign key. */
export const KEY_MIN_DISTINCT_SHARE = 0.98;

/**
 * Rows that share their value with another row, and how many values repeat, for a
 * column that is nearly but not fully unique. Null for any other column, so the
 * O(distinct) walk only runs where a repeat would be news.
 */
export function valueRepeats(
  counts: ReadonlyMap<string, number>,
  present: number,
): { rows: number; values: number } | null {
  if (present <= 20 || counts.size >= present || counts.size < present * KEY_MIN_DISTINCT_SHARE) return null;
  let rows = 0;
  let values = 0;
  for (const count of counts.values()) {
    if (count < 2) continue;
    rows += count;
    values++;
  }
  return values === 0 ? null : { rows, values };
}

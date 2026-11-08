import { BitSet } from "../../search/bitset.js";
import { EMPTY_ID, RowGroups, valueIds } from "./ids.js";
import { cellComparer, pairFamily } from "./values.js";
import {
  ROW_CHANGED,
  ROW_IDENTICAL,
  ROW_ONLY_A,
  ROW_ONLY_B,
  type ColumnPair,
  type ColumnPairing,
  type CompareRules,
  type CompareSide,
  type MatchResult,
} from "./types.js";

/**
 * Lines up the rows of A and B. With key column pairs, rows with the same key
 * pair up (repeated keys pair in order: the first copy in A with the first in
 * B) and their cells are compared. With no key, whole rows pair up when every
 * paired cell agrees, so rows are only identical, only in A or only in B.
 *
 * The display order follows B, with each row only in A placed just before the
 * first B row that matches a later A row, so two files in a similar order read
 * like a diff.
 */
export function matchRows(
  a: CompareSide,
  b: CompareSide,
  pairing: ColumnPairing,
  keyPairs: readonly ColumnPair[] | null,
  rules: CompareRules,
): MatchResult {
  const mode: MatchResult["mode"] = keyPairs !== null && keyPairs.length > 0 ? "key" : "content";
  const idPairs = mode === "key" ? keyPairs! : pairing.pairs;
  const aIds: Int32Array[] = [];
  const bIds: Int32Array[] = [];
  for (const pair of idPairs) {
    const ca = a.columns[pair.a];
    const cb = b.columns[pair.b];
    const ids = valueIds(ca, cb, pairFamily(ca, cb), rules);
    aIds.push(ids.a);
    bIds.push(ids.b);
  }
  // A key needs every cell filled; whole rows may hold empty cells unless empty must not equal empty.
  const blocksMatch = mode === "key" || !rules.emptyEqualsEmpty;
  const hasEmpty = (ids: readonly Int32Array[], row: number): boolean => {
    for (let c = 0; c < ids.length; c++) if (ids[c][row] === EMPTY_ID) return true;
    return false;
  };

  // Rows of A by group: the first unused row, then a chain through `next`.
  const groups = new RowGroups(aIds, bIds, a.rowCount);
  const head = new Int32Array(a.rowCount).fill(-1);
  const tail = new Int32Array(a.rowCount);
  const next = new Int32Array(a.rowCount).fill(-1);
  let emptyA = 0;
  let duplicateA = 0;
  for (let row = 0; row < a.rowCount; row++) {
    if (blocksMatch && hasEmpty(aIds, row)) {
      emptyA++;
      continue;
    }
    const group = groups.addA(row);
    if (head[group] < 0) head[group] = row;
    else {
      duplicateA++;
      next[tail[group]] = row;
    }
    tail[group] = row;
  }

  // Each B row takes the next unused A row of its group.
  const partner = new Int32Array(b.rowCount).fill(-1);
  const usedA = new Uint8Array(a.rowCount);
  let emptyB = 0;
  for (let row = 0; row < b.rowCount; row++) {
    if (blocksMatch && hasEmpty(bIds, row)) {
      emptyB++;
      continue;
    }
    const group = groups.findB(row);
    if (group < 0) continue;
    const at = head[group];
    if (at < 0) continue;
    partner[row] = at;
    usedA[at] = 1;
    head[group] = next[at];
  }
  // Repeated keys within B, including keys A does not have.
  let duplicateB = 0;
  if (mode === "key") {
    const own = new RowGroups(bIds, bIds, b.rowCount);
    const seen = new Uint8Array(b.rowCount);
    for (let row = 0; row < b.rowCount; row++) {
      if (hasEmpty(bIds, row)) continue;
      const group = own.addA(row);
      if (seen[group] === 1) duplicateB++;
      else seen[group] = 1;
    }
  }

  // Align: B order, unmatched A rows slotted in before the B row whose partner follows them.
  const capacity = a.rowCount + b.rowCount;
  const aRowAll = new Int32Array(capacity);
  const bRowAll = new Int32Array(capacity);
  let length = 0;
  let aNext = 0;
  const flushA = (upTo: number): void => {
    while (aNext < upTo) {
      if (usedA[aNext] === 0) {
        aRowAll[length] = aNext;
        bRowAll[length] = -1;
        length++;
      }
      aNext++;
    }
  };
  for (let row = 0; row < b.rowCount; row++) {
    const at = partner[row];
    if (at >= 0 && at >= aNext) flushA(at);
    aRowAll[length] = at;
    bRowAll[length] = row;
    length++;
  }
  flushA(a.rowCount);
  const aRow = aRowAll.slice(0, length);
  const bRow = bRowAll.slice(0, length);

  // Cell differences for matched rows (key mode only: content matches agree by construction).
  const changed = pairing.pairs.map(() => new BitSet(length));
  const status = new Uint8Array(length);
  if (mode === "key") {
    pairing.pairs.forEach((pair, index) => {
      const equal = cellComparer(a.columns[pair.a], b.columns[pair.b], rules);
      const bits = changed[index];
      for (let i = 0; i < length; i++) {
        const ar = aRow[i];
        const br = bRow[i];
        if (ar < 0 || br < 0) continue;
        if (!equal(ar, br)) {
          bits.set(i);
          status[i] = ROW_CHANGED;
        }
      }
    });
  }
  const counts = { identical: 0, changed: 0, onlyA: 0, onlyB: 0 };
  for (let i = 0; i < length; i++) {
    if (aRow[i] < 0) {
      status[i] = ROW_ONLY_B;
      counts.onlyB++;
    } else if (bRow[i] < 0) {
      status[i] = ROW_ONLY_A;
      counts.onlyA++;
    } else if (status[i] === ROW_CHANGED) counts.changed++;
    else {
      status[i] = ROW_IDENTICAL;
      counts.identical++;
    }
  }

  return {
    mode,
    aRow,
    bRow,
    status,
    changed,
    counts,
    duplicateKeys: mode === "key" ? { a: duplicateA, b: duplicateB } : { a: 0, b: 0 },
    emptyKeys: mode === "key" ? { a: emptyA, b: emptyB } : { a: 0, b: 0 },
  };
}

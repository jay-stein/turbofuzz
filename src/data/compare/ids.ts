import { textForm, type CompareFamily } from "./values.js";
import type { CompareColumn, CompareRules } from "./types.js";

/** The id of an empty cell. */
export const EMPTY_ID = 0;

/**
 * Numbers every distinct value of a column pair with one id shared by A and
 * B, so rows compare as small integer vectors instead of joined strings.
 * Parsed numbers and dates are keyed by value (1.0 and 1 share an id), text
 * by the form the rules see. Empty cells get EMPTY_ID.
 */
export function valueIds(
  a: CompareColumn,
  b: CompareColumn,
  family: CompareFamily,
  rules: CompareRules,
): { a: Int32Array; b: Int32Array } {
  const byNumber = new Map<number, number>();
  const byText = new Map<string, number>();
  let nextId = 1;
  const plainText = !rules.ignoreCase && !rules.trimSpaces;
  const encode = (column: CompareColumn): Int32Array => {
    const raw = column.raw;
    const nums = family === "text" ? null : column.numbers();
    const out = new Int32Array(raw.length);
    for (let row = 0; row < raw.length; row++) {
      if (column.isEmpty(row)) continue;
      if (nums !== null) {
        const value = nums[row];
        if (value === value) {
          // -0 and 0 are one value.
          const key = value === 0 ? 0 : value;
          let id = byNumber.get(key);
          if (id === undefined) byNumber.set(key, (id = nextId++));
          out[row] = id;
          continue;
        }
      }
      const text = plainText ? raw[row] : textForm(raw[row], rules);
      let id = byText.get(text);
      if (id === undefined) byText.set(text, (id = nextId++));
      out[row] = id;
    }
    return out;
  };
  return { a: encode(a), b: encode(b) };
}

/**
 * Groups rows that agree on every id column. Group ids are dense (0, 1, …);
 * rows of A create groups, rows of B only look them up (-1 when absent).
 * Buckets are keyed by a 32-bit hash and verified cell by cell, so a hash
 * collision never merges two different rows.
 */
export class RowGroups {
  private readonly buckets = new Map<number, number>();
  /** Per group: the next group in the same hash bucket, and a row standing for it. */
  private nextInBucket: Int32Array;
  private repSide: Uint8Array;
  private repRow: Int32Array;
  count = 0;

  constructor(
    private readonly aIds: readonly Int32Array[],
    private readonly bIds: readonly Int32Array[],
    capacity: number,
  ) {
    this.nextInBucket = new Int32Array(Math.max(1, capacity));
    this.repSide = new Uint8Array(Math.max(1, capacity));
    this.repRow = new Int32Array(Math.max(1, capacity));
  }

  private hash(ids: readonly Int32Array[], row: number): number {
    let h = 0x811c9dc5;
    for (let c = 0; c < ids.length; c++) h = Math.imul(h ^ ids[c][row], 0x01000193);
    return h | 0;
  }

  private same(ids: readonly Int32Array[], row: number, group: number): boolean {
    const other = this.repSide[group] === 0 ? this.aIds : this.bIds;
    const rep = this.repRow[group];
    for (let c = 0; c < ids.length; c++) if (ids[c][row] !== other[c][rep]) return false;
    return true;
  }

  private find(ids: readonly Int32Array[], row: number, h: number): number {
    let group = this.buckets.get(h) ?? -1;
    while (group >= 0 && !this.same(ids, row, group)) group = this.nextInBucket[group];
    return group;
  }

  /** The group of row `row` of A, created when new. */
  addA(row: number): number {
    const h = this.hash(this.aIds, row);
    const found = this.find(this.aIds, row, h);
    if (found >= 0) return found;
    const group = this.count++;
    this.nextInBucket[group] = this.buckets.get(h) ?? -1;
    this.buckets.set(h, group);
    this.repSide[group] = 0;
    this.repRow[group] = row;
    return group;
  }

  /** The group of row `row` of B, or -1 when no row of A has the same values. */
  findB(row: number): number {
    return this.find(this.bIds, row, this.hash(this.bIds, row));
  }
}

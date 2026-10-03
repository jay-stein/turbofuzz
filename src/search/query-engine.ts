import { BitSet } from "./bitset.js";
import { normalize } from "./normalize.js";
import type { Dataset } from "../data/dataset.js";
import type { TextMode } from "../types.js";

export type ColumnFilter =
  | { kind: "text"; mode: TextMode; query: string }
  | { kind: "range"; min: number | null; max: number | null }
  | { kind: "values"; selected: number[] };

/**
 * Evaluates a set of per-column filters by intersecting cached bitsets.
 * Each column's last result is cached by signature, so typing in one filter
 * only recomputes that filter and one AND over the cached rest.
 */
export class QueryEngine {
  private cache = new Map<number, { sig: string; bits: BitSet }>();
  private readonly all: BitSet;

  constructor(private readonly dataset: Dataset) {
    this.all = new BitSet(dataset.rowCount);
    this.all.setAll();
  }

  evaluate(filters: ReadonlyMap<number, ColumnFilter>): Uint32Array {
    return this.evaluateBits(filters).toIndices();
  }

  evaluateBits(filters: ReadonlyMap<number, ColumnFilter>, excludeColumn = -1): BitSet {
    let acc: BitSet | null = null;
    for (const [columnIndex, filter] of filters) {
      if (columnIndex === excludeColumn) continue;
      const bits = this.bitsFor(columnIndex, filter);
      if (acc === null) acc = bits.clone();
      else acc.and(bits);
      if (acc.count() === 0) break;
    }
    return acc ?? this.all;
  }

  invalidate(): void {
    this.cache.clear();
  }

  private bitsFor(columnIndex: number, filter: ColumnFilter): BitSet {
    const sig = JSON.stringify(filter);
    const cached = this.cache.get(columnIndex);
    if (cached !== undefined && cached.sig === sig) return cached.bits;
    const bits = this.compute(columnIndex, filter);
    this.cache.set(columnIndex, { sig, bits });
    return bits;
  }

  private compute(columnIndex: number, filter: ColumnFilter): BitSet {
    const column = this.dataset.columns[columnIndex];
    const rowCount = this.dataset.rowCount;

    switch (filter.kind) {
      case "text": {
        const query = normalize(filter.query);
        if (query === "") return this.all.clone();

        if (filter.mode === "fuzzy") {
          return column.fuzzyIndex().search(filter.query).rowBits;
        }

        const bits = new BitSet(rowCount);
        const values = column.normalized();
        for (let i = 0; i < values.length; i++) {
          const value = values[i];
          const hit = filter.mode === "exact" ? value === query : value.includes(query);
          if (hit) bits.set(i);
        }
        return bits;
      }

      case "range": {
        const bits = new BitSet(rowCount);
        const numbers = column.numbers();
        const { min, max } = filter;
        for (let i = 0; i < numbers.length; i++) {
          const value = numbers[i];
          if (Number.isNaN(value)) continue;
          if (min !== null && value < min) continue;
          if (max !== null && value > max) continue;
          bits.set(i);
        }
        return bits;
      }

      case "values": {
        const bits = new BitSet(rowCount);
        const categories = column.categories();
        for (const id of filter.selected) {
          if (id >= 0 && id < categories.bits.length) bits.or(categories.bits[id]);
        }
        return bits;
      }
    }
  }
}

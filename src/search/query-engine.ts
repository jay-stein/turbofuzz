import { BitSet } from "./bitset.js";
import { normalize } from "./normalize.js";
import type { Dataset } from "../data/dataset.js";
import type { TextMode } from "../types.js";

export type ColumnFilter =
  | { kind: "text"; mode: TextMode; query: string }
  | { kind: "range"; min: number | null; max: number | null }
  | { kind: "values"; selected: number[] };

const MAX_PREFIX_DEPTH = 32;
const MAX_FACET_DELTA = 64;

/**
 * Evaluates a set of per-column filters by intersecting cached bitsets.
 *
 * Two incremental strategies keep fresh queries off the full-table scan path:
 * - contains/exact maintain a stack of prefix results (`contains("malv")` is a
 *   subset of `contains("mal")`), so typing scans only the previous result and
 *   backspace is a cache hit;
 * - category value filters keep their selected set and bitset, so toggling one
 *   value is a single AND/OR pass instead of re-ORing every value.
 */
export type SpecialFilter =
  | "duplicates"
  | "nulls"
  | "valueAnomalies"
  | "lengthAnomalies";

export class QueryEngine {
  private readonly special = new Set<SpecialFilter>();
  private cache = new Map<number, { sig: string; bits: BitSet }>();
  private readonly prefixStacks = new Map<number, { query: string; bits: BitSet }[]>();
  private readonly valuesState = new Map<number, { selected: Set<number>; bits: BitSet }>();
  private readonly rangeState = new Map<
    number,
    { min: number | null; max: number | null; bits: BitSet }
  >();
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
    for (const kind of this.special) {
      const bits = this.specialBits(kind);
      if (acc === null) acc = bits.clone();
      else acc.and(bits);
      if (acc.count() === 0) break;
    }
    for (const [columnIndex, filter] of filters) {
      if (columnIndex === excludeColumn) continue;
      const bits = this.bitsFor(columnIndex, filter);
      if (acc === null) acc = bits.clone();
      else acc.and(bits);
      if (acc.count() === 0) break;
    }
    return acc ?? this.all;
  }

  setSpecial(kind: SpecialFilter, active: boolean): void {
    if (active) this.special.add(kind);
    else this.special.delete(kind);
  }

  private specialBits(kind: SpecialFilter): BitSet {
    switch (kind) {
      case "duplicates":
        return this.dataset.duplicateBits;
      case "nulls":
        return this.dataset.nullRowBits;
      case "valueAnomalies":
        return this.dataset.valueAnomalyBits;
      case "lengthAnomalies":
        return this.dataset.lengthAnomalyBits;
    }
  }

  invalidate(): void {
    this.cache.clear();
    this.prefixStacks.clear();
    this.valuesState.clear();
    this.rangeState.clear();
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

    switch (filter.kind) {
      case "text": {
        const query = normalize(filter.query);
        if (query === "") return this.all.clone();

        if (filter.mode === "phonetic") {
          const index = column.fuzzyIndex();
          const phonetic = index.phoneticSearch(filter.query).rowBits;
          if (phonetic.count() > 0) return phonetic;
          return index.search(filter.query).rowBits;
        }

        if (filter.mode === "fuzzy") {
          return column.fuzzyIndex().search(filter.query).rowBits;
        }

        return this.textBits(columnIndex, query, filter.mode === "exact");
      }

      case "range":
        return this.rangeBits(columnIndex, filter.min, filter.max);

      case "values":
        return this.valuesBits(columnIndex, filter.selected);
    }
  }

  private textBits(columnIndex: number, query: string, exact: boolean): BitSet {
    const rowCount = this.dataset.rowCount;
    let stack = this.prefixStacks.get(columnIndex);
    if (stack === undefined) {
      stack = [];
      this.prefixStacks.set(columnIndex, stack);
    }

    while (stack.length > 0 && !query.startsWith(stack[stack.length - 1].query)) {
      stack.pop();
    }
    const base = stack.length > 0 ? stack[stack.length - 1] : null;

    if (base !== null && base.query === query) {
      if (!exact) return base.bits;
      const bits = new BitSet(rowCount);
      const values = this.dataset.columns[columnIndex].normalized();
      base.bits.forEachRow((row) => {
        if (values[row] === query) bits.set(row);
      });
      return bits;
    }

    const containsBits = new BitSet(rowCount);
    const bits = exact ? new BitSet(rowCount) : containsBits;
    const values = this.dataset.columns[columnIndex].normalized();

    if (base !== null) {
      base.bits.forEachRow((row) => {
        const value = values[row];
        if (value.includes(query)) containsBits.set(row);
        if (exact && value === query) bits.set(row);
      });
    } else {
      for (let i = 0; i < values.length; i++) {
        const value = values[i];
        if (value.includes(query)) containsBits.set(i);
        if (exact && value === query) bits.set(i);
      }
    }

    if (stack.length >= MAX_PREFIX_DEPTH) stack.shift();
    stack.push({ query, bits: containsBits });
    return bits;
  }

  /**
   * Range filters narrow monotonically while a slider thumb moves inward:
   * when the new [min,max] is inside the previous one, only the previous
   * selection is rescanned instead of the whole column.
   */
  private rangeBits(columnIndex: number, min: number | null, max: number | null): BitSet {
    const rowCount = this.dataset.rowCount;
    const numbers = this.dataset.columns[columnIndex].numbers();
    const previous = this.rangeState.get(columnIndex);

    const isSubset =
      previous !== undefined &&
      (previous.min === null || (min !== null && min >= previous.min)) &&
      (previous.max === null || (max !== null && max <= previous.max));
    // Only worth narrowing from a genuinely sparse selection; scanning a
    // dense subset costs about as much as scanning the raw column.
    const shouldNarrow =
      previous !== undefined && isSubset && previous.bits.count() * 2 < rowCount;

    const bits = new BitSet(rowCount);
    if (previous !== undefined && shouldNarrow) {
      previous.bits.forEachRow((row) => {
        const value = numbers[row];
        if (Number.isNaN(value)) return;
        if (min !== null && value < min) return;
        if (max !== null && value > max) return;
        bits.set(row);
      });
    } else {
      for (let i = 0; i < numbers.length; i++) {
        const value = numbers[i];
        if (Number.isNaN(value)) continue;
        if (min !== null && value < min) continue;
        if (max !== null && value > max) continue;
        bits.set(i);
      }
    }

    this.rangeState.set(columnIndex, { min, max, bits });
    return bits;
  }

  private valuesBits(columnIndex: number, selectedIds: number[]): BitSet {
    const categories = this.dataset.columns[columnIndex].categories();
    const selected = new Set(selectedIds);
    const previous = this.valuesState.get(columnIndex);

    if (previous !== undefined) {
      const added: number[] = [];
      const removed: number[] = [];
      for (const id of selected) if (!previous.selected.has(id)) added.push(id);
      for (const id of previous.selected) if (!selected.has(id)) removed.push(id);

      if (added.length + removed.length <= MAX_FACET_DELTA) {
        for (const id of removed) {
          if (id >= 0 && id < categories.bits.length) previous.bits.andNot(categories.bits[id]);
        }
        for (const id of added) {
          if (id >= 0 && id < categories.bits.length) previous.bits.or(categories.bits[id]);
        }
        previous.selected = selected;
        return previous.bits;
      }
    }

    const bits = new BitSet(this.dataset.rowCount);
    for (const id of selected) {
      if (id >= 0 && id < categories.bits.length) bits.or(categories.bits[id]);
    }
    this.valuesState.set(columnIndex, { selected, bits });
    return bits;
  }
}

import { BitSet } from "../search/bitset.js";
import { FuzzyIndex } from "../search/fuzzy-index.js";
import { normalize } from "../search/normalize.js";
import { detectDateOrder, parseDate, type DateOrder } from "../parse/dates.js";
import { inferColumnType, stratifiedSample, type ColumnStats } from "../parse/infer.js";
import { isNullToken } from "../parse/null-tokens.js";
import { parseNumber } from "../parse/numbers.js";
import type { ColumnType } from "../types.js";

export interface CategorySet {
  labels: string[];
  counts: number[];
  bits: BitSet[];
}

export class ColumnData {
  type: ColumnType;
  dateOrder: DateOrder;
  readonly stats: ColumnStats;
  readonly nullMask: BitSet;

  private norm: string[] | null = null;
  private fuzzy: FuzzyIndex | null = null;
  private nums: Float64Array | null = null;
  private cats: CategorySet | null = null;

  constructor(
    readonly name: string,
    readonly raw: string[],
    type: ColumnType,
    dateOrder: DateOrder,
    stats: ColumnStats,
    nullMask: BitSet,
  ) {
    this.type = type;
    this.dateOrder = dateOrder;
    this.stats = stats;
    this.nullMask = nullMask;
  }

  static create(name: string, raw: string[]): ColumnData {
    const stats: ColumnStats = { nulls: 0, distinct: 0, samples: [], min: null, max: null };
    const nullMask = new BitSet(raw.length);
    const seen = new Set<string>();

    for (let i = 0; i < raw.length; i++) {
      const value = raw[i];
      if (isNullToken(value)) {
        stats.nulls++;
        nullMask.set(i);
        continue;
      }
      seen.add(value);
      if (stats.samples.length < 5) stats.samples.push(value);
    }
    stats.distinct = seen.size;

    const sample = stratifiedSample(raw, 1000);
    const inferred = inferColumnType(sample, stats, raw.length);
    return new ColumnData(
      name,
      raw,
      inferred.type,
      inferred.dateOrder ?? "dmy",
      stats,
      nullMask,
    );
  }

  setType(type: ColumnType): void {
    this.type = type;
    this.nums = null;
    this.cats = null;
    this.stats.min = null;
    this.stats.max = null;
    if (type === "date") {
      this.dateOrder = detectDateOrder(stratifiedSample(this.raw, 500));
    }
  }

  normalized(): string[] {
    if (this.norm === null) {
      this.norm = this.raw.map((value) => (isNullToken(value) ? "" : normalize(value)));
    }
    return this.norm;
  }

  fuzzyIndex(): FuzzyIndex {
    if (this.fuzzy === null) {
      const index = new FuzzyIndex();
      index.build(this.raw);
      this.fuzzy = index;
    }
    return this.fuzzy;
  }

  numbers(): Float64Array {
    if (this.nums === null) {
      const isDate = this.type === "date";
      const out = new Float64Array(this.raw.length);
      let min = Infinity;
      let max = -Infinity;
      for (let i = 0; i < this.raw.length; i++) {
        const value = this.raw[i];
        const parsed = isNullToken(value)
          ? NaN
          : isDate
            ? parseDate(value, this.dateOrder)
            : parseNumber(value);
        out[i] = parsed;
        if (Number.isFinite(parsed)) {
          if (parsed < min) min = parsed;
          if (parsed > max) max = parsed;
        }
      }
      this.stats.min = Number.isFinite(min) ? min : null;
      this.stats.max = Number.isFinite(max) ? max : null;
      this.nums = out;
    }
    return this.nums;
  }

  categories(): CategorySet {
    if (this.cats === null) {
      const index = new Map<string, number>();
      const labels: string[] = [];
      const counts: number[] = [];
      const rowCategory = new Uint32Array(this.raw.length);

      for (let i = 0; i < this.raw.length; i++) {
        const value = this.raw[i];
        const key = isNullToken(value) ? "(empty)" : value.trim();
        let id = index.get(key);
        if (id === undefined) {
          id = labels.length;
          index.set(key, id);
          labels.push(key);
          counts.push(0);
        }
        rowCategory[i] = id;
        counts[id]++;
      }

      const bits = labels.map(() => new BitSet(this.raw.length));
      for (let i = 0; i < rowCategory.length; i++) bits[rowCategory[i]].set(i);

      const order = labels
        .map((_, i) => i)
        .sort((a, b) => (labels[a] < labels[b] ? -1 : labels[a] > labels[b] ? 1 : 0));

      this.cats = {
        labels: order.map((i) => labels[i]),
        counts: order.map((i) => counts[i]),
        bits: order.map((i) => bits[i]),
      };
    }
    return this.cats;
  }
}

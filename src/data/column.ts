import { BitSet } from "../search/bitset.js";
import { FuzzyIndex } from "../search/fuzzy-index.js";
import { normalize } from "../search/normalize.js";
import { detectDateOrder, parseDate, type DateOrder } from "../parse/dates.js";
import {
  inferColumnType,
  stratifiedSample,
  type ColumnStats,
  type InferredType,
} from "../parse/infer.js";
import { isNullWithPolicy, EMPTY_NULL_POLICY, type NullPolicy } from "../parse/null-tokens.js";
import { parseNumber } from "../parse/numbers.js";
import { valueLength } from "../parse/value-length.js";
import type { ColumnType } from "../types.js";

export interface NullTokenCount {
  label: string;
  count: number;
}

export interface CategorySet {
  labels: string[];
  counts: number[];
  bits: BitSet[];
}

const TOP_VALUES = 5;

export class ColumnData {
  type: ColumnType;
  dateOrder: DateOrder;
  readonly stats: ColumnStats;
  readonly nullMask: BitSet;

  private norm: string[] | null = null;
  private fuzzy: FuzzyIndex | null = null;
  private nums: Float64Array | null = null;
  private cats: CategorySet | null = null;
  private medianValue: number | null = null;
  private medianComputed = false;
  private histCache: { bins: number[]; min: number; max: number } | null = null;

  constructor(
    public name: string,
    readonly raw: string[],
    type: ColumnType,
    dateOrder: DateOrder,
    stats: ColumnStats,
    nullMask: BitSet,
    readonly nullPolicy: NullPolicy,
    readonly nullTokens: readonly NullTokenCount[],
  ) {
    this.type = type;
    this.dateOrder = dateOrder;
    this.stats = stats;
    this.nullMask = nullMask;
  }

  static create(
    name: string,
    raw: string[],
    nullPolicy: NullPolicy = EMPTY_NULL_POLICY,
  ): ColumnData {
    const stats: ColumnStats = {
      nulls: 0,
      distinct: 0,
      samples: [],
      topValues: [],
      min: null,
      max: null,
      mean: null,
      stddev: null,
      minLength: null,
      maxLength: null,
      avgLength: null,
    };
    const nullMask = new BitSet(raw.length);
    const sample = stratifiedSample(raw, 1000);

    // A cheap sample-only inference decides whether exact counts are needed:
    // numeric/date columns display a histogram, not top values, so a plain
    // distinct Set is enough and saves two hash lookups per cell.
    const pre = preInfer(sample, nullPolicy);
    const collectCounts =
      pre.type !== "integer" && pre.type !== "number" && pre.type !== "date";

    const counts = collectCounts ? new Map<string, number>() : null;
    const distinct = counts === null ? new Set<string>() : null;
    const top: { label: string; count: number }[] = [];
    const nullCounts = new Map<string, number>();
    let presentCount = 0;
    let lengthSum = 0;
    let minLength = Infinity;
    let maxLength = -Infinity;

    for (let i = 0; i < raw.length; i++) {
      const value = raw[i];
      if (isNullWithPolicy(value, nullPolicy)) {
        stats.nulls++;
        nullMask.set(i);
        nullCounts.set(value, (nullCounts.get(value) ?? 0) + 1);
        continue;
      }
      if (counts !== null) counts.set(value, (counts.get(value) ?? 0) + 1);
      else distinct?.add(value);
      if (stats.samples.length < 5) stats.samples.push(value);
      presentCount++;
      const length = valueLength(value);
      lengthSum += length;
      if (length < minLength) minLength = length;
      if (length > maxLength) maxLength = length;
    }
    stats.distinct = counts !== null ? counts.size : (distinct?.size ?? 0);
    if (presentCount > 0) {
      stats.minLength = minLength;
      stats.maxLength = maxLength;
      stats.avgLength = lengthSum / presentCount;
    }

    // Bounded top-N selection: no full sort over potentially millions of keys.
    if (counts !== null) {
      for (const [label, count] of counts) {
        if (top.length < TOP_VALUES) {
          top.push({ label, count });
          top.sort((a, b) => b.count - a.count);
        } else if (count > top[TOP_VALUES - 1].count) {
          top[TOP_VALUES - 1] = { label, count };
          top.sort((a, b) => b.count - a.count);
        }
      }
    }
    stats.topValues = top;

    const inferred = inferColumnType(sample, stats, raw.length, (value) =>
      isNullWithPolicy(value, nullPolicy),
    );
    const nullTokens = [...nullCounts.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
    return new ColumnData(
      name,
      raw,
      inferred.type,
      inferred.dateOrder ?? "dmy",
      stats,
      nullMask,
      nullPolicy,
      nullTokens,
    );
  }

  /** True when this column treats the exact cell value as missing. */
  isNull(value: string): boolean {
    return isNullWithPolicy(value, this.nullPolicy);
  }

  get fuzzyBuilt(): boolean {
    return this.fuzzy !== null;
  }

  setType(type: ColumnType): void {
    this.type = type;
    this.nums = null;
    this.cats = null;
    this.stats.min = null;
    this.stats.max = null;
    this.stats.mean = null;
    this.stats.stddev = null;
    this.medianValue = null;
    this.medianComputed = false;
    this.histCache = null;
    if (type === "date") {
      this.dateOrder = detectDateOrder(stratifiedSample(this.raw, 500));
    }
  }

  normalized(): string[] {
    if (this.norm === null) {
      this.norm = this.raw.map((value) => (this.isNull(value) ? "" : normalize(value)));
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
      const checkPolicy = this.nullPolicy.extra.size > 0;
      const out = new Float64Array(this.raw.length);
      let min = Infinity;
      let max = -Infinity;
      let sum = 0;
      let sumSquares = 0;
      let finiteCount = 0;

      for (let i = 0; i < this.raw.length; i++) {
        const value = this.raw[i];
        // Null markers parse to NaN; only a custom extra-null token (which may
        // be numeric, e.g. -999) needs an explicit policy check.
        const parsed =
          checkPolicy && this.isNull(value)
            ? NaN
            : isDate
              ? parseDate(value, this.dateOrder)
              : parseNumber(value);
        out[i] = parsed;
        if (Number.isFinite(parsed)) {
          if (parsed < min) min = parsed;
          if (parsed > max) max = parsed;
          sum += parsed;
          sumSquares += parsed * parsed;
          finiteCount++;
        }
      }

      if (finiteCount > 0) {
        const mean = sum / finiteCount;
        this.stats.min = min;
        this.stats.max = max;
        this.stats.mean = mean;
        this.stats.stddev = Math.sqrt(Math.max(0, sumSquares / finiteCount - mean * mean));
      } else {
        this.stats.min = null;
        this.stats.max = null;
        this.stats.mean = null;
        this.stats.stddev = null;
      }
      this.nums = out;
    }
    return this.nums;
  }

  /**
   * Static full-column histogram for numeric/date columns. One O(rows) scan,
   * cached; the UI uses it as the baseline distribution behind active range
   * filters.
   */
  histogram(binCount = 64): { bins: number[]; min: number; max: number } | null {
    const numeric = this.type === "integer" || this.type === "number" || this.type === "date";
    if (!numeric) return null;
    if (this.histCache !== null && this.histCache.bins.length === binCount) return this.histCache;

    const numbers = this.numbers();
    const min = this.stats.min;
    const max = this.stats.max;
    if (min === null || max === null) return null;

    const bins = new Array<number>(binCount).fill(0);
    if (max > min) {
      const scale = binCount / (max - min);
      for (let i = 0; i < numbers.length; i++) {
        const value = numbers[i];
        if (!Number.isFinite(value)) continue;
        let bin = Math.floor((value - min) * scale);
        if (bin < 0) bin = 0;
        else if (bin >= binCount) bin = binCount - 1;
        bins[bin]++;
      }
    } else {
      for (let i = 0; i < numbers.length; i++) {
        if (Number.isFinite(numbers[i])) bins[0]++;
      }
    }

    this.histCache = { bins, min, max };
    return this.histCache;
  }

  /**
   * Median over a strided sample when the column is larger than maxSamples.
   * Avoids sorting millions of values for the stats modal; the estimate is
   * accurate to roughly one sampling step across the value range.
   */
  medianSampled(maxSamples = 50_000): number | null {
    const numbers = this.numbers();
    if (numbers.length <= maxSamples) return this.median();
    const step = numbers.length / maxSamples;
    const sample: number[] = [];
    for (let i = 0; i < maxSamples; i++) {
      const value = numbers[Math.floor((i + 0.5) * step)];
      if (Number.isFinite(value)) sample.push(value);
    }
    if (sample.length === 0) return null;
    sample.sort((a, b) => a - b);
    const mid = sample.length >>> 1;
    return sample.length % 2 === 0 ? (sample[mid - 1] + sample[mid]) / 2 : sample[mid];
  }

  /** Computed lazily (sorts a copy of the numeric values). Cached afterwards. */
  median(): number | null {
    if (!this.medianComputed) {
      const numbers = this.numbers();
      const finite: number[] = [];
      for (let i = 0; i < numbers.length; i++) {
        if (Number.isFinite(numbers[i])) finite.push(numbers[i]);
      }
      if (finite.length === 0) {
        this.medianValue = null;
      } else {
        finite.sort((a, b) => a - b);
        const mid = finite.length >>> 1;
        this.medianValue =
          finite.length % 2 === 0 ? (finite[mid - 1] + finite[mid]) / 2 : finite[mid];
      }
      this.medianComputed = true;
    }
    return this.medianValue;
  }

  categories(): CategorySet {
    if (this.cats === null) {
      const index = new Map<string, number>();
      const labels: string[] = [];
      const counts: number[] = [];
      const rowCategory = new Uint32Array(this.raw.length);

      for (let i = 0; i < this.raw.length; i++) {
        const value = this.raw[i];
        const key = this.isNull(value) ? "(empty)" : value.trim();
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

/** Sample-only guess used to pick the cheaper ingest path. */
function preInfer(sample: readonly string[], policy: NullPolicy): InferredType {
  let nulls = 0;
  const seen = new Set<string>();
  for (const value of sample) {
    if (isNullWithPolicy(value, policy)) {
      nulls++;
      continue;
    }
    seen.add(value);
  }

  const sampleStats: ColumnStats = {
    nulls,
    distinct: seen.size,
    samples: [],
    topValues: [],
    min: null,
    max: null,
    mean: null,
    stddev: null,
    minLength: null,
    maxLength: null,
    avgLength: null,
  };
  return inferColumnType(sample, sampleStats, sample.length, (value) =>
    isNullWithPolicy(value, policy),
  );
}

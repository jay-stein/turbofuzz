import { valueLength } from "../parse/value-length.js";
import { BitSet } from "../search/bitset.js";
import type { ColumnData } from "./column.js";

export interface ValueFence {
  center: number;
  lo: number;
  hi: number;
  log: boolean;
}

export interface LengthFence {
  lo: number;
  hi: number;
}

export interface ColumnAnomalies {
  valueFence: ValueFence | null;
  lengthFence: LengthFence | null;
}

export interface Anomalies {
  valueBits: BitSet;
  lengthBits: BitSet;
  columns: ColumnAnomalies[];
}

/** Modified z-score (Iglewicz–Hoaglin): flag |0.6745 (x − median) / MAD| > 3.5. */
const MAD_RADIUS = 3.5 / 0.6745;
const MEAN_DEVIATION_RADIUS = 3.5 / 0.7979;
const MAX_SAMPLES = 50_000;
const MIN_SAMPLES = 20;
const MIN_LENGTH_SAMPLES = 8;
/** Long-value rule: flag lengths above LENGTH_FACTOR × the 90th percentile. */
const LENGTH_QUANTILE = 0.9;
const LENGTH_FACTOR = 3;
/** Bowley skewness above which positive columns use multiplicative (log) fences. */
const LOG_SKEW_THRESHOLD = 0.1;

function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 1) return sorted[0];
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  const weight = position - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

function sampleNumbers(numbers: Float64Array): number[] {
  const step = Math.max(1, Math.floor(numbers.length / MAX_SAMPLES));
  const sample: number[] = [];
  for (let i = 0; i < numbers.length; i += step) {
    const value = numbers[i];
    if (Number.isFinite(value)) sample.push(value);
  }
  return sample;
}

/**
 * MAD fences around the median of a sorted sample, with a mean-deviation
 * fallback when MAD is zero (most values identical) so a lone large value is
 * still flagged.
 */
function medianRadius(sorted: number[]): { center: number; radius: number } | null {
  const center = quantile(sorted, 0.5);
  const deviations = sorted.map((value) => Math.abs(value - center));
  deviations.sort((a, b) => a - b);

  const mad = quantile(deviations, 0.5);
  if (mad > 0) return { center, radius: mad * MAD_RADIUS };

  let sum = 0;
  for (const deviation of deviations) sum += deviation;
  const meanDeviation = sum / deviations.length;
  if (meanDeviation <= 0) return null;
  return { center, radius: meanDeviation * MEAN_DEVIATION_RADIUS };
}

/**
 * Numeric fences per column. Strictly positive, right-skewed columns (prices,
 * incomes, counts) are fenced in log space so large-but-ordinary values are
 * not all flagged; everything else uses linear fences.
 */
function numericFence(column: ColumnData): ValueFence | null {
  if (column.type !== "integer" && column.type !== "number") return null;
  const numbers = column.numbers();
  const sample = sampleNumbers(numbers);
  if (sample.length < MIN_SAMPLES) return null;

  sample.sort((a, b) => a - b);
  const q1 = quantile(sample, 0.25);
  const q3 = quantile(sample, 0.75);
  const median = quantile(sample, 0.5);
  const iqr = q3 - q1;
  const bowleySkew = iqr > 0 ? (q3 + q1 - 2 * median) / iqr : 0;

  if (sample[0] > 0 && bowleySkew > LOG_SKEW_THRESHOLD) {
    const logs = sample.map((value) => Math.log(value));
    const logStats = medianRadius(logs);
    if (logStats === null) return null;
    return {
      center: Math.exp(logStats.center),
      lo: Math.exp(logStats.center - logStats.radius),
      hi: Math.exp(logStats.center + logStats.radius),
      log: true,
    };
  }

  const stats = medianRadius(sample);
  if (stats === null) return null;
  return {
    center: stats.center,
    lo: stats.center - stats.radius,
    hi: stats.center + stats.radius,
    log: false,
  };
}

/**
 * Length fences: a value is overlong when its trimmed length exceeds three
 * times the column's 90th-percentile length. Only the long side is flagged,
 * which keeps this to genuine stand-out values.
 */
function lengthFenceFor(column: ColumnData): LengthFence | null {
  if (
    column.type !== "string" &&
    column.type !== "category" &&
    column.type !== "identifier"
  ) {
    return null;
  }
  const raw = column.raw;
  const nullMask = column.nullMask;
  const step = Math.max(1, Math.floor(raw.length / MAX_SAMPLES));
  const lengths: number[] = [];
  for (let i = 0; i < raw.length; i += step) {
    if (!nullMask.get(i)) lengths.push(valueLength(raw[i]));
  }
  if (lengths.length < MIN_LENGTH_SAMPLES) return null;

  lengths.sort((a, b) => a - b);
  const p90 = quantile(lengths, LENGTH_QUANTILE);
  if (p90 <= 0) return null;
  return { lo: 0, hi: p90 * LENGTH_FACTOR };
}

/**
 * One-time O(cells) pass producing row-level outlier masks plus the per-column
 * fences the UI uses to tint the offending cells.
 */
export function computeAnomalies(
  columns: readonly ColumnData[],
  rowCount: number,
): Anomalies {
  const valueBits = new BitSet(rowCount);
  const lengthBits = new BitSet(rowCount);
  const perColumn: ColumnAnomalies[] = [];

  for (const column of columns) {
    const valueFence = numericFence(column);
    if (valueFence !== null) {
      const numbers = column.numbers();
      for (let row = 0; row < rowCount; row++) {
        const value = numbers[row];
        if (Number.isFinite(value) && (value < valueFence.lo || value > valueFence.hi)) {
          valueBits.set(row);
        }
      }
    }

    const lengthFence = lengthFenceFor(column);
    if (lengthFence !== null) {
      const raw = column.raw;
      for (let row = 0; row < rowCount; row++) {
        if (column.nullMask.get(row)) continue;
        const length = valueLength(raw[row]);
        if (length < lengthFence.lo || length > lengthFence.hi) {
          lengthBits.set(row);
        }
      }
    }

    perColumn.push({ valueFence, lengthFence });
  }

  return { valueBits, lengthBits, columns: perColumn };
}

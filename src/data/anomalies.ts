import { valueLength } from "../parse/value-length.js";
import { BitSet } from "../search/bitset.js";
import type { ColumnData } from "./column.js";

export interface ValueFence {
  center: number;
  radius: number;
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
 * MAD fences per numeric column. When MAD is zero (most values identical) the
 * mean absolute deviation around the median is used instead, so a lone large
 * value is still flagged.
 */
function numericFence(column: ColumnData): ValueFence | null {
  if (column.type !== "integer" && column.type !== "number") return null;
  const numbers = column.numbers();
  const sample = sampleNumbers(numbers);
  if (sample.length < MIN_SAMPLES) return null;

  sample.sort((a, b) => a - b);
  const center = quantile(sample, 0.5);
  const deviations = sample.map((value) => Math.abs(value - center));
  deviations.sort((a, b) => a - b);

  const mad = quantile(deviations, 0.5);
  if (mad > 0) return { center, radius: mad * MAD_RADIUS };

  let sum = 0;
  for (const deviation of deviations) sum += deviation;
  const meanDeviation = sum / deviations.length;
  if (meanDeviation <= 0) return null;
  return { center, radius: meanDeviation * MEAN_DEVIATION_RADIUS };
}

/** Per-column Tukey fences (1.5×IQR) on trimmed value lengths. */
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
  const q1 = quantile(lengths, 0.25);
  const q3 = quantile(lengths, 0.75);
  const iqr = q3 - q1;
  if (iqr <= 0) return null;
  return { lo: Math.max(0, q1 - 1.5 * iqr), hi: q3 + 1.5 * iqr };
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
        if (
          Number.isFinite(value) &&
          Math.abs(value - valueFence.center) > valueFence.radius
        ) {
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

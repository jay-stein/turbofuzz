import type { ColumnData } from "./column.js";
import { categoryCodes } from "./chart-series.js";

export interface DistributionChange {
  column: number;
  label: string;
  kind: "numeric" | "category";
  /** Population Stability Index (numeric) or Cramér's V (category). */
  effect: number;
  firstRows: number;
  secondRows: number;
  /** Plain-language description of the largest move. */
  detail: string;
}

export interface DistributionOptions {
  maxColumns?: number;
  minRows?: number;
  /** Report only changes at or above this effect (0.1 = mild). */
  minEffect?: number;
}

function quantiles(sorted: readonly number[], count: number): number[] {
  const out: number[] = [];
  for (let index = 1; index < count; index++) {
    const position = ((sorted.length - 1) * index) / count;
    const lower = Math.floor(position);
    const upper = Math.ceil(position);
    const weight = position - lower;
    out.push((sorted[lower] ?? 0) * (1 - weight) + (sorted[upper] ?? 0) * weight);
  }
  return out;
}

function bucketOf(edges: readonly number[], value: number): number {
  let lo = 0;
  let hi = edges.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((edges[mid] ?? 0) <= value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

const EPSILON = 1e-4;

/**
 * Windowed distribution comparison between the first and second half of the
 * current row order. Numeric columns use PSI over first-half deciles; category
 * columns use Cramér's V between the half and the category. This catches
 * shifts over time or row order without needing a date column.
 */
export function computeDistributionChanges(
  columns: readonly ColumnData[],
  rowCount: number,
  ids: Uint32Array,
  options: DistributionOptions = {},
): DistributionChange[] {
  const maxColumns = Math.max(1, Math.floor(options.maxColumns ?? 6));
  const minRows = Math.max(20, Math.floor(options.minRows ?? 100));
  const minEffect = options.minEffect ?? 0.1;
  if (ids.length < minRows * 2) return [];

  const split = Math.floor(ids.length / 2);
  const changes: DistributionChange[] = [];

  const numeric: number[] = [];
  const category: number[] = [];
  columns.forEach((column, index) => {
    if (numeric.length < maxColumns && (column.type === "integer" || column.type === "number")) {
      numeric.push(index);
      return;
    }
    if (
      category.length < maxColumns &&
      (column.type === "category" || column.type === "boolean") &&
      column.stats.distinct >= 2 &&
      column.stats.distinct <= 40
    ) {
      category.push(index);
    }
  });

  for (const columnIndex of numeric) {
    const column = columns[columnIndex];
    if (column === undefined) continue;
    const numbers = column.numbers();
    const firstValues: number[] = [];
    const secondValues: number[] = [];
    for (let position = 0; position < ids.length; position++) {
      const row = ids[position] ?? 0;
      const value = numbers[row] ?? Number.NaN;
      if (!Number.isFinite(value)) continue;
      (position < split ? firstValues : secondValues).push(value);
    }
    if (firstValues.length < minRows || secondValues.length < minRows) continue;
    const sortedFirst = firstValues.slice().sort((a, b) => a - b);
    const edges = quantiles(sortedFirst, 10);
    if (edges.length === 0) continue;
    const firstCounts = new Array<number>(10).fill(0);
    const secondCounts = new Array<number>(10).fill(0);
    for (const value of firstValues) firstCounts[bucketOf(edges, value)]++;
    for (const value of secondValues) secondCounts[bucketOf(edges, value)]++;
    let psi = 0;
    let biggestMove = 0;
    let biggestBucket = 0;
    for (let bucket = 0; bucket < 10; bucket++) {
      const p = (firstCounts[bucket] ?? 0) / firstValues.length;
      const q = (secondCounts[bucket] ?? 0) / secondValues.length;
      psi += (p - q) * Math.log((p + EPSILON) / (q + EPSILON));
      const move = Math.abs(q - p);
      if (move > biggestMove) {
        biggestMove = move;
        biggestBucket = bucket;
      }
    }
    if (psi < minEffect) continue;
    const lower = edges[biggestBucket - 1] ?? -Infinity;
    const upper = edges[biggestBucket] ?? Infinity;
    const firstShare = ((firstCounts[biggestBucket] ?? 0) / firstValues.length) * 100;
    const secondShare = ((secondCounts[biggestBucket] ?? 0) / secondValues.length) * 100;
    const format = (value: number): string =>
      Number.isFinite(value) ? value.toLocaleString(undefined, { maximumFractionDigits: 2 }) : "∞";
    changes.push({
      column: columnIndex,
      label: column.name,
      kind: "numeric",
      effect: psi,
      firstRows: firstValues.length,
      secondRows: secondValues.length,
      detail: `values in ${format(lower)} – ${format(upper)} moved from ${firstShare.toFixed(
        1,
      )}% to ${secondShare.toFixed(1)}% of rows`,
    });
  }

  for (const columnIndex of category) {
    const column = columns[columnIndex];
    if (column === undefined) continue;
    const categories = column.categories();
    const codes = categoryCodes(categories.bits, rowCount);
    const k = categories.labels.length;
    const firstCounts = new Uint32Array(k);
    const secondCounts = new Uint32Array(k);
    let firstRows = 0;
    let secondRows = 0;
    for (let position = 0; position < ids.length; position++) {
      const row = ids[position] ?? 0;
      const code = codes[row] ?? 0;
      if (code >= k) continue;
      if (position < split) {
        firstCounts[code]++;
        firstRows++;
      } else {
        secondCounts[code]++;
        secondRows++;
      }
    }
    if (firstRows < minRows || secondRows < minRows) continue;
    const total = firstRows + secondRows;
    let chiSquare = 0;
    let biggestMove = 0;
    let biggestCode = 0;
    for (let code = 0; code < k; code++) {
      const observedFirst = firstCounts[code] ?? 0;
      const observedSecond = secondCounts[code] ?? 0;
      const expectedFirst = ((observedFirst + observedSecond) * firstRows) / total;
      const expectedSecond = ((observedFirst + observedSecond) * secondRows) / total;
      if (expectedFirst > 0) {
        chiSquare += ((observedFirst - expectedFirst) * (observedFirst - expectedFirst)) / expectedFirst;
      }
      if (expectedSecond > 0) {
        chiSquare +=
          ((observedSecond - expectedSecond) * (observedSecond - expectedSecond)) / expectedSecond;
      }
      const move = Math.abs(observedFirst / firstRows - observedSecond / secondRows);
      if (move > biggestMove) {
        biggestMove = move;
        biggestCode = code;
      }
    }
    // Two rows (halves) × k categories: min(df) = 1, so V = sqrt(χ² / n).
    const v = Math.sqrt(chiSquare / total);
    if (v < minEffect) continue;
    changes.push({
      column: columnIndex,
      label: column.name,
      kind: "category",
      effect: v,
      firstRows,
      secondRows,
      detail: `“${categories.labels[biggestCode] ?? "?"}” moved from ${(
        ((firstCounts[biggestCode] ?? 0) / firstRows) * 100
      ).toFixed(1)}% to ${(((secondCounts[biggestCode] ?? 0) / secondRows) * 100).toFixed(
        1,
      )}% of rows`,
    });
  }

  return changes.sort((a, b) => b.effect - a.effect);
}

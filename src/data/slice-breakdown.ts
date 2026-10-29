import type { ColumnData } from "./column.js";
import { categoryCodes } from "./chart-series.js";

/** One mark of a chart as the slice of its column it stands for. */
export type BreakdownRegion =
  | { kind: "values"; code: number }
  | { kind: "range"; min: number | null; max: number | null }
  | null;

export type BreakdownAgg = "count" | "sum" | "mean" | "min" | "max";

/**
 * For each region (a bar, bin or time period of another chart), reduces the
 * rows in `ids` that fall in it: a row count, or an aggregate of a measure.
 * Used to show how much of every mark comes from a hovered slice.
 *
 * Regions that are categories match by code; ranges match `min <= v <= max`,
 * with the first of two ranges sharing an edge winning, so adjacent histogram
 * bins never double count. Regions that are null (an "Other" bar) stay NaN.
 * Counts and sums are 0 for an empty region; mean, min and max are NaN.
 */
export function sliceBreakdown(
  ids: Uint32Array,
  column: ColumnData,
  regions: readonly BreakdownRegion[],
  measure: { values: Float64Array; agg: BreakdownAgg } | null,
  rowCount: number,
): Float64Array {
  const n = regions.length;
  const count = new Float64Array(n);
  const sum = new Float64Array(n);
  const min = new Float64Array(n).fill(Number.POSITIVE_INFINITY);
  const max = new Float64Array(n).fill(Number.NEGATIVE_INFINITY);

  const byCode = new Map<number, number>();
  const ranges: { index: number; min: number; max: number }[] = [];
  regions.forEach((region, index) => {
    if (region === null) return;
    if (region.kind === "values") {
      if (!byCode.has(region.code)) byCode.set(region.code, index);
    } else {
      ranges.push({
        index,
        min: region.min ?? Number.NEGATIVE_INFINITY,
        max: region.max ?? Number.POSITIVE_INFINITY,
      });
    }
  });
  ranges.sort((a, b) => a.min - b.min || a.index - b.index);

  const codes = byCode.size > 0 ? categoryCodes(column.categories().bits, rowCount) : null;
  const numbers = ranges.length > 0 ? column.numbers() : null;

  const regionOf = (row: number): number => {
    if (codes !== null) {
      const hit = byCode.get(codes[row] as number);
      if (hit !== undefined) return hit;
    }
    if (numbers !== null) {
      const value = numbers[row] as number;
      if (!Number.isFinite(value)) return -1;
      // Last range starting at or before the value. Only it and the one before can
      // hold the value (ranges are contiguous and at most share an edge); the
      // earlier one wins an edge so adjacent bins never double count.
      let lo = 0;
      let hi = ranges.length - 1;
      let found = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (ranges[mid]!.min <= value) {
          found = mid;
          lo = mid + 1;
        } else {
          hi = mid - 1;
        }
      }
      let pick = -1;
      for (let k = found; k >= 0 && k >= found - 1; k--) {
        const range = ranges[k]!;
        if (value >= range.min && value <= range.max) pick = k;
      }
      if (pick >= 0) return ranges[pick]!.index;
    }
    return -1;
  };

  const values = measure?.values ?? null;
  for (let position = 0; position < ids.length; position++) {
    const row = ids[position] as number;
    const region = regionOf(row);
    if (region < 0) continue;
    if (values === null) {
      count[region]! += 1;
      continue;
    }
    const value = values[row] as number;
    if (!Number.isFinite(value)) continue;
    count[region]! += 1;
    sum[region]! += value;
    if (value < min[region]!) min[region] = value;
    if (value > max[region]!) max[region] = value;
  }

  const agg = measure?.agg ?? "count";
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    if (regions[i] === null) {
      out[i] = Number.NaN;
      continue;
    }
    switch (agg) {
      case "count":
        out[i] = count[i]!;
        break;
      case "sum":
        out[i] = sum[i]!;
        break;
      case "mean":
        out[i] = count[i]! > 0 ? sum[i]! / count[i]! : Number.NaN;
        break;
      case "min":
        out[i] = count[i]! > 0 ? min[i]! : Number.NaN;
        break;
      case "max":
        out[i] = count[i]! > 0 ? max[i]! : Number.NaN;
        break;
    }
  }
  return out;
}

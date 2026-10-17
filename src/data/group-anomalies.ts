import { BitSet } from "../search/bitset.js";
import { categoryCodes } from "./chart-series.js";
import type { ColumnData } from "./column.js";

export interface GroupAnomalyExample {
  group: string;
  value: number;
  median: number;
  z: number;
}

export interface GroupAnomalyPair {
  valueColumn: number;
  groupColumn: number;
  valueLabel: string;
  groupLabel: string;
  flagged: number;
  groupsAnalysed: number;
  examples: GroupAnomalyExample[];
}

export interface GroupAnomaliesResult {
  pairs: GroupAnomalyPair[];
  /** Flagged rows per value column (for the column-scoped filter). */
  columnBits: (BitSet | null)[];
  /** Every flagged row across the analysed pairs. */
  combined: BitSet;
  totalFlagged: number;
}

export interface GroupAnomalyOptions {
  maxPairs?: number;
  minGroup?: number;
  /** Robust-z threshold (0.6745 × (value − median) / MAD). */
  z?: number;
}

function median(sorted: readonly number[]): number {
  const length = sorted.length;
  if (length === 0) return Number.NaN;
  const mid = length >>> 1;
  return length % 2 === 1 ? (sorted[mid] ?? NaN) : ((sorted[mid - 1] ?? NaN) + (sorted[mid] ?? NaN)) / 2;
}

/**
 * Group-relative anomalies: values that are normal on their own but unusual
 * next to their peers in the same category ("this transaction is huge for
 * Electronics"). Robust z per group with a minimum group size, so small
 * categories never flag half their rows.
 */
export function computeGroupAnomalies(
  columns: readonly ColumnData[],
  rowCount: number,
  options: GroupAnomalyOptions = {},
): GroupAnomaliesResult {
  const maxPairs = Math.max(0, Math.floor(options.maxPairs ?? 4));
  const minGroup = Math.max(5, Math.floor(options.minGroup ?? 30));
  const threshold = options.z ?? 3.5;

  const numeric: number[] = [];
  const groups: number[] = [];
  columns.forEach((column, index) => {
    const isNumeric = column.type === "integer" || column.type === "number";
    if (
      isNumeric &&
      numeric.length < 3 &&
      column.stats.distinct >= 10 &&
      column.stats.distinct < rowCount
    ) {
      numeric.push(index);
      return;
    }
    const categories = column.categories();
    if (
      (column.type === "category" || column.type === "boolean") &&
      groups.length < 2 &&
      categories.labels.length >= 2 &&
      categories.labels.length <= 50
    ) {
      groups.push(index);
    }
  });

  const combined = new BitSet(rowCount);
  const columnBits: (BitSet | null)[] = new Array(columns.length).fill(null);
  const pairs: GroupAnomalyPair[] = [];

  for (const valueColumn of numeric) {
    const valueData = columns[valueColumn];
    if (valueData === undefined) continue;
    const numbers = valueData.numbers();
    for (const groupColumn of groups) {
      if (pairs.length >= maxPairs) break;
      const groupData = columns[groupColumn];
      if (groupData === undefined) continue;
      const categories = groupData.categories();
      if (categories === null) continue;
      const codes = categoryCodes(categories.bits, rowCount);
      const labelCount = categories.labels.length;
      const buckets: number[][] = categories.labels.map(() => []);
      const bucketRows: number[][] = categories.labels.map(() => []);
      for (let row = 0; row < rowCount; row++) {
        const code = codes[row] ?? 0;
        if (code >= labelCount) continue;
        const value = numbers[row];
        if (!Number.isFinite(value)) continue;
        buckets[code]?.push(value);
        bucketRows[code]?.push(row);
      }

      const pairBits = new BitSet(rowCount);
      let flagged = 0;
      let groupsAnalysed = 0;
      const examples: GroupAnomalyExample[] = [];
      for (let code = 0; code < labelCount; code++) {
        const values = buckets[code];
        const rows = bucketRows[code];
        if (values === undefined || rows === undefined || values.length < minGroup) continue;
        const sorted = values.slice().sort((a, b) => a - b);
        const center = median(sorted);
        if (!Number.isFinite(center)) continue;
        const deviations = sorted.map((value) => Math.abs(value - center)).sort((a, b) => a - b);
        const mad = median(deviations);
        if (!(mad > 0)) continue;
        groupsAnalysed++;
        for (let index = 0; index < values.length; index++) {
          const value = values[index] ?? Number.NaN;
          const z = (0.6745 * (value - center)) / mad;
          if (Math.abs(z) <= threshold) continue;
          const row = rows[index] ?? 0;
          pairBits.set(row);
          flagged++;
          combined.set(row);
          if (valueColumnBits(columnBits, valueColumn) === null) {
            columnBits[valueColumn] = new BitSet(rowCount);
          }
          columnBits[valueColumn]?.set(row);
          if (examples.length < 5) {
            examples.push({
              group: categories.labels[code] ?? "",
              value,
              median: center,
              z,
            });
          }
        }
      }
      if (flagged > 0) {
        pairs.push({
          valueColumn,
          groupColumn,
          valueLabel: valueData.name,
          groupLabel: groupData.name,
          flagged,
          groupsAnalysed,
          examples,
        });
      }
    }
    if (pairs.length >= maxPairs) break;
  }

  return {
    pairs,
    columnBits,
    combined,
    totalFlagged: combined.count(),
  };
}

function valueColumnBits(bits: (BitSet | null)[], column: number): BitSet | null {
  return bits[column] ?? null;
}

import type { ColumnData } from "../data/column.js";
import type { BitSet } from "./bitset.js";
import type { ColumnFilter } from "./query-engine.js";

/** Stable string for the filters other than `exclude`, used for cache keys. */
export function filtersSignature(
  filters: ReadonlyMap<number, ColumnFilter>,
  exclude: number,
): string {
  const parts: string[] = [];
  for (const [columnIndex, filter] of filters) {
    if (columnIndex === exclude) continue;
    parts.push(`${columnIndex}:${JSON.stringify(filter)}`);
  }
  return parts.join("|");
}

/**
 * Filtered histogram for a numeric/date column. `baseBits` must be the result
 * of all *other* filters, so the distribution stays stable while the column's
 * own range is dragged.
 */
export function filteredHistogram(
  column: ColumnData,
  baseBits: BitSet,
  rowCount: number,
): number[] | null {
  const base = column.histogram();
  if (base === null) return null;

  const numbers = column.numbers();
  const binCount = base.bins.length;
  const bins = new Array<number>(binCount).fill(0);
  const scale = base.max > base.min ? binCount / (base.max - base.min) : 0;

  baseBits.forEachRow((row) => {
    if (row >= rowCount) return;
    const value = numbers[row];
    if (!Number.isFinite(value)) return;
    let bin = scale > 0 ? Math.floor((value - base.min) * scale) : 0;
    if (bin < 0) bin = 0;
    else if (bin >= binCount) bin = binCount - 1;
    bins[bin]++;
  });
  return bins;
}

/** Caches filtered histograms per column keyed by the other-filters signature. */
export class HistogramCache {
  private readonly entries = new Map<number, { signature: string; bins: number[] }>();

  get(columnIndex: number, signature: string): number[] | null {
    const entry = this.entries.get(columnIndex);
    if (entry === undefined || entry.signature !== signature) return null;
    return entry.bins;
  }

  set(columnIndex: number, signature: string, bins: number[]): void {
    this.entries.set(columnIndex, { signature, bins });
  }

  delete(columnIndex: number): void {
    this.entries.delete(columnIndex);
  }

  clear(): void {
    this.entries.clear();
  }
}

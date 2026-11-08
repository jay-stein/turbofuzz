import type { ColumnData } from "./column.js";

/** Rows read per column to learn its typical text length and how often values repeat. */
const SAMPLE = 2_000;
/**
 * Bytes per cell, per character and per distinct value, fitted to the heap
 * after loading seven real files (orders, surveys, census, housing, bike
 * trips, bank churn): within ±7% on five, about 30% high on small
 * low-cardinality files, which errs on the safe side for a warning.
 */
const PER_CELL = 12;
const PER_CHAR = 3.5;
const PER_DISTINCT = 32;

/**
 * An estimate of what a loaded table holds in memory, in bytes: a cost per
 * cell, per character (doubled when a column holds text outside Latin-1) and
 * per distinct value. Read from a sample of each column, so it takes a few
 * milliseconds even for millions of rows. For a gauge and a warning, not for
 * accounting.
 */
export function estimateTableBytes(columns: readonly ColumnData[], rowCount: number): number {
  if (rowCount === 0) return 0;
  let bytes = 0;
  const step = Math.max(1, Math.floor(rowCount / SAMPLE));
  for (const column of columns) {
    let chars = 0;
    let seen = 0;
    let wide = false;
    const distinct = new Set<string>();
    for (let row = 0; row < rowCount; row += step) {
      const value = column.raw[row] ?? "";
      chars += value.length;
      seen++;
      distinct.add(value);
      if (!wide) for (let i = 0; i < value.length; i++) if (value.charCodeAt(i) > 255) { wide = true; break; }
    }
    const average = seen === 0 ? 0 : chars / seen;
    // A nearly unique sample means a nearly unique column; otherwise the sample has seen most of the values.
    const share = seen === 0 ? 0 : distinct.size / seen;
    const unique = share >= 0.95 ? rowCount * share : Math.min(rowCount, distinct.size);
    bytes += rowCount * (PER_CELL + average * PER_CHAR * (wide ? 2 : 1)) + unique * PER_DISTINCT;
  }
  return Math.round(bytes);
}

/**
 * What loading a file will take, before it is read: the table it becomes
 * (its cells, and its characters, which are about the file's bytes), a
 * typical share of distinct values, and the file itself, held while it is
 * parsed.
 */
export function projectLoadBytes(fileBytes: number, cells: number): number {
  return Math.round(cells * (PER_CELL + 0.15 * PER_DISTINCT) + fileBytes * (PER_CHAR + 2));
}

export interface MemoryLimitInput {
  /** performance.memory.jsHeapSizeLimit (Chromium), when the browser gives it. */
  heapLimit?: number | null;
  /** navigator.deviceMemory in GB (Chromium; rounded and capped at 8), when given. */
  deviceMemoryGb?: number | null;
}

export interface MemoryLimit {
  bytes: number;
  /** Where the figure comes from, for the gauge's details. */
  source: "browser" | "device" | "default";
}

const GB = 1024 ** 3;

/**
 * About how much memory one tab may use before the browser stops it. The
 * browser's own heap limit when it says; otherwise half the device memory,
 * up to 4 GB (a tab rarely gets more, however much is installed); otherwise
 * a conservative 2 GB.
 */
export function memoryLimit(input: MemoryLimitInput): MemoryLimit {
  if (input.heapLimit != null && input.heapLimit > 0) return { bytes: input.heapLimit, source: "browser" };
  if (input.deviceMemoryGb != null && input.deviceMemoryGb > 0) return { bytes: Math.min(4 * GB, (input.deviceMemoryGb / 2) * GB), source: "device" };
  return { bytes: 2 * GB, source: "default" };
}

/** "420 MB", "1.3 GB": the gauge's short form. */
export function formatMemory(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(0, Math.round(bytes / 1024))} KB`;
  if (bytes < GB) return `${Math.round(bytes / (1024 * 1024))} MB`;
  return `${(bytes / GB).toFixed(bytes < 10 * GB ? 1 : 0)} GB`;
}

export type MemoryTone = "ok" | "warn" | "high";

/** Under 60% of the limit is fine, under 85% worth watching, above that close to the edge. */
export function memoryTone(used: number, limit: number): MemoryTone {
  const share = limit <= 0 ? 0 : used / limit;
  return share >= 0.85 ? "high" : share >= 0.6 ? "warn" : "ok";
}

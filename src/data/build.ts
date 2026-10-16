import { ColumnData } from "./column.js";
import { Dataset } from "./dataset.js";
import { computeDatasetStats } from "./stats.js";
import type { NumberLocale } from "../parse/numbers.js";

/** Fine-grained build progress, forwarded to the load panel in the UI. */
export interface BuildProgress {
  detail: string;
  current?: number;
  total?: number;
  /** "stats" is the post-column pass, so the UI can label it separately. */
  phase?: "build" | "stats";
}

export function buildDataset(
  name: string,
  headers: string[],
  rows: string[][],
  onProgress?: (progress: BuildProgress) => void,
  numberPrior: NumberLocale = "dot",
): Dataset {
  const rowCount = rows.length;
  const columnCount = headers.length;
  const columns = headers.map((header, columnIndex) => {
    onProgress?.({
      detail: `Building columns (${columnIndex + 1}/${columnCount})…`,
      current: columnIndex + 1,
      total: columnCount,
    });
    const raw = new Array<string>(rowCount);
    for (let row = 0; row < rowCount; row++) {
      raw[row] = rows[row][columnIndex] ?? "";
    }
    return ColumnData.create(header, raw, undefined, numberPrior);
  });
  return finishDataset(name, columns, rowCount, onProgress);
}

export interface AsyncBuildOptions {
  /** Yield to the event loop every N columns so pending messages are seen. */
  yieldEvery?: number;
  /** Checked between columns and before the stats pass; true aborts. */
  shouldCancel?: () => boolean;
}

const yieldTick = (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

/**
 * Cancellable variant of `buildDataset` for the worker: yields between column
 * builds so a `cancelLoad` message can be processed, and returns null when
 * cancelled. The synchronous buildDataset stays for tests and benchmarks.
 */
export async function buildDatasetAsync(
  name: string,
  headers: string[],
  rows: string[][],
  onProgress?: (progress: BuildProgress) => void,
  numberPrior: NumberLocale = "dot",
  options: AsyncBuildOptions = {},
): Promise<Dataset | null> {
  const rowCount = rows.length;
  const columnCount = headers.length;
  const columns: ColumnData[] = [];
  const yieldEvery = Math.max(1, options.yieldEvery ?? 4);
  for (let columnIndex = 0; columnIndex < columnCount; columnIndex++) {
    if (options.shouldCancel?.() === true) return null;
    onProgress?.({
      detail: `Building columns (${columnIndex + 1}/${columnCount})…`,
      current: columnIndex + 1,
      total: columnCount,
    });
    const raw = new Array<string>(rowCount);
    for (let row = 0; row < rowCount; row++) {
      raw[row] = rows[row][columnIndex] ?? "";
    }
    columns.push(ColumnData.create(headers[columnIndex], raw, undefined, numberPrior));
    if ((columnIndex + 1) % yieldEvery === 0) await yieldTick();
  }
  if (options.shouldCancel?.() === true) return null;
  await yieldTick();
  if (options.shouldCancel?.() === true) return null;
  return finishDataset(name, columns, rowCount, onProgress);
}

/** Shared stats + Dataset construction for the sync and async builders. */
function finishDataset(
  name: string,
  columns: ColumnData[],
  rowCount: number,
  onProgress?: (progress: BuildProgress) => void,
): Dataset {
  onProgress?.({ detail: "Computing dataset stats…", phase: "stats" });
  const {
    stats,
    duplicateBits,
    nullRowBits,
    rowHashes,
    valueAnomalyBits,
    lengthAnomalyBits,
    valueColumnBits,
    lengthColumnBits,
    valueFences,
    lengthFences,
  } = computeDatasetStats(columns, rowCount, (phase, current, total) => {
    onProgress?.({
      detail: `${phase} (${current}/${total})…`,
      current,
      total,
      phase: "stats",
    });
  });
  return new Dataset(
    name,
    rowCount,
    columns,
    stats,
    duplicateBits,
    nullRowBits,
    rowHashes,
    valueAnomalyBits,
    lengthAnomalyBits,
    valueColumnBits,
    lengthColumnBits,
    valueFences,
    lengthFences,
  );
}

/**
 * Builds a Dataset from already-materialised columns. Used by transforms that
 * change the row count or the column set (dedupe, group-by) and by rebuilds
 * after a column changed.
 */
export function datasetFromColumns(name: string, columns: ColumnData[]): Dataset {
  const rowCount = columns.length > 0 ? columns[0].raw.length : 0;
  const result = computeDatasetStats(columns, rowCount);
  return new Dataset(
    name,
    rowCount,
    columns,
    result.stats,
    result.duplicateBits,
    result.nullRowBits,
    result.rowHashes,
    result.valueAnomalyBits,
    result.lengthAnomalyBits,
    result.valueColumnBits,
    result.lengthColumnBits,
    result.valueFences,
    result.lengthFences,
  );
}

/**
 * Recomputes dataset-level stats/bitsets after one or more columns changed and
 * returns a fresh Dataset. Column objects that were not affected are reused, so
 * their lazy caches stay warm; only the shared row-level pass is redone.
 */
export function rebuildDataset(current: Dataset, columns: ColumnData[]): Dataset {
  return datasetFromColumns(current.name, columns);
}

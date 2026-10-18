import { ColumnData } from "./column.js";
import { Dataset } from "./dataset.js";
import { computeDatasetStats, type IngestStats } from "./stats.js";
import { BitSet } from "../search/bitset.js";
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
  releaseRows = false,
): Dataset {
  const rowCount = rows.length;
  const columnCount = headers.length;
  const columns = extractColumns(
    headers,
    rows,
    rowCount,
    numberPrior,
    releaseRows,
    (columnIndex) => {
      onProgress?.({
        detail: `Building columns (${columnIndex + 1}/${columnCount})…`,
        current: columnIndex + 1,
        total: columnCount,
      });
    },
  );
  return finishDataset(name, columns, rowCount, onProgress);
}

/** Row chunks large enough to amortise the pass, small enough to release. */
const RELEASE_CHUNK_ROWS = 25_000;

/**
 * Extracts the per-column raw arrays from the row-major grid. With
 * `releaseRows` the processed row slots are cleared chunk by chunk, so the
 * grid and the finished columns never coexist whole (callers give up the
 * row references; the worker owns its grids).
 */
function extractColumns(
  headers: string[],
  rows: string[][],
  rowCount: number,
  numberPrior: NumberLocale,
  releaseRows: boolean,
  onColumn: (columnIndex: number) => void,
): ColumnData[] {
  const columnCount = headers.length;
  const rawByColumn: string[][] = headers.map(() => new Array<string>(rowCount));
  if (releaseRows && rowCount > RELEASE_CHUNK_ROWS) {
    for (let start = 0; start < rowCount; start += RELEASE_CHUNK_ROWS) {
      const end = Math.min(rowCount, start + RELEASE_CHUNK_ROWS);
      for (let c = 0; c < columnCount; c++) {
        const target = rawByColumn[c];
        for (let row = start; row < end; row++) target[row] = rows[row]?.[c] ?? "";
      }
      for (let row = start; row < end; row++) rows[row] = null as unknown as string[];
    }
  } else {
    for (let c = 0; c < columnCount; c++) {
      const target = rawByColumn[c];
      for (let row = 0; row < rowCount; row++) target[row] = rows[row]?.[c] ?? "";
    }
  }
  const columns: ColumnData[] = [];
  for (let c = 0; c < columnCount; c++) {
    onColumn(c);
    const column = ColumnData.create(headers[c], rawByColumn[c], undefined, numberPrior);
    if (/^_input_filename(?:_\d+)?$/i.test(headers[c])) column.role = "provenance";
    columns.push(column);
  }
  return columns;
}

export interface AsyncBuildOptions {
  /** Yield to the event loop every N columns so pending messages are seen. */
  yieldEvery?: number;
  /** Checked between columns and before the stats pass; true aborts. */
  shouldCancel?: () => boolean;
  /** Return a usable table immediately and compute heavy metrics later. */
  deferStats?: boolean;
}

const yieldTick = (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

/**
 * Cancellable variant of `buildDataset` for the worker: extracts the grid in
 * chunks (releasing rows as it goes) and yields between chunks and columns so
 * a `cancelLoad` message can be processed. Returns null when cancelled. The
 * synchronous buildDataset stays for tests and benchmarks.
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
  const yieldEvery = Math.max(1, options.yieldEvery ?? 4);
  const rawByColumn: string[][] = headers.map(() => new Array<string>(rowCount));

  for (let start = 0; start < rowCount; start += RELEASE_CHUNK_ROWS) {
    if (options.shouldCancel?.() === true) return null;
    const end = Math.min(rowCount, start + RELEASE_CHUNK_ROWS);
    for (let c = 0; c < columnCount; c++) {
      const target = rawByColumn[c];
      for (let row = start; row < end; row++) target[row] = rows[row]?.[c] ?? "";
    }
    for (let row = start; row < end; row++) rows[row] = null as unknown as string[];
    await yieldTick();
  }

  const columns: ColumnData[] = [];
  for (let columnIndex = 0; columnIndex < columnCount; columnIndex++) {
    if (options.shouldCancel?.() === true) return null;
    onProgress?.({
      detail: `Building columns (${columnIndex + 1}/${columnCount})…`,
      current: columnIndex + 1,
      total: columnCount,
    });
    const column = ColumnData.create(
      headers[columnIndex],
      rawByColumn[columnIndex],
      undefined,
      numberPrior,
    );
    if (/^_input_filename(?:_\d+)?$/i.test(headers[columnIndex])) {
      column.role = "provenance";
    }
    columns.push(column);
    if ((columnIndex + 1) % yieldEvery === 0) await yieldTick();
  }
  if (options.shouldCancel?.() === true) return null;
  await yieldTick();
  if (options.shouldCancel?.() === true) return null;
  if (options.deferStats === true) {
    onProgress?.({ detail: "Dataset metrics deferred.", phase: "stats" });
    return preliminaryDataset(name, columns, rowCount);
  }
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
    patternProfiles,
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
    patternProfiles,
  );
}

/** A usable dataset with cheap placeholder metrics, replaced after load. */
export function preliminaryDataset(
  name: string,
  columns: ColumnData[],
  rowCount: number,
): Dataset {
  const content = columns.filter((column) => column.role !== "provenance");
  const totalNullCells = content.reduce((sum, column) => sum + column.stats.nulls, 0);
  const empty = (): BitSet => new BitSet(rowCount);
  const nulls = (): (BitSet | null)[] => columns.map(() => null);
  return new Dataset(
    name,
    rowCount,
    columns,
    {
      duplicateRows: 0,
      duplicateGroups: 0,
      rowsInDuplicateGroups: 0,
      emptyRows: 0,
      rowsWithNulls: 0,
      totalNullCells,
      totalCells: rowCount * content.length,
      valueAnomalyRows: 0,
      lengthAnomalyRows: 0,
      computeMs: 0,
    },
    empty(),
    empty(),
    new Uint32Array(rowCount),
    empty(),
    empty(),
    nulls(),
    nulls(),
    columns.map(() => null),
    columns.map(() => null),
    columns.map(() => null),
  );
}

/** Finalize deferred metrics without rebuilding the columns. */
export function recomputeDatasetStats(
  current: Dataset,
  onProgress?: (phase: string, current: number, total: number) => void,
): { dataset: Dataset; result: IngestStats } {
  const result = computeDatasetStats(current.columns, current.rowCount, onProgress);
  return {
    dataset: new Dataset(
      current.name,
      current.rowCount,
      current.columns,
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
      result.patternProfiles,
    ),
    result,
  };
}
/**
 * Builds a Dataset from already-materialised columns. Used by transforms that
 * change the row count or the column set (dedupe, group-by) and by rebuilds
 * after a column changed.
 */
export function datasetFromColumns(
  name: string,
  columns: ColumnData[],
  reuse?: { previous: IngestStats; affected: readonly number[] },
): Dataset {
  const rowCount = columns.length > 0 ? columns[0].raw.length : 0;
  const result = computeDatasetStats(columns, rowCount, undefined, reuse);
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
    result.patternProfiles,
  );
}

/**
 * Recomputes dataset-level stats/bitsets after one or more columns changed and
 * returns a fresh Dataset. Column objects that were not affected are reused, so
 * their lazy caches stay warm; only the shared row-level pass is redone.
 */
export function rebuildDataset(
  current: Dataset,
  columns: ColumnData[],
  affected?: readonly number[],
): Dataset {
  const previous: IngestStats = {
    stats: current.stats,
    duplicateBits: current.duplicateBits,
    nullRowBits: current.nullRowBits,
    rowHashes: current.rowHashes,
    valueAnomalyBits: current.valueAnomalyBits,
    lengthAnomalyBits: current.lengthAnomalyBits,
    valueColumnBits: current.valueColumnBits,
    lengthColumnBits: current.lengthColumnBits,
    valueFences: current.valueFences,
    lengthFences: current.lengthFences,
    patternProfiles: current.patternProfiles,
  };
  return datasetFromColumns(
    current.name,
    columns,
    affected === undefined ? undefined : { previous, affected },
  );
}

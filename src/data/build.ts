import { ColumnData } from "./column.js";
import { Dataset } from "./dataset.js";
import { computeDatasetStats } from "./stats.js";

export function buildDataset(
  name: string,
  headers: string[],
  rows: string[][],
  onProgress?: (detail: string) => void,
): Dataset {
  const rowCount = rows.length;
  const columnCount = headers.length;
  const columns = headers.map((header, columnIndex) => {
    onProgress?.(`Building columns (${columnIndex + 1}/${columnCount})…`);
    const raw = new Array<string>(rowCount);
    for (let row = 0; row < rowCount; row++) {
      raw[row] = rows[row][columnIndex] ?? "";
    }
    return ColumnData.create(header, raw);
  });
  onProgress?.("Computing dataset stats…");
  const {
    stats,
    duplicateBits,
    nullRowBits,
    rowHashes,
    valueAnomalyBits,
    lengthAnomalyBits,
    valueFences,
    lengthFences,
  } = computeDatasetStats(columns, rowCount);
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

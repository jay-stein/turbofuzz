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
  const stats = computeDatasetStats(columns, rowCount);
  return new Dataset(name, rowCount, columns, stats);
}

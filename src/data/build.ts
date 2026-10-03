import { ColumnData } from "./column.js";
import { Dataset } from "./dataset.js";
import { computeDatasetStats } from "./stats.js";

export function buildDataset(name: string, headers: string[], rows: string[][]): Dataset {
  const rowCount = rows.length;
  const columns = headers.map((header, columnIndex) => {
    const raw = new Array<string>(rowCount);
    for (let row = 0; row < rowCount; row++) {
      raw[row] = rows[row][columnIndex] ?? "";
    }
    return ColumnData.create(header, raw);
  });
  const stats = computeDatasetStats(columns, rowCount);
  return new Dataset(name, rowCount, columns, stats);
}

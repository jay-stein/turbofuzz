import { ColumnData } from "./column.js";
import { Dataset } from "./dataset.js";

export function buildDataset(name: string, headers: string[], rows: string[][]): Dataset {
  const rowCount = rows.length;
  const columns = headers.map((header, columnIndex) => {
    const raw = new Array<string>(rowCount);
    for (let row = 0; row < rowCount; row++) {
      raw[row] = rows[row][columnIndex] ?? "";
    }
    return ColumnData.create(header, raw);
  });
  return new Dataset(name, rowCount, columns);
}

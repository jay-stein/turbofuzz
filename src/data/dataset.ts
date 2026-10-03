import type { ColumnData } from "./column.js";
import type { DatasetStats } from "./stats.js";

export class Dataset {
  constructor(
    readonly name: string,
    readonly rowCount: number,
    readonly columns: ColumnData[],
    readonly stats: DatasetStats,
  ) {}

  get columnCount(): number {
    return this.columns.length;
  }
}

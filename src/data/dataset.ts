import type { ColumnData } from "./column.js";

export class Dataset {
  constructor(
    readonly name: string,
    readonly rowCount: number,
    readonly columns: ColumnData[],
  ) {}

  get columnCount(): number {
    return this.columns.length;
  }
}

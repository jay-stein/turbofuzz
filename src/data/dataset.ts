import type { BitSet } from "../search/bitset.js";
import type { ColumnData } from "./column.js";
import type { DatasetStats } from "./stats.js";

export class Dataset {
  constructor(
    readonly name: string,
    readonly rowCount: number,
    readonly columns: ColumnData[],
    readonly stats: DatasetStats,
    readonly duplicateBits: BitSet,
    readonly nullRowBits: BitSet,
    readonly rowHashes: Uint32Array,
  ) {}

  get columnCount(): number {
    return this.columns.length;
  }
}

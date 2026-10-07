import type { BitSet } from "../search/bitset.js";
import type { Anomalies, LengthFence, ValueFence } from "./anomalies.js";
import type { ColumnData } from "./column.js";
import type { DatasetStats } from "./stats.js";

export class Dataset {
  valueAnomalyBits: BitSet;
  lengthAnomalyBits: BitSet;
  valueColumnBits: (BitSet | null)[];
  lengthColumnBits: (BitSet | null)[];
  valueFences: (ValueFence | null)[];
  lengthFences: (LengthFence | null)[];

  constructor(
    readonly name: string,
    readonly rowCount: number,
    readonly columns: ColumnData[],
    readonly stats: DatasetStats,
    readonly duplicateBits: BitSet,
    readonly nullRowBits: BitSet,
    readonly rowHashes: Uint32Array,
    valueAnomalyBits: BitSet,
    lengthAnomalyBits: BitSet,
    valueColumnBits: (BitSet | null)[],
    lengthColumnBits: (BitSet | null)[],
    valueFences: (ValueFence | null)[],
    lengthFences: (LengthFence | null)[],
  ) {
    this.valueAnomalyBits = valueAnomalyBits;
    this.lengthAnomalyBits = lengthAnomalyBits;
    this.valueColumnBits = valueColumnBits;
    this.lengthColumnBits = lengthColumnBits;
    this.valueFences = valueFences;
    this.lengthFences = lengthFences;
  }

  get columnCount(): number {
    return this.columns.length;
  }

  applyAnomalies(anomalies: Anomalies): void {
    this.valueAnomalyBits = anomalies.valueBits;
    this.lengthAnomalyBits = anomalies.lengthBits;
    this.valueColumnBits = anomalies.valueColumnBits;
    this.lengthColumnBits = anomalies.lengthColumnBits;
    this.valueFences = anomalies.columns.map((entry) => entry.valueFence);
    this.lengthFences = anomalies.columns.map((entry) => entry.lengthFence);
    this.stats.valueAnomalyRows = anomalies.valueBits.count();
    this.stats.lengthAnomalyRows = anomalies.lengthBits.count();
  }
}

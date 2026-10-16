import type { BitSet } from "../search/bitset.js";
import type { Anomalies, LengthFence, ValueFence } from "./anomalies.js";
import type { ColumnData } from "./column.js";
import type { PatternProfile } from "./mask-profile.js";
import type { DatasetStats } from "./stats.js";

export class Dataset {
  valueAnomalyBits: BitSet;
  lengthAnomalyBits: BitSet;
  valueColumnBits: (BitSet | null)[];
  lengthColumnBits: (BitSet | null)[];
  valueFences: (ValueFence | null)[];
  lengthFences: (LengthFence | null)[];
  /** Dominant-format profiles from ingest (null when none/not eligible). */
  readonly patternProfiles: (PatternProfile | null)[];
  /** Off-pattern bits per column, ready for the "pattern" column special. */
  readonly patternColumnBits: (BitSet | null)[];
  /** Group-relative anomaly bits, computed lazily by the Reports lens. */
  groupColumnBits: (BitSet | null)[] = [];
  groupAnomalyBits: BitSet | null = null;

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
    patternProfiles: (PatternProfile | null)[],
  ) {
    this.valueAnomalyBits = valueAnomalyBits;
    this.lengthAnomalyBits = lengthAnomalyBits;
    this.valueColumnBits = valueColumnBits;
    this.lengthColumnBits = lengthColumnBits;
    this.valueFences = valueFences;
    this.lengthFences = lengthFences;
    this.patternProfiles = patternProfiles;
    this.patternColumnBits = patternProfiles.map((profile) => profile?.offBits ?? null);
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

  /** Stores the lazily computed group-relative anomaly bits for filtering. */
  applyGroupAnomalies(columnBits: (BitSet | null)[], combined: BitSet): void {
    this.groupColumnBits = columnBits;
    this.groupAnomalyBits = combined;
  }
}

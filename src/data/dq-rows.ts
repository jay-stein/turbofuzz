import { BitSet } from "../search/bitset.js";
import type { ColumnData } from "./column.js";
import { rowFitsIntended } from "./conformance.js";
import { dateShapeKey } from "./date-formats.js";
import { hasNumberSymbol } from "./number-symbols.js";

export interface RowsAffected {
  /** Distinct rows that fail at least one deterministic check. */
  count: number;
  total: number;
  bits: BitSet;
}

/**
 * Rows that fail at least one deterministic issue: a spelling variant of another
 * value, a placeholder stored as text, a value that does not parse as the column's
 * intended type, or a break of the column's dominant format. Advisory items (fuzzy
 * matches, sensitivity, hidden-zero guesses) are not counted. One pass per column,
 * reusing the sets the checks already rely on; no extra scan of the data.
 */
export function computeRowsAffected(
  columns: readonly ColumnData[],
  rowCount: number,
  patternBits: readonly (BitSet | null)[],
  variantSources: readonly (ReadonlySet<string> | null)[],
): RowsAffected {
  const bits = new BitSet(rowCount);
  columns.forEach((column, index) => {
    if (column.role === "provenance") return;
    const off = patternBits[index];
    if (off !== null && off !== undefined) {
      for (let row = 0; row < rowCount; row++) if (off.get(row)) bits.set(row);
    }
    const minority = variantSources[index] ?? null;
    const tokens = new Set(column.nullTokens.filter((t) => t.label.trim() !== "").map((t) => t.label));
    const conformance = column.conformance;
    const dateFormats = column.dateFormats ?? null;
    const symbols = column.numberSymbols ?? null;
    if (minority === null && tokens.size === 0 && conformance === null && dateFormats === null && symbols === null) return;
    for (let row = 0; row < rowCount; row++) {
      if (bits.get(row)) continue;
      const raw = column.raw[row];
      if (tokens.has(raw)) {
        bits.set(row);
        continue;
      }
      if (column.nullMask.get(row)) continue;
      if (minority !== null && minority.has(raw.trim())) {
        bits.set(row);
        continue;
      }
      if (
        conformance !== null &&
        !rowFitsIntended(raw.trim(), conformance.intended, column.numberLocale, column.dateOrder)
      ) {
        bits.set(row);
        continue;
      }
      if (dateFormats !== null && dateShapeKey(raw) !== dateFormats.dominantKey) {
        bits.set(row);
        continue;
      }
      if (symbols !== null && hasNumberSymbol(raw, column.numberLocale, symbols.groupedCounts) === (symbols.minorityIs === "withSymbol")) {
        bits.set(row);
      }
    }
  });
  return { count: bits.count(), total: rowCount, bits };
}

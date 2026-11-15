import { BitSet } from "../search/bitset.js";
import type { ColumnData } from "./column.js";
import { rowFitsIntended } from "./conformance.js";
import { dateShapeKey, dateSideOf, minoritySide } from "./date-formats.js";
import { looksMojibake } from "./mojibake.js";
import { hasNumberSymbol } from "./number-symbols.js";

const NONE: ReadonlySet<string> = new Set();

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
  setAside: ReadonlySet<string> = NONE,
): RowsAffected {
  const bits = new BitSet(rowCount);
  columns.forEach((column, index) => {
    if (column.role === "provenance") return;
    // A check the analyst set aside (the score's check ids) stops counting its rows; the rest still do.
    // Empty cells are never counted here, so an optional column needs no special case.
    const aside = (id: string): boolean => setAside.has(`${id}.${index}`);
    const off = patternBits[index];
    if (off !== null && off !== undefined && !aside("validity")) {
      for (let row = 0; row < rowCount; row++) if (off.get(row)) bits.set(row);
    }
    const minority = aside("consistency.variants") ? null : (variantSources[index] ?? null);
    const tokens = aside("completeness")
      ? new Set<string>()
      : new Set(column.nullTokens.filter((t) => t.label.trim() !== "").map((t) => t.label));
    const conformance = aside("validity") ? null : column.conformance;
    const dateFormats = aside("validity.dateformat") ? null : (column.dateFormats ?? null);
    const symbols = aside("validity.symbols") ? null : (column.numberSymbols ?? null);
    const garbled = !aside("validity.mojibake") && column.mojibake != null;
    const conflict = aside("validity.dateconflict") ? null : minoritySide(column.dateConflict ?? null);
    if (minority === null && tokens.size === 0 && conformance === null && dateFormats === null && symbols === null && conflict === null && !garbled) return;
    for (let row = 0; row < rowCount; row++) {
      if (bits.get(row)) continue;
      const raw = column.raw[row];
      if (tokens.has(raw)) {
        bits.set(row);
        continue;
      }
      if (column.nullMask.get(row)) continue;
      if (minority !== null && minority.has(raw)) {
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
      if (garbled && looksMojibake(raw)) {
        bits.set(row);
        continue;
      }
      if (conflict !== null && dateSideOf(raw) === conflict) {
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

import type { ColumnData } from "./column.js";
import { rowFitsIntended } from "./conformance.js";
import { dateShapeKey } from "./date-formats.js";
import { maskValue } from "./mask-value.js";
import { hasNumberSymbol } from "./number-symbols.js";
import { parseNumber } from "../parse/numbers.js";
import { csvEscape } from "../worker/csv.js";
import { escapeFormula } from "./formula.js";

export interface ExceptionOptions {
  /** Columns whose values are masked (sensitive-flagged) unless includeRaw is on. */
  maskColumns: ReadonlySet<number>;
  includeRaw: boolean;
  /** One entry per column: the values that are spelling variants of another value. */
  variantSources: readonly (ReadonlySet<string> | null)[];
  /** Restrict to one check id (for example `validity.3`); null = all checks. */
  checkId: string | null;
  /** Columns the user marked optional; their empty cells are not exceptions. */
  optional: ReadonlySet<number>;
}

export interface ExceptionResult {
  csv: string;
  /** Failing cells written. */
  count: number;
}

export const EXCEPTION_HEADER = "row,column,check,dimension,severity,value,reason";

const FIX = "fix";

/**
 * One CSV row per failing cell. Reuses the predicates behind the scored checks
 * (placeholder tokens, parse conformance, spelling variants, date-format and
 * number-style minorities, plausible range, empty cells), so the counts match the
 * check detail. Row numbers are 1-based and count the first data row as 1.
 */
export function collectExceptions(
  columns: readonly ColumnData[],
  rowCount: number,
  options: ExceptionOptions,
): ExceptionResult {
  const lines: string[] = [EXCEPTION_HEADER];
  let count = 0;
  const emit = (
    row: number,
    index: number,
    column: ColumnData,
    check: string,
    dimension: string,
    severity: string,
    raw: string,
    reason: string,
  ): void => {
    if (options.checkId !== null && options.checkId !== check) return;
    const value = options.maskColumns.has(index) && !options.includeRaw ? maskValue(raw) : raw;
    lines.push(
      [String(row + 1), csvEscape(column.name), check, dimension, severity, csvEscape(escapeFormula(value)), csvEscape(reason)].join(","),
    );
    count++;
  };

  columns.forEach((column, index) => {
    if (column.role === "provenance") return;
    const tokens = new Set(column.nullTokens.filter((t) => t.label.trim() !== "").map((t) => t.label));
    const variants = options.variantSources[index] ?? null;
    const conformance = column.conformance;
    const dateFormats = column.dateFormats ?? null;
    const symbols = column.numberSymbols ?? null;
    const range = column.rangeViolation ?? null;
    const optional = options.optional.has(index);
    for (let row = 0; row < rowCount; row++) {
      const raw = column.raw[row];
      if (tokens.has(raw)) {
        emit(row, index, column, `placeholder.${index}`, "completeness", FIX, raw, "Placeholder stored as text");
        continue;
      }
      if (column.nullMask.get(row)) {
        if (!optional) emit(row, index, column, `completeness.${index}`, "completeness", "info", raw, "Empty cell");
        continue;
      }
      const text = raw.trim();
      if (conformance !== null && !rowFitsIntended(text, conformance.intended, column.numberLocale, column.dateOrder)) {
        emit(row, index, column, `validity.${index}`, "validity", FIX, raw, `Does not read as ${conformance.intended}`);
        continue;
      }
      if (range !== null) {
        const value = parseNumber(text, column.numberLocale);
        if (Number.isFinite(value) && (value < range.min || value > range.max)) {
          emit(row, index, column, `validity.range.${index}`, "validity", FIX, raw, range.sentence);
          continue;
        }
      }
      if (variants !== null && variants.has(text)) {
        emit(row, index, column, `consistency.variants.${index}`, "consistency", FIX, raw, "Spelling variant of another value");
        continue;
      }
      if (dateFormats !== null && dateShapeKey(raw) !== dateFormats.dominantKey) {
        emit(row, index, column, `validity.dateformat.${index}`, "validity", "review", raw, "Date written in a different format from most of the column");
        continue;
      }
      if (symbols !== null && hasNumberSymbol(raw, column.numberLocale, symbols.groupedCounts) === (symbols.minorityIs === "withSymbol")) {
        emit(row, index, column, `validity.symbols.${index}`, "validity", "review", raw, "Number written in a different style from most of the column");
      }
    }
  });
  return { csv: `${lines.join("\n")}\n`, count };
}

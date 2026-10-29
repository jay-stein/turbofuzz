import type { ColumnData } from "./column.js";
import { nameHas } from "./name-hints.js";

/** Identifier-like names, including common record/business identifiers. */
const ID_NAME = /(^|[^a-z0-9])(id|uuid|guid|key|ref|row_id|rowid|record_id)s?($|[^a-z0-9])/i;
const IDENTIFIER_NAME =
  /(^|[^a-z0-9])(zip|postal|postcode|phone|mobile|ssn|abn|acn|iban|barcode|nmi|isbn|vin|imei)([^a-z0-9]|$)/i;
const NON_ID_WORDS = /(paid|valid|void|grid|solid|fluid|rapid|humid|arid|android)$/;

/** Names that read as identifiers add no value to charts or outlier checks. */
export function looksLikeIdName(name: string): boolean {
  const lower = name.toLowerCase();
  if (ID_NAME.test(lower) || IDENTIFIER_NAME.test(lower)) return true;
  const compact = lower.replace(/[^a-z0-9]/g, "");
  return compact.length > 3 && compact.endsWith("id") && !NON_ID_WORDS.test(compact);
}

/**
 * A column that is almost certainly a record identifier rather than a measure:
 * its values are (near-)unique, form a compact numeric sequence, or its name
 * says it is an ID. Suppressing fences here avoids flagging every new customer
 * number, order number or row key as an "outlier".
 */
export function isLikelyIdentifierColumn(
  column: ColumnData,
  rowCount: number,
): boolean {
  if (column.type === "identifier") return true;
  if (looksLikeIdName(column.name)) return true;
  if (nameHas(column.name, "identifierMeasure")) return false;
  if (rowCount <= 20) return false;
  const nonNull = rowCount - column.stats.nulls;
  if (nonNull <= 20) return false;
  if (column.type === "string") {
    return column.stats.distinct / nonNull >= 0.98;
  }
  if (column.type !== "integer") return false;
  if (column.stats.min === null || column.stats.max === null) {
    // The numeric cache also fills min/max; anomalies run before chart stats.
    column.numbers();
  }
  const min = column.stats.min;
  const max = column.stats.max;
  if (min === null || max === null) return false;
  if (column.stats.distinct / nonNull < 0.98) return false;
  // Surrogate keys run in a compact range (1..N, 0..N-1, or a shifted block).
  return max - min + 1 <= nonNull * 10;
}

/** Header names that say "this is just the row number". */
const INDEX_NAME =
  /^(|#|idx|index|unnamed[:_ ]*\d*|column[_ ]?\d+|no\.?|num|number|row|rownum|row[_ ]?(num|number|no|index)|seq|sequence|serial)$/i;

/** Generic names for an axis or step number: a series 0..N here is data, not a record key. */
const AXIS_NAME =
  /^(x|y|z|t|n|i|j|k|step|steps|day|days|hour|hours|minute|week|month|period|iter|iteration|epoch|frame|tick|sample|trial|lag|position|pos|order|rank|level)$/i;

/**
 * Is this integer column a row counter (0..N-1, 1..N, or a gap-tolerant
 * ascending key) rather than a measure? The order of the values is the
 * signal, which the sampled type inference cannot see: a counter looks just
 * like any other run of distinct integers. A blank or "index"-style header
 * lowers the bar; a measure-like name (year, price, count…) is never taken
 * for a counter. Scans stop at the first sign the order breaks.
 */
export function looksLikeRowIndex(
  raw: readonly string[],
  name: string,
  nulls: number,
  distinct: number,
): boolean {
  const rows = raw.length;
  if (rows < 8) return false;
  const present = rows - nulls;
  if (present < 8 || nulls > rows * 0.005) return false;
  if (distinct < present * 0.999) return false;
  const label = name.trim();
  if (nameHas(label, "identifierMeasure")) return false;
  const named = INDEX_NAME.test(label);
  // Without a telling header, only a long, clean run is convincing, and never
  // one named like an axis or step number.
  if (!named && (present < 200 || AXIS_NAME.test(label))) return false;

  let previous = Number.NaN;
  let min = Infinity;
  let max = -Infinity;
  let steps = 0;
  let consecutive = 0;
  let ascending = 0;
  let broken = 0;
  const tolerance = Math.max(2, Math.floor(present * 0.02));
  for (let i = 0; i < rows; i++) {
    const text = raw[i]!.trim();
    if (text === "") continue;
    const value = Number(text);
    if (!Number.isInteger(value)) return false;
    if (value < min) min = value;
    if (value > max) max = value;
    if (!Number.isNaN(previous)) {
      steps++;
      if (value === previous + 1) consecutive++;
      if (value > previous) ascending++;
      else if (++broken > tolerance && !named) return false;
    }
    previous = value;
  }
  if (steps === 0) return false;
  const span = max - min + 1;
  // A counter is compact: it cannot have wandered far past the row count.
  if (span > present * 10) return false;
  if (named) {
    if (consecutive / steps >= 0.98) return true;
    return span <= present * 2;
  }
  // Unlabelled: a pure 0..N-1 or 1..N run, nothing looser.
  return consecutive / steps >= 0.999 && (min === 0 || min === 1);
}

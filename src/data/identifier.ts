import type { ColumnData } from "./column.js";

/** Identifier-like names, including common record/business identifiers. */
const ID_NAME = /(^|[^a-z0-9])(id|uuid|guid|key|ref|row_id|rowid|record_id)s?($|[^a-z0-9])/i;
const IDENTIFIER_NAME =
  /(^|[^a-z0-9])(zip|postal|postcode|phone|mobile|ssn|abn|acn|iban|barcode|nmi|isbn|vin|imei)([^a-z0-9]|$)/i;
const NON_ID_WORDS = /(paid|valid|void|grid|solid|fluid|rapid|humid|arid|android)$/;

/** Measures that are often unique integers but are not identifiers. */
const MEASURE_NAME =
  /(amount|revenue|sales|total|price|cost|profit|spend|income|value|qty|quantity|count|score|usage|balance|weight|size|duration|distance|fare|age|year|time|date|epoch|timestamp|rate|percent|pct|margin|discount|units|population|area|temperature|temp|speed|elevation|latitude|longitude|lat|lon|humidity|pressure|volume|capacity|height|width|length|depth)/i;

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
  if (MEASURE_NAME.test(column.name)) return false;
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

export type ColumnType =
  | "string"
  | "category"
  | "integer"
  | "number"
  | "date"
  | "datetime"
  | "time"
  | "duration"
  | "boolean"
  | "identifier";

export const COLUMN_TYPES: readonly ColumnType[] = [
  "string",
  "category",
  "integer",
  "number",
  "date",
  "datetime",
  "time",
  "duration",
  "boolean",
  "identifier",
];

export const TYPE_LABELS: Record<ColumnType, string> = {
  string: "Text",
  category: "Category",
  integer: "Integer",
  number: "Number",
  date: "Date",
  datetime: "Date & time",
  time: "Time of day",
  duration: "Duration",
  boolean: "Boolean",
  identifier: "ID / Exact",
};

/** Calendar dates and clock/elapsed-time values that parse to numbers. */
export function isTemporalType(type: ColumnType): boolean {
  return type === "date" || type === "datetime" || type === "time" || type === "duration";
}

/**
 * Types whose values parse to numbers: plain numeric plus every temporal type
 * (epoch ms, ms since midnight, or elapsed ms). Sorting, range filters,
 * histograms and chart axes all operate on that number.
 */
export function isNumericLikeType(type: ColumnType): boolean {
  return type === "integer" || type === "number" || isTemporalType(type);
}

export type TextMode = "contains" | "exact" | "fuzzy" | "phonetic";

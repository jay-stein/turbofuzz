export type ColumnType =
  | "string"
  | "category"
  | "integer"
  | "number"
  | "date"
  | "boolean"
  | "identifier";

export const COLUMN_TYPES: readonly ColumnType[] = [
  "string",
  "category",
  "integer",
  "number",
  "date",
  "boolean",
  "identifier",
];

export const TYPE_LABELS: Record<ColumnType, string> = {
  string: "Text",
  category: "Category",
  integer: "Integer",
  number: "Number",
  date: "Date",
  boolean: "Boolean",
  identifier: "ID / Exact",
};

export type TextMode = "contains" | "exact" | "fuzzy";

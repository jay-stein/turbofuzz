import type { ColumnType } from "../types.js";

/** Short type glyphs for headers and menus (the full name is in TYPE_LABELS). */
export const TYPE_GLYPHS: Record<ColumnType, string> = {
  string: "Aa",
  category: "Cat",
  integer: "123",
  number: "1.5",
  date: "Date",
  datetime: "D+T",
  time: "Time",
  duration: "Dur",
  boolean: "T/F",
  identifier: "ID",
};

/** The colour family of a type: five hues, so the header can be scanned for a column of the wrong kind. */
export const TYPE_FAMILY: Record<ColumnType, string> = {
  string: "text", identifier: "text", category: "category", integer: "number", number: "number",
  date: "time", datetime: "time", time: "time", duration: "time", boolean: "boolean",
};

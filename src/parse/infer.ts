import { detectDateOrder, parseDate, type DateOrder } from "./dates.js";
import { isNullToken } from "./null-tokens.js";
import { parseNumber } from "./numbers.js";
import type { ColumnType } from "../types.js";

export interface InferredType {
  type: ColumnType;
  dateOrder?: DateOrder;
}

export interface ColumnStats {
  nulls: number;
  distinct: number;
  samples: string[];
  min: number | null;
  max: number | null;
}

const TRUE_VALUES = new Set(["true", "yes", "y", "t"]);
const FALSE_VALUES = new Set(["false", "no", "n", "f"]);
const INTEGER = /^[+-]?\d{1,15}$/;
const ALL_DIGITS = /^\d+$/;

export function stratifiedSample(values: readonly string[], max: number): string[] {
  if (values.length <= max) return values.slice();
  const out: string[] = new Array(max);
  const step = values.length / max;
  for (let i = 0; i < max; i++) out[i] = values[Math.floor(i * step)];
  return out;
}

export function inferColumnType(
  sample: readonly string[],
  stats: ColumnStats,
  rowCount: number,
): InferredType {
  const nonNull: string[] = [];
  for (const value of sample) {
    if (!isNullToken(value)) nonNull.push(value.trim());
  }
  if (nonNull.length === 0) return { type: "string" };

  const present = rowCount - stats.nulls;
  const distinct = stats.distinct;

  const boolValues = new Set(nonNull.map((value) => value.toLowerCase()));
  if (
    boolValues.size <= 2 &&
    [...boolValues].every((value) => TRUE_VALUES.has(value) || FALSE_VALUES.has(value))
  ) {
    return { type: "boolean" };
  }

  if (nonNull.every((value) => ALL_DIGITS.test(value))) {
    if (nonNull.some((value) => value.length > 1 && value.startsWith("0"))) {
      return { type: "identifier" };
    }
    if (nonNull.some((value) => value.length > 15)) {
      return { type: "identifier" };
    }
  }

  let integerOk = 0;
  let numberOk = 0;
  for (const value of nonNull) {
    if (INTEGER.test(value)) integerOk++;
    if (Number.isFinite(parseNumber(value))) numberOk++;
  }
  const total = nonNull.length;

  if (integerOk / total >= 0.95) {
    const allLong = nonNull.every((value) => value.replace(/^[+-]/, "").length >= 7);
    if (allLong && present > 0 && distinct / present > 0.9) return { type: "identifier" };
    return { type: "integer" };
  }
  if (numberOk / total >= 0.95) return { type: "number" };

  const dateOrder = detectDateOrder(nonNull);
  let dateOk = 0;
  for (const value of nonNull) {
    if (Number.isFinite(parseDate(value, dateOrder))) dateOk++;
  }
  if (dateOk / total >= 0.95) return { type: "date", dateOrder };

  if (distinct <= 12) return { type: "category" };
  if (distinct <= 200 && present >= distinct * 5) return { type: "category" };

  return { type: "string" };
}

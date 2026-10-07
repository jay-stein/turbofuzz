import { detectDateOrder, parseDate, type DateOrder } from "./dates.js";
import { isNullToken } from "./null-tokens.js";
import { parseNumber, type NumberLocale } from "./numbers.js";
import type { ColumnType } from "../types.js";

export interface InferredType {
  type: ColumnType;
  dateOrder?: DateOrder;
  numberLocale?: NumberLocale;
}

export interface TopValue {
  label: string;
  count: number;
}

export interface ColumnStats {
  nulls: number;
  distinct: number;
  samples: string[];
  topValues: TopValue[];
  min: number | null;
  max: number | null;
  mean: number | null;
  stddev: number | null;
  minLength: number | null;
  maxLength: number | null;
  avgLength: number | null;
}

const TRUE_VALUES = new Set(["true", "yes", "y", "t", "1"]);
const FALSE_VALUES = new Set(["false", "no", "n", "f", "0"]);
const INTEGER = /^[+-]?\d{1,15}$/;
const ALL_DIGITS = /^\d+$/;
/** Upper bound for "small code" integers that default to a category list. */
const CATEGORY_CODE_MAX = 12;
const CATEGORY_CODE_DISTINCT = 12;

export function stratifiedSample(values: readonly string[], max: number): string[] {
  if (values.length <= max) return values.slice();
  const out: string[] = new Array(max);
  const step = values.length / max;
  for (let i = 0; i < max; i++) out[i] = values[Math.floor(i * step)];
  return out;
}

/**
 * Votes on the decimal mark for a numeric column. A comma followed by one or
 * two digits (198,72) or a dot-grouped number ending in a comma (1.234,56)
 * votes for the European convention; comma thousands grouping (1,234,567) and
 * a dot with one or two trailing digits that is not pure grouping (1.234)
 * vote for the English one. A tie falls back to the prior derived from the
 * file's delimiter/encoding.
 */
export function detectNumberLocale(
  values: readonly string[],
  prior: NumberLocale = "dot",
): NumberLocale {
  let comma = 0;
  let dot = 0;
  for (const value of values) {
    const s = value.replace(/[$€£¥\s%]/g, "");
    if (/\d,\d{1,2}$/.test(s)) {
      comma++;
    } else if (/\d\.\d{3},\d+$/.test(s)) {
      comma++;
    } else if (/\d(,\d{3})+$/.test(s)) {
      dot++;
    } else if (/\d\.\d{1,2}$/.test(s) && !/^\d{1,3}(\.\d{3})+$/.test(s)) {
      dot++;
    }
  }
  if (comma === dot) return prior;
  return comma > dot ? "comma" : "dot";
}

export function inferColumnType(
  sample: readonly string[],
  stats: ColumnStats,
  rowCount: number,
  isNull: (value: string) => boolean = isNullToken,
  numberPrior: NumberLocale = "dot",
): InferredType {
  const nonNull: string[] = [];
  for (const value of sample) {
    if (!isNull(value)) nonNull.push(value.trim());
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
    // Small non-negative code columns (Pclass, ratings, weekday numbers) are
    // far more useful as a value list than as a numeric range.
    if (
      distinct <= CATEGORY_CODE_DISTINCT &&
      present >= distinct * 5 &&
      nonNull.every((value) => {
        const numeric = Number(value);
        return Number.isInteger(numeric) && numeric >= 0 && numeric <= CATEGORY_CODE_MAX;
      })
    ) {
      return { type: "category" };
    }
    return { type: "integer" };
  }
  if (numberOk / total >= 0.95) {
    return { type: "number", numberLocale: detectNumberLocale(nonNull, numberPrior) };
  }

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

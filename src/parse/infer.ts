import {
  classifyDateValue,
  detectDateOrder,
  parseDuration,
  parseTimeOfDay,
  type DateOrder,
} from "./dates.js";
import { isNullToken } from "./null-tokens.js";
import { parseNumber, type NumberLocale } from "./numbers.js";
import type { ColumnType } from "../types.js";

export interface InferredType {
  type: ColumnType;
  dateOrder?: DateOrder;
  numberLocale?: NumberLocale;
  /** True when at least one datetime value carried an explicit zone offset. */
  timeZoneAware?: boolean;
  /** Set when a richer type was blocked by a minority of values (text fallback). */
  downgrade?: TypeDowngrade;
}

/**
 * A text column whose values mostly fit a richer type: the type inference
 * threshold (95%) was missed, so the column silently fell back to Text. The
 * counts come from the inference sample; share carries the ratio.
 */
export interface TypeDowngrade {
  candidate: "boolean" | "integer" | "number" | "date" | "datetime";
  /** Fraction of sampled non-null values that fit the candidate. */
  share: number;
  ok: number;
  total: number;
  /** Up to three values that block the candidate type. */
  examples: string[];
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
/** An integer written with a redundant zero tail ("202.0" from pandas floats). */
const INTEGER_ZERO_TAIL = /^[+-]?\d+\.0+$/;
const ALL_DIGITS = /^\d+$/;
/** Upper bound for "small code" integers that default to a category list. */
const CATEGORY_CODE_MAX = 12;
const CATEGORY_CODE_DISTINCT = 12;
/** Share of non-integer numbers that turns an integer column into a number column. */
const DECIMAL_SHARE = 0.01;
const DECIMAL_MIN_COUNT = 3;

/** Column-name hints that resolve ambiguous `HH:MM` values as wall clock. */
const CLOCK_NAME_HINT = /(^|[^a-z0-9])(time|times|clock|meridiem)($|[^a-z0-9])/i;
const MERIDIEM = /[ap]\.?m\.?\s*$/i;
const DURATION_CLOCK_FORM = /^\d{1,9}:[0-5]\d:[0-5]\d(?:\.\d{1,3})?$/;

/** A text fallback needs this share of values before it reads as a downgrade. */
const DOWNGRADE_MIN_SHARE = 0.6;
const DOWNGRADE_MIN_VALUES = 5;

type DowngradeCandidate = TypeDowngrade["candidate"];

function matchesCandidate(
  value: string,
  candidate: DowngradeCandidate,
  dateOrder: DateOrder,
): boolean {
  switch (candidate) {
    case "boolean":
      return (
        TRUE_VALUES.has(value.toLowerCase()) || FALSE_VALUES.has(value.toLowerCase())
      );
    case "integer":
      return INTEGER.test(value) || INTEGER_ZERO_TAIL.test(value);
    case "number":
      return Number.isFinite(parseNumber(value));
    case "date":
    case "datetime":
      return classifyDateValue(value, dateOrder) !== null;
  }
}

/**
 * Near-miss type detection for a text fallback: which richer type would the
 * column have been if a minority of values did not block it? Highest share
 * wins; ties prefer the more specific type (boolean > integer > number >
 * datetime > date) — matching how type inference itself ranks candidates.
 */
function detectDowngrade(
  values: readonly string[],
  counts: { boolOk: number; integerOk: number; numberOk: number; dateOk: number; anyTime: boolean },
  dateOrder: DateOrder,
): TypeDowngrade | undefined {
  const total = values.length;
  if (total < DOWNGRADE_MIN_VALUES) return undefined;
  const precedence: DowngradeCandidate[] = ["boolean", "integer", "number", "datetime", "date"];
  const candidates: { candidate: DowngradeCandidate; ok: number }[] = [
    { candidate: "boolean", ok: counts.boolOk },
    { candidate: "integer", ok: counts.integerOk },
    { candidate: "number", ok: counts.numberOk },
    { candidate: counts.anyTime ? "datetime" : "date", ok: counts.dateOk },
  ];
  let best: { candidate: DowngradeCandidate; ok: number; share: number } | null = null;
  for (const entry of candidates) {
    const share = entry.ok / total;
    if (share < DOWNGRADE_MIN_SHARE) continue;
    if (
      best === null ||
      share > best.share + 1e-9 ||
      (Math.abs(share - best.share) <= 1e-9 &&
        precedence.indexOf(entry.candidate) < precedence.indexOf(best.candidate))
    ) {
      best = { candidate: entry.candidate, ok: entry.ok, share };
    }
  }
  if (best === null) return undefined;
  const examples: string[] = [];
  for (const value of values) {
    if (!matchesCandidate(value, best.candidate, dateOrder)) {
      examples.push(value);
      if (examples.length >= 3) break;
    }
  }
  return {
    candidate: best.candidate,
    share: best.share,
    ok: best.ok,
    total,
    examples,
  };
}

/**
 * Time-of-day and duration are both conservative: an ambiguous `HH:MM` or
 * `HH:MM:SS` may be either, so it stays text unless the column name says
 * clock, an am/pm suffix is present, or some hour exceeds 23 (unambiguous
 * elapsed time). Explicit unit durations (`1h 30m`) always infer duration.
 */
function inferClockOrDuration(
  nonNull: readonly string[],
  name: string,
): InferredType | null {
  let timeOk = 0;
  let durationClockOk = 0;
  let durationUnitOk = 0;
  let meridiem = false;
  let hoursOver23 = false;
  for (const value of nonNull) {
    if (Number.isFinite(parseTimeOfDay(value))) {
      timeOk++;
      if (MERIDIEM.test(value.trim())) meridiem = true;
    }
    if (DURATION_CLOCK_FORM.test(value.trim())) {
      durationClockOk++;
      if (Number(value.trim().split(":")[0]) > 23) hoursOver23 = true;
    }
    if (/[a-z]/i.test(value) && Number.isFinite(parseDuration(value))) durationUnitOk++;
  }
  const total = nonNull.length;
  if (durationUnitOk === total) return { type: "duration" };
  if (durationClockOk === total && hoursOver23) return { type: "duration" };
  if (timeOk === total && (meridiem || CLOCK_NAME_HINT.test(name))) return { type: "time" };
  return null;
}

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
  name = "",
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
  let boolOk = 0;
  let zeroTail = false;
  for (const value of nonNull) {
    if (INTEGER.test(value)) integerOk++;
    else if (INTEGER_ZERO_TAIL.test(value)) {
      integerOk++;
      zeroTail = true;
    }
    if (Number.isFinite(parseNumber(value))) numberOk++;
    const lower = value.toLowerCase();
    if (TRUE_VALUES.has(lower) || FALSE_VALUES.has(lower)) boolOk++;
  }
  const total = nonNull.length;

  // Real decimals mixed into whole numbers (tons: 0, 1, 1.5, 0.25) are values,
  // not junk: a column with 1%+ of them is a number column, not an integer one.
  const fractional = numberOk - integerOk;
  const integerLike = integerOk / total >= 0.95 && (fractional < DECIMAL_MIN_COUNT || fractional / total < DECIMAL_SHARE);
  if (integerLike) {
    const allLong = nonNull.every((value) => value.replace(/^[+-]/, "").length >= 7);
    if (allLong && present > 0 && distinct / present > 0.9) return { type: "identifier" };
    // Small non-negative code columns (Pclass, ratings, weekday numbers) are
    // far more useful as a value list than as a numeric range — but only when
    // written as plain integers; ".0" tails read as measures, not codes, so a
    // float-written column like Excel's Car/Bedroom2 prefers integer.
    if (
      !zeroTail &&
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
  let anyTime = false;
  let anyOffset = false;
  for (const value of nonNull) {
    const parsed = classifyDateValue(value, dateOrder);
    if (parsed !== null) {
      dateOk++;
      if (parsed.hasTime) anyTime = true;
      if (parsed.hasOffset) anyOffset = true;
    }
  }
  if (dateOk / total >= 0.95) {
    // Mixed date-only and timestamp strings read as datetime; a timestamp at
    // midnight is still a datetime because the source carried a time.
    return {
      type: anyTime ? "datetime" : "date",
      dateOrder,
      ...(anyOffset ? { timeZoneAware: true } : {}),
    };
  }

  const temporal = inferClockOrDuration(nonNull, name);
  if (temporal !== null) return temporal;

  if (distinct <= 12) return { type: "category" };
  if (distinct <= 200 && present >= distinct * 5) return { type: "category" };

  // Text fallback: remember which richer type a minority of values blocked, so
  // the DQ report can flag a column that is text only because of a few cells.
  const downgrade = detectDowngrade(
    nonNull,
    { boolOk, integerOk, numberOk, dateOk, anyTime },
    dateOrder,
  );
  return { type: "string", ...(downgrade === undefined ? {} : { downgrade }) };
}

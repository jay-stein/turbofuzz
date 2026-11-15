import { classifyDateValue } from "../parse/dates.js";
import { parseNumber, type NumberLocale } from "../parse/numbers.js";
import type { ColumnType } from "../types.js";
import { matchGeoName } from "./geo.js";
import { firstHint } from "./name-hints.js";
import type { ColumnSuggestion } from "./suggestions.js";

type Sentinel = Extract<ColumnSuggestion, { kind: "sentinel" }>;

const ZERO_MIN_COUNT = 5;
const ZERO_MIN_SHARE = 0.005;
/** Mostly-zero columns (counts, flags) use zero legitimately. */
const ZERO_MAX_SHARE = 0.8;

/** Dates that systems write when a date is unknown. */
const PLACEHOLDER_DATES: readonly { ms: number; label: string }[] = [
  { ms: Date.UTC(1970, 0, 1), label: "1970-01-01" },
  { ms: Date.UTC(1900, 0, 1), label: "1900-01-01" },
  { ms: Date.UTC(1899, 11, 30), label: "1899-12-30" },
  { ms: Date.UTC(2999, 11, 31), label: "2999-12-31" },
  { ms: Date.UTC(9999, 11, 31), label: "9999-12-31" },
];

/**
 * Probable hidden-missing zeros in a numeric column whose name says zero is
 * impossible (Insulin, BloodPressure, price, moisture). Counted exactly over
 * every row. A review suggestion only: nothing is converted without a click.
 */
export function detectHiddenZeros(
  name: string,
  type: ColumnType,
  raw: readonly string[],
  isNull: (value: string) => boolean,
  locale: NumberLocale,
): Sentinel | null {
  if (type !== "integer" && type !== "number") return null;
  const word = firstHint(name, "zeroImplausible") ?? (matchGeoName(name) !== null ? "coordinate" : null);
  if (word === null) return null;
  let present = 0;
  let zeros = 0;
  let example = "0";
  for (let i = 0; i < raw.length; i++) {
    const value = raw[i];
    if (isNull(value)) continue;
    present++;
    const trimmed = value.trim();
    if (trimmed !== "" && parseNumber(trimmed, locale) === 0) {
      zeros++;
      if (zeros === 1) example = trimmed;
    }
  }
  if (zeros < ZERO_MIN_COUNT || present === 0) return null;
  const share = zeros / present;
  if (share < ZERO_MIN_SHARE || share > ZERO_MAX_SHARE) return null;
  return {
    kind: "sentinel",
    value: example,
    count: zeros,
    ratio: share,
    sampled: present,
    hint: `zero is not a plausible ${word} value, so these are probably “not measured”`,
  };
}

/**
 * A negative code such as -9 in a numeric column, counted over every row (a sample misses a code that is a fraction of a percent
 * of a big table). It counts as a code only when no other value in the column is negative, so a column that really goes below
 * zero (a temperature, a balance) is left alone.
 */
export function detectNegativeCodes(
  type: ColumnType,
  raw: readonly string[],
  isNull: (value: string) => boolean,
  locale: NumberLocale,
): Sentinel | null {
  if (type !== "integer" && type !== "number") return null;
  const codes = [...NUMERIC_SENTINEL_VALUES].filter((code) => Number(code) < 0);
  const counts = new Map<string, number>(codes.map((code) => [code, 0]));
  let otherNegative = false, present = 0;
  for (let i = 0; i < raw.length && !otherNegative; i++) {
    const value = raw[i]!;
    if (isNull(value)) continue;
    present++;
    const trimmed = value.trim();
    if (counts.has(trimmed)) { counts.set(trimmed, counts.get(trimmed)! + 1); continue; }
    if (trimmed.charCodeAt(0) === 45 || trimmed.charCodeAt(0) === 8722) {
      const n = parseNumber(trimmed, locale);
      if (Number.isFinite(n) && n < 0) otherNegative = true;
    }
  }
  if (otherNegative) return null;
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (best === undefined || best[1] < 3 || present === 0) return null;
  return { kind: "sentinel", value: best[0], count: best[1], ratio: best[1] / present, sampled: present, hint: "a code set apart from the real values" };
}

/** Maps a cell to a placeholder date label, or null when it is an ordinary value. */
export function placeholderDateLabel(value: string): string | null {
  const parsed = classifyDateValue(value.trim());
  if (parsed === null) return null;
  for (const entry of PLACEHOLDER_DATES) if (parsed.ms === entry.ms) return entry.label;
  return null;
}

/** Explicit numeric codes that datasets use for "unknown": -9 and 99. (-1 is too often a real count.) */
export const NUMERIC_SENTINEL_VALUES: ReadonlySet<string> = new Set(["-9", "99"]);

/**
 * Is `value` (a candidate numeric code) set apart from the column's real values?
 * Negative codes need every other value to be non-negative; 99 needs to sit at or
 * above the 99th percentile of the rest, so a score out of 100 keeps its 99.
 */
export function standsApartNumerically(
  value: string,
  others: readonly number[],
): boolean {
  if (others.length < 10) return false;
  const code = Number(value);
  if (code < 0) {
    for (const other of others) if (other < 0) return false;
    return true;
  }
  const sorted = [...others].sort((a, b) => a - b);
  const p99 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.99))];
  return code >= p99;
}

/** Runs of nines (-999, 9999, 99999) that systems write for "unknown". */
const NINES = /^[+-]?9{3,}(\.0+)?$/;
const NINES_MIN_COUNT = 5;
/** The code must repeat this many times more often than all values near it put together. */
const NINES_SPIKE = 5;

/**
 * A run-of-nines code (-999 in 101 of 100,000 revenue rows) counted over every row,
 * so it is found even when it is too rare for the sampled pass. It counts as a code
 * only when it is a spike: repeated exactly, far more often than every value within
 * 5% of it together (a price list where 999 sits among 949 and 1,049 stays quiet).
 */
export function detectNinesCode(
  type: ColumnType,
  raw: readonly string[],
  isNull: (value: string) => boolean,
  locale: NumberLocale,
): Sentinel | null {
  if (type !== "integer" && type !== "number") return null;
  const counts = new Map<string, number>();
  let present = 0;
  for (let i = 0; i < raw.length; i++) {
    const value = raw[i]!;
    if (isNull(value)) continue;
    present++;
    const first = value.charCodeAt(0);
    // Cheap gate before the pattern: a sign or a 9 first.
    if (first !== 57 && first !== 45 && first !== 43 && first !== 32) continue;
    const trimmed = value.trim();
    if (NINES.test(trimmed)) counts.set(trimmed, (counts.get(trimmed) ?? 0) + 1);
  }
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (best === undefined || best[1] < NINES_MIN_COUNT || present === 0) return null;
  const code = parseNumber(best[0], locale);
  const radius = Math.max(1, Math.abs(code) * 0.05);
  let near = 0;
  for (let i = 0; i < raw.length; i++) {
    const value = raw[i]!;
    if (isNull(value)) continue;
    const parsed = parseNumber(value.trim(), locale);
    if (parsed !== code && Math.abs(parsed - code) <= radius) near++;
  }
  if (best[1] < NINES_SPIKE * Math.max(1, near)) return null;
  return {
    kind: "sentinel",
    value: best[0],
    count: best[1],
    ratio: best[1] / present,
    sampled: present,
    hint: "the same run of nines over and over, apart from the real values",
  };
}

import { parseNumber, type NumberLocale } from "../parse/numbers.js";
import { nameHas, type HintGroup } from "./name-hints.js";
import type { ColumnType } from "../types.js";

/**
 * Plausible-range rules keyed by whole-word column-name hints. A rule only ever
 * applies to a column whose name carries the hint and whose values look like the
 * thing the name claims (a percentage column is mostly within 0 to 100, a year
 * column mostly looks like years), so a column that merely contains the word is
 * left alone. Negative quantities and prices stay with the non-negative review
 * finding; this module covers ranges with an upper bound as well.
 */
export interface PlausibilityRule {
  id: string;
  group: HintGroup;
  min: number;
  /** null = the upper bound is the current year plus one. */
  max: number | null;
  /** The values must look like this before the rule applies. */
  looksLike: { min: number; max: number; share: number };
  /** Plain sentence shown to the user. */
  sentence: (max: number) => string;
}

export const PLAUSIBILITY_RULES: readonly PlausibilityRule[] = [
  {
    id: "age",
    group: "plausibleAge",
    min: 0,
    max: 120,
    looksLike: { min: 0, max: 120, share: 0.5 },
    sentence: () => "An age is between 0 and 120",
  },
  {
    id: "percent",
    group: "percent",
    min: 0,
    max: 100,
    looksLike: { min: 0, max: 100, share: 0.8 },
    sentence: () => "A percentage is between 0 and 100",
  },
  {
    id: "year",
    group: "year",
    min: 1900,
    max: null,
    looksLike: { min: 1000, max: 3000, share: 0.8 },
    sentence: (max) => `A year is between 1900 and ${max}`,
  },
];

export interface RangeViolation {
  rule: string;
  sentence: string;
  min: number;
  max: number;
  /** Populated numeric values outside the range. */
  count: number;
  /** Populated numeric values checked. */
  checked: number;
  examples: string[];
}

/**
 * Counts the values outside the plausible range of the first rule the column name
 * triggers, or returns null when no rule applies or nothing is out of range.
 * `year` is the current calendar year (a parameter so tests are stable).
 */
export function checkPlausibility(
  name: string,
  type: ColumnType,
  raw: readonly string[],
  isMissing: (value: string) => boolean,
  locale: NumberLocale,
  year: number = new Date().getFullYear(),
): RangeViolation | null {
  if (type !== "integer" && type !== "number") return null;
  const rule = PLAUSIBILITY_RULES.find((candidate) => nameHas(name, candidate.group));
  if (rule === undefined) return null;
  const max = rule.max ?? year + 1;

  const values: { value: number; text: string }[] = [];
  for (let i = 0; i < raw.length; i++) {
    const text = (raw[i] ?? "").trim();
    if (text === "" || isMissing(text)) continue;
    const value = parseNumber(text, locale);
    if (Number.isFinite(value)) values.push({ value, text });
  }
  if (values.length === 0) return null;
  const { looksLike } = rule;
  const looks = values.filter((entry) => entry.value >= looksLike.min && entry.value <= looksLike.max);
  if (looks.length / values.length < looksLike.share) return null;

  const bad = values.filter((entry) => entry.value < rule.min || entry.value > max);
  if (bad.length === 0) return null;
  return {
    rule: rule.id,
    sentence: rule.sentence(max),
    min: rule.min,
    max,
    count: bad.length,
    checked: values.length,
    examples: [...new Set(bad.map((entry) => entry.text))].slice(0, 3),
  };
}

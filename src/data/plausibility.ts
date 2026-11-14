import { parseNumber, type NumberLocale } from "../parse/numbers.js";
import { nameHas, nameTokens, type HintGroup } from "./name-hints.js";
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

/** Names whose values are a share: a fraction 0 to 1 or a percentage 0 to 100. */
const SHARE_WORDS = new Set(["rate", "share", "ratio", "proportion", "fraction"]);
/** At least this share of values must sit in 0..1 before a few above 1 read as a scale mix. */
const FRACTION_SHARE = 0.95;

export interface ScaleMix {
  /** Values above 1 (and at most 100) in a column that is otherwise a fraction. */
  above: number;
  checked: number;
  examples: string[];
}

/**
 * A share column written as a fraction (0.15) with a few rows written as a
 * percentage (15): overwhelmingly 0..1, a handful in 1..100. Null otherwise. Counted
 * over every row; only runs for share-like names.
 */
export function checkScaleMix(
  name: string,
  type: ColumnType,
  raw: readonly string[],
  isMissing: (value: string) => boolean,
  locale: NumberLocale,
): ScaleMix | null {
  if (type !== "integer" && type !== "number") return null;
  if (!nameHas(name, "percent") && !nameTokens(name).some((token) => SHARE_WORDS.has(token))) return null;
  let checked = 0;
  let unit = 0;
  let above = 0;
  const examples = new Set<string>();
  for (let i = 0; i < raw.length; i++) {
    const text = (raw[i] ?? "").trim();
    if (text === "" || isMissing(text)) continue;
    const value = parseNumber(text, locale);
    if (!Number.isFinite(value)) continue;
    checked++;
    if (value >= 0 && value <= 1) unit++;
    else if (value > 1 && value <= 100) {
      above++;
      if (examples.size < 3) examples.add(text);
    }
  }
  if (above === 0 || checked < 20 || unit / checked < FRACTION_SHARE) return null;
  return { above, checked, examples: [...examples] };
}

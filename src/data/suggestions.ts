import { detectDateOrder, parseDate } from "../parse/dates.js";
import { stratifiedSample } from "../parse/infer.js";
import { parseNumber, type NumberLocale } from "../parse/numbers.js";
import { isNullWithPolicy, EMPTY_NULL_POLICY, type NullPolicy } from "../parse/null-tokens.js";

export type ColumnSuggestion =
  | { kind: "sentinel"; value: string; count: number; ratio: number; sampled: number }
  | { kind: "boolean"; truthy: string[]; falsy: string[] }
  | { kind: "number"; locale: NumberLocale; ratio: number; hasSymbol: boolean }
  | { kind: "date"; ratio: number; sampled: number };

const TRUTHY = new Set(["y", "yes", "t", "true"]);
const FALSY = new Set(["n", "no", "f", "false"]);
const MAX_SAMPLE = 2000;
const SENTINEL_MIN_RATIO = 0.1;
const SENTINEL_MIN_COUNT = 5;
const NUMBER_MIN_RATIO = 0.8;
const DATE_MIN_RATIO = 0.8;
const SYMBOL = /[$€£¥%]/;

/** Short button label for a suggestion chip. */
export function suggestionLabel(suggestion: ColumnSuggestion): string {
  switch (suggestion.kind) {
    case "sentinel":
      return `Treat “${suggestion.value}” as missing (${suggestion.count.toLocaleString()}×)`;
    case "boolean":
      return "Normalize to Boolean";
    case "number":
      return "Convert to number";
    case "date":
      return "Convert to date";
  }
}

/** Full explanation shown on hover. */
export function describeSuggestion(suggestion: ColumnSuggestion): string {
  switch (suggestion.kind) {
    case "sentinel":
      return `“${suggestion.value}” appears in ${suggestion.count.toLocaleString()} of ${suggestion.sampled.toLocaleString()} sampled cells and may be a missing-value code. Click to treat it as empty.`;
    case "boolean":
      return `Mixed yes/no spellings (${[...suggestion.truthy, ...suggestion.falsy].join(", ")}). Click to normalise them to true/false.`;
    case "number":
      return `About ${Math.round(suggestion.ratio * 100)}% of values look numeric${suggestion.hasSymbol ? " with currency or percent symbols" : ""}. Click to strip the formatting and convert.`;
    case "date":
      return `About ${Math.round(suggestion.ratio * 100)}% of values look like dates. Click to convert them to ISO dates.`;
  }
}

/**
 * Detects actionable per-column patterns from a sample: repeated negative
 * sentinels, mixed Y/N spellings, and text that is mostly formatted numbers
 * or dates. Suggestions are conservative so ordinary columns stay quiet.
 */
export function detectSuggestions(
  raw: readonly string[],
  type: string,
  policy: NullPolicy = EMPTY_NULL_POLICY,
  locale: NumberLocale = "dot",
): ColumnSuggestion[] {
  const nonNull = stratifiedSample(raw, MAX_SAMPLE)
    .map((value) => value.trim())
    .filter((value) => value !== "" && !isNullWithPolicy(value, policy));
  if (nonNull.length === 0) return [];

  const suggestions: ColumnSuggestion[] = [];
  const counts = new Map<string, number>();
  for (const value of nonNull) counts.set(value, (counts.get(value) ?? 0) + 1);

  // Sentinel: the most repeated value is a negative integer that sits far
  // outside the rest of the column (so -999 flags, an ordinary -1 does not).
  let topValue = "";
  let topCount = 0;
  for (const [value, count] of counts) {
    if (count > topCount) {
      topValue = value;
      topCount = count;
    }
  }
  const sentinelNumber = parseNumber(topValue, locale);
  if (
    topCount >= SENTINEL_MIN_COUNT &&
    topCount / nonNull.length >= SENTINEL_MIN_RATIO &&
    Number.isInteger(sentinelNumber) &&
    sentinelNumber < 0
  ) {
    const others: number[] = [];
    for (const value of nonNull) {
      if (value === topValue) continue;
      const numeric = parseNumber(value, locale);
      if (Number.isFinite(numeric)) others.push(numeric);
    }
    let median = 0;
    if (others.length > 0) {
      others.sort((a, b) => a - b);
      median = others[others.length >>> 1];
    }
    if (Math.abs(sentinelNumber) > Math.max(10, 3 * Math.abs(median))) {
      suggestions.push({
        kind: "sentinel",
        value: topValue,
        count: topCount,
        ratio: topCount / nonNull.length,
        sampled: nonNull.length,
      });
    }
  }

  // Boolean: every distinct value is a yes/no spelling but they vary in form.
  if (type !== "boolean" && counts.size >= 2 && counts.size <= 8) {
    const truthy: string[] = [];
    const falsy: string[] = [];
    let allBooleanish = true;
    for (const value of counts.keys()) {
      const key = value.toLowerCase();
      if (TRUTHY.has(key)) truthy.push(value);
      else if (FALSY.has(key)) falsy.push(value);
      else {
        allBooleanish = false;
        break;
      }
    }
    if (allBooleanish && truthy.length > 0 && falsy.length > 0) {
      suggestions.push({ kind: "boolean", truthy, falsy });
    }
  }

  // Formatted text: only nudge text-ish columns, never IDs or typed columns.
  if (type === "string" || type === "category") {
    let numeric = 0;
    let symbol = false;
    for (const value of nonNull) {
      if (SYMBOL.test(value)) symbol = true;
      if (Number.isFinite(parseNumber(value, locale))) numeric++;
    }
    const ratio = numeric / nonNull.length;
    if (ratio >= NUMBER_MIN_RATIO && (symbol || ratio < 1)) {
      suggestions.push({ kind: "number", locale, ratio, hasSymbol: symbol });
    } else if (numeric / nonNull.length < NUMBER_MIN_RATIO) {
      const order = detectDateOrder(nonNull);
      let dates = 0;
      for (const value of nonNull) {
        if (Number.isFinite(parseDate(value, order))) dates++;
      }
      const dateRatio = dates / nonNull.length;
      if (dateRatio >= DATE_MIN_RATIO) {
        suggestions.push({ kind: "date", ratio: dateRatio, sampled: nonNull.length });
      }
    }
  }

  return suggestions;
}

import { detectDateOrder, parseDate } from "../parse/dates.js";
import { looksLikeFormula } from "./formula.js";
import { stratifiedSample } from "../parse/infer.js";
import { detectDecimalStyle, parseNumber, type NumberLocale } from "../parse/numbers.js";
import { isNullWithPolicy, EMPTY_NULL_POLICY, type NullPolicy } from "../parse/null-tokens.js";

export type ColumnSuggestion =
  | { kind: "sentinel"; value: string; count: number; ratio: number; sampled: number }
  | { kind: "boolean"; truthy: string[]; falsy: string[] }
  | { kind: "number"; locale: NumberLocale; ratio: number; hasSymbol: boolean }
  | { kind: "date"; ratio: number; sampled: number }
  | { kind: "mixedNumber"; locale: NumberLocale; count: number; ratio: number; sampled: number }
  | { kind: "typeConflict"; count: number; sampled: number; example: string; columnType: string }
  | { kind: "formula"; count: number; ratio: number; sampled: number; example: string };

const TRUTHY = new Set(["y", "yes", "t", "true"]);
const FALSY = new Set(["n", "no", "f", "false"]);
const MAX_SAMPLE = 2000;
const SENTINEL_MIN_RATIO = 0.01;
const SENTINEL_MIN_COUNT = 5;
const MAX_SENTINELS = 3;
const NUMBER_MIN_RATIO = 0.8;
const DATE_MIN_RATIO = 0.8;
const MIXED_MIN_COUNT = 5;
const MIXED_MIN_RATIO = 0.005;
const TYPE_CONFLICT_MIN_COUNT = 5;
const TYPE_CONFLICT_MIN_RATIO = 0.01;
const FORMULA_MIN_COUNT = 5;
const FORMULA_MIN_RATIO = 0.01;
const SYMBOL = /[$€£¥%]/;
// Known placeholder words and all-zero date shapes that are not in the global
// null-token list, so they arrive as suggestions instead of silent nulls.
const PLACEHOLDER_WORDS = new Set(["tbc"]);
const ZERO_DATE = /^0{1,4}[/\-.]0{1,2}[/\-.]0{1,4}$/;
const REPEATED_DIGITS = /^[+-]?(\d)\1{2,}$/;

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
    case "mixedNumber":
      return `Repair ${suggestion.count.toLocaleString()} ${
        suggestion.locale === "dot" ? "decimal-comma" : "decimal-point"
      } values`;
    case "typeConflict":
      return `Treat as text (${suggestion.count.toLocaleString()} don't parse)`;
    case "formula":
      return `Escape ${suggestion.count.toLocaleString()} formula-like cells`;
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
    case "mixedNumber":
      return suggestion.locale === "dot"
        ? `${suggestion.count.toLocaleString()} of ${suggestion.sampled.toLocaleString()} sampled values look like decimal comma (e.g. 613,26) while this column reads 1,234.56 — they are currently parsed as thousands. Click to rewrite just those values.`
        : `${suggestion.count.toLocaleString()} of ${suggestion.sampled.toLocaleString()} sampled values look like decimal point (e.g. 613.26) while this column reads 1.234,56 — they are currently parsed as thousands. Click to rewrite just those values.`;
    case "typeConflict":
      return `${suggestion.count.toLocaleString()} of ${suggestion.sampled.toLocaleString()} sampled cells don't parse as ${suggestion.columnType} (e.g. “${suggestion.example}”). Values are kept visible; click to treat the column as text instead of coercing.`;
    case "formula":
      return `${suggestion.count.toLocaleString()} of ${suggestion.sampled.toLocaleString()} sampled cells start like a spreadsheet formula (e.g. “${suggestion.example}”). Click to prefix them with ' so Excel and Sheets import them as text. Exports can also escape them on the fly.`;
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

  // Sentinels: frequent placeholder shapes ("TBC", all-zero dates) or
  // repeated-digit codes (-999, 9999). These are suggestions the user
  // confirms, never silent nulls, and identifier columns are skipped because
  // digit strings are their normal content.
  if (type !== "identifier") {
    const candidates: { value: string; count: number }[] = [];
    for (const [value, count] of counts) {
      if (count < SENTINEL_MIN_COUNT || count / nonNull.length < SENTINEL_MIN_RATIO) {
        continue;
      }
      const lower = value.toLowerCase();
      if (
        PLACEHOLDER_WORDS.has(lower) ||
        ZERO_DATE.test(lower) ||
        REPEATED_DIGITS.test(lower)
      ) {
        candidates.push({ value, count });
      }
    }
    candidates.sort((a, b) => b.count - a.count);
    for (const candidate of candidates.slice(0, MAX_SENTINELS)) {
      suggestions.push({
        kind: "sentinel",
        value: candidate.value,
        count: candidate.count,
        ratio: candidate.count / nonNull.length,
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

  // Mixed decimal conventions: a numeric column where a meaningful slice of
  // values is written with the other decimal mark (e.g. "613,26" inside a
  // 1,234.56 column). Those values currently parse as thousands.
  if (type === "integer" || type === "number") {
    const other: NumberLocale = locale === "dot" ? "comma" : "dot";
    let otherStyle = 0;
    let unparsed = 0;
    let example = "";
    for (const value of nonNull) {
      if (detectDecimalStyle(value) === other) otherStyle++;
      if (!Number.isFinite(parseNumber(value, locale))) {
        unparsed++;
        if (example === "") example = value;
      }
    }
    if (otherStyle >= MIXED_MIN_COUNT && otherStyle / nonNull.length >= MIXED_MIN_RATIO) {
      suggestions.push({
        kind: "mixedNumber",
        locale,
        count: otherStyle,
        ratio: otherStyle / nonNull.length,
        sampled: nonNull.length,
      });
    }
    // Type conflict: repeated values that do not parse as the column's type
    // (e.g. "high" inside an integer column). Never silently coerced; the
    // click switches the column to text so every value stays visible.
    if (
      unparsed >= TYPE_CONFLICT_MIN_COUNT &&
      unparsed / nonNull.length >= TYPE_CONFLICT_MIN_RATIO
    ) {
      suggestions.push({
        kind: "typeConflict",
        count: unparsed,
        sampled: nonNull.length,
        example,
        columnType: type,
      });
    }
  }

  // Formula-like cells: only text-ish columns export raw values, so a cell
  // starting with = or @ (or a signed expression) can execute on paste/import
  // into Excel or Sheets.
  if (type === "string" || type === "category") {
    let formulas = 0;
    let example = "";
    for (const value of nonNull) {
      if (looksLikeFormula(value)) {
        formulas++;
        if (example === "") example = value;
      }
    }
    if (formulas >= FORMULA_MIN_COUNT && formulas / nonNull.length >= FORMULA_MIN_RATIO) {
      suggestions.push({
        kind: "formula",
        count: formulas,
        ratio: formulas / nonNull.length,
        sampled: nonNull.length,
        example,
      });
    }
  }

  return suggestions;
}

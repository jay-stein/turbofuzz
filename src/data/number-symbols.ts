import type { NumberLocale } from "../parse/numbers.js";

/**
 * Currency symbols or thousands separators on part of a numeric column
 * ("$1,000" beside "950.00"). Each value parses, but the column is written two
 * ways. Computed exactly over every populated value.
 */
export interface NumberSymbolSummary {
  /** Values carrying a currency symbol, grouping separators or accounting brackets. */
  withSymbol: number;
  /** Plain numeric values. */
  plain: number;
  /** Values in the smaller group (the ones that fail the consistency check). */
  minority: number;
  total: number;
  /** A symbol-bearing example. */
  example: string;
  /** Which group is the minority (the rows that fail). */
  minorityIs: "withSymbol" | "plain";
  /** Whether thousands-grouped values count as the symbol style (see summariseNumberSymbols). */
  groupedCounts: boolean;
}

const CURRENCY = /[$€£¥₹]|^\(.*\)$/;
const GROUPED: Record<NumberLocale, RegExp> = {
  dot: /^[+-]?\d{1,3}(,\d{3})+(\.\d+)?$/,
  comma: /^[+-]?\d{1,3}(\.\d{3})+(,\d+)?$/,
};

/** Is this raw value written in the symbol style the summary counted? */
export function hasNumberSymbol(value: string, locale: NumberLocale, groupedCounts: boolean): boolean {
  const v = value.trim();
  return CURRENCY.test(v) || (groupedCounts && GROUPED[locale].test(v));
}

/** Does this raw value carry a currency symbol or accounting brackets? */
function hasCurrency(value: string): boolean {
  return CURRENCY.test(value.trim());
}

/**
 * Returns null unless both writing styles are present. Thousands separators alone
 * ("35,793" beside "950") are how people naturally write numbers, so grouped values
 * only count as a second style when a plain value of four or more digits ("12000")
 * shows the column is not written that way throughout.
 */
export function summariseNumberSymbols(
  raw: readonly string[],
  isMissing: (value: string) => boolean,
  locale: NumberLocale,
): NumberSymbolSummary | null {
  let currency = 0;
  let grouped = 0;
  let plain = 0;
  let plainLarge = 0;
  let currencyExample = "";
  let groupedExample = "";
  for (let i = 0; i < raw.length; i++) {
    const value = (raw[i] ?? "").trim();
    if (value === "" || isMissing(value)) continue;
    if (hasCurrency(value)) {
      currency++;
      if (currencyExample === "") currencyExample = value;
    } else if (GROUPED[locale].test(value)) {
      grouped++;
      if (groupedExample === "") groupedExample = value;
    } else {
      plain++;
      if (/^[+-]?\d{4,}(?![\d])/.test(value)) plainLarge++;
    }
  }
  const countGrouped = plainLarge > 0;
  const withSymbol = currency + (countGrouped ? grouped : 0);
  const plainCount = plain + (countGrouped ? 0 : grouped);
  if (withSymbol === 0 || plainCount === 0) return null;
  return {
    withSymbol,
    plain: plainCount,
    minority: Math.min(withSymbol, plainCount),
    total: withSymbol + plainCount,
    example: currencyExample !== "" ? currencyExample : groupedExample,
    minorityIs: withSymbol <= plainCount ? "withSymbol" : "plain",
    groupedCounts: countGrouped,
  };
}

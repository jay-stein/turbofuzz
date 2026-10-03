/**
 * Parses human-formatted numbers: thousands separators, currency symbols,
 * accounting negatives (1,234), percentages and surrounding whitespace.
 * Returns NaN when the value is not numeric.
 */
export function parseNumber(raw: string): number {
  let s = raw.trim();
  if (s === "") return NaN;

  let negative = false;
  if (s.length > 2 && s.startsWith("(") && s.endsWith(")")) {
    negative = true;
    s = s.slice(1, -1);
  }

  s = s.replace(/[$€£¥\s]/g, "");
  s = s.replace(/%$/, "");
  s = s.replace(/,/g, "");

  if (!/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(s)) return NaN;
  const n = Number(s);
  if (!Number.isFinite(n)) return NaN;
  return negative ? -n : n;
}

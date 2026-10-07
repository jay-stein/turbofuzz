/**
 * Decimal mark convention for a column. `dot` follows the English format
 * (1,234.56) and `comma` the continental European format (1.234,56).
 */
export type NumberLocale = "dot" | "comma";

/**
 * Parses human-formatted numbers: thousands separators, currency symbols,
 * accounting negatives (1,234), percentages and surrounding whitespace.
 * Returns NaN when the value is not numeric.
 *
 * A fast path handles plain numeric strings (the overwhelming majority in
 * real data) without any regex work; the formatted path below only runs for
 * values that need cleanup. The locale decides whether "," or "." is the
 * decimal mark, so 198,72 is only 198.72 when the column says so.
 */
export function parseNumber(raw: string, locale: NumberLocale = "dot"): number {
  // The fast path is only safe when the locale cannot reinterpret the value:
  // with decimal commas, "1.234" means 1234 and must go through the slow path.
  if (raw.length > 0 && (locale === "dot" || !raw.includes("."))) {
    const first = raw.charCodeAt(0);
    if (
      (first >= 48 && first <= 57) ||
      first === 45 ||
      first === 43 ||
      first === 46
    ) {
      // Reject hex/octal/binary literals that Number() would happily accept.
      if (!(first === 48 && raw.length > 1 && isBasePrefix(raw.charCodeAt(1)))) {
        const quick = Number(raw);
        if (Number.isFinite(quick)) return quick;
      }
    }
  }

  let s = raw.trim();
  if (s === "") return NaN;

  let negative = false;
  if (s.length > 2 && s.startsWith("(") && s.endsWith(")")) {
    negative = true;
    s = s.slice(1, -1);
  }

  s = s.replace(/[$€£¥\s]/g, "");
  s = s.replace(/%$/, "");
  if (locale === "comma") {
    s = s.replace(/\./g, "").replace(/,/g, ".");
  } else {
    s = s.replace(/,/g, "");
  }

  if (!/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(s)) return NaN;
  const n = Number(s);
  if (!Number.isFinite(n)) return NaN;
  return negative ? -n : n;
}

function isBasePrefix(code: number): boolean {
  return (
    code === 120 || // x
    code === 88 || // X
    code === 98 || // b
    code === 66 || // B
    code === 111 || // o
    code === 79 // O
  );
}

// A decimal mark with 1-2 trailing digits; thousand groups must be 3 digits,
// so "1,23" is a decimal comma but "1,234" is only a thousands separator.
const COMMA_STYLE = /^[+-]?\d{1,3}(?:\.\d{3})*,\d{1,2}$/;
const DOT_STYLE = /^[+-]?\d{1,3}(?:,\d{3})*\.\d{1,2}$/;

/**
 * Classifies a value's decimal convention by shape alone (currency symbols,
 * parentheses and percent are ignored). Returns null when the value is not a
 * formatted number with a decimal mark. Used to spot values written in the
 * other locale than the column's, e.g. "613,26" inside a dot-decimal column.
 */
export function detectDecimalStyle(raw: string): NumberLocale | null {
  let s = raw.trim();
  if (s.length > 2 && s.startsWith("(") && s.endsWith(")")) s = s.slice(1, -1).trim();
  s = s.replace(/[$€£¥%\s]/g, "");
  if (DOT_STYLE.test(s)) return "dot";
  if (COMMA_STYLE.test(s)) return "comma";
  return null;
}

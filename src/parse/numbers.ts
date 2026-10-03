/**
 * Parses human-formatted numbers: thousands separators, currency symbols,
 * accounting negatives (1,234), percentages and surrounding whitespace.
 * Returns NaN when the value is not numeric.
 *
 * A fast path handles plain numeric strings (the overwhelming majority in
 * real data) without any regex work; the formatted path below only runs for
 * values that need cleanup.
 */
export function parseNumber(raw: string): number {
  if (raw.length > 0) {
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
  s = s.replace(/,/g, "");

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

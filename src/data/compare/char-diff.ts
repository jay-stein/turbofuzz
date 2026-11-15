/** One run of text in a character diff: shared by both strings, or only in this one. */
export interface DiffSegment {
  text: string;
  /** True for the letters that are not in the other string. */
  differs: boolean;
}

/** Past this many characters on either side the diff is skipped (the table is quadratic) and the whole text reads as plain. */
const MAX_CHARS = 400;

/**
 * Which letters of `a` and `b` differ, from their longest common subsequence.
 * Case counts as the same letter so "ACME" and "Acme" do not light up; the
 * text itself is returned as written. Returns the segments of each side.
 */
export function charDiff(a: string, b: string): { a: DiffSegment[]; b: DiffSegment[] } {
  const x = Array.from(a);
  const y = Array.from(b);
  if (x.length > MAX_CHARS || y.length > MAX_CHARS) return { a: [{ text: a, differs: false }], b: [{ text: b, differs: false }] };
  const fold = (ch: string): string => ch.toLowerCase();
  const n = x.length;
  const m = y.length;
  // table[i][j]: length of the common subsequence of x[i..] and y[j..].
  const table: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i]![j] = fold(x[i]!) === fold(y[j]!) ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    }
  }
  const outA: DiffSegment[] = [];
  const outB: DiffSegment[] = [];
  const push = (out: DiffSegment[], ch: string, differs: boolean): void => {
    const last = out[out.length - 1];
    if (last !== undefined && last.differs === differs) last.text += ch;
    else out.push({ text: ch, differs });
  };
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (fold(x[i]!) === fold(y[j]!)) {
      push(outA, x[i++]!, false);
      push(outB, y[j++]!, false);
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) push(outA, x[i++]!, true);
    else push(outB, y[j++]!, true);
  }
  while (i < n) push(outA, x[i++]!, true);
  while (j < m) push(outB, y[j++]!, true);
  return { a: outA, b: outB };
}

/**
 * Forgiving match for search-as-you-type boxes (column and value pickers): it finds what
 * the person is reaching for from a few letters, not only an exact substring.
 *
 * Tiers, best first: exact, starts with, a word starts with it, contains it, every typed
 * word is in it, its letters appear in order ("ctry" in "country", "ordid" in "order_id"),
 * and a near miss (one slipped, doubled, missing or swapped letter: "lodnon" for "london").
 * Case, accents and _ - separators are ignored.
 */

/** Case, accents and _ - . / separators folded away: what matching compares. */
export const normalizeForMatch = (text: string): string =>
  text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[_\-./]+/g, " ").replace(/\s+/g, " ").trim();

/**
 * Whether `a` and t[from, to) differ by at most one inserted, deleted, replaced or swapped
 * neighbouring letter. Works in place on t so scanning many values allocates nothing.
 */
function withinOne(a: string, t: string, from: number, to: number): boolean {
  const la = a.length, lb = to - from;
  if (la - lb > 1 || lb - la > 1) return false;
  let i = 0;
  while (i < la && i < lb && a.charCodeAt(i) === t.charCodeAt(from + i)) i++;
  if (i === la || i === lb) return true; // one is a prefix of the other, at most one letter longer
  if (la === lb) {
    // Replaced letter, or two neighbours swapped.
    let k = i + 1;
    while (k < la && a.charCodeAt(k) === t.charCodeAt(from + k)) k++;
    if (k === la) return true;
    if (a.charCodeAt(i) === t.charCodeAt(from + i + 1) && a.charCodeAt(i + 1) === t.charCodeAt(from + i)) {
      for (let j = i + 2; j < la; j++) if (a.charCodeAt(j) !== t.charCodeAt(from + j)) return false;
      return true;
    }
    return false;
  }
  if (la > lb) {
    // a has one extra letter: skip it and the rest must match.
    for (let j = i; j < lb; j++) if (a.charCodeAt(j + 1) !== t.charCodeAt(from + j)) return false;
  } else {
    for (let j = i; j < la; j++) if (a.charCodeAt(j) !== t.charCodeAt(from + j + 1)) return false;
  }
  return true;
}

/** Word boundaries of t: calls fn(start, end) for each space-separated word until it returns true. */
function someWord(t: string, fn: (start: number, end: number) => boolean): boolean {
  let start = 0;
  while (start <= t.length) {
    let end = t.indexOf(" ", start);
    if (end < 0) end = t.length;
    if (fn(start, end)) return true;
    start = end + 1;
  }
  return false;
}

/** Optimal string alignment distance (insert, delete, substitute, swap neighbours), capped. */
function editDistance(a: string, b: string, cap: number): number {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  const m = a.length, n = b.length;
  let prev2 = new Array<number>(n + 1).fill(0);
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = new Array<number>(n + 1);
    cur[0] = i;
    let rowMin = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2]! + 1);
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > cap) return cap + 1;
    prev2 = prev;
    prev = cur;
  }
  return prev[n]!;
}

/**
 * How well `text` fits `query`, higher is better, or null when it does not fit.
 * An empty query fits everything equally (0).
 */
export function fuzzyScore(query: string, text: string): number | null {
  return fuzzyScoreNormalized(normalizeForMatch(query), normalizeForMatch(text), true);
}

/**
 * fuzzyScore on strings already passed through normalizeForMatch, for scanning many values
 * against one query. typo = false skips the near-miss tier, the costly one: scan without it
 * first and add it only when too few values fit.
 */
export function fuzzyScoreNormalized(q: string, t: string, typo: boolean): number | null {
  if (q === "") return 0;
  if (t === "") return null;
  if (t === q) return 1000;
  if (t.startsWith(q)) return 900 - Math.min(99, t.length - q.length) * 0.5;
  if (t.includes(" " + q)) return 800 - Math.min(99, t.length) * 0.5;
  const at = t.indexOf(q);
  if (at >= 0) return 700 - at * 0.5 - Math.min(99, t.length) * 0.1;
  const multi = q.includes(" ");
  if (multi) {
    const parts = q.split(" ");
    if (parts.every((p) => t.includes(p))) return 600 - Math.min(99, t.length) * 0.1;
    if (typo) {
      // Several words: each typed word must start a word of the text, or be a near miss of one.
      const near = (part: string): boolean =>
        someWord(t, (s0, e0) =>
          t.startsWith(part, s0) || (part.length >= 4 && (withinOne(part, t, s0, e0) || withinOne(part, t, s0, Math.min(e0, s0 + part.length)))),
        );
      if (parts.every(near)) return 500 - Math.min(99, t.length) * 0.1;
    }
  } else if (q.length >= 2) {
    // Letters in order, preferring word starts: the window they span decides the score.
    let from = 0, first = -1, last = -1, ok = true;
    for (const ch of q) {
      const next = t.indexOf(ch, from);
      if (next < 0) { ok = false; break; }
      if (first < 0) first = next;
      last = next;
      from = next + 1;
    }
    const span = last - first + 1;
    if (ok && span <= q.length * 4 + 2) return 400 + (q.length / span) * 100 - first * 0.5;
    // Near miss against the whole text, or against any one word, for longer queries.
    if (typo && q.length >= 4) {
      if (q.length < 8) {
        // One letter off, the fast check, in place: against the start of the text or of any word.
        if (someWord(t, (s0, e0) => withinOne(q, t, s0, e0) || withinOne(q, t, s0, Math.min(e0, s0 + q.length)))) return 240;
      } else {
        const words = t.split(" ");
        let best = editDistance(q, t.slice(0, q.length), 2);
        for (const w of words) best = Math.min(best, editDistance(q, w, 2), editDistance(q, w.slice(0, q.length), 2));
        if (best <= 2) return 300 - best * 60;
      }
    }
  }
  return null;
}

/** Items that fit the query, best match first (original order among equals); all items when empty. */
export function fuzzyRank<T>(items: readonly T[], query: string, text: (item: T) => string): T[] {
  if (normalizeForMatch(query) === "") return [...items];
  const scored: { item: T; score: number; index: number }[] = [];
  items.forEach((item, index) => {
    const score = fuzzyScore(query, text(item));
    if (score !== null) scored.push({ item, score, index });
  });
  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  return scored.map((s) => s.item);
}

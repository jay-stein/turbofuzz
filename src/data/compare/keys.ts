import { looksLikeIdName } from "../identifier.js";
import { keyTokenizer, pairFamily } from "./values.js";
import type { ColumnPairing, CompareRules, CompareSide } from "./types.js";

export interface KeySuggestion {
  /** Indexes into pairing.pairs. */
  pairs: number[];
  /** Share of B's keys that are also in A (0–1): `shared` of B's `filled` key rows. */
  overlap: number;
  shared: number;
  filled: number;
  /** Rows on each side with an empty key cell, and extra copies of a key. */
  problems: { emptyA: number; emptyB: number; duplicateA: number; duplicateB: number };
}

/** A key may have up to this share of empty or repeated rows on a side: they are reported, not a reason to drop the key. */
const PROBLEM_SHARE = 0.01;
/**
 * A key must link the sides: at least this share of B's keys is also in A.
 * Columns that are unique only by chance (age + income in an anonymous survey)
 * share almost nothing and would pair rows at random.
 */
const MIN_OVERLAP = 0.1;

/** Rows read when screening candidates; survivors are verified on every row. */
const SAMPLE = 20_000;
/** Columns tried two at a time when no single column is a key. */
const COMPOSITE_POOL = 6;

function tokensFor(side: CompareSide, other: CompareSide, pairing: ColumnPairing, pairIndexes: readonly number[], isA: boolean, rules: CompareRules, limit: number): (string | null)[] {
  const tokenizers = pairIndexes.map((index) => {
    const pair = pairing.pairs[index];
    const mine = side.columns[isA ? pair.a : pair.b];
    const theirs = other.columns[isA ? pair.b : pair.a];
    return keyTokenizer(mine, isA ? pairFamily(mine, theirs) : pairFamily(theirs, mine), rules);
  });
  const rows = Math.min(limit, side.rowCount);
  const out: (string | null)[] = new Array(rows);
  for (let row = 0; row < rows; row++) {
    let token: string | null = "";
    for (let i = 0; i < tokenizers.length && token !== null; i++) {
      const part = tokenizers[i](row);
      token = part === null ? null : i === 0 ? part : `${token}\u0001${part}`;
    }
    out[row] = token;
  }
  return out;
}

/** Empty and repeated rows, or null as soon as they pass the allowed share. */
function keyProblems(tokens: readonly (string | null)[]): { empty: number; duplicate: number } | null {
  const allowed = Math.floor(tokens.length * PROBLEM_SHARE);
  const seen = new Set<string>();
  let empty = 0;
  let duplicate = 0;
  for (const token of tokens) {
    if (token === null) empty++;
    else if (seen.has(token)) duplicate++;
    else seen.add(token);
    if (empty + duplicate > allowed) return null;
  }
  return { empty, duplicate };
}

function overlapOf(aTokens: readonly (string | null)[], bTokens: readonly (string | null)[]): { shared: number; filled: number } {
  const inA = new Set<string>();
  for (const token of aTokens) if (token !== null) inA.add(token);
  let hits = 0;
  let total = 0;
  for (const token of bTokens) {
    if (token === null) continue;
    total++;
    if (inA.has(token)) hits++;
  }
  return { shared: hits, filled: total };
}

/**
 * Key columns for matching rows, best first: column pairs that are filled and
 * unique on both sides, allowing up to 1% of rows with an empty or repeated
 * key (reported in `problems`). Single columns are preferred, ranked by how
 * many of B's keys A shares, then by an id-like name; failing that, two
 * columns together. Candidates are screened on a sample and verified on every
 * row. Empty when nothing qualifies: rows then match on their whole content.
 */
export function suggestKeys(a: CompareSide, b: CompareSide, pairing: ColumnPairing, rules: CompareRules): KeySuggestion[] {
  const verify = (indexes: number[]): KeySuggestion | null => {
    const sampleA = tokensFor(a, b, pairing, indexes, true, rules, SAMPLE);
    const sampleB = tokensFor(b, a, pairing, indexes, false, rules, SAMPLE);
    if (keyProblems(sampleA) === null || keyProblems(sampleB) === null) return null;
    const fullA = a.rowCount > SAMPLE ? tokensFor(a, b, pairing, indexes, true, rules, Infinity) : sampleA;
    const fullB = b.rowCount > SAMPLE ? tokensFor(b, a, pairing, indexes, false, rules, Infinity) : sampleB;
    const inA = keyProblems(fullA);
    const inB = keyProblems(fullB);
    if (inA === null || inB === null) return null;
    const { shared, filled } = overlapOf(fullA, fullB);
    const problems = { emptyA: inA.empty, emptyB: inB.empty, duplicateA: inA.duplicate, duplicateB: inB.duplicate };
    return filled > 0 && shared / filled >= MIN_OVERLAP ? { pairs: indexes, overlap: shared / filled, shared, filled, problems } : null;
  };
  // Overlap ranks first; an id-like name, then a whole-number or text type, break near-ties (a unique price is a poor key).
  const score = (suggestion: KeySuggestion): number => {
    const column = a.columns[pairing.pairs[suggestion.pairs[0]].a];
    const named = suggestion.pairs.length === 1 && looksLikeIdName(column.name) ? 0.1 : 0;
    const keyType = column.type === "identifier" || column.type === "integer" || column.type === "string" ? 0.02 : 0;
    // A clean key edges out one with empty or repeated rows.
    const p = suggestion.problems;
    const flawed = p.emptyA + p.emptyB + p.duplicateA + p.duplicateB > 0 ? 0.005 : 0;
    return suggestion.overlap + named + keyType - flawed;
  };

  const singles: KeySuggestion[] = [];
  pairing.pairs.forEach((_, index) => {
    const found = verify([index]);
    if (found !== null) singles.push(found);
  });
  if (singles.length > 0) {
    return singles.sort((x, y) => score(y) - score(x) || x.pairs[0] - y.pairs[0]);
  }

  // Two columns together: try the most varied filled columns (on a sample of A).
  const pool = pairing.pairs
    .map((_, index) => {
      const tokens = tokensFor(a, b, pairing, [index], true, rules, SAMPLE);
      if (tokens.some((token) => token === null)) return null;
      return { index, distinct: new Set(tokens).size };
    })
    .filter((entry): entry is { index: number; distinct: number } => entry !== null && entry.distinct > 1)
    .sort((x, y) => y.distinct - x.distinct || x.index - y.index)
    .slice(0, COMPOSITE_POOL)
    .map((entry) => entry.index);
  const composites: KeySuggestion[] = [];
  for (let i = 0; i < pool.length; i++) {
    for (let j = i + 1; j < pool.length; j++) {
      const indexes = [pool[i], pool[j]].sort((x, y) => x - y);
      const found = verify(indexes);
      if (found !== null) composites.push(found);
    }
  }
  return composites.sort((x, y) => score(y) - score(x) || x.pairs[0] - y.pairs[0] || x.pairs[1] - y.pairs[1]);
}

/** How well one paired column would work as the key, worked out on the first rows of each side. */
export interface KeyColumnStat {
  /** Index into pairing.pairs. */
  pair: number;
  /** Rows looked at on each side (all of them, or the first SAMPLE). */
  rowsA: number;
  rowsB: number;
  sampled: boolean;
  /** Rows with an empty key, and rows whose key was already seen (each would pair with several). */
  emptyA: number;
  emptyB: number;
  repeatA: number;
  repeatB: number;
  /** Different values on each side. */
  distinctA: number;
  distinctB: number;
  /** B's filled keys, and how many of them A has too. */
  filled: number;
  shared: number;
  verdict: "good" | "fair" | "poor";
  /** One line on why, in the words the setup shows. */
  reason: string;
}

const pct = (part: number, whole: number): string => {
  if (whole === 0) return "0%";
  const share = (part / whole) * 100;
  return share > 0 && share < 1 ? "<1%" : `${Math.round(share)}%`;
};
const count = (n: number): string => n.toLocaleString("en");

function sideStats(tokens: readonly (string | null)[]): { empty: number; repeat: number; distinct: Set<string> } {
  const distinct = new Set<string>();
  let empty = 0;
  let repeat = 0;
  for (const token of tokens) {
    if (token === null) empty++;
    else if (distinct.has(token)) repeat++;
    else distinct.add(token);
  }
  return { empty, repeat, distinct };
}

/**
 * Every paired column judged as a key, so a person choosing one by hand sees
 * why it would or would not work: how many values repeat (a row would pair
 * with several), how many are empty (those rows can't be matched), and how
 * many of B's values A has at all (a column of prices is unique by chance but
 * links nothing). Read on the first SAMPLE rows of each side, which keeps the
 * setup instant on big files; the suggestions above are checked on every row.
 */
export function keyColumnStats(a: CompareSide, b: CompareSide, pairing: ColumnPairing, rules: CompareRules): KeyColumnStat[] {
  return pairing.pairs.map((pair, index) => {
    const tokensA = tokensFor(a, b, pairing, [index], true, rules, SAMPLE);
    const tokensB = tokensFor(b, a, pairing, [index], false, rules, SAMPLE);
    const sa = sideStats(tokensA);
    const sb = sideStats(tokensB);
    let shared = 0;
    let filled = 0;
    for (const token of tokensB) {
      if (token === null) continue;
      filled++;
      if (sa.distinct.has(token)) shared++;
    }
    const stat = {
      pair: index,
      rowsA: tokensA.length,
      rowsB: tokensB.length,
      sampled: a.rowCount > SAMPLE || b.rowCount > SAMPLE,
      emptyA: sa.empty,
      emptyB: sb.empty,
      repeatA: sa.repeat,
      repeatB: sb.repeat,
      distinctA: sa.distinct.size,
      distinctB: sb.distinct.size,
      filled,
      shared,
    };
    return { ...stat, ...judgeKey(stat, a.columns[pair.a]?.type) };
  });
}

/** The verdict and its reason: the worst problem first, so the line says what would go wrong. */
function judgeKey(
  s: Omit<KeyColumnStat, "verdict" | "reason">,
  type: string | undefined,
): { verdict: KeyColumnStat["verdict"]; reason: string } {
  const filledA = s.rowsA - s.emptyA;
  const filledB = s.rowsB - s.emptyB;
  if (filledA === 0 || filledB === 0) return { verdict: "poor", reason: `Empty in ${filledA === 0 ? "A" : "B"}: nothing to match on.` };
  const overlap = s.filled === 0 ? 0 : s.shared / s.filled;
  const repeatShare = Math.max(s.repeatA / filledA, s.repeatB / filledB);
  const emptyShare = Math.max(s.emptyA / Math.max(1, s.rowsA), s.emptyB / Math.max(1, s.rowsB));
  // Mostly repeats: a category such as region or status.
  if (repeatShare > 0.5) {
    return { verdict: "poor", reason: `Only ${count(s.distinctA)} different value${s.distinctA === 1 ? "" : "s"} in A and ${count(s.distinctB)} in B: a label, not an id. Each row would pair with many.` };
  }
  if (overlap < MIN_OVERLAP) {
    return { verdict: "poor", reason: `Only ${pct(s.shared, s.filled)} of B's values are in A: the values don't link the two files.` };
  }
  if (repeatShare > PROBLEM_SHARE) {
    const side = s.repeatA / filledA >= s.repeatB / filledB ? "A" : "B";
    const repeats = side === "A" ? s.repeatA : s.repeatB;
    return { verdict: "poor", reason: `${count(repeats)} repeated value${repeats === 1 ? "" : "s"} in ${side} (${pct(repeats, side === "A" ? filledA : filledB)} of rows): those rows would pair with several.` };
  }
  if (emptyShare > 0.05) {
    const side = s.emptyA / s.rowsA >= s.emptyB / s.rowsB ? "A" : "B";
    const empty = side === "A" ? s.emptyA : s.emptyB;
    return { verdict: "poor", reason: `${pct(empty, side === "A" ? s.rowsA : s.rowsB)} of rows in ${side} are empty here: they couldn't be matched.` };
  }
  const flaws: string[] = [];
  if (s.repeatA + s.repeatB > 0) flaws.push(`${count(s.repeatA + s.repeatB)} repeated`);
  if (s.emptyA + s.emptyB > 0) flaws.push(`${count(s.emptyA + s.emptyB)} empty`);
  if (type === "number") {
    return { verdict: "fair", reason: `Unique, but a measure with decimals: if a value changes, its row shows as removed and added rather than changed.` };
  }
  if (overlap < 0.5) {
    return { verdict: "fair", reason: `Unique, but only ${pct(s.shared, s.filled)} of B's values are in A: many rows will show as only in A or only in B.` };
  }
  if (flaws.length > 0) {
    return { verdict: "fair", reason: `Nearly unique (${flaws.join(", ")}) and ${pct(s.shared, s.filled)} of B's values are in A.` };
  }
  return { verdict: "good", reason: `Unique and filled on both sides; ${pct(s.shared, s.filled)} of B's values are in A.` };
}

import { familyOf, keyTokenizer, pairFamily } from "./values.js";
import type { ColumnPairing, CompareRules, CompareSide } from "./types.js";

/** Two columns, one only in A and one only in B, whose values say they are the same column under two names. */
export interface PairSuggestion {
  /** Index into A's columns and into B's columns. */
  a: number;
  b: number;
  /** Share of B's distinct values that A has too (0-1): `shared` of `distinctB`. */
  overlap: number;
  shared: number;
  distinctB: number;
  /** Nearly every filled value is unique on both sides, so the pair would work as a key. */
  keyLike: boolean;
  /** Worked out on the first rows of each side only. */
  sampled: boolean;
}

/** Rows read on each side, the same sample the key analysis uses. */
const SAMPLE = 20_000;
/**
 * Share of B's distinct values A must have. High, because a rename keeps the
 * values; a few added or removed rows are what is left over.
 */
export const MIN_PAIR_OVERLAP = 0.9;
/**
 * Distinct values each side needs. Two columns of Yes/No, or of a handful of
 * statuses, share their values without being the same column; with 20 or more
 * different values on both sides, agreeing by coincidence is not plausible.
 */
export const MIN_PAIR_DISTINCT = 20;
/** A key may have this share of empty or repeated rows (the same allowance the key analysis makes). */
const KEY_PROBLEM_SHARE = 0.01;
/** Candidates that are re-read on every row when a side is longer than the sample. */
const FULL_CHECKS = 3;

interface Tokens {
  distinct: Set<string>;
  filled: number;
  /** Empty cells and repeats of a value already seen. */
  empty: number;
  repeat: number;
}

function read(side: CompareSide, index: number, other: CompareSide, otherIndex: number, isA: boolean, rules: CompareRules, limit: number): Tokens {
  const mine = side.columns[index]!;
  const theirs = other.columns[otherIndex]!;
  const token = keyTokenizer(mine, isA ? pairFamily(mine, theirs) : pairFamily(theirs, mine), rules);
  const distinct = new Set<string>();
  let empty = 0;
  let repeat = 0;
  const rows = Math.min(limit, side.rowCount);
  for (let row = 0; row < rows; row++) {
    const value = token(row);
    if (value === null) empty++;
    else if (distinct.has(value)) repeat++;
    else distinct.add(value);
  }
  return { distinct, filled: rows - empty, empty, repeat };
}

/** Numbers and text can hold the same ids (007 as text, 7 as a number); a date never pairs with a number. */
function compatible(a: SideColumn, b: SideColumn): boolean {
  const fa = familyOf(a.type);
  const fb = familyOf(b.type);
  return fa === fb || (fa === "number" && fb === "text") || (fa === "text" && fb === "number");
}
type SideColumn = CompareSide["columns"][number];

function judge(a: Tokens, b: Tokens, total: { a: number; b: number }, where: { sampled: boolean }, ai: number, bi: number): PairSuggestion | null {
  if (a.distinct.size < MIN_PAIR_DISTINCT || b.distinct.size < MIN_PAIR_DISTINCT) return null;
  let shared = 0;
  for (const value of b.distinct) if (a.distinct.has(value)) shared++;
  const overlap = shared / b.distinct.size;
  const tidy = (t: Tokens, rows: number): boolean => t.filled > 0 && t.empty + t.repeat <= Math.floor(rows * KEY_PROBLEM_SHARE);
  return { a: ai, b: bi, overlap, shared, distinctB: b.distinct.size, keyLike: tidy(a, total.a) && tidy(b, total.b), sampled: where.sampled };
}

/**
 * Columns that look renamed: one only A has and one only B has, of compatible
 * type, with many different values on both sides and at least
 * MIN_PAIR_OVERLAP of B's values in A. Worked out on the first SAMPLE rows;
 * when a side is longer, the best few candidates are checked on every row so
 * a shuffled file is not missed. Best first.
 */
export function suggestColumnPairs(a: CompareSide, b: CompareSide, pairing: ColumnPairing, rules: CompareRules): PairSuggestion[] {
  if (pairing.onlyA.length === 0 || pairing.onlyB.length === 0) return [];
  const sampled = a.rowCount > SAMPLE || b.rowCount > SAMPLE;
  const cache = new Map<string, Tokens>();
  const tokens = (ai: number, bi: number, isA: boolean): Tokens => {
    const key = `${isA ? "a" : "b"}${ai}:${bi}`;
    let found = cache.get(key);
    if (found === undefined) {
      found = isA ? read(a, ai, b, bi, true, rules, SAMPLE) : read(b, bi, a, ai, false, rules, SAMPLE);
      cache.set(key, found);
    }
    return found;
  };
  const screened: { ai: number; bi: number; shared: number; distinctB: number }[] = [];
  const found: PairSuggestion[] = [];
  for (const ai of pairing.onlyA) {
    for (const bi of pairing.onlyB) {
      if (!compatible(a.columns[ai]!, b.columns[bi]!)) continue;
      const sa = tokens(ai, bi, true);
      const sb = tokens(ai, bi, false);
      const judged = judge(sa, sb, { a: Math.min(SAMPLE, a.rowCount), b: Math.min(SAMPLE, b.rowCount) }, { sampled }, ai, bi);
      if (judged === null) continue;
      if (!sampled) {
        if (judged.overlap >= MIN_PAIR_OVERLAP) found.push(judged);
      } else if (judged.shared >= Math.max(3, judged.distinctB * 0.01)) {
        screened.push({ ai, bi, shared: judged.shared, distinctB: judged.distinctB });
      }
    }
  }
  // Longer sides: the sample only screens (a shuffled file shares few values in its first rows); the best few are read in full.
  screened.sort((x, y) => y.shared / y.distinctB - x.shared / x.distinctB);
  for (const { ai, bi } of screened.slice(0, FULL_CHECKS)) {
    const full = judge(read(a, ai, b, bi, true, rules, Infinity), read(b, bi, a, ai, false, rules, Infinity), { a: a.rowCount, b: b.rowCount }, { sampled: false }, ai, bi);
    if (full !== null && full.overlap >= MIN_PAIR_OVERLAP) found.push(full);
  }
  return found.sort((x, y) => y.overlap - x.overlap || x.a - y.a || x.b - y.b);
}

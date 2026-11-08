import { looksLikeIdName } from "../identifier.js";
import { keyTokenizer, pairFamily } from "./values.js";
import type { ColumnPairing, CompareRules, CompareSide } from "./types.js";

export interface KeySuggestion {
  /** Indexes into pairing.pairs. */
  pairs: number[];
  /** Share of B's keys that are also in A (0–1). */
  overlap: number;
}

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

/** Every row filled and no token repeated. */
function isUnique(tokens: readonly (string | null)[]): boolean {
  const seen = new Set<string>();
  for (const token of tokens) {
    if (token === null || seen.has(token)) return false;
    seen.add(token);
  }
  return true;
}

function overlapOf(aTokens: readonly (string | null)[], bTokens: readonly (string | null)[]): number {
  const inA = new Set<string>();
  for (const token of aTokens) if (token !== null) inA.add(token);
  let hits = 0;
  let total = 0;
  for (const token of bTokens) {
    if (token === null) continue;
    total++;
    if (inA.has(token)) hits++;
  }
  return total === 0 ? 0 : hits / total;
}

/**
 * Key columns for matching rows, best first: column pairs that are filled and
 * unique on both sides. Single columns are preferred, ranked by how many of
 * B's keys A shares, then by an id-like name; failing that, two columns
 * together. Candidates are screened on a sample and verified on every row.
 * Empty when nothing qualifies: rows then match on their whole content.
 */
export function suggestKeys(a: CompareSide, b: CompareSide, pairing: ColumnPairing, rules: CompareRules): KeySuggestion[] {
  const verify = (indexes: number[]): KeySuggestion | null => {
    const sampleA = tokensFor(a, b, pairing, indexes, true, rules, SAMPLE);
    const sampleB = tokensFor(b, a, pairing, indexes, false, rules, SAMPLE);
    if (!isUnique(sampleA) || !isUnique(sampleB)) return null;
    const fullA = a.rowCount > SAMPLE ? tokensFor(a, b, pairing, indexes, true, rules, Infinity) : sampleA;
    const fullB = b.rowCount > SAMPLE ? tokensFor(b, a, pairing, indexes, false, rules, Infinity) : sampleB;
    if (!isUnique(fullA) || !isUnique(fullB)) return null;
    const overlap = overlapOf(fullA, fullB);
    return overlap > 0 ? { pairs: indexes, overlap } : null;
  };
  // Overlap ranks first; an id-like name, then a whole-number or text type, break near-ties (a unique price is a poor key).
  const score = (suggestion: KeySuggestion): number => {
    const column = a.columns[pairing.pairs[suggestion.pairs[0]].a];
    const named = suggestion.pairs.length === 1 && looksLikeIdName(column.name) ? 0.1 : 0;
    const keyType = column.type === "identifier" || column.type === "integer" || column.type === "string" ? 0.02 : 0;
    return suggestion.overlap + named + keyType;
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

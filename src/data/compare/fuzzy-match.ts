import { jaroWinkler } from "../../search/jaro-winkler.js";
import { normalize } from "../../search/normalize.js";
import { cellComparer, familyOf, keyTokenizer, pairFamily } from "./values.js";
import type { ColumnPair, CompareRules, CompareSide } from "./types.js";

/** How sure a similar-key pairing is. "confident": the keys are nearly the same or another column agrees. "review": a person should look. */
export type FuzzyTier = "confident" | "review";

export interface FuzzyPair {
  aRow: number;
  bRow: number;
  /** Similarity of the key text, 0-1. */
  score: number;
  tier: FuzzyTier;
  /** Other paired columns that agree, of those both rows fill. */
  agree: number;
  checked: number;
  /** Another row of B was almost as close. */
  ambiguous: boolean;
  /** The key cells as written, for showing the pair. */
  aKey: string;
  bKey: string;
}

export interface FuzzyOptions {
  /** The least key similarity that is a candidate (the slider); 0.70-0.97. */
  threshold: number;
  /** Pairs the person rejected, as `${aRow}:${bRow}`. */
  rejected?: ReadonlySet<string>;
}

/** Words that differ between spellings of the same organisation or address and carry no identity. */
const NOISE = new Set(["the", "pty", "ltd", "limited", "inc", "incorporated", "llc", "co", "corp", "corporation", "company", "plc", "gmbh", "and"]);
const ABBREVIATIONS: Record<string, string> = {
  st: "street", rd: "road", ave: "avenue", av: "avenue", dr: "drive", ln: "lane", ct: "court", pl: "place", blvd: "boulevard",
  hwy: "highway", mt: "mount", ste: "suite", apt: "apartment", intl: "international", assoc: "associates", bros: "brothers",
};
const DIGIT_RUNS = /\d+/g;
/** A word shared by more rows than this is too common to find candidates with ("street"). */
const MAX_POSTING = 150;
/** Candidates scored per row of A, best first by shared words. */
const MAX_CANDIDATES = 40;
/** Another row this close to the best one makes a pairing ambiguous. */
const AMBIGUITY_GAP = 0.02;
/** Key scores at or above this are confident on the text alone. */
const CONFIDENT_SCORE = 0.96;

export interface Prepared {
  /** Words, abbreviations expanded and noise words dropped, in order. */
  words: string[];
  /** The words sorted, so "Smith John" meets "John Smith". */
  sorted: string;
  /** The text in order. */
  text: string;
  digits: string;
}

/** The identity of a name or address: folded, punctuation gone, abbreviations expanded, company suffixes dropped. */
export function prepareKey(value: string): Prepared {
  const folded = normalize(value).replace(/[^\p{L}\p{N}\s]/gu, " ");
  const all = folded.split(/\s+/).filter((word) => word !== "").map((word) => ABBREVIATIONS[word] ?? word);
  const kept = all.filter((word) => !NOISE.has(word));
  // A key made only of noise words ("The Company") keeps them.
  const words = kept.length > 0 ? kept : all;
  return { words, sorted: [...words].sort().join(" "), text: words.join(" "), digits: (words.join(" ").match(DIGIT_RUNS) ?? []).join(",") };
}

/** Key similarity: the better of the words in order and the words in any order. Different numbers inside the text never match. */
export function keySimilarity(x: Prepared, y: Prepared): number {
  if (x.digits !== y.digits) return 0;
  if (x.text === "" || y.text === "") return 0;
  if (x.text === y.text || x.sorted === y.sorted) return 1;
  return Math.max(jaroWinkler(x.text, y.text), jaroWinkler(x.sorted, y.sorted));
}

/**
 * Pairs rows the exact key match left over. Only text key columns are read (numbers and dates must match exactly). Each row of A
 * is scored against the rows of B that share a word with it; the best pairs are taken one to one. Every other paired column that
 * both rows fill is a check: agreeing amounts or dates are what make a loose name match trustworthy.
 */
export function findFuzzyPairs(
  a: CompareSide,
  b: CompareSide,
  pairs: readonly ColumnPair[],
  keyPairs: readonly ColumnPair[],
  rules: CompareRules,
  freeA: readonly number[],
  freeB: readonly number[],
  options: FuzzyOptions,
): FuzzyPair[] {
  const textKeys = keyPairs.filter((pair) => pairFamily(a.columns[pair.a], b.columns[pair.b]) === "text");
  // A composite key with a non-text part pairs only when that part is exact, which the exact pass already settled.
  if (textKeys.length === 0 || textKeys.length !== keyPairs.length) return [];

  const keyOf = (side: CompareSide, row: number, isA: boolean): string | null => {
    const parts: string[] = [];
    for (const pair of textKeys) {
      const column = side.columns[isA ? pair.a : pair.b];
      const token = keyTokenizer(column, "text", rules)(row);
      if (token === null) return null;
      parts.push(token);
    }
    return parts.join(" ");
  };
  const prepared = (side: CompareSide, rows: readonly number[], isA: boolean): (Prepared | null)[] =>
    rows.map((row) => {
      const key = keyOf(side, row, isA);
      return key === null ? null : prepareKey(key);
    });
  const prepA = prepared(a, freeA, true);
  const prepB = prepared(b, freeB, false);

  // Words of B (and their first four letters, which survive a typo late in the word) point to its rows.
  const postings = new Map<string, number[]>();
  prepB.forEach((entry, index) => {
    if (entry === null) return;
    const seen = new Set<string>();
    for (const word of entry.words) {
      for (const token of word.length > 4 ? [word, word.slice(0, 4)] : [word]) {
        if (seen.has(token)) continue;
        seen.add(token);
        const list = postings.get(token);
        if (list === undefined) postings.set(token, [index]);
        else list.push(index);
      }
    }
  });

  const checks = pairs
    .filter((pair) => !keyPairs.some((key) => key.a === pair.a && key.b === pair.b))
    .map((pair) => ({ pair, equal: cellComparer(a.columns[pair.a], b.columns[pair.b], rules), family: familyOf(a.columns[pair.a].type) }))
    // Free text columns rarely agree exactly and say little; amounts and dates are the checks.
    .filter((check) => check.family !== "text");
  const agreement = (aRow: number, bRow: number): { agree: number; checked: number } => {
    let agree = 0;
    let checked = 0;
    for (const check of checks) {
      if (a.columns[check.pair.a].isEmpty(aRow) || b.columns[check.pair.b].isEmpty(bRow)) continue;
      checked++;
      if (check.equal(aRow, bRow)) agree++;
    }
    return { agree, checked };
  };

  interface Candidate { ai: number; bi: number; score: number; rank: number; agree: number; checked: number }
  const candidates: Candidate[] = [];
  const bestFor = new Map<number, number[]>();
  prepA.forEach((entry, ai) => {
    if (entry === null) return;
    const votes = new Map<number, number>();
    for (const word of entry.words) {
      for (const token of word.length > 4 ? [word, word.slice(0, 4)] : [word]) {
        const list = postings.get(token);
        if (list === undefined || list.length > MAX_POSTING) continue;
        for (const bi of list) votes.set(bi, (votes.get(bi) ?? 0) + 1);
      }
    }
    const shortlist = [...votes.entries()].sort((x, y) => y[1] - x[1] || x[0] - y[0]).slice(0, MAX_CANDIDATES);
    const scores: number[] = [];
    for (const [bi] of shortlist) {
      const other = prepB[bi];
      if (other === null) continue;
      const score = keySimilarity(entry, other);
      if (score < options.threshold) continue;
      if (options.rejected?.has(`${freeA[ai]}:${freeB[bi]}`) === true) continue;
      const { agree, checked } = agreement(freeA[ai], freeB[bi]);
      // Agreeing checks lift a pairing; disagreeing ones lower it a little (a name can match while the amount differs).
      const rank = score + (checked === 0 ? 0 : 0.08 * (agree / checked) - 0.02 * (1 - agree / checked));
      candidates.push({ ai, bi, score, rank, agree, checked });
      scores.push(score);
    }
    bestFor.set(ai, scores.sort((x, y) => y - x));
  });

  candidates.sort((x, y) => y.rank - x.rank || x.ai - y.ai || x.bi - y.bi);
  const usedA = new Set<number>();
  const usedB = new Set<number>();
  const out: FuzzyPair[] = [];
  for (const candidate of candidates) {
    if (usedA.has(candidate.ai) || usedB.has(candidate.bi)) continue;
    usedA.add(candidate.ai);
    usedB.add(candidate.bi);
    const scores = bestFor.get(candidate.ai) ?? [];
    const ambiguous = scores.length > 1 && scores[0] - scores[1] < AMBIGUITY_GAP && scores[1] >= options.threshold;
    const supported = candidate.checked > 0 && candidate.agree / candidate.checked >= 0.5;
    // A name that is the same once tidied is confident whatever the amount says: the amount is then a difference to report.
    const confident = !ambiguous && (candidate.score >= CONFIDENT_SCORE || (supported && candidate.score >= 0.88));
    out.push({
      aRow: freeA[candidate.ai],
      bRow: freeB[candidate.bi],
      score: candidate.score,
      tier: confident ? "confident" : "review",
      agree: candidate.agree,
      checked: candidate.checked,
      ambiguous,
      aKey: textKeys.map((pair) => a.columns[pair.a].raw[freeA[candidate.ai]]).join(" · "),
      bKey: textKeys.map((pair) => b.columns[pair.b].raw[freeB[candidate.bi]]).join(" · "),
    });
  }
  return out;
}

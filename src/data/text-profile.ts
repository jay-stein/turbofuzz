import { tokenize } from "../search/normalize.js";
import type { BitSet } from "../search/bitset.js";

export interface TextShapeCounts {
  email: number;
  url: number;
  phone: number;
  numeric: number;
  dateLike: number;
  uppercase: number;
  hasDigits: number;
}

export interface TextTerm {
  term: string;
  count: number;
}

export interface TextProfile {
  rows: number;
  characters: number;
  avgLength: number;
  totalTokens: number;
  distinctTerms: number;
  topTerms: TextTerm[];
  shapes: TextShapeCounts;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const URL = /^(https?:\/\/|www\.)\S+$/i;
const PHONE = /^[+()\d][\d\s().-]{5,}$/;
const NUMERIC = /^[-+]?\d*\.?\d+$/;
const DATE_LIKE = /^\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}/;

/** Common English function words: noise for keyword mining, cheap to keep. */
const STOPWORDS = new Set([
  "the", "and", "for", "are", "but", "not", "you", "all", "any", "can", "had",
  "her", "was", "one", "our", "out", "day", "get", "has", "him", "his", "how",
  "its", "may", "new", "now", "old", "see", "two", "way", "who", "boy", "did",
  "use", "she", "that", "with", "have", "this", "will", "your", "from", "they",
  "know", "want", "been", "good", "much", "some", "time", "very", "when", "come",
  "here", "just", "like", "long", "make", "many", "more", "only", "over", "such",
  "take", "than", "them", "well", "were", "what", "work", "year", "back", "call",
  "came", "each", "even", "find", "give", "most", "must", "name", "need", "next",
  "open", "part", "said", "same", "seem", "side", "tell", "turn", "used", "want",
  "about", "would", "there", "their", "which", "could", "other", "these", "after",
  "first", "never", "where", "those", "being", "every", "great", "might", "shall",
  "still", "since", "while", "under", "should", "because", "between", "through",
  "please", "thanks", "thank", "hello", "dear", "regards", "sincerely",
]);

const MAX_DISTINCT_TRACKED = 100_000;

/**
 * Text profile for keyword mining: token frequencies with stopword filtering,
 * plus the share of shaped values (email, URL, phone, number, date-like) so a
 * column's role is obvious at a glance.
 */
export function textProfile(
  values: readonly string[],
  nullMask: BitSet,
  limit = 30,
): TextProfile {
  const counts = new Map<string, number>();
  const distinct = new Set<string>();
  const shapes: TextShapeCounts = {
    email: 0,
    url: 0,
    phone: 0,
    numeric: 0,
    dateLike: 0,
    uppercase: 0,
    hasDigits: 0,
  };
  let rows = 0;
  let characters = 0;
  let totalTokens = 0;

  for (let row = 0; row < values.length; row++) {
    if (nullMask.get(row)) continue;
    const value = values[row] ?? "";
    const trimmed = value.trim();
    if (trimmed === "") continue;
    rows++;
    characters += trimmed.length;
    if (EMAIL.test(trimmed)) shapes.email++;
    else if (URL.test(trimmed)) shapes.url++;
    else if (PHONE.test(trimmed)) shapes.phone++;
    else if (NUMERIC.test(trimmed)) shapes.numeric++;
    else if (DATE_LIKE.test(trimmed)) shapes.dateLike++;
    if (trimmed === trimmed.toUpperCase() && /[\p{L}]/u.test(trimmed)) shapes.uppercase++;
    if (/\d/.test(trimmed)) shapes.hasDigits++;

    for (const token of tokenize(trimmed)) {
      if (token.length < 2 || STOPWORDS.has(token)) continue;
      totalTokens++;
      counts.set(token, (counts.get(token) ?? 0) + 1);
      if (distinct.size < MAX_DISTINCT_TRACKED) distinct.add(token);
    }
  }

  const topTerms = [...counts.entries()]
    .map(([term, count]) => ({ term, count }))
    .sort((a, b) => b.count - a.count || (a.term < b.term ? -1 : 1))
    .slice(0, Math.max(1, Math.floor(limit)));

  return {
    rows,
    characters,
    avgLength: rows > 0 ? characters / rows : 0,
    totalTokens,
    distinctTerms: distinct.size,
    topTerms,
    shapes,
  };
}

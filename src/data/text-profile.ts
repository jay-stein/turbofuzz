import { tokenize } from "../search/normalize.js";
import type { BitSet } from "../search/bitset.js";

export interface TextShapeCounts {
  email: number;
  url: number;
  phone: number;
  creditCard: number;
  iban: number;
  taxFileNumber: number;
  abn: number;
  acn: number;
  governmentId: number;
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
const CARD_CANDIDATE = /^(?:\d[ -]?){12,18}\d$/;
const IBAN_CANDIDATE = /^[A-Za-z]{2}\d{2}[A-Za-z0-9 ]{11,30}$/;
const AUSTRALIAN_ID = /^\d(?:[ -]?\d){7,10}$/;
const GOVERNMENT_ID = /^\d{3}-\d{2}-\d{4}$/;
const NUMERIC = /^[-+]?\d*\.?\d+$/;
const DATE_LIKE = /^\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}/;

function luhnValid(value: string): boolean {
  const digits = value.replace(/\D/g, "");
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let double = false;
  for (let index = digits.length - 1; index >= 0; index--) {
    let digit = Number(digits[index]);
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return sum % 10 === 0;
}

function ibanValid(value: string): boolean {
  const compact = value.replace(/[\s-]/g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(compact)) return false;
  const rearranged = compact.slice(4) + compact.slice(0, 4);
  let remainder = 0;
  for (const char of rearranged) {
    if (/\d/.test(char)) {
      remainder = (remainder * 10 + Number(char)) % 97;
    } else {
      remainder = (remainder * 100 + char.charCodeAt(0) - 55) % 97;
    }
  }
  return remainder === 1;
}

function digitsOf(value: string): string {
  return value.replace(/\D/g, "");
}

/** Australian Business Number: 11 digits with the ATO modulus-89 check. */
function abnValid(value: string): boolean {
  const digits = digitsOf(value).split("").map(Number);
  if (digits.length !== 11) return false;
  const weights = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];
  digits[0] -= 1;
  const sum = digits.reduce((total, digit, index) => total + digit * weights[index], 0);
  return sum % 89 === 0;
}

/** Australian Company Number: 9 digits with the ASIC check digit. */
function acnValid(value: string): boolean {
  const digits = digitsOf(value).split("").map(Number);
  if (digits.length !== 9) return false;
  const weights = [8, 7, 6, 5, 4, 3, 2, 1];
  const sum = digits
    .slice(0, 8)
    .reduce((total, digit, index) => total + digit * weights[index], 0);
  return (10 - (sum % 10)) % 10 === digits[8];
}

/** Australian Tax File Number: 8 or 9 digits with the ATO modulus-11 check. */
function tfnValid(value: string): boolean {
  const digits = digitsOf(value).split("").map(Number);
  if (digits.length !== 8 && digits.length !== 9) return false;
  const weights = digits.length === 9 ? [1, 4, 3, 7, 5, 8, 6, 9, 10] : [4, 3, 7, 5, 8, 6, 9, 10];
  const sum = digits.reduce((total, digit, index) => total + digit * weights[index], 0);
  return sum % 11 === 0;
}

/** Common English function words: noise for keyword mining, cheap to keep. */
const STOPWORDS = new Set([
  "a", "about", "above", "after", "again", "against", "all", "am", "an", "and",
  "any", "are", "aren", "as", "at", "be", "because", "been", "before", "being",
  "below", "between", "both", "boy", "but", "by", "call", "came", "can", "cannot",
  "come", "could", "couldn", "day", "dear", "did", "didn", "do", "does", "doesn",
  "doing", "don", "down", "during", "each", "even", "every", "few", "find",
  "first", "for", "from", "further", "get", "give", "good", "great", "had",
  "hadn", "has", "hasn", "have", "haven", "having", "he", "hello", "her", "here",
  "hers", "herself", "him", "himself", "his", "how", "however", "i", "if", "in",
  "into", "is", "isn", "it", "its", "itself", "just", "know", "let", "like",
  "long", "make", "many", "may", "might", "mightn", "more", "most", "much",
  "must", "mustn", "my", "myself", "name", "need", "needn", "never", "new",
  "next", "no", "nor", "not", "now", "of", "off", "old", "on", "once", "one",
  "only", "open", "or", "other", "ought", "our", "ours", "ourselves", "out",
  "over", "own", "part", "please", "regards", "said", "same", "see", "seem",
  "shan", "she", "should", "shouldn", "side", "sincerely", "since", "so", "some",
  "still", "such", "take", "tell", "than", "thank", "thanks", "that", "the",
  "their", "theirs", "them", "themselves", "then", "there", "these", "they",
  "this", "those", "through", "time", "to", "too", "turn", "two", "under",
  "until", "up", "use", "used", "very", "want", "was", "wasn", "way", "we",
  "well", "were", "weren", "what", "when", "where", "which", "while", "who",
  "whom", "why", "will", "with", "won", "work", "would", "wouldn", "year",
  "you", "your", "yours", "yourself", "yourselves",
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
  includeTerms = true,
): TextProfile {
  const counts = new Map<string, number>();
  const distinct = new Set<string>();
  const shapes: TextShapeCounts = {
    email: 0,
    url: 0,
    phone: 0,
    creditCard: 0,
    iban: 0,
    taxFileNumber: 0,
    abn: 0,
    acn: 0,
    governmentId: 0,
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
    else if (CARD_CANDIDATE.test(trimmed) && luhnValid(trimmed)) shapes.creditCard++;
    else if (IBAN_CANDIDATE.test(trimmed) && ibanValid(trimmed)) shapes.iban++;
    else if (AUSTRALIAN_ID.test(trimmed) && abnValid(trimmed)) shapes.abn++;
    else if (AUSTRALIAN_ID.test(trimmed) && acnValid(trimmed)) shapes.acn++;
    else if (AUSTRALIAN_ID.test(trimmed) && tfnValid(trimmed)) shapes.taxFileNumber++;
    else if (GOVERNMENT_ID.test(trimmed)) shapes.governmentId++;
    else if (PHONE.test(trimmed)) shapes.phone++;
    else if (NUMERIC.test(trimmed)) shapes.numeric++;
    else if (DATE_LIKE.test(trimmed)) shapes.dateLike++;
    if (trimmed === trimmed.toUpperCase() && /[\p{L}]/u.test(trimmed)) shapes.uppercase++;
    if (/\d/.test(trimmed)) shapes.hasDigits++;

    if (!includeTerms) continue;
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

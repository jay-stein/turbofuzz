import { jaroWinkler } from "./jaro-winkler.js";
import { normalize } from "./normalize.js";
import { classifyDateValue } from "../parse/dates.js";
import { parseNumber } from "../parse/numbers.js";

export interface SimilarValue {
  value: string;
  count: number;
}

export interface SimilarCluster {
  /** Members ordered with the suggested canonical spelling first. */
  values: SimilarValue[];
  suggested: string;
}

function isDateOrNumber(value: string): boolean {
  const trimmed = value.trim();
  return Number.isFinite(parseNumber(trimmed)) || classifyDateValue(trimmed) !== null;
}

const LETTERS = /[^\p{L}]/gu;
const NOT_ALNUM = /[^\p{L}\p{N}]/gu;
const DIGIT_RUNS = /\d+/g;
const SHORT_MIN = 4;
const SHORT_MAX = 9;

/**
 * One slip with the same first letter: a substituted, missing or doubled letter inside the word, or two neighbouring letters
 * swapped. A letter added or dropped at the very end is a different name ("Angel", "Angela"), not a slip.
 */
function oneSlip(a: string, b: string): boolean {
  if (a[0] !== b[0] || Math.abs(a.length - b.length) > 1) return false;
  const [shortest, longest] = a.length <= b.length ? [a, b] : [b, a];
  if (a.length !== b.length) return !longest.startsWith(shortest) && withinOneInsertion(shortest, longest);
  let first = -1;
  let diffs = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === b[i]) continue;
    if (++diffs === 1) first = i;
    else if (diffs === 2) {
      if (!(i === first + 1 && a[first] === b[i] && a[i] === b[first])) return false;
    } else return false;
  }
  return diffs > 0;
}

/** `longest` is `shortest` with one letter inserted. */
function withinOneInsertion(shortest: string, longest: string): boolean {
  let i = 0;
  while (i < shortest.length && shortest[i] === longest[i]) i++;
  return shortest.slice(i) === longest.slice(i + 1);
}

/**
 * Whether two normalised values may be merged once Jaro-Winkler calls them close. Numbers inside the text must match exactly
 * ("278 Lake Road" is not "267 Lake Rd"), and short names are different values unless only spacing, punctuation, a case or accent
 * differs or one letter slipped inside the word ("Angel" is not "Angela", "Stephen" is not "Stephanie").
 */
export function mergeable(keyA: string, keyB: string): boolean {
  if ((keyA.match(DIGIT_RUNS)?.join(",") ?? "") !== (keyB.match(DIGIT_RUNS)?.join(",") ?? "")) return false;
  const lettersA = keyA.replace(LETTERS, "").length;
  const lettersB = keyB.replace(LETTERS, "").length;
  if (lettersA < SHORT_MIN || lettersA > SHORT_MAX || lettersB < SHORT_MIN || lettersB > SHORT_MAX) return true;
  const a = keyA.replace(NOT_ALNUM, "");
  const b = keyB.replace(NOT_ALNUM, "");
  return a === b || oneSlip(a, b);
}

/**
 * Greedy pairwise clustering over category labels. Values compare in
 * normalized form (case, accents and padding folded) with Jaro-Winkler, and
 * clusters grow from the most frequent value so the canonical suggestion is
 * the most common spelling. Every value joins at most one cluster.
 */
export function clusterSimilar(
  values: readonly SimilarValue[],
  threshold = 0.9,
): SimilarCluster[] {
  // Dates and numbers differ by meaning, not spelling (22/08/1976 vs 22/02/1974).
  const candidates = values
    .filter(({ value }) => !isDateOrNumber(value))
    .map((entry) => ({ ...entry, key: normalize(entry.value) }))
    .sort((a, b) => b.count - a.count || (a.value < b.value ? -1 : a.value > b.value ? 1 : 0));

  const assigned = new Set<number>();
  const clusters: SimilarCluster[] = [];
  for (let seed = 0; seed < candidates.length; seed++) {
    if (assigned.has(seed)) continue;
    assigned.add(seed);
    const members = [candidates[seed]];
    for (let other = seed + 1; other < candidates.length; other++) {
      if (assigned.has(other)) continue;
      if (jaroWinkler(candidates[seed].key, candidates[other].key) >= threshold && mergeable(candidates[seed].key, candidates[other].key)) {
        assigned.add(other);
        members.push(candidates[other]);
      }
    }
    if (members.length > 1) {
      clusters.push({
        values: members.map(({ value, count }) => ({ value, count })),
        suggested: candidates[seed].value,
      });
    }
  }
  return clusters;
}

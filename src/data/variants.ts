import { normalize } from "../search/normalize.js";

/**
 * Deterministic spelling variants: values that differ only by case, spacing or
 * accents (FINANCE / finance / Finance). Unlike fuzzy matches (Melb. vs
 * Melbourne) these are certain, so they count toward the score.
 */
export interface VariantSummary {
  /** Groups holding more than one distinct spelling. */
  groups: number;
  /** Rows written in a minority spelling of their group. */
  minorityRows: number;
  /** Up to three groups, most affected first; spellings by count descending. */
  examples: { spellings: { value: string; count: number }[] }[];
  /**
   * Every minority spelling and the most common spelling of its group, so a fix
   * can standardise exactly what the preview showed. Capped at MAX_MAPPINGS pairs.
   */
  mappings: { from: string; to: string; count: number }[];
  /**
   * Every group (most affected first) with all its spellings, so the user can pick
   * a different standard than the most common one. Capped; absent in older data.
   */
  detail?: { spellings: { value: string; count: number }[] }[];
}

const MAX_DETAIL_GROUPS = 300;
const MAX_DETAIL_SPELLINGS = 20;

const MAX_MAPPINGS = 2000;

export function spellingVariants(
  labels: readonly string[],
  counts: readonly number[],
): VariantSummary | null {
  const byKey = new Map<string, { value: string; count: number }[]>();
  for (let i = 0; i < labels.length; i++) {
    const key = normalize(labels[i]);
    if (key === "") continue;
    const list = byKey.get(key);
    const entry = { value: labels[i], count: counts[i] ?? 0 };
    if (list === undefined) byKey.set(key, [entry]);
    else list.push(entry);
  }
  let groups = 0;
  let minorityRows = 0;
  const mappings: { from: string; to: string; count: number }[] = [];
  const examples: { minority: number; spellings: { value: string; count: number }[] }[] = [];
  for (const list of byKey.values()) {
    if (list.length < 2) continue;
    // Most common first; on a tie prefer Title Case or lower case over SHOUTING.
    const shout = (value: string): number => (value.length > 1 && value === value.toUpperCase() && value !== value.toLowerCase() ? 1 : 0);
    list.sort((a, b) => b.count - a.count || shout(a.value) - shout(b.value));
    groups++;
    const minority = list.slice(1).reduce((sum, entry) => sum + entry.count, 0);
    minorityRows += minority;
    for (const entry of list.slice(1)) {
      if (mappings.length < MAX_MAPPINGS) {
        mappings.push({ from: entry.value, to: list[0].value, count: entry.count });
      }
    }
    examples.push({ minority, spellings: list });
  }
  if (groups === 0) return null;
  examples.sort((a, b) => b.minority - a.minority);
  return {
    groups,
    minorityRows,
    examples: examples.slice(0, 3).map(({ spellings }) => ({ spellings: spellings.slice(0, 8) })),
    mappings,
    detail: examples.slice(0, MAX_DETAIL_GROUPS).map(({ spellings }) => ({ spellings: spellings.slice(0, MAX_DETAIL_SPELLINGS) })),
  };
}

/**
 * Variants for a high-cardinality text column (job titles, countries, cities),
 * counted straight from the raw values in one pass. Returns null when the column
 * has more than `maxDistinct` different values, which keeps the pass bounded.
 */
export function spellingVariantsFromRaw(
  raw: readonly string[],
  isNull: (value: string) => boolean,
  maxDistinct: number,
): VariantSummary | null {
  const counts = new Map<string, number>();
  for (let i = 0; i < raw.length; i++) {
    const value = raw[i];
    if (isNull(value)) continue;
    const key = value.trim();
    counts.set(key, (counts.get(key) ?? 0) + 1);
    if (counts.size > maxDistinct) return null;
  }
  return spellingVariants([...counts.keys()], [...counts.values()]);
}

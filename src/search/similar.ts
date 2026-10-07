import { jaroWinkler } from "./jaro-winkler.js";
import { normalize } from "./normalize.js";

export interface SimilarValue {
  value: string;
  count: number;
}

export interface SimilarCluster {
  /** Members ordered with the suggested canonical spelling first. */
  values: SimilarValue[];
  suggested: string;
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
  const candidates = values
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
      if (jaroWinkler(candidates[seed].key, candidates[other].key) >= threshold) {
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

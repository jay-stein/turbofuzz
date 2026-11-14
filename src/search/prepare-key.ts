import type { ColumnFilter } from "./query-engine.js";

/**
 * Names the one-off per-column work a filter triggers the first time it runs
 * (a lowercase copy for contains, a phonetic or fuzzy index, parsed numbers),
 * or null for a filter that needs none. The worker uses it to tell the page a
 * preparation is under way, so a long first use is not a silent wait.
 */
export function preparationKey(filter: ColumnFilter | null): string | null {
  if (filter === null) return null;
  if (filter.kind === "text") return filter.mode === "fuzzy" || filter.mode === "phonetic" ? "index" : "text";
  if (filter.kind === "range" || filter.kind === "compare") return "numbers";
  return null;
}

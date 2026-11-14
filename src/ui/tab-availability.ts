import { detectGeoPair } from "../data/geo.js";
import { looksLikeIdName } from "../data/identifier.js";
import type { ColumnMeta } from "../worker/protocol.js";
import type { ViewId } from "./view-tabs.js";

const usable = (meta: ColumnMeta): boolean => meta.role !== "provenance";

/** Date and date-time columns, the ones Time Series can read directly. */
export function dateColumnNames(metas: readonly ColumnMeta[]): string[] {
  return metas.filter((meta) => usable(meta) && (meta.type === "date" || meta.type === "datetime")).map((meta) => meta.name);
}

/** Number columns that measure something (not IDs, codes or postcodes). */
export function measureColumnNames(metas: readonly ColumnMeta[]): string[] {
  return metas
    .filter((meta) => usable(meta) && (meta.type === "integer" || meta.type === "number") && !looksLikeIdName(meta.name))
    .map((meta) => meta.name);
}

/** Text columns that probably hold dates, by the loader's own suggestion. */
export function dateLikeTextColumns(metas: readonly ColumnMeta[]): string[] {
  return metas.filter((meta) => usable(meta) && meta.suggestions.some((suggestion) => suggestion.kind === "date")).map((meta) => meta.name);
}

/** Up to three names, then "and N more". */
export function listNames(names: readonly string[]): string {
  if (names.length <= 3) return names.join(", ");
  return `${names.slice(0, 3).join(", ")} and ${names.length - 3} more`;
}

/**
 * Research tabs this table has nothing for, each with the reason shown when hovering the greyed tab. The tabs
 * stay clickable: each page then says plainly what it needs and how to get it. Outliers is never greyed: it
 * checks text as well as numbers.
 */
export function researchGaps(metas: readonly ColumnMeta[], rowCount: number): Partial<Record<ViewId, string>> {
  if (metas.length === 0) return {};
  const gaps: Partial<Record<ViewId, string>> = {};
  if (dateColumnNames(metas).length === 0) gaps.timeseries = "No date column in this table — open to see how to add one";
  if (detectGeoPair(metas, rowCount) === null) gaps.map = "No latitude and longitude columns found — open to pick them or load boundaries";
  if (metas.filter(usable).length < 2) gaps.relationships = "Needs at least two columns";
  return gaps;
}

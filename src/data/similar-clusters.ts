import { doubleMetaphone } from "double-metaphone";
import { jaroWinkler } from "../search/jaro-winkler.js";
import { normalize } from "../search/normalize.js";
import type { SimilarValue } from "../search/similar.js";
import type { ColumnData } from "./column.js";

export interface SimilarClusterMember {
  value: string;
  count: number;
}

export interface SimilarClusterGroup {
  /** Most frequent member — the suggested survivor when merging. */
  suggested: string;
  values: SimilarClusterMember[];
  /** Rows across every member of the cluster. */
  rows: number;
}

export interface SimilarClusterEntry {
  column: number;
  label: string;
  /** Distinct non-missing values in the current rows. */
  totalDistinct: number;
  /** Values actually compared (capped by frequency). */
  analysedValues: number;
  analysedRows: number;
  /** True when only the most frequent values were compared. */
  truncated: boolean;
  clusters: SimilarClusterGroup[];
}

export interface SimilarClusterOptions {
  maxColumns?: number;
  maxValues?: number;
  maxClusters?: number;
  maxMembers?: number;
  threshold?: number;
}

/** Blocks larger than this are skipped: too generic to compare cheaply. */
const MAX_BLOCK = 300;
/** Free text is not a category; long values never cluster. */
const MAX_VALUE_LENGTH = 60;

/**
 * Near-duplicate clusters for text-ish columns over the current rows. Values
 * are counted, capped to the most frequent, then blocked by primary metaphone
 * (plus a normalized prefix) so Jaro-Winkler only compares plausible pairs.
 * Identifier-like columns (all counts 1) are ignored.
 */
export function computeSimilarClusters(
  columns: readonly ColumnData[],
  rowCount: number,
  ids: Uint32Array,
  options: SimilarClusterOptions = {},
): SimilarClusterEntry[] {
  const maxColumns = Math.max(1, Math.floor(options.maxColumns ?? 4));
  const maxValues = Math.max(50, Math.floor(options.maxValues ?? 2000));
  const maxClusters = Math.max(1, Math.floor(options.maxClusters ?? 25));
  const maxMembers = Math.max(2, Math.floor(options.maxMembers ?? 8));
  const threshold = options.threshold ?? 0.9;

  const entries: SimilarClusterEntry[] = [];
  columns.forEach((column, columnIndex) => {
    if (entries.length >= maxColumns) return;
    if (column.type !== "string" && column.type !== "category") return;
    if (column.stats.distinct < 2 || column.stats.distinct > 100_000) return;

    const counts = new Map<string, number>();
    for (let position = 0; position < ids.length; position++) {
      const row = ids[position];
      if (row >= rowCount || column.nullMask.get(row)) continue;
      const raw = column.raw[row];
      if (raw === undefined) continue;
      const key = raw.trim();
      if (key === "" || key.length > MAX_VALUE_LENGTH) continue;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    if (counts.size < 2) return;

    const totalDistinct = counts.size;
    let values: SimilarValue[] = [];
    for (const [value, count] of counts) values.push({ value, count });
    let truncated = false;
    if (values.length > maxValues) {
      truncated = true;
      values.sort((a, b) => b.count - a.count);
      values = values.slice(0, maxValues);
    }
    const analysedRows = values.reduce((sum, entry) => sum + entry.count, 0);
    // Every value appearing once across many rows is an identifier, not a
    // category with spelling variants.
    if (values.length > 50 && analysedRows === values.length) return;

    const blocks = new Map<string, SimilarValue[]>();
    for (const entry of values) {
      const normalized = normalize(entry.value);
      const phonetic = doubleMetaphone(normalized)[0] ?? "";
      const key = `${phonetic}|${normalized.slice(0, 1)}`;
      const block = blocks.get(key);
      if (block === undefined) blocks.set(key, [entry]);
      else block.push(entry);
    }

    const clusters: SimilarClusterGroup[] = [];
    for (const block of blocks.values()) {
      if (block.length < 2 || block.length > MAX_BLOCK) continue;
      const sorted = block.slice().sort(
        (a, b) => b.count - a.count || (a.value < b.value ? -1 : a.value > b.value ? 1 : 0),
      );
      const assigned = new Set<number>();
      for (let seed = 0; seed < sorted.length; seed++) {
        if (assigned.has(seed)) continue;
        assigned.add(seed);
        const members = [sorted[seed]];
        for (let other = seed + 1; other < sorted.length; other++) {
          if (assigned.has(other)) continue;
          if (
            jaroWinkler(normalize(sorted[seed].value), normalize(sorted[other].value)) >=
            threshold
          ) {
            assigned.add(other);
            members.push(sorted[other]);
          }
        }
        if (members.length > 1) {
          clusters.push({
            suggested: sorted[seed].value,
            values: members
              .slice(0, maxMembers)
              .map(({ value, count }) => ({ value, count })),
            rows: members.reduce((sum, member) => sum + member.count, 0),
          });
        }
      }
    }
    if (clusters.length === 0) return;
    clusters.sort((a, b) => b.rows - a.rows);
    entries.push({
      column: columnIndex,
      label: column.name,
      totalDistinct,
      analysedValues: values.length,
      analysedRows,
      truncated,
      clusters: clusters.slice(0, maxClusters),
    });
  });
  return entries;
}

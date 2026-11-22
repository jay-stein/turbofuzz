import { columnScore, type DQScore, type ScoreDimension } from "./score.js";
import type { ColumnMeta } from "../worker/protocol.js";

/**
 * The quality of the data as it was loaded, before any cleaning step: the "before" that the
 * Clean page and the Data Quality Report set the current data against. Captured from scores
 * the app already computes (it reads no rows), and kept until a different file is loaded.
 */
export interface DQBaseline {
  overall: number | null;
  band: DQScore["band"];
  rowCount: number;
  /** Rows failing at least one check; null while still being counted. */
  rowsAffected: number | null;
  emptyCells: number;
  duplicateRows: number;
  dimensions: { dimension: ScoreDimension; label: string; score: number | null }[];
  columns: BaselineColumn[];
  /** The kinds of work (Clean page groups) found at load. */
  groups: string[];
  /** Issues to fix or review at load. */
  issues: number;
}

export interface BaselineColumn {
  name: string;
  type: string;
  score: number | null;
  /** Share of rows populated, 0..1. */
  fill: number;
}

export interface BaselineInputs {
  score: DQScore;
  metas: readonly ColumnMeta[];
  rowCount: number;
  rowsAffected: number | null;
  duplicateRows: number;
  groups: readonly string[];
  issues: number;
}

export function captureBaseline(input: BaselineInputs): DQBaseline {
  const { score, metas, rowCount } = input;
  return {
    overall: score.overall,
    band: score.band,
    rowCount,
    rowsAffected: input.rowsAffected,
    emptyCells: metas.reduce((sum, meta) => sum + meta.stats.nulls, 0),
    duplicateRows: input.duplicateRows,
    dimensions: score.dimensions.map((dimension) => ({ dimension: dimension.dimension, label: dimension.label, score: dimension.score })),
    columns: metas.map((meta, column) => ({
      name: meta.name,
      type: meta.type,
      score: columnScore(score, column).score,
      fill: rowCount === 0 ? 0 : 1 - meta.stats.nulls / rowCount,
    })),
    groups: [...input.groups],
    issues: input.issues,
  };
}

/** Steps that landed together, and the score once they had. */
export interface TrailEntry {
  labels: string[];
  overall: number | null;
}

/**
 * Keeps the score after each step in line with the steps applied now. Steps that are new since
 * the last call land as one entry with the current score; steps that were undone leave; with no
 * new step the newest entry takes the current score, so late counts (rows affected, repeated
 * rows) refine it instead of showing as a step of their own.
 */
export function advanceTrail(trail: readonly TrailEntry[], labels: readonly string[], overall: number | null): TrailEntry[] {
  if (labels.length === 0) return [];
  const left = new Map<string, number>();
  for (const label of labels) left.set(label, (left.get(label) ?? 0) + 1);
  const take = (label: string): boolean => {
    const count = left.get(label) ?? 0;
    if (count === 0) return false;
    left.set(label, count - 1);
    return true;
  };
  const kept: TrailEntry[] = [];
  for (const entry of trail) {
    const still = entry.labels.filter(take);
    if (still.length > 0) kept.push({ labels: still, overall: entry.overall });
  }
  const fresh = labels.filter(take);
  if (fresh.length > 0) kept.push({ labels: fresh, overall });
  else if (kept.length > 0) kept[kept.length - 1] = { ...kept[kept.length - 1]!, overall };
  return kept;
}

/** "city: Standardise", or "city: Standardise and 3 more" for steps that landed together. */
export function trailLabel(entry: TrailEntry): string {
  const [first = "", ...rest] = entry.labels;
  return rest.length === 0 ? first : `${first} and ${rest.length} more`;
}

/** One column as loaded and now, matched by name (a renamed or dropped column has no partner). */
export interface ColumnChange {
  name: string;
  type: string;
  before: BaselineColumn | null;
  after: BaselineColumn | null;
}

/** Columns from both sides, the ones cleaning changed most first; dropped columns last. */
export function compareColumns(before: readonly BaselineColumn[], after: readonly BaselineColumn[]): ColumnChange[] {
  const now = new Map(after.map((column) => [column.name, column]));
  const seen = new Set<string>();
  const rows: ColumnChange[] = [];
  for (const column of before) {
    seen.add(column.name);
    const match = now.get(column.name) ?? null;
    rows.push({ name: column.name, type: match?.type ?? column.type, before: column, after: match });
  }
  for (const column of after) {
    if (!seen.has(column.name)) rows.push({ name: column.name, type: column.type, before: null, after: column });
  }
  const moved = (row: ColumnChange): number =>
    row.before === null || row.after === null
      ? -1
      : Math.abs((row.after.score ?? 0) - (row.before.score ?? 0)) + Math.abs(row.after.fill - row.before.fill) * 100;
  return rows.sort((a, b) => moved(b) - moved(a));
}

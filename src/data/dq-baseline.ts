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
  /** The kinds of work (Clean page groups) found at load, in the order Clean works through them. */
  groups: string[];
  /** The issues each kind of work had at load, by group id: Clean counts off how many are cleared. */
  groupIssues?: Record<string, string[]>;
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
  groupIssues?: Record<string, readonly string[]>;
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
    groupIssues: Object.fromEntries(Object.entries(input.groupIssues ?? {}).map(([id, list]) => [id, [...list]])),
    issues: input.issues,
  };
}

/** One kind of work on the Clean page as a step: done, the one to do now, or still to come. */
export interface CleanStep {
  id: string;
  state: "done" | "current" | "todo";
  /** Issues it had at load plus any that turned up since. */
  total: number;
  /** Issues still to fix or review. */
  left: number;
}

/**
 * Clean's kinds of work as numbered steps, in the order found at load, so they hold still while
 * the analyst works: a finished group stays as a done step instead of vanishing, and the first
 * unfinished one is the step to do now. A group that turns up later joins the end.
 */
export function cleanSteps(baseline: DQBaseline | null, now: readonly { id: string; issues: readonly string[] }[]): CleanStep[] {
  const left = new Map(now.map((group) => [group.id, group.issues]));
  const order = [...(baseline?.groups ?? [])];
  for (const group of now) if (!order.includes(group.id)) order.push(group.id);
  let current = false;
  return order.map((id) => {
    const open = left.get(id) ?? [];
    const still = new Set(open);
    const cleared = (baseline?.groupIssues?.[id] ?? []).filter((issue) => !still.has(issue)).length;
    const done = open.length === 0;
    const state = done ? "done" : current ? "todo" : "current";
    if (!done) current = true;
    return { id, state, total: cleared + open.length, left: open.length };
  });
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

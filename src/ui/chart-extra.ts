/**
 * Pure data preparation and layout for the dot plot, 100% stacked bar, small
 * multiples, slopegraph and waterfall. The card does the canvas drawing; this
 * module decides what to draw, so the rules can be tested without a canvas.
 */

export interface SplitMatrix {
  /** First-dimension labels in first-seen order (time buckets or categories). */
  buckets: string[];
  /** Second-dimension labels (series), largest absolute total first. */
  groups: string[];
  /** values[g][b]; NaN where a group has no row in that bucket. */
  values: Float64Array[];
  /** Absolute total per group, in `groups` order. */
  totals: number[];
}

/** Pivot a two-dimension aggregate (bucket x group) into a matrix. */
export function splitMatrix(
  bucketLabels: readonly string[],
  groupLabels: readonly string[],
  values: ArrayLike<number>,
  count: number,
): SplitMatrix {
  const bucketIndex = new Map<string, number>();
  const buckets: string[] = [];
  for (let i = 0; i < count; i++) {
    const label = bucketLabels[i] ?? "";
    if (!bucketIndex.has(label)) {
      bucketIndex.set(label, buckets.length);
      buckets.push(label);
    }
  }
  const byGroup = new Map<string, { values: Float64Array; total: number }>();
  for (let i = 0; i < count; i++) {
    const label = groupLabels[i] ?? "(missing)";
    let entry = byGroup.get(label);
    if (entry === undefined) {
      entry = { values: new Float64Array(buckets.length).fill(Number.NaN), total: 0 };
      byGroup.set(label, entry);
    }
    const value = values[i] ?? Number.NaN;
    if (Number.isFinite(value)) {
      entry.values[bucketIndex.get(bucketLabels[i] ?? "") ?? 0] = value;
      entry.total += Math.abs(value);
    }
  }
  const ordered = [...byGroup.entries()].sort((a, b) => b[1].total - a[1].total);
  return {
    buckets,
    groups: ordered.map(([label]) => label),
    values: ordered.map(([, entry]) => entry.values),
    totals: ordered.map(([, entry]) => entry.total),
  };
}

/** Keep the `limit` largest groups; fold the rest into one "Other" series (sums). */
export function foldGroups(matrix: SplitMatrix, limit: number): SplitMatrix {
  const keep = Math.max(1, limit);
  if (matrix.groups.length <= keep) return matrix;
  const other = new Float64Array(matrix.buckets.length).fill(Number.NaN);
  let otherTotal = 0;
  for (let g = keep; g < matrix.groups.length; g++) {
    otherTotal += matrix.totals[g];
    matrix.values[g].forEach((value, b) => {
      if (Number.isFinite(value)) other[b] = Number.isFinite(other[b]) ? other[b] + value : value;
    });
  }
  return {
    buckets: matrix.buckets,
    groups: [...matrix.groups.slice(0, keep), "Other"],
    values: [...matrix.values.slice(0, keep), other],
    totals: [...matrix.totals.slice(0, keep), otherTotal],
  };
}

/* ----------------------------------------------------------------- dot plot */

export interface DotRow {
  label: string;
  value: number;
  /** Position of the row in the aggregate, so a hit can map back to its group. */
  index: number;
}

/** Rows for a dot plot: largest first, capped, non-finite values dropped. */
export function dotPlotRows(
  labels: readonly string[],
  values: ArrayLike<number>,
  count: number,
  limit: number,
): DotRow[] {
  const rows: DotRow[] = [];
  for (let i = 0; i < count; i++) {
    const value = values[i];
    if (value !== undefined && Number.isFinite(value)) rows.push({ label: labels[i] ?? "", value, index: i });
  }
  rows.sort((a, b) => b.value - a.value || a.index - b.index);
  return rows.slice(0, Math.max(1, limit));
}

/**
 * Dots need no zero baseline: pad the observed range so the dots do not sit
 * on the frame, and say when the axis starts away from zero.
 */
export function dotAxis(values: readonly number[]): { min: number; max: number; fromZero: boolean } {
  if (values.length === 0) return { min: 0, max: 1, fromZero: true };
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  if (lo >= 0 && lo <= hi * 0.5) return { min: 0, max: hi === 0 ? 1 : hi * 1.05, fromZero: true };
  const pad = (hi - lo || Math.abs(hi) || 1) * 0.08;
  lo -= pad;
  hi += pad;
  return { min: lo, max: hi, fromZero: lo <= 0 && hi >= 0 };
}

/* ----------------------------------------------------------- 100% stacked */

export interface ShareRow {
  label: string;
  /** Share of the row total per group, 0..1, in group order. */
  shares: number[];
  total: number;
}

/** Each bucket's groups as shares of that bucket's (positive) total. */
export function shareRows(matrix: SplitMatrix): ShareRow[] {
  return matrix.buckets.map((label, b) => {
    const parts = matrix.values.map((series) => {
      const value = series[b] ?? Number.NaN;
      return Number.isFinite(value) && value > 0 ? value : 0;
    });
    const total = parts.reduce((sum, part) => sum + part, 0);
    return { label, shares: parts.map((part) => (total > 0 ? part / total : 0)), total };
  });
}

/* -------------------------------------------------------------- waterfall */

export interface WaterfallStep {
  label: string;
  /** The change this step contributes; the final step is the running total. */
  delta: number;
  start: number;
  end: number;
  total: boolean;
}

/** Running-total steps plus a closing total bar. Non-finite deltas count as 0. */
export function waterfallSteps(labels: readonly string[], values: ArrayLike<number>, count: number): WaterfallStep[] {
  const steps: WaterfallStep[] = [];
  let running = 0;
  for (let i = 0; i < count; i++) {
    const raw = values[i];
    const delta = raw !== undefined && Number.isFinite(raw) ? raw : 0;
    steps.push({ label: labels[i] ?? "", delta, start: running, end: running + delta, total: false });
    running += delta;
  }
  steps.push({ label: "Total", delta: running, start: 0, end: running, total: true });
  return steps;
}

/* ------------------------------------------------------------- slopegraph */

export interface SlopeLine {
  label: string;
  from: number;
  to: number;
}

/**
 * One line per group between two moments. The moments are the first and last
 * buckets (ignoring `avoid`, e.g. incomplete edge periods) where the most
 * groups have a value, so a sparse edge does not drop most of the lines.
 * Groups missing either end are left out, since a slope needs two points.
 */
export function slopeLines(
  matrix: SplitMatrix,
  avoid: ReadonlySet<string> = new Set(),
): { lines: SlopeLine[]; from: string; to: string; skipped: number; periods: number } {
  const all = matrix.buckets.map((_, b) => b);
  const clean = all.filter((b) => !avoid.has(matrix.buckets[b]));
  const candidates = clean.length >= 2 ? clean : all;
  const coverage = (b: number): number => matrix.values.filter((series) => Number.isFinite(series[b])).length;
  const best = Math.max(0, ...candidates.map(coverage));
  const full = candidates.filter((b) => coverage(b) === best);
  const fromIndex = full[0] ?? 0;
  const toIndex = full[full.length - 1] ?? 0;
  const lines: SlopeLine[] = [];
  let skipped = 0;
  matrix.groups.forEach((label, g) => {
    const from = matrix.values[g][fromIndex];
    const to = matrix.values[g][toIndex];
    if (toIndex > fromIndex && Number.isFinite(from) && Number.isFinite(to)) lines.push({ label, from, to });
    else skipped++;
  });
  return {
    lines,
    from: matrix.buckets[fromIndex] ?? "",
    to: matrix.buckets[toIndex] ?? "",
    skipped,
    periods: matrix.buckets.length,
  };
}

/** Round to 4 significant digits so axis and dot labels stay readable. */
export const roundLabel = (value: number): number => (Number.isFinite(value) ? Number(value.toPrecision(4)) : value);

/**
 * Spread labels so they never overlap: given desired y positions, return
 * positions at least `gap` apart, kept inside [min, max], in input order.
 */
export function spreadLabels(wanted: readonly number[], gap: number, min: number, max: number): number[] {
  const order = wanted.map((y, i) => ({ y, i })).sort((a, b) => a.y - b.y);
  const placed = order.map((entry) => ({ ...entry }));
  for (let k = 0; k < placed.length; k++) {
    placed[k].y = Math.max(placed[k].y, k === 0 ? min : placed[k - 1].y + gap);
  }
  for (let k = placed.length - 1; k >= 0; k--) {
    placed[k].y = Math.min(placed[k].y, k === placed.length - 1 ? max : placed[k + 1].y - gap);
  }
  const out = new Array<number>(wanted.length).fill(0);
  for (const entry of placed) out[entry.i] = entry.y;
  return out;
}

/* ---------------------------------------------------------- small multiples */

export interface PanelCell {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A near-square grid of equal panels with `gap` between them. */
export function panelGrid(
  count: number,
  width: number,
  height: number,
  gap: number,
): { cols: number; rows: number; cells: PanelCell[] } {
  const n = Math.max(1, count);
  // Panels read best a little wider than tall.
  let cols = Math.max(1, Math.round(Math.sqrt((n * width) / Math.max(1, height) / 1.8)));
  cols = Math.min(cols, n);
  const rows = Math.ceil(n / cols);
  const w = (width - gap * (cols - 1)) / cols;
  const h = (height - gap * (rows - 1)) / rows;
  const cells: PanelCell[] = [];
  for (let i = 0; i < count; i++) {
    cells.push({ x: (i % cols) * (w + gap), y: Math.floor(i / cols) * (h + gap), w, h });
  }
  return { cols, rows, cells };
}

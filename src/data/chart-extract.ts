/**
 * The numbers behind a chart, for Extract stats: a few facts about how it was drawn, then its tables. Everything here is
 * plain text cells, so what is shown, copied and downloaded is the same thing.
 */
import { formatFormulaSafe } from "./formula-safe.js";

export interface ExtractSection {
  title: string;
  /** Header row first. */
  rows: string[][];
}

export interface ChartExtract {
  title: string;
  facts: [string, string][];
  sections: ExtractSection[];
}

export const num = (value: number | null | undefined): string =>
  value !== null && value !== undefined && Number.isFinite(value) ? String(value) : "";

/** Facts, then each table under its title, for a spreadsheet to open or paste. */
export function extractRows(extract: ChartExtract): string[][] {
  const rows: string[][] = [[extract.title], ...extract.facts.map(([label, value]) => [label, value])];
  for (const section of extract.sections) {
    rows.push([], [section.title], ...section.rows);
  }
  return rows;
}

/** Tab-separated for pasting; a text cell a spreadsheet would run as a formula is made harmless. */
export function extractTsv(rows: readonly (readonly string[])[]): string {
  return rows.map((row) => row.map((cell) => formatFormulaSafe(cell).replace(/[\t\r\n]+/g, " ")).join("\t")).join("\n");
}

export interface ValueSummary {
  n: number;
  sum: number;
  mean: number;
  min: number;
  max: number;
  /** Positions of the lowest and highest value. */
  minAt: number;
  maxAt: number;
  sd: number;
}

/** Summary of the finite values; null when there are none. */
export function summarise(values: ArrayLike<number>): ValueSummary | null {
  let n = 0;
  let sum = 0;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  let minAt = -1;
  let maxAt = -1;
  for (let i = 0; i < values.length; i++) {
    const value = values[i]!;
    if (!Number.isFinite(value)) continue;
    n++;
    sum += value;
    if (value < min) {
      min = value;
      minAt = i;
    }
    if (value > max) {
      max = value;
      maxAt = i;
    }
  }
  if (n === 0) return null;
  const mean = sum / n;
  let squares = 0;
  for (let i = 0; i < values.length; i++) {
    const value = values[i]!;
    if (Number.isFinite(value)) squares += (value - mean) ** 2;
  }
  return { n, sum, mean, min, max, minAt, maxAt, sd: n > 1 ? Math.sqrt(squares / (n - 1)) : Number.NaN };
}

export interface LinearFit {
  n: number;
  slope: number;
  intercept: number;
  /** Share of the variance in y the line explains. */
  r2: number;
}

/** Least-squares line through the points where both values are finite; null without at least two distinct x. */
export function linearFit(x: ArrayLike<number>, y: ArrayLike<number>, length = x.length): LinearFit | null {
  let n = 0;
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < length; i++) {
    if (!Number.isFinite(x[i]!) || !Number.isFinite(y[i]!)) continue;
    n++;
    sx += x[i]!;
    sy += y[i]!;
  }
  if (n < 2) return null;
  const mx = sx / n;
  const my = sy / n;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (let i = 0; i < length; i++) {
    if (!Number.isFinite(x[i]!) || !Number.isFinite(y[i]!)) continue;
    sxx += (x[i]! - mx) ** 2;
    sxy += (x[i]! - mx) * (y[i]! - my);
    syy += (y[i]! - my) ** 2;
  }
  if (sxx === 0) return null;
  const slope = sxy / sxx;
  return { n, slope, intercept: my - slope * mx, r2: syy === 0 ? 1 : (sxy * sxy) / (sxx * syy) };
}

/** Mean and spread estimated from counts in bins, each taken at its centre. */
export function binnedSummary(counts: ArrayLike<number>, edges: readonly number[]): { n: number; mean: number; sd: number } | null {
  let n = 0;
  let sum = 0;
  for (let i = 0; i < counts.length; i++) {
    n += counts[i]!;
    sum += counts[i]! * ((edges[i]! + edges[i + 1]!) / 2);
  }
  if (n === 0) return null;
  const mean = sum / n;
  let squares = 0;
  for (let i = 0; i < counts.length; i++) squares += counts[i]! * (((edges[i]! + edges[i + 1]!) / 2 - mean) ** 2);
  return { n, mean, sd: n > 1 ? Math.sqrt(squares / (n - 1)) : Number.NaN };
}

/** One row per bin: its edges, count, share and running share, and the drawn curve when there is one. */
export function binRows(
  counts: ArrayLike<number>,
  edges: readonly number[],
  curve: ArrayLike<number> | null,
  format: (value: number) => string = num,
  extra = 0,
): string[][] {
  let total = extra;
  for (let i = 0; i < counts.length; i++) total += counts[i]!;
  const rows: string[][] = [["bin_start", "bin_end", "count", "share", "cumulative_share", ...(curve === null ? [] : ["kde_curve"])]];
  let running = 0;
  for (let i = 0; i < counts.length; i++) {
    running += counts[i]!;
    rows.push([
      format(edges[i]!),
      format(edges[i + 1]!),
      String(counts[i]!),
      total === 0 ? "" : (counts[i]! / total).toFixed(6),
      total === 0 ? "" : (running / total).toFixed(6),
      ...(curve === null ? [] : [num(curve[i]!)]),
    ]);
  }
  return rows;
}

/** Each series of a measure over its periods: where it started and ended, and its extremes. */
export function seriesRows(names: readonly string[], series: readonly string[], periods: readonly string[], values: ArrayLike<number>): string[][] {
  const groups = new Map<string, number[]>();
  series.forEach((name, index) => {
    const list = groups.get(name);
    if (list === undefined) groups.set(name, [index]);
    else list.push(index);
  });
  const rows: string[][] = [[...names, "points", "total", "mean", "lowest", "lowest_at", "highest", "highest_at", "first", "last", "change"]];
  for (const [name, indexes] of groups) {
    const own = indexes.map((index) => values[index]!);
    const summary = summarise(own);
    if (summary === null) continue;
    const finite = indexes.filter((index) => Number.isFinite(values[index]!));
    const first = values[finite[0]!]!;
    const last = values[finite[finite.length - 1]!]!;
    rows.push([
      name,
      String(summary.n),
      num(summary.sum),
      num(summary.mean),
      num(summary.min),
      periods[indexes[summary.minAt]!] ?? "",
      num(summary.max),
      periods[indexes[summary.maxAt]!] ?? "",
      num(first),
      num(last),
      num(last - first),
    ]);
  }
  return rows;
}

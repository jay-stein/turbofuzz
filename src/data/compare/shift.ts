import { cramersVTwoGroups, populationStability } from "../distribution.js";
import { looksLikeIdName } from "../identifier.js";
import { pairFamily } from "./values.js";
import type { ColumnPairing, CompareColumn, CompareSide } from "./types.js";

/** How much a column moved: PSI for numbers and dates, Cramér's V for categories. */
export type ShiftLevel = "none" | "mild" | "large";

export interface NumberSummary {
  count: number;
  /** Share of rows with no value (0–1). */
  empty: number;
  mean: number;
  sd: number;
  min: number;
  p10: number;
  median: number;
  p90: number;
  max: number;
}

export interface NumericShift {
  kind: "numeric";
  pair: number;
  name: string;
  /** Dates compare as numbers (epoch ms) and are written back as dates. */
  family: "number" | "date";
  a: NumberSummary;
  b: NumberSummary;
  psi: number;
  /** Mean difference in pooled standard deviations (null when there is no spread). */
  smd: number | null;
  level: ShiftLevel;
  /** Shares of each side's values in equal-width bins over the two sides' p1–p99 range. */
  hist: { from: number; to: number; a: number[]; b: number[] };
  /** True when the percentiles come from a sample (large columns). */
  sampled: boolean;
}

export interface CategoryShare {
  label: string;
  a: number;
  b: number;
  aCount: number;
  bCount: number;
}

export interface CategoryShift {
  kind: "category";
  pair: number;
  name: string;
  v: number;
  level: ShiftLevel;
  /** The most common values on either side, with their share of filled cells on each. */
  values: CategoryShare[];
  /** Every other value together. */
  other: { a: number; b: number };
  /** Values only one side has, most common first. */
  appeared: { label: string; count: number }[];
  vanished: { label: string; count: number }[];
  distinct: { a: number; b: number };
  empty: { a: number; b: number };
  /** Every value is a number (a 1–10 score, a count), so it can be a measure per group. */
  numeric: boolean;
}

export type ColumnShift = NumericShift | CategoryShift;

export interface ShiftReport {
  /** Most shifted first. */
  columns: ColumnShift[];
  /** Paired columns not compared this way, and why. */
  skipped: { name: string; why: string }[];
}

/** PSI: under 0.1 no real shift, 0.1–0.25 mild, over 0.25 large (the usual credit-risk cut-offs). */
export function psiLevel(psi: number): ShiftLevel {
  return psi >= 0.25 ? "large" : psi >= 0.1 ? "mild" : "none";
}

/** Standardised mean difference: under 0.2 negligible, 0.2–0.5 mild, 0.5 and over large (Cohen's conventions). */
export function smdLevel(smd: number | null): ShiftLevel {
  const size = Math.abs(smd ?? 0);
  return size >= 0.5 ? "large" : size >= 0.2 ? "mild" : "none";
}

/** Cramér's V: under 0.1 negligible, 0.1–0.3 mild, 0.3 and over large. */
export function cramersLevel(v: number): ShiftLevel {
  return v >= 0.3 ? "large" : v >= 0.1 ? "mild" : "none";
}

/** Columns with more distinct values than this are text or ids, not categories. */
const MAX_CATEGORIES = 60;
const TOP_VALUES = 8;
const SAMPLE = 100_000;
const BINS = 24;
/** Fewer filled values than this on a side and a shift is not judged. */
const MIN_VALUES = 20;

function percentile(sorted: Float64Array, q: number): number {
  if (sorted.length === 0) return Number.NaN;
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return sorted[lower]! + (sorted[upper]! - sorted[lower]!) * (position - lower);
}

/** Every filled value, and an evenly spaced sample of at most SAMPLE of them, sorted. */
function numericValues(column: CompareColumn, rows: number): { values: Float64Array; sorted: Float64Array; empty: number } {
  const nums = column.numbers();
  const values = new Float64Array(rows);
  let length = 0;
  let empty = 0;
  for (let row = 0; row < rows; row++) {
    const v = nums[row]!;
    if (v === v) values[length++] = v;
    else if (column.isEmpty(row)) empty++;
  }
  const filled = values.subarray(0, length);
  const step = Math.max(1, filled.length / SAMPLE);
  const sample = new Float64Array(Math.min(filled.length, SAMPLE));
  for (let i = 0; i < sample.length; i++) sample[i] = filled[Math.floor(i * step)]!;
  sample.sort();
  return { values: filled, sorted: sample, empty };
}

function summarize(values: Float64Array, sorted: Float64Array, empty: number, rows: number): NumberSummary {
  let sum = 0;
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < values.length; i++) {
    const v = values[i]!;
    sum += v;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const mean = values.length === 0 ? Number.NaN : sum / values.length;
  let squares = 0;
  for (let i = 0; i < values.length; i++) squares += (values[i]! - mean) ** 2;
  return {
    count: values.length,
    empty: rows === 0 ? 0 : empty / rows,
    mean,
    sd: values.length > 1 ? Math.sqrt(squares / (values.length - 1)) : 0,
    min,
    p10: percentile(sorted, 0.1),
    median: percentile(sorted, 0.5),
    p90: percentile(sorted, 0.9),
    max,
  };
}

function numericShift(pair: number, name: string, family: "number" | "date", ca: CompareColumn, cb: CompareColumn, a: CompareSide, b: CompareSide): NumericShift | null {
  const left = numericValues(ca, a.rowCount);
  const right = numericValues(cb, b.rowCount);
  if (left.values.length < MIN_VALUES || right.values.length < MIN_VALUES) return null;
  const sa = summarize(left.values, left.sorted, left.empty, a.rowCount);
  const sb = summarize(right.values, right.sorted, right.empty, b.rowCount);
  const stability = populationStability(Array.from(left.sorted), right.values);
  const psi = stability?.psi ?? 0;
  const pooled = Math.sqrt(((sa.count - 1) * sa.sd ** 2 + (sb.count - 1) * sb.sd ** 2) / Math.max(1, sa.count + sb.count - 2));
  // Bins over the two sides' p1–p99, so one extreme value does not squash the picture.
  const from = Math.min(percentile(left.sorted, 0.01), percentile(right.sorted, 0.01));
  let to = Math.max(percentile(left.sorted, 0.99), percentile(right.sorted, 0.99));
  if (!(to > from)) to = from + 1;
  const bin = (values: Float64Array): number[] => {
    const counts = new Array<number>(BINS).fill(0);
    for (let i = 0; i < values.length; i++) {
      const at = Math.floor(((values[i]! - from) / (to - from)) * BINS);
      counts[Math.max(0, Math.min(BINS - 1, at))]++;
    }
    return counts.map((n) => n / Math.max(1, values.length));
  };
  const smd = pooled > 0 ? (sb.mean - sa.mean) / pooled : null;
  // PSI reads the shape; a moderate move of the mean in a wide, skewed column can slip under it, so the larger verdict counts.
  const byPsi = psiLevel(psi);
  const bySmd = family === "number" ? smdLevel(smd) : "none";
  return {
    kind: "numeric",
    pair,
    name,
    family,
    a: sa,
    b: sb,
    psi,
    smd,
    level: RANK[bySmd] > RANK[byPsi] ? bySmd : byPsi,
    hist: { from, to, a: bin(left.values), b: bin(right.values) },
    sampled: left.values.length > SAMPLE || right.values.length > SAMPLE,
  };
}

/** Counts of each trimmed value on one side, and its empty cells; null when it has too many values to be a category. */
function valueCounts(column: CompareColumn, rows: number, limit: number): { counts: Map<string, number>; empty: number; filled: number } | null {
  const counts = new Map<string, number>();
  let empty = 0;
  for (let row = 0; row < rows; row++) {
    if (column.isEmpty(row)) {
      empty++;
      continue;
    }
    const value = column.raw[row]!.trim();
    const seen = counts.get(value);
    if (seen !== undefined) counts.set(value, seen + 1);
    else {
      if (counts.size >= limit) return null;
      counts.set(value, 1);
    }
  }
  return { counts, empty, filled: rows - empty };
}

function categoryShift(pair: number, name: string, ca: CompareColumn, cb: CompareColumn, a: CompareSide, b: CompareSide): CategoryShift | null {
  const left = valueCounts(ca, a.rowCount, MAX_CATEGORIES * 4);
  const right = valueCounts(cb, b.rowCount, MAX_CATEGORIES * 4);
  if (left === null || right === null) return null;
  const labels = new Set([...left.counts.keys(), ...right.counts.keys()]);
  if (labels.size > MAX_CATEGORIES || left.filled < MIN_VALUES || right.filled < MIN_VALUES) return null;
  const all = [...labels];
  const aCounts = all.map((label) => left.counts.get(label) ?? 0);
  const bCounts = all.map((label) => right.counts.get(label) ?? 0);
  const v = cramersVTwoGroups(aCounts, bCounts);
  const shares = all.map((label, i) => ({
    label,
    a: aCounts[i]! / left.filled,
    b: bCounts[i]! / right.filled,
    aCount: aCounts[i]!,
    bCount: bCounts[i]!,
  }));
  shares.sort((x, y) => Math.max(y.a, y.b) - Math.max(x.a, x.b) || x.label.localeCompare(y.label));
  const numeric = all.every((label) => label !== "" && Number.isFinite(Number(label)));
  const top = shares.slice(0, TOP_VALUES);
  // A numeric scale (a 1–10 score) reads best in its own order.
  if (numeric) top.sort((x, y) => Number(x.label) - Number(y.label));
  const rest = shares.slice(TOP_VALUES);
  const byCount = (x: { count: number; label: string }, y: { count: number; label: string }): number => y.count - x.count || x.label.localeCompare(y.label);
  return {
    kind: "category",
    pair,
    name,
    v,
    level: cramersLevel(v),
    values: top,
    other: { a: rest.reduce((sum, s) => sum + s.a, 0), b: rest.reduce((sum, s) => sum + s.b, 0) },
    appeared: shares.filter((s) => s.aCount === 0).map((s) => ({ label: s.label, count: s.bCount })).sort(byCount).slice(0, 5),
    vanished: shares.filter((s) => s.bCount === 0).map((s) => ({ label: s.label, count: s.aCount })).sort(byCount).slice(0, 5),
    distinct: { a: left.counts.size, b: right.counts.size },
    numeric,
    empty: { a: a.rowCount === 0 ? 0 : left.empty / a.rowCount, b: b.rowCount === 0 ? 0 : right.empty / b.rowCount },
  };
}

const RANK: Record<ShiftLevel, number> = { large: 2, mild: 1, none: 0 };

/** How far a shift is toward "large", on one scale for every measure. */
function severity(shift: ColumnShift): number {
  return shift.kind === "numeric" ? Math.max(shift.psi / 0.25, Math.abs(shift.smd ?? 0) / 0.5) : shift.v / 0.3;
}

/**
 * Has the data shifted? For each paired column: numbers and dates by their
 * distribution (PSI, mean difference, percentiles), categories by their mix
 * of values (Cramér's V, appeared and vanished values). Needs no row
 * matching: it compares the two populations. Key and id-like columns, and
 * text with too many distinct values to be a category, are skipped.
 */
export function columnShifts(a: CompareSide, b: CompareSide, pairing: ColumnPairing, skip: ReadonlySet<number> = new Set()): ShiftReport {
  const columns: ColumnShift[] = [];
  const skipped: ShiftReport["skipped"] = [];
  pairing.pairs.forEach((pair, index) => {
    const ca = a.columns[pair.a]!;
    const cb = b.columns[pair.b]!;
    const name = cb.name;
    if (skip.has(index) || looksLikeIdName(name) || looksLikeIdName(ca.name) || ca.type === "identifier" || cb.type === "identifier") {
      skipped.push({ name, why: "a key or id" });
      return;
    }
    const family = pairFamily(ca, cb);
    if (family === "number" || family === "date") {
      const shift = numericShift(index, name, family, ca, cb, a, b);
      if (shift !== null) columns.push(shift);
      else skipped.push({ name, why: "too few values to judge" });
      return;
    }
    const shift = categoryShift(index, name, ca, cb, a, b);
    if (shift !== null) columns.push(shift);
    else skipped.push({ name, why: "free text: too many different values" });
  });
  columns.sort((x, y) => RANK[y.level] - RANK[x.level] || severity(y) - severity(x) || x.pair - y.pair);
  return { columns, skipped };
}

export type GroupMeasure = "mean" | "sum" | "count";

export interface GroupRow {
  group: string;
  a: { rows: number; value: number | null };
  b: { rows: number; value: number | null };
}

export interface GroupShift {
  groups: GroupRow[];
  /** Groups beyond the shown ones, folded together. */
  more: number;
}

const MAX_GROUPS = 40;

/**
 * The measure per group on each side: mean, sum or row count of a number
 * column for each value of the group column. Groups are the most common on
 * either side; the rest are counted in `more`.
 */
export function groupShift(
  a: CompareSide,
  b: CompareSide,
  pairing: ColumnPairing,
  groupPair: number,
  measurePair: number | null,
  measure: GroupMeasure,
): GroupShift {
  const pair = pairing.pairs[groupPair];
  if (pair === undefined) return { groups: [], more: 0 };
  const tally = (side: CompareSide, group: CompareColumn, values: Float64Array | null): Map<string, { rows: number; sum: number; filled: number }> => {
    const out = new Map<string, { rows: number; sum: number; filled: number }>();
    for (let row = 0; row < side.rowCount; row++) {
      const key = group.isEmpty(row) ? "" : group.raw[row]!.trim();
      let entry = out.get(key);
      if (entry === undefined) out.set(key, (entry = { rows: 0, sum: 0, filled: 0 }));
      entry.rows++;
      if (values !== null) {
        const v = values[row]!;
        if (v === v) {
          entry.sum += v;
          entry.filled++;
        }
      }
    }
    return out;
  };
  const measured = measurePair === null ? undefined : pairing.pairs[measurePair];
  const left = tally(a, a.columns[pair.a]!, measured === undefined ? null : a.columns[measured.a]!.numbers());
  const right = tally(b, b.columns[pair.b]!, measured === undefined ? null : b.columns[measured.b]!.numbers());
  const value = (entry: { rows: number; sum: number; filled: number } | undefined): number | null => {
    if (entry === undefined) return null;
    if (measure === "count" || measured === undefined) return entry.rows;
    if (measure === "sum") return entry.sum;
    return entry.filled === 0 ? null : entry.sum / entry.filled;
  };
  const names = [...new Set([...left.keys(), ...right.keys()])];
  names.sort((x, y) => Math.max(right.get(y)?.rows ?? 0, left.get(y)?.rows ?? 0) - Math.max(right.get(x)?.rows ?? 0, left.get(x)?.rows ?? 0) || x.localeCompare(y));
  const groups = names.slice(0, MAX_GROUPS).map((group) => ({
    group,
    a: { rows: left.get(group)?.rows ?? 0, value: value(left.get(group)) },
    b: { rows: right.get(group)?.rows ?? 0, value: value(right.get(group)) },
  }));
  return { groups, more: Math.max(0, names.length - MAX_GROUPS) };
}

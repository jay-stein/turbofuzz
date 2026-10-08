import { toDateInputValue } from "../parse/dates.js";
import type { ColumnMeta } from "../worker/protocol.js";
import type { ColumnType } from "../types.js";

export type ChartKind = "histogram" | "line" | "bar" | null;

export type ChartCardKind = "histogram" | "line" | "bar" | "scatter" | "density";

export const CHART_KIND_LABELS: Record<ChartCardKind, string> = {
  histogram: "Histogram",
  line: "Time series",
  bar: "Bars",
  scatter: "Scatter",
  density: "Density",
};

/** Chart type implied by the column's type (null = not chartable). */
export function chartKindFor(type: ColumnMeta["type"]): ChartKind {
  switch (type) {
    case "integer":
    case "number":
      return "histogram";
    case "date":
      return "line";
    case "category":
    case "boolean":
      return "bar";
    default:
      return null;
  }
}

/** Default chart kind for a new card, in priority order. */
export function defaultCardKind(columns: ColumnMeta[]): ChartCardKind {
  if (columns.some((meta) => isNumericType(meta.type))) return "histogram";
  if (columns.some((meta) => meta.type === "date")) return "line";
  if (columns.some((meta) => chartKindFor(meta.type) === "bar")) return "bar";
  return "histogram";
}

export function isNumericType(type: ColumnType): boolean {
  return type === "integer" || type === "number";
}

export function isCategoryType(type: ColumnType): boolean {
  return type === "category" || type === "boolean";
}

/** Axis formatting kind: dates get date ticks, everything else numbers. */
export function axisKindFor(type: ColumnType): "line" | null {
  return type === "date" ? "line" : null;
}

export interface CategoryBar {
  label: string;
  count: number;
  /** Share of all non-empty category values, in percent. */
  pct: number;
  other?: boolean;
}

/**
 * Category series for the bar chart: the top N values by count, with the rest
 * aggregated into an "Other" bar when requested. Counts use filtered facet
 * counts when present, else the static category counts.
 */
export function categorySeries(
  meta: ColumnMeta,
  facetCounts: number[] | undefined,
  topN: number,
  groupOther: boolean,
): CategoryBar[] {
  if (meta.categories === null) return [];
  const counts = facetCounts ?? meta.categories.counts;
  const all = meta.categories.labels.map((label, index) => ({
    label,
    count: counts[index] ?? meta.categories?.counts[index] ?? 0,
  }));
  const total = all.reduce((sum, entry) => sum + entry.count, 0);
  all.sort((a, b) => b.count - a.count);
  const take = Math.max(1, Math.floor(topN));
  const top: CategoryBar[] = all.slice(0, take).map((entry) => ({
    label: entry.label,
    count: entry.count,
    pct: total > 0 ? (entry.count / total) * 100 : 0,
  }));
  if (groupOther && all.length > top.length) {
    const count = all.slice(top.length).reduce((sum, entry) => sum + entry.count, 0);
    top.push({
      label: "Other",
      count,
      pct: total > 0 ? (count / total) * 100 : 0,
      other: true,
    });
  }
  return top;
}

export const CHART_COLORS: readonly string[] = [
  "#2563eb",
  "#0ea5e9",
  "#10b981",
  "#84cc16",
  "#eab308",
  "#f97316",
  "#ef4444",
  "#ec4899",
  "#8b5cf6",
  "#64748b",
];

const RAMP_STOPS: readonly (readonly [number, number, number])[] = [
  [37, 99, 235],
  [14, 165, 233],
  [16, 185, 129],
  [234, 179, 8],
  [239, 68, 68],
];

/** Blue -> green -> yellow -> red interpolation for numeric colour scales. */
export function rampColor(t: number): string {
  const clamped = Math.max(0, Math.min(1, Number.isFinite(t) ? t : 0));
  const scaled = clamped * (RAMP_STOPS.length - 1);
  const index = Math.min(RAMP_STOPS.length - 2, Math.floor(scaled));
  const f = scaled - index;
  const from = RAMP_STOPS[index];
  const to = RAMP_STOPS[index + 1];
  const channel = (a: number, b: number): number => Math.round(a + (b - a) * f);
  return `rgb(${channel(from[0], to[0])}, ${channel(from[1], to[1])}, ${channel(from[2], to[2])})`;
}

export function hexToRgb(hex: string): [number, number, number] {
  const value = hex.replace("#", "");
  const full =
    value.length === 3
      ? value
          .split("")
          .map((c) => c + c)
          .join("")
      : value;
  const parsed = Number.parseInt(full, 16);
  if (!Number.isFinite(parsed) || full.length !== 6) return [37, 99, 235];
  return [(parsed >> 16) & 255, (parsed >> 8) & 255, parsed & 255];
}

/** Evenly spaced nice tick values inside [min, max]. */
export function niceTicks(min: number, max: number, target = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  if (max <= min) return [min];
  const span = max - min;
  const rawStep = span / Math.max(1, target);
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const residual = rawStep / magnitude;
  const multiplier = residual >= 7 ? 10 : residual >= 3 ? 5 : residual >= 1.5 ? 2 : 1;
  const step = multiplier * magnitude;
  const ticks: number[] = [];
  const first = Math.ceil(min / step) * step;
  const epsilon = step * 1e-6;
  for (let value = first; value <= max + epsilon; value += step) {
    ticks.push(value);
  }
  return ticks;
}

export const EXPORT_SIZES: readonly { label: string; width: number; height: number }[] = [
  { label: "1280 × 720", width: 1280, height: 720 },
  { label: "1920 × 1080", width: 1920, height: 1080 },
  { label: "2560 × 1440", width: 2560, height: 1440 },
];

export const DEFAULT_EXPORT_SIZE = 1;

/** Default chart title: data source plus column, editable by the user. */
export function defaultChartTitle(datasetName: string, columnName: string): string {
  const base = datasetName.replace(/\.[^.]+$/, "").trim();
  const source = base === "" ? "Data" : base;
  return columnName === "" ? source : `${source} — ${columnName}`;
}

/** Displays a bin bound with thousands separators, e.g. 19818400000. */
export function formatChartNumber(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

/** Parses a bin bound, tolerating spaces, underscores and thousands commas. */
export function parseChartNumber(text: string): number | null {
  const cleaned = text.replace(/[,\s_]/g, "");
  if (cleaned === "") return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

export interface SuggestedRange {
  min: number;
  max: number;
  overflow: boolean;
  /** True when the upper bound was clipped to p95 because of extreme outliers. */
  clipped: boolean;
}

/**
 * Sensible default bin range: the full data range, but when a few extreme
 * values dwarf the rest (max > 2× p95) the End is set to p95 and the "> Max"
 * overflow bar is switched on so nothing is hidden.
 */
export function suggestedBinRange(meta: ColumnMeta): SuggestedRange {
  const histogram = meta.histogram;
  let min = meta.stats.min ?? histogram?.min ?? 0;
  let max = meta.stats.max ?? histogram?.max ?? 1;
  if (!(max > min)) {
    min -= 1;
    max += 1;
  }
  const p95 = histogram?.p95 ?? max;
  if (p95 > min && max > p95 * 2) {
    return { min, max: p95, overflow: true, clipped: true };
  }
  return { min, max, overflow: false, clipped: false };
}

export function formatTick(value: number, kind: "histogram" | "line" | null): string {
  if (kind === "line") return toDateInputValue(value);
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  if (abs > 0 && abs < 1) return value.toFixed(2);
  return value.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

export function safeFileName(name: string): string {
  return (
    name
      .replace(/\.[^.]+$/, "")
      .replace(/[^a-zA-Z0-9-_]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase() || "chart"
  );
}

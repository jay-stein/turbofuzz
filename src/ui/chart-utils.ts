import { nameHas } from "../data/name-hints.js";
import {
  formatDurationMs,
  toDateInputValue,
  toTimeInputValue,
} from "../parse/dates.js";
import type { ColumnMeta } from "../worker/protocol.js";
import type { ColumnType } from "../types.js";
import { detectGeoPair } from "../data/geo.js";
import { looksLikeIdName } from "../data/identifier.js";
import { quickStarts, type QuickStart, type RecColumn, type RecType } from "./chart-recommender.js";

export type ChartKind = "histogram" | "line" | "bar" | null;

export type ChartCardKind =
  | "histogram"
  | "line"
  | "bar"
  | "barplot"
  | "scatter"
  | "density"
  | "box"
  | "treemap"
  | "terms"
  | "heatmap"
  | "correlation"
  | "bubble"
  | "kpi"
  | "map"
  | "pivotHeatmap"
  | "dotplot"
  | "stacked100"
  | "smallmultiples"
  | "slopegraph"
  | "waterfall";

export const CHART_KIND_LABELS: Record<ChartCardKind, string> = {
  histogram: "Histogram",
  line: "Time series",
  bar: "Count plot",
  barplot: "Barplot",
  scatter: "Scatter",
  density: "Density",
  box: "Box plot",
  treemap: "Treemap",
  terms: "Top terms",
  heatmap: "Heatmap",
  correlation: "Correlation",
  bubble: "Bubble",
  kpi: "KPI",
  map: "Map",
  pivotHeatmap: "Pivot heatmap",
  dotplot: "Dot plot",
  stacked100: "100% stacked bar",
  smallmultiples: "Small multiples",
  slopegraph: "Slopegraph",
  waterfall: "Waterfall",
};

/** Kinds that plot their own measure aggregate over a column (needs a value column). */
export const VALUE_AGGREGATE_KINDS: readonly ChartCardKind[] = [
  "line",
  "bar",
  "barplot",
  "kpi",
  "histogram",
  "dotplot",
  "stacked100",
  "smallmultiples",
  "slopegraph",
  "waterfall",
];

/** Kinds whose aggregate can carry a second (group) dimension. */
export const SPLIT_KINDS: readonly ChartCardKind[] = [
  "line",
  "bar",
  "barplot",
  "stacked100",
  "smallmultiples",
  "slopegraph",
];

/** Kinds that need a Group by to say anything. */
export const GROUP_REQUIRED_KINDS: readonly ChartCardKind[] = ["stacked100", "smallmultiples", "slopegraph"];

export const PAIR_KINDS: readonly ChartCardKind[] = [
  "scatter",
  "density",
  "box",
  "heatmap",
  "bubble",
  "map",
];

export function isPairKind(kind: ChartCardKind): boolean {
  return PAIR_KINDS.includes(kind);
}

/** Chart type implied by the column's type (null = not chartable). */
export function chartKindFor(type: ColumnMeta["type"]): ChartKind {
  switch (type) {
    case "integer":
    case "number":
    case "time":
    case "duration":
      return "histogram";
    case "date":
    case "datetime":
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
  if (columns.some((meta) => meta.type === "date" || meta.type === "datetime")) return "line";
  if (columns.some((meta) => chartKindFor(meta.type) === "bar")) return "bar";
  return "histogram";
}

export function isNumericType(type: ColumnType): boolean {
  return type === "integer" || type === "number";
}

export function isCategoryType(type: ColumnType): boolean {
  return type === "category" || type === "boolean";
}

/**
 * True when a chart can group by this column: real categories, plus any
 * low-cardinality integer, text, date or time column that carries a value list.
 */
export function isGroupable(meta: ColumnMeta): boolean {
  return isCategoryType(meta.type) || meta.categories !== null || (meta.groups ?? null) !== null;
}

/**
 * Exposes the worker's `groups` value list as `categories` so chart code treats
 * every groupable column alike. Only chart cards see this view; filters and the
 * table keep the original metadata.
 */
export function withChartGroups(columns: ColumnMeta[]): ColumnMeta[] {
  return columns.map((meta) =>
    meta.categories === null && meta.groups != null ? { ...meta, categories: meta.groups } : meta,
  );
}

export { looksLikeIdName };

/**
 * ID-like columns make poor chart axes. Names are the strongest signal; a
 * string column that is entirely distinct is also an identifier. Numeric
 * measures are allowed to be unique (revenue, price, timestamp-like counts).
 */
export function isIdLikeColumn(meta: ColumnMeta, rowCount: number): boolean {
  if (meta.type === "identifier") return true;
  if (looksLikeIdName(meta.name)) return true;
  if (rowCount <= 12) return false;
  if (meta.type === "string") return meta.stats.distinct === rowCount;
  if (meta.type !== "integer") return false;
  const nonNull = Math.max(1, rowCount - meta.stats.nulls);
  if (meta.stats.distinct / nonNull < 0.98) return false;
  if (nameHas(meta.name, "chartMeasure")) return false;
  const min = meta.stats.min;
  const max = meta.stats.max;
  if (min === null || max === null) return false;
  // Surrogate keys run in a compact range (1..N, 0..N-1, or a shifted block).
  return max - min + 1 <= nonNull * 10;
}

/** A numeric column with few distinct values charts better as categories. */
export function isChartCategory(meta: ColumnMeta): boolean {
  if (isCategoryType(meta.type)) return true;
  return isGroupable(meta) && meta.stats.distinct > 0 && meta.stats.distinct <= 12;
}

const CATEGORY_HINT = /(region|country|state|province|county|city|segment|status|category|product|type|channel|group|department|team|industry|plan|tier|class|gender|band)/i;
const DATE_HINT = /(date|time|created|updated|event|timestamp|when|period|month|year|day)/i;

interface ChartEntry {
  meta: ColumnMeta;
  index: number;
}

function nullRatio(meta: ColumnMeta, rowCount: number): number {
  return rowCount > 0 ? meta.stats.nulls / rowCount : 0;
}

function dominantShare(meta: ColumnMeta): number | null {
  const counts = meta.categories?.counts;
  if (counts !== undefined && counts.length > 0) {
    const total = counts.reduce((sum, count) => sum + count, 0);
    return total > 0 ? Math.max(...counts) / total : null;
  }
  const top = meta.stats.topValues[0]?.count;
  const total = meta.stats.topValues.reduce((sum, entry) => sum + entry.count, 0);
  return top !== undefined && total > 0 ? top / total : null;
}

function categoryScore(entry: ChartEntry, rowCount: number): number {
  const meta = entry.meta;
  if (!isChartCategory(meta) || isIdLikeColumn(meta, rowCount)) return Number.NEGATIVE_INFINITY;
  const distinct = meta.stats.distinct;
  if (distinct < 2 || distinct > 12) return Number.NEGATIVE_INFINITY;
  let score = isCategoryType(meta.type) ? 40 : 10;
  if (distinct <= 8) score += 30;
  else score += 10;
  if (CATEGORY_HINT.test(meta.name)) score += 25;
  if (/(code|number|num|no)$/i.test(meta.name)) score -= 12;
  score -= nullRatio(meta, rowCount) * 30;
  const share = dominantShare(meta);
  if (share !== null) {
    if (share > 0.9) score -= 20;
    else if (share >= 0.1) score += 5;
  }
  return score - entry.index * 0.01;
}

function dateScore(entry: ChartEntry, rowCount: number): number {
  const meta = entry.meta;
  if (meta.type !== "date" && meta.type !== "datetime") return Number.NEGATIVE_INFINITY;
  if (meta.stats.distinct < 8 || isIdLikeColumn(meta, rowCount)) return Number.NEGATIVE_INFINITY;
  let score = 40 + Math.min(30, Math.log2(meta.stats.distinct) * 5);
  if (DATE_HINT.test(meta.name)) score += 20;
  score -= nullRatio(meta, rowCount) * 20;
  return score - entry.index * 0.01;
}

function measureScore(entry: ChartEntry, rowCount: number): number {
  const meta = entry.meta;
  if (!isNumericType(meta.type) || meta.stats.distinct < 13) return Number.NEGATIVE_INFINITY;
  if (isIdLikeColumn(meta, rowCount)) return Number.NEGATIVE_INFINITY;
  let score = 40;
  if (nameHas(meta.name, "chartMeasure")) score += 25;
  if (/(code|number|num|no|year|month|day)$/i.test(meta.name)) score -= 30;
  score -= nullRatio(meta, rowCount) * 20;
  return score - entry.index * 0.01;
}

function bestBy(
  entries: readonly ChartEntry[],
  scorer: (entry: ChartEntry) => number,
): { entry: ChartEntry; score: number } | null {
  let best: { entry: ChartEntry; score: number } | null = null;
  for (const entry of entries) {
    const score = scorer(entry);
    if (!Number.isFinite(score)) continue;
    if (best === null || score > best.score) best = { entry, score };
  }
  return best;
}

export interface DefaultCardPick {
  kind: ChartCardKind;
  column: number;
  /** Plain-language reason, shown as "Suggested: ." in the card note. */
  reason: string;
}

/**
 * The first card should answer the most useful question the file can answer:
 * a date over time, otherwise rows by category, otherwise a numeric
 * distribution. ID-like columns and low-information categories are skipped.
 */
export function pickDefaultCard(columns: readonly ColumnMeta[], rowCount = 0): DefaultCardPick {
  const entries = columns
    .map((meta, index) => ({ meta, index }))
    .filter((entry) => entry.meta.role !== "provenance");

  const date = bestBy(entries, (entry) => dateScore(entry, rowCount));
  if (date !== null) {
    return {
      kind: "line",
      column: date.entry.index,
      reason: `rows over time by ${date.entry.meta.name}`,
    };
  }

  const category = bestBy(entries, (entry) => categoryScore(entry, rowCount));
  if (category !== null) {
    return {
      kind: "bar",
      column: category.entry.index,
      reason: `rows by ${category.entry.meta.name}`,
    };
  }

  const measure = bestBy(entries, (entry) => measureScore(entry, rowCount));
  if (measure !== null) {
    return {
      kind: "histogram",
      column: measure.entry.index,
      reason: `distribution of ${measure.entry.meta.name}`,
    };
  }

  const kind = defaultCardKind(columns as ColumnMeta[]);
  const allow =
    kind === "histogram"
      ? (meta: ColumnMeta): boolean => isNumericType(meta.type)
      : kind === "line"
        ? (meta: ColumnMeta): boolean => meta.type === "date"
        : (meta: ColumnMeta): boolean => isCategoryType(meta.type);
  const allowed = entries.filter(
    (entry) => allow(entry.meta) && !isIdLikeColumn(entry.meta, rowCount),
  );
  return { kind, column: allowed[0]?.index ?? -1, reason: "" };
}

export interface ChartIdea {
  label: string;
  preset: Partial<{
    kind: ChartCardKind;
    column: number;
    x: number;
    y: number;
    valueColumn: number;
    valueAgg: "sum" | "mean";
    correlationColumns: number[];
  }>;
}

/** Describe a column to the recommender: metadata only, never rows. */
export function toRecColumn(meta: ColumnMeta, index: number, rowCount: number): RecColumn {
  const distinct = meta.stats.distinct;
  let type: RecType;
  if (isIdLikeColumn(meta, rowCount) || meta.type === "identifier") type = "id";
  else if (meta.type === "string") type = isGroupable(meta) ? "category" : "text";
  else if (meta.type === "duration") type = "number";
  else type = meta.type;
  const dated = meta.type === "date" || meta.type === "datetime";
  return {
    name: meta.name,
    type,
    distinct,
    index,
    nullPct: rowCount > 0 ? (meta.stats.nulls / rowCount) * 100 : 0,
    min: dated && typeof meta.stats.min === "number" ? meta.stats.min : null,
    max: dated && typeof meta.stats.max === "number" ? meta.stats.max : null,
    avgLen: meta.stats.avgLength ?? undefined,
  };
}

function ideaFor(start: QuickStart): ChartIdea | null {
  const [a = -1, b = -1] = start.indexes;
  if (start.indexes.some((index) => index < 0)) return null;
  const valueAgg = start.cfg.agg === "mean" ? "mean" : "sum";
  switch (start.chart) {
    case "timeseries":
      // The card buckets time on Auto, so the label names no unit it might not use.
      return {
        label: start.title.replace(/ by [a-z]+$/, " over time"),
        preset: { kind: "line", column: a, ...(b >= 0 ? { valueColumn: b, valueAgg } : {}) },
      };
    case "barplot":
      return { label: start.title, preset: { kind: "barplot", column: a, valueColumn: b, valueAgg } };
    case "countplot":
      return { label: start.title, preset: { kind: "bar", column: a } };
    case "histogram":
      return { label: start.title, preset: { kind: "histogram", column: a } };
    case "scatter":
    case "density":
      return { label: start.title, preset: { kind: start.chart, x: a, y: b } };
    case "correlation":
      return { label: start.title, preset: { kind: "correlation", correlationColumns: start.indexes } };
    default:
      return null;
  }
}

/**
 * Up to three starting charts, chosen by column role and name hints rather
 * than file order. Maps are reserved first when real coordinates exist.
 */
export function suggestCharts(columns: readonly ColumnMeta[], rowCount = 0): ChartIdea[] {
  const ideas: ChartIdea[] = [];
  const geo = detectGeoPair(columns, rowCount);
  if (geo !== null) {
    ideas.push({
      label: "Map of coordinates",
      preset: { kind: "map", x: geo.lon, y: geo.lat },
    });
  }
  const rec: RecColumn[] = [];
  columns.forEach((meta, index) => {
    if (meta.role !== "provenance") rec.push(toRecColumn(meta, index, rowCount));
  });
  for (const start of quickStarts(rec, rowCount)) {
    const idea = ideaFor(start);
    if (idea !== null) ideas.push(idea);
  }
  return ideas.slice(0, 3);
}

const AGG_WORDS: Record<string, string> = {
  sum: "Sum",
  mean: "Average",
  avg: "Average",
  median: "Median",
  min: "Min",
  max: "Max",
  count: "Count",
  distinct: "Distinct count",
  stddev: "Std dev",
  variance: "Variance",
};

/** "sum(units)" -> "Sum of units", "count(*)" -> "Rows"; anything else is left as written. */
export function plainMeasureName(name: string): string {
  if (name === "count(*)") return "Rows";
  const match = /^(\w+)\((.+?)\)(.*)$/.exec(name);
  const word = match === null ? undefined : AGG_WORDS[match[1]];
  return match === null || word === undefined ? name : `${word} of ${match[2]}${match[3]}`;
}

/** Axis tick formatting: temporal types get their own tick text. */
export type AxisFormat = "line" | "datetime" | "time" | "duration";

export function axisKindFor(type: ColumnType): AxisFormat | null {
  switch (type) {
    case "date":
      return "line";
    case "datetime":
      return "datetime";
    case "time":
      return "time";
    case "duration":
      return "duration";
    default:
      return null;
  }
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
  const trimmed = hex.trim();
  const rgbMatch = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(trimmed);
  if (rgbMatch !== null) {
    return [Number(rgbMatch[1]), Number(rgbMatch[2]), Number(rgbMatch[3])];
  }
  const value = trimmed.replace("#", "");
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

/** Diverging heat colours for a correlation coefficient (-1 red, 0 neutral, +1 blue). */
export function correlationCell(
  r: number,
  zeroColor: string,
): { bg: string; fg: string } {
  const zero = hexToRgb(zeroColor);
  const finite = Number.isFinite(r);
  const target: [number, number, number] = !finite
    ? [148, 163, 184]
    : r < 0
      ? [239, 68, 68]
      : [37, 99, 235];
  const strength = finite ? Math.min(1, Math.abs(r)) : 0;
  const t = finite ? (strength === 0 ? 0 : 0.12 + 0.88 * strength) : 0.15;
  const mix = (index: number): number => Math.round(zero[index] + (target[index] - zero[index]) * t);
  const rgb: [number, number, number] = [mix(0), mix(1), mix(2)];
  const luminance = (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255;
  return {
    bg: `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`,
    fg: luminance < 0.55 ? "#ffffff" : "#1f2328",
  };
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

/** Default chart title: the column (or pair) the card is about. */
export function defaultChartTitle(columnName: string): string {
  return columnName === "" ? "Data" : columnName;
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

const YEAR_MS = 365.25 * 86_400_000;

/**
 * Axis tick text. Temporal ticks adapt to the axis span: intraday spans show
 * clock times, day-scale spans dates, multi-year spans month buckets. The
 * span is optional; without it the full canonical form is used.
 */
export function formatTick(
  value: number,
  kind: "histogram" | AxisFormat | null,
  spanMs?: number,
): string {
  const span = spanMs ?? Number.POSITIVE_INFINITY;
  if (kind === "line") {
    if (spanMs !== undefined && span > 3 * YEAR_MS) return toDateInputValue(value).slice(0, 7);
    return toDateInputValue(value);
  }
  if (kind === "datetime") {
    // Without a span keep the full canonical form (tooltips, exports).
    if (spanMs === undefined) return `${toDateInputValue(value)} ${toTimeInputValue(value)}`;
    if (span <= 2 * 86_400_000) return toTimeInputValue(value);
    if (span <= 120 * 86_400_000) {
      return `${toDateInputValue(value).slice(5)} ${toTimeInputValue(value)}`;
    }
    if (span > 3 * YEAR_MS) return toDateInputValue(value).slice(0, 7);
    return toDateInputValue(value);
  }
  if (kind === "time") return toTimeInputValue(value);
  if (kind === "duration") return formatDurationMs(value);
  // Years read as labels, not quantities: bare 4-digit integers in the year
  // window never compact (1900, 1970, 2010 — not 1.9k/2k). Birth-year axes
  // are the reported case; wide count axes still show 50k/1.5M below.
  if (Number.isInteger(value) && value >= 1000 && value <= 2200) return String(value);
  const abs = Math.abs(value);
  const compact = (scaled: number): string => {
    const text = scaled >= 100 ? scaled.toFixed(0) : scaled.toFixed(1);
    return text.endsWith(".0") ? text.slice(0, -2) : text;
  };
  if (abs >= 1_000_000) return `${compact(value / 1_000_000)}M`;
  if (abs >= 1_000) return `${compact(value / 1_000)}k`;
  if (abs > 0 && abs < 1) return value.toFixed(2);
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

/** Whole-number tick label for count axes, e.g. 50,000. */
export function formatCount(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

/** The plot rectangle and brush rectangle used by the map card, in canvas px. */
export interface MapBrushFrame {
  left: number;
  top: number;
  plotW: number;
  plotH: number;
  /** Current map viewport; omitted = the whole world. */
  lonMin?: number;
  lonMax?: number;
  latMin?: number;
  latMax?: number;
}

export interface PlotBounds {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

/**
 * Zooms a plot viewport around an anchor (0–1 in each axis, y pointing up).
 * factor < 1 zooms in, > 1 zooms out; spans never drop below minSpan.
 */
export function zoomPlotBounds(
  bounds: PlotBounds,
  anchor: { x: number; y: number },
  factor: number,
  minSpan = 1e-9,
): PlotBounds {
  const spanX = Math.max(minSpan, (bounds.xMax - bounds.xMin) * factor);
  const spanY = Math.max(minSpan, (bounds.yMax - bounds.yMin) * factor);
  const x = bounds.xMin + anchor.x * (bounds.xMax - bounds.xMin);
  const y = bounds.yMin + anchor.y * (bounds.yMax - bounds.yMin);
  const xMin = x - anchor.x * spanX;
  const yMin = y - anchor.y * spanY;
  return { xMin, xMax: xMin + spanX, yMin, yMax: yMin + spanY };
}

export interface MapBrushRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * Converts a map brush rectangle (canvas px) into lon/lat bounds, clamped to
 * the world. Equirectangular inverse of the map card's projection.
 */
export function mapBrushBounds(
  frame: MapBrushFrame,
  brush: MapBrushRect,
): { lonMin: number; lonMax: number; latMin: number; latMax: number } {
  const clampX = (value: number): number =>
    Math.max(frame.left, Math.min(frame.left + frame.plotW, value));
  const clampY = (value: number): number =>
    Math.max(frame.top, Math.min(frame.top + frame.plotH, value));
  const x0 = clampX(Math.min(brush.x0, brush.x1));
  const x1 = clampX(Math.max(brush.x0, brush.x1));
  const y0 = clampY(Math.min(brush.y0, brush.y1));
  const y1 = clampY(Math.max(brush.y0, brush.y1));
  const lonMin = frame.lonMin ?? -180;
  const lonMax = frame.lonMax ?? 180;
  const latMin = frame.latMin ?? -90;
  const latMax = frame.latMax ?? 90;
  const toLon = (x: number): number =>
    lonMin + ((x - frame.left) / frame.plotW) * (lonMax - lonMin);
  const toLat = (y: number): number =>
    latMax - ((y - frame.top) / frame.plotH) * (latMax - latMin);
  return {
    lonMin: Math.max(-180, toLon(x0)),
    lonMax: Math.min(180, toLon(x1)),
    latMin: Math.max(-90, toLat(y1)),
    latMax: Math.min(90, toLat(y0)),
  };
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

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export interface CalendarTick {
  /** Index into the bucket list of the first bucket at or after the boundary. */
  index: number;
  label: string;
}

/**
 * X-axis ticks for a time axis, placed on calendar boundaries (years, quarters,
 * months, weeks, days) instead of at arbitrary bucket positions. `times` are bucket
 * starts in ms (UTC fields are used, matching how buckets are made). Picks the
 * finest unit that still fits within `maxTicks`.
 */
export function calendarTicks(times: readonly number[], maxTicks = 8): CalendarTick[] {
  const finite = times.filter((t) => Number.isFinite(t));
  if (finite.length === 0) return [];
  const first = finite[0]!;
  const last = finite[finite.length - 1]!;
  const day = 86_400_000;
  const spanDays = (last - first) / day;
  type Unit = { key: (t: number) => number; label: (t: number) => string; count: number };
  const d = (t: number): Date => new Date(t);
  const units: Unit[] = [
    { key: (t) => d(t).getUTCFullYear(), label: (t) => String(d(t).getUTCFullYear()), count: spanDays / 365.25 },
    {
      key: (t) => d(t).getUTCFullYear() * 4 + Math.floor(d(t).getUTCMonth() / 3),
      label: (t) => `Q${Math.floor(d(t).getUTCMonth() / 3) + 1} ${d(t).getUTCFullYear()}`,
      count: spanDays / 91.3,
    },
    {
      key: (t) => d(t).getUTCFullYear() * 12 + d(t).getUTCMonth(),
      label: (t) => `${MONTH_SHORT[d(t).getUTCMonth()]} ${d(t).getUTCFullYear()}`,
      count: spanDays / 30.4,
    },
    {
      // A new ISO week starts on Monday.
      key: (t) => Math.floor((t - 4 * day) / (7 * day)),
      label: (t) => `${d(t).getUTCDate()} ${MONTH_SHORT[d(t).getUTCMonth()]}`,
      count: spanDays / 7,
    },
    { key: (t) => Math.floor(t / day), label: (t) => `${d(t).getUTCDate()} ${MONTH_SHORT[d(t).getUTCMonth()]}`, count: spanDays },
  ];
  // The finest unit whose boundaries still fit; the coarsest (years) otherwise.
  const ordered = [...units].reverse().find((unit) => unit.count + 1 <= maxTicks) ?? units[0]!;
  const ticks: CalendarTick[] = [];
  let previous = Number.NaN;
  times.forEach((t, index) => {
    if (!Number.isFinite(t)) return;
    const key = ordered.key(t);
    if (key !== previous) {
      ticks.push({ index, label: ordered.label(t) });
      previous = key;
    }
  });
  // Always keep the first tick even if it is a partial period; thin if still too many.
  if (ticks.length > maxTicks) {
    const stride = Math.ceil(ticks.length / maxTicks);
    return ticks.filter((_, i) => i % stride === 0);
  }
  return ticks;
}

export type AxisGrain = "second" | "minute" | "hour" | "day" | "week" | "month" | "quarter" | "year";

/** The start of the next period after `t` at this grain (UTC, matching bucket starts). */
export function nextPeriod(t: number, grain: AxisGrain, every = 1): number {
  const n = Number.isFinite(every) && every >= 2 ? Math.floor(every) : 1;
  switch (grain) {
    case "second":
      return t + 1000 * n;
    case "minute":
      return t + 60_000 * n;
    case "hour":
      return t + 3_600_000 * n;
    case "day":
      return t + 86_400_000 * n;
    case "week":
      return t + 7 * 86_400_000 * n;
    case "month":
    case "quarter":
    case "year": {
      const d = new Date(t);
      const months = (grain === "month" ? 1 : grain === "quarter" ? 3 : 12) * n;
      return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1);
    }
  }
}

/**
 * A continuous time axis: every period between the first and last bucket, so a
 * missing period keeps its place on the axis instead of the neighbours closing up.
 * Capped so a huge span at a fine grain cannot stall the page.
 */
export function fillTimeAxis(times: readonly number[], grain: AxisGrain, cap = 20_000, every = 1): number[] {
  const finite = [...new Set(times.filter((t) => Number.isFinite(t)))].sort((a, b) => a - b);
  if (finite.length < 2) return finite;
  const out: number[] = [];
  const last = finite[finite.length - 1]!;
  for (let t = finite[0]!; t <= last && out.length < cap; t = nextPeriod(t, grain, every)) out.push(t);
  // Fall back to the observed buckets if stepping drifted off them (irregular grain).
  const observed = new Set(finite);
  const hit = out.filter((t) => observed.has(t)).length;
  return hit < finite.length ? finite : out;
}

/** A bucket width: `every` units of `grain` (every 15 minutes, every 2 weeks). */
export interface TimeStep {
  grain: AxisGrain;
  every: number;
}

const AUTO_STEPS: readonly TimeStep[] = [
  { grain: "second", every: 1 },
  { grain: "second", every: 5 },
  { grain: "second", every: 15 },
  { grain: "second", every: 30 },
  { grain: "minute", every: 1 },
  { grain: "minute", every: 5 },
  { grain: "minute", every: 15 },
  { grain: "minute", every: 30 },
  { grain: "hour", every: 1 },
];
const STEP_MS: Record<string, number> = { second: 1000, minute: 60_000, hour: 3_600_000 };

/**
 * Automatic width for a short time span (two days or less): the finest round
 * step that keeps the line to about sixty points, so a morning of readings is
 * minutes and a day is half-hours, instead of one lonely hour bucket.
 */
export function autoShortStep(spanMs: number, target = 60): TimeStep {
  for (const step of AUTO_STEPS) {
    if (spanMs / (STEP_MS[step.grain]! * step.every) <= target) return step;
  }
  return { grain: "hour", every: 1 };
}

/** "minute" → "minute", "minute" × 15 → "15 minutes" (for headlines and tooltips). */
export function describeStep(grain: string, every = 1, plural = false): string {
  if (every >= 2) return `${every} ${grain}s`;
  return plural ? `${grain}s` : grain;
}

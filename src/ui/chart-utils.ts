import {
  formatDurationMs,
  toDateInputValue,
  toTimeInputValue,
} from "../parse/dates.js";
import type { ColumnMeta } from "../worker/protocol.js";
import type { ColumnType } from "../types.js";
import { detectGeoPair } from "../data/geo.js";

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
  | "pivotHeatmap";

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
};

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
 * ID-like columns make poor chart axes: identifiers, or string/integer columns
 * where every row is distinct (the row id in a big file).
 */
export function isIdLikeColumn(meta: ColumnMeta, rowCount: number): boolean {
  if (meta.type === "identifier") return true;
  if (rowCount <= 12) return false;
  if (!(meta.type === "string" || meta.type === "integer" || meta.type === "number")) {
    return false;
  }
  return meta.stats.distinct === rowCount;
}

const ID_NAME = /(^|[^a-z0-9])(id|uuid|guid|key)s?($|[^a-z0-9])/i;
const NON_ID_WORDS = /(paid|valid|void|grid|solid|fluid|rapid|humid|arid|android)$/;

/**
 * Names that read as identifiers ("start station id", "bikeid") add no value
 * to charts and never join a correlation matrix by default.
 */
export function looksLikeIdName(name: string): boolean {
  const lower = name.toLowerCase();
  if (ID_NAME.test(lower)) return true;
  const compact = lower.replace(/[^a-z0-9]/g, "");
  return compact.length > 3 && compact.endsWith("id") && !NON_ID_WORDS.test(compact);
}

/** A numeric column with few distinct values charts better as categories. */
export function isChartCategory(meta: ColumnMeta): boolean {
  if (isCategoryType(meta.type)) return true;
  return isNumericType(meta.type) && meta.stats.distinct > 0 && meta.stats.distinct <= 12;
}

export interface DefaultCardPick {
  kind: ChartCardKind;
  column: number;
  /** Plain-language reason, shown as "Suggested: …" in the card note. */
  reason: string;
}

/**
 * The first card should answer the most useful question the file can answer:
 * a date over time, otherwise rows by category, otherwise a numeric
 * distribution. ID-like columns are never charted by default.
 */
export function pickDefaultCard(columns: readonly ColumnMeta[], rowCount = 0): DefaultCardPick {
  const entries = columns
    .map((meta, index) => ({ meta, index }))
    .filter((entry) => entry.meta.role !== "provenance");

  const dates = entries.filter(
    (entry) =>
      (entry.meta.type === "date" || entry.meta.type === "datetime") &&
      entry.meta.stats.distinct >= 8 &&
      !isIdLikeColumn(entry.meta, rowCount),
  );
  if (dates.length > 0) {
    const best = dates.reduce((a, b) =>
      b.meta.stats.distinct > a.meta.stats.distinct ? b : a,
    );
    return { kind: "line", column: best.index, reason: `rows over time by ${best.meta.name}` };
  }

  const categories = entries.filter(
    (entry) =>
      isChartCategory(entry.meta) &&
      entry.meta.stats.distinct >= 2 &&
      entry.meta.stats.distinct <= 12 &&
      !isIdLikeColumn(entry.meta, rowCount),
  );
  if (categories.length > 0) {
    const best = categories.reduce((a, b) =>
      b.meta.stats.distinct >= a.meta.stats.distinct ? b : a,
    );
    return { kind: "bar", column: best.index, reason: `rows by ${best.meta.name}` };
  }

  const numerics = entries.filter(
    (entry) =>
      isNumericType(entry.meta.type) &&
      entry.meta.stats.distinct >= 13 &&
      !isIdLikeColumn(entry.meta, rowCount),
  );
  if (numerics.length > 0) {
    return {
      kind: "histogram",
      column: numerics[0].index,
      reason: `distribution of ${numerics[0].meta.name}`,
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
  }>;
}

/**
 * Up to three ready-made charts for the toolbar strip while the grid holds a
 * single card: time series, count plot, distribution, scatter, heatmap in that order.
 */
export function suggestCharts(columns: readonly ColumnMeta[], rowCount = 0): ChartIdea[] {
  const entries = columns
    .map((meta, index) => ({ meta, index }))
    .filter((entry) => entry.meta.role !== "provenance");
  const ideas: ChartIdea[] = [];

  const dates = entries.filter(
    (entry) =>
      (entry.meta.type === "date" || entry.meta.type === "datetime") &&
      entry.meta.stats.distinct >= 8,
  );
  if (dates.length > 0) {
    ideas.push({ label: "Rows over time", preset: { kind: "line", column: dates[0].index } });
  }

  const categories = entries.filter(
    (entry) =>
      isChartCategory(entry.meta) &&
      entry.meta.stats.distinct >= 2 &&
      entry.meta.stats.distinct <= 12 &&
      !isIdLikeColumn(entry.meta, rowCount),
  );
  if (categories.length > 0) {
    const best = categories.reduce((a, b) =>
      b.meta.stats.distinct >= a.meta.stats.distinct ? b : a,
    );
    ideas.push({ label: `Rows by ${best.meta.name}`, preset: { kind: "bar", column: best.index } });
  }

  const numerics = entries.filter(
    (entry) =>
      isNumericType(entry.meta.type) &&
      entry.meta.stats.distinct >= 13 &&
      !isIdLikeColumn(entry.meta, rowCount),
  );
  if (numerics.length > 0) {
    ideas.push({
      label: `Distribution of ${numerics[0].meta.name}`,
      preset: { kind: "histogram", column: numerics[0].index },
    });
  }
  if (numerics.length >= 2) {
    ideas.push({
      label: `${numerics[0].meta.name} vs ${numerics[1].meta.name}`,
      preset: { kind: "scatter", x: numerics[0].index, y: numerics[1].index },
    });
  }

  const categoryPool = entries.filter(
    (entry) => isChartCategory(entry.meta) && !isIdLikeColumn(entry.meta, rowCount),
  );
  if (categoryPool.length >= 2) {
    ideas.push({
      label: `${categoryPool[0].meta.name} × ${categoryPool[1].meta.name}`,
      preset: { kind: "heatmap", x: categoryPool[0].index, y: categoryPool[1].index },
    });
  }

  const geo = detectGeoPair(columns, rowCount);
  if (geo !== null) {
    ideas.push({
      label: "Map of coordinates",
      preset: { kind: "map", x: geo.lon, y: geo.lat },
    });
  }

  return ideas.slice(0, 3);
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

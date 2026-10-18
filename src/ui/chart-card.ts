import type { ChartBinOptions, ChartBins } from "../data/chart-bins.js";
import type { SeriesGrid, SeriesMode, SeriesPoints } from "../data/chart-series.js";
import type {
  BoxGroupStats,
  BoxStatsResult,
  CrossTabResult,
  GridCountsResult,
} from "../data/chart-stats.js";
import type { AnimationResult } from "../data/chart-frames.js";
import { encodeGif, type GifFrameInput } from "../data/gif.js";
import { contourLevels, marchingSquares, smoothGrid, smoothSeries } from "../data/kde.js";
import { squarifyLayout } from "../data/treemap.js";
import {
  CUSTOM_PALETTE,
  DEFAULT_PALETTE,
  isRampPalette,
  PALETTES,
  paletteStops,
  parseCustomColors,
  parsePaletteJson,
  rampAt,
  samplePalette,
} from "../data/palettes.js";
import type { TimeGrain, ViewDef } from "../data/aggregate.js";
import type { ColumnFilter } from "../search/query-engine.js";
import { isNumericLikeType, TYPE_LABELS } from "../types.js";
import {
  chartSpecFromConfig,
  chartSpecJson,
  chartSpecToPandas,
  chartSpecToPolars,
} from "./chart-spec.js";
import type {
  AggregateMessage,
  BoxStatsMessage,
  ChartBinsMessage,
  ChartSeriesMessage,
  ColumnMeta,
  CorrelationMessage,
  CrosstabMessage,
  GroupedBinsMessage,
  GridCountsMessage,
  AnimationMessage,
  TextProfileMessage,
} from "../worker/protocol.js";
import {
  axisKindFor,
  type AxisFormat,
  categorySeries,
  type CategoryBar,
  CHART_COLORS,
  CHART_KIND_LABELS,
  type ChartCardKind,
  correlationCell,
  defaultChartTitle,
  formatChartNumber,
  formatCount,
  formatTick,
  hexToRgb,
  isCategoryType,
  isIdLikeColumn,
  isNumericType,
  isPairKind,
  looksLikeIdName,
  mapBrushBounds,
  niceTicks,
  zoomPlotBounds,
  parseChartNumber,
  rampColor,
  safeFileName,
  suggestedBinRange,
} from "./chart-utils.js";
import { downloadCsv } from "./chart-export.js";
import { clear, el, svgIcon } from "./dom.js";
import { openConfirm, openPrompt } from "./dialog.js";
import { describeScope } from "./scope.js";
import { openMenu } from "./menu.js";
import {
  decodeArcs,
  decodeCountries,
  decodeLand,
  type GeoCountry,
  projectLat,
  projectLon,
} from "../data/topo.js";
import { parseGeoFile, type GeoDataset } from "../data/geo-file.js";

/** Rectangle brush result: lon/lat bounds for the two coordinate columns. */
export interface MapBrushSelection {
  lonColumn: number;
  lonMin: number;
  lonMax: number;
  latColumn: number;
  latMin: number;
  latMax: number;
}

interface Basemap {
  land: Float64Array[];
  countries: GeoCountry[];
}

// The decoded 110m basemap is shared by every map card and decoded once per
// session; the world module itself is code-split and imports lazily.
let basemapCache: Basemap | null = null;
let basemapLoading: Promise<Basemap> | null = null;

function loadBasemap(): Promise<Basemap> {
  if (basemapCache !== null) return Promise.resolve(basemapCache);
  if (basemapLoading === null) {
    basemapLoading = import("../data/world-110m.js").then(({ WORLD_110M }) => {
      const arcs = decodeArcs(WORLD_110M);
      basemapCache = {
        land: decodeLand(WORLD_110M, arcs),
        countries: decodeCountries(WORLD_110M, arcs),
      };
      return basemapCache;
    });
  }
  return basemapLoading;
}

export type DensityStyle = "heat" | "contours" | "both";

export interface SeriesRequestInput {
  xColumn: number;
  yColumn: number;
  colorColumn: number;
  sizeColumn: number;
  mode: SeriesMode;
  limit?: number;
  /** false keeps the full data range; the map card sets this. */
  clip?: boolean;
  chartFilter?: { column: number; code: number };
  respectFilters?: boolean;
}

export interface ChartCardOptions {
  datasetName(): string;
  requestBins(column: number, options: ChartBinOptions): Promise<ChartBinsMessage>;
  requestSeries(input: SeriesRequestInput): Promise<ChartSeriesMessage>;
  /** Map card rectangle brush: filter both coordinate columns to the area. */
  onMapBrush?(selection: MapBrushSelection): void;
  requestBoxStats(input: {
    valueColumn: number;
    categoryColumn: number;
    topN: number;
    groupOther: boolean;
    chartFilter?: { column: number; code: number };
    respectFilters?: boolean;
  }): Promise<BoxStatsMessage>;
  requestCrosstab(input: {
    xColumn: number;
    yColumn: number;
    topX: number;
    topY: number;
    groupOther: boolean;
    chartFilter?: { column: number; code: number };
    respectFilters?: boolean;
  }): Promise<CrosstabMessage>;
  requestCorrelation(
    columns: number[],
    scope?: { chartFilter?: { column: number; code: number }; respectFilters?: boolean },
  ): Promise<CorrelationMessage>;
  /** Bins split by a category column, for grouped time series. */
  requestGroupedBins?(input: {
    column: number;
    groupColumn: number;
    options: ChartBinOptions;
    topN: number;
  }): Promise<GroupedBinsMessage>;
  /** Aggregate result for a view-bound card (null when the view is gone). */
  requestViewAggregate?(source: string): Promise<AggregateMessage | null>;
  /** Ad-hoc aggregation for the treemap measure (sum of a numeric column). */
  requestAggregate(view: ViewDef): Promise<AggregateMessage>;
  /** Token frequencies and shapes for the top-terms chart. */
  requestTextProfile(column: number): Promise<TextProfileMessage>;
  /** Row counts (and optional per-cell measure) for the bubble chart. */
  requestGridCounts?(
    xColumn: number,
    yColumn: number,
    bins?: number,
    measure?: { column: number; agg: "sum" | "mean" | "min" | "max" },
    groupColumn?: number,
    scope?: { chartFilter?: { column: number; code: number }; respectFilters?: boolean },
  ): Promise<GridCountsMessage>;
  /** Per-time-bucket frames for animated bar, bubble, histogram and treemap charts. */
  requestAnimation?(input: {
    timeColumn: number;
    grain: TimeGrain;
    chart: "bar" | "bubble" | "histogram";
    column: number;
    yColumn: number;
    bins?: number;
    topN?: number;
    measure?: { column: number; agg: "sum" | "mean" | "min" | "max" };
    groupColumn?: number;
    chartFilter?: { column: number; code: number };
    respectFilters?: boolean;
  }): Promise<AnimationMessage>;
  /** Label for the filtered-table source: "Table" when no filters apply. */
  tableSourceLabel?(): string;
  /** Applies a filter from a click on a chart region (bars, bins, cells). */
  onFilter?(column: number, filter: ColumnFilter | null, preview?: boolean): void;
  /** Reads the app's current filter for a column, so clicks can toggle. */
  currentFilter?(column: number): ColumnFilter | null;
  onRemove(card: ChartCard): void;
  onDuplicate(card: ChartCard): void;
  onExport(card: ChartCard): void;
}

export interface ChartCardConfig {
  kind: ChartCardKind;
  /** Data source: "" = the filtered table, otherwise a saved view id. */
  source: string;
  column: number;
  x: number;
  y: number;
  colorColumn: number;
  sizeColumn: number;
  mode: SeriesMode;
  densityStyle: DensityStyle;
  kde: boolean;
  color: string;
  /** True when the user picked a specific colour; palette changes leave it. */
  colorCustom?: boolean;
  multiColor: boolean;
  /** Colour map name (PALETTES) or CUSTOM_PALETTE with paletteCustom stops. */
  palette?: string;
  /** Comma/space separated hex stops used when palette is "custom". */
  paletteCustom?: string;
  /** Flip the colour map (light ↔ dark, series order reversed). */
  paletteReversed?: boolean;
  colorMin?: number | null;
  colorMax?: number | null;
  topN: number;
  groupOther: boolean;
  /** Barplot with a Group: side-by-side bars or one stacked bar per category. */
  barLayout?: "group" | "stack";
  binOptions: ChartBinOptions | null;
  binClipped: boolean;
  title: string;
  /** Axis title overrides; empty = the automatic column name. */
  xTitle?: string;
  yTitle?: string;
  /** Unit appended to the Y axis title, e.g. "kWh". */
  yUnit?: string;
  /** Category column splitting a time series into one line per value (-1 = off). */
  groupColumn: number;
  /** Line cards: plot an aggregate of this numeric column (-1/undefined = row count). */
  valueColumn?: number;
  /** Aggregate used for the value line (default mean). */
  valueAgg?: "mean" | "sum" | "median" | "min" | "max" | "count" | "distinct";
  /** Bucket grain for the value line; "auto"/undefined derives it from the span. */
  valueGrain?: TimeGrain | "auto";
  /** Non-destructive post-aggregation calculation for the card's measure. */
  valueCalc?:
    | "rolling7"
    | "cumulative"
    | "diff"
    | "pctChange"
    | "pctTotal"
    | "rank"
    | "yoy";
  /** Chart-scoped category filter; -1/undefined means no chart filter. */
  filterColumn?: number;
  filterCode?: number;
  /** Aggregate-backed cards: include the current table filters (default true). */
  respectFilters?: boolean;
  /** Bubble grid resolution per axis. */
  bubbleBins?: number;
  /** Bubble size measure: rows per cell or an aggregate of a numeric column. */
  bubbleAgg?: "count" | "sum" | "mean" | "min" | "max";
  /** How bubble radius maps from the measure value. */
  bubbleScale?: "area" | "radius" | "log";
  /** Map display: one dot per row, or an aggregated heat grid. */
  mapMode?: "points" | "heat";
  /** Card width in the grid: normal cell or the whole row. */
  span?: "auto" | "full";
  /** Time column for frame animation (-1 = off). */
  animationTimeColumn?: number;
  animationGrain?: TimeGrain;
  /** Playback/export speed multiplier (0.5, 1, 2, 4). */
  animationSpeed?: number;
  /** "Suggested: …" reason shown in the note for rule-picked default cards. */
  suggested: string;
  correlationColumns: number[];
}

/** One overlaid bubble set (a group, or the whole chart when ungrouped). */
interface BubbleLayer {
  label: string;
  code: number;
  counts: Uint32Array;
  values: Float64Array | null;
  color: string;
}

interface Frame {
  ui: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
  plotW: number;
  plotH: number;
  text: string;
  dim: string;
  border: string;
  /** Measured width of the widest Y tick label, for placing the Y title. */
  tickW: number;
  /** Left band reserved for a rotated Y title (0 when the axis has none). */
  labelPad: number;
}

const DEFAULT_BIN_COUNT = 32;
const POINT_LIMIT = 20_000;
/** Grouped time series: distinct lines before the rest folds into Other. */
const GROUP_LINE_LIMIT = 8;
const HEX = /^#?[0-9a-f]{6}$/i;

/** Plot-area rectangle in canvas CSS pixels, shared by hit-region builders. */
export interface PlotGeometry {
  left: number;
  top: number;
  plotW: number;
  plotH: number;
}

/** A click on a region toggles a category value, sets a range or text filter. */
export type HitAction =
  | { kind: "values"; column: number; code: number }
  | { kind: "range"; column: number; min: number | null; max: number | null }
  | { kind: "text"; column: number; query: string };

export interface HitRegion {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Tooltip lines, drawn in order. */
  lines: string[];
  /** Empty when the region is hover-only. */
  actions: HitAction[];
}

/** Crop a density grid to the visible X/Y viewport, preserving cell counts. */
export function cropDensityGrid(
  result: SeriesGrid,
  view: { xMin: number; xMax: number; yMin: number; yMax: number },
): SeriesGrid {
  const xStep = (result.xMax - result.xMin) / Math.max(1, result.cols);
  const yStep = (result.yMax - result.yMin) / Math.max(1, result.rows);
  const clamp = (value: number, max: number): number =>
    Math.max(0, Math.min(max, value));
  const c0 = clamp(Math.floor((view.xMin - result.xMin) / xStep), result.cols - 1);
  const c1 = clamp(Math.ceil((view.xMax - result.xMin) / xStep) - 1, result.cols - 1);
  const r0 = clamp(Math.floor((view.yMin - result.yMin) / yStep), result.rows - 1);
  const r1 = clamp(Math.ceil((view.yMax - result.yMin) / yStep) - 1, result.rows - 1);
  const cols = Math.max(1, c1 - c0 + 1);
  const rows = Math.max(1, r1 - r0 + 1);
  const counts = new Uint32Array(cols * rows);
  let max = 0;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const count =
        result.counts[(r0 + row) * result.cols + (c0 + col)] ?? 0;
      counts[row * cols + col] = count;
      if (count > max) max = count;
    }
  }
  return {
    ...result,
    counts,
    cols,
    rows,
    xMin: view.xMin,
    xMax: view.xMax,
    yMin: view.yMin,
    yMax: view.yMax,
    max,
  };
}

/** Topmost region containing the point, or null. Regions are drawn in order. */
export function hitTest(
  regions: readonly HitRegion[],
  x: number,
  y: number,
): HitRegion | null {
  for (let index = regions.length - 1; index >= 0; index--) {
    const region = regions[index];
    if (
      x >= region.x &&
      x <= region.x + region.w &&
      y >= region.y &&
      y <= region.y + region.h
    ) {
      return region;
    }
  }
  return null;
}

export interface SeriesHitInput {
  column: number;
  bins: readonly number[];
  /** Count drawn in the extra "> max" slot (0 = no overflow slot). */
  overflow: number;
  min: number;
  max: number;
  dateAxis: boolean;
  /** Exact temporal tick format when the axis column type is known. */
  axisFormat?: AxisFormat;
}

/** One hoverable slot per histogram bin (and the overflow bar). */
export function seriesHitRegions(geom: PlotGeometry, input: SeriesHitInput): HitRegion[] {
  const { bins, overflow, min, max, column, dateAxis } = input;
  const slots = bins.length + (overflow > 0 ? 1 : 0);
  if (slots === 0) return [];
  const slotW = geom.plotW / slots;
  const step = bins.length === 0 ? 0 : (max - min) / bins.length;
  const format = (value: number): string =>
    formatTick(
      value,
      input.axisFormat ?? (dateAxis ? "line" : "histogram"),
      input.max - input.min,
    );
  const regions: HitRegion[] = [];
  for (let index = 0; index < bins.length; index++) {
    const lo = min + index * step;
    const hi = index === bins.length - 1 ? max : min + (index + 1) * step;
    regions.push({
      x: geom.left + index * slotW,
      y: geom.top,
      w: slotW,
      h: geom.plotH,
      lines: [`${format(lo)} – ${format(hi)}`, `${formatCount(bins[index])} rows`],
      actions: [{ kind: "range", column, min: lo, max: hi }],
    });
  }
  if (overflow > 0) {
    regions.push({
      x: geom.left + bins.length * slotW,
      y: geom.top,
      w: slotW,
      h: geom.plotH,
      lines: [`> ${format(max)}`, `${formatCount(overflow)} rows`],
      actions: [{ kind: "range", column, min: max, max: null }],
    });
  }
  return regions;
}

export interface GroupedSeriesHitInput {
  column: number;
  /** Visible series, in draw order, each with its per-bin counts. */
  groups: { label: string; bins: readonly number[] }[];
  min: number;
  max: number;
  axisFormat?: AxisFormat;
}

/**
 * Time-series slots for a grouped line chart: the tooltip lists the date range
 * and each visible group's count; clicking filters the date range as before.
 */
export function groupedSeriesHitRegions(
  geom: PlotGeometry,
  input: GroupedSeriesHitInput,
): HitRegion[] {
  const binCount = input.groups[0]?.bins.length ?? 0;
  if (binCount === 0 || input.groups.length === 0) return [];
  const slotW = geom.plotW / binCount;
  const step = (input.max - input.min) / binCount;
  const format = (value: number): string =>
    formatTick(value, input.axisFormat ?? "line", input.max - input.min);
  const regions: HitRegion[] = [];
  for (let index = 0; index < binCount; index++) {
    const lo = input.min + index * step;
    const hi = index === binCount - 1 ? input.max : input.min + (index + 1) * step;
    const lines = [`${format(lo)} – ${format(hi)}`];
    for (const group of input.groups) {
      const count = group.bins[index] ?? 0;
      if (count > 0) lines.push(`${group.label}: ${formatCount(count)}`);
    }
    regions.push({
      x: geom.left + index * slotW,
      y: geom.top,
      w: slotW,
      h: geom.plotH,
      lines,
      actions: [{ kind: "range", column: input.column, min: lo, max: hi }],
    });
  }
  return regions;
}

/** One hoverable slot per bar; "Other" bars are hover-only. */
export function barHitRegions(
  geom: PlotGeometry,
  bars: readonly CategoryBar[],
  codes: readonly number[],
  column: number,
): HitRegion[] {
  if (bars.length === 0) return [];
  const slotW = geom.plotW / bars.length;
  return bars.map((bar, index) => {
    const code = codes[index] ?? -1;
    return {
      x: geom.left + index * slotW,
      y: geom.top,
      w: slotW,
      h: geom.plotH,
      lines: [
        bar.label === "" ? "(blank)" : bar.label,
        `${formatCount(bar.count)} rows · ${bar.pct.toFixed(1)}%`,
      ],
      actions: bar.other === true || code < 0 ? [] : [{ kind: "values", column, code }],
    };
  });
}

export interface HeatmapHitInput {
  xLabels: readonly string[];
  yLabels: readonly string[];
  counts: ArrayLike<number>;
  total: number;
  xColumn: number;
  yColumn: number;
  /** Category code for a label, or -1 when it is the grouped "Other" bucket. */
  codeOfX: (label: string) => number;
  codeOfY: (label: string) => number;
}

/** One hoverable cell per heatmap cell; both categories toggle on click. */
export function heatmapHitRegions(geom: PlotGeometry, input: HeatmapHitInput): HitRegion[] {
  const xCount = input.xLabels.length;
  const yCount = input.yLabels.length;
  if (xCount === 0 || yCount === 0) return [];
  const cellW = geom.plotW / xCount;
  const cellH = geom.plotH / yCount;
  const regions: HitRegion[] = [];
  for (let row = 0; row < yCount; row++) {
    for (let column = 0; column < xCount; column++) {
      const count = input.counts[row * xCount + column] ?? 0;
      const pct = input.total > 0 ? (count / input.total) * 100 : 0;
      const xLabel = input.xLabels[column];
      const yLabel = input.yLabels[row];
      const actions: HitAction[] = [];
      const xCode = input.codeOfX(xLabel);
      const yCode = input.codeOfY(yLabel);
      if (xCode >= 0) actions.push({ kind: "values", column: input.xColumn, code: xCode });
      if (yCode >= 0) actions.push({ kind: "values", column: input.yColumn, code: yCode });
      regions.push({
        x: geom.left + column * cellW,
        y: geom.top + row * cellH,
        w: cellW,
        h: cellH,
        lines: [`${xLabel} × ${yLabel}`, `${formatCount(count)} rows · ${pct.toFixed(1)}%`],
        actions,
      });
    }
  }
  return regions;
}

/** Five-number summaries; hover-only. */
export function boxHitRegions(
  geom: PlotGeometry,
  groups: readonly BoxGroupStats[],
  slotCount = groups.length,
): HitRegion[] {
  if (groups.length === 0 || slotCount <= 0) return [];
  const slot = geom.plotW / slotCount;
  return groups.map((group, index) => ({
    x: geom.left + index * slot,
    y: geom.top,
    w: slot,
    h: geom.plotH,
    lines: [
      group.label === "" ? "(blank)" : group.label,
      `min ${formatChartNumber(group.min)}`,
      `q1 ${formatChartNumber(group.q1)}`,
      `median ${formatChartNumber(group.median)}`,
      `q3 ${formatChartNumber(group.q3)}`,
      `max ${formatChartNumber(group.max)}`,
      `${formatCount(group.count)} values`,
    ],
    actions: [],
  }));
}

export interface CorrelationHitInput {
  labels: readonly string[];
  values: ArrayLike<number>;
  counts: ArrayLike<number>;
}

/** One hoverable cell per correlation pair; hover-only. */
export function correlationHitRegions(
  geom: PlotGeometry,
  input: CorrelationHitInput,
): HitRegion[] {
  const n = input.labels.length;
  if (n === 0) return [];
  const sizeX = geom.plotW / n;
  const sizeY = geom.plotH / n;
  const regions: HitRegion[] = [];
  for (let row = 0; row < n; row++) {
    for (let column = 0; column < n; column++) {
      const index = row * n + column;
      const r = input.values[index];
      regions.push({
        x: geom.left + column * sizeX,
        y: geom.top + row * sizeY,
        w: sizeX,
        h: sizeY,
        lines: [
          `${input.labels[row]} × ${input.labels[column]}`,
          Number.isFinite(r) ? `r = ${r.toFixed(2)}` : "r = —",
          `n = ${formatCount(input.counts[index] ?? 0)}`,
        ],
        actions: [],
      });
    }
  }
  return regions;
}


function cssVar(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value === "" ? fallback : value;
}

/** Movie-camera glyph for the Animate button and the GIF export. */
function movieIcon(): SVGElement {
  return svgIcon(
    '<rect x="2.5" y="6.5" width="12.5" height="11" rx="2.5"/><path d="m15 10.5 6.5-4v11l-6.5-4z"/>',
    "chart-movie-icon",
  );
}

/** Expand-arrows glyph for the full-row width toggle. */
function widthIcon(): SVGElement {
  return svgIcon(
    '<path d="M4 9V4h5"/><path d="M20 15v5h-5"/><path d="M15 4h5v5"/><path d="M9 20H4v-5"/>',
    "chart-width-icon",
  );
}

/** Frame glyph for the expand/focus mode toggle. */
function focusIcon(): SVGElement {
  return svgIcon(
    '<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M16 3h3a2 2 0 0 1 2 2v3"/><path d="M8 21H5a2 2 0 0 1-2-2v-3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>',
    "chart-focus-icon",
  );
}

function defaultConfig(): ChartCardConfig {
  return {
    kind: "histogram",
    source: "",
    column: -1,
    x: -1,
    y: -1,
    colorColumn: -1,
    sizeColumn: -1,
    mode: "auto",
    densityStyle: "both",
    kde: true,
    color: CHART_COLORS[0],
    multiColor: true,
    palette: DEFAULT_PALETTE,
    paletteCustom: "",
    paletteReversed: false,
    colorMin: null,
    colorMax: null,
    topN: 10,
    groupOther: true,
    barLayout: "group",
    binOptions: null,
    binClipped: false,
    title: "",
    groupColumn: -1,
    bubbleBins: 40,
    bubbleAgg: "count",
    bubbleScale: "area",
    mapMode: "points",
    span: "auto",
    animationTimeColumn: -1,
    animationGrain: "day",
    animationSpeed: 1,
    suggested: "",
    correlationColumns: [],
    filterColumn: -1,
    filterCode: -1,
    respectFilters: true,
  };
}

/**
 * One chart in the multi-chart grid: its own type, columns, settings, canvas,
 * note and PNG export. Data flows in from the panel (`setColumns`,
 * `setFiltered`, `setRowCount`); scatter/density request their own sample or
 * density grid from the worker and drop stale responses via a generation
 * counter.
 */
export class ChartCard {
  readonly root: HTMLElement;

  private config = defaultConfig();
  private columns: ColumnMeta[] = [];
  private facets: Record<number, number[]> = {};
  private histograms: Record<number, number[]> = {};
  private rowCount = 0;
  private generation = 0;
  private disposed = false;

  private pickerSignature = "";
  private binResult: ChartBins | null = null;
  private lineBinResult: ChartBins | null = null;
  private lineBinRange: { min: number; max: number } | null = null;
  private lineBinSignature = "";
  private binMedian: number | null = null;
  private seriesResult: SeriesPoints | SeriesGrid | null = null;
  /** Decoded basemap for map cards (shared module cache, set on first paint). */
  private basemap: Basemap | null = null;
  /** Live map brush rectangle in canvas pixels while dragging. */
  private mapBrush: { x0: number; y0: number; x1: number; y1: number } | null = null;
  private mapBrushStart: { x: number; y: number } | null = null;
  /** Frame of the last paint, used to map brush pixels to lon/lat. */
  private lastFrame: Frame | null = null;
  /** Treemap tiles: label + value pairs (counts come from facets directly). */
  private treemapResult: { labels: string[]; values: number[] } | null = null;
  /** Top-terms payload: token frequencies plus shape detection. */
  private textResult: TextProfileMessage | null = null;
  private seriesLabels: string[] | null = null;
  private seriesMs = 0;
  private seriesCorrelation = Number.NaN;
  private boxResult: BoxStatsResult | null = null;
  private crossResult: CrossTabResult | null = null;
  private correlationResult: {
    labels: string[];
    values: Float64Array;
    counts: Uint32Array;
  } | null = null;
  private groupResult: GroupedBinsMessage | null = null;
  private bubbleResult: GridCountsResult | null = null;
  private animationResult: AnimationResult | null = null;
  private animationFrame = 0;
  private animationPlaying = false;
  private animationTimer: number | null = null;
  private animationSetupOpen = false;
  private readonly bubbleBinsInput: HTMLInputElement;
  private readonly bubbleAggSelect: HTMLSelectElement;
  private readonly bubbleScaleSelect: HTMLSelectElement;
  private readonly animateButton: HTMLButtonElement;
  private readonly widthButton: HTMLButtonElement;
  private readonly focusButton: HTMLButtonElement;
  private focusOverlay: HTMLElement | null = null;
  private readonly focusPlaceholder = document.createComment("chart-focus");
  private readonly animationSetup: HTMLElement;
  private readonly bubbleSettings: HTMLElement;
  private readonly bubbleTitle: HTMLElement;
  private readonly bubbleScaleField: HTMLElement;
  private readonly mapModeSelect: HTMLSelectElement;
  private readonly mapModeWrap: HTMLElement;
  private readonly resetViewButton: HTMLButtonElement;
  /** Map heat grid (count or measure per cell), computed by the worker. */
  private mapGrid: GridCountsResult | null = null;
  /** Map viewport in degrees (null = the whole world). */
  private mapView: { lonMin: number; lonMax: number; latMin: number; latMax: number } | null = null;
  /** Optional user-supplied regions (GeoJSON / zipped Shapefile). */
  private geoDataset: GeoDataset | null = null;
  private readonly mapLayerRow: HTMLElement;
  private readonly mapLayerInput: HTMLInputElement;
  private readonly mapLayerStatus: HTMLElement;
  private readonly geoFeatureSelect: HTMLSelectElement;
  private readonly geoMatchSelect: HTMLSelectElement;
  private readonly geoMeasureSelect: HTMLSelectElement;
  private readonly geoAggSelect: HTMLSelectElement;
  private readonly geoJoinRow: HTMLElement;
  private geoJoinValues = new Map<string, number>();
  private geoJoinMin = Number.NaN;
  private geoJoinMax = Number.NaN;
  private geoJoinRequest = 0;
  private mapDrag: { x: number; y: number } | null = null;
  /** True once a drag moved: the release click must not also fire a filter. */
  private dragMoved = false;
  /** Scatter/density viewport in data units (null = the full series bounds). */
  private plotView: { xMin: number; xMax: number; yMin: number; yMax: number } | null = null;
  private plotDrag: { x: number; y: number } | null = null;
  /** Line/histogram x-axis zoom in data units (null = the full range). */
  private chartXZoom: { min: number; max: number } | null = null;
  /** Bar chart category window: start index and count over the sorted bars. */
  private barWindow: { start: number; count: number } | null = null;
  /** Heatmap category windows on both axes. */
  private heatWindow: {
    xStart: number;
    xCount: number;
    yStart: number;
    yCount: number;
  } | null = null;
  /** Box plot category window and optional numeric Y window. */
  private boxWindow: { start: number; count: number } | null = null;
  private boxY: { min: number; max: number } | null = null;
  /** Correlation matrix row/column window. */
  private corrWindow: { start: number; count: number } | null = null;
  /** Treemap / top-terms item window. */
  private itemWindow: { start: number; count: number } | null = null;
  private readonly animationTimeSelect: HTMLSelectElement;
  private readonly animationGrainSelect: HTMLSelectElement;
  private readonly animationBar: HTMLElement;
  private readonly animationPlayButton: HTMLButtonElement;
  private readonly animationSlider: HTMLInputElement;
  private readonly animationSpeedSelect: HTMLSelectElement;
  private readonly animationFrameLabel: HTMLElement;
  private readonly animationLoopInput: HTMLInputElement;
  private readonly animationExportButton: HTMLButtonElement;
  private readonly hiddenGroups = new Set<number>();
  private statsMs = 0;

  private readonly kindSelect: HTMLSelectElement;
  private readonly sourceSelect: HTMLSelectElement;
  private readonly sourceWrap: HTMLElement;
  private sources: { id: string; name: string }[] = [];
  private viewResult: AggregateMessage | null = null;
  private readonly primarySelect: HTMLSelectElement;
  private readonly groupSelect: HTMLSelectElement;
  private readonly groupWrap: HTMLElement;
  private readonly valueSelect: HTMLSelectElement;
  private readonly valueWrap: HTMLElement;
  private readonly valueAggSelect: HTMLSelectElement;
  private readonly valueAggWrap: HTMLElement;
  private readonly valueGrainSelect: HTMLSelectElement;
  private readonly valueGrainWrap: HTMLElement;
  private readonly valueCalcSelect: HTMLSelectElement;
  private readonly valueCalcWrap: HTMLElement;
  private readonly filterColumnSelect: HTMLSelectElement;
  private readonly filterValueSelect: HTMLSelectElement;
  private readonly filterRespectInput: HTMLInputElement;
  private readonly chartFilterRow: HTMLElement;
  /** Aggregate result for the card's own value-over-time line. */
  private valueResult: AggregateMessage | null = null;
  private readonly xSelect: HTMLSelectElement;
  private readonly ySelect: HTMLSelectElement;
  private readonly colorSelect: HTMLSelectElement;
  private readonly sizeSelect: HTMLSelectElement;
  private readonly modeSelect: HTMLSelectElement;
  private readonly densityStyleSelect: HTMLSelectElement;
  private readonly kdeInput: HTMLInputElement;
  private readonly correlationSelect: HTMLSelectElement;
  private readonly primaryWrap: HTMLElement;
  private readonly axesPanel: HTMLElement;
  private readonly xWrap: HTMLElement;
  private readonly yWrap: HTMLElement;
  private readonly colorWrap: HTMLElement;
  private readonly sizeWrap: HTMLElement;
  private readonly sizeTagLabel: HTMLElement;
  private readonly primaryTagLabel: HTMLElement;
  private readonly bubbleAggField: HTMLElement;
  private readonly modeWrap: HTMLElement;
  private readonly densityStyleWrap: HTMLElement;
  private readonly xTagLabel: HTMLElement;
  private readonly yTagLabel: HTMLElement;
  private readonly colorGroup: HTMLElement;
  private readonly paletteGroup: HTMLElement;
  private readonly paletteSelect: HTMLSelectElement;
  private readonly palettePreview: HTMLElement;
  private readonly paletteReverseInput: HTMLInputElement;
  private readonly paletteStatus: HTMLElement;
  private readonly colorMinInput: HTMLInputElement;
  private readonly colorMaxInput: HTMLInputElement;
  private readonly colorDomainRow: HTMLElement;
  private readonly histogramSettings: HTMLElement;
  private readonly barSettings: HTMLElement;
  private readonly barStackField: HTMLElement;
  private readonly barStackInput: HTMLInputElement;
  private readonly correlationSettings: HTMLElement;
  private readonly topLabel: HTMLElement;
  private readonly minInput: HTMLInputElement;
  private readonly maxInput: HTMLInputElement;
  private readonly binsInput: HTMLInputElement;
  private readonly overflowInput: HTMLInputElement;
  private readonly topInput: HTMLInputElement;
  private readonly otherInput: HTMLInputElement;
  private readonly multiInput: HTMLInputElement;
  private readonly swatches: HTMLButtonElement[] = [];
  private readonly hexInput: HTMLInputElement;
  private readonly titleInput: HTMLInputElement;
  private readonly xTitleInput: HTMLInputElement;
  private readonly yTitleInput: HTMLInputElement;
  private readonly yUnitInput: HTMLInputElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly scopeEl: HTMLElement;
  private readonly noteEl: HTMLElement;
  private totalRowCount = 0;
  private readonly legendEl: HTMLElement;
  private readonly tooltipEl: HTMLElement;
  private readonly settingsBody: HTMLElement;
  private hitRegions: HitRegion[] = [];
  private pointerAt: { x: number; y: number; clientX: number; clientY: number } | null = null;
  private pointerFrame: number | null = null;

  private readonly onResize = (): void => this.scheduleRender();
  private readonly onThemeChange = (): void => this.scheduleRender(true);
  private renderQueued = false;
  private renderForce = false;
  /** True while the frame only shows an empty-state message, so no axes. */
  private plotMessageDrawn = false;
  /** Wrap width of the last paint, used to ignore no-op resize callbacks. */
  private lastWrapWidth = -1;
  private resizeObserver: ResizeObserver | null = null;

  constructor(
    root: HTMLElement,
    private readonly options: ChartCardOptions,
    preset?: Partial<ChartCardConfig>,
  ) {
    this.root = root;
    this.root.classList.add("chart-card");
    this.config = { ...defaultConfig(), ...preset };

    const head = el("div", { class: "chart-card-head" });
    const removeButton = el(
      "button",
      {
        class: "chart-remove",
        type: "button",
        title: "Remove this chart…",
        "aria-label": "Remove this chart",
      },
      ["×"],
    ) as HTMLButtonElement;
    removeButton.addEventListener("click", (event) => {
      event.stopPropagation();
      this.confirmRemove();
    });
    head.append(removeButton);
    // Source selector: the filtered table or a saved aggregate view. A card
    // bound to a view reads that view's result; there is no raw-row path.
    const sourceWrap = el("label", { class: "chart-field chart-source-field" });
    sourceWrap.append(el("span", { class: "chart-field-label" }, ["Source"]));
    this.sourceSelect = this.buildSelect("chart-picker chart-picker-small chart-source", "Data source");
    this.renderSourceOptions();
    this.sourceSelect.addEventListener("change", () => {
      this.config.source = this.sourceSelect.value;
      this.generation++;
      this.viewResult = null;
      this.syncSourceControls();
      if (this.config.source !== "") this.refreshView();
      else this.refreshValue();
      this.render();
    });
    sourceWrap.append(this.sourceSelect);
    this.sourceWrap = sourceWrap;

    this.kindSelect = el("select", {
      class: "chart-kind",
      "aria-label": "Chart type",
    }) as HTMLSelectElement;
    (Object.keys(CHART_KIND_LABELS) as ChartCardKind[]).forEach((kind) => {
      this.kindSelect.append(
        el("option", { value: kind }, [CHART_KIND_LABELS[kind]]) as HTMLOptionElement,
      );
    });
    this.kindSelect.addEventListener("change", () =>
      this.setKind(this.kindSelect.value as ChartCardKind),
    );

    this.primarySelect = this.buildSelect("chart-picker", "Chart column");
    this.primarySelect.addEventListener("change", () =>
      this.setPrimaryColumn(Number(this.primarySelect.value)),
    );
    const primaryTag = this.tagged("Column", this.primarySelect);
    this.primaryWrap = primaryTag.wrap;
    this.primaryTagLabel = primaryTag.label;

    this.groupSelect = this.buildSelect(
      "chart-picker chart-picker-small",
      "Group by",
    );
    this.groupSelect.addEventListener("change", () => {
      this.config.groupColumn = Number(this.groupSelect.value);
      this.hiddenGroups.clear();
      this.generation++;
      this.refreshGroupedBins();
      this.refreshBubble();
      this.refreshAnimation();
      this.refreshValue();
      this.renderControls();
      this.render();
    });
    this.groupWrap = this.tagged("Group", this.groupSelect).wrap;

    this.valueSelect = this.buildSelect("chart-picker chart-picker-small", "Value column");
    this.valueSelect.addEventListener("change", () => {
      this.config.valueColumn = Number(this.valueSelect.value);
      // A value line and a grouped count line are two different charts, so the
      // value choice clears the group where both cannot coexist. Lines and bars
      // keep the group: that combination is the split-by series chart.
      if (
        (this.config.valueColumn ?? -1) >= 0 &&
        this.config.kind !== "line" &&
        this.config.kind !== "bar"
      ) {
        this.config.groupColumn = -1;
      }
      this.generation++;
      this.syncOptions();
      this.renderControls();
      this.refreshValue();
      this.render();
    });
    this.valueWrap = this.tagged("Value", this.valueSelect).wrap;

    this.valueAggSelect = this.buildSelect("chart-picker chart-picker-small", "Aggregation");
    (
      [
        ["mean", "Mean"],
        ["sum", "Sum"],
        ["median", "Median"],
        ["min", "Min"],
        ["max", "Max"],
        ["count", "Count non-null"],
        ["distinct", "Count distinct"],
      ] as const
    ).forEach(([value, label]) => {
      this.valueAggSelect.append(el("option", { value }, [label]) as HTMLOptionElement);
    });
    this.valueAggSelect.addEventListener("change", () => {
      this.config.valueAgg = this.valueAggSelect.value as ChartCardConfig["valueAgg"];
      this.generation++;
      this.refreshValue();
      this.render();
    });
    this.valueAggWrap = this.tagged("Agg", this.valueAggSelect).wrap;

    this.valueGrainSelect = this.buildSelect("chart-picker chart-picker-small", "Bucket");
    (["auto", "minute", "hour", "day", "week", "month", "quarter", "year"] as const).forEach(
      (grain) => {
        const label = grain === "auto" ? "Auto" : grain.charAt(0).toUpperCase() + grain.slice(1);
        this.valueGrainSelect.append(el("option", { value: grain }, [label]) as HTMLOptionElement);
      },
    );
    this.valueGrainSelect.addEventListener("change", () => {
      this.config.valueGrain = this.valueGrainSelect.value as ChartCardConfig["valueGrain"];
      this.generation++;
      this.refreshValue();
      this.render();
    });
    this.valueGrainWrap = this.tagged("Bucket", this.valueGrainSelect).wrap;

    this.valueCalcSelect = this.buildSelect(
      "chart-picker chart-picker-small",
      "Chart calculation",
    );
    (
      [
        ["", "None"],
        ["rolling7", "Rolling mean (7)"],
        ["cumulative", "Cumulative"],
        ["diff", "Difference"],
        ["pctChange", "% change"],
        ["pctTotal", "% of total"],
        ["rank", "Rank"],
        ["yoy", "Year-over-year %"],
      ] as const
    ).forEach(([value, label]) => {
      this.valueCalcSelect.append(el("option", { value }, [label]) as HTMLOptionElement);
    });
    this.valueCalcSelect.addEventListener("change", () => {
      this.config.valueCalc =
        (this.valueCalcSelect.value as ChartCardConfig["valueCalc"]) || undefined;
      this.generation++;
      this.refreshValue();
      this.syncScope();
      this.render();
    });
    this.valueCalcWrap = this.tagged("Calc", this.valueCalcSelect).wrap;

    this.filterColumnSelect = this.buildSelect(
      "chart-picker chart-picker-small",
      "Chart filter column",
    );
    this.filterValueSelect = this.buildSelect(
      "chart-picker chart-picker-small",
      "Chart filter value",
    );
    this.filterColumnSelect.addEventListener("change", () => {
      this.config.filterColumn = Number(this.filterColumnSelect.value);
      this.config.filterCode = -1;
      this.generation++;
      this.syncChartFilterControls();
      this.syncScope();
      this.refreshValue();
      this.refreshTreemap();
      this.refreshGeoJoin();
      this.refreshSeries();
      this.refreshCrosstab();
      this.refreshCorrelation();
      this.render();
    });
    this.filterValueSelect.addEventListener("change", () => {
      this.config.filterCode = Number(this.filterValueSelect.value);
      this.generation++;
      this.syncScope();
      this.refreshValue();
      this.refreshTreemap();
      this.refreshGeoJoin();
      this.refreshSeries();
      this.refreshCrosstab();
      this.refreshCorrelation();
      this.render();
    });
    this.filterRespectInput = el("input", { type: "checkbox" }) as HTMLInputElement;
    this.filterRespectInput.checked = true;
    const filterRespectField = el("label", { class: "control check clean-check chart-check" });
    filterRespectField.title = "Include the current table filters in this chart";
    filterRespectField.append(this.filterRespectInput, "Also respect table filters");
    this.filterRespectInput.addEventListener("change", () => {
      this.config.respectFilters = this.filterRespectInput.checked;
      this.generation++;
      this.syncScope();
      this.refreshValue();
      this.refreshTreemap();
      this.refreshGeoJoin();
      this.refreshSeries();
      this.refreshCrosstab();
      this.refreshCorrelation();
      this.render();
    });
    this.chartFilterRow = el("div", { class: "chart-settings" }, [
      el("span", { class: "chart-field-label" }, ["Chart filter"]),
      this.filterColumnSelect,
      this.filterValueSelect,
      filterRespectField,
    ]);

    this.xSelect = this.buildSelect("chart-picker", "X column");
    this.xSelect.addEventListener("change", () => {
      this.config.x = Number(this.xSelect.value);
      this.plotView = null;
      this.mapView = null;
      this.chartXZoom = null;
      this.barWindow = null;
      this.generation++;
      this.refreshSeries();
      this.refreshBox();
      this.refreshCrosstab();
      this.refreshBubble();
      this.refreshMapGrid();
      this.refreshAnimation();
      this.render();
    });
    const xTag = this.tagged("X", this.xSelect);
    this.xWrap = xTag.wrap;
    this.xTagLabel = xTag.label;

    this.ySelect = this.buildSelect("chart-picker", "Y column");
    this.ySelect.addEventListener("change", () => {
      this.config.y = Number(this.ySelect.value);
      this.plotView = null;
      this.mapView = null;
      this.chartXZoom = null;
      this.barWindow = null;
      this.generation++;
      this.refreshSeries();
      this.refreshBox();
      this.refreshCrosstab();
      this.refreshBubble();
      this.refreshMapGrid();
      this.refreshAnimation();
      this.render();
    });
    const yTag = this.tagged("Y", this.ySelect);
    this.yWrap = yTag.wrap;
    this.yTagLabel = yTag.label;

    this.colorSelect = this.buildSelect("chart-picker chart-picker-small", "Colour column");
    this.colorSelect.addEventListener("change", () => {
      this.config.colorColumn = Number(this.colorSelect.value);
      this.generation++;
      this.refreshSeries();
      this.render();
    });
    this.colorWrap = this.tagged("Colour", this.colorSelect).wrap;

    this.sizeSelect = this.buildSelect("chart-picker chart-picker-small", "Size column");
    this.sizeSelect.addEventListener("change", () => {
      this.config.sizeColumn = Number(this.sizeSelect.value);
      // Picking a column for a bubble or heat map means "measure by this
      // column": switch the measure away from count so the choice takes
      // effect immediately, and back to count when the column is cleared.
      if (this.config.kind === "bubble" || (this.config.kind === "map" && this.config.mapMode === "heat")) {
        if (this.config.sizeColumn < 0) {
          this.config.bubbleAgg = "count";
          this.bubbleAggSelect.value = "count";
        } else if ((this.config.bubbleAgg ?? "count") === "count") {
          this.config.bubbleAgg = "sum";
          this.bubbleAggSelect.value = "sum";
        }
      }
      this.generation++;
      this.refreshSeries();
      this.refreshTreemap();
      this.refreshBubble();
      this.refreshMapGrid();
      this.refreshAnimation();
      this.renderControls();
      this.render();
    });
    const sizeTag = this.tagged("Size", this.sizeSelect);
    this.sizeWrap = sizeTag.wrap;
    this.sizeTagLabel = sizeTag.label;

    this.modeSelect = this.buildSelect("chart-picker chart-picker-small", "Render mode");
    ([
      ["auto", "Auto"],
      ["points", "Points"],
      ["density", "Density"],
    ] as const).forEach(([value, label]) => {
      this.modeSelect.append(el("option", { value }, [label]) as HTMLOptionElement);
    });
    this.modeSelect.addEventListener("change", () => {
      this.config.mode = this.modeSelect.value as SeriesMode;
      this.generation++;
      this.refreshSeries();
      this.render();
    });
    this.modeWrap = this.tagged("Render", this.modeSelect).wrap;

    this.densityStyleSelect = this.buildSelect("chart-picker chart-picker-small", "Density style");
    (
      [
        ["heat", "Heat"],
        ["contours", "Contours"],
        ["both", "Heat + lines"],
      ] as const
    ).forEach(([value, label]) => {
      this.densityStyleSelect.append(el("option", { value }, [label]) as HTMLOptionElement);
    });
    this.densityStyleSelect.addEventListener("change", () => {
      this.config.densityStyle = this.densityStyleSelect.value as DensityStyle;
      this.render();
    });
    this.densityStyleWrap = this.tagged("Style", this.densityStyleSelect).wrap;

    const more = el(
      "button",
      {
        class: "icon-btn chart-more",
        type: "button",
        title: "More actions",
        "aria-label": "Chart actions",
      },
      ["⋯"],
    ) as HTMLButtonElement;
    more.addEventListener("click", () => this.openCardMenu(more));

    // Axis controls live in their own bordered group so they read as "what is
    // plotted" rather than another settings row.
    this.axesPanel = el("div", { class: "chart-axes" }, [
      el("span", { class: "chart-axes-label" }, ["Axes"]),
      this.primaryWrap,
      this.xWrap,
      this.yWrap,
    ]);
    this.widthButton = el(
      "button",
      { class: "ghost small chart-width-btn", type: "button" },
      [],
    ) as HTMLButtonElement;
    this.widthButton.append(widthIcon(), el("span", {}, ["Wide"]));
    this.widthButton.addEventListener("click", () => this.toggleSpan());
    this.focusButton = el(
      "button",
      {
        class: "ghost small chart-focus-btn",
        type: "button",
        title: "Expand this chart for a closer look (Esc to close)",
      },
      [],
    ) as HTMLButtonElement;
    this.focusButton.append(focusIcon(), el("span", {}, ["Focus"]));
    this.focusButton.addEventListener("click", () => this.toggleFocus());
    this.animateButton = el(
      "button",
      {
        class: "ghost small chart-animate-btn",
        type: "button",
        title: "Step this chart through time",
      },
      [],
    ) as HTMLButtonElement;
    this.animateButton.append(movieIcon(), el("span", {}, ["Animate"]));
    this.animateButton.addEventListener("click", () => this.toggleAnimationSetup());

    head.append(
      this.sourceWrap,
      this.kindSelect,
      this.groupWrap,
      this.valueWrap,
      this.valueAggWrap,
      this.valueGrainWrap,
      this.valueCalcWrap,
      this.axesPanel,
      el("span", { class: "grow" }),
      this.focusButton,
      this.widthButton,
      this.animateButton,
      more,
    );

    const field = (label: string, input: HTMLElement): HTMLElement => {
      const wrap = el("label", { class: "chart-field" });
      wrap.append(el("span", { class: "chart-field-label" }, [label]), input);
      return wrap;
    };
    this.minInput = el("input", {
      class: "chart-number chart-number-wide",
      type: "text",
      inputmode: "decimal",
      spellcheck: "false",
    }) as HTMLInputElement;
    this.maxInput = el("input", {
      class: "chart-number chart-number-wide",
      type: "text",
      inputmode: "decimal",
      spellcheck: "false",
    }) as HTMLInputElement;
    this.binsInput = el("input", {
      class: "chart-number",
      type: "number",
      min: "1",
      max: "256",
      step: "1",
      title: "Number of bins (1–256)",
      spellcheck: "false",
    }) as HTMLInputElement;
    this.overflowInput = el("input", { type: "checkbox" }) as HTMLInputElement;
    const overflowField = el("label", { class: "control check clean-check chart-check" });
    overflowField.title = "Aggregate everything above the last bin into one bar";
    overflowField.append(this.overflowInput, "“> Max” bar");
    const fullRange = el(
      "button",
      { class: "ghost small", type: "button", title: "Reset Start/End to the data's full range" },
      ["Full range"],
    );
    fullRange.addEventListener("click", () => this.resetBinRange());
    this.kdeInput = el("input", { type: "checkbox" }) as HTMLInputElement;
    this.kdeInput.checked = this.config.kde;
    const kdeField = el("label", { class: "control check clean-check chart-check" });
    kdeField.title = "Overlay a smooth kernel density curve on the histogram";
    kdeField.append(this.kdeInput, "KDE curve");
    this.kdeInput.addEventListener("change", () => {
      this.config.kde = this.kdeInput.checked;
      this.render();
    });
    this.histogramSettings = el("div", { class: "chart-settings" }, [
      field("Start", this.minInput),
      field("End", this.maxInput),
      field("Bins", this.binsInput),
      overflowField,
      kdeField,
      fullRange,
    ]);
    const onBinChange = (): void => this.commitBinOptions();
    this.minInput.addEventListener("change", onBinChange);
    this.maxInput.addEventListener("change", onBinChange);
    this.binsInput.addEventListener("change", onBinChange);
    this.overflowInput.addEventListener("change", onBinChange);

    this.topInput = el("input", {
      class: "chart-number",
      type: "number",
      min: "1",
      max: "50",
      step: "1",
      value: String(this.config.topN),
      title: "How many bars before the rest is grouped as Other",
      spellcheck: "false",
      "aria-label": "Number of category bars",
    }) as HTMLInputElement;
    this.topInput.addEventListener("change", () => {
      const value = Math.floor(Number(this.topInput.value));
      this.config.topN = Number.isFinite(value) ? Math.max(1, Math.min(50, value)) : 5;
      this.topInput.value = String(this.config.topN);
      this.barWindow = null;
      this.generation++;
      this.refreshBox();
      this.refreshCrosstab();
      this.refreshBubble();
      this.refreshAnimation();
      this.render();
    });
    this.otherInput = el("input", { type: "checkbox" }) as HTMLInputElement;
    this.otherInput.checked = this.config.groupOther;
    const otherField = el("label", { class: "control check clean-check chart-check" });
    otherField.append(this.otherInput, "Group rest as Other");
    this.otherInput.addEventListener("change", () => {
      this.config.groupOther = this.otherInput.checked;
      this.generation++;
      this.refreshBox();
      this.refreshCrosstab();
      this.refreshBubble();
      this.refreshAnimation();
      this.render();
    });
    this.multiInput = el("input", { type: "checkbox" }) as HTMLInputElement;
    this.multiInput.checked = this.config.multiColor;
    const multiField = el("label", { class: "control check clean-check chart-check" });
    multiField.title = "Give every bar its own colour from the palette";
    multiField.append(this.multiInput, "Colour each bar");
    this.multiInput.addEventListener("change", () => {
      this.config.multiColor = this.multiInput.checked;
      this.render();
    });
    const topField = el("label", { class: "chart-field" });
    this.topLabel = el("span", { class: "chart-field-label" }, ["Top bars"]);
    topField.append(this.topLabel, this.topInput);
    this.bubbleBinsInput = el("input", {
      class: "chart-number",
      type: "number",
      min: "4",
      max: "120",
      step: "1",
      title: "Bubble grid resolution per axis (4–120)",
      spellcheck: "false",
    }) as HTMLInputElement;
    this.bubbleBinsInput.value = String(this.config.bubbleBins ?? 40);
    const bubbleBinsChange = (): void => {
      const value = Math.round(Number(this.bubbleBinsInput.value));
      if (Number.isFinite(value) && value >= 4 && value <= 120) {
        this.config.bubbleBins = value;
        this.generation++;
        this.refreshBubble();
        this.refreshMapGrid();
        this.refreshAnimation();
        this.render();
      }
    };
    this.bubbleBinsInput.addEventListener("change", bubbleBinsChange);
    const bubbleField = el("label", { class: "chart-field" });
    bubbleField.title = "How many cells each axis is divided into before counting rows";
    bubbleField.append(
      el("span", { class: "chart-field-label" }, ["Grid"]),
      this.bubbleBinsInput,
    );
    this.bubbleAggSelect = el("select", {
      class: "chart-picker chart-picker-small",
      "aria-label": "Bubble size measure",
      title: "What the bubble area represents: rows per cell or an aggregate of a numeric column",
    }) as HTMLSelectElement;
    for (const [value, label] of [
      ["count", "Count (rows)"],
      ["sum", "Sum"],
      ["mean", "Mean"],
      ["min", "Min"],
      ["max", "Max"],
    ] as const) {
      this.bubbleAggSelect.append(el("option", { value }, [label]) as HTMLOptionElement);
    }
    this.bubbleAggSelect.value = this.config.bubbleAgg ?? "count";
    this.bubbleAggSelect.addEventListener("change", () => {
      this.config.bubbleAgg = this.bubbleAggSelect.value as
        | "count"
        | "sum"
        | "mean"
        | "min"
        | "max";
      this.generation++;
      this.refreshBubble();
      this.refreshMapGrid();
      this.refreshAnimation();
      this.render();
    });
    const bubbleAggField = el("label", { class: "chart-field" });
    this.bubbleAggField = bubbleAggField;
    bubbleAggField.title = "How the rows in each area combine into one value";
    bubbleAggField.append(
      el("span", { class: "chart-field-label" }, ["Reduce"]),
      this.bubbleAggSelect,
    );
    this.bubbleScaleSelect = el("select", {
      class: "chart-picker chart-picker-small",
      "aria-label": "Bubble size scale",
      title: "How the measure maps to bubble radius — area is the honest default",
    }) as HTMLSelectElement;
    for (const [value, label] of [
      ["area", "Area ∝ value"],
      ["radius", "Radius ∝ value"],
      ["log", "Log scale"],
    ] as const) {
      this.bubbleScaleSelect.append(el("option", { value }, [label]) as HTMLOptionElement);
    }
    this.bubbleScaleSelect.value = this.config.bubbleScale ?? "area";
    this.bubbleScaleSelect.addEventListener("change", () => {
      this.config.bubbleScale = this.bubbleScaleSelect.value as "area" | "radius" | "log";
      this.render();
    });
    const bubbleScaleField = el("label", { class: "chart-field" });
    bubbleScaleField.title = "How values become radius: area keeps sizes proportional, log compresses extremes";
    bubbleScaleField.append(
      el("span", { class: "chart-field-label" }, ["Mapping"]),
      this.bubbleScaleSelect,
    );
    this.barStackInput = el("input", { type: "checkbox" }) as HTMLInputElement;
    this.barStackInput.checked = (this.config.barLayout ?? "group") === "stack";
    this.barStackField = el("label", { class: "control check clean-check chart-check" });
    this.barStackField.title = "Stack grouped barplot values instead of placing them side by side";
    this.barStackField.append(this.barStackInput, "Stack groups");
    this.barStackInput.addEventListener("change", () => {
      this.config.barLayout = this.barStackInput.checked ? "stack" : "group";
      this.render();
    });
    this.barSettings = el("div", { class: "chart-settings" }, [
      topField,
      otherField,
      multiField,
      this.barStackField,
    ]);
    // Bubble options sit in their own visible row, not inside Settings: the
    // size measure is the whole point of a bubble chart. Map cards reuse the
    // same row for display mode, grid resolution and the heat/size measure.
    this.bubbleTitle = el("span", { class: "chart-animate-title" }, ["Bubbles"]);
    this.mapModeSelect = this.buildSelect("chart-picker chart-picker-small", "Map display mode");
    for (const [value, label] of [
      ["points", "One dot per row"],
      ["heat", "Heat grid"],
    ] as const) {
      this.mapModeSelect.append(el("option", { value }, [label]) as HTMLOptionElement);
    }
    this.mapModeSelect.value = this.config.mapMode ?? "points";
    this.mapModeSelect.addEventListener("change", () => {
      this.config.mapMode = this.mapModeSelect.value as "points" | "heat";
      this.generation++;
      this.refreshMapGrid();
      this.syncSourceControls();
      this.render();
    });
    this.mapModeWrap = this.tagged("Show", this.mapModeSelect).wrap;
    this.mapLayerInput = el("input", {
      type: "file",
      accept: ".geojson,.json,.zip",
      class: "hidden",
    }) as HTMLInputElement;
    const loadMapLayer = el(
      "button",
      {
        class: "ghost small",
        type: "button",
        title: "Load custom regions from GeoJSON or a zipped Shapefile",
      },
      ["Load regions"],
    ) as HTMLButtonElement;
    loadMapLayer.addEventListener("click", () => this.mapLayerInput.click());
    this.mapLayerInput.addEventListener("change", () => {
      const file = this.mapLayerInput.files?.[0];
      if (file === undefined) return;
      this.mapLayerStatus.textContent = "Loading regions...";
      void file
        .arrayBuffer()
        .then((buffer) => parseGeoFile(buffer, file.name))
        .then((dataset) => {
          this.geoDataset = dataset;
          this.mapView = { ...dataset.bounds };
          this.mapLayerStatus.textContent = `${dataset.features.length.toLocaleString()} regions`;
          this.syncGeoJoinControls();
          this.refreshGeoJoin();
          this.render();
        })
        .catch((error: unknown) => {
          this.mapLayerStatus.textContent =
            error instanceof Error ? error.message : "Could not load regions.";
        });
      this.mapLayerInput.value = "";
    });
    const clearMapLayer = el(
      "button",
      { class: "ghost small", type: "button", title: "Return to the world basemap" },
      ["Clear regions"],
    ) as HTMLButtonElement;
    clearMapLayer.addEventListener("click", () => {
      this.geoDataset = null;
      this.mapView = null;
      this.geoJoinValues.clear();
      this.geoJoinMin = Number.NaN;
      this.geoJoinMax = Number.NaN;
      this.geoJoinRequest++;
      this.mapLayerStatus.textContent = "";
      this.syncGeoJoinControls();
      this.render();
    });
    this.mapLayerStatus = el("span", { class: "chart-palette-status" });
    this.mapLayerRow = el("div", { class: "chart-settings hidden" }, [
      el("span", { class: "chart-field-label" }, ["Regions"]),
      loadMapLayer,
      clearMapLayer,
      this.mapLayerInput,
      this.mapLayerStatus,
    ]);
    this.geoFeatureSelect = this.buildSelect(
      "chart-picker chart-picker-small",
      "Region feature property",
    );
    this.geoMatchSelect = this.buildSelect(
      "chart-picker chart-picker-small",
      "Region dataset column",
    );
    this.geoMeasureSelect = this.buildSelect(
      "chart-picker chart-picker-small",
      "Region measure",
    );
    this.geoAggSelect = this.buildSelect(
      "chart-picker chart-picker-small",
      "Region aggregation",
    );
    for (const [value, label] of [
      ["count", "Count"],
      ["sum", "Sum"],
      ["mean", "Mean"],
      ["median", "Median"],
      ["min", "Min"],
      ["max", "Max"],
    ] as const) {
      this.geoAggSelect.append(el("option", { value }, [label]) as HTMLOptionElement);
    }
    const geoField = (label: string, select: HTMLSelectElement): HTMLElement =>
      el("label", { class: "chart-tag" }, [
        el("span", { class: "chart-tag-label" }, [label]),
        select,
      ]);
    this.geoJoinRow = el("div", { class: "chart-settings hidden" }, [
      el("span", { class: "chart-field-label" }, ["Colour regions"]),
      geoField("Feature", this.geoFeatureSelect),
      geoField("Matches", this.geoMatchSelect),
      geoField("Measure", this.geoMeasureSelect),
      geoField("Reduce", this.geoAggSelect),
    ]);
    for (const select of [
      this.geoFeatureSelect,
      this.geoMatchSelect,
      this.geoMeasureSelect,
      this.geoAggSelect,
    ]) {
      select.addEventListener("change", () => {
        this.refreshGeoJoin();
        this.render();
      });
    }
    this.bubbleScaleField = bubbleScaleField;
    this.bubbleSettings = el("div", { class: "chart-bubble-settings hidden" }, [
      this.bubbleTitle,
      this.mapLayerRow,
      this.geoJoinRow,
      this.mapModeWrap,
      bubbleField,
      bubbleAggField,
      bubbleScaleField,
    ]);

    this.correlationSelect = el("select", {
      class: "chart-multiselect",
      multiple: "multiple",
      size: "5",
      "aria-label": "Correlation columns",
      title: "Numeric columns included in the matrix",
    }) as HTMLSelectElement;
    this.correlationSelect.addEventListener("change", () => {
      this.config.correlationColumns = [...this.correlationSelect.options]
        .filter((option) => option.selected)
        .map((option) => Number(option.value));
      this.generation++;
      this.refreshCorrelation();
      this.render();
    });
    this.correlationSettings = el("div", { class: "chart-settings" }, [
      el("span", { class: "chart-field-label" }, ["Columns"]),
      this.correlationSelect,
    ]);

    this.colorGroup = el("div", { class: "chart-colors" });
    CHART_COLORS.forEach((color) => {
      const swatch = el("button", {
        class: "chart-swatch",
        type: "button",
        title: color,
        "aria-label": `Use colour ${color}`,
      }) as HTMLButtonElement;
      swatch.style.background = color;
      swatch.addEventListener("click", () => {
        this.config.color = color;
        this.config.colorCustom = true;
        this.hexInput.value = this.primaryColor();
        this.syncSwatches();
        this.render();
      });
      this.swatches.push(swatch);
      this.colorGroup.append(swatch);
    });
    this.hexInput = el("input", {
      class: "chart-hex",
      type: "text",
      placeholder: "#2563eb",
      spellcheck: "false",
      "aria-label": "Custom colour as a hex code",
    }) as HTMLInputElement;
    this.hexInput.value = this.primaryColor();
    const applyHex = (): void => {
      const value = this.hexInput.value.trim();
      if (!HEX.test(value)) {
        this.hexInput.value = this.primaryColor();
        return;
      }
      this.config.color = value.startsWith("#") ? value.toLowerCase() : `#${value.toLowerCase()}`;
      this.config.colorCustom = true;
      this.hexInput.value = this.primaryColor();
      this.syncSwatches();
      this.render();
    };
    this.hexInput.addEventListener("change", applyHex);
    this.hexInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        applyHex();
      }
    });
    this.colorGroup.append(this.hexInput);

    this.paletteSelect = el("select", {
      class: "chart-picker chart-picker-small chart-palette-select",
      "aria-label": "Colour map",
      title: "Colour map for multi-series and multi-category charts",
    }) as HTMLSelectElement;
    const addPaletteOptions = (
      label: string,
      kind: "qualitative" | "sequential" | "diverging",
    ): void => {
      const entries = PALETTES.filter((palette) => palette.kind === kind);
      if (entries.length === 0) return;
      const group = el("optgroup", { label }) as HTMLOptGroupElement;
      for (const palette of entries) {
        group.append(
          el("option", { value: palette.name }, [palette.name]) as HTMLOptionElement,
        );
      }
      this.paletteSelect.append(group);
    };
    addPaletteOptions("Qualitative", "qualitative");
    addPaletteOptions("Sequential", "sequential");
    addPaletteOptions("Diverging", "diverging");
    this.paletteSelect.append(
      el("option", { value: CUSTOM_PALETTE }, ["Custom…"]) as HTMLOptionElement,
    );
    this.paletteSelect.value = this.config.palette ?? DEFAULT_PALETTE;
    this.paletteSelect.addEventListener("change", () => {
      void this.applyPalette(this.paletteSelect.value);
    });

    this.palettePreview = el("div", { class: "chart-palette-preview" });
    this.paletteReverseInput = el("input", {
      type: "checkbox",
      "aria-label": "Reverse the colour map",
    }) as HTMLInputElement;
    this.paletteReverseInput.checked = this.config.paletteReversed === true;
    this.paletteReverseInput.addEventListener("change", () => {
      this.config.paletteReversed = this.paletteReverseInput.checked;
      this.hexInput.value = this.primaryColor();
      this.syncSwatches();
      this.syncPalette();
      this.render();
    });
    const reverseLabel = el("label", { class: "control check clean-check chart-check" }, [
      this.paletteReverseInput,
      "Reverse",
    ]);
    reverseLabel.title = "Flip the colour map direction (works for ramps and series order)";
    this.colorMinInput = el("input", {
      class: "text-input chart-color-bound",
      type: "number",
      step: "any",
      placeholder: "Auto",
      "aria-label": "Colour scale minimum",
    }) as HTMLInputElement;
    this.colorMaxInput = el("input", {
      class: "text-input chart-color-bound",
      type: "number",
      step: "any",
      placeholder: "Auto",
      "aria-label": "Colour scale maximum",
    }) as HTMLInputElement;
    const applyColorDomain = (): void => {
      const min =
        this.colorMinInput.value.trim() === ""
          ? null
          : parseChartNumber(this.colorMinInput.value);
      const max =
        this.colorMaxInput.value.trim() === ""
          ? null
          : parseChartNumber(this.colorMaxInput.value);
      if (min !== null && max !== null && !(max > min)) {
        this.paletteStatus.textContent = "Colour max must be greater than min";
        return;
      }
      this.config.colorMin = min;
      this.config.colorMax = max;
      this.paletteStatus.textContent = "";
      this.render();
    };
    this.colorMinInput.addEventListener("change", applyColorDomain);
    this.colorMaxInput.addEventListener("change", applyColorDomain);
    this.colorDomainRow = el("div", { class: "chart-color-domain" }, [
      el("label", { class: "chart-tag" }, [
        el("span", { class: "chart-tag-label" }, ["Min"]),
        this.colorMinInput,
      ]),
      el("label", { class: "chart-tag" }, [
        el("span", { class: "chart-tag-label" }, ["Max"]),
        this.colorMaxInput,
      ]),
    ]);
    const paletteFile = el("input", {
      type: "file",
      accept: ".json,application/json",
      class: "hidden",
    }) as HTMLInputElement;
    const loadPalette = el(
      "button",
      {
        class: "ghost small",
        type: "button",
        title: "Load a palette from a JSON file (an array of hex colours, or {colors: [...]})",
      },
      ["Load JSON…"],
    ) as HTMLButtonElement;
    loadPalette.addEventListener("click", () => paletteFile.click());
    paletteFile.addEventListener("change", () => {
      const file = paletteFile.files?.[0];
      if (file === undefined) return;
      void file
        .text()
        .then((text) => this.importPaletteJson(text))
        .catch(() => {
          this.paletteStatus.textContent = "Could not read that file";
        });
      paletteFile.value = "";
    });
    this.paletteStatus = el("span", { class: "chart-palette-status" });
    this.paletteGroup = el(
      "div",
      { class: "chart-palette" },
      [
        this.paletteSelect,
        this.palettePreview,
        reverseLabel,
        this.colorDomainRow,
        loadPalette,
        paletteFile,
        this.paletteStatus,
      ],
    );
    this.syncPalette();

    this.titleInput = el("input", {
      class: "text-input chart-title",
      type: "text",
      placeholder: "Chart title (optional)",
      spellcheck: "false",
      "aria-label": "Chart title",
    }) as HTMLInputElement;
    this.titleInput.value = this.config.title;
    this.titleInput.addEventListener("input", () => {
      this.config.title = this.titleInput.value;
      this.render();
    });
    const axisTitleInput = (
      label: string,
      get: () => string | undefined,
      set: (value: string) => void,
    ): HTMLInputElement => {
      const input = el("input", {
        class: "text-input chart-axis-title",
        type: "text",
        placeholder: label,
        spellcheck: "false",
        "aria-label": label,
        title: label,
      }) as HTMLInputElement;
      input.value = get() ?? "";
      input.addEventListener("input", () => {
        set(input.value.trim());
        this.render();
      });
      return input;
    };
    this.xTitleInput = axisTitleInput(
      "X axis title (auto)",
      () => this.config.xTitle,
      (value) => {
        this.config.xTitle = value;
      },
    );
    this.yTitleInput = axisTitleInput(
      "Y axis title (auto)",
      () => this.config.yTitle,
      (value) => {
        this.config.yTitle = value;
      },
    );
    this.yUnitInput = axisTitleInput(
      "Unit, e.g. kWh",
      () => this.config.yUnit,
      (value) => {
        this.config.yUnit = value;
      },
    );
    const lookRow = el("div", { class: "chart-card-look" }, [
      this.colorGroup,
      this.paletteGroup,
      this.titleInput,
      this.xTitleInput,
      this.yTitleInput,
      this.yUnitInput,
    ]);

    // Frames over time: step and loop a bar or bubble chart, export one loop.
    this.animationTimeSelect = el("select", {
      class: "chart-picker chart-picker-small",
      "aria-label": "Animate over time",
      title: "Step this chart through a date column, one frame per period",
    }) as HTMLSelectElement;
    this.animationTimeSelect.addEventListener("change", () => {
      const value = Number(this.animationTimeSelect.value);
      this.config.animationTimeColumn = Number.isFinite(value) ? value : -1;
      if ((this.config.animationTimeColumn ?? -1) >= 0) {
        this.config.animationGrain = this.defaultGrainFor(this.config.animationTimeColumn ?? -1);
        this.animationGrainSelect.value = this.config.animationGrain;
      }
      this.stopAnimation();
      this.generation++;
      this.refreshAnimation();
      this.render();
    });
    this.animationGrainSelect = el("select", {
      class: "chart-picker chart-picker-small",
      "aria-label": "Frame length",
      title: "How much time each frame covers",
    }) as HTMLSelectElement;
    (["hour", "day", "week", "month", "quarter", "year"] as TimeGrain[]).forEach((grain) => {
      this.animationGrainSelect.append(
        el("option", { value: grain }, [grain.charAt(0).toUpperCase() + grain.slice(1)]) as HTMLOptionElement,
      );
    });
    this.animationGrainSelect.value = this.config.animationGrain ?? "day";
    this.animationGrainSelect.addEventListener("change", () => {
      this.config.animationGrain = this.animationGrainSelect.value as TimeGrain;
      this.stopAnimation();
      this.generation++;
      this.refreshAnimation();
      this.render();
    });
    // Animation setup lives in its own visible row (not in Settings): the
    // Animate button in the toolbar expands it.
    this.animationSetup = el("div", { class: "chart-animate-setup hidden" }, [
      el("span", { class: "chart-animate-title" }, [movieIcon(), "Animate"]),
      el("span", { class: "chart-field-label" }, ["over"]),
      this.animationTimeSelect,
      el("span", { class: "chart-field-label" }, ["every"]),
      this.animationGrainSelect,
      el("span", { class: "chart-animate-hint" }, [
        "Playback appears under the chart; export one loop as a GIF.",
      ]),
    ]);

    const settingsBody = el("div", { class: "chart-settings-body" }, [
      this.colorWrap,
      this.sizeWrap,
      this.modeWrap,
      this.densityStyleWrap,
      this.chartFilterRow,
      this.histogramSettings,
      this.barSettings,
      this.correlationSettings,
      lookRow,
    ]);
    this.settingsBody = settingsBody;
    const settings = el("details", { class: "chart-settings-disclosure" }, [
      el("summary", { title: "Colours, ranges, titles and other settings" }, ["Settings"]),
      settingsBody,
    ]);
    head.append(settings);

    const canvasWrap = el("div", { class: "chart-canvas-wrap" });
    this.canvas = el("canvas", {
      class: "chart-canvas",
      role: "img",
      "aria-label": "Chart",
    }) as HTMLCanvasElement;
    canvasWrap.append(this.canvas);
    this.resetViewButton = el(
      "button",
      {
        class: "chart-reset-view hidden",
        type: "button",
        title: "Reset the zoomed view to the full range",
      },
      ["Reset view"],
    ) as HTMLButtonElement;
    this.resetViewButton.addEventListener("click", () => this.resetMapZoom());
    canvasWrap.append(this.resetViewButton);
    this.scopeEl = el("div", { class: "chart-scope" });
    this.noteEl = el("div", { class: "chart-note" });
    this.legendEl = el("div", { class: "chart-legend hidden" });
    this.tooltipEl = el("div", { class: "chart-tooltip hidden", role: "tooltip" });
    this.canvas.addEventListener("pointermove", (event) =>
      this.queuePointer(event as PointerEvent),
    );
    this.canvas.addEventListener("pointerleave", () => this.hideTooltip());
    this.canvas.addEventListener("click", (event) => this.handleCanvasClick(event));
    this.canvas.addEventListener("pointerdown", (event) =>
      this.beginMapBrush(event as PointerEvent),
    );
    this.canvas.addEventListener("pointerup", (event) =>
      this.endMapBrush(event as PointerEvent),
    );
    this.canvas.addEventListener("wheel", (event) => this.onWheel(event as WheelEvent), {
      passive: false,
    });
    this.canvas.addEventListener("dblclick", () => this.resetMapZoom());
    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(() => this.scheduleRender());
      this.resizeObserver.observe(canvasWrap);
    }

    // Playback bar: play/pause, frame scrubber, loop and video export.
    this.animationPlayButton = el(
      "button",
      { class: "ghost small", type: "button", title: "Play or pause the animation" },
      ["▶ Play"],
    ) as HTMLButtonElement;
    this.animationPlayButton.addEventListener("click", () => this.toggleAnimation());
    this.animationSlider = el("input", {
      class: "chart-animation-slider",
      type: "range",
      min: "0",
      max: "0",
      step: "1",
      "aria-label": "Animation frame",
    }) as HTMLInputElement;
    this.animationSlider.addEventListener("input", () => {
      const value = Number(this.animationSlider.value);
      this.stopAnimation();
      const last = this.animationResult === null ? 0 : this.animationResult.frames.length - 1;
      this.animationFrame = Math.max(0, Math.min(Number.isFinite(value) ? value : 0, last));
      this.render();
    });
    this.animationFrameLabel = el("span", { class: "chart-animation-label" });
    this.animationSpeedSelect = el("select", {
      class: "chart-picker chart-picker-small",
      "aria-label": "Play speed",
      title: "Playback speed; also sets the exported frame rate",
    }) as HTMLSelectElement;
    for (const speed of [0.5, 0.75, 1, 1.25, 1.5, 2]) {
      this.animationSpeedSelect.append(
        el("option", { value: String(speed) }, [`${speed}×`]) as HTMLOptionElement,
      );
    }
    this.animationSpeedSelect.append(
      el("option", { value: "custom" }, ["Custom…"]) as HTMLOptionElement,
    );
    this.animationSpeedSelect.value = String(this.config.animationSpeed ?? 1);
    this.animationSpeedSelect.addEventListener("change", () => {
      if (this.animationSpeedSelect.value === "custom") {
        void this.promptAnimationSpeed();
        return;
      }
      const speed = Number(this.animationSpeedSelect.value);
      this.setAnimationSpeed(Number.isFinite(speed) && speed > 0 ? speed : 1);
    });
    this.animationLoopInput = el("input", { type: "checkbox" }) as HTMLInputElement;
    this.animationLoopInput.checked = true;
    const loopField = el("label", { class: "control check clean-check chart-check" });
    loopField.title = "Restart from the first frame after the last";
    loopField.append(this.animationLoopInput, "Loop");
    this.animationExportButton = el(
      "button",
      { class: "ghost small", type: "button", title: "Export one loop as an animated GIF or a video" },
      [],
    ) as HTMLButtonElement;
    this.animationExportButton.append(movieIcon(), el("span", {}, ["Export"]));
    this.animationExportButton.addEventListener("click", () =>
      this.openExportMenu(this.animationExportButton),
    );
    this.animationBar = el(
      "div",
      { class: "chart-animation hidden" },
      [
        this.animationPlayButton,
        this.animationSlider,
        this.animationFrameLabel,
        this.animationSpeedSelect,
        loopField,
        this.animationExportButton,
      ],
    );

    this.root.append(
      head,
      this.scopeEl,
      this.animationSetup,
      this.bubbleSettings,
      canvasWrap,
      this.animationBar,
      this.legendEl,
      this.noteEl,
      this.tooltipEl,
    );

    this.syncSwatches();
    this.applySpan();
    this.syncOptions();
    this.renderControls();
    // Skip the first paint while the lens is hidden: a 1x1 canvas would flash
    // before the ResizeObserver paints the real size.
    if ((this.canvas.parentElement?.clientWidth ?? 0) > 1) this.render();
    window.addEventListener("resize", this.onResize);
    window.addEventListener("themechange", this.onThemeChange);
  }

  dispose(): void {
    this.disposed = true;
    this.closeFocus();
    if (this.animationTimer !== null) {
      window.clearInterval(this.animationTimer);
      this.animationTimer = null;
    }
    this.animationPlaying = false;
    this.generation++;
    if (this.pointerFrame !== null) {
      if (typeof window.cancelAnimationFrame === "function") {
        window.cancelAnimationFrame(this.pointerFrame);
      } else {
        window.clearTimeout(this.pointerFrame);
      }
      this.pointerFrame = null;
    }
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    window.removeEventListener("resize", this.onResize);
    window.removeEventListener("themechange", this.onThemeChange);
  }

  setColumns(columns: ColumnMeta[]): void {
    this.columns = columns;
    this.plotView = null;
    this.mapView = null;
    this.chartXZoom = null;
    this.barWindow = null;
    this.generation++;
    this.pickerSignature = "";
    this.syncOptions();
    this.syncPlaceholder();
    this.syncSourceControls();
    this.syncGeoJoinControls();
    this.refreshGeoJoin();
    this.renderControls();
    this.refreshBins();
    this.refreshSeries();
    this.refreshTreemap();
    this.refreshText();
    this.refreshBox();
    this.refreshCrosstab();
    this.refreshBubble();
    this.refreshMapGrid();
    this.refreshAnimation();
    this.refreshCorrelation();
    this.refreshGroupedBins();
    this.refreshValue();
    this.render();
  }

  /** The sources a card can bind to (the table plus each saved view). */
  setSources(sources: { id: string; name: string }[]): void {
    this.sources = sources;
    this.renderSourceOptions();
    this.syncSourceControls();
    this.syncScope();
  }

  private renderSourceOptions(): void {
    const current = this.config.source;
    this.sourceSelect.replaceChildren();
    this.sourceSelect.append(
      el("option", { value: "" }, [this.options.tableSourceLabel?.() ?? "Table (filtered)"]) as HTMLOptionElement,
    );
    for (const source of this.sources) {
      this.sourceSelect.append(
        el("option", { value: source.id }, [source.name]) as HTMLOptionElement,
      );
    }
    if (current !== "" && !this.sources.some((source) => source.id === current)) {
      this.config.source = "";
    }
    this.sourceSelect.value = this.config.source;
  }

  /** A view-bound card hides the raw-column pickers; its type comes from the view. */
  private syncSourceControls(): void {
    const bound = this.config.source !== "";
    // Must agree with renderControls: this runs on filter updates too, and
    // blindly unhiding the pair controls would leak X/Y into single-axis kinds.
    const kind = this.config.kind;
    const pair = isPairKind(kind);
    const groupable = this.columns.some((meta) => isCategoryType(meta.type));
    const measureKinds =
      kind === "line" ||
      kind === "bar" ||
      kind === "barplot" ||
      kind === "kpi" ||
      kind === "histogram";
    const grainKinds =
      kind === "line" || (kind === "kpi" && this.isDateLike(this.meta(this.config.column)));
    const valueOn =
      measureKinds && this.config.source === "" && (this.config.valueColumn ?? -1) >= 0;
    this.kindSelect.classList.toggle("hidden", bound);
    const kpiPrimaryHidden =
      kind === "kpi" && !this.columns.some((meta) => this.isDateLike(meta));
    const groupedValue =
      valueOn && (kind === "line" || kind === "bar" || kind === "barplot");
    this.primaryWrap.classList.toggle(
      "hidden",
      bound || pair || kind === "correlation" || kpiPrimaryHidden,
    );
    this.groupWrap.classList.toggle(
      "hidden",
      bound ||
      (kind !== "line" &&
        kind !== "histogram" &&
        kind !== "bubble" &&
        kind !== "bar" &&
        kind !== "barplot") ||
        !groupable ||
        (valueOn && !groupedValue),
    );
    this.valueWrap.classList.toggle("hidden", bound || !measureKinds);
    this.valueAggWrap.classList.toggle("hidden", bound || !measureKinds || !valueOn);
    this.valueGrainWrap.classList.toggle("hidden", bound || !grainKinds || !valueOn);
    this.valueCalcWrap.classList.toggle("hidden", bound || !valueOn);
    this.xWrap.classList.toggle("hidden", bound || !pair);
    this.yWrap.classList.toggle("hidden", bound || !pair);
    this.axesPanel.classList.toggle("hidden", bound || kind === "correlation");
    this.settingsBody.classList.toggle("hidden", bound ? false : !this.canDraw());
  }

  /** Fetches the bound view's aggregate result (generation-guarded). */
  refreshView(): void {
    if (this.config.source === "" || this.options.requestViewAggregate === undefined) {
      this.viewResult = null;
      this.render();
      return;
    }
    const source = this.config.source;
    const generation = ++this.generation;
    void this.options
      .requestViewAggregate(source)
      .then((message) => {
        if (generation !== this.generation || this.config.source !== source) return;
        this.viewResult = message;
        this.render();
      })
      .catch(() => {
        // Keep the last result as the fallback.
      });
  }

  /** True when this card plots its own measure aggregate (line/bar/KPI/bins). */
  private usesValueAggregate(): boolean {    return (
      this.config.source === "" &&
      (this.config.kind === "line" ||
        this.config.kind === "bar" ||
        this.config.kind === "barplot" ||
        this.config.kind === "kpi" ||
        this.config.kind === "histogram") &&
      (this.config.valueColumn ?? -1) >= 0
    );
  }

  /** True when the card draws an aggregate result (bound view or own value). */
  private usesAggregate(): boolean {
    return this.config.source !== "" || this.usesValueAggregate();
  }

  private aggregateResult(): AggregateMessage | null {
    return this.config.source !== "" ? this.viewResult : this.valueResult;
  }

  /** Implicit view definition: the measure aggregated over time, categories or bins. */
  private valueViewDef(): ViewDef | null {
    if (!this.usesValueAggregate() || this.options.requestAggregate === undefined) return null;
    const column = this.config.valueColumn ?? -1;
    if (column < 0) return null;
    const line = this.config.kind === "line";
    const kpi = this.config.kind === "kpi";
    const histogram = this.config.kind === "histogram";
    if (line && !this.isDateLike(this.meta(this.config.column))) return null;
    // A KPI with a date column reads the series (latest bucket + comparison);
    // without one it is the grand total over every filtered row.
    const overTime = kpi && this.isDateLike(this.meta(this.config.column));
    if (!line && !kpi && this.config.column < 0) return null;
    const grain =
      this.config.valueGrain === undefined || this.config.valueGrain === "auto"
        ? this.defaultGrainFor(this.config.column)
        : this.config.valueGrain;
    // Split-by: line/bar cards with a Group draw one series per group value
    // (dimension 2); the renderer pivots the returned groups into series.
    const groupType = this.meta(this.config.groupColumn)?.type;
    const split =
      (line || this.config.kind === "bar" || this.config.kind === "barplot") &&
      this.config.groupColumn >= 0 &&
      groupType !== undefined &&
      isCategoryType(groupType);
    const binCount = Math.max(
      1,
      Math.min(256, Math.floor(this.config.binOptions?.binCount ?? DEFAULT_BIN_COUNT) || 32),
    );
    const calc = this.config.valueCalc;
    const post =
      calc === undefined
        ? undefined
        : calc === "rolling7"
          ? ([{ op: "rolling", window: 7 }] as const)
          : ([{ op: calc }] as const);
    return {
      id: "card-value",
      name: this.config.title.trim() === "" ? this.defaultTitle() : this.config.title.trim(),
      dimensions:
        line || overTime
          ? split
            ? [
                { column: this.config.column, by: { time: grain } },
                { column: this.config.groupColumn, by: "value" },
              ]
            : [{ column: this.config.column, by: { time: grain } }]
          : histogram
            ? [{ column: this.config.column, by: { bin: { n: binCount } } }]
            : kpi
              ? []
              : split
                ? [
                    { column: this.config.column, by: "value" },
                    { column: this.config.groupColumn, by: "value" },
                  ]
                : [{ column: this.config.column, by: "value" }],
      measures: [
        {
          column,
          agg: this.config.valueAgg ?? "mean",
          ...(post === undefined ? {} : { post: [...post] }),
        },
      ],
      fill: line && !split ? "zero" : "none",
      sort:
        line || overTime || histogram
          ? { key: "dim0", dir: "asc" }
          : { key: "m0", dir: "desc" },
      limit: 5000,
      respectFilters: this.config.respectFilters !== false,
      filterColumn: this.config.filterColumn ?? -1,
      filterCode: this.config.filterCode ?? -1,
    };
  }

  /** Fetches the card's own value-over-time aggregate (generation-guarded). */
  refreshValue(): void {
    const def = this.valueViewDef();
    if (def === null) {
      if (this.valueResult !== null) this.valueResult = null;
      return;
    }
    const generation = ++this.generation;
    void this.options
      .requestAggregate(def)
      .then((message) => {
        if (generation !== this.generation || !this.usesValueAggregate()) return;
        this.valueResult = message;
        this.render();
      })
      .catch(() => {
        // Keep the last result as the fallback.
      });
  }

  setFiltered(
    facets: Record<number, number[]>,
    histograms: Record<number, number[]>,
  ): void {
    this.facets = facets;
    this.histograms = histograms;
    this.generation++;
    this.renderSourceOptions();
    this.syncSourceControls();
    if (this.config.source !== "") this.refreshView();
    else this.refreshValue();
    this.refreshBins();
    this.refreshSeries();
    this.refreshTreemap();
    this.refreshText();
    this.refreshBox();
    this.refreshCrosstab();
    this.refreshBubble();
    this.refreshMapGrid();
    this.refreshAnimation();
    this.refreshCorrelation();
    this.refreshGroupedBins();
    this.refreshGeoJoin();
    this.render();
  }

  setRowCount(count: number): void {
    this.rowCount = count;
    this.render();
  }

  setTotalRowCount(count: number): void {
    this.totalRowCount = count;
    this.syncScope();
  }

  private syncScope(): void {
    const view = this.sources.find((source) => source.id === this.config.source);
    const total = this.totalRowCount > 0 ? this.totalRowCount : this.rowCount;
    const scope = describeScope({
      total,
      visible: this.rowCount,
      viewName: view?.name ?? null,
    });
    const filterColumn = this.config.filterColumn ?? -1;
    const filterCode = this.config.filterCode ?? -1;
    const filterLabel =
      filterColumn >= 0 && filterCode >= 0
        ? this.meta(filterColumn)?.categories?.labels[filterCode]
        : undefined;
    const chartFilter =
      filterLabel === undefined
        ? ""
        : ` · chart: ${this.meta(filterColumn)?.name ?? "value"} = ${filterLabel}`;
    const calc =
      this.config.valueCalc === undefined
        ? ""
        : ` · calc: ${this.valueCalcSelect.selectedOptions[0]?.textContent ?? this.config.valueCalc}`;
    this.scopeEl.textContent =
      (view === undefined ? `Table · ${scope}` : scope) + chartFilter + calc;
    this.scopeEl.classList.toggle("hidden", total === 0 && this.rowCount === 0);
  }

  refresh(): void {
    this.generation++;
    this.refreshBins();
    this.refreshSeries();
    this.refreshTreemap();
    this.refreshText();
    this.refreshBox();
    this.refreshCrosstab();
    this.refreshBubble();
    this.refreshMapGrid();
    this.refreshAnimation();
    this.refreshCorrelation();
    this.refreshGroupedBins();
    this.refreshValue();
    this.render();
  }

  /** Repaints the current payloads; used when the lens is re-entered. */
  repaint(): void {
    // The host may still be hidden at this point; painting then would leave a
    // 1x1 canvas that flashes before the ResizeObserver sees the real size.
    if ((this.canvas.parentElement?.clientWidth ?? 0) <= 1) return;
    this.render();
  }

  getConfig(): ChartCardConfig {
    return {
      ...this.config,
      binOptions:
        this.config.binOptions === null ? null : { ...this.config.binOptions },
      correlationColumns: [...this.config.correlationColumns],
    };
  }

  /** Column indexes this card currently charts, used to pick fresh defaults. */
  usedColumns(): number[] {
    const out = [this.config.column];
    if (isPairKind(this.config.kind)) out.push(this.config.x, this.config.y);
    if (this.config.kind === "correlation") out.push(...this.config.correlationColumns);
    if (this.config.kind === "line" && this.config.groupColumn >= 0) {
      out.push(this.config.groupColumn);
    }
    return out.filter((index) => index >= 0);
  }

  exportPng(width: number, height: number): void {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (ctx === null) return;
    this.drawChart(ctx, width, height, true);
    if (typeof canvas.toBlob !== "function") return;
    const name = `${safeFileName(this.options.datasetName())}-${safeFileName(
      this.chartName(),
    )}-${width}x${height}.png`;
    canvas.toBlob((blob) => {
      if (blob === null) return;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = name;
      anchor.click();
      URL.revokeObjectURL(url);
    }, "image/png");
  }

  /** Download the data already behind this chart, not a re-query of the table. */
  private exportCsv(): void {
    const rows = this.chartCsvRows();
    if (rows.length < 2) {
      this.noteEl.textContent = "No chart data is available to export yet.";
      return;
    }
    const name = `${safeFileName(this.options.datasetName())}-${safeFileName(
      this.chartName(),
    )}.csv`;
    if (!downloadCsv(name, rows)) {
      this.noteEl.textContent = "This browser cannot download the chart data.";
      return;
    }
    this.noteEl.textContent = `Exported ${(rows.length - 1).toLocaleString()} chart data rows to ${name}`;
  }

  private chartCsvRows(): string[][] {
    const number = (value: number): string =>
      Number.isFinite(value) ? String(value) : "";
    const aggregate = this.aggregateResult();
    const aggregateKinds = new Set<ChartCardKind>([
      "line",
      "bar",
      "barplot",
      "kpi",
      "histogram",
    ]);
    if (
      aggregate !== null &&
      aggregate.groupCount > 0 &&
      aggregateKinds.has(this.config.kind) &&
      (this.config.source !== "" || (this.config.valueColumn ?? -1) >= 0)
    ) {
      const names = [
        ...aggregate.dimensionNames,
        ...aggregate.measureNames,
      ];
      const rows: string[][] = [names];
      for (let index = 0; index < aggregate.groupCount; index++) {
        rows.push([
          ...aggregate.dimensions.map((dimension) => dimension[index] ?? ""),
          ...aggregate.measures.map((measure) => number(measure[index] ?? Number.NaN)),
        ]);
      }
      return rows;
    }

    if (this.config.kind === "bar") {
      const bars = this.allCategoryBars();
      if (bars.length === 0) return [];
      return [
        ["category", "count", "percent", "is_other"],
        ...bars.map((bar) => [
          bar.label,
          String(bar.count),
          bar.pct.toFixed(4),
          bar.other === true ? "true" : "false",
        ]),
      ];
    }

    if (this.config.kind === "line" || this.config.kind === "histogram") {
      const grouped = this.groupResult;
      if (grouped !== null && grouped.groups.length > 0) {
        const range = this.binRangeFor(this.config.kind);
        const step = range === null ? 0 : (range.max - range.min) / Math.max(1, grouped.bins);
        const rows: string[][] = [["group", "bin_start", "bin_end", "count"]];
        for (let series = 0; series < grouped.groups.length; series++) {
          const counts = grouped.groups[series] ?? [];
          for (let bin = 0; bin < grouped.bins; bin++) {
            rows.push([
              grouped.labels[series] ?? "",
              number(range === null ? bin : range.min + bin * step),
              number(range === null ? bin + 1 : range.min + (bin + 1) * step),
              String(counts[bin] ?? 0),
            ]);
          }
        }
        return rows;
      }
      const bins = this.config.kind === "line" ? this.lineBinResult : this.binResult;
      const range = this.binRangeFor(this.config.kind);
      if (bins === null || range === null) return [];
      const step = (range.max - range.min) / Math.max(1, bins.bins.length);
      const rows: string[][] = [["bin_start", "bin_end", "count"]];
      for (let bin = 0; bin < bins.bins.length; bin++) {
        rows.push([
          number(range.min + bin * step),
          number(range.min + (bin + 1) * step),
          String(bins.bins[bin] ?? 0),
        ]);
      }
      if (bins.overflow > 0) {
        rows.push([`> ${number(range.max)}`, "", String(bins.overflow)]);
      }
      return rows;
    }

    if (this.config.kind === "scatter" || this.config.kind === "density" || this.config.kind === "map") {
      const grid = this.config.kind === "map" && this.config.mapMode === "heat"
        ? this.mapGrid
        : null;
      if (grid !== null) return this.gridCsvRows(grid);
      const result = this.seriesResult;
      if (result === null) return [];
      if (result.mode === "points") {
        const rows: string[][] = [["x", "y", "color", "size"]];
        for (let index = 0; index < result.x.length; index++) {
          const color =
            result.colorValues !== null
              ? number(result.colorValues[index] ?? Number.NaN)
              : result.colorCodes !== null
                ? this.seriesLabels?.[result.colorCodes[index] ?? -1] ?? ""
                : "";
          rows.push([
            number(result.x[index] ?? Number.NaN),
            number(result.y[index] ?? Number.NaN),
            color,
            result.size === null ? "" : number(result.size[index] ?? Number.NaN),
          ]);
        }
        return rows;
      }
      const stepX = (result.xMax - result.xMin) / Math.max(1, result.cols);
      const stepY = (result.yMax - result.yMin) / Math.max(1, result.rows);
      const rows: string[][] = [["x_center", "y_center", "count"]];
      for (let y = 0; y < result.rows; y++) {
        for (let x = 0; x < result.cols; x++) {
          const count = result.counts[y * result.cols + x] ?? 0;
          if (count === 0) continue;
          rows.push([
            String(result.xMin + (x + 0.5) * stepX),
            String(result.yMin + (y + 0.5) * stepY),
            String(count),
          ]);
        }
      }
      return rows;
    }

    if (this.config.kind === "bubble") {
      return this.bubbleResult === null ? [] : this.gridCsvRows(this.bubbleResult);
    }

    if (this.config.kind === "box") {
      const result = this.boxResult;
      if (result === null) return [];
      return [
        [
          "group",
          "count",
          "min",
          "q1",
          "median",
          "q3",
          "max",
          "whisker_low",
          "whisker_high",
          "outlier_count",
        ],
        ...result.groups.map((group) => [
          group.label,
          String(group.count),
          number(group.min),
          number(group.q1),
          number(group.median),
          number(group.q3),
          number(group.max),
          number(group.whiskerLow),
          number(group.whiskerHigh),
          String(group.outliers.length),
        ]),
      ];
    }

    if (this.config.kind === "heatmap") {
      const result = this.crossResult;
      if (result === null) return [];
      const rows: string[][] = [["x", "y", "count", "percent"]];
      for (let y = 0; y < result.yLabels.length; y++) {
        for (let x = 0; x < result.xLabels.length; x++) {
          const count = result.counts[y * result.xLabels.length + x] ?? 0;
          rows.push([
            result.xLabels[x] ?? "",
            result.yLabels[y] ?? "",
            String(count),
            result.total === 0 ? "" : ((count / result.total) * 100).toFixed(4),
          ]);
        }
      }
      return rows;
    }

    if (this.config.kind === "correlation") {
      const result = this.correlationResult;
      if (result === null) return [];
      const rows: string[][] = [["column_a", "column_b", "r", "n"]];
      for (let a = 0; a < result.labels.length; a++) {
        for (let b = a + 1; b < result.labels.length; b++) {
          rows.push([
            result.labels[a] ?? "",
            result.labels[b] ?? "",
            number(result.values[a * result.labels.length + b] ?? Number.NaN),
            String(result.counts[a * result.labels.length + b] ?? 0),
          ]);
        }
      }
      return rows;
    }

    if (this.config.kind === "treemap") {
      const result = this.treemapResult;
      if (result !== null) {
        return [
          ["label", "value"],
          ...result.labels.map((label, index) => [label, number(result.values[index] ?? Number.NaN)]),
        ];
      }
      const bars = this.allCategoryBars();
      return bars.length === 0
        ? []
        : [["label", "value"], ...bars.map((bar) => [bar.label, String(bar.count)])];
    }

    if (this.config.kind === "terms") {
      const terms = this.textResult?.profile.topTerms ?? [];
      return terms.length === 0
        ? []
        : [["term", "count"], ...terms.map((term) => [term.term, String(term.count)])];
    }

    const bars = this.allCategoryBars();
    return bars.length === 0
      ? []
      : [
          ["category", "count", "percent"],
          ...bars.map((bar) => [bar.label, String(bar.count), bar.pct.toFixed(4)]),
        ];
  }

  private binRangeFor(kind: ChartCardKind): { min: number; max: number } | null {
    if (kind === "histogram") return this.config.binOptions;
    return this.lineBinRange;
  }

  private gridCsvRows(grid: GridCountsResult): string[][] {
    const stepX = (grid.xMax - grid.xMin) / Math.max(1, grid.bins);
    const stepY = (grid.yMax - grid.yMin) / Math.max(1, grid.bins);
    const rows: string[][] = [["x_center", "y_center", "group", "count", "value"]];
    const append = (
      counts: Uint32Array,
      values: Float64Array | null,
      label: string,
    ): void => {
      for (let y = 0; y < grid.bins; y++) {
        for (let x = 0; x < grid.bins; x++) {
          const index = y * grid.bins + x;
          const count = counts[index] ?? 0;
          const value = values?.[index];
          if (count === 0 && (value === undefined || value === 0)) continue;
          rows.push([
            String(grid.xMin + (x + 0.5) * stepX),
            String(grid.yMin + (y + 0.5) * stepY),
            label,
            String(count),
            value === undefined || !Number.isFinite(value) ? "" : String(value),
          ]);
        }
      }
    };
    if (grid.groups !== null) {
      for (const group of grid.groups) append(group.counts, group.values, group.label);
    } else {
      append(grid.counts, grid.values, "");
    }
    return rows;
  }

  private buildSelect(className: string, label: string): HTMLSelectElement {
    return el("select", { class: className, "aria-label": label }) as HTMLSelectElement;
  }

  private tagged(tag: string, select: HTMLSelectElement): { wrap: HTMLElement; label: HTMLElement } {
    const wrap = el("label", { class: "chart-tag" });
    const label = el("span", { class: "chart-tag-label" }, [tag]);
    wrap.append(label, select);
    return { wrap, label };
  }

  private meta(index: number): ColumnMeta | undefined {
    return index >= 0 ? this.columns[index] : undefined;
  }

  /** Calendar dates and timestamps: the kinds a time axis can use. */
  private isDateLike(meta: ColumnMeta | undefined): boolean {
    return meta !== undefined && (meta.type === "date" || meta.type === "datetime");
  }

  private allowsPrimary(meta: ColumnMeta): boolean {
    switch (this.config.kind) {
      case "histogram":
        return isNumericType(meta.type) || meta.type === "time" || meta.type === "duration";
      case "line":
        return meta.type === "date" || meta.type === "datetime";
      case "kpi":
        // The primary column is the KPI's optional date axis.
        return meta.type === "date" || meta.type === "datetime";
      case "bar":
      case "barplot":
      case "treemap":
        return isCategoryType(meta.type);
      case "terms":
        return meta.type === "string";
      default:
        return false;
    }
  }

  private allowsAxis(meta: ColumnMeta): boolean {
    return (
      isNumericType(meta.type) ||
      meta.type === "date" ||
      meta.type === "datetime" ||
      meta.type === "duration"
    );
  }

  private allowsX(meta: ColumnMeta): boolean {
    switch (this.config.kind) {
      case "box":
        return isNumericType(meta.type);
      case "heatmap":
        return isCategoryType(meta.type);
      case "correlation":
        return false;
      default:
        return this.allowsAxis(meta);
    }
  }

  private allowsY(meta: ColumnMeta): boolean {
    switch (this.config.kind) {
      case "box":
      case "heatmap":
        return isCategoryType(meta.type);
      case "correlation":
        return false;
      default:
        return this.allowsAxis(meta);
    }
  }

  private allowedIndexes(allow: (meta: ColumnMeta) => boolean): number[] {
    const out: number[] = [];
    this.columns.forEach((meta, index) => {
      if (allow(meta)) out.push(index);
    });
    return out;
  }

  private defaultCorrelationColumns(): number[] {
    return this.allowedIndexes(
      (meta) =>
        isNumericType(meta.type) &&
        !isIdLikeColumn(meta, this.rowCount) &&
        !looksLikeIdName(meta.name),
    ).slice(0, 8);
  }

  private setKind(kind: ChartCardKind): void {
    if (kind === this.config.kind) return;
    this.config.kind = kind;
    this.plotView = null;
    this.mapView = null;
    this.mapGrid = null;
    this.chartXZoom = null;
    this.barWindow = null;
    if (isPairKind(kind)) {
      const xAllowed = this.allowedIndexes((meta) => this.allowsX(meta));
      const yAllowed = this.allowedIndexes((meta) => this.allowsY(meta));
      if (!xAllowed.includes(this.config.x)) this.config.x = xAllowed[0] ?? -1;
      if (!yAllowed.includes(this.config.y) || (this.config.y === this.config.x && yAllowed.length > 1)) {
        this.config.y = yAllowed.find((index) => index !== this.config.x) ?? yAllowed[0] ?? -1;
      }
    } else if (kind === "correlation") {
      const numeric = this.defaultCorrelationColumns();
      this.config.correlationColumns = this.config.correlationColumns.filter((index) =>
        numeric.includes(index),
      );
      if (this.config.correlationColumns.length < 2) {
        this.config.correlationColumns = numeric.slice(0, 6);
      }
    } else {
      const primary = this.allowedIndexes((meta) => this.allowsPrimary(meta));
      if (!primary.includes(this.config.column)) this.config.column = primary[0] ?? -1;
      if (kind === "histogram") this.applyColumnDefaults();
    }
    this.generation++;
    this.pickerSignature = "";
    this.syncOptions();
    this.syncPlaceholder();
    this.renderControls();
    this.refreshBins();
    this.refreshSeries();
    this.refreshTreemap();
    this.refreshText();
    this.refreshBox();
    this.refreshCrosstab();
    this.refreshBubble();
    this.refreshMapGrid();
    this.refreshAnimation();
    this.refreshCorrelation();
    this.refreshGroupedBins();
    this.render();
  }

  private setPrimaryColumn(index: number): void {
    if (index === this.config.column) return;
    this.config.column = index;
    this.chartXZoom = null;
    this.barWindow = null;
    if (this.config.kind === "histogram") this.applyColumnDefaults();
    this.generation++;
    this.syncPlaceholder();
    this.renderControls();
    this.refreshBins();
    this.refreshGroupedBins();
    this.refreshTreemap();
    this.refreshText();
    this.render();
  }

  private applyColumnDefaults(): void {
    const meta = this.meta(this.config.column);
    this.binResult = null;
    this.chartXZoom = null;
    if (meta === undefined) {
      this.config.binOptions = null;
      return;
    }
    // A KDE curve adds noise on low-cardinality columns.
    this.config.kde = meta.stats.distinct >= 30;
    const suggested = suggestedBinRange(meta);
    this.config.binOptions = {
      min: suggested.min,
      max: suggested.max,
      binCount: DEFAULT_BIN_COUNT,
      overflow: suggested.overflow,
    };
    this.config.binClipped = suggested.clipped;
  }

  private syncOptions(): void {
    if (this.columns.length === 0) return;
    const signature = `${this.config.kind}|${this.columns
      .map((meta, index) => `${index}:${meta.type}:${meta.name}`)
      .join("|")}`;
    if (signature === this.pickerSignature) return;
    this.pickerSignature = signature;
    this.kindSelect.value = this.config.kind;

    const primary = this.allowedIndexes((meta) => this.allowsPrimary(meta));
    if (!primary.includes(this.config.column)) this.config.column = primary[0] ?? -1;
    this.primarySelect.replaceChildren();
    primary.forEach((index) => {
      const meta = this.columns[index];
      this.primarySelect.append(this.option(String(index), `${meta.name} (${TYPE_LABELS[meta.type]})`));
    });
    if (primary.length === 0) {
      const placeholder = this.option("-1", "No matching column");
      placeholder.disabled = true;
      this.primarySelect.append(placeholder);
    }
    if (this.config.column >= 0) this.primarySelect.value = String(this.config.column);

    const groupable = this.allowedIndexes((meta) => isCategoryType(meta.type));
    if (!groupable.includes(this.config.groupColumn)) this.config.groupColumn = -1;
    this.groupSelect.replaceChildren(this.option("-1", "None"));
    groupable.forEach((index) => {
      const meta = this.columns[index];
      this.groupSelect.append(
        this.option(String(index), `${meta.name} (${TYPE_LABELS[meta.type]})`),
      );
    });
    this.groupSelect.value = String(this.config.groupColumn);

    const valueAllowed = this.allowedIndexes(
      (meta) => isNumericType(meta.type) || meta.type === "time" || meta.type === "duration",
    );
    if (
      this.config.valueColumn !== undefined &&
      this.config.valueColumn >= 0 &&
      !valueAllowed.includes(this.config.valueColumn)
    ) {
      this.config.valueColumn = -1;
    }
    this.valueSelect.replaceChildren(this.option("-1", "Count of rows"));
    valueAllowed.forEach((index) => {
      const meta = this.columns[index];
      this.valueSelect.append(
        this.option(String(index), `${meta.name} (${TYPE_LABELS[meta.type]})`),
      );
    });
    if ((this.config.valueColumn ?? -1) >= 0) {
      this.valueSelect.value = String(this.config.valueColumn);
    }
    if (this.config.valueAgg !== undefined) this.valueAggSelect.value = this.config.valueAgg;
    this.valueGrainSelect.value = this.config.valueGrain ?? "auto";
    this.valueCalcSelect.value = this.config.valueCalc ?? "";
    this.barStackInput.checked = (this.config.barLayout ?? "group") === "stack";

    const xAllowed = this.allowedIndexes((meta) => this.allowsX(meta));
    const yAllowed = this.allowedIndexes((meta) => this.allowsY(meta));
    if (!xAllowed.includes(this.config.x)) this.config.x = xAllowed[0] ?? -1;
    if (!yAllowed.includes(this.config.y) || (this.config.y === this.config.x && yAllowed.length > 1)) {
      this.config.y = yAllowed.find((index) => index !== this.config.x) ?? yAllowed[0] ?? -1;
    }
    for (const [select, allowed, selected] of [
      [this.xSelect, xAllowed, this.config.x],
      [this.ySelect, yAllowed, this.config.y],
    ] as const) {
      select.replaceChildren();
      allowed.forEach((index) => {
        const meta = this.columns[index];
        select.append(this.option(String(index), `${meta.name} (${TYPE_LABELS[meta.type]})`));
      });
      if (allowed.length === 0) {
        const placeholder = this.option("-1", "No numeric column");
        placeholder.disabled = true;
        select.append(placeholder);
      } else if (selected >= 0) {
        select.value = String(selected);
      }
    }

    this.colorSelect.replaceChildren(this.option("-1", "None"));
    this.sizeSelect.replaceChildren(this.option("-1", "None"));
    this.columns.forEach((meta, index) => {
      this.colorSelect.append(this.option(String(index), `${meta.name} (${TYPE_LABELS[meta.type]})`));
      if (isNumericType(meta.type)) {
        this.sizeSelect.append(this.option(String(index), `${meta.name} (${TYPE_LABELS[meta.type]})`));
      }
    });
    if (this.config.colorColumn < 0 || this.config.colorColumn >= this.columns.length) {
      this.config.colorColumn = -1;
    }
    if (this.config.sizeColumn < 0 || this.config.sizeColumn >= this.columns.length) {
      this.config.sizeColumn = -1;
    }
    this.colorSelect.value = String(this.config.colorColumn);
    this.sizeSelect.value = String(this.config.sizeColumn);
    const sizeNone = this.sizeSelect.options[0];
    if (sizeNone !== undefined) {
      sizeNone.textContent =
        this.config.kind === "treemap" || this.config.kind === "bubble"
          ? "Count (rows)"
          : "None";
    }
    this.modeSelect.value = this.config.mode;
    this.densityStyleSelect.value = this.config.densityStyle;

    const numeric = this.allowedIndexes((meta) => isNumericType(meta.type));
    this.config.correlationColumns = this.config.correlationColumns.filter((index) =>
      numeric.includes(index),
    );
    if (this.config.kind === "correlation" && this.config.correlationColumns.length < 2) {
      this.config.correlationColumns = numeric.slice(0, 6);
    }
    this.correlationSelect.replaceChildren();
    numeric.forEach((index) => {
      const meta = this.columns[index];
      const option = this.option(String(index), `${meta.name} (${TYPE_LABELS[meta.type]})`);
      option.selected = this.config.correlationColumns.includes(index);
      this.correlationSelect.append(option);
    });
    this.syncAnimationOptions();
    this.syncChartFilterControls();
  }

  /** Category filter choices for this chart, plus its table-filter scope. */
  private syncChartFilterControls(): void {
    const categoryIndexes = this.allowedIndexes((meta) => isCategoryType(meta.type));
    let column = this.config.filterColumn ?? -1;
    if (!categoryIndexes.includes(column)) column = -1;
    this.config.filterColumn = column;
    this.filterColumnSelect.replaceChildren(this.option("-1", "No chart filter"));
    for (const index of categoryIndexes) {
      this.filterColumnSelect.append(this.option(String(index), this.columns[index].name));
    }
    this.filterColumnSelect.value = String(column);

    this.filterValueSelect.replaceChildren();
    const labels = column >= 0 ? (this.meta(column)?.categories?.labels ?? []) : [];
    labels.forEach((label, code) => {
      this.filterValueSelect.append(this.option(String(code), label || "(empty)"));
    });
    let code = this.config.filterCode ?? -1;
    if (column < 0 || code < 0 || code >= labels.length) code = labels.length > 0 ? 0 : -1;
    this.config.filterCode = code;
    if (code >= 0) this.filterValueSelect.value = String(code);
    this.filterValueSelect.disabled = column < 0;
    this.filterRespectInput.checked = this.config.respectFilters !== false;
    const aggregateBacked =
      this.usesValueAggregate() ||
      this.config.kind === "treemap" ||
      (this.config.kind === "map" && this.geoDataset !== null);
    this.chartFilterRow.classList.toggle("hidden", !aggregateBacked);
  }

  /** Date and datetime columns available as animation time axes. */
  private syncAnimationOptions(): void {
    const dates = this.allowedIndexes((meta) => this.isDateLike(meta));
    const current = this.config.animationTimeColumn ?? -1;
    if (current >= 0 && !dates.includes(current)) this.config.animationTimeColumn = -1;
    this.animationTimeSelect.replaceChildren(this.option("-1", "Off"));
    dates.forEach((index) => {
      const meta = this.columns[index];
      this.animationTimeSelect.append(this.option(String(index), meta.name));
    });
    this.animationTimeSelect.value = String(this.config.animationTimeColumn ?? -1);
  }

  /** Sensible default frame length for a date column's span. */
  private defaultGrainFor(column: number): TimeGrain {
    const meta = this.meta(column);
    const min = meta?.stats.min;
    const max = meta?.stats.max;
    if (typeof min !== "number" || typeof max !== "number" || !(max > min)) return "month";
    const days = (max - min) / 86_400_000;
    if (days <= 2) return "hour";
    if (days <= 120) return "day";
    if (days <= 840) return "week";
    return "month";
  }

  private option(value: string, label: string): HTMLOptionElement {
    return el("option", { value }, [label]) as HTMLOptionElement;
  }

  private renderControls(): void {
    const kind = this.config.kind;
    const pair = isPairKind(kind);
    const kpiPrimary =
      kind !== "kpi" || this.columns.some((meta) => this.isDateLike(meta));
    this.primaryWrap.classList.toggle(
      "hidden",
      pair || kind === "correlation" || !kpiPrimary,
    );
    this.axesPanel.classList.toggle(
      "hidden",
      this.config.source !== "" || kind === "correlation",
    );
    this.primaryTagLabel.textContent =
      kind === "histogram"
        ? "Values"
        : kind === "line"
          ? "Date"
          : kind === "kpi"
            ? "Date (optional)"
            : kind === "bar" || kind === "treemap"
              ? "Category"
              : kind === "terms"
                ? "Text"
                : "Column";
    const groupable = this.columns.some((meta) => isCategoryType(meta.type));
    const measureKinds =
      kind === "line" ||
      kind === "bar" ||
      kind === "barplot" ||
      kind === "kpi" ||
      kind === "histogram";
    const grainKinds =
      kind === "line" || (kind === "kpi" && this.isDateLike(this.meta(this.config.column)));
    const valueOn =
      measureKinds && this.config.source === "" && (this.config.valueColumn ?? -1) >= 0;
    const groupedValue =
      valueOn && (kind === "line" || kind === "bar" || kind === "barplot");
    this.groupWrap.classList.toggle(
      "hidden",
      (kind !== "line" && kind !== "histogram" && kind !== "bubble" && kind !== "bar") ||
        !groupable ||
        (valueOn && !groupedValue),
    );
    const unbound = this.config.source === "";
    this.valueWrap.classList.toggle("hidden", !measureKinds || !unbound);
    this.valueAggWrap.classList.toggle("hidden", !measureKinds || !unbound || !valueOn);
    this.valueGrainWrap.classList.toggle("hidden", !grainKinds || !unbound || !valueOn);
    this.valueCalcWrap.classList.toggle("hidden", !unbound || !valueOn);
    this.xWrap.classList.toggle("hidden", !pair);
    this.yWrap.classList.toggle("hidden", !pair);
    const seriesKind = kind === "scatter" || kind === "density";
    const mapKind = kind === "map";
    this.mapModeWrap.classList.toggle("hidden", !mapKind);
    this.mapLayerRow.classList.toggle("hidden", !mapKind);
    this.geoJoinRow.classList.toggle(
      "hidden",
      !mapKind || this.geoDataset === null,
    );
    this.colorWrap.classList.toggle("hidden", !seriesKind && !mapKind);
    this.sizeTagLabel.textContent =
      mapKind && this.config.mapMode === "heat" ? "Measure" : "Size";
    this.sizeWrap.classList.toggle(
      "hidden",
      !seriesKind && kind !== "treemap" && kind !== "bubble" && !mapKind,
    );
    // The size column belongs to the visible Bubbles/Map row, not the Settings
    // drawer, so switching what drives the area is one obvious control.
    if (kind === "bubble" || mapKind) {
      this.bubbleSettings.insertBefore(this.sizeWrap, this.bubbleAggField);
    } else if (this.sizeWrap.parentElement !== this.settingsBody) {
      this.settingsBody.append(this.sizeWrap);
    }
    // Colour belongs next to Show/Measure on the map row; elsewhere it stays
    // in the Settings disclosure.
    if (mapKind) this.bubbleSettings.insertBefore(this.colorWrap, this.sizeWrap);
    else if (this.colorWrap.parentElement === this.bubbleSettings) {
      this.settingsBody.append(this.colorWrap);
    }
    const chartFilterable =
      (measureKinds && valueOn) ||
      kind === "treemap" ||
      kind === "heatmap" ||
      kind === "correlation" ||
      kind === "box" ||
      kind === "bubble" ||
      seriesKind ||
      mapKind;
    this.chartFilterRow.classList.toggle("hidden", !chartFilterable);
    this.modeWrap.classList.toggle("hidden", kind !== "scatter");
    this.densityStyleWrap.classList.toggle("hidden", !seriesKind);
    this.colorGroup.classList.toggle("hidden", kind === "correlation");
    this.paletteGroup.classList.toggle("hidden", kind === "correlation");
    this.histogramSettings.classList.toggle("hidden", kind !== "histogram");
    this.barStackField.classList.toggle(
      "hidden",
      kind !== "barplot" || this.config.groupColumn < 0,
    );
    this.barSettings.classList.toggle(
      "hidden",
      kind !== "bar" &&
        kind !== "box" &&
        kind !== "heatmap" &&
        kind !== "treemap" &&
        kind !== "bubble",
    );
    const animatable =
      kind === "bar" ||
      kind === "bubble" ||
      kind === "histogram" ||
      kind === "treemap" ||
      kind === "density";
    const hasDates = this.columns.some((meta) => this.isDateLike(meta));
    this.animateButton.classList.toggle("hidden", !animatable);
    this.animateButton.disabled = !hasDates;
    this.animateButton.title = hasDates
      ? "Step this chart through time"
      : "Animating needs a date or datetime column in the file";
    this.animateButton.classList.toggle("active", this.animationSetupOpen && hasDates);
    this.animationSetup.classList.toggle(
      "hidden",
      !(animatable && hasDates && this.animationSetupOpen),
    );
    const bubbleOnly = kind === "bubble";
    this.bubbleSettings.classList.toggle("hidden", !bubbleOnly && !mapKind);
    this.bubbleTitle.textContent = mapKind ? "Map" : "Bubbles";
    this.bubbleScaleField.classList.toggle("hidden", mapKind);
    this.mapModeSelect.value = this.config.mapMode ?? "points";
    this.bubbleBinsInput.title = mapKind
      ? "Heat grid resolution per axis (4–120)"
      : "Bubble grid resolution per axis (4–120)";
    // Reduce stays visible so the option is discoverable; it only becomes
    // usable once a Size column is chosen.
    const reduceEnabled = this.config.sizeColumn >= 0;
    this.bubbleAggSelect.disabled = !reduceEnabled;
    this.bubbleAggField.title = reduceEnabled
      ? mapKind
        ? "How the rows in each grid cell combine into one heat value"
        : "How the rows in each area combine into one value"
      : "Pick a numeric column under Size first - then choose how rows combine";
    if (!reduceEnabled) this.bubbleAggSelect.value = "count";
    this.topLabel.parentElement?.classList.toggle("hidden", bubbleOnly);
    this.multiInput.parentElement?.classList.toggle("hidden", bubbleOnly);
    this.correlationSettings.classList.toggle("hidden", kind !== "correlation");
    this.topLabel.textContent =
      kind === "bar"
        ? "Top bars"
        : kind === "box"
          ? "Top groups"
          : kind === "treemap"
            ? "Top tiles"
            : "Top per axis";
    if (seriesKind) {
      this.xTagLabel.textContent = "X";
      this.yTagLabel.textContent = "Y";
    } else if (kind === "map") {
      this.xTagLabel.textContent = "Longitude";
      this.yTagLabel.textContent = "Latitude";
    } else if (kind === "box") {
      this.xTagLabel.textContent = "Value";
      this.yTagLabel.textContent = "Groups";
    } else if (kind === "heatmap") {
      this.xTagLabel.textContent = "Columns";
      this.yTagLabel.textContent = "Rows";
    }

    if (kind === "histogram") {
      const meta = this.meta(this.config.column);
      const histogram = meta?.histogram;
      const dataMin = meta?.stats.min ?? histogram?.min ?? 0;
      const dataMax = meta?.stats.max ?? histogram?.max ?? 1;
      if (this.config.binOptions !== null) {
        this.minInput.value = formatChartNumber(this.config.binOptions.min);
        this.maxInput.value = formatChartNumber(this.config.binOptions.max);
        this.binsInput.value = String(this.config.binOptions.binCount);
        this.overflowInput.checked = this.config.binOptions.overflow;
      }
      this.kdeInput.checked = this.config.kde;
      const p95Text =
        histogram !== undefined &&
        histogram !== null &&
        histogram.p95 > dataMin &&
        histogram.p95 < dataMax
          ? `; p95 ${formatChartNumber(histogram.p95)}`
          : "";
      this.minInput.title = `First bin starts here — data range ${formatChartNumber(dataMin)} – ${formatChartNumber(dataMax)}`;
      this.maxInput.title = this.config.binClipped
        ? `Last bin ends here — data range ${formatChartNumber(dataMin)} – ${formatChartNumber(dataMax)}${p95Text}; clipped to p95 because of extreme outliers — Full range restores the maximum`
        : `Last bin ends here — data range ${formatChartNumber(dataMin)} – ${formatChartNumber(dataMax)}${p95Text}`;
      this.maxInput.classList.toggle("clipped", this.config.binClipped);
    }

    // Settings that cannot apply while nothing can be drawn are hidden.
    this.settingsBody.classList.toggle("hidden", !this.canDraw());
  }

  private syncSwatches(): void {
    for (const swatch of this.swatches) {
      const active = swatch.title.toLowerCase() === this.primaryColor().toLowerCase();
      swatch.classList.toggle("active", active);
    }
  }

  /** Colours sampled from the card's palette for `count` series/buckets. */
  private paletteColors(count: number): string[] {
    const colors = samplePalette(
      this.config.palette ?? DEFAULT_PALETTE,
      count,
      parseCustomColors(this.config.paletteCustom ?? ""),
    );
    return this.config.paletteReversed === true ? [...colors].reverse() : colors;
  }

  /** Ramp stops for a palette name, flipped when Reverse is on. */
  private rampStopsFor(name: string): string[] {
    const stops = paletteStops(name, parseCustomColors(this.config.paletteCustom ?? ""));
    return this.config.paletteReversed === true ? [...stops].reverse() : stops;
  }

  /**
   * The single-series colour: the palette's first colour unless the user
   * picked one, so choosing a palette applies to every chart immediately.
   */
  private primaryColor(): string {
    if (this.config.colorCustom === true) return this.config.color;
    return this.paletteColor(0, 1) || this.config.color;
  }

  private paletteColor(index: number, count = 12): string {
    const colors = this.paletteColors(count);
    return colors[index % colors.length] ?? this.primaryColor();
  }

  private joinKey(value: string): string {
    return value.trim().toLowerCase().replace(/\s+/g, " ");
  }

  private syncGeoJoinControls(): void {
    const geo = this.geoDataset;
    const previousFeature = this.geoFeatureSelect.value;
    this.geoFeatureSelect.replaceChildren();
    this.geoFeatureSelect.append(
      el("option", { value: "" }, ["Feature property"]) as HTMLOptionElement,
    );
    if (geo !== null) {
      const keys = new Set<string>();
      for (const feature of geo.features) {
        for (const key of Object.keys(feature.properties)) keys.add(key);
      }
      for (const key of [...keys].sort((a, b) => a.localeCompare(b))) {
        this.geoFeatureSelect.append(el("option", { value: key }, [key]) as HTMLOptionElement);
      }
    }
    if (previousFeature !== "" && [...this.geoFeatureSelect.options].some((o) => o.value === previousFeature)) {
      this.geoFeatureSelect.value = previousFeature;
    } else {
      this.geoFeatureSelect.value = "";
    }

    const previousMatch = this.geoMatchSelect.value;
    this.geoMatchSelect.replaceChildren(
      el("option", { value: "-1" }, ["Choose column"]) as HTMLOptionElement,
    );
    this.columns.forEach((meta, index) => {
      if (!isCategoryType(meta.type) && meta.type !== "string") return;
      this.geoMatchSelect.append(
        el("option", { value: String(index) }, [meta.name]) as HTMLOptionElement,
      );
    });
    if ([...this.geoMatchSelect.options].some((o) => o.value === previousMatch)) {
      this.geoMatchSelect.value = previousMatch;
    }

    const previousMeasure = this.geoMeasureSelect.value;
    this.geoMeasureSelect.replaceChildren(
      el("option", { value: "-1" }, ["Rows"]) as HTMLOptionElement,
    );
    this.columns.forEach((meta, index) => {
      if (!isNumericType(meta.type) && meta.type !== "duration") return;
      this.geoMeasureSelect.append(
        el("option", { value: String(index) }, [meta.name]) as HTMLOptionElement,
      );
    });
    if ([...this.geoMeasureSelect.options].some((o) => o.value === previousMeasure)) {
      this.geoMeasureSelect.value = previousMeasure;
    }

    // Pick a sensible first match: same-named feature property and column.
    if (this.geoFeatureSelect.value === "" && this.geoMatchSelect.value === "-1") {
      const feature = [...this.geoFeatureSelect.options].find((option) => option.value !== "");
      if (feature !== undefined) {
        this.geoFeatureSelect.value = feature.value;
        const match = this.columns.findIndex(
          (meta) =>
            (isCategoryType(meta.type) || meta.type === "string") &&
            this.joinKey(meta.name) === this.joinKey(feature.value),
        );
        if (match >= 0) this.geoMatchSelect.value = String(match);
      }
    }
  }

  private refreshGeoJoin(): void {
    const request = ++this.geoJoinRequest;
    this.geoJoinValues.clear();
    this.geoJoinMin = Number.NaN;
    this.geoJoinMax = Number.NaN;
    if (this.config.kind !== "map" || this.geoDataset === null) return;
    const feature = this.geoFeatureSelect.value;
    const column = Number(this.geoMatchSelect.value);
    if (feature === "" || !Number.isFinite(column) || column < 0) {
      this.render();
      return;
    }
    const measure = Number(this.geoMeasureSelect.value);
    const agg = this.geoAggSelect.value as "count" | "sum" | "mean" | "median" | "min" | "max";
    const def: ViewDef = {
      id: `geo-join-${column}`,
      name: "Map regions",
      dimensions: [{ column, by: "value" }],
      measures: [
        measure >= 0
          ? { column: measure, agg }
          : { column: null, agg: "count" },
      ],
      fill: "none",
      sort: { key: "m0", dir: "desc" },
      limit: 100_000,
      respectFilters: this.config.respectFilters !== false,
      filterColumn: this.config.filterColumn ?? -1,
      filterCode: this.config.filterCode ?? -1,
    };
    void this.options
      .requestAggregate(def)
      .then((result) => {
        if (request !== this.geoJoinRequest || this.disposed) return;
        const labels = result.dimensions[0] ?? [];
        const values = result.measures[0];
        let min = Infinity;
        let max = -Infinity;
        labels.forEach((label, index) => {
          const value = values?.[index] ?? Number.NaN;
          if (!Number.isFinite(value)) return;
          this.geoJoinValues.set(this.joinKey(label), value);
          if (value < min) min = value;
          if (value > max) max = value;
        });
        this.geoJoinMin = min === Infinity ? Number.NaN : min;
        this.geoJoinMax = max === -Infinity ? Number.NaN : max;
        let matched = 0;
        for (const item of this.geoDataset?.features ?? []) {
          const raw = item.properties[feature];
          if (raw !== undefined && raw !== null && this.geoJoinValues.has(this.joinKey(String(raw)))) {
            matched++;
          }
        }
        const total = this.geoDataset?.features.length ?? 0;
        const unmatched = total - matched;
        this.mapLayerStatus.textContent =
          `${total.toLocaleString()} regions · ${matched.toLocaleString()} matched` +
          (unmatched > 0 ? ` · ${unmatched.toLocaleString()} unmatched` : "");
        this.render();
      })
      .catch(() => {
        // Keep the uncoloured regions as the fallback.
      });
  }

  private syncPalette(): void {
    this.paletteSelect.value = this.config.palette ?? DEFAULT_PALETTE;
    this.paletteReverseInput.checked = this.config.paletteReversed === true;
    clear(this.palettePreview);
    for (const color of this.paletteColors(10)) {
      const dot = el("span", { class: "chart-palette-dot" });
      dot.style.background = color;
      this.palettePreview.append(dot);
    }
    const ramp = isRampPalette(this.config.palette ?? DEFAULT_PALETTE);
    this.colorDomainRow.classList.toggle("hidden", !ramp);
    this.colorMinInput.value =
      this.config.colorMin === null || this.config.colorMin === undefined
        ? ""
        : String(this.config.colorMin);
    this.colorMaxInput.value =
      this.config.colorMax === null || this.config.colorMax === undefined
        ? ""
        : String(this.config.colorMax);
  }

  /** Loads a palette from JSON text: array of hex colours or {colors: [...]}. */
  private importPaletteJson(text: string): void {
    const colors = parsePaletteJson(text);
    if (colors === null) {
      this.paletteStatus.textContent =
        "JSON needs an array of 2+ hex colours (or {colors: [...]})";
      return;
    }
    this.config.palette = CUSTOM_PALETTE;
    this.config.paletteCustom = colors.join(", ");
    this.paletteSelect.value = CUSTOM_PALETTE;
    this.paletteStatus.textContent = `Loaded ${colors.length} colours`;
    this.hexInput.value = this.primaryColor();
    this.syncSwatches();
    this.syncPalette();
    this.render();
  }

  /** Picking Custom… asks for hex stops; invalid input keeps the old palette. */
  private async applyPalette(value: string): Promise<void> {
    if (value === CUSTOM_PALETTE) {
      const entered = await openPrompt({
        title: "Custom colour map",
        label: "Hex colours separated by commas (2 or more), e.g. #2563eb, #10b981, #f97316",
        value: this.config.paletteCustom ?? "",
        placeholder: "#2563eb, #f97316",
        confirmLabel: "Use colours",
      });
      if (entered === null) {
        this.syncPalette();
        return;
      }
      const parsed = parseCustomColors(entered);
      if (parsed.length < 2) {
        this.syncPalette();
        return;
      }
      this.config.palette = CUSTOM_PALETTE;
      this.config.paletteCustom = parsed.join(", ");
    } else {
      this.config.palette = value;
    }
    this.hexInput.value = this.primaryColor();
    this.syncSwatches();
    this.syncPalette();
    this.render();
  }

  /** Removing a chart asks first: the action is not part of the Recipe. */
  private confirmRemove(): void {
    void openConfirm({
      title: "Remove this chart?",
      body: `“${this.chartName()}” will be removed from the grid. Chart settings are not part of the Recipe, so this cannot be undone with Undo.`,
      confirmLabel: "Remove",
      danger: true,
    }).then((confirmed) => {
      if (confirmed) this.options.onRemove(this);
    });
  }

  private syncPlaceholder(): void {
    this.titleInput.placeholder = this.defaultTitle();
  }

  private pairLabel(separator: string): string {
    const x = this.meta(this.config.x)?.name ?? "";
    const y = this.meta(this.config.y)?.name ?? "";
    if (x === "" || y === "") return CHART_KIND_LABELS[this.config.kind];
    return `${x} ${separator} ${y}`;
  }

  private defaultTitle(): string {
    if (this.config.kind === "kpi") {
      const measure = this.meta(this.config.valueColumn ?? -1)?.name ?? "Count of rows";
      return defaultChartTitle(measure);
    }
    if (this.usesAggregate()) return "Aggregate";
    if (isPairKind(this.config.kind)) {
      return defaultChartTitle(this.pairLabel("vs"));
    }
    if (this.config.kind === "correlation") {
      return defaultChartTitle("Correlation");
    }
    return defaultChartTitle(this.meta(this.config.column)?.name ?? "");
  }

  /** Duplicate, PNG and remove live behind one ⋯ menu, plus the red ×. */
  private openCardMenu(anchor: HTMLElement): void {
    openMenu(
      anchor,
      [
        {
          label: "Duplicate",
          title: "Duplicate this chart",
          action: () => this.options.onDuplicate(this),
        },
        {
          label: "Download PNG",
          title: "Download this chart as a PNG",
          action: () => this.options.onExport(this),
        },
        {
          label: "Download data (CSV)",
          title: "Download the data behind this chart as a CSV",
          action: () => this.exportCsv(),
        },
        {
          label: "Download chart spec (JSON)",
          title: "Download a versioned, portable description of this chart",
          action: () => this.downloadChartSpec(),
        },
        {
          label: "Download pandas code",
          title: "Download Python that rebuilds the supported chart aggregation",
          action: () => this.downloadChartCode(true),
        },
        {
          label: "Download Polars code",
          title: "Download Polars code that rebuilds the supported chart aggregation",
          action: () => this.downloadChartCode(false),
        },
        {
          label: `${this.config.span === "full" ? "● " : ""}Full row width`,
          title: "Span the whole row, or return to the normal grid cell",
          action: () => this.toggleSpan(),
        },
        {
          label: "Remove chart",
          title: "Remove this chart…",
          action: () => this.confirmRemove(),
        },
      ],
      "context-menu chart-card-menu",
    );
  }

  private chartName(): string {
    if (isPairKind(this.config.kind)) {
      const x = this.meta(this.config.x)?.name ?? "x";
      const y = this.meta(this.config.y)?.name ?? "y";
      return `${x}-vs-${y}`;
    }
    if (this.config.kind === "correlation") return "correlation";
    return this.meta(this.config.column)?.name ?? this.config.kind;
  }

  private resetBinRange(): void {
    const meta = this.meta(this.config.column);
    if (meta === undefined) return;
    const histogram = meta.histogram;
    let min = meta.stats.min ?? histogram?.min ?? 0;
    let max = meta.stats.max ?? histogram?.max ?? 1;
    if (!(max > min)) {
      min -= 1;
      max += 1;
    }
    this.config.binOptions = { min, max, binCount: DEFAULT_BIN_COUNT, overflow: false };
    this.config.binClipped = false;
    this.renderControls();
    this.refreshBins();
    this.render();
  }

  private commitBinOptions(): void {
    const min = parseChartNumber(this.minInput.value);
    const max = parseChartNumber(this.maxInput.value);
    const bins = Number(this.binsInput.value);
    if (min === null || max === null || !Number.isFinite(bins)) {
      this.renderControls();
      return;
    }
    this.config.binOptions = {
      min,
      max,
      binCount: Math.max(1, Math.min(256, Math.floor(bins))),
      overflow: this.overflowInput.checked,
    };
    this.config.binClipped = false;
    // A manual range is the new full view; any drag-zoom no longer applies.
    this.chartXZoom = null;
    this.renderControls();
    this.refreshBins();
    this.render();
  }

  /**
   * Preferred bucket count for a time series: human periods instead of the
   * fixed 64-bin histogram, which turns date-only data into an hourly comb.
   * One extra bucket because the last edge is inclusive of the maximum.
   */
  private preferredLineBins(spanMs: number): number {
    const day = 86_400_000;
    const clamp = (count: number): number => Math.max(2, Math.min(256, count));
    if (!(spanMs > 0)) return 48;
    if (spanMs <= 2 * day) return clamp(Math.ceil(spanMs / (30 * 60_000)) + 1);
    if (spanMs <= 14 * day) return clamp(Math.ceil(spanMs / (6 * 3_600_000)) + 1);
    if (spanMs <= 120 * day) return clamp(Math.ceil(spanMs / day) + 1);
    if (spanMs <= 900 * day) return clamp(Math.ceil(spanMs / (7 * day)) + 1);
    return clamp(Math.ceil(spanMs / (30 * day)) + 1);
  }

  private refreshBins(): void {
    if (this.config.kind === "line") {
      const meta = this.meta(this.config.column);
      const fullMin = meta?.stats.min;
      const fullMax = meta?.stats.max;
      if (
        meta === undefined ||
        (meta.type !== "date" && meta.type !== "datetime") ||
        typeof fullMin !== "number" ||
        typeof fullMax !== "number" ||
        !(fullMax > fullMin)
      ) {
        this.lineBinResult = null;
        return;
      }
      const min = this.chartXZoom?.min ?? fullMin;
      const max = this.chartXZoom?.max ?? fullMax;
      if (!(max > min)) {
        this.lineBinResult = null;
        return;
      }
      const binCount = this.preferredLineBins(max - min);
      // The same column and span produce the same buckets: don't re-request on
      // every filter push (each response used to trigger another repaint).
      const signature = `${this.config.column}|${binCount}|${min}|${max}`;
      if (this.lineBinSignature === signature && this.lineBinResult !== null) return;
      this.lineBinSignature = signature;
      const generation = ++this.generation;
      this.lineBinRange = { min, max };
      void this.options
        .requestBins(this.config.column, { min, max, binCount, overflow: false })
        .then((bins) => {
          if (generation !== this.generation || this.disposed) return;
          this.lineBinResult = bins;
          this.render();
        })
        .catch(() => {
          // Keep the automatic histogram as the fallback.
        });
      this.binResult = null;
      return;
    }
    this.lineBinResult = null;
    this.lineBinRange = null;
    if (this.config.kind !== "histogram") {
      this.binResult = null;
      return;
    }
    const meta = this.meta(this.config.column);
    if (meta === undefined || !isNumericType(meta.type) || this.config.binOptions === null) {
      this.binResult = null;
      return;
    }
    const generation = ++this.generation;
    const column = this.config.column;
    const zoom = this.chartXZoom;
    const binOptions =
      zoom === null
        ? this.config.binOptions
        : {
            ...this.config.binOptions,
            min: zoom.min,
            max: zoom.max,
          };
    void this.options
      .requestBins(column, binOptions)
      .then((bins) => {
        if (generation !== this.generation || this.disposed) return;
        this.binResult = bins;
        this.binMedian = bins.median;
        this.render();
      })
      .catch(() => {
        // Keep the automatic histogram as the fallback.
      });
  }

  /** Every category bar sorted by count; the bar window pans across this. */
  private allCategoryBars(): CategoryBar[] {
    const meta = this.meta(this.config.column);
    const categories = meta?.categories ?? null;
    if (meta === undefined || categories === null) return [];
    const counts = this.facets[this.config.column] ?? categories.counts;
    const total = categories.labels.reduce(
      (sum, _, index) => sum + (counts[index] ?? 0),
      0,
    );
    return categories.labels
      .map((label, index) => {
        const count = counts[index] ?? categories.counts[index] ?? 0;
        return {
          label,
          count,
          pct: total > 0 ? (count / total) * 100 : 0,
        };
      })
      .sort((a, b) => b.count - a.count);
  }

  /** The full data range a line/histogram x axis can zoom within. */
  private xZoomBase(): { min: number; max: number } | null {
    if (this.config.kind === "line") {
      const meta = this.meta(this.config.column);
      const min = meta?.stats.min;
      const max = meta?.stats.max;
      return typeof min === "number" && typeof max === "number" && max > min
        ? { min, max }
        : null;
    }
    if (this.config.kind === "histogram") {
      const options = this.config.binOptions;
      return options !== null && options.max > options.min
        ? { min: options.min, max: options.max }
        : null;
    }
    return null;
  }

  /** Worker scope for the card's own category filter and table-filter toggle. */
  private chartScope(): {
    chartFilter?: { column: number; code: number };
    respectFilters: boolean;
  } {
    const column = this.config.filterColumn ?? -1;
    const code = this.config.filterCode ?? -1;
    return {
      ...(column >= 0 && code >= 0 ? { chartFilter: { column, code } } : {}),
      respectFilters: this.config.respectFilters !== false,
    };
  }

  private refreshSeries(): void {
    if (
      this.config.kind !== "scatter" &&
      this.config.kind !== "density" &&
      this.config.kind !== "map"
    ) {
      this.seriesResult = null;
      return;
    }
    const x = this.meta(this.config.x);
    const y = this.meta(this.config.y);
    const map = this.config.kind === "map";
    if (
      x === undefined ||
      y === undefined ||
      (map ? !isNumericType(x.type) || !isNumericType(y.type) : !this.allowsAxis(x) || !this.allowsAxis(y))
    ) {
      this.seriesResult = null;
      return;
    }
    const generation = ++this.generation;
    const mode: SeriesMode =
      this.config.kind === "density" ? "density" : map ? "points" : this.config.mode;
    void this.options
      .requestSeries({
        xColumn: this.config.x,
        yColumn: this.config.y,
        colorColumn: this.config.colorColumn,
        sizeColumn: this.config.sizeColumn,
        mode,
        limit: POINT_LIMIT,
        clip: !map,
        ...this.chartScope(),
      })
      .then((message) => {
        if (generation !== this.generation || this.disposed) return;
        this.seriesResult = message.result;
        this.seriesLabels = message.colorLabels;
        this.seriesMs = message.ms;
        this.seriesCorrelation = message.correlation;
        this.render();
      })
      .catch(() => {
        // Keep the last payload as the fallback.
      });
  }

  /**
   * Treemap data: counts come from the facets already on the client; a chosen
   * measure asks the aggregation engine for a sum per category.
   */
  private refreshTreemap(): void {
    if (this.config.kind !== "treemap" || this.config.sizeColumn < 0) {
      this.treemapResult = null;
      return;
    }
    const meta = this.meta(this.config.column);
    if (meta === undefined || !isCategoryType(meta.type)) {
      this.treemapResult = null;
      return;
    }
    const generation = ++this.generation;
    const view: ViewDef = {
      id: "chart-treemap",
      name: "Treemap",
      dimensions: [{ column: this.config.column, by: "value" }],
      measures: [{ column: this.config.sizeColumn, agg: "sum" }],
      fill: "none",
      sort: { key: "m0", dir: "desc" },
      limit: 64,
      respectFilters: this.config.respectFilters !== false,
      filterColumn: this.config.filterColumn ?? -1,
      filterCode: this.config.filterCode ?? -1,
    };
    void this.options
      .requestAggregate(view)
      .then((message) => {
        if (generation !== this.generation || this.disposed) return;
        this.treemapResult = {
          labels: message.labels,
          values: [...(message.measures[0] ?? new Float64Array(0))],
        };
        this.render();
      })
      .catch(() => {
        // Keep the last payload as the fallback.
      });
  }

  private drawTreemap(ctx: CanvasRenderingContext2D, frame: Frame): void {
    const meta = this.meta(this.config.column);
    if (meta === undefined || !isCategoryType(meta.type)) {
      const message = "Treemaps need a category column — pick one above.";
      this.noteEl.textContent = message;
      this.drawPlotMessage(ctx, frame, message);
      return;
    }
    if (this.animationResult?.bar !== undefined) {
      this.drawAnimatedTreemap(ctx, frame);
      return;
    }

    let entries: { label: string; value: number; code: number }[];
    const measured = this.config.sizeColumn >= 0;
    if (measured) {
      const result = this.treemapResult;
      if (result === null) {
        const message = "Summing the measure…";
        this.noteEl.textContent = message;
        this.drawPlotMessage(ctx, frame, message);
        return;
      }
      entries = result.labels
        .map((label, index) => ({
          label,
          value: result.values[index] ?? 0,
          code: meta.categories?.labels.indexOf(label) ?? -1,
        }))
        .filter((entry) => entry.value > 0);
    } else {
      const counts = this.facets[this.config.column] ?? meta.categories?.counts ?? [];
      entries = (meta.categories?.labels ?? [])
        .map((label, code) => ({ label, value: counts[code] ?? 0, code }))
        .filter((entry) => entry.value > 0);
    }
    if (entries.length === 0) {
      const message = "No values to plot for this column.";
      this.noteEl.textContent = message;
      this.drawPlotMessage(ctx, frame, message);
      return;
    }

    entries.sort((a, b) => b.value - a.value);
    const cap = Math.max(6, this.config.topN);
    const state =
      this.itemWindow ?? { start: 0, count: Math.min(entries.length, cap) };
    const windowed = this.itemWindow !== null;
    const windowStart = Math.max(0, Math.min(entries.length - 1, state.start));
    const windowCount = Math.max(
      1,
      Math.min(state.count, entries.length - windowStart),
    );
    const shown = windowed
      ? entries.slice(windowStart, windowStart + windowCount)
      : entries.slice(0, cap);
    if (!windowed) {
      const rest = entries.slice(cap);
      if (rest.length > 0) {
        const value = rest.reduce((sum, entry) => sum + entry.value, 0);
        shown.push({ label: `Other (${rest.length})`, value, code: -1 });
      }
    }
    const total = shown.reduce((sum, entry) => sum + entry.value, 0);
    const rects = squarifyLayout(
      shown.map((entry) => entry.value),
      frame.left,
      frame.top,
      frame.plotW,
      frame.plotH,
    );
    const ui = frame.ui;

    this.hitRegions = rects.map((rect, index) => {
      const entry = shown[index] ?? { label: "", value: 0, code: -1 };
      const share = total > 0 ? (entry.value / total) * 100 : 0;
      return {
        x: rect.x,
        y: rect.y,
        w: rect.w,
        h: rect.h,
        lines: [
          entry.label === "" ? "(blank)" : entry.label,
          measured
            ? `sum ${formatChartNumber(entry.value)} · ${share.toFixed(1)}%`
            : `${formatCount(entry.value)} rows · ${share.toFixed(1)}%`,
        ],
        actions:
          entry.code >= 0
            ? [{ kind: "values" as const, column: this.config.column, code: entry.code }]
            : [],
      };
    });

    rects.forEach((rect, index) => {
      const entry = shown[index];
      if (entry === undefined || rect.w <= 0 || rect.h <= 0) return;
      ctx.globalAlpha = 0.85;
      if (this.config.multiColor) {
        ctx.fillStyle = this.paletteColor(index);
      } else {
        ctx.fillStyle = this.primaryColor();
        ctx.globalAlpha = Math.max(0.35, 0.9 - index * 0.06);
      }
      ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = cssVar("--panel", "#ffffff");
      ctx.lineWidth = 1.5;
      ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.w - 1, rect.h - 1);

      if (rect.w < 42 * ui || rect.h < 18 * ui) return;
      ctx.textAlign = "left";
      ctx.fillStyle = "#ffffff";
      this.font(ctx, ui, 11, "600");
      ctx.fillText(
        this.fit(ctx, entry.label === "" ? "(blank)" : entry.label, rect.w - 10 * ui),
        rect.x + 5 * ui,
        rect.y + 14 * ui,
      );
      if (rect.h >= 32 * ui) {
        const share = total > 0 ? (entry.value / total) * 100 : 0;
        this.font(ctx, ui, 10);
        ctx.globalAlpha = 0.85;
        ctx.fillText(
          this.fit(
            ctx,
            measured
              ? `${formatChartNumber(entry.value)} · ${share.toFixed(1)}%`
              : `${formatCount(entry.value)} · ${share.toFixed(1)}%`,
            rect.w - 10 * ui,
          ),
          rect.x + 5 * ui,
          rect.y + 27 * ui,
        );
        ctx.globalAlpha = 1;
      }
    });
    ctx.textAlign = "left";

    const notes = [`${shown.length} tiles`];
    notes.push(
      measured
        ? `Σ ${formatChartNumber(total)}`
        : `${formatCount(total)} rows`,
    );
    if (windowed) {
      notes.push(`${shown.length} of ${entries.length} tiles shown`);
    } else {
      const restCount = Math.max(0, entries.length - Math.min(entries.length, cap));
      if (restCount > 0) notes.push(`${restCount} rest as Other`);
    }
    if (this.statsMs > 0) notes.push(`${Math.round(this.statsMs)} ms`);
    this.noteEl.textContent = notes.join(" · ");
  }

  /**
   * Top-terms data: token frequencies with stopword filtering and the share of
   * shaped values (email/URL/phone/number/date) for the selected text column.
   */
  private refreshText(): void {
    if (this.config.kind !== "terms") {
      this.textResult = null;
      return;
    }
    const meta = this.meta(this.config.column);
    if (meta === undefined || meta.type !== "string") {
      this.textResult = null;
      return;
    }
    const generation = ++this.generation;
    const column = this.config.column;
    void this.options
      .requestTextProfile(column)
      .then((message) => {
        if (generation !== this.generation || this.disposed) return;
        this.textResult = message;
        this.render();
      })
      .catch(() => {
        // Keep the last payload as the fallback.
      });
  }

  /** Horizontal bars of the most frequent terms; clicking filters by term. */
  private drawTerms(ctx: CanvasRenderingContext2D, frame: Frame): void {
    const meta = this.meta(this.config.column);
    if (meta === undefined || meta.type !== "string") {
      const message = "Top terms need a text column — pick one above.";
      this.noteEl.textContent = message;
      this.drawPlotMessage(ctx, frame, message);
      return;
    }
    const result = this.textResult;
    if (result === null) {
      const message = "Reading the text…";
      this.noteEl.textContent = message;
      this.drawPlotMessage(ctx, frame, message);
      return;
    }
    const profile = result.profile;
    const baseTerms = profile.topTerms.slice(0, Math.max(8, this.config.topN));
    const state =
      this.itemWindow ?? { start: 0, count: Math.min(baseTerms.length, Math.max(8, this.config.topN)) };
    const start = Math.max(0, Math.min(baseTerms.length - 1, state.start));
    const terms = baseTerms.slice(
      start,
      start + Math.max(1, Math.min(state.count, baseTerms.length - start)),
    );
    if (terms.length === 0) {
      const message =
        "No terms found — the column may be mostly numbers, single letters or stopwords.";
      this.noteEl.textContent = message;
      this.drawPlotMessage(ctx, frame, message);
      return;
    }
    const ui = frame.ui;
    const max = terms[0]?.count ?? 1;
    const rowH = Math.min(30 * ui, frame.plotH / terms.length);
    const labelW = Math.min(150 * ui, frame.plotW * 0.4);
    const barTrackW = Math.max(20 * ui, frame.plotW - labelW - 56 * ui);

    this.hitRegions = terms.map((entry, index) => ({
      x: frame.left,
      y: frame.top + index * rowH,
      w: frame.plotW,
      h: rowH,
      lines: [
        `“${entry.term}”`,
        `${formatCount(entry.count)} tokens · ${(
          profile.totalTokens > 0 ? (entry.count / profile.totalTokens) * 100 : 0
        ).toFixed(1)}%`,
        "click to filter rows containing this term",
      ],
      actions: [{ kind: "text" as const, column: this.config.column, query: entry.term }],
    }));

    terms.forEach((entry, index) => {
      const y = frame.top + index * rowH;
      ctx.textAlign = "left";
      ctx.fillStyle = frame.text;
      this.font(ctx, ui, 11, "600");
      ctx.fillText(
        this.fit(ctx, entry.term, labelW - 6 * ui),
        frame.left,
        y + rowH * 0.68,
      );
      const width = Math.max(2, (entry.count / max) * barTrackW);
      ctx.fillStyle = this.primaryColor();
      ctx.globalAlpha = Math.max(0.25, 0.85 - index * 0.05);
      ctx.fillRect(frame.left + labelW, y + rowH * 0.24, width, rowH * 0.5);
      ctx.globalAlpha = 1;
      const share = profile.totalTokens > 0 ? (entry.count / profile.totalTokens) * 100 : 0;
      ctx.fillStyle = frame.dim;
      this.font(ctx, ui, 10);
      ctx.fillText(
        `${formatCount(entry.count)} · ${share.toFixed(1)}%`,
        frame.left + labelW + width + 6 * ui,
        y + rowH * 0.68,
      );
    });
    ctx.textAlign = "left";

    const notes = [
      `${terms.length} terms`,
      `${formatCount(profile.totalTokens)} tokens`,
      `${formatCount(profile.distinctTerms)} distinct`,
    ];
    if (result.ms > 0) notes.push(`${Math.round(result.ms)} ms`);
    this.noteEl.textContent = notes.join(" · ");
  }

  private refreshBox(): void {
    if (this.config.kind !== "box") {
      this.boxResult = null;
      return;
    }
    const value = this.meta(this.config.x);
    const category = this.meta(this.config.y);
    if (
      value === undefined ||
      category === undefined ||
      !isNumericType(value.type) ||
      !isCategoryType(category.type)
    ) {
      this.boxResult = null;
      return;
    }
    const generation = ++this.generation;
    void this.options
      .requestBoxStats({
        valueColumn: this.config.x,
        categoryColumn: this.config.y,
        topN: this.config.topN,
        groupOther: this.config.groupOther,
        ...this.chartScope(),
      })
      .then((message) => {
        if (generation !== this.generation || this.disposed) return;
        this.boxResult = message.result;
        this.statsMs = message.ms;
        this.render();
      })
      .catch(() => {
        // Keep the last payload as the fallback.
      });
  }

  private refreshCrosstab(): void {
    if (this.config.kind !== "heatmap") {
      this.crossResult = null;
      return;
    }
    const x = this.meta(this.config.x);
    const y = this.meta(this.config.y);
    if (
      x === undefined ||
      y === undefined ||
      !isCategoryType(x.type) ||
      !isCategoryType(y.type)
    ) {
      this.crossResult = null;
      return;
    }
    const generation = ++this.generation;
    void this.options
      .requestCrosstab({
        xColumn: this.config.x,
        yColumn: this.config.y,
        topX: this.config.topN,
        topY: this.config.topN,
        groupOther: this.config.groupOther,
        ...this.chartScope(),
      })
      .then((message) => {
        if (generation !== this.generation || this.disposed) return;
        this.crossResult = message.result;
        this.statsMs = message.ms;
        this.render();
      })
      .catch(() => {
        // Keep the last payload as the fallback.
      });
  }

  /** Bubble measure: rows per cell, or sum/mean/min/max of a numeric column. */
  private bubbleMeasure(): { column: number; agg: "sum" | "mean" | "min" | "max" } | undefined {
    const agg = this.config.bubbleAgg ?? "count";
    if (agg === "count" || this.config.sizeColumn < 0) return undefined;
    const meta = this.meta(this.config.sizeColumn);
    if (meta === undefined || !isNumericType(meta.type)) return undefined;
    return { column: this.config.sizeColumn, agg };
  }

  /** Group column for bubble sets, when one is chosen and category-typed. */
  private bubbleGroupColumn(): number | undefined {
    if (this.config.groupColumn < 0) return undefined;
    const meta = this.meta(this.config.groupColumn);
    return meta !== undefined && isCategoryType(meta.type) ? this.config.groupColumn : undefined;
  }

  /** Row counts per x/y grid cell for the bubble chart. */
  private refreshBubble(): void {
    if (this.config.kind !== "bubble" || this.options.requestGridCounts === undefined) {
      this.bubbleResult = null;
      return;
    }
    const x = this.meta(this.config.x);
    const y = this.meta(this.config.y);
    if (
      x === undefined ||
      y === undefined ||
      !isNumericType(x.type) ||
      !isNumericType(y.type)
    ) {
      this.bubbleResult = null;
      return;
    }
    const generation = ++this.generation;
    void this.options
      .requestGridCounts(
        this.config.x,
        this.config.y,
        this.config.bubbleBins ?? 40,
        this.bubbleMeasure(),
        this.bubbleGroupColumn(),
        this.chartScope(),
      )
      .then((message) => {
        if (generation !== this.generation || this.disposed) return;
        this.bubbleResult = message.result;
        this.statsMs = message.ms;
        this.render();
      })
      .catch(() => {
        // Keep the last payload as the fallback.
      });
  }

  /**
   * Map heat grid: counts (or an aggregate of a numeric measure) per cell over
   * the filtered coordinate rows, computed worker-side so every row counts.
   */
  private refreshMapGrid(): void {
    if (
      this.config.kind !== "map" ||
      this.config.mapMode !== "heat" ||
      this.options.requestGridCounts === undefined
    ) {
      this.mapGrid = null;
      return;
    }
    const x = this.meta(this.config.x);
    const y = this.meta(this.config.y);
    if (
      x === undefined ||
      y === undefined ||
      !isNumericType(x.type) ||
      !isNumericType(y.type)
    ) {
      this.mapGrid = null;
      return;
    }
    const generation = ++this.generation;
    void this.options
      .requestGridCounts(
        this.config.x,
        this.config.y,
        this.config.bubbleBins ?? 40,
        this.bubbleMeasure(),
        undefined,
        this.chartScope(),
      )
      .then((message) => {
        if (generation !== this.generation || this.disposed) return;
        this.mapGrid = message.result;
        this.render();
      })
      .catch(() => {
        // Keep the last payload as the fallback.
      });
  }

  /**
   * Frames for animated bar and bubble charts: one aggregate per time bucket,
   * computed worker-side in a single pass over the filtered rows.
   */
  private refreshAnimation(): void {
    this.stopAnimation();
    const timeColumn = this.config.animationTimeColumn ?? -1;
    const kind = this.config.kind;
    const animatable =
      kind === "bar" ||
      kind === "bubble" ||
      kind === "histogram" ||
      kind === "treemap" ||
      kind === "density";
    const request = this.options.requestAnimation;
    if (
      !animatable ||
      timeColumn < 0 ||
      request === undefined ||
      this.config.source !== ""
    ) {
      this.animationResult = null;
      return;
    }
    const timeMeta = this.meta(timeColumn);
    if (!this.isDateLike(timeMeta)) {
      this.animationResult = null;
      return;
    }
    const isPair = kind === "bubble" || kind === "density";
    const isCategory = kind === "bar" || kind === "treemap";
    if (isPair) {
      const x = this.meta(this.config.x);
      const y = this.meta(this.config.y);
      if (
        x === undefined ||
        y === undefined ||
        !isNumericType(x.type) ||
        !isNumericType(y.type)
      ) {
        this.animationResult = null;
        return;
      }
    } else if (isCategory) {
      const column = this.meta(this.config.column);
      if (column === undefined || !isCategoryType(column.type)) {
        this.animationResult = null;
        return;
      }
    } else {
      const column = this.meta(this.config.column);
      if (column === undefined || !isNumericType(column.type)) {
        this.animationResult = null;
        return;
      }
    }
    const generation = ++this.generation;
    this.animationFrame = 0;
    const chart: "bar" | "bubble" | "histogram" = isPair
      ? "bubble"
      : isCategory
        ? "bar"
        : "histogram";
    const histogramBins =
      this.binResult?.bins.length ??
      this.meta(this.config.column)?.histogram?.bins.length ??
      32;
    void request({
      timeColumn,
      grain: this.config.animationGrain ?? "day",
      chart,
      column: isPair ? this.config.x : this.config.column,
      yColumn: isPair ? this.config.y : -1,
      bins: chart === "histogram" ? histogramBins : (this.config.bubbleBins ?? 40),
      topN: this.config.topN,
      measure: isPair ? this.bubbleMeasure() : undefined,
      // Density is a single aggregate heat map, so grouping is ignored there;
      // bubble charts carry the group dimension.
      groupColumn: kind === "bubble" ? this.bubbleGroupColumn() : undefined,
      ...this.chartScope(),
    })
      .then((message) => {
        if (generation !== this.generation || this.disposed) return;
        this.animationResult = message.result;
        this.statsMs = message.ms;
        this.animationFrame = 0;
        this.render();
      })
      .catch((error: unknown) => {
        if (generation !== this.generation || this.disposed) return;
        this.animationResult = null;
        this.noteEl.textContent =
          error instanceof Error ? error.message : "Could not build the animation frames.";
        this.render();
      });
  }

  private toggleSpan(): void {
    this.config.span = this.config.span === "full" ? "auto" : "full";
    this.applySpan();
  }

  /** Applies the full-row width class and keeps the button state in sync. */
  private applySpan(): void {
    const full = this.config.span === "full";
    this.root.classList.toggle("span-full", full);
    this.widthButton.classList.toggle("active", full);
    this.widthButton.title = full
      ? "Back to the normal grid cell width"
      : "Make this chart span the full row";
  }

  /**
   * Expand/focus mode: the same card element moves into a full-viewport
   * overlay, so every setting, the loaded data and the scroll-independent
   * canvas size are retained. Closing (button or Escape) restores the card
   * to its grid slot.
   */
  private toggleFocus(): void {
    if (this.focusOverlay !== null) {
      this.closeFocus();
      return;
    }
    const overlay = el("div", {
      class: "chart-focus-overlay",
      role: "dialog",
      "aria-label": "Expanded chart",
      tabindex: "-1",
    }) as HTMLElement;
    const close = el(
      "button",
      { class: "icon-btn chart-focus-close", type: "button", title: "Close (Esc)" },
      ["×"],
    ) as HTMLButtonElement;
    close.addEventListener("click", () => this.closeFocus());
    const stage = el("div", { class: "chart-focus-stage" });
    overlay.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        this.closeFocus();
      }
    });
    this.root.parentNode?.insertBefore(this.focusPlaceholder, this.root);
    stage.append(this.root);
    overlay.append(close, stage);
    document.body.append(overlay);
    this.focusOverlay = overlay;
    this.root.classList.add("focused");
    this.focusButton.classList.add("active");
    this.focusButton.title = "Back to the grid (Esc)";
    overlay.focus();
    this.render();
  }

  private closeFocus(): void {
    const overlay = this.focusOverlay;
    if (overlay === null) return;
    this.focusOverlay = null;
    this.focusPlaceholder.parentNode?.insertBefore(this.root, this.focusPlaceholder);
    this.focusPlaceholder.remove();
    overlay.remove();
    this.root.classList.remove("focused");
    this.focusButton.classList.remove("active");
    this.focusButton.title = "Expand this chart for a closer look (Esc to close)";
    this.render();
  }

  private toggleAnimationSetup(): void {    if (!this.columns.some((meta) => this.isDateLike(meta))) {
      this.noteEl.textContent = "Animating needs a date or datetime column in the file.";
      return;
    }
    this.animationSetupOpen = !this.animationSetupOpen;
    this.renderControls();
  }

  private toggleAnimation(): void {
    if (this.animationPlaying) this.stopAnimation();
    else this.playAnimation();
  }

  /** Milliseconds per frame: 0.5 s at 1×, faster at higher speeds. */
  private frameIntervalMs(): number {
    const speed = this.config.animationSpeed ?? 1;
    const safe = Number.isFinite(speed) && speed > 0 ? speed : 1;
    return Math.max(60, Math.round(500 / safe));
  }

  private setAnimationSpeed(speed: number): void {
    this.config.animationSpeed = speed;
    if (this.animationPlaying) {
      this.stopAnimation();
      this.playAnimation();
    }
    this.syncAnimationBar();
  }

  /** Custom speed prompt; the presets cover the common cases. */
  private async promptAnimationSpeed(): Promise<void> {
    const entered = await openPrompt({
      title: "Custom play speed",
      label: "Multiplier, e.g. 0.25 (slower) to 8 (faster). 1× is one frame every 0.5 s.",
      value: String(this.config.animationSpeed ?? 1),
      placeholder: "1.25",
      confirmLabel: "Use speed",
    });
    const parsed = Number(entered?.trim() ?? "");
    if (entered === null || !Number.isFinite(parsed) || parsed <= 0) {
      this.syncAnimationBar();
      return;
    }
    this.setAnimationSpeed(Math.min(20, Math.max(0.05, parsed)));
  }

  private playAnimation(): void {
    const result = this.animationResult;
    if (result === null || result.frames.length === 0) return;
    if (this.animationTimer !== null) window.clearInterval(this.animationTimer);
    this.animationPlaying = true;
    this.animationTimer = window.setInterval(() => {
      const current = this.animationResult;
      if (this.disposed || current === null) {
        this.stopAnimation();
        return;
      }
      const last = current.frames.length - 1;
      if (this.animationFrame >= last) {
        if (this.animationLoopInput.checked) this.animationFrame = 0;
        else {
          this.stopAnimation();
          return;
        }
      } else {
        this.animationFrame++;
      }
      this.render();
    }, this.frameIntervalMs());
    this.syncAnimationBar();
  }

  private stopAnimation(): void {
    if (this.animationTimer !== null) {
      window.clearInterval(this.animationTimer);
      this.animationTimer = null;
    }
    this.animationPlaying = false;
    this.syncAnimationBar();
  }

  /** Playback bar state: visible only while frames exist. */
  private syncAnimationBar(): void {
    const result = this.animationResult;
    const active = result !== null && result.frames.length > 1;
    this.animationBar.classList.toggle("hidden", !active);
    if (!active || result === null) return;
    this.animationPlayButton.textContent = this.animationPlaying ? "❚❚ Pause" : "▶ Play";
    this.animationSlider.max = String(result.frames.length - 1);
    this.animationSlider.value = String(this.animationFrame);
    const speed = this.config.animationSpeed ?? 1;
    const presets = ["0.5", "0.75", "1", "1.25", "1.5", "2"];
    this.animationSpeedSelect.value = presets.includes(String(speed)) ? String(speed) : "custom";
    const customOption = [...this.animationSpeedSelect.options].find(
      (option) => option.value === "custom",
    );
    if (customOption !== undefined) {
      customOption.textContent = presets.includes(String(speed)) ? "Custom…" : `Custom (${speed}×)`;
    }
    const frame = result.frames[this.animationFrame];
    this.animationFrameLabel.textContent = frame?.label ?? "";
  }

  private openExportMenu(anchor: HTMLElement): void {
    openMenu(anchor, [
      {
        label: "Animated GIF (.gif)",
        title: "Loops anywhere, but some desktop viewers (e.g. Windows Photos) show only the first frame",
        action: () => void this.exportAnimationGif(),
      },
      {
        label: "Video (.mp4)",
        title: "H.264 video that plays in every desktop player and presentation tool",
        action: () => void this.exportAnimationVideo(),
      },
    ]);
  }

  /**
   * Draws every animation frame to an offscreen canvas (2× the card size)
   * with an opaque panel background. Shared by the GIF and MP4 encoders so
   * both formats show exactly the same pixels.
   */
  private async renderAnimationFrames(): Promise<
    { frames: GifFrameInput[]; width: number; height: number } | null
  > {
    const result = this.animationResult;
    if (result === null || result.frames.length < 2) {
      this.noteEl.textContent =
        "Set up an animation first — pick a time column and frame length above.";
      return null;
    }
    this.stopAnimation();
    const cssWidth = Math.max(
      1,
      Math.round(Number.parseFloat(this.canvas.style.width) || this.canvas.clientWidth || 480),
    );
    const cssHeight = Math.max(
      1,
      Math.round(Number.parseFloat(this.canvas.style.height) || this.canvas.clientHeight || 270),
    );
    const scale = 2;
    const offscreen = document.createElement("canvas");
    offscreen.width = cssWidth * scale;
    offscreen.height = cssHeight * scale;
    const ctx = offscreen.getContext("2d");
    if (ctx === null) {
      this.noteEl.textContent = "Canvas rendering is not available in this browser.";
      return null;
    }
    const previous = this.animationFrame;
    const frames: GifFrameInput[] = [];
    try {
      for (let index = 0; index < result.frames.length; index++) {
        this.animationFrame = index;
        ctx.setTransform(scale, 0, 0, scale, 0, 0);
        this.drawChart(ctx, cssWidth, cssHeight, true);
        // Opaque background: paint behind the chart (drawChart clears first),
        // because a transparent frame reads as black in many viewers.
        ctx.globalCompositeOperation = "destination-over";
        ctx.fillStyle = cssVar("--panel", "#ffffff");
        ctx.fillRect(0, 0, cssWidth, cssHeight);
        ctx.globalCompositeOperation = "source-over";
        const image = ctx.getImageData(0, 0, offscreen.width, offscreen.height);
        frames.push({ data: image.data, width: offscreen.width, height: offscreen.height });
        if (index % 4 === 3) {
          this.noteEl.textContent = `Rendering frame ${index + 1} of ${result.frames.length}…`;
          await new Promise((resolve) => window.setTimeout(resolve, 0));
        }
      }
    } finally {
      this.animationFrame = previous;
      this.render();
    }
    return { frames, width: offscreen.width, height: offscreen.height };
  }

  /** Versioned ChartSpec JSON: portable across config changes and code export. */
  private downloadChartSpec(): void {
    if (typeof URL.createObjectURL !== "function") return;
    const sourceName =
      this.config.source === ""
        ? this.options.tableSourceLabel?.() ?? "Table"
        : (this.sources.find((source) => source.id === this.config.source)?.name ??
          this.config.source);
    const spec = chartSpecFromConfig(this.config, this.columns, sourceName);
    const url = URL.createObjectURL(
      new Blob([chartSpecJson(spec)], { type: "application/json" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${safeFileName(this.options.datasetName())}-${safeFileName(
      this.chartName(),
    )}-chart-spec.json`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  /** Python code for the supported subset of the current ChartSpec. */
  private downloadChartCode(pandas: boolean): void {
    if (typeof URL.createObjectURL !== "function") return;
    const sourceName =
      this.config.source === ""
        ? this.options.tableSourceLabel?.() ?? "Table"
        : (this.sources.find((source) => source.id === this.config.source)?.name ??
          this.config.source);
    const spec = chartSpecFromConfig(this.config, this.columns, sourceName);
    const generated = pandas ? chartSpecToPandas(spec) : chartSpecToPolars(spec);
    if (generated.code === "") {
      this.noteEl.textContent =
        generated.warnings[0] ?? "No code can be generated for this chart yet.";
      return;
    }
    const header = generated.warnings
      .map((warning) => `# Note: ${warning}`)
      .join("\n");
    const content = header === "" ? generated.code : `${header}\n${generated.code}`;
    const url = URL.createObjectURL(new Blob([content], { type: "text/x-python" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${safeFileName(this.options.datasetName())}-${safeFileName(
      this.chartName(),
    )}-${pandas ? "pandas" : "polars"}.py`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  private downloadBlob(blob: Blob, extension: string): void {
    if (typeof URL.createObjectURL !== "function") return;
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${safeFileName(this.options.datasetName())}-${safeFileName(
      this.chartName(),
    )}-animation.${extension}`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  /** Encodes the rendered frames as an animated GIF at the chosen speed. */
  private async exportAnimationGif(): Promise<void> {
    const rendered = await this.renderAnimationFrames();
    if (rendered === null) return;
    try {
      const bytes = encodeGif(rendered.frames, this.frameIntervalMs());
      if (bytes.length === 0) {
        this.noteEl.textContent = "Could not encode the GIF in this browser.";
        return;
      }
      this.downloadBlob(new Blob([bytes as BlobPart], { type: "image/gif" }), "gif");
      const seconds = ((rendered.frames.length * this.frameIntervalMs()) / 1000).toFixed(1);
      this.noteEl.textContent = `Exported ${rendered.frames.length} frames as a GIF · ${seconds} s per loop · ${(
        bytes.length / 1024
      ).toFixed(0)} KB · some desktop viewers show only the first frame, use Video (.mp4) if so`;
    } catch {
      this.noteEl.textContent = "Could not encode the GIF in this browser.";
    }
  }

  /**
   * Encodes the rendered frames as an H.264 MP4 with WebCodecs. Videos play
   * in every desktop player, unlike animated GIFs in some viewers.
   */
  private async exportAnimationVideo(): Promise<void> {
    const encoderCtor = (
      globalThis as {
        VideoEncoder?: {
          new (init: {
            output: (chunk: EncodedVideoChunk, meta?: EncodedVideoChunkMetadata) => void;
            error: (error: Error) => void;
          }): VideoEncoder;
          isConfigSupported(config: VideoEncoderConfig): Promise<VideoEncoderSupport>;
        };
      }
    ).VideoEncoder;
    if (typeof encoderCtor !== "function") {
      this.noteEl.textContent =
        "Video export needs WebCodecs (Chrome, Edge or Safari 16.4+). Try the GIF format instead.";
      return;
    }
    const rendered = await this.renderAnimationFrames();
    if (rendered === null) return;
    const { frames, width, height } = rendered;
    // H.264 needs even dimensions.
    const codedWidth = width % 2 === 0 ? width : width + 1;
    const codedHeight = height % 2 === 0 ? height : height + 1;
    const fps = Math.max(1, Math.round(1000 / this.frameIntervalMs()));
    try {
      const { Muxer, ArrayBufferTarget } = await import("mp4-muxer");
      // Prefer H.264 (plays everywhere); fall back to VP9-in-MP4 where the
      // platform exposes no H.264 encoder.
      const candidates: {
        codec: string;
        muxerCodec: "avc" | "vp9";
      }[] = [
        { codec: "avc1.42001f", muxerCodec: "avc" },
        { codec: "avc1.4d002a", muxerCodec: "avc" },
        { codec: "vp09.00.10.08", muxerCodec: "vp9" },
      ];
      let chosen: (typeof candidates)[number] | null = null;
      for (const candidate of candidates) {
        try {
          const support = await encoderCtor.isConfigSupported({
            codec: candidate.codec,
            width: codedWidth,
            height: codedHeight,
            bitrate: 4_000_000,
            framerate: fps,
          });
          if (support.supported === true) {
            chosen = candidate;
            break;
          }
        } catch {
          // Try the next codec.
        }
      }
      if (chosen === null) {
        this.noteEl.textContent =
          "This browser cannot encode video (no H.264 or VP9 encoder). Use the GIF format instead.";
        return;
      }
      const muxer = new Muxer({
        target: new ArrayBufferTarget(),
        video: { codec: chosen.muxerCodec, width: codedWidth, height: codedHeight },
        fastStart: "in-memory",
      });
      let encodeError: Error | null = null;
      const encoder = new encoderCtor({
        output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
        error: (error) => {
          encodeError = error;
        },
      });
      encoder.configure({
        codec: chosen.codec,
        width: codedWidth,
        height: codedHeight,
        bitrate: 4_000_000,
        framerate: fps,
      });
      const durationUs = (this.frameIntervalMs() * 1000) / 1;
      for (let index = 0; index < frames.length; index++) {
        const frame = frames[index];
        if (frame === undefined) continue;
        const videoFrame = new VideoFrame(frame.data, {
          format: "RGBA",
          codedWidth,
          codedHeight,
          timestamp: Math.round(index * durationUs),
          duration: Math.round(durationUs),
        });
        encoder.encode(videoFrame, { keyFrame: index === 0 || index % 30 === 0 });
        videoFrame.close();
        if (encoder.encodeQueueSize > 8) {
          await new Promise((resolve) => window.setTimeout(resolve, 0));
        }
      }
      await encoder.flush();
      encoder.close();
      if (encodeError !== null) throw encodeError;
      muxer.finalize();
      const buffer = muxer.target.buffer;
      this.downloadBlob(new Blob([buffer], { type: "video/mp4" }), "mp4");
      const seconds = (frames.length / fps).toFixed(1);
      this.noteEl.textContent = `Exported ${frames.length} frames as an MP4 · ${seconds} s per loop · ${(
        buffer.byteLength / 1024
      ).toFixed(0)} KB`;
    } catch (error) {
      this.noteEl.textContent =
        error instanceof Error && error.message !== ""
          ? `Could not encode the video: ${error.message}`
          : "Could not encode the video in this browser.";
    }
  }

  private refreshCorrelation(): void {
    if (this.config.kind !== "correlation") {
      this.correlationResult = null;
      return;
    }
    const columns = this.config.correlationColumns.filter((index) => {
      const meta = this.meta(index);
      return meta !== undefined && isNumericType(meta.type);
    });
    if (columns.length < 2) {
      this.correlationResult = null;
      return;
    }
    const generation = ++this.generation;
    void this.options
      .requestCorrelation(columns, this.chartScope())
      .then((message) => {
        if (generation !== this.generation || this.disposed) return;
        this.correlationResult = {
          labels: message.labels,
          values: message.result.values,
          counts: message.result.counts,
        };
        this.statsMs = message.ms;
        this.render();
      })
      .catch(() => {
        // Keep the last payload as the fallback.
      });
  }

  /**
   * Bins per category for a grouped time series. Uses the column's automatic
   * range so the grouped and ungrouped axes line up.
   */
  private refreshGroupedBins(): void {
    const groupedKind = this.config.kind === "line" || this.config.kind === "histogram";
    if (!groupedKind || this.config.groupColumn < 0) {
      this.groupResult = null;
      return;
    }
    const request = this.options.requestGroupedBins;
    if (request === undefined) {
      this.groupResult = null;
      return;
    }
    const meta = this.meta(this.config.column);
    const groupMeta = this.meta(this.config.groupColumn);
    const numericAxis = meta !== undefined && isNumericLikeType(meta.type);
    if (
      meta === undefined ||
      !numericAxis ||
      meta.histogram === null ||
      groupMeta === undefined ||
      !isCategoryType(groupMeta.type)
    ) {
      this.groupResult = null;
      return;
    }
    const histogram = meta.histogram;
    const options: ChartBinOptions = {
      min: histogram.min,
      max: histogram.max,
      binCount: histogram.bins.length === 0 ? DEFAULT_BIN_COUNT : histogram.bins.length,
      overflow: false,
    };
    const generation = ++this.generation;
    const column = this.config.column;
    const groupColumn = this.config.groupColumn;
    void request({ column, groupColumn, options, topN: GROUP_LINE_LIMIT })
      .then((message) => {
        if (generation !== this.generation || this.disposed) return;
        this.groupResult = message;
        this.render();
      })
      .catch(() => {
        // Keep the automatic single line as the fallback.
      });
  }

  /** Coalesces resize-driven redraws into one animation frame. */
  /**
   * Coalesces resize-driven redraws into one animation frame. Repaints are
   * skipped when the wrap width has not actually changed: the canvas height is
   * derived from the width, so reacting to every wrap mutation can oscillate
   * (scrollbar thresholds, sticky layouts). Theme changes force a repaint.
   */
  private scheduleRender(force = false): void {
    if (this.disposed) return;
    this.renderForce = this.renderForce || force;
    if (this.renderQueued) return;
    this.renderQueued = true;
    const run = (): void => {
      const forceNow = this.renderForce;
      this.renderQueued = false;
      this.renderForce = false;
      if (this.disposed) return;
      if (!forceNow) {
        const wrap = this.canvas.parentElement;
        const width = Math.round(wrap?.clientWidth ?? 0);
        if (width <= 1 || width === this.lastWrapWidth) return;
      }
      this.render();
    };
    if (typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(run);
    } else {
      window.setTimeout(run, 16);
    }
  }

  private render(): void {
    this.syncScope();
    this.canvas.setAttribute("aria-label", this.canvasLabel());
    const wrap = this.canvas.parentElement;
    let cssWidth = 640;
    if (wrap !== null) {
      const style = getComputedStyle(wrap);
      const padding =
        (Number.parseFloat(style.paddingLeft) || 0) + (Number.parseFloat(style.paddingRight) || 0);
      cssWidth = wrap.clientWidth - padding;
      this.lastWrapWidth = Math.round(wrap.clientWidth);
    }
    // The canvas follows the card at any width; text has a legibility floor
    // instead of the old 300px minimum that overflowed narrow cards.
    cssWidth = Math.max(1, Math.round(cssWidth));
    const cssHeight = Math.round((cssWidth * 9) / 16);
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(cssWidth * dpr);
    this.canvas.height = Math.round(cssHeight * dpr);
    this.canvas.style.width = `${cssWidth}px`;
    this.canvas.style.height = `${cssHeight}px`;
    const ctx = this.canvas.getContext("2d");
    if (ctx === null) {
      this.noteEl.textContent = "Canvas rendering is not available in this browser.";
      return;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.drawChart(ctx, cssWidth, cssHeight);
    this.syncLegend();
    this.syncAnimationBar();
    const zoomable =
      this.config.kind === "map" ||
      this.config.kind === "scatter" ||
      this.config.kind === "density" ||
      this.config.kind === "bubble" ||
      this.config.kind === "line" ||
      this.config.kind === "histogram" ||
      this.config.kind === "bar" ||
      this.config.kind === "heatmap" ||
      this.config.kind === "box" ||
      this.config.kind === "correlation" ||
      this.config.kind === "treemap" ||
      this.config.kind === "terms";
    this.resetViewButton.classList.toggle(
      "hidden",
      !(
        this.mapView !== null ||
        this.plotView !== null ||
        this.chartXZoom !== null ||
        this.barWindow !== null ||
        this.heatWindow !== null ||
        this.boxWindow !== null ||
        this.boxY !== null ||
        this.corrWindow !== null ||
        this.itemWindow !== null
      ),
    );
    this.canvas.style.cursor = zoomable
      ? this.mapDrag !== null || this.plotDrag !== null
        ? "grabbing"
        : "grab"
      : "";
  }

  /** Generated text alternative for the canvas, updated on every redraw. */
  private canvasLabel(): string {
    const rows = this.rowCount.toLocaleString();
    const name = (index: number): string => this.meta(index)?.name ?? "";
    switch (this.config.kind) {
      case "line": {
        const group = this.meta(this.config.groupColumn);
        return group === undefined
          ? `Time series of ${name(this.config.column)}, ${rows} rows shown`
          : `Time series of ${name(this.config.column)} by ${group.name}, ${rows} rows shown`;
      }
      case "bar":
        return `Count plot of ${name(this.config.column)}, ${rows} rows shown`;
      case "barplot":
        return `Barplot of ${this.config.valueAgg ?? "mean"}(${name(
          this.config.valueColumn ?? -1,
        )}) by ${name(this.config.column)}, ${rows} rows shown`;
      case "scatter":
        return `Scatter of ${name(this.config.x)} vs ${name(this.config.y)}, ${rows} rows shown`;
      case "density":
        return `Density plot of ${name(this.config.x)} vs ${name(this.config.y)}, ${rows} rows shown`;
      case "box":
        return `Box plot of ${name(this.config.x)} by ${name(this.config.y)}, ${rows} rows shown`;
      case "treemap":
        return `Treemap of ${name(this.config.column)}, ${rows} rows shown`;
      case "terms":
        return `Top terms in ${name(this.config.column)}, ${rows} rows shown`;
      case "heatmap":
        return `Heatmap of ${name(this.config.x)} × ${name(this.config.y)}, ${rows} rows shown`;
      case "correlation":
        return `Correlation matrix of ${this.config.correlationColumns.length} columns, ${rows} rows shown`;
      default: {
        const column = name(this.config.column);
        return column === ""
          ? `Histogram, ${rows} rows shown`
          : `Histogram of ${column}, ${rows} rows shown`;
      }
    }
  }

  /** Coalesces pointer moves into one tooltip update per animation frame. */
  private queuePointer(event: PointerEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    if (this.config.kind === "map" && this.mapDrag !== null && this.lastFrame !== null) {
      const frame = this.lastFrame;
      const dx = (event.clientX - rect.left - this.mapDrag.x) / frame.plotW;
      const dy = (event.clientY - rect.top - this.mapDrag.y) / frame.plotH;
      this.dragMoved = true;
      this.mapDrag = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      const view = this.mapView ?? { lonMin: -180, lonMax: 180, latMin: -90, latMax: 90 };
      const lonSpan = view.lonMax - view.lonMin;
      const latSpan = view.latMax - view.latMin;
      const lonMin = Math.min(
        180 - lonSpan,
        Math.max(-180, view.lonMin - dx * lonSpan),
      );
      const latMin = Math.min(
        90 - latSpan,
        Math.max(-90, view.latMin + dy * latSpan),
      );
      this.mapView = { lonMin, lonMax: lonMin + lonSpan, latMin, latMax: latMin + latSpan };
      this.render();
      return;
    }
    if (this.config.kind === "map" && this.mapBrushStart !== null) {
      this.dragMoved = true;
      this.mapBrush = {
        x0: this.mapBrushStart.x,
        y0: this.mapBrushStart.y,
        x1: event.clientX - rect.left,
        y1: event.clientY - rect.top,
      };
      this.render();
      return;
    }
    const dragResult =
      this.config.kind === "bubble" ? this.bubbleResult : this.seriesResult;
    if (
      (this.config.kind === "scatter" ||
        this.config.kind === "density" ||
        this.config.kind === "bubble") &&
      this.plotDrag !== null &&
      dragResult !== null &&
      this.lastFrame !== null
    ) {
      const frame = this.lastFrame;
      const result = dragResult;
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const dx = (x - this.plotDrag.x) / frame.plotW;
      const dy = (y - this.plotDrag.y) / frame.plotH;
      this.dragMoved = true;
      this.plotDrag = { x, y };
      const view =
        this.plotView ?? {
          xMin: result.xMin,
          xMax: result.xMax,
          yMin: result.yMin,
          yMax: result.yMax,
        };
      const spanX = view.xMax - view.xMin;
      const spanY = view.yMax - view.yMin;
      this.plotView = {
        xMin: view.xMin - dx * spanX,
        xMax: view.xMax - dx * spanX,
        yMin: view.yMin + dy * spanY,
        yMax: view.yMax + dy * spanY,
      };
      this.render();
      return;
    }
    if (
      (this.config.kind === "line" || this.config.kind === "histogram") &&
      this.plotDrag !== null &&
      this.lastFrame !== null
    ) {
      const frame = this.lastFrame;
      const base = this.xZoomBase();
      const current = this.chartXZoom;
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      if (base === null || current === null) {
        this.plotDrag = { x, y };
        return;
      }
      const dx = (x - this.plotDrag.x) / frame.plotW;
      this.dragMoved = true;
      this.plotDrag = { x, y };
      const span = current.max - current.min;
      const min = Math.min(
        base.max - span,
        Math.max(base.min, current.min - dx * span),
      );
      this.chartXZoom = { min, max: min + span };
      this.refreshBins();
      this.render();
      return;
    }
    if (this.config.kind === "bar" && this.plotDrag !== null) {
      const frame = this.lastFrame;
      if (frame === null) return;
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const total = this.allCategoryBars().length;
      const state = this.barWindow ?? {
        start: 0,
        count: Math.max(1, this.config.topN),
      };
      const slot = frame.plotW / Math.max(1, state.count);
      const steps = Math.round((x - this.plotDrag.x) / Math.max(1, slot));
      if (steps !== 0 && total > 0) {
        this.dragMoved = true;
        this.plotDrag = { x, y };
        const start = Math.min(
          Math.max(0, total - state.count),
          Math.max(0, state.start - steps),
        );
        this.barWindow = { start, count: state.count };
        this.render();
      }
      return;
    }
    if (
      (this.config.kind === "treemap" || this.config.kind === "terms") &&
      this.plotDrag !== null
    ) {
      const frame = this.lastFrame;
      if (frame === null) return;
      const total =
        this.config.kind === "treemap"
          ? (this.treemapResult?.labels.length ??
            this.meta(this.config.column)?.categories?.labels.length ??
            0)
          : (this.textResult?.profile.topTerms.length ?? 0);
      if (total === 0) return;
      const base =
        this.config.kind === "treemap"
          ? Math.max(6, this.config.topN)
          : Math.max(8, this.config.topN);
      const state = this.itemWindow ?? { start: 0, count: Math.min(total, base) };
      const slot = frame.plotW / Math.max(1, state.count);
      const steps = Math.round((event.clientX - rect.left - this.plotDrag.x) / Math.max(1, slot));
      if (steps !== 0) {
        this.dragMoved = true;
        this.plotDrag = {
          x: event.clientX - rect.left,
          y: event.clientY - rect.top,
        };
        this.itemWindow =
          state.count >= total
            ? null
            : {
                count: state.count,
                start: Math.min(
                  Math.max(0, total - state.count),
                  Math.max(0, state.start - steps),
                ),
              };
        this.render();
      }
      return;
    }
    if (this.config.kind === "correlation" && this.plotDrag !== null) {
      const result = this.correlationResult;
      const frame = this.lastFrame;
      if (result === null || frame === null) return;
      const total = result.labels.length;
      const state = this.corrWindow ?? { start: 0, count: total };
      const slot = frame.plotW / Math.max(1, state.count);
      const steps = Math.round((event.clientX - rect.left - this.plotDrag.x) / Math.max(1, slot));
      if (steps !== 0) {
        this.dragMoved = true;
        this.plotDrag = {
          x: event.clientX - rect.left,
          y: event.clientY - rect.top,
        };
        this.corrWindow =
          state.count >= total
            ? null
            : {
                count: state.count,
                start: Math.min(
                  Math.max(0, total - state.count),
                  Math.max(0, state.start - steps),
                ),
              };
        this.render();
      }
      return;
    }
    if (this.config.kind === "box" && this.plotDrag !== null) {
      const result = this.boxResult;
      const frame = this.lastFrame;
      if (result === null || frame === null || result.groups.length === 0) return;
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const total = result.groups.length;
      const state = this.boxWindow ?? { start: 0, count: total };
      const slot = frame.plotW / Math.max(1, state.count);
      const steps = Math.round((x - this.plotDrag.x) / Math.max(1, slot));
      let yMin = Infinity;
      let yMax = -Infinity;
      for (const group of result.groups) {
        if (group.min < yMin) yMin = group.min;
        if (group.max > yMax) yMax = group.max;
      }
      const spanY = yMax - yMin;
      const dy = spanY > 0 ? ((y - this.plotDrag.y) / frame.plotH) * spanY : 0;
      const base = this.boxY ?? { min: yMin, max: yMax };
      const nextY = {
        min: Math.max(yMin, base.min + dy),
        max: Math.min(yMax, base.max + dy),
      };
      if (steps !== 0 || dy !== 0) {
        this.dragMoved = true;
        this.plotDrag = { x, y };
        this.boxWindow =
          state.count >= total
            ? null
            : {
                count: state.count,
                start: Math.min(
                  Math.max(0, total - state.count),
                  Math.max(0, state.start - steps),
                ),
              };
        this.boxY =
          nextY.max - nextY.min > 0 && (nextY.min > yMin || nextY.max < yMax)
            ? nextY
            : null;
        this.render();
      }
      return;
    }
    if (this.config.kind === "heatmap" && this.plotDrag !== null) {
      const result = this.crossResult;
      const frame = this.lastFrame;
      if (result === null || frame === null) return;
      const totalX = result.xLabels.length;
      const totalY = result.yLabels.length;
      const state = this.heatWindow ?? {
        xStart: 0,
        xCount: totalX,
        yStart: 0,
        yCount: totalY,
      };
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const cellW = frame.plotW / Math.max(1, state.xCount);
      const cellH = frame.plotH / Math.max(1, state.yCount);
      const stepsX = Math.round((x - this.plotDrag.x) / Math.max(1, cellW));
      const stepsY = Math.round((y - this.plotDrag.y) / Math.max(1, cellH));
      if ((stepsX !== 0 || stepsY !== 0) && totalX > 0 && totalY > 0) {
        this.dragMoved = true;
        this.plotDrag = { x, y };
        this.heatWindow = {
          xStart: Math.min(
            Math.max(0, totalX - state.xCount),
            Math.max(0, state.xStart - stepsX),
          ),
          xCount: state.xCount,
          yStart: Math.min(
            Math.max(0, totalY - state.yCount),
            Math.max(0, state.yStart - stepsY),
          ),
          yCount: state.yCount,
        };
        this.render();
      }
      return;
    }
    this.pointerAt = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
      clientX: event.clientX,
      clientY: event.clientY,
    };
    if (this.pointerFrame !== null) return;
    const run = (): void => {
      this.pointerFrame = null;
      if (!this.disposed) this.showTooltipAtPointer();
    };
    if (typeof window.requestAnimationFrame === "function") {
      this.pointerFrame = window.requestAnimationFrame(run);
    } else {
      this.pointerFrame = window.setTimeout(run, 16);
    }
  }

  private showTooltipAtPointer(): void {
    const at = this.pointerAt;
    if (at === null) return;
    const region = hitTest(this.hitRegions, at.x, at.y);
    if (region === null) {
      this.hideTooltip();
      return;
    }
    this.tooltipEl.textContent = region.lines.join("\n");
    this.tooltipEl.classList.remove("hidden");
    const cardRect = this.root.getBoundingClientRect();
    const left = Math.max(
      4,
      Math.min(at.clientX - cardRect.left + 14, Math.max(4, cardRect.width - 160)),
    );
    const top = Math.max(4, at.clientY - cardRect.top + 16);
    this.tooltipEl.style.left = `${left}px`;
    this.tooltipEl.style.top = `${top}px`;
    this.canvas.classList.toggle("chart-clickable", region.actions.length > 0);
  }

  private hideTooltip(): void {
    this.tooltipEl.classList.add("hidden");
    this.canvas.classList.remove("chart-clickable");
  }

  private handleCanvasClick(event: MouseEvent): void {
    if (this.dragMoved) {
      this.dragMoved = false;
      return;
    }
    const rect = this.canvas.getBoundingClientRect();
    const region = hitTest(
      this.hitRegions,
      event.clientX - rect.left,
      event.clientY - rect.top,
    );
    if (region === null) return;
    for (const action of region.actions) this.applyHitAction(action);
  }

  /** Map cards: the rectangle brush starts on pointerdown. */
  private beginMapBrush(event: PointerEvent): void {
    const kind = this.config.kind;
    if (
      (kind !== "map" &&
        kind !== "scatter" &&
        kind !== "density" &&
        kind !== "bubble" &&
        kind !== "line" &&
        kind !== "histogram" &&
        kind !== "bar" &&
        kind !== "heatmap" &&
        kind !== "box" &&
        kind !== "correlation" &&
        kind !== "treemap" &&
        kind !== "terms") ||
      this.lastFrame === null
    ) {
      return;
    }
    const rect = this.canvas.getBoundingClientRect();
    const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    const frame = this.lastFrame;
    if (
      point.x < frame.left ||
      point.x > frame.left + frame.plotW ||
      point.y < frame.top ||
      point.y > frame.top + frame.plotH
    ) {
      return;
    }
    if (kind !== "map") {
      // Scatter/density: drag pans the viewport.
      this.dragMoved = false;
      this.plotDrag = point;
      try {
        this.canvas.setPointerCapture(event.pointerId);
      } catch {
        // Pointer capture is best-effort.
      }
      return;
    }
    if (!event.shiftKey) {
      // Plain drag pans the viewport; Shift+drag is the rectangle filter.
      this.dragMoved = false;
      this.mapDrag = point;
      try {
        this.canvas.setPointerCapture(event.pointerId);
      } catch {
        // Pointer capture is best-effort.
      }
      return;
    }
    this.mapBrushStart = point;
    this.dragMoved = false;
    this.mapBrush = { x0: point.x, y0: point.y, x1: point.x, y1: point.y };
    try {
      this.canvas.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture is best-effort.
    }
  }

  /**
   * Map brush release: converts the rectangle to lon/lat bounds and filters
   * both coordinate columns. Rects smaller than 6 px are treated as clicks.
   */
  private endMapBrush(event: PointerEvent): void {
    if (this.config.kind !== "map") {
      this.plotDrag = null;
      return;
    }
    this.mapDrag = null;
    if (this.mapBrushStart === null) return;
    const rect = this.canvas.getBoundingClientRect();
    const end = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    const frame = this.lastFrame;
    this.mapBrushStart = null;
    const brush = this.mapBrush;
    this.mapBrush = null;
    if (frame === null || brush === null) return;
    const drag = {
      x0: Math.min(brush.x0, end.x),
      y0: Math.min(brush.y0, end.y),
      x1: Math.max(brush.x0, end.x),
      y1: Math.max(brush.y0, end.y),
    };
    const clampX = (value: number): number =>
      Math.max(frame.left, Math.min(frame.left + frame.plotW, value));
    const clampY = (value: number): number =>
      Math.max(frame.top, Math.min(frame.top + frame.plotH, value));
    if (
      clampX(drag.x1) - clampX(drag.x0) < 6 ||
      clampY(drag.y1) - clampY(drag.y0) < 6
    ) {
      this.render();
      return;
    }
    const view = this.mapView ?? { lonMin: -180, lonMax: 180, latMin: -90, latMax: 90 };
    const bounds = mapBrushBounds(
      {
        left: frame.left,
        top: frame.top,
        plotW: frame.plotW,
        plotH: frame.plotH,
        lonMin: view.lonMin,
        lonMax: view.lonMax,
        latMin: view.latMin,
        latMax: view.latMax,
      },
      drag,
    );
    const selection: MapBrushSelection = {
      lonColumn: this.config.x,
      lonMin: bounds.lonMin,
      lonMax: bounds.lonMax,
      latColumn: this.config.y,
      latMin: bounds.latMin,
      latMax: bounds.latMax,
    };
    this.render();
    this.options.onMapBrush?.(selection);
  }

  /** Wheel zoom on the map, anchored at the pointer; clamped to the world. */
  private onWheel(event: WheelEvent): void {
    const kind = this.config.kind;
    if (
      (kind !== "map" &&
        kind !== "scatter" &&
        kind !== "density" &&
        kind !== "bubble" &&
        kind !== "line" &&
        kind !== "histogram" &&
        kind !== "bar" &&
        kind !== "heatmap" &&
        kind !== "box" &&
        kind !== "correlation" &&
        kind !== "treemap" &&
        kind !== "terms") ||
      this.lastFrame === null
    ) {
      return;
    }
    const frame = this.lastFrame;
    const rect = this.canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    if (
      x < frame.left ||
      x > frame.left + frame.plotW ||
      y < frame.top ||
      y > frame.top + frame.plotH
    ) {
      return;
    }
    const tx = (x - frame.left) / frame.plotW;
    const ty = 1 - (y - frame.top) / frame.plotH;
    const factor = event.deltaY < 0 ? 0.8 : 1.25;
    if (kind === "line" || kind === "histogram") {
      const base = this.xZoomBase();
      if (base === null) return;
      const current = this.chartXZoom ?? base;
      const minSpan = Math.max(1e-9, (base.max - base.min) / 1000);
      const zoomed = zoomPlotBounds(
        { xMin: current.min, xMax: current.max, yMin: 0, yMax: 1 },
        { x: tx, y: 0.5 },
        factor,
        minSpan,
      );
      const min = Math.max(base.min, zoomed.xMin);
      const max = Math.min(base.max, zoomed.xMax);
      if (!(max > min)) return;
      event.preventDefault();
      this.chartXZoom = { min, max };
      this.refreshBins();
      this.render();
      return;
    }
    if (kind === "bar") {
      const total = this.allCategoryBars().length;
      if (total === 0) return;
      event.preventDefault();
      const current = this.barWindow ?? {
        start: 0,
        count: Math.max(1, this.config.topN),
      };
      const count = Math.min(total, Math.max(3, Math.round(current.count * factor)));
      const center = current.start + current.count / 2;
      const start = Math.min(
        Math.max(0, total - count),
        Math.max(0, Math.round(center - count / 2)),
      );
      this.barWindow = { start, count };
      this.render();
      return;
    }
    if (kind === "treemap" || kind === "terms") {
      const total =
        kind === "treemap"
          ? (this.treemapResult?.labels.length ??
            this.meta(this.config.column)?.categories?.labels.length ??
            0)
          : (this.textResult?.profile.topTerms.length ?? 0);
      if (total === 0) return;
      event.preventDefault();
      const base = kind === "treemap" ? Math.max(6, this.config.topN) : Math.max(8, this.config.topN);
      const current = this.itemWindow ?? { start: 0, count: Math.min(total, base) };
      const count = Math.min(total, Math.max(2, Math.round(current.count * factor)));
      const center = current.start + current.count / 2;
      const start = Math.min(
        Math.max(0, total - count),
        Math.max(0, Math.round(center - count / 2)),
      );
      this.itemWindow = count >= total ? null : { start, count };
      this.render();
      return;
    }
    if (kind === "correlation") {
      const result = this.correlationResult;
      if (result === null || result.labels.length < 2) return;
      event.preventDefault();
      const total = result.labels.length;
      const current = this.corrWindow ?? { start: 0, count: total };
      const count = Math.min(total, Math.max(2, Math.round(current.count * factor)));
      const center = current.start + current.count / 2;
      const start = Math.min(
        Math.max(0, total - count),
        Math.max(0, Math.round(center - count / 2)),
      );
      this.corrWindow = count >= total ? null : { start, count };
      this.render();
      return;
    }
    if (kind === "box") {
      const result = this.boxResult;
      if (result === null || result.groups.length === 0) return;
      event.preventDefault();
      const total = result.groups.length;
      const current = this.boxWindow ?? { start: 0, count: total };
      const count = Math.min(total, Math.max(1, Math.round(current.count * factor)));
      const center = current.start + current.count / 2;
      const start = Math.min(
        Math.max(0, total - count),
        Math.max(0, Math.round(center - count / 2)),
      );
      let yMin = Infinity;
      let yMax = -Infinity;
      for (const group of result.groups) {
        if (group.min < yMin) yMin = group.min;
        if (group.max > yMax) yMax = group.max;
      }
      if (!(yMax > yMin)) {
        yMin -= 1;
        yMax += 1;
      }
      const base = this.boxY ?? { min: yMin, max: yMax };
      const zoomed = zoomPlotBounds(
        { xMin: 0, xMax: 1, yMin: base.min, yMax: base.max },
        { x: 0.5, y: ty },
        factor,
        Math.max(1e-9, (yMax - yMin) / 1000),
      );
      this.boxWindow = count >= total ? null : { start, count };
      this.boxY = {
        min: Math.max(yMin, zoomed.yMin),
        max: Math.min(yMax, zoomed.yMax),
      };
      this.render();
      return;
    }
    if (kind === "heatmap") {
      const result = this.crossResult;
      if (result === null) return;
      const totalX = result.xLabels.length;
      const totalY = result.yLabels.length;
      if (totalX === 0 || totalY === 0) return;
      event.preventDefault();
      const current = this.heatWindow ?? {
        xStart: 0,
        xCount: totalX,
        yStart: 0,
        yCount: totalY,
      };
      const nextX = Math.max(1, Math.min(totalX, Math.round(current.xCount * factor)));
      const nextY = Math.max(1, Math.min(totalY, Math.round(current.yCount * factor)));
      const anchorX = current.xStart + tx * current.xCount;
      const anchorY = current.yStart + (1 - ty) * current.yCount;
      const xStart = Math.max(
        0,
        Math.min(totalX - nextX, Math.round(anchorX - tx * nextX)),
      );
      const yStart = Math.max(
        0,
        Math.min(totalY - nextY, Math.round(anchorY - (1 - ty) * nextY)),
      );
      this.heatWindow =
        nextX >= totalX && nextY >= totalY
          ? null
          : { xStart, xCount: nextX, yStart, yCount: nextY };
      this.render();
      return;
    }
    if (kind === "map") {
      event.preventDefault();
      const view = this.mapView ?? { lonMin: -180, lonMax: 180, latMin: -90, latMax: 90 };
      const lon = view.lonMin + tx * (view.lonMax - view.lonMin);
      const lat = view.latMin + ty * (view.latMax - view.latMin);
      const lonSpan = Math.min(
        360,
        Math.max(0.2, (view.lonMax - view.lonMin) * factor),
      );
      const latSpan = Math.min(
        180,
        Math.max(0.2, (view.latMax - view.latMin) * factor),
      );
      const lonMin = Math.min(180 - lonSpan, Math.max(-180, lon - tx * lonSpan));
      const latMin = Math.min(90 - latSpan, Math.max(-90, lat - ty * latSpan));
      this.mapView = { lonMin, lonMax: lonMin + lonSpan, latMin, latMax: latMin + latSpan };
      this.render();
      return;
    }
    const result = kind === "bubble" ? this.bubbleResult : this.seriesResult;
    if (result === null) return;
    event.preventDefault();
    const base =
      this.plotView ?? {
        xMin: result.xMin,
        xMax: result.xMax,
        yMin: result.yMin,
        yMax: result.yMax,
      };
    const minSpan = Math.max(
      1e-12,
      Math.min(base.xMax - base.xMin, base.yMax - base.yMin) / 2000,
    );
    const zoomed = zoomPlotBounds(base, { x: tx, y: ty }, factor, minSpan);
    const clamped = {
      xMin: Math.max(result.xMin, zoomed.xMin),
      xMax: Math.min(result.xMax, zoomed.xMax),
      yMin: Math.max(result.yMin, zoomed.yMin),
      yMax: Math.min(result.yMax, zoomed.yMax),
    };
    this.plotView =
      clamped.xMax - clamped.xMin > 0 && clamped.yMax - clamped.yMin > 0
        ? clamped
        : null;
    this.render();
  }

  /** Double-click resets the map/scatter viewport to the full data range. */
  private resetMapZoom(): void {
    let changed = false;
    let binsChanged = false;
    if (this.config.kind === "map" && this.mapView !== null) {
      this.mapView =
        this.geoDataset === null ? null : { ...this.geoDataset.bounds };
      changed = true;
    }
    if (
      (this.config.kind === "scatter" ||
        this.config.kind === "density" ||
        this.config.kind === "bubble") &&
      this.plotView !== null
    ) {
      this.plotView = null;
      changed = true;
    }
    if (
      (this.config.kind === "line" || this.config.kind === "histogram") &&
      this.chartXZoom !== null
    ) {
      this.chartXZoom = null;
      binsChanged = true;
    }
    if (this.config.kind === "bar" && this.barWindow !== null) {
      this.barWindow = null;
      changed = true;
    }
    if (this.config.kind === "heatmap" && this.heatWindow !== null) {
      this.heatWindow = null;
      changed = true;
    }
    if (this.config.kind === "box" && (this.boxWindow !== null || this.boxY !== null)) {
      this.boxWindow = null;
      this.boxY = null;
      changed = true;
    }
    if (this.config.kind === "correlation" && this.corrWindow !== null) {
      this.corrWindow = null;
      changed = true;
    }
    if (
      (this.config.kind === "treemap" || this.config.kind === "terms") &&
      this.itemWindow !== null
    ) {
      this.itemWindow = null;
      changed = true;
    }
    if (binsChanged) this.refreshBins();
    if (changed || binsChanged) this.render();
  }

  /** Toggles a category value or sets a range/text filter through the app hook. */
  private applyHitAction(action: HitAction): void {
    const onFilter = this.options.onFilter;
    if (onFilter === undefined) return;
    const current = this.options.currentFilter?.(action.column) ?? null;
    if (action.kind === "text") {
      const same =
        current?.kind === "text" &&
        current.mode === "contains" &&
        current.query === action.query;
      onFilter(
        action.column,
        same ? null : { kind: "text", mode: "contains", query: action.query },
      );
      return;
    }
    if (action.kind === "range") {
      const same =
        current?.kind === "range" &&
        current.min === action.min &&
        current.max === action.max;
      if (same) onFilter(action.column, null);
      else onFilter(action.column, { kind: "range", min: action.min, max: action.max });
      return;
    }
    const total = this.meta(action.column)?.categories?.labels.length ?? 0;
    let selected: number[];
    if (current?.kind === "values") {
      selected = current.selected.filter((code) => code !== action.code);
      if (selected.length === current.selected.length) selected.push(action.code);
    } else {
      selected = [action.code];
    }
    if (selected.length === 0 || (total > 0 && selected.length === total)) {
      onFilter(action.column, null);
    } else {
      onFilter(action.column, { kind: "values", selected });
    }
  }

  /** Wrapped message drawn inside the empty plot area. */
  private drawPlotMessage(
    ctx: CanvasRenderingContext2D,
    frame: Frame,
    message: string,
  ): void {
    this.plotMessageDrawn = true;
    this.font(ctx, frame.ui, 12);
    ctx.fillStyle = frame.dim;
    ctx.textAlign = "center";
    const maxWidth = Math.max(40, frame.plotW - 24 * frame.ui);
    const lines: string[] = [];
    let line = "";
    for (const word of message.split(" ")) {
      const candidate = line === "" ? word : `${line} ${word}`;
      if (line !== "" && ctx.measureText(candidate).width > maxWidth) {
        lines.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    if (line !== "") lines.push(line);
    const lineHeight = 16 * frame.ui;
    const startY = frame.top + frame.plotH / 2 - ((lines.length - 1) * lineHeight) / 2;
    lines.forEach((text, index) => {
      ctx.fillText(
        text,
        frame.left + frame.plotW / 2,
        startY + index * lineHeight + 4 * frame.ui,
      );
    });
    ctx.textAlign = "left";
  }

  /** False while the card has nothing its kind can plot. */
  private canDraw(): boolean {
    if (this.columns.length === 0) return false;
    const count = (allow: (meta: ColumnMeta) => boolean): number =>
      this.columns.filter(allow).length;
    switch (this.config.kind) {
      case "histogram": {
        const meta = this.meta(this.config.column);
        return (
          meta !== undefined &&
          (isNumericType(meta.type) || meta.type === "time" || meta.type === "duration")
        );
      }
      case "line":
        return count((meta) => this.isDateLike(meta)) > 0;
      case "barplot": {
        const category = this.meta(this.config.column);
        const measure = this.meta(this.config.valueColumn ?? -1);
        return (
          category !== undefined &&
          measure !== undefined &&
          isCategoryType(category.type) &&
          (isNumericType(measure.type) || measure.type === "duration")
        );
      }
      case "bar":
      case "treemap": {
        const meta = this.meta(this.config.column);
        return meta !== undefined && isCategoryType(meta.type);
      }
      case "terms": {
        const meta = this.meta(this.config.column);
        return meta !== undefined && meta.type === "string";
      }
      case "scatter":
      case "density": {
        const x = this.meta(this.config.x);
        const y = this.meta(this.config.y);
        return (
          x !== undefined &&
          y !== undefined &&
          this.allowsAxis(x) &&
          this.allowsAxis(y)
        );
      }
      case "box":
        return count((meta) => isNumericType(meta.type)) > 0 &&
          count((meta) => isCategoryType(meta.type)) > 0;
      case "treemap": {
        const meta = this.meta(this.config.column);
        return meta !== undefined && isCategoryType(meta.type);
      }
      case "heatmap":
        return count((meta) => isCategoryType(meta.type)) >= 2;
      case "bubble": {
        const x = this.meta(this.config.x);
        const y = this.meta(this.config.y);
        return (
          x !== undefined && y !== undefined && isNumericType(x.type) && isNumericType(y.type)
        );
      }
      case "correlation":
        return count((meta) => isNumericType(meta.type)) >= 2;
      case "kpi": {
        const meta = this.meta(this.config.valueColumn ?? -1);
        return meta !== undefined && (isNumericType(meta.type) || meta.type === "duration");
      }
      case "map": {
        const x = this.meta(this.config.x);
        const y = this.meta(this.config.y);
        return (
          x !== undefined &&
          y !== undefined &&
          isNumericType(x.type) &&
          isNumericType(y.type)
        );
      }
    }
  }

  /** Honest reason a series-style card has nothing to plot. */
  private emptySeriesMessage(kind: "histogram" | "line" | "bar"): string {
    if (kind === "line" && !this.columns.some((meta) => this.isDateLike(meta))) {
      return "No date or datetime column in this file.";
    }
    const chartable = this.columns.some(
      (meta) =>
        isNumericType(meta.type) ||
        meta.type === "date" ||
        meta.type === "datetime" ||
        meta.type === "time" ||
        meta.type === "duration" ||
        isCategoryType(meta.type),
    );
    if (!chartable) {
      return "This file has no numeric, temporal or category columns. Change a column's type in the filter list.";
    }
    return "Pick a column to chart.";
  }

  /**
   * Text scale: on screen the smallest 9px label must stay at least 11px, so
   * ui never drops below 1.25; exports keep the reference height/540 scale.
   */
  private textScale(height: number, forExport: boolean): number {
    const scale = height / 540;
    return forExport ? Math.max(0.7, Math.min(2.6, scale)) : Math.max(1.25, scale);
  }

  private frame(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    forExport: boolean,
    widestTick = "",
    yTitle = false,
    xTitle = false,
  ): Frame {
    const ui = this.textScale(height, forExport);
    this.font(ctx, ui, 10);
    const tickW = widestTick === "" ? 0 : ctx.measureText(widestTick).width;
    const labelPad = yTitle ? 20 * ui : 0;
    const baseLeft = 56 * ui;
    const left = Math.max(baseLeft, tickW + 8) + labelPad;
    const right = 18 * ui;
    const top = 58 * ui;
    const bottom = (40 + (xTitle ? 14 : 0)) * ui;
    return {
      ui,
      left,
      right,
      top,
      bottom,
      plotW: width - left - right,
      plotH: height - top - bottom,
      text: cssVar("--text", "#1f2328"),
      dim: cssVar("--text-dim", "#59636e"),
      border: cssVar("--border", "#d8dee4"),
      tickW,
      labelPad,
    };
  }

  /** Widest expected Y tick label for the current kind, for the left margin. */
  private widestYLabel(ctx: CanvasRenderingContext2D, ui: number): string {
    this.font(ctx, ui, 10);
    const widest = (labels: readonly string[]): string => {
      let best = "";
      let bestWidth = -1;
      for (const label of labels) {
        const width = ctx.measureText(label).width;
        if (width > bestWidth) {
          bestWidth = width;
          best = label;
        }
      }
      return best;
    };
    switch (this.config.kind) {
      case "scatter":
      case "density": {
        const result = this.seriesResult;
        const yMin = result === null ? 0 : result.yMin;
        const yMax = result === null ? 1 : result.yMax;
        const meta = this.meta(this.config.y);
        const axisKind = meta === undefined ? null : axisKindFor(meta.type);
        return widest(
          niceTicks(yMin, yMax, 4).map((value) => formatTick(value, axisKind, yMax - yMin)),
        );
      }
      case "box": {
        let max = 1;
        for (const group of this.boxResult?.groups ?? []) {
          if (group.max > max) max = group.max;
        }
        return widest(niceTicks(0, max, 5).map((value) => formatTick(value, "histogram")));
      }
      case "correlation": {
        const labels = this.correlationResult?.labels ?? [];
        return widest(labels);
      }
      case "histogram":
        // Grouped histograms label the Y axis in percent of the group.
        return this.groupResult === null ? formatCount(this.rowCount) : "100%";
      case "line":
      case "bar":
        // The Y axis is a count axis on these kinds.
        return formatCount(this.rowCount);
      default:
        // Heatmap fits its labels to the margin already.
        return "";
    }
  }

  private font(ctx: CanvasRenderingContext2D, ui: number, size: number, weight = ""): void {
    ctx.font = weight === "" ? `${size * ui}px system-ui, sans-serif` : `${weight} ${size * ui}px system-ui, sans-serif`;
  }

  private fit(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
    if (ctx.measureText(text).width <= maxWidth) return text;
    let cut = text;
    while (cut.length > 2 && ctx.measureText(`${cut}…`).width > maxWidth) cut = cut.slice(0, -1);
    return `${cut}…`;
  }

  private fillTopRounded(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    radius: number,
  ): void {
    const r = Math.max(0, Math.min(radius, w / 2, h));
    ctx.beginPath();
    if (typeof ctx.roundRect === "function") {
      ctx.roundRect(x, y, w, h, [r, r, 0, 0]);
    } else {
      ctx.rect(x, y, w, h);
    }
    ctx.fill();
  }

  private subtitle(): string {
    if (this.config.kind === "kpi" && this.usesValueAggregate()) {
      const result = this.aggregateResult();
      const measure = result?.measureNames[0] ?? "measure";
      if (result === null || result.dimensionNames.length === 0) {
        return `${measure} · all filtered rows`;
      }
      return `${measure} over ${result.dimensionNames[0]} · ${result.groupCount.toLocaleString()} buckets`;
    }
    const rows = `${this.rowCount.toLocaleString()} rows shown`;
    if (this.config.kind === "map") {
      const lon = this.meta(this.config.x)?.name ?? "longitude";
      const lat = this.meta(this.config.y)?.name ?? "latitude";
      return `${lat} × ${lon} · ${rows}`;
    }
    if (this.usesAggregate()) {
      const result = this.aggregateResult();
      if (result === null) return "Aggregate · waiting for the first result";
      return `${result.measureNames[0] ?? "measure"} by ${
        result.dimensionNames[0] ?? "group"
      } · ${result.groupCount.toLocaleString()} groups`;
    }
    if (this.config.kind === "scatter" || this.config.kind === "density") {
      const x = this.meta(this.config.x)?.name ?? "X";
      const y = this.meta(this.config.y)?.name ?? "Y";
      // Say when an auto-mode scatter actually rendered as a density grid.
      const autoDensity =
        this.config.kind === "scatter" &&
        this.config.mode === "auto" &&
        this.seriesResult?.mode === "density";
      const mode = autoDensity ? "Density (auto) · " : "";
      return `${x} vs ${y} · ${mode}${rows}`;
    }
    if (this.config.kind === "box") {
      const value = this.meta(this.config.x)?.name ?? "Value";
      const group = this.meta(this.config.y)?.name ?? "groups";
      return `${value} by ${group} · ${rows}`;
    }
    if (this.config.kind === "heatmap") {
      const x = this.meta(this.config.x)?.name ?? "X";
      const y = this.meta(this.config.y)?.name ?? "Y";
      return `${x} × ${y} · ${rows}`;
    }
    if (this.config.kind === "correlation") {
      return `Pearson r · ${rows}`;
    }
    const meta = this.meta(this.config.column);
    if (meta === undefined) return rows;
    return `${TYPE_LABELS[meta.type]} · ${rows} · ${meta.stats.distinct.toLocaleString()} distinct`;
  }

  private drawChart(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    forExport = false,
  ): void {
    ctx.clearRect(0, 0, width, height);
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    this.hitRegions = [];
    this.plotMessageDrawn = false;
    const ui = this.textScale(height, forExport);
    const labels = this.axisLabels();
    const hasXTitle =
      (labels.x ?? "") !== "" || (this.config.xTitle?.trim() ?? "") !== "";
    const hasYTitle =
      (labels.y ?? "") !== "" ||
      (this.config.yTitle?.trim() ?? "") !== "" ||
      (this.config.yUnit?.trim() ?? "") !== "";
    const frame = this.frame(
      ctx,
      width,
      height,
      forExport,
      this.widestYLabel(ctx, ui),
      hasYTitle,
      hasXTitle,
    );
    this.lastFrame = frame;

    if (this.columns.length === 0) {
      this.noteEl.textContent = "Load data to see charts.";
      this.drawPlotMessage(ctx, frame, "Load data to see charts.");
      return;
    }

    const title = this.config.title.trim() === "" ? this.defaultTitle() : this.config.title.trim();
    this.font(ctx, frame.ui, 15, "600");
    ctx.fillStyle = frame.text;
    ctx.fillText(this.fit(ctx, title, width - frame.left - frame.right), frame.left, 22 * frame.ui);
    this.font(ctx, frame.ui, 11);
    ctx.fillStyle = frame.dim;
    ctx.fillText(this.fit(ctx, this.subtitle(), width - frame.left - frame.right), frame.left, 40 * frame.ui);

    if (this.usesAggregate()) {
      this.drawViewAggregate(ctx, frame);
      return;
    }

    switch (this.config.kind) {
      case "bar":
        this.drawBars(ctx, frame);
        break;
      case "scatter":
      case "density":
        this.drawScatterLike(ctx, frame);
        break;
      case "box":
        this.drawBox(ctx, frame);
        break;
      case "treemap":
        this.drawTreemap(ctx, frame);
        break;
      case "terms":
        this.drawTerms(ctx, frame);
        break;
      case "heatmap":
        this.drawHeatmap(ctx, frame);
        break;
      case "bubble":
        this.drawBubble(ctx, frame);
        break;
      case "correlation":
        this.drawCorrelation(ctx, frame);
        break;
      case "map":
        this.drawMap(ctx, frame);
        break;
      case "kpi":
      case "barplot": {
        const message = "Pick a numeric measure in the card settings.";
        this.noteEl.textContent = message;
        this.drawPlotMessage(ctx, frame, message);
        break;
      }
      default:
        this.drawSeries(ctx, frame, this.config.kind);
        break;
    }

    if (!this.plotMessageDrawn) {
      this.drawAxisTitles(ctx, frame, labels.x, labels.y);
    }

    if (this.config.suggested !== "") {
      const existing = this.noteEl.textContent ?? "";
      this.noteEl.textContent =
        existing === ""
          ? `Suggested: ${this.config.suggested}`
          : `${existing} · Suggested: ${this.config.suggested}`;
    }
  }

  /**
   * Split-by series: a line/bar card whose aggregate carries a second (group)
   * dimension draws one colored series per group value. The top 8 groups by
   * absolute total are drawn; a legend names them and the note counts the rest.
   */
  private drawSplitAggregate(
    ctx: CanvasRenderingContext2D,
    frame: Frame,
    result: AggregateMessage,
    values: Float64Array,
  ): void {
    const n = result.groupCount;
    const bucketLabels = result.dimensions[0] ?? [];
    const groupLabels = result.dimensions[1] ?? [];
    const bucketIndex = new Map<string, number>();
    const buckets: string[] = [];
    for (let i = 0; i < n; i++) {
      const label = bucketLabels[i] ?? "";
      if (!bucketIndex.has(label)) {
        bucketIndex.set(label, buckets.length);
        buckets.push(label);
      }
    }
    interface SplitSeries {
      label: string;
      color: string;
      total: number;
      values: Float64Array;
    }
    const byGroup = new Map<string, SplitSeries>();
    for (let i = 0; i < n; i++) {
      const label = groupLabels[i] ?? "(missing)";
      let entry = byGroup.get(label);
      if (entry === undefined) {
        entry = {
          label,
          color: this.groupColor(byGroup.size),
          total: 0,
          values: new Float64Array(buckets.length).fill(Number.NaN),
        };
        byGroup.set(label, entry);
      }
      const value = values[i] ?? Number.NaN;
      if (Number.isFinite(value)) {
        const bucket = bucketIndex.get(bucketLabels[i] ?? "") ?? 0;
        entry.values[bucket] = value;
        entry.total += Math.abs(value);
      }
    }
    const all = [...byGroup.values()].sort((a, b) => b.total - a.total);
    const shown = all.slice(0, 8);
    if (shown.length === 0) {
      const message = "The aggregate has no groups to draw yet.";
      this.noteEl.textContent = message;
      this.drawPlotMessage(ctx, frame, message);
      return;
    }
    const ui = frame.ui;
    const stacked =
      this.config.kind === "barplot" && (this.config.barLayout ?? "group") === "stack";
    let max = 0;
    if (stacked) {
      for (let bucket = 0; bucket < buckets.length; bucket++) {
        let total = 0;
        for (const series of shown) {
          const value = series.values[bucket] ?? Number.NaN;
          if (Number.isFinite(value) && value > 0) total += value;
        }
        if (total > max) max = total;
      }
    } else {
      for (const series of shown) {
        for (const value of series.values) {
          if (Number.isFinite(value)) max = Math.max(max, value);
        }
      }
    }
    const top = Math.max(1, max);

    // Shared y grid and baseline (same shape as the single-series bars).
    const yTicks = niceTicks(0, top, 4).filter(
      (value, index, list) =>
        index === 0 || formatChartNumber(value) !== formatChartNumber(list[index - 1]),
    );
    ctx.strokeStyle = frame.border;
    ctx.lineWidth = 1;
    ctx.fillStyle = frame.dim;
    this.font(ctx, ui, 10);
    ctx.textAlign = "right";
    for (const value of yTicks) {
      const y = frame.top + frame.plotH - (value / top) * frame.plotH;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(frame.left, y + 0.5);
      ctx.lineTo(frame.left + frame.plotW, y + 0.5);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillText(formatChartNumber(value), frame.left - 6 * ui, y + 3 * ui);
    }
    ctx.textAlign = "left";
    ctx.beginPath();
    ctx.moveTo(frame.left, frame.top + frame.plotH + 0.5);
    ctx.lineTo(frame.left + frame.plotW, frame.top + frame.plotH + 0.5);
    ctx.stroke();

    const slot = frame.plotW / Math.max(1, buckets.length);
    const lineCard = result.dimensionIsTime[0] === true;
    if (lineCard) {
      for (const series of shown) {
        ctx.strokeStyle = series.color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        let started = false;
        for (let b = 0; b < buckets.length; b++) {
          const value = series.values[b] ?? Number.NaN;
          if (!Number.isFinite(value)) {
            started = false;
            continue;
          }
          const x = frame.left + (b + 0.5) * slot;
          const y = frame.top + frame.plotH - (value / top) * frame.plotH;
          if (!started) {
            ctx.moveTo(x, y);
            started = true;
          } else {
            ctx.lineTo(x, y);
          }
        }
        ctx.stroke();
      }
    } else if (stacked) {
      for (let b = 0; b < buckets.length; b++) {
        let base = 0;
        for (const series of shown) {
          const value = series.values[b] ?? Number.NaN;
          if (!Number.isFinite(value) || value <= 0) continue;
          const height = (value / top) * frame.plotH;
          ctx.fillStyle = series.color;
          ctx.globalAlpha = 0.85;
          this.fillTopRounded(
            ctx,
            frame.left + b * slot + slot * 0.1,
            frame.top + frame.plotH - base - height,
            Math.max(1, slot * 0.8),
            height,
            2 * ui,
          );
          base += height;
        }
        ctx.globalAlpha = 1;
      }
    } else {
      const barW = Math.max(1, (slot * 0.8) / shown.length);
      shown.forEach((series, s) => {
        ctx.fillStyle = series.color;
        ctx.globalAlpha = 0.85;
        for (let b = 0; b < buckets.length; b++) {
          const value = series.values[b] ?? Number.NaN;
          if (!Number.isFinite(value) || value <= 0) continue;
          const height = (value / top) * frame.plotH;
          this.fillTopRounded(
            ctx,
            frame.left + b * slot + slot * 0.1 + s * barW,
            frame.top + frame.plotH - height,
            Math.max(1, barW - 1),
            height,
            2 * ui,
          );
        }
        ctx.globalAlpha = 1;
      });
    }

    ctx.fillStyle = frame.dim;
    this.font(ctx, ui, 10);
    ctx.textAlign = "center";
    const step = Math.max(1, Math.ceil(buckets.length / 8));
    for (let b = 0; b < buckets.length; b += step) {
      ctx.fillText(
        this.fit(ctx, buckets[b] ?? "", Math.max(16, slot * step - 4 * ui)),
        frame.left + (b + 0.5) * slot,
        frame.top + frame.plotH + 14 * ui,
      );
    }
    ctx.textAlign = "left";

    // Legend: colored swatch + name, left to right until the row is full.
    let x = frame.left;
    let legendCount = 0;
    for (const series of shown) {
      const label = series.label;
      this.font(ctx, ui, 10);
      const width = ctx.measureText(label).width + 26 * ui;
      if (x + width > frame.left + frame.plotW) break;
      ctx.fillStyle = series.color;
      ctx.fillRect(x, frame.top - 14 * ui, 8 * ui, 8 * ui);
      ctx.fillStyle = frame.dim;
      ctx.fillText(label, x + 12 * ui, frame.top - 6 * ui);
      x += width;
      legendCount++;
    }
    if (legendCount < shown.length) {
      ctx.fillStyle = frame.dim;
      ctx.fillText(`+${shown.length - legendCount} more`, x, frame.top - 6 * ui);
    }

    const measure = result.measureNames[0] ?? "measure";
    ctx.fillStyle = frame.dim;
    ctx.fillText(
      `${measure} · ${shown.length}${all.length > shown.length ? ` of ${all.length}` : ""} series`,
      frame.left,
      frame.top + frame.plotH + 30 * ui,
    );
    this.noteEl.textContent = `${measure} by ${
      result.dimensionNames[1] ?? "group"
    } · ${shown.length} of ${all.length} series shown${stacked ? " (stacked)" : ""} · ${
      result.dimensionNames[0] ?? "group"
    } advances left to right`;
  }

  /**
   * Map card: the vendored 110m basemap (lazy, decoded once) with the filtered
   * coordinate points drawn in world space. Drag a rectangle to filter both
   * coordinate columns to that area (plan §8).
   */
  private drawMap(ctx: CanvasRenderingContext2D, frame: Frame): void {
    if (this.basemap === null && basemapCache !== null) this.basemap = basemapCache;
    if (this.basemap === null) {
      const message = "Loading the offline basemap…";
      this.noteEl.textContent = message;
      this.drawPlotMessage(ctx, frame, message);
      void loadBasemap().then((map) => {
        this.basemap = map;
        if (!this.disposed) this.render();
      });
      return;
    }
    const map = this.basemap;
    const x0 = frame.left;
    const y0 = frame.top;
    const w = frame.plotW;
    const h = frame.plotH;
    const view =
      this.mapView ?? { lonMin: -180, lonMax: 180, latMin: -90, latMax: 90 };
    const lonSpan = view.lonMax - view.lonMin;
    const latSpan = view.latMax - view.latMin;
    const px = (lon: number): number => x0 + ((lon - view.lonMin) / lonSpan) * w;
    const py = (lat: number): number => y0 + ((view.latMax - lat) / latSpan) * h;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, y0, w, h);
    ctx.clip();

    // A barely tinted ocean separates water from the panel background.
    ctx.fillStyle = frame.border;
    ctx.globalAlpha = 0.12;
    ctx.fillRect(x0, y0, w, h);
    ctx.globalAlpha = 1;

    // Graticule: 30° at world scale, finer as the viewport zooms in.
    const gridStep = lonSpan > 180 ? 30 : lonSpan > 60 ? 10 : lonSpan > 20 ? 5 : 1;
    ctx.strokeStyle = frame.border;
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.4;
    ctx.beginPath();
    for (
      let lon = Math.ceil(view.lonMin / gridStep) * gridStep;
      lon <= view.lonMax;
      lon += gridStep
    ) {
      ctx.moveTo(px(lon), y0);
      ctx.lineTo(px(lon), y0 + h);
    }
    for (
      let lat = Math.ceil(view.latMin / gridStep) * gridStep;
      lat <= view.latMax;
      lat += gridStep
    ) {
      ctx.moveTo(x0, py(lat));
      ctx.lineTo(x0 + w, py(lat));
    }
    ctx.stroke();
    ctx.globalAlpha = 1;

    const custom = this.geoDataset;
    if (custom !== null) {
      const rampName = this.config.palette ?? DEFAULT_PALETTE;
      const ramp = isRampPalette(rampName) ? this.rampStopsFor(rampName) : null;
      const min =
        this.config.colorMin === null || this.config.colorMin === undefined
          ? (Number.isFinite(this.geoJoinMin) ? this.geoJoinMin : 0)
          : this.config.colorMin;
      const max =
        this.config.colorMax === null || this.config.colorMax === undefined
          ? (Number.isFinite(this.geoJoinMax) ? this.geoJoinMax : 1)
          : this.config.colorMax;
      const span = Math.max(1e-12, max - min);
      const property = this.geoFeatureSelect.value;
      const matchColumn = Number(this.geoMatchSelect.value);
      for (const feature of custom.features) {
        let bx0 = Infinity;
        let by0 = Infinity;
        let bx1 = -Infinity;
        let by1 = -Infinity;
        ctx.beginPath();
        for (const ring of feature.rings) {
          for (let i = 0; i < ring.length; i += 2) {
            const x = px(ring[i] ?? 0);
            const y = py(ring[i + 1] ?? 0);
            if (x < bx0) bx0 = x;
            if (x > bx1) bx1 = x;
            if (y < by0) by0 = y;
            if (y > by1) by1 = y;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.closePath();
        }
        const raw = property === "" ? undefined : feature.properties[property];
        const value =
          raw === undefined || raw === null
            ? Number.NaN
            : this.geoJoinValues.get(this.joinKey(String(raw))) ?? Number.NaN;
        ctx.fillStyle =
          ramp !== null && Number.isFinite(value)
            ? rampAt(ramp, Math.min(1, Math.max(0, (value - min) / span)))
            : this.primaryColor();
        ctx.globalAlpha = Number.isFinite(value) ? 0.72 : 0.18;
        ctx.fill("evenodd");
        ctx.globalAlpha = 0.8;
        ctx.strokeStyle = Number.isFinite(value) ? frame.dim : this.primaryColor();
        ctx.lineWidth = 0.7;
        ctx.stroke();

        if (bx1 > bx0 && by1 > by0) {
          const lines = [feature.label];
          if (property !== "" && raw !== undefined && raw !== null) {
            lines.push(`${property}: ${String(raw)}`);
          }
          if (Number.isFinite(value)) lines.push(formatChartNumber(value));
          else if (property !== "") lines.push("No matching rows");
          const actions: HitAction[] = [];
          const matchMeta = this.meta(matchColumn);
          if (matchColumn >= 0 && matchMeta !== undefined && raw !== undefined && raw !== null) {
            const text = String(raw);
            if (isCategoryType(matchMeta.type)) {
              const code = matchMeta.categories?.labels.indexOf(text) ?? -1;
              if (code >= 0) actions.push({ kind: "values", column: matchColumn, code });
            } else if (matchMeta.type === "string") {
              actions.push({ kind: "text", column: matchColumn, query: text });
            }
          }
          this.hitRegions.push({
            x: bx0,
            y: by0,
            w: bx1 - bx0,
            h: by1 - by0,
            lines,
            actions,
          });
        }
      }
      ctx.globalAlpha = 1;
    } else {
      // Land polygons: one fill path, then one stroke path for the coast.
      ctx.beginPath();
      for (const ring of map.land) {
        for (let i = 0; i < ring.length; i += 2) {
          const x = px(ring[i] ?? 0);
          const y = py(ring[i + 1] ?? 0);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
      }
      ctx.fillStyle = frame.border;
      ctx.globalAlpha = 0.4;
      ctx.fill();
      ctx.globalAlpha = 0.75;
      ctx.strokeStyle = frame.dim;
      ctx.lineWidth = 0.75;
      ctx.stroke();
      ctx.globalAlpha = 1;

      // Country borders add detail without turning the map into a wireframe.
      ctx.beginPath();
      for (const country of map.countries) {
        for (const ring of country.rings) {
          for (let i = 0; i < ring.length; i += 2) {
            const x = px(ring[i] ?? 0);
            const y = py(ring[i + 1] ?? 0);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.closePath();
        }
      }
      ctx.strokeStyle = frame.dim;
      ctx.globalAlpha = 0.28;
      ctx.lineWidth = 0.6;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    const ui = frame.ui;
    if (this.config.mapMode === "heat") {
      const grid = this.mapGrid;
      if (grid === null) {
        this.noteEl.textContent = "Computing the heat grid…";
        return;
      }
      const values = grid.values;
      const dataMax = Math.max(1, values === null ? grid.maxCount : grid.valueMax);
      const max =
        this.config.colorMax === null || this.config.colorMax === undefined
          ? dataMax
          : this.config.colorMax;
      const min =
        this.config.colorMin === null || this.config.colorMin === undefined
          ? 0
          : this.config.colorMin;
      const span = Math.max(1e-12, max - min);
      const rampName = this.config.palette ?? DEFAULT_PALETTE;
      const ramp = isRampPalette(rampName) ? this.rampStopsFor(rampName) : null;
      const colors =
        ramp === null
          ? Array.from({ length: 32 }, (_, index) => rampColor(index / 31))
          : Array.from({ length: 32 }, (_, index) => rampAt(ramp, index / 31));
      const cellLon = (grid.xMax - grid.xMin) / grid.bins;
      const cellLat = (grid.yMax - grid.yMin) / grid.bins;
      for (let cy = 0; cy < grid.bins; cy++) {
        for (let cx = 0; cx < grid.bins; cx++) {
          const index = cy * grid.bins + cx;
          const value =
            values === null ? (grid.counts[index] ?? 0) : (values[index] ?? Number.NaN);
          if (!Number.isFinite(value) || value <= 0) continue;
          const lon0 = grid.xMin + cx * cellLon;
          const latTop = grid.yMax - cy * cellLat;
          const lat0 = latTop - cellLat;
          if (lon0 + cellLon < view.lonMin || lon0 > view.lonMax) continue;
          if (lat0 + cellLat < view.latMin || lat0 > view.latMax) continue;
          const t = Math.min(1, Math.max(0, (value - min) / span));
          ctx.fillStyle =
            colors[Math.min(colors.length - 1, Math.floor(t * colors.length))] ??
            this.primaryColor();
          ctx.globalAlpha = 0.82;
          ctx.fillRect(
            px(lon0),
            py(latTop),
            Math.max(1, (cellLon / lonSpan) * w) + 0.5,
            Math.max(1, (cellLat / latSpan) * h) + 0.5,
          );
        }
      }
      ctx.globalAlpha = 1;
      // Compact colour scale so heat values read quantitatively.
      const barW = Math.min(160 * ui, w * 0.45);
      const barH = 7 * ui;
      const barX = x0 + 12 * ui;
      const barY = y0 + h - 20 * ui;
      ctx.fillStyle = frame.text;
      ctx.globalAlpha = 0.1;
      ctx.fillRect(barX - 6 * ui, barY - 14 * ui, barW + 12 * ui, barH + 22 * ui);
      ctx.globalAlpha = 1;
      const gradient = ctx.createLinearGradient(barX, 0, barX + barW, 0);
      colors.forEach((color, index) =>
        gradient.addColorStop(index / Math.max(1, colors.length - 1), color),
      );
      ctx.fillStyle = gradient;
      ctx.fillRect(barX, barY, barW, barH);
      ctx.strokeStyle = frame.dim;
      ctx.globalAlpha = 0.5;
      ctx.strokeRect(barX + 0.5, barY + 0.5, barW, barH);
      ctx.globalAlpha = 1;
      ctx.fillStyle = frame.dim;
      this.font(ctx, ui, 9);
      ctx.fillText(formatTick(min, null), barX, barY - 4 * ui);
      const maxLabel = formatTick(max, null);
      ctx.fillText(
        maxLabel,
        barX + barW - ctx.measureText(maxLabel).width,
        barY - 4 * ui,
      );
      const measureMeta = this.meta(this.config.sizeColumn);
      const agg = this.config.bubbleAgg ?? "count";
      const measure =
        values === null || this.config.sizeColumn < 0 || measureMeta === undefined
          ? "rows per cell"
          : `${agg}(${measureMeta.name}) per cell`;
      this.noteEl.textContent = `heat: ${measure} · ${grid.bins}×${grid.bins} grid · ${grid.total.toLocaleString()} rows · scroll to zoom · drag to pan · double-click resets`;
      return;
    }
    const result = this.seriesResult;
    if (result === null) {
      this.noteEl.textContent = "Pick numeric longitude and latitude columns.";
      return;
    }
    if (result.mode === "density") {
      // Density never applies (map requests points), but keep a sane fallback.
      const spanX = result.xMax - result.xMin;
      const spanY = result.yMax - result.yMin;
      ctx.fillStyle = this.primaryColor();
      for (let cy = 0; cy < result.rows; cy++) {
        for (let cx = 0; cx < result.cols; cx++) {
          const count = result.counts[cy * result.cols + cx] ?? 0;
          if (count === 0) continue;
          const lon = result.xMin + ((cx + 0.5) / result.cols) * spanX;
          const lat = result.yMin + ((cy + 0.5) / result.rows) * spanY;
          if (lon < -180 || lon > 180 || lat < -90 || lat > 90) continue;
          ctx.globalAlpha = 0.25 + 0.6 * (count / Math.max(1, result.max));
          ctx.fillRect(px(lon) - 2 * ui, py(lat) - 2 * ui, 4 * ui, 4 * ui);
        }
      }
      ctx.globalAlpha = 1;
      this.noteEl.textContent = `${result.total.toLocaleString()} points · ${result.outside.toLocaleString()} outside the world bounds · drag a rectangle to filter to an area`;
      return;
    }
    // Points: sized and coloured by the chosen columns, batched by colour.
    const sizes = this.pointSizes(result, ui);
    const buckets = this.colorBuckets(result);
    const baseRadius = 2.2 * ui;
    const drawAt = (index: number): void => {
      const lon = result.x[index] ?? Number.NaN;
      const lat = result.y[index] ?? Number.NaN;
      if (
        !Number.isFinite(lon) ||
        !Number.isFinite(lat) ||
        lon < view.lonMin ||
        lon > view.lonMax ||
        lat < view.latMin ||
        lat > view.latMax
      ) {
        return;
      }
      const r = sizes === null ? baseRadius : (sizes[index] ?? baseRadius);
      if (result.shown <= 5000) {
        ctx.beginPath();
        ctx.arc(px(lon), py(lat), Math.max(0.5, r), 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillRect(px(lon) - r, py(lat) - r, r * 2, r * 2);
      }
    };
    if (buckets === null) {
      ctx.fillStyle = this.primaryColor();
      ctx.globalAlpha = 0.6;
      for (let i = 0; i < result.shown; i++) drawAt(i);
    } else {
      for (let bucket = 0; bucket < buckets.colors.length; bucket++) {
        ctx.fillStyle = buckets.colors[bucket] ?? this.primaryColor();
        ctx.globalAlpha = 0.62;
        for (let i = 0; i < result.shown; i++) {
          if (buckets.buckets[i] === bucket) drawAt(i);
        }
      }
    }
    ctx.globalAlpha = 1;

    // Live brush rectangle.
    if (this.mapBrush !== null) {
      const rx = Math.min(this.mapBrush.x0, this.mapBrush.x1);
      const ry = Math.min(this.mapBrush.y0, this.mapBrush.y1);
      const rw = Math.abs(this.mapBrush.x1 - this.mapBrush.x0);
      const rh = Math.abs(this.mapBrush.y1 - this.mapBrush.y0);
      ctx.fillStyle = this.primaryColor();
      ctx.globalAlpha = 0.15;
      ctx.fillRect(rx, ry, rw, rh);
      ctx.globalAlpha = 0.9;
      ctx.strokeStyle = this.primaryColor();
      ctx.lineWidth = 1;
      ctx.strokeRect(rx + 0.5, ry + 0.5, rw, rh);
      ctx.globalAlpha = 1;
    }
    ctx.restore();

    const sampled = result.sampled ? " (sampled)" : "";
    const colorText = this.colorNote(result);
    const sizeMeta = this.meta(this.config.sizeColumn);
    const extras = [
      colorText === null ? "" : `${colorText}`,
      sizeMeta === undefined || sizes === null ? "" : `size: ${sizeMeta.name}`,
    ]
      .filter((part) => part !== "")
      .join(" · ");
    this.noteEl.textContent = `${result.shown.toLocaleString()} of ${result.total.toLocaleString()} points${sampled}${
      extras === "" ? "" : ` · ${extras}`
    } — scroll to zoom · drag to pan · shift-drag to filter · double-click resets`;
  }

  /**
   * KPI card: the latest value large, the change vs the previous period in
   * green/red, and a faint sparkline of the series behind it. Without a date
   * column the series has one row and the card is the grand total.
   */
  private drawKpi(
    ctx: CanvasRenderingContext2D,
    frame: Frame,
    result: AggregateMessage,
    values: Float64Array,
  ): void {
    const ui = frame.ui;
    const n = result.groupCount;
    const latest = values[n - 1] ?? Number.NaN;
    const measure = result.measureNames[0] ?? "value";
    const overTime = result.dimensionNames.length > 0;
    if (!Number.isFinite(latest)) {
      const message = "No value to show for this measure.";
      this.noteEl.textContent = message;
      this.drawPlotMessage(ctx, frame, message);
      return;
    }
    const full = latest.toLocaleString(undefined, { maximumFractionDigits: 2 });

    // Sparkline: the whole series, faint, across the plot width.
    if (overTime && n >= 2) {
      let min = Number.POSITIVE_INFINITY;
      let max = Number.NEGATIVE_INFINITY;
      for (const value of values) {
        if (!Number.isFinite(value)) continue;
        min = Math.min(min, value);
        max = Math.max(max, value);
      }
      if (Number.isFinite(min) && max > min) {
        ctx.strokeStyle = this.primaryColor();
        ctx.globalAlpha = 0.3;
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let i = 0; i < n; i++) {
          const x = frame.left + ((i + 0.5) / n) * frame.plotW;
          const y =
            frame.top + frame.plotH * (1 - ((values[i] ?? min) - min) / (max - min));
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }

    // The big number (compacted like value axes: 1.5M, 50k, 12.5).
    const big = formatTick(latest, null);
    const bigSize = Math.min(40, (frame.plotH * 0.45) / ui);
    ctx.fillStyle = frame.text;
    this.font(ctx, ui, bigSize, "700");
    ctx.fillText(this.fit(ctx, big, frame.plotW), frame.left, frame.top + frame.plotH * 0.45);

    // Change vs the previous bucket, in green (up) / red (down).
    const previous = n >= 2 ? (values[n - 2] ?? Number.NaN) : Number.NaN;
    let deltaNote = "";
    if (overTime && Number.isFinite(previous)) {
      const delta = latest - previous;
      const pct = previous !== 0 ? (delta / previous) * 100 : null;
      const flat = delta === 0;
      const arrow = flat ? "→" : delta > 0 ? "↑" : "↓";
      const pctText = pct === null ? "" : ` (${delta > 0 ? "+" : ""}${pct.toFixed(1)}%)`;
      const text = `${arrow} ${formatTick(Math.abs(delta), null)}${pctText} vs previous ${
        result.dimensionNames[0] ?? "period"
      }`;
      ctx.fillStyle = flat ? frame.dim : delta > 0 ? "#10b981" : "#ef4444";
      this.font(ctx, ui, 13, "600");
      ctx.fillText(this.fit(ctx, text, frame.plotW), frame.left, frame.top + frame.plotH * 0.26 + bigSize * ui * 0.2 + 18 * ui);
      deltaNote = ` · ${text}`;
    }

    ctx.fillStyle = frame.dim;
    this.font(ctx, ui, 12);
    const caption = overTime
      ? `${result.labels[n - 1] ?? ""} · ${measure}`
      : `${measure} · all filtered rows`;
    ctx.fillText(this.fit(ctx, caption, frame.plotW), frame.left, frame.top + frame.plotH * 0.88);
    this.noteEl.textContent = `${measure} = ${full}${deltaNote}`;
  }

  /**
   * A card that draws an aggregate result (a bound view, or the card's own
   * value-over-time aggregate) renders it as a line when the first dimension
   * is a time bucket, bars otherwise.
   */
  private drawViewAggregate(ctx: CanvasRenderingContext2D, frame: Frame): void {
    const result = this.aggregateResult();
    if (result === null || result.groupCount === 0) {
      const message = "The aggregate has no groups to draw yet.";
      this.noteEl.textContent = message;
      this.drawPlotMessage(ctx, frame, message);
      return;
    }
    const values = result.measures[0];
    if (values === undefined) {
      const message = "The aggregate has no measures.";
      this.noteEl.textContent = message;
      this.drawPlotMessage(ctx, frame, message);
      return;
    }
    if (this.config.source === "" && result.dimensions.length >= 2) {
      this.drawSplitAggregate(ctx, frame, result, values);
      return;
    }
    if (this.config.kind === "kpi" && this.config.source === "") {
      this.drawKpi(ctx, frame, result, values);
      return;
    }
    const ui = frame.ui;
    const n = result.groupCount;
    let max = 0;
    for (const value of values) {
      if (Number.isFinite(value)) max = Math.max(max, value);
    }
    const top = Math.max(1, max);

    const yTicks = niceTicks(0, top, 4).filter((value, index, all) => index === 0 || formatChartNumber(value) !== formatChartNumber(all[index - 1]));
    ctx.strokeStyle = frame.border;
    ctx.lineWidth = 1;
    ctx.fillStyle = frame.dim;
    this.font(ctx, ui, 10);
    ctx.textAlign = "right";
    for (const value of yTicks) {
      const y = frame.top + frame.plotH - (value / top) * frame.plotH;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(frame.left, y + 0.5);
      ctx.lineTo(frame.left + frame.plotW, y + 0.5);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillText(formatChartNumber(value), frame.left - 6 * ui, y + 3 * ui);
    }
    ctx.textAlign = "left";
    ctx.beginPath();
    ctx.moveTo(frame.left, frame.top + frame.plotH + 0.5);
    ctx.lineTo(frame.left + frame.plotW, frame.top + frame.plotH + 0.5);
    ctx.stroke();

    const slot = frame.plotW / Math.max(1, n);
    const isTime = result.dimensionIsTime[0] === true;
    ctx.strokeStyle = this.primaryColor();
    ctx.fillStyle = this.primaryColor();
    if (isTime) {
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const x = frame.left + (i + 0.5) * slot;
        const y = frame.top + frame.plotH - ((values[i] || 0) / top) * frame.plotH;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.lineTo(frame.left + frame.plotW, frame.top + frame.plotH);
      ctx.lineTo(frame.left, frame.top + frame.plotH);
      ctx.closePath();
      ctx.globalAlpha = 0.18;
      ctx.fill();
      ctx.globalAlpha = 1;
    } else {
      const barW = Math.max(1, slot - 1);
      for (let i = 0; i < n; i++) {
        const height = ((values[i] || 0) / top) * frame.plotH;
        if (height <= 0) continue;
        ctx.globalAlpha = 0.85;
        this.fillTopRounded(ctx, frame.left + i * slot, frame.top + frame.plotH - height, barW, height, 3 * ui);
      }
      ctx.globalAlpha = 1;
    }

    // Incomplete edge periods are hatched so the truncated period is visible.
    const partials = result.partials ?? null;
    let partialCount = 0;
    if (partials !== null) {
      partials.forEach((partial, i) => {
        if (partial) {
          partialCount++;
          const x = frame.left + i * slot;
          ctx.save();
          ctx.beginPath();
          ctx.rect(x, frame.top, slot, frame.plotH);
          ctx.clip();
          ctx.strokeStyle = frame.dim;
          ctx.globalAlpha = 0.4;
          ctx.lineWidth = 1;
          const step = 8 * ui;
          for (let offset = -frame.plotH; offset < slot + frame.plotH; offset += step) {
            ctx.beginPath();
            ctx.moveTo(x + offset, frame.top + frame.plotH);
            ctx.lineTo(x + offset + frame.plotH, frame.top);
            ctx.stroke();
          }
          ctx.restore();
        }
      });
    }

    ctx.fillStyle = frame.dim;
    this.font(ctx, ui, 10);
    ctx.textAlign = "center";
    const step = Math.max(1, Math.ceil(n / 8));
    for (let i = 0; i < n; i += step) {
      const label = result.labels[i] ?? "";
      ctx.fillText(
        this.fit(ctx, label, Math.max(16, slot * step - 4 * ui)),
        frame.left + (i + 0.5) * slot,
        frame.top + frame.plotH + 14 * ui,
      );
    }
    ctx.textAlign = "left";
    const measure = result.measureNames[0] ?? "value";
    ctx.fillText(measure, frame.left, frame.top - 6 * ui);

    const ms = result.ms < 1 ? "<1" : String(Math.round(result.ms));
    const partialNote =
      partialCount > 0
        ? ` · ${partialCount} incomplete ${partialCount === 1 ? "period" : "periods"} (hatched)`
        : "";
    this.noteEl.textContent = `${n.toLocaleString()} groups · ${measure} by ${
      result.dimensionNames[0] ?? "group"
    } · ${ms} ms${partialNote}`;
  }

  private drawSeries(
    ctx: CanvasRenderingContext2D,
    frame: Frame,
    kind: "histogram" | "line",
  ): void {
    const meta = this.meta(this.config.column);
    if (meta === undefined) {
      const message = this.emptySeriesMessage(kind);
      this.noteEl.textContent = message;
      this.drawPlotMessage(ctx, frame, message);
      return;
    }
    if (kind === "line" && this.groupResult !== null) {
      this.drawGroupedLines(ctx, frame);
      return;
    }
    if (kind === "histogram" && this.groupResult !== null) {
      this.drawGroupedHistogram(ctx, frame);
      return;
    }
    if (kind === "histogram" && this.animationResult?.hist !== undefined) {
      this.drawAnimatedHistogram(ctx, frame);
      return;
    }
    const automatic = meta.histogram;
    const custom = kind === "histogram" ? this.binResult : this.lineBinResult;
    const bins =
      custom !== null ? custom.bins : (this.histograms[this.config.column] ?? automatic?.bins ?? []);
    if (bins.length === 0 || automatic === null) {
      const message = "This column has no histogram data yet.";
      this.noteEl.textContent = message;
      this.drawPlotMessage(ctx, frame, message);
      return;
    }
    const ui = frame.ui;
    const hasOverflow = custom !== null && custom.overflow > 0;
    const overflowCount = custom?.overflow ?? 0;
    const maxCount = Math.max(1, ...bins, overflowCount);
    const slots = bins.length + (hasOverflow ? 1 : 0);
    const slotW = frame.plotW / slots;
    const barW = Math.max(1, slotW - 1);
    const min =
      this.lineBinRange?.min ??
      this.chartXZoom?.min ??
      this.config.binOptions?.min ??
      automatic.min;
    const max =
      this.lineBinRange?.max ??
      this.chartXZoom?.max ??
      this.config.binOptions?.max ??
      automatic.max;
    this.hitRegions = seriesHitRegions(
      { left: frame.left, top: frame.top, plotW: frame.plotW, plotH: frame.plotH },
      {
        column: this.config.column,
        bins,
        overflow: hasOverflow ? overflowCount : 0,
        min,
        max,
        dateAxis: kind === "line",
        axisFormat: axisKindFor(meta.type) ?? undefined,
      },
    );

    this.drawCountAxis(ctx, frame, maxCount);

    if (kind === "line") {
      // Say what one point on the line counts: "Rows per day" and not just ticks.
      const unit = this.lineUnitLabel(min, max, bins.length);
      const tzNote = meta.timeZoneAware === true ? " · source offsets shown in UTC" : "";
      ctx.fillStyle = frame.dim;
      this.font(ctx, ui, 10);
      ctx.textAlign = "left";
      ctx.fillText(`${unit}${tzNote}`, frame.left, frame.top - 6 * ui);
    }

    if (kind === "histogram") {
      for (let i = 0; i < bins.length; i++) {
        const h = (bins[i] / maxCount) * frame.plotH;
        if (h <= 0) continue;
        ctx.globalAlpha = 0.85;
        ctx.fillStyle = this.primaryColor();
        this.fillTopRounded(ctx, frame.left + i * slotW, frame.top + frame.plotH - h, barW, h, 3 * ui);
      }
      if (hasOverflow) {
        const h = (overflowCount / maxCount) * frame.plotH;
        const x = frame.left + bins.length * slotW + 3 * ui;
        ctx.globalAlpha = 0.55;
        this.fillTopRounded(ctx, x, frame.top + frame.plotH - h, Math.max(1, slotW - 4 * ui), h, 3 * ui);
      }
      ctx.globalAlpha = 1;
    } else {
      ctx.beginPath();
      for (let i = 0; i < bins.length; i++) {
        const x = frame.left + (i + 0.5) * slotW;
        const y = frame.top + frame.plotH - (bins[i] / maxCount) * frame.plotH;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = this.primaryColor();
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.lineTo(frame.left + frame.plotW, frame.top + frame.plotH);
      ctx.lineTo(frame.left, frame.top + frame.plotH);
      ctx.closePath();
      ctx.globalAlpha = 0.18;
      ctx.fillStyle = this.primaryColor();
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    if (kind === "histogram" && this.config.kde && bins.length >= 4) {
      const smooth = smoothSeries(bins, 1.4);
      ctx.beginPath();
      for (let i = 0; i < smooth.length; i++) {
        const x = frame.left + (i + 0.5) * slotW;
        const y = frame.top + frame.plotH - (smooth[i] / maxCount) * frame.plotH;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = frame.text;
      ctx.globalAlpha = 0.7;
      ctx.lineWidth = 1.8;
      ctx.stroke();
      ctx.lineTo(frame.left + frame.plotW, frame.top + frame.plotH);
      ctx.lineTo(frame.left, frame.top + frame.plotH);
      ctx.closePath();
      ctx.globalAlpha = 0.08;
      ctx.fillStyle = this.primaryColor();
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    if (
      kind === "histogram" &&
      custom !== null &&
      this.binMedian !== null &&
      max > min &&
      !automatic.symlog
    ) {
      const ratio = (this.binMedian - min) / (max - min);
      if (ratio >= 0 && ratio <= 1) {
        const x = frame.left + ratio * frame.plotW;
        ctx.strokeStyle = frame.text;
        ctx.globalAlpha = 0.7;
        ctx.setLineDash([5, 3]);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, frame.top);
        ctx.lineTo(x, frame.top + frame.plotH);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
        const label = `median ${formatChartNumber(this.binMedian)}`;
        this.font(ctx, ui, 10);
        const width = ctx.measureText(label).width;
        ctx.fillStyle = frame.text;
        const labelX =
          x + 4 * ui + width > frame.left + frame.plotW ? x - 4 * ui - width : x + 4 * ui;
        ctx.fillText(label, labelX, frame.top + 12 * ui);
      }
    }

    ctx.fillStyle = frame.dim;
    this.font(ctx, ui, 10);
    const tickKind: "histogram" | AxisFormat =
      axisKindFor(meta.type) ?? (kind === "line" ? "line" : "histogram");
    const tickSpan = max - min;
    const mid = (min + max) / 2;
    const minLabel = formatTick(min, tickKind, tickSpan);
    ctx.fillText(minLabel, frame.left, frame.top + frame.plotH + 16 * ui);
    // On narrow cards the midpoint label collides with the edge labels.
    if (frame.plotW >= 220 * (ui / 1.25)) {
      const midLabel = formatTick(mid, tickKind, tickSpan);
      ctx.fillText(
        midLabel,
        frame.left + frame.plotW / 2 - ctx.measureText(midLabel).width / 2,
        frame.top + frame.plotH + 16 * ui,
      );
    }
    const maxLabel = formatTick(max, tickKind, tickSpan);
    ctx.fillText(
      maxLabel,
      frame.left + frame.plotW - 4 * ui - ctx.measureText(maxLabel).width,
      frame.top + frame.plotH + 16 * ui,
    );
    if (hasOverflow) {
      const overflowLabel = `> ${formatTick(max, tickKind, tickSpan)}`;
      ctx.fillText(
        overflowLabel,
        frame.left + frame.plotW - ctx.measureText(overflowLabel).width,
        frame.top + frame.plotH + 30 * ui,
      );
    }

    const notes: string[] = [];
    if (custom !== null) {
      notes.push(`${custom.bins.length} bins`);
      if (this.config.binClipped) notes.push("End clipped to p95 — Full range shows everything");
      if (custom.below > 0) notes.push(`${custom.below.toLocaleString()} below start`);
      if (custom.overflow > 0) notes.push(`${custom.overflow.toLocaleString()} in “> Max”`);
      if (custom.above > 0) notes.push(`${custom.above.toLocaleString()} above end`);
    } else if (automatic.symlog) {
      notes.push("signed-log scale (heavy tail)");
    }
    if (custom === null) {
      const outside = automatic.below + automatic.above;
      if (outside > 0) notes.push(`${outside.toLocaleString()} values beyond the p1-p99 chart range`);
    }
    notes.push("scroll to zoom · drag to pan · double-click resets");
    this.noteEl.textContent = notes.join(" · ");
  }

  /** Shared count-axis grid and baseline for histogram and line kinds. */
  private drawCountAxis(
    ctx: CanvasRenderingContext2D,
    frame: Frame,
    maxCount: number,
  ): void {
    const ui = frame.ui;
    const yTicks = niceTicks(0, maxCount, 4).filter((value, index, all) => index === 0 || formatCount(value) !== formatCount(all[index - 1]));
    ctx.strokeStyle = frame.border;
    ctx.lineWidth = 1;
    ctx.fillStyle = frame.dim;
    this.font(ctx, ui, 10);
    ctx.textAlign = "right";
    for (const value of yTicks) {
      const y = frame.top + frame.plotH - (value / maxCount) * frame.plotH;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(frame.left, y + 0.5);
      ctx.lineTo(frame.left + frame.plotW, y + 0.5);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillText(formatCount(value), frame.left - 6 * ui, y + 3 * ui);
    }
    ctx.textAlign = "left";
    ctx.beginPath();
    ctx.moveTo(frame.left, frame.top + frame.plotH + 0.5);
    ctx.lineTo(frame.left + frame.plotW, frame.top + frame.plotH + 0.5);
    ctx.stroke();
  }

  /** "Rows per day" for the time-series Y axis, from the bin's date span. */
  private lineUnitLabel(min: number, max: number, bins: number): string {
    if (!(max > min) || bins <= 0) return "Rows";
    const per = (max - min) / bins;
    const units: readonly (readonly [number, string])[] = [
      [365.25 * 86_400_000, "year"],
      [30.44 * 86_400_000, "month"],
      [7 * 86_400_000, "week"],
      [86_400_000, "day"],
      [3_600_000, "hour"],
      [60_000, "minute"],
    ];
    for (const [span, name] of units) {
      if (per >= span * 0.9) {
        const count = Math.round((per / span) * 10) / 10;
        return `Rows per ${count === 1 ? name : `${count} ${name}s`}`;
      }
    }
    return "Rows";
  }

  /**
   * Time series split by a category: one line per visible group over the same
   * automatic date range, a clickable legend and per-group tooltip counts.
   */
  /**
   * Overlaid histograms for a grouped histogram: one outline per category,
   * drawn as the share of that group's rows per bin so curves compare shapes
   * even when the groups have very different sizes.
   */
  private drawGroupedHistogram(ctx: CanvasRenderingContext2D, frame: Frame): void {
    const result = this.groupResult;
    const meta = this.meta(this.config.column);
    if (result === null || meta === undefined || meta.histogram === null) {
      const message = "This column has no histogram data yet.";
      this.noteEl.textContent = message;
      this.drawPlotMessage(ctx, frame, message);
      return;
    }
    const automatic = meta.histogram;
    const min = this.config.binOptions?.min ?? automatic.min;
    const max = this.config.binOptions?.max ?? automatic.max;
    const bins = Math.max(1, result.bins > 0 ? result.bins : automatic.bins.length);
    const ui = frame.ui;

    const groups = result.labels
      .map((label, index) => ({
        label,
        code: result.codes[index] ?? index,
        index,
        counts: result.groups[index] ?? [],
        total: result.totals[index] ?? 0,
      }))
      .filter((entry) => !this.hiddenGroups.has(entry.code) && entry.total > 0);
    if (groups.length === 0) {
      const message = "Every group is hidden in the legend.";
      this.noteEl.textContent = message;
      this.drawPlotMessage(ctx, frame, message);
      return;
    }

    const shares = groups.map((group) =>
      Array.from(group.counts, (count) => {
        const share = count / group.total;
        return Number.isFinite(share) ? share : 0;
      }),
    );
    // Smooth the outlines when bins are numerous so overlaid curves read as
    // curves rather than spikes.
    const smooth = bins >= 8 ? shares.map((share) => smoothSeries(share, 1.2)) : shares;
    let maxShare = 0.0001;
    for (const share of smooth) {
      for (const value of share) {
        if (value > maxShare) maxShare = value;
      }
    }

    // Y axis in percent of the group (share), not counts.
    const yTicks = niceTicks(0, maxShare, 4).filter((value, index, all) => index === 0 || `${Math.round(value * 100)}%` !== `${Math.round(all[index - 1] * 100)}%`);
    ctx.strokeStyle = frame.border;
    ctx.lineWidth = 1;
    ctx.fillStyle = frame.dim;
    this.font(ctx, ui, 10);
    ctx.textAlign = "right";
    for (const value of yTicks) {
      const y = frame.top + frame.plotH - (value / maxShare) * frame.plotH;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(frame.left, y + 0.5);
      ctx.lineTo(frame.left + frame.plotW, y + 0.5);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillText(`${Math.round(value * 100)}%`, frame.left - 6 * ui, y + 3 * ui);
    }
    ctx.textAlign = "left";
    ctx.beginPath();
    ctx.moveTo(frame.left, frame.top + frame.plotH + 0.5);
    ctx.lineTo(frame.left + frame.plotW, frame.top + frame.plotH + 0.5);
    ctx.stroke();

    const slot = frame.plotW / bins;
    groups.forEach((group, groupIndex) => {
      const share = smooth[groupIndex] ?? [];
      const color = this.groupColor(group.index);
      ctx.beginPath();
      share.forEach((value, bin) => {
        const x = frame.left + (bin + 0.5) * slot;
        const y = frame.top + frame.plotH - (value / maxShare) * frame.plotH;
        if (bin === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.8;
      ctx.stroke();
      ctx.lineTo(frame.left + frame.plotW, frame.top + frame.plotH);
      ctx.lineTo(frame.left, frame.top + frame.plotH);
      ctx.closePath();
      ctx.globalAlpha = 0.12;
      ctx.fillStyle = color;
      ctx.fill();
      ctx.globalAlpha = 1;
    });

    ctx.fillStyle = frame.dim;
    this.font(ctx, ui, 10);
    ctx.fillText("share of each group per bin", frame.left, frame.top - 6 * ui);
    const histTickKind: "histogram" | AxisFormat = axisKindFor(meta.type) ?? "histogram";
    const histTickSpan = max - min;
    const mid = (min + max) / 2;
    ctx.fillText(formatTick(min, histTickKind, histTickSpan), frame.left, frame.top + frame.plotH + 16 * ui);
    const midLabel = formatTick(mid, histTickKind, histTickSpan);
    ctx.fillText(
      midLabel,
      frame.left + frame.plotW / 2 - ctx.measureText(midLabel).width / 2,
      frame.top + frame.plotH + 16 * ui,
    );
    const maxLabel = formatTick(max, histTickKind, histTickSpan);
    ctx.fillText(
      maxLabel,
      frame.left + frame.plotW - 4 * ui - ctx.measureText(maxLabel).width,
      frame.top + frame.plotH + 16 * ui,
    );

    const groupName = this.meta(this.config.groupColumn)?.name ?? "group";
    this.noteEl.textContent = `${groups.length} curves by ${groupName} · share of each group per bin · ${result.total.toLocaleString()} rows`;
  }

  private drawGroupedLines(ctx: CanvasRenderingContext2D, frame: Frame): void {
    const result = this.groupResult;
    const histogram = this.meta(this.config.column)?.histogram ?? null;
    if (result === null || histogram === null || result.bins === 0) {
      const message = "This column has no histogram data yet.";
      this.noteEl.textContent = message;
      this.drawPlotMessage(ctx, frame, message);
      return;
    }
    const binCount = result.bins;
    const min = histogram.min;
    const max = histogram.max;
    const ui = frame.ui;
    const slotW = frame.plotW / binCount;
    const visible = result.groups
      .map((bins, index) => ({ bins, index }))
      .filter((entry) => !this.hiddenGroups.has(result.codes[entry.index]));
    let maxCount = 1;
    for (const entry of visible) {
      for (const value of entry.bins) if (value > maxCount) maxCount = value;
    }

    this.drawCountAxis(ctx, frame, maxCount);

    for (const entry of visible) {
      ctx.beginPath();
      for (let i = 0; i < binCount; i++) {
        const x = frame.left + (i + 0.5) * slotW;
        const y = frame.top + frame.plotH - (entry.bins[i] / maxCount) * frame.plotH;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = this.groupColor(entry.index);
      ctx.lineWidth = Math.max(1.5, 1.6 * ui);
      ctx.globalAlpha = 0.9;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    ctx.fillStyle = frame.dim;
    this.font(ctx, ui, 10);
    const lineTickKind: "histogram" | AxisFormat =
      axisKindFor(this.meta(this.config.column)?.type ?? "date") ?? "line";
    const lineTickSpan = max - min;
    const mid = (min + max) / 2;
    ctx.fillText(formatTick(min, lineTickKind, lineTickSpan), frame.left, frame.top + frame.plotH + 16 * ui);
    const midLabel = formatTick(mid, lineTickKind, lineTickSpan);
    ctx.fillText(
      midLabel,
      frame.left + frame.plotW / 2 - ctx.measureText(midLabel).width / 2,
      frame.top + frame.plotH + 16 * ui,
    );
    const maxLabel = formatTick(max, lineTickKind, lineTickSpan);
    ctx.fillText(
      maxLabel,
      frame.left + frame.plotW - 4 * ui - ctx.measureText(maxLabel).width,
      frame.top + frame.plotH + 16 * ui,
    );

    this.hitRegions = groupedSeriesHitRegions(
      { left: frame.left, top: frame.top, plotW: frame.plotW, plotH: frame.plotH },
      {
        column: this.config.column,
        groups: visible.map((entry) => ({
          label: result.labels[entry.index],
          bins: entry.bins,
        })),
        min,
        max,
        axisFormat: axisKindFor(this.meta(this.config.column)?.type ?? "date") ?? "line",
      },
    );

    const groupName = this.meta(this.config.groupColumn)?.name ?? "group";
    const total = result.groups.length;
    const notes = [
      this.hiddenGroups.size === 0
        ? `${total} lines by ${groupName}`
        : `${visible.length} of ${total} lines by ${groupName}`,
    ];
    if (result.otherIndex >= 0) notes.push(`top ${GROUP_LINE_LIMIT} + Other`);
    notes.push(`${result.total.toLocaleString()} rows`);
    if (result.ms > 0) notes.push(`${Math.round(result.ms)} ms`);
    this.noteEl.textContent = notes.join(" · ");
  }

  private groupColor(index: number): string {
    return this.paletteColor(index);
  }

  /** Clickable legend under grouped time series; entries toggle line visibility. */
  private syncLegend(): void {
    const result = this.groupResult;
    const bubbleGroups =
      this.config.kind === "bubble"
        ? (this.bubbleResult?.groups ?? this.animationResult?.bubble?.groups ?? null)
        : null;
    const entries =
      bubbleGroups !== null
        ? bubbleGroups.map((group) => ({ label: group.label, code: group.code }))
        : (this.config.kind === "line" || this.config.kind === "histogram") && result !== null
          ? result.labels.map((label, index) => ({
              label,
              code: result.codes[index] ?? index,
            }))
          : null;
    this.legendEl.classList.toggle("hidden", entries === null);
    this.legendEl.replaceChildren();
    if (entries === null) return;
    entries.forEach(({ label, code }, index) => {
      const off = this.hiddenGroups.has(code);
      const item = el(
        "button",
        {
          class: "chart-legend-item",
          type: "button",
          "aria-pressed": off ? "false" : "true",
          title: off ? `Show ${label}` : `Hide ${label}`,
        },
        [label],
      ) as HTMLButtonElement;
      const swatch = el("span", { class: "chart-legend-swatch" });
      swatch.style.background = this.groupColor(index);
      item.prepend(swatch);
      item.classList.toggle("off", off);
      item.addEventListener("click", () => {
        if (this.hiddenGroups.has(code)) this.hiddenGroups.delete(code);
        else this.hiddenGroups.add(code);
        this.render();
      });
      this.legendEl.append(item);
    });
  }

  /** Animated bars: category counts for the current frame only. */
  /** Animated histogram: bin counts for the current frame on a global scale. */
  private drawAnimatedHistogram(ctx: CanvasRenderingContext2D, frame: Frame): void {
    const result = this.animationResult;
    const hist = result?.hist;
    if (result === null || hist === undefined) {
      const message = "No frames to draw yet.";
      this.noteEl.textContent = message;
      this.drawPlotMessage(ctx, frame, message);
      return;
    }
    const frameIndex = Math.min(Math.max(0, this.animationFrame), result.frames.length - 1);
    const bins = hist.bins;
    const offset = frameIndex * bins;
    const ui = frame.ui;
    const maxCount = Math.max(1, result.maxCount);
    const slotW = frame.plotW / bins;
    const barW = Math.max(1, slotW - 1);

    const yTicks = niceTicks(0, maxCount, 4).filter(
      (value, index, all) =>
        index === 0 || formatCount(value) !== formatCount(all[index - 1]),
    );
    ctx.strokeStyle = frame.border;
    ctx.lineWidth = 1;
    ctx.fillStyle = frame.dim;
    this.font(ctx, ui, 10);
    ctx.textAlign = "right";
    for (const value of yTicks) {
      const y = frame.top + frame.plotH - (value / maxCount) * frame.plotH;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(frame.left, y + 0.5);
      ctx.lineTo(frame.left + frame.plotW, y + 0.5);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillText(formatCount(value), frame.left - 6 * ui, y + 3 * ui);
    }
    ctx.textAlign = "left";
    ctx.beginPath();
    ctx.moveTo(frame.left, frame.top + frame.plotH + 0.5);
    ctx.lineTo(frame.left + frame.plotW, frame.top + frame.plotH + 0.5);
    ctx.stroke();

    for (let bin = 0; bin < bins; bin++) {
      const count = hist.counts[offset + bin] ?? 0;
      const height = (count / maxCount) * frame.plotH;
      if (height <= 0) continue;
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = this.primaryColor();
      this.fillTopRounded(
        ctx,
        frame.left + bin * slotW,
        frame.top + frame.plotH - height,
        barW,
        height,
        3 * ui,
      );
    }
    ctx.globalAlpha = 1;

    ctx.fillStyle = frame.dim;
    this.font(ctx, ui, 10);
    const animTickKind: "histogram" | AxisFormat =
      axisKindFor(this.meta(this.config.column)?.type ?? "number") ?? "histogram";
    const animTickSpan = hist.max - hist.min;
    const mid = (hist.min + hist.max) / 2;
    ctx.fillText(formatTick(hist.min, animTickKind, animTickSpan), frame.left, frame.top + frame.plotH + 16 * ui);
    const midLabel = formatTick(mid, animTickKind, animTickSpan);
    ctx.fillText(
      midLabel,
      frame.left + frame.plotW / 2 - ctx.measureText(midLabel).width / 2,
      frame.top + frame.plotH + 16 * ui,
    );
    const maxLabel = formatTick(hist.max, animTickKind, animTickSpan);
    ctx.fillText(
      maxLabel,
      frame.left + frame.plotW - 4 * ui - ctx.measureText(maxLabel).width,
      frame.top + frame.plotH + 16 * ui,
    );

    const time = result.frames[frameIndex]?.label ?? "";
    this.font(ctx, ui, 12, "600");
    ctx.fillStyle = frame.text;
    ctx.fillText(time, frame.left + frame.plotW - ctx.measureText(time).width, frame.top - 8 * ui);
    const name = this.meta(this.config.column)?.name ?? "values";
    this.noteEl.textContent = `${time} · ${name} · ${bins} bins · ${result.total.toLocaleString()} rows`;
  }

  /** Animated treemap: tile areas from the current frame's category counts. */
  private drawAnimatedTreemap(ctx: CanvasRenderingContext2D, frame: Frame): void {
    const result = this.animationResult;
    const barData = result?.bar;
    if (result === null || barData === undefined) {
      const message = "No frames to draw yet.";
      this.noteEl.textContent = message;
      this.drawPlotMessage(ctx, frame, message);
      return;
    }
    const frameIndex = Math.min(Math.max(0, this.animationFrame), result.frames.length - 1);
    const width = Math.max(1, barData.labels.length);
    const offset = frameIndex * width;
    const entries = barData.labels
      .map((label, index) => ({ label, value: barData.counts[offset + index] ?? 0 }))
      .filter((entry) => entry.value > 0)
      .sort((a, b) => b.value - a.value);
    if (entries.length === 0) {
      const message = "No rows in this frame.";
      this.noteEl.textContent = message;
      this.drawPlotMessage(ctx, frame, message);
      return;
    }
    const total = entries.reduce((sum, entry) => sum + entry.value, 0);
    const rects = squarifyLayout(
      entries.map((entry) => entry.value),
      frame.left,
      frame.top,
      frame.plotW,
      frame.plotH,
    );
    const ui = frame.ui;
    this.hitRegions = [];
    rects.forEach((rect, index) => {
      const entry = entries[index];
      if (entry === undefined || rect.w <= 0 || rect.h <= 0) return;
      ctx.globalAlpha = 0.85;
      ctx.fillStyle =
        this.config.multiColor === true ? this.paletteColor(index) : this.primaryColor();
      ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = cssVar("--panel", "#ffffff");
      ctx.lineWidth = 1.5;
      ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.w - 1, rect.h - 1);
      if (rect.w < 42 * ui || rect.h < 18 * ui) return;
      ctx.textAlign = "left";
      ctx.fillStyle = "#ffffff";
      this.font(ctx, ui, 11, "600");
      ctx.fillText(
        this.fit(ctx, entry.label === "" ? "(blank)" : entry.label, rect.w - 10 * ui),
        rect.x + 5 * ui,
        rect.y + 14 * ui,
      );
      this.font(ctx, ui, 10);
      ctx.fillText(
        `${formatCount(entry.value)} · ${((entry.value / total) * 100).toFixed(1)}%`,
        rect.x + 5 * ui,
        rect.y + 27 * ui,
      );
    });
    ctx.textAlign = "left";
    const time = result.frames[frameIndex]?.label ?? "";
    this.font(ctx, ui, 12, "600");
    ctx.fillStyle = frame.text;
    ctx.fillText(time, frame.left + frame.plotW - ctx.measureText(time).width, frame.top - 8 * ui);
    const name = this.meta(this.config.column)?.name ?? "category";
    this.noteEl.textContent = `${time} · ${formatCount(total)} rows in ${entries.length} tiles by ${name}`;
  }

  /** Animated density: the frame's grid through the normal density renderer. */
  private drawAnimatedDensity(ctx: CanvasRenderingContext2D, frame: Frame): void {
    const result = this.animationResult;
    const animated = result?.bubble;
    const xMeta = this.meta(this.config.x);
    const yMeta = this.meta(this.config.y);
    if (
      result === null ||
      animated === undefined ||
      xMeta === undefined ||
      yMeta === undefined
    ) {
      const message = "Density animation needs two numeric columns — pick X and Y above.";
      this.noteEl.textContent = message;
      this.drawPlotMessage(ctx, frame, message);
      return;
    }
    const frameIndex = Math.min(Math.max(0, this.animationFrame), result.frames.length - 1);
    const cellCount = animated.bins * animated.bins;
    const groupCount = animated.groups === null ? 1 : animated.groups.length;
    const counts = new Float64Array(animated.bins * animated.bins);
    // Merge the frame's group grids back into one density surface; the layout
    // is frames * groups * cells when the worker was asked to group.
    for (let group = 0; group < groupCount; group++) {
      const base = (frameIndex * groupCount + group) * cellCount;
      for (let cell = 0; cell < cellCount; cell++) {
        counts[cell] += animated.grids[base + cell] ?? 0;
      }
    }
    const merged = Uint32Array.from(counts);
    let max = 0;
    let total = 0;
    for (const count of merged) {
      total += count;
      if (count > max) max = count;
    }
    const grid: SeriesGrid = {
      mode: "density",
      counts: merged,
      cols: animated.bins,
      rows: animated.bins,
      xMin: animated.xMin,
      xMax: animated.xMax,
      yMin: animated.yMin,
      yMax: animated.yMax,
      total,
      outside: 0,
      max,
    };
    const savedCorrelation = this.seriesCorrelation;
    this.seriesCorrelation = Number.NaN;
    try {
      this.drawDensity(ctx, frame, grid, xMeta, yMeta);
    } finally {
      this.seriesCorrelation = savedCorrelation;
    }
    const time = result.frames[frameIndex]?.label ?? "";
    this.font(ctx, frame.ui, 12, "600");
    ctx.textAlign = "left";
    ctx.fillStyle = frame.text;
    ctx.fillText(
      time,
      frame.left + frame.plotW - ctx.measureText(time).width,
      frame.top - 8 * frame.ui,
    );
    this.noteEl.textContent = `${time} · ${this.noteEl.textContent ?? ""}`;
  }

  private drawAnimatedBars(ctx: CanvasRenderingContext2D, frame: Frame): void {
    const result = this.animationResult;
    const barData = result?.bar;
    if (result === null || barData === undefined || result.frames.length === 0) {
      const message = "No frames to draw yet.";
      this.noteEl.textContent = message;
      this.drawPlotMessage(ctx, frame, message);
      return;
    }
    const frameIndex = Math.min(Math.max(0, this.animationFrame), result.frames.length - 1);
    const labels = barData.labels;
    const width = Math.max(1, labels.length);
    const offset = frameIndex * width;
    const ui = frame.ui;
    // Every frame scales to the global maximum, so growth and decline over
    // time are visible instead of each frame refilling the plot.
    const maxCount = Math.max(1, result.maxCount);
    const slotW = frame.plotW / width;
    const barW = Math.max(4, slotW - Math.min(18 * ui, slotW * 0.25));

    const yTicks = niceTicks(0, maxCount, 4).filter((value, index, all) => index === 0 || formatCount(value) !== formatCount(all[index - 1]));
    ctx.strokeStyle = frame.border;
    ctx.lineWidth = 1;
    ctx.fillStyle = frame.dim;
    this.font(ctx, ui, 10);
    ctx.textAlign = "right";
    for (const value of yTicks) {
      const y = frame.top + frame.plotH - (value / maxCount) * frame.plotH;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(frame.left, y + 0.5);
      ctx.lineTo(frame.left + frame.plotW, y + 0.5);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillText(formatCount(value), frame.left - 6 * ui, y + 3 * ui);
    }
    ctx.textAlign = "left";
    ctx.beginPath();
    ctx.moveTo(frame.left, frame.top + frame.plotH + 0.5);
    ctx.lineTo(frame.left + frame.plotW, frame.top + frame.plotH + 0.5);
    ctx.stroke();

    this.font(ctx, ui, 10);
    labels.forEach((label, index) => {
      const count = barData.counts[offset + index] ?? 0;
      const height = (count / maxCount) * frame.plotH;
      const x = frame.left + index * slotW + (slotW - barW) / 2;
      if (height > 0) {
        ctx.globalAlpha = 0.9;
        ctx.fillStyle =
          this.config.multiColor === true ? this.paletteColor(index) : this.primaryColor();
        this.fillTopRounded(ctx, x, frame.top + frame.plotH - height, barW, height, 4 * ui);
        ctx.globalAlpha = 1;
        if (slotW > 42 * ui) {
          ctx.fillStyle = frame.dim;
          ctx.textAlign = "center";
          ctx.fillText(
            formatCount(count),
            x + barW / 2,
            Math.max(frame.top + 8 * ui, frame.top + frame.plotH - height - 4 * ui),
          );
        }
      }
      ctx.fillStyle = frame.dim;
      ctx.textAlign = "center";
      let text = label === "" ? "(blank)" : label;
      const maxLabelW = Math.max(10, slotW - 6 * ui);
      while (text.length > 2 && ctx.measureText(text).width > maxLabelW) text = text.slice(0, -2);
      if (text !== label) text = `${text}…`;
      ctx.fillText(text, frame.left + (index + 0.5) * slotW, frame.top + frame.plotH + 16 * ui);
    });
    ctx.textAlign = "left";

    const time = result.frames[frameIndex]?.label ?? "";
    this.font(ctx, ui, 12, "600");
    ctx.fillStyle = frame.text;
    ctx.fillText(time, frame.left + frame.plotW - ctx.measureText(time).width, frame.top - 8 * ui);
    this.noteEl.textContent = `${time} · ${result.total.toLocaleString()} rows · play or scrub below`;
  }

  /** Bubble chart: rows per x/y grid cell, sized by count or a measure. */
  private drawBubble(ctx: CanvasRenderingContext2D, frame: Frame): void {
    const animated = this.animationResult?.bubble;
    if (animated !== undefined && this.animationResult !== null) {
      const frames = this.animationResult.frames;
      const index = Math.min(Math.max(0, this.animationFrame), Math.max(0, frames.length - 1));
      const cellCount = animated.bins * animated.bins;
      const groupCount = animated.groups === null ? 1 : animated.groups.length;
      const frameBase = index * groupCount * cellCount;
      const layers: BubbleLayer[] = [];
      for (let group = 0; group < groupCount; group++) {
        const meta = animated.groups?.[group];
        const code = meta?.code ?? 0;
        if (animated.groups !== null && this.hiddenGroups.has(code)) continue;
        const base = frameBase + group * cellCount;
        layers.push({
          label: meta?.label ?? "",
          code,
          counts: animated.grids.subarray(base, base + cellCount),
          values:
            animated.values === null
              ? null
              : animated.values.slice(base, base + cellCount),
          color: animated.groups === null ? this.primaryColor() : this.groupColor(group),
        });
      }
      this.drawBubbleGrid(ctx, frame, {
        xMin: animated.xMin,
        xMax: animated.xMax,
        yMin: animated.yMin,
        yMax: animated.yMax,
        bins: animated.bins,
        layers,
        maxCount: this.animationResult.maxCount,
        valueMax: animated.valueMax,
        total: this.animationResult.total,
        caption: frames[index]?.label ?? "",
        groupCount,
      });
      return;
    }
    const result = this.bubbleResult;
    if (result === null) {
      const message =
        this.columns.length === 0
          ? "Load data to see charts."
          : "Bubble needs two numeric columns — pick X and Y above.";
      this.noteEl.textContent = message;
      this.drawPlotMessage(ctx, frame, message);
      return;
    }
    const layers: BubbleLayer[] = [];
    if (result.groups === null) {
      layers.push({
        label: "",
        code: 0,
        counts: result.counts,
        values: result.values,
        color: this.primaryColor(),
      });
    } else {
      result.groups.forEach((group, index) => {
        if (this.hiddenGroups.has(group.code)) return;
        layers.push({
          label: group.label,
          code: group.code,
          counts: group.counts,
          values: group.values,
          color: this.groupColor(index),
        });
      });
    }
    const view = this.plotView ?? {
      xMin: result.xMin,
      xMax: result.xMax,
      yMin: result.yMin,
      yMax: result.yMax,
    };
    this.drawBubbleGrid(ctx, frame, {
      xMin: view.xMin,
      xMax: view.xMax,
      yMin: view.yMin,
      yMax: view.yMax,
      bins: result.bins,
      layers,
      maxCount: result.maxCount,
      valueMax: result.valueMax,
      total: result.total,
      caption: "",
      groupCount: result.groups === null ? 1 : result.groups.length,
    });
  }

  /** Human description of what the bubble sizes represent. */
  private bubbleSizeLabel(): string {
    const measure = this.bubbleMeasure();
    if (measure === undefined) return "rows per cell";
    const name = this.meta(measure.column)?.name ?? "?";
    return `${measure.agg}(${name}) per cell`;
  }

  /** Radius fraction for one cell value under the configured scale. */
  private bubbleFraction(value: number, max: number): number {
    if (!(max > 0) || !Number.isFinite(value) || value <= 0) return 0;
    const t = Math.min(1, value / max);
    switch (this.config.bubbleScale ?? "area") {
      case "radius":
        return t;
      case "log":
        return Math.log1p(value) / Math.log1p(max);
      default:
        return Math.sqrt(t);
    }
  }

  private drawBubbleGrid(
    ctx: CanvasRenderingContext2D,
    frame: Frame,
    input: {
      xMin: number;
      xMax: number;
      yMin: number;
      yMax: number;
      bins: number;
      layers: BubbleLayer[];
      maxCount: number;
      valueMax: number;
      total: number;
      caption: string;
      groupCount: number;
    },
  ): void {
    const ui = frame.ui;
    const { xMin, xMax, yMin, yMax, bins } = input;
    const scaleName = this.config.bubbleScale ?? "area";

    const xTicks = niceTicks(xMin, xMax, 4);
    const yTicks = niceTicks(yMin, yMax, 4).filter(
      (value, index, all) =>
        index === 0 || formatChartNumber(value) !== formatChartNumber(all[index - 1]),
    );
    ctx.lineWidth = 1;
    ctx.fillStyle = frame.dim;
    this.font(ctx, ui, 10);
    ctx.textAlign = "right";
    for (const value of yTicks) {
      const y =
        frame.top + frame.plotH - ((value - yMin) / Math.max(1e-12, yMax - yMin)) * frame.plotH;
      ctx.strokeStyle = frame.border;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(frame.left, y + 0.5);
      ctx.lineTo(frame.left + frame.plotW, y + 0.5);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillText(formatChartNumber(value), frame.left - 6 * ui, y + 3 * ui);
    }
    ctx.textAlign = "center";
    for (const value of xTicks) {
      const x = frame.left + ((value - xMin) / Math.max(1e-12, xMax - xMin)) * frame.plotW;
      ctx.fillText(formatChartNumber(value), x, frame.top + frame.plotH + 14 * ui);
    }
    ctx.textAlign = "left";

    const grouped = input.layers.length > 1 || input.layers[0]?.label !== "";
    let cells = 0;
    let frameRows = 0;
    for (const layer of input.layers) {
      const sizeValues = layer.values;
      const sizeMax =
        sizeValues === null ? Math.max(1, input.maxCount) : Math.max(1e-12, input.valueMax);
      for (let by = 0; by < bins; by++) {
        for (let bx = 0; bx < bins; bx++) {
          const cell = by * bins + bx;
          const count = layer.counts[cell] ?? 0;
          if (count === 0) continue;
          const value = sizeValues === null ? count : (sizeValues[cell] ?? Number.NaN);
          if (!Number.isFinite(value) || value <= 0) continue;
          cells++;
          frameRows += count;
          const x = frame.left + ((bx + 0.5) / bins) * frame.plotW;
          const y = frame.top + frame.plotH - ((by + 0.5) / bins) * frame.plotH;
          const fraction = this.bubbleFraction(value, sizeMax);
          const radius = (1.5 + 13 * fraction) * ui;
          ctx.globalAlpha = 0.24 + 0.5 * fraction;
          ctx.fillStyle = layer.color;
          ctx.beginPath();
          ctx.arc(x, y, radius, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 0.75;
          ctx.strokeStyle = layer.color;
          ctx.lineWidth = 1;
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
      }
    }
    if (input.caption !== "") {
      this.font(ctx, ui, 12, "600");
      ctx.fillStyle = frame.text;
      ctx.fillText(
        input.caption,
        frame.left + frame.plotW - ctx.measureText(input.caption).width,
        frame.top - 8 * ui,
      );
    }
    const xName = this.meta(this.config.x)?.name ?? "x";
    const yName = this.meta(this.config.y)?.name ?? "y";
    const caption = input.caption === "" ? "" : `${input.caption} · `;
    const scaleNote =
      scaleName === "area" ? "" : scaleName === "log" ? " (log scale)" : " (radius scale)";
    const groupName = this.meta(this.config.groupColumn)?.name;
    const groupNote =
      grouped && groupName !== undefined
        ? ` · ${input.layers.length} of ${input.groupCount} groups by ${groupName}`
        : "";
    this.noteEl.textContent = `${caption}${frameRows.toLocaleString()} rows in ${cells.toLocaleString()} cells · ${xName} × ${yName} · size: ${this.bubbleSizeLabel()}${scaleNote}${groupNote}`;
  }

  /**
   * Column names for the axes of the current chart, or null where a title
   * would be noise (treemaps label their tiles, correlation its cells).
   */
  private axisLabels(): { x: string | null; y: string | null } {
    const name = (index: number): string | null =>
      index >= 0 ? (this.meta(index)?.name ?? null) : null;
    if (this.config.kind === "barplot") {
      const measure = name(this.config.valueColumn ?? -1);
      return {
        x: name(this.config.column),
        y: measure === null ? null : `${this.config.valueAgg ?? "mean"}(${measure})`,
      };
    }
    // Aggregate cards (bound views and own value lines) draw from the
    // aggregate; their own column picks do not describe those axes.
    if (this.usesAggregate()) return { x: null, y: null };
    switch (this.config.kind) {
      case "histogram":
        // Grouped histograms draw each group's share per bin, not raw counts.
        return {
          x: name(this.config.column),
          y: this.groupResult === null ? "Rows" : "% of group",
        };
      case "line":
      case "bar":
        return { x: name(this.config.column), y: "Rows" };
      case "scatter":
      case "density":
      case "bubble":
        return { x: name(this.config.x), y: name(this.config.y) };
      case "box":
        // Values run up the Y axis (config.x); each group slot along the
        // X axis already carries its own label, so it needs no title.
        return { x: null, y: name(this.config.x) };
      case "heatmap":
        return { x: name(this.config.x), y: name(this.config.y) };
      default:
        return { x: null, y: null };
    }
  }

  /** Axis titles: X centred under the plot, Y rotated beside its ticks. */
  private drawAxisTitles(
    ctx: CanvasRenderingContext2D,
    frame: Frame,
    xLabel: string | null,
    yLabel: string | null,
  ): void {
    const ui = frame.ui;
    const xOverride = this.config.xTitle?.trim() ?? "";
    const yOverride = this.config.yTitle?.trim() ?? "";
    const unit = this.config.yUnit?.trim() ?? "";
    const xText = xOverride !== "" ? xOverride : (xLabel ?? "");
    let yText = yOverride !== "" ? yOverride : (yLabel ?? "");
    if (unit !== "") yText = yText === "" ? `(${unit})` : `${yText} (${unit})`;

    this.font(ctx, ui, 10.5, "600");
    ctx.fillStyle = frame.dim;
    if (xText !== "") {
      ctx.textAlign = "center";
      const cx = frame.left + frame.plotW / 2;
      const cy = frame.top + frame.plotH + frame.bottom - 9 * ui;
      const fitted = this.fit(ctx, xText, frame.plotW);
      ctx.fillText(fitted, cx, cy);
      if (fitted !== xText) {
        // Truncated titles keep their full text in a hover tooltip.
        const width = ctx.measureText(fitted).width;
        this.hitRegions.push({
          x: cx - width / 2,
          y: cy - 10 * ui,
          w: width,
          h: 13 * ui,
          lines: [xText],
          actions: [],
        });
      }
    }
    if (yText !== "") {
      const tx = frame.left - 6 * ui - frame.tickW - 9 * ui;
      const cy = frame.top + frame.plotH / 2;
      ctx.save();
      ctx.translate(tx, cy);
      ctx.rotate(-Math.PI / 2);
      ctx.textAlign = "center";
      const fitted = this.fit(ctx, yText, frame.plotH);
      ctx.fillText(fitted, 0, 0);
      ctx.restore();
      if (fitted !== yText) {
        const width = ctx.measureText(fitted).width;
        this.hitRegions.push({
          x: tx - 7 * ui,
          y: cy - width / 2,
          w: 14 * ui,
          h: width,
          lines: [yText],
          actions: [],
        });
      }
    }
    ctx.textAlign = "left";
  }

  private drawBars(ctx: CanvasRenderingContext2D, frame: Frame): void {
    if (this.animationResult?.bar !== undefined) {
      this.drawAnimatedBars(ctx, frame);
      return;
    }
    const meta = this.meta(this.config.column);
    if (meta === undefined) {
      const message = this.emptySeriesMessage("bar");
      this.noteEl.textContent = message;
      this.drawPlotMessage(ctx, frame, message);
      return;
    }
    const all = this.allCategoryBars();
    if (all.length === 0) {
      const message = "This column has no category data yet.";
      this.noteEl.textContent = message;
      this.drawPlotMessage(ctx, frame, message);
      return;
    }
    const windowState = this.barWindow ?? {
      start: 0,
      count: Math.max(1, this.config.topN),
    };
    const windowEnd = Math.min(
      all.length,
      windowState.start + Math.max(1, windowState.count),
    );
    const bars: CategoryBar[] = all.slice(windowState.start, windowEnd).map((bar) => ({ ...bar }));
    const totalAll = all.reduce((sum, bar) => sum + bar.count, 0);
    if (this.barWindow === null && this.config.groupOther && windowEnd < all.length) {
      const count = all.slice(windowEnd).reduce((sum, bar) => sum + bar.count, 0);
      bars.push({
        label: "Other",
        count,
        pct: totalAll > 0 ? (count / totalAll) * 100 : 0,
        other: true,
      });
    }
    const ui = frame.ui;
    const maxCount = Math.max(1, ...bars.map((bar) => bar.count));
    const slotW = frame.plotW / bars.length;
    const barW = Math.max(4, slotW - Math.min(18 * ui, slotW * 0.25));
    const labels = meta.categories?.labels ?? [];
    const codes = bars.map((bar) =>
      bar.other === true ? -1 : labels.indexOf(bar.label),
    );
    this.hitRegions = barHitRegions(
      { left: frame.left, top: frame.top, plotW: frame.plotW, plotH: frame.plotH },
      bars,
      codes,
      this.config.column,
    );

    const yTicks = niceTicks(0, maxCount, 4).filter((value, index, all) => index === 0 || formatCount(value) !== formatCount(all[index - 1]));
    ctx.strokeStyle = frame.border;
    ctx.lineWidth = 1;
    ctx.fillStyle = frame.dim;
    this.font(ctx, ui, 10);
    ctx.textAlign = "right";
    for (const value of yTicks) {
      const y = frame.top + frame.plotH - (value / maxCount) * frame.plotH;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(frame.left, y + 0.5);
      ctx.lineTo(frame.left + frame.plotW, y + 0.5);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillText(formatCount(value), frame.left - 6 * ui, y + 3 * ui);
    }
    ctx.textAlign = "left";
    ctx.beginPath();
    ctx.moveTo(frame.left, frame.top + frame.plotH + 0.5);
    ctx.lineTo(frame.left + frame.plotW, frame.top + frame.plotH + 0.5);
    ctx.stroke();

    this.font(ctx, ui, 10);
    bars.forEach((bar, index) => {
      const x = frame.left + index * slotW + (slotW - barW) / 2;
      const h = (bar.count / maxCount) * frame.plotH;
      ctx.fillStyle =
        bar.other === true
          ? frame.dim
          : this.config.multiColor
            ? this.paletteColor(index)
            : this.primaryColor();
      ctx.globalAlpha = bar.other === true ? 0.5 : 0.9;
      this.fillTopRounded(ctx, x, frame.top + frame.plotH - h, barW, h, 4 * ui);
      ctx.globalAlpha = 1;

      ctx.textAlign = "center";
      ctx.fillStyle = frame.text;
      const countLabel = bar.count.toLocaleString();
      const pctLabel = `${bar.pct.toFixed(1)}%`;
      const cx = x + barW / 2;
      const topY = Math.max(frame.top + 8 * ui, frame.top + frame.plotH - h - 14 * ui);
      ctx.fillText(countLabel, cx, topY);
      ctx.fillStyle = frame.dim;
      ctx.fillText(pctLabel, cx, topY + 11 * ui);

      const maxLabelW = Math.max(10, slotW - 6 * ui);
      const fullLabel = bar.label === "" ? "(blank)" : bar.label;
      let label = fullLabel;
      while (label.length > 2 && ctx.measureText(label).width > maxLabelW) {
        label = label.slice(0, -2);
      }
      if (label !== fullLabel) label = `${label}…`;
      ctx.fillStyle = frame.dim;
      ctx.fillText(label, cx, frame.top + frame.plotH + 16 * ui);
      if (bar.other === true) {
        ctx.fillText("rest", cx, frame.top + frame.plotH + 28 * ui);
      }
    });
    ctx.textAlign = "left";

    const shown = bars.reduce((sum, bar) => sum + bar.count, 0);
    const windowNote =
      this.barWindow === null
        ? ""
        : ` · showing ${windowState.start + 1}–${windowEnd} of ${all.length}`;
    this.noteEl.textContent = `${bars.length} bars covering ${shown.toLocaleString()} values — top ${Math.min(
      this.config.topN,
      bars.length,
    )}${this.config.groupOther && bars.some((bar) => bar.other === true) ? " + Other" : ""}${windowNote} · scroll to zoom · drag to pan · double-click resets`;
  }

  private drawScatterLike(ctx: CanvasRenderingContext2D, frame: Frame): void {
    if (this.config.kind === "density" && this.animationResult?.bubble !== undefined) {
      this.drawAnimatedDensity(ctx, frame);
      return;
    }
    const result = this.seriesResult;
    const xMeta = this.meta(this.config.x);
    const yMeta = this.meta(this.config.y);
    if (result === null || xMeta === undefined || yMeta === undefined) {
      const message =
        this.columns.length === 0
          ? "Load data to see charts."
          : "Scatter and density need two numeric or date columns — pick X and Y above.";
      this.noteEl.textContent = message;
      this.drawPlotMessage(ctx, frame, message);
      return;
    }
    if (result.mode === "density")
      this.drawDensity(ctx, frame, result, xMeta, yMeta, this.plotView);
    else
      this.drawPoints(
        ctx,
        frame,
        this.plotView === null ? result : { ...result, ...this.plotView },
        xMeta,
        yMeta,
      );
  }

  private drawAxes(
    ctx: CanvasRenderingContext2D,
    frame: Frame,
    xMin: number,
    xMax: number,
    yMin: number,
    yMax: number,
    xKind: "histogram" | AxisFormat,
    yKind: "histogram" | AxisFormat,
  ): void {
    const ui = frame.ui;
    // Tick density follows the actual plot width so narrow cards stay legible.
    const xTarget = Math.max(2, Math.min(6, Math.floor(frame.plotW / (90 * ui))));
    const xTicks = niceTicks(xMin, xMax, xTarget);
    const yTicks = niceTicks(yMin, yMax, 4).filter((value, index, all) => index === 0 || formatChartNumber(value) !== formatChartNumber(all[index - 1]));
    const xSpan = xMax - xMin;
    const ySpan = yMax - yMin;
    ctx.strokeStyle = frame.border;
    ctx.lineWidth = 1;
    ctx.fillStyle = frame.dim;
    this.font(ctx, ui, 10);
    ctx.textAlign = "right";
    for (const value of yTicks) {
      const y = frame.top + frame.plotH - ((value - yMin) / (yMax - yMin)) * frame.plotH;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(frame.left, y + 0.5);
      ctx.lineTo(frame.left + frame.plotW, y + 0.5);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillText(formatTick(value, yKind, ySpan), frame.left - 6 * ui, y + 3 * ui);
    }
    ctx.textAlign = "center";
    for (const value of xTicks) {
      const x = frame.left + ((value - xMin) / (xMax - xMin)) * frame.plotW;
      ctx.fillText(formatTick(value, xKind, xSpan), x, frame.top + frame.plotH + 16 * ui);
    }
    ctx.textAlign = "left";
    ctx.beginPath();
    ctx.moveTo(frame.left, frame.top + frame.plotH + 0.5);
    ctx.lineTo(frame.left + frame.plotW, frame.top + frame.plotH + 0.5);
    ctx.stroke();

    // Zero reference lines when either domain crosses zero.
    ctx.save();
    ctx.strokeStyle = frame.dim;
    ctx.globalAlpha = 0.55;
    ctx.setLineDash([2, 3]);
    if (yMin < 0 && yMax > 0) {
      const zeroY = frame.top + frame.plotH - ((0 - yMin) / (yMax - yMin)) * frame.plotH;
      ctx.beginPath();
      ctx.moveTo(frame.left, zeroY + 0.5);
      ctx.lineTo(frame.left + frame.plotW, zeroY + 0.5);
      ctx.stroke();
    }
    if (xMin < 0 && xMax > 0) {
      const zeroX = frame.left + ((0 - xMin) / (xMax - xMin)) * frame.plotW;
      ctx.beginPath();
      ctx.moveTo(zeroX + 0.5, frame.top);
      ctx.lineTo(zeroX + 0.5, frame.top + frame.plotH);
      ctx.stroke();
    }
    ctx.restore();
  }

  private pointSizes(result: SeriesPoints, ui: number): Float64Array | null {
    if (result.size === null || this.config.sizeColumn < 0) return null;
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < result.shown; i++) {
      const value = result.size[i];
      if (!Number.isFinite(value)) continue;
      if (value < min) min = value;
      if (value > max) max = value;
    }
    if (min === Infinity) return null;
    const sizes = new Float64Array(result.shown);
    for (let i = 0; i < result.shown; i++) {
      const value = result.size[i];
      const t = Number.isFinite(value) ? (max > min ? (value - min) / (max - min) : 0.5) : 0;
      sizes[i] = (1.6 + 3.4 * Math.sqrt(t)) * ui;
    }
    return sizes;
  }

  private colorBuckets(result: SeriesPoints): { buckets: Uint8Array; colors: string[] } | null {
    const n = result.shown;
    if (result.colorCodes !== null) {
      const colors = this.paletteColors(12);
      const buckets = new Uint8Array(n);
      for (let i = 0; i < n; i++) buckets[i] = result.colorCodes[i] % colors.length;
      return { buckets, colors };
    }
    if (result.colorValues !== null && this.config.colorColumn >= 0) {
      let min = Infinity;
      let max = -Infinity;
      for (let i = 0; i < n; i++) {
        const value = result.colorValues[i];
        if (!Number.isFinite(value)) continue;
        if (value < min) min = value;
        if (value > max) max = value;
      }
      if (min === Infinity) return null;
      const scaleMin =
        this.config.colorMin === null || this.config.colorMin === undefined
          ? min
          : this.config.colorMin;
      const scaleMax =
        this.config.colorMax === null || this.config.colorMax === undefined
          ? max
          : this.config.colorMax;
      const buckets = new Uint8Array(n).fill(16);
      const paletteName = this.config.palette ?? DEFAULT_PALETTE;
      const ramp = isRampPalette(paletteName) ? this.rampStopsFor(paletteName) : null;
      const colors =
        ramp === null
          ? Array.from({ length: 16 }, (_, index) => rampColor(index / 15))
          : Array.from({ length: 16 }, (_, index) => rampAt(ramp, index / 15));
      colors.push(this.primaryColor());
      for (let i = 0; i < n; i++) {
        const value = result.colorValues[i];
        if (!Number.isFinite(value)) continue;
        const t =
          scaleMax > scaleMin
            ? Math.min(1, Math.max(0, (value - scaleMin) / (scaleMax - scaleMin)))
            : 0.5;
        buckets[i] = Math.round(t * 15);
      }
      return { buckets, colors };
    }
    return null;
  }

  private colorNote(result: SeriesPoints): string | null {
    const meta = this.meta(this.config.colorColumn);
    if (meta === undefined || this.config.colorColumn < 0) return null;
    if (result.colorCodes !== null) {
      const count = this.seriesLabels?.length ?? 0;
      return `colour: ${meta.name} (${count.toLocaleString()} values)`;
    }
    if (result.colorValues !== null) {
      let min = Infinity;
      let max = -Infinity;
      for (let i = 0; i < result.shown; i++) {
        const value = result.colorValues[i];
        if (!Number.isFinite(value)) continue;
        if (value < min) min = value;
        if (value > max) max = value;
      }
      if (min !== Infinity) {
        const scaleMin =
          this.config.colorMin === null || this.config.colorMin === undefined
            ? min
            : this.config.colorMin;
        const scaleMax =
          this.config.colorMax === null || this.config.colorMax === undefined
            ? max
            : this.config.colorMax;
        const fixed =
          this.config.colorMin !== null && this.config.colorMin !== undefined ||
          this.config.colorMax !== null && this.config.colorMax !== undefined
            ? " fixed"
            : "";
        return `colour: ${meta.name} (${formatTick(scaleMin, null)} - ${formatTick(
          scaleMax,
          null,
        )}${fixed})`;
      }
    }
    return null;
  }

  private drawPoints(
    ctx: CanvasRenderingContext2D,
    frame: Frame,
    result: SeriesPoints,
    xMeta: ColumnMeta,
    yMeta: ColumnMeta,
  ): void {
    if (result.shown === 0) {
      const message = "No matching X/Y value pairs in the current rows.";
      this.noteEl.textContent = message;
      this.drawPlotMessage(ctx, frame, message);
      return;
    }
    this.drawAxes(
      ctx,
      frame,
      result.xMin,
      result.xMax,
      result.yMin,
      result.yMax,
      axisKindFor(xMeta.type) ?? "histogram",
      axisKindFor(yMeta.type) ?? "histogram",
    );

    const xScale = frame.plotW / (result.xMax - result.xMin);
    const yScale = frame.plotH / (result.yMax - result.yMin);
    const sizes = this.pointSizes(result, frame.ui);
    const buckets = this.colorBuckets(result);
    const radius = 2.2 * frame.ui;
    const circular = result.shown <= 5000;

    const drawAt = (index: number): void => {
      const r = sizes === null ? radius : sizes[index];
      const x = frame.left + (result.x[index] - result.xMin) * xScale;
      const y = frame.top + frame.plotH - (result.y[index] - result.yMin) * yScale;
      if (circular) {
        ctx.beginPath();
        ctx.arc(x, y, Math.max(0.5, r), 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillRect(x - r, y - r, r * 2, r * 2);
      }
    };

    // Zoom/pan can move points past the plot: clip the marks, not the axes.
    ctx.save();
    ctx.beginPath();
    ctx.rect(frame.left, frame.top, frame.plotW, frame.plotH);
    ctx.clip();
    ctx.globalAlpha = 0.55;
    if (buckets === null) {
      ctx.fillStyle = this.primaryColor();
      for (let i = 0; i < result.shown; i++) drawAt(i);
    } else {
      for (let bucket = 0; bucket < buckets.colors.length; bucket++) {
        ctx.fillStyle = buckets.colors[bucket];
        for (let i = 0; i < result.shown; i++) {
          if (buckets.buckets[i] === bucket) drawAt(i);
        }
      }
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    this.drawCorrelationNote(ctx, frame);

    const notes: string[] = [`${result.shown.toLocaleString()} points`];
    if (result.sampled) notes.push(`sampled from ${result.total.toLocaleString()}`);
    if (result.outside > 0) notes.push(`${result.outside.toLocaleString()} outside p1–p99`);
    const colorText = this.colorNote(result);
    if (colorText !== null) notes.push(colorText);
    const sizeMeta = this.meta(this.config.sizeColumn);
    if (sizes !== null && sizeMeta !== undefined) notes.push(`size: ${sizeMeta.name}`);
    notes.push("scroll to zoom · drag to pan · double-click resets");
    if (this.seriesMs > 0) notes.push(`${Math.round(this.seriesMs)} ms`);
    this.noteEl.textContent = notes.join(" · ");
  }

  private drawDensity(
    ctx: CanvasRenderingContext2D,
    frame: Frame,
    result: SeriesGrid,
    xMeta: ColumnMeta,
    yMeta: ColumnMeta,
    viewport: { xMin: number; xMax: number; yMin: number; yMax: number } | null = null,
  ): void {
    if (viewport !== null) result = cropDensityGrid(result, viewport);
    if (result.max === 0) {
      const message = "No matching X/Y value pairs in the current rows.";
      this.noteEl.textContent = message;
      this.drawPlotMessage(ctx, frame, message);
      return;
    }
    const style = this.config.densityStyle;
    let smooth: Float64Array | null = null;
    let smoothMax = 0;
    if (style !== "heat") {
      smooth = smoothGrid(result.counts, result.cols, result.rows, 1.6);
      for (const value of smooth) if (value > smoothMax) smoothMax = value;
    }

    if (style !== "contours") {
      ctx.save();
      ctx.beginPath();
      ctx.rect(frame.left, frame.top, frame.plotW, frame.plotH);
      ctx.clip();
      this.paintDensityHeat(ctx, frame, result, style === "both" ? 0.45 : 1);
      ctx.restore();
    }
    if (smooth !== null && smoothMax > 0) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(frame.left, frame.top, frame.plotW, frame.plotH);
      ctx.clip();
      if (style === "contours") this.paintDensityBands(ctx, frame, result, smooth, smoothMax);
      this.paintContourLines(ctx, frame, result, smooth, smoothMax);
      ctx.restore();
    }

    this.drawAxes(
      ctx,
      frame,
      result.xMin,
      result.xMax,
      result.yMin,
      result.yMax,
      axisKindFor(xMeta.type) ?? "histogram",
      axisKindFor(yMeta.type) ?? "histogram",
    );
    this.drawCorrelationNote(ctx, frame);

    const notes = [
      `${result.total.toLocaleString()} rows`,
      `${result.cols}×${result.rows} density grid`,
      `peak ${result.max.toLocaleString()}`,
    ];
    notes.push(
      style === "heat" ? "heat" : style === "contours" ? "5 contour levels" : "heat + contour lines",
    );
    if (result.outside > 0) notes.push(`${result.outside.toLocaleString()} outside p1–p99`);
    notes.push("scroll to zoom · drag to pan · double-click resets");
    if (this.seriesMs > 0) notes.push(`${Math.round(this.seriesMs)} ms`);
    this.noteEl.textContent = notes.join(" · ");
  }

  private paintDensityHeat(
    ctx: CanvasRenderingContext2D,
    frame: Frame,
    result: SeriesGrid,
    alphaScale: number,
  ): void {
    const [r, g, b] = hexToRgb(this.primaryColor());
    const off = document.createElement("canvas");
    off.width = result.cols;
    off.height = result.rows;
    const offCtx = off.getContext("2d");
    if (offCtx === null) return;
    const image = offCtx.createImageData(result.cols, result.rows);
    for (let cy = 0; cy < result.rows; cy++) {
      for (let cx = 0; cx < result.cols; cx++) {
        const count = result.counts[cy * result.cols + cx];
        if (count === 0) continue;
        const offset = ((result.rows - 1 - cy) * result.cols + cx) * 4;
        const t = count / result.max;
        image.data[offset] = r;
        image.data[offset + 1] = g;
        image.data[offset + 2] = b;
        image.data[offset + 3] = Math.round((0.12 + 0.88 * Math.sqrt(t)) * 255 * alphaScale);
      }
    }
    offCtx.putImageData(image, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(off, frame.left, frame.top, frame.plotW, frame.plotH);
  }

  private paintDensityBands(
    ctx: CanvasRenderingContext2D,
    frame: Frame,
    result: SeriesGrid,
    smooth: Float64Array,
    smoothMax: number,
  ): void {
    const levels = contourLevels(smoothMax, 5);
    const colors = levels.map((_, index) => hexToRgb(rampColor((index + 1) / levels.length)));
    const off = document.createElement("canvas");
    off.width = result.cols;
    off.height = result.rows;
    const offCtx = off.getContext("2d");
    if (offCtx === null) return;
    const image = offCtx.createImageData(result.cols, result.rows);
    for (let cy = 0; cy < result.rows; cy++) {
      for (let cx = 0; cx < result.cols; cx++) {
        const value = smooth[cy * result.cols + cx];
        let band = 0;
        while (band < levels.length && value >= levels[band]) band++;
        if (band === 0) continue;
        const [r, g, b] = colors[band - 1];
        const offset = ((result.rows - 1 - cy) * result.cols + cx) * 4;
        image.data[offset] = r;
        image.data[offset + 1] = g;
        image.data[offset + 2] = b;
        image.data[offset + 3] = 205;
      }
    }
    offCtx.putImageData(image, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(off, frame.left, frame.top, frame.plotW, frame.plotH);
  }

  private paintContourLines(
    ctx: CanvasRenderingContext2D,
    frame: Frame,
    result: SeriesGrid,
    smooth: Float64Array,
    smoothMax: number,
  ): void {
    const levels = contourLevels(smoothMax, 5);
    levels.forEach((level, index) => {
      const segments = marchingSquares(smooth, result.cols, result.rows, level);
      if (segments.length === 0) return;
      ctx.strokeStyle = rampColor((index + 1) / levels.length);
      ctx.globalAlpha = 0.85;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (let i = 0; i < segments.length; i += 4) {
        const x1 = frame.left + (segments[i] / result.cols) * frame.plotW;
        const y1 = frame.top + (1 - segments[i + 1] / result.rows) * frame.plotH;
        const x2 = frame.left + (segments[i + 2] / result.cols) * frame.plotW;
        const y2 = frame.top + (1 - segments[i + 3] / result.rows) * frame.plotH;
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
      }
      ctx.stroke();
    });
    ctx.globalAlpha = 1;
  }

  private drawCorrelationNote(ctx: CanvasRenderingContext2D, frame: Frame): void {
    if (!Number.isFinite(this.seriesCorrelation)) return;
    this.font(ctx, frame.ui, 11, "600");
    ctx.fillStyle = frame.dim;
    ctx.textAlign = "right";
    ctx.fillText(
      `r = ${this.seriesCorrelation.toFixed(2)}`,
      frame.left + frame.plotW - 6 * frame.ui,
      frame.top - 8 * frame.ui,
    );
    ctx.textAlign = "left";
  }

  private drawBox(ctx: CanvasRenderingContext2D, frame: Frame): void {
    const result = this.boxResult;
    if (result === null || result.groups.length === 0) {
      const message =
        this.columns.length === 0
          ? "Load data to see charts."
          : "Box plots need a numeric Value column and a category Groups column — pick them above.";
      this.noteEl.textContent = message;
      this.drawPlotMessage(ctx, frame, message);
      return;
    }
    const ui = frame.ui;
    const state = this.boxWindow ?? { start: 0, count: result.groups.length };
    const start = Math.max(
      0,
      Math.min(result.groups.length - 1, state.start),
    );
    const groups = result.groups.slice(
      start,
      start + Math.max(1, Math.min(state.count, result.groups.length - start)),
    );
    // Categories whose value column is entirely missing do not appear in the
    // stats; give each one a slot so it is visible as "no values" instead of
    // silently vanishing from the chart.
    const groupMeta = this.meta(this.config.y);
    const present = new Set(groups.map((group) => group.label));
    const emptyLabels = (groupMeta?.categories?.labels ?? [])
      .filter((label) => label !== "Other" && !present.has(label))
      .slice(0, 3);
    const slotCount = groups.length + emptyLabels.length;
    this.hitRegions = boxHitRegions(
      { left: frame.left, top: frame.top, plotW: frame.plotW, plotH: frame.plotH },
      groups,
      slotCount,
    );
    let yMin = Infinity;
    let yMax = -Infinity;
    for (const group of groups) {
      if (group.min < yMin) yMin = group.min;
      if (group.max > yMax) yMax = group.max;
    }
    if (!(yMax > yMin)) {
      yMin -= 1;
      yMax += 1;
    }
    if (this.boxY !== null) {
      yMin = this.boxY.min;
      yMax = this.boxY.max;
    }
    const yOf = (value: number): number =>
      frame.top + frame.plotH - ((value - yMin) / (yMax - yMin)) * frame.plotH;

    // Compact "2k" ticks make no sense for a narrow integer range (birth
    // years): keep plain integers there and compact only wide ranges.
    const valueMeta = this.meta(this.config.x);
    const ticks = niceTicks(yMin, yMax, 5);
    const plainIntegerTicks =
      valueMeta?.type === "integer" && yMax - yMin <= 100_000;
    const tickLabel = (value: number): string =>
      plainIntegerTicks ? formatCount(value) : formatTick(value, "histogram");
    ctx.strokeStyle = frame.border;
    ctx.lineWidth = 1;
    ctx.fillStyle = frame.dim;
    this.font(ctx, ui, 10);
    ctx.textAlign = "right";
    for (const value of ticks) {
      const y = yOf(value);
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(frame.left, y + 0.5);
      ctx.lineTo(frame.left + frame.plotW, y + 0.5);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillText(tickLabel(value), frame.left - 6 * ui, y + 3 * ui);
    }
    ctx.textAlign = "left";
    ctx.beginPath();
    ctx.moveTo(frame.left, frame.top + frame.plotH + 0.5);
    ctx.lineTo(frame.left + frame.plotW, frame.top + frame.plotH + 0.5);
    ctx.stroke();

    const slot = frame.plotW / Math.max(1, slotCount);
    const boxW = Math.min(slot * 0.55, 54 * ui);
    const cap = Math.max(3 * ui, boxW * 0.25);
    groups.forEach((group, index) => {
      const cx = frame.left + (index + 0.5) * slot;
      const yQ1 = yOf(group.q1);
      const yQ3 = yOf(group.q3);
      const top = Math.min(yQ1, yQ3);
      const height = Math.max(1.5, Math.abs(yQ1 - yQ3));

      ctx.globalAlpha = group.other ? 0.2 : 0.32;
      ctx.fillStyle = this.primaryColor();
      ctx.fillRect(cx - boxW / 2, top, boxW, height);
      ctx.globalAlpha = group.other ? 0.5 : 0.9;
      ctx.strokeStyle = this.primaryColor();
      ctx.lineWidth = 1.5;
      ctx.strokeRect(cx - boxW / 2, top, boxW, height);

      const yMedian = yOf(group.median);
      ctx.beginPath();
      ctx.moveTo(cx - boxW / 2, yMedian);
      ctx.lineTo(cx + boxW / 2, yMedian);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(cx, top);
      ctx.lineTo(cx, yOf(group.whiskerHigh));
      ctx.moveTo(cx, top + height);
      ctx.lineTo(cx, yOf(group.whiskerLow));
      ctx.stroke();
      for (const value of [group.whiskerHigh, group.whiskerLow]) {
        const y = yOf(value);
        ctx.beginPath();
        ctx.moveTo(cx - cap, y);
        ctx.lineTo(cx + cap, y);
        ctx.stroke();
      }

      ctx.globalAlpha = 0.65;
      ctx.fillStyle = this.primaryColor();
      const r = 1.6 * ui;
      for (const value of group.outliers) {
        const y = yOf(value);
        ctx.fillRect(cx - r, y - r, r * 2, r * 2);
      }
      ctx.globalAlpha = 1;

      ctx.textAlign = "center";
      ctx.fillStyle = frame.text;
      this.font(ctx, ui, 9.5, "600");
      const medianLabel = formatChartNumber(group.median);
      const medianY = Math.max(frame.top + 9 * ui, top - 4 * ui);
      ctx.fillText(this.fit(ctx, medianLabel, Math.max(10, slot - 4 * ui)), cx, medianY);

      ctx.fillStyle = frame.dim;
      this.font(ctx, ui, 10);
      const maxWidth = Math.max(10, slot - 6 * ui);
      const label = group.label === "" ? "(blank)" : group.label;
      ctx.fillText(this.fit(ctx, label, maxWidth), cx, frame.top + frame.plotH + 16 * ui);
      this.font(ctx, ui, 9);
      ctx.fillText(formatCount(group.count), cx, frame.top + frame.plotH + 27 * ui);
      if (group.other) ctx.fillText("rest", cx, frame.top + frame.plotH + 38 * ui);
    });

    if (emptyLabels.length > 0) {
      const midY = frame.top + frame.plotH / 2;
      emptyLabels.forEach((label, index) => {
        const cx = frame.left + (groups.length + index + 0.5) * slot;
        ctx.strokeStyle = frame.dim;
        ctx.globalAlpha = 0.6;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(cx - cap, midY);
        ctx.lineTo(cx + cap, midY);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
        ctx.textAlign = "center";
        ctx.fillStyle = frame.dim;
        this.font(ctx, ui, 9);
        ctx.fillText(
          this.fit(ctx, "no values", Math.max(10, slot - 4 * ui)),
          cx,
          midY - 8 * ui,
        );
        this.font(ctx, ui, 10);
        ctx.fillText(
          this.fit(ctx, label === "" ? "(blank)" : label, Math.max(10, slot - 6 * ui)),
          cx,
          frame.top + frame.plotH + 16 * ui,
        );
      });
    }
    ctx.textAlign = "left";

    let outliers = 0;
    for (const group of groups) outliers += group.outliers.length;
    const notes = [
      `${groups.length} ${groups.length === 1 ? "group" : "groups"}`,
      `${result.total.toLocaleString()} values`,
      `${outliers.toLocaleString()} outliers`,
    ];
    if (emptyLabels.length > 0) {
      notes.push(
        `${emptyLabels.length} ${emptyLabels.length === 1 ? "group has" : "groups have"} no values`,
      );
    }
    if (result.missing > 0) notes.push(`${result.missing.toLocaleString()} missing values`);
    if (this.statsMs > 0) notes.push(`${Math.round(this.statsMs)} ms`);
    this.noteEl.textContent = notes.join(" · ");
  }

  private drawHeatmap(ctx: CanvasRenderingContext2D, frame: Frame): void {
    const result = this.crossResult;
    if (result === null || result.xLabels.length === 0 || result.yLabels.length === 0) {
      const message =
        this.columns.length === 0
          ? "Load data to see charts."
          : "Heatmaps need two category columns — pick them above.";
      this.noteEl.textContent = message;
      this.drawPlotMessage(ctx, frame, message);
      return;
    }
    const ui = frame.ui;
    const xMeta = this.meta(this.config.x);
    const yMeta = this.meta(this.config.y);
    const totalX = result.xLabels.length;
    const totalY = result.yLabels.length;
    const state = this.heatWindow ?? {
      xStart: 0,
      xCount: totalX,
      yStart: 0,
      yCount: totalY,
    };
    const xStart = Math.max(0, Math.min(totalX - 1, state.xStart));
    const yStart = Math.max(0, Math.min(totalY - 1, state.yStart));
    const xCount = Math.max(1, Math.min(state.xCount, totalX - xStart));
    const yCount = Math.max(1, Math.min(state.yCount, totalY - yStart));
    const xLabels = result.xLabels.slice(xStart, xStart + xCount);
    const yLabels = result.yLabels.slice(yStart, yStart + yCount);
    const counts = new Uint32Array(xCount * yCount);
    for (let y = 0; y < yCount; y++) {
      for (let x = 0; x < xCount; x++) {
        counts[y * xCount + x] =
          result.counts[(yStart + y) * totalX + (xStart + x)] ?? 0;
      }
    }
    const codeOf = (meta: ColumnMeta | undefined, label: string): number =>
      meta?.categories?.labels.indexOf(label) ?? -1;
    this.hitRegions = heatmapHitRegions(
      { left: frame.left, top: frame.top, plotW: frame.plotW, plotH: frame.plotH },
      {
        xLabels,
        yLabels,
        counts,
        total: result.total,
        xColumn: this.config.x,
        yColumn: this.config.y,
        codeOfX: (label) => codeOf(xMeta, label),
        codeOfY: (label) => codeOf(yMeta, label),
      },
    );
    const cellW = frame.plotW / xCount;
    const cellH = frame.plotH / yCount;
    let max = 0;
    for (const count of counts) if (count > max) max = count;
    const [r, g, b] = hexToRgb(this.primaryColor());
    const showText = cellW >= 26 * ui && cellH >= 15 * ui;

    this.font(ctx, ui, 10);
    for (let y = 0; y < yCount; y++) {
      for (let x = 0; x < xCount; x++) {
        const count = counts[y * xCount + x] ?? 0;
        const t = max > 0 ? count / max : 0;
        const alpha = count === 0 ? 0.06 : 0.1 + 0.8 * Math.sqrt(t);
        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(3)})`;
        ctx.fillRect(
          frame.left + x * cellW + 0.5,
          frame.top + y * cellH + 0.5,
          Math.max(1, cellW - 1),
          Math.max(1, cellH - 1),
        );
        if (showText && count > 0) {
          ctx.fillStyle = t > 0.6 ? "#ffffff" : frame.text;
          ctx.textAlign = "center";
          ctx.fillText(
            count.toLocaleString(),
            frame.left + (x + 0.5) * cellW,
            frame.top + (y + 0.5) * cellH + 3.5 * ui,
          );
        }
      }
    }
    ctx.textAlign = "center";
    xLabels.forEach((label, x) => {
      ctx.fillText(
        this.fit(ctx, label, Math.max(8, cellW - 4 * ui)),
        frame.left + (x + 0.5) * cellW,
        frame.top + frame.plotH + 16 * ui,
      );
    });
    ctx.textAlign = "right";
    yLabels.forEach((label, y) => {
      ctx.fillText(
        this.fit(ctx, label, Math.max(8, frame.left - frame.labelPad - 8 * ui)),
        frame.left - frame.labelPad - 4 * ui,
        frame.top + (y + 0.5) * cellH + 3.5 * ui,
      );
    });
    ctx.textAlign = "left";

    const notes = [
      `${xCount}×${yCount} cells`,
      `${result.total.toLocaleString()} rows`,
      `peak ${max.toLocaleString()}`,
    ];
    if (xLabels.includes("Other") || yLabels.includes("Other")) {
      notes.push("rest grouped as Other");
    }
    if (this.statsMs > 0) notes.push(`${Math.round(this.statsMs)} ms`);
    this.noteEl.textContent = notes.join(" · ");
  }

  private drawCorrelation(ctx: CanvasRenderingContext2D, frame: Frame): void {
    const result = this.correlationResult;
    if (result === null || result.labels.length < 2) {
      let message: string;
      if (this.columns.length === 0) {
        message = "Load data to see charts.";
      } else {
        const numeric = this.columns.filter((meta) => isNumericType(meta.type)).length;
        message = `Correlation needs at least two numeric columns; this file has ${numeric}.`;
      }
      this.noteEl.textContent = message;
      this.drawPlotMessage(ctx, frame, message);
      return;
    }
    const ui = frame.ui;
    const total = result.labels.length;
    const state = this.corrWindow ?? { start: 0, count: total };
    const start = Math.max(0, Math.min(total - 2, state.start));
    const n = Math.max(2, Math.min(state.count, total - start));
    const labels = result.labels.slice(start, start + n);
    const values = new Float64Array(n * n);
    const counts = new Uint32Array(n * n);
    for (let row = 0; row < n; row++) {
      for (let column = 0; column < n; column++) {
        const source = (start + row) * total + (start + column);
        values[row * n + column] = result.values[source] ?? Number.NaN;
        counts[row * n + column] = result.counts[source] ?? 0;
      }
    }
    this.hitRegions = correlationHitRegions(
      { left: frame.left, top: frame.top, plotW: frame.plotW, plotH: frame.plotH },
      { labels, values, counts },
    );
    const sizeX = frame.plotW / n;
    const sizeY = frame.plotH / n;
    const gridW = frame.plotW;
    const gridH = frame.plotH;
    const left = frame.left;
    const top = frame.top;
    const zeroColor = cssVar("--border-subtle", "#eaeef2");
    const showText = Math.min(sizeX, sizeY) >= 30 * ui;
    let minCount = Infinity;

    this.font(ctx, ui, showText ? 10 : 9);
    for (let row = 0; row < n; row++) {
      for (let column = 0; column < n; column++) {
        const index = row * n + column;
        const r = values[index];
        const cell = correlationCell(r, zeroColor);
        ctx.fillStyle = cell.bg;
        ctx.fillRect(left + column * sizeX, top + row * sizeY, sizeX, sizeY);
        if (showText) {
          ctx.fillStyle = cell.fg;
          ctx.textAlign = "center";
          const text = Number.isFinite(r) ? r.toFixed(2) : "—";
          ctx.fillText(text, left + (column + 0.5) * sizeX, top + (row + 0.5) * sizeY + 3.5 * ui);
        }
        if (index !== row * n + row) {
          const count = counts[index];
          if (count > 0 && count < minCount) minCount = count;
        }
      }
    }
    const labelWidth = Math.max(24, sizeX - 2 * ui);
    const abbreviate = (label: string): string => {
      if (ctx.measureText(label).width <= labelWidth) return label;
      const words = label.split(/[\s_]+/).filter((word) => word !== "");
      if (words.length >= 2) {
        const candidate = `${words[0]} ${words[words.length - 1]}`;
        if (ctx.measureText(candidate).width <= labelWidth) return candidate;
      }
      return this.fit(ctx, label, labelWidth);
    };
    ctx.textAlign = "center";
    labels.forEach((label, column) => {
      ctx.fillStyle = frame.dim;
      ctx.fillText(abbreviate(label), left + (column + 0.5) * sizeX, top + gridH + 14 * ui);
    });
    ctx.textAlign = "right";
    labels.forEach((label, row) => {
      ctx.fillStyle = frame.dim;
      ctx.fillText(
        this.fit(ctx, label, Math.max(8, left - frame.left - 6 * ui)),
        left - 4 * ui,
        top + (row + 0.5) * sizeY + 3.5 * ui,
      );
    });
    ctx.textAlign = "left";
    ctx.strokeStyle = frame.border;
    ctx.lineWidth = 1;
    ctx.strokeRect(left + 0.5, top + 0.5, gridW - 1, gridH - 1);

    const notes = [`${n} columns`];
    if (Number.isFinite(minCount)) notes.push(`${minCount.toLocaleString()} min pairwise observations`);
    if (this.statsMs > 0) notes.push(`${Math.round(this.statsMs)} ms`);
    this.noteEl.textContent = notes.join(" · ");
  }
}

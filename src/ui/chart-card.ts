import { mapExtract, regionOptions, setMapMode, syncRegionAxes, refreshMapGrid, placeFrame, beginMapBrush, endMapBrush, zoomMap, exportMapHtml, mapHtmlPayload, mapViewShown, mapViewOrAuto, dataViewOrNull, resetMapZoom, fitMapAll, markerBox, frameBox, drawMap, drawMapLayers, drawMapClusters, drawMapBody, syncDotControls, mapLabelColumn, mapDotLines, drawMapSizeLegend, mapRadii } from "./chart-map-draw.js";
import { errorBarExtract, errorBarBlock, syncResearchControls, syncErrorBarControls, refreshErrorBars, cancelErrorBars, showErrorBarProgress, hideErrorBarProgress, errorBarAt, drawWhisker, appendErrorBarNote } from "./chart-error-bars.js";
import type { ChartBinOptions, ChartBins } from "../data/chart-bins.js";
import { ChartDataDrawer } from "./chart-data-drawer.js";
import { cssVar, focusIcon, missingOrTokens, movieIcon, pngIcon, readGroupOpen, writeGroupOpen, type SettingsGroup } from "./chart-card-parts.js";
import { basemapCaches, DETAIL_LON_SPAN, loadBasemap, type Basemap, type BasemapDetail } from "./chart-basemap.js";
import { type GroupedSeriesHitInput, type HeatmapHitInput, type CorrelationHitInput, type HitAction, type HitRegion, type PlotGeometry, type SeriesHitInput, actionsOverlap, barHitRegions, boxHitRegions, correlationHitRegions, groupedSeriesHitRegions, heatmapHitRegions, hitTest, seriesHitRegions, tableFiltersForHitActions } from "./chart-hit-regions.js";
export * from "./chart-hit-regions.js";
import { measuresToSeries, type PivotChartField, type PivotChartShape } from "../data/pivot-chart.js";
import type { GetSliceBreakdownRequest, SliceBreakdownMessage, SliceRegion } from "../worker/protocol.js";
import {
  addExclusion,
  describeRange,
  exclusionChips,
  removeChip,
  sanitizeExclusions,
  type ChartExclusion,
} from "../data/chart-exclusions.js";
import type { SeriesGrid, SeriesMode, SeriesPoints } from "../data/chart-series.js";
import type {
  BoxGroupStats,
  BoxStatsResult,
  CrossTabResult,
  GridCountsResult,
} from "../data/chart-stats.js";
import type { AnimationResult } from "../data/chart-frames.js";
import { encodeGif, type GifFrameInput } from "../data/gif.js";
import { defaultInterval, INTERVAL_KINDS, intervalBlock, statisticBlock, type IntervalKind } from "../data/error-bars.js";
import { errorBarKey } from "../data/error-bar-key.js";
import { binnedSummary, binRows, linearFit, num, seriesRows, summarise, type ChartExtract, type ExtractSection } from "../data/chart-extract.js";
import { symlog as symlogValue, symlogInverse } from "../data/symlog.js";
import { openChartStats } from "./chart-stats-dialog.js";
import { contourLevels, marchingSquares, smoothGrid, smoothSeries } from "../data/kde.js";
import { squarifyLayout } from "../data/treemap.js";
import { dataRange, robustRange, DOT_SCALES, dotRadii, type DotScale } from "../data/dot-size.js";
import type { ColumnSuggestion } from "../data/suggestions.js";
import {
  CUSTOM_PALETTE,
  DEFAULT_PALETTE,
  isRampPalette,
  PALETTES,
  paletteStops,
  parseCustomColors,
  parsePaletteJson,
  samplePalette,
} from "../data/palettes.js";
import type { Aggregate, MeasureSpec, TimeGrain, ViewDef } from "../data/aggregate.js";
import { MAX_FRAMES, type FrameStep } from "../data/chart-frames.js";
import type { ColumnFilter } from "../search/query-engine.js";
import { isNumericLikeType, TYPE_LABELS } from "../types.js";
import {
  chartSpecFromConfig,
  chartSpecJson,
  chartSpecToPandas,
  chartSpecToPolars,
  parseChartSpec,
  type ChartSpec,
} from "./chart-spec.js";
import { chartConfigWithDefaults } from "./chart-builder.js";
import { barKindFor, COMMON_KINDS, fitChartKind, kindIcon, MORE_GROUPS } from "./chart-gallery.js";
import { fieldsFor } from "./chart-registry.js";
import {
  drawDotPlot,
  drawSlopegraph,
  drawSmallMultiples,
  drawStacked100,
  drawWaterfall,
  type Painter,
} from "./chart-extra-draw.js";
import type { ErrorBarsMessage, ErrorBarsProgressMessage } from "../worker/protocol.js";
import { lint, type LintNote, type RecColumn } from "./chart-recommender.js";
import {
  colorForFraction,
  colorFraction,
  colorRamp,
  describeColorDomain,
  resolveColorDomain,
} from "./color-scale.js";
import type {
  AggregateMessage,
  BoxStatsMessage,
  ChartBinsMessage,
  ChartSeriesMessage,
  ColumnMeta,
  PivotMessage,
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
  DEFAULT_MAP_MODE,
  defaultChartTitle,
  sourceOption,
  formatChartNumber,
  formatCompact,
  autoShortStep,
  calendarTicks,
  describeStep,
  fillTimeAxis,
  formatCount,
  formatTick,
  darkerColor,
  hexToRgb,
  isCategoryType,
  isGroupable,
  isIdLikeColumn,
  isNumericType,
  isPairKind,
  looksLikeIdName,
  mapBrushBounds,
  niceTicks,
  zoomPlotBounds,
  parseChartNumber,
  plainMeasureName,
  rampColor,
  SPLIT_KINDS,
  GROUP_REQUIRED_KINDS,
  VALUE_AGGREGATE_KINDS,
  toRecColumn,
  safeFileName,
  suggestedBinRange,
} from "./chart-utils.js";
import { downloadCsv } from "./chart-export.js";
import { clear, el, svgIcon } from "./dom.js";
import { openConfirm, openPrompt } from "./dialog.js";
import { describeScope } from "./scope.js";
import { openMenu, type MenuItem } from "./menu.js";
import {
  projectLat,
  projectLon,
} from "../data/topo.js";
import { MapRegions, type MapRegionsOptions } from "./map-regions.js";
import { fitViewToPlot } from "../data/regions.js";
import { buildMapHtml, downloadHtml, roundRing, type MapHtmlLegend, type MapHtmlPayload } from "./map-html-export.js";

/** Rectangle brush result: lon/lat bounds for the two coordinate columns. */
export interface MapViewport {
  lonMin: number;
  lonMax: number;
  latMin: number;
  latMax: number;
}

/** Fit a lon/lat viewport to the 1st-99th percentile of the plotted points. */
export function fitMapView(
  lons: ArrayLike<number>,
  lats: ArrayLike<number>,
): MapViewport | null {
  const xs: number[] = [];
  const ys: number[] = [];
  const step = Math.max(1, Math.floor(Math.max(lons.length, lats.length) / 5000));
  for (let index = 0; index < Math.min(lons.length, lats.length); index += step) {
    const lon = lons[index];
    const lat = lats[index];
    if (Number.isFinite(lon) && Number.isFinite(lat)) {
      xs.push(lon);
      ys.push(lat);
    }
  }
  if (xs.length === 0) return null;
  xs.sort((a, b) => a - b);
  ys.sort((a, b) => a - b);
  const at = (values: number[], q: number): number =>
    values[Math.max(0, Math.min(values.length - 1, Math.round((values.length - 1) * q)))]!;
  let lonMin = at(xs, 0.01);
  let lonMax = at(xs, 0.99);
  let latMin = at(ys, 0.01);
  let latMax = at(ys, 0.99);
  if (!(lonMax > lonMin)) {
    lonMin -= 0.25;
    lonMax += 0.25;
  }
  if (!(latMax > latMin)) {
    latMin -= 0.25;
    latMax += 0.25;
  }
  // Room around the dots in proportion: a city's stations should fill the map, not its middle.
  const lonPad = Math.max(0.003, (lonMax - lonMin) * 0.08);
  const latPad = Math.max(0.003, (latMax - latMin) * 0.08);
  lonMin = Math.max(-180, lonMin - lonPad);
  lonMax = Math.min(180, lonMax + lonPad);
  latMin = Math.max(-85, latMin - latPad);
  latMax = Math.min(85, latMax + latPad);
  if (lonMax - lonMin < 0.04) {
    const center = (lonMin + lonMax) / 2;
    lonMin = Math.max(-180, center - 0.02);
    lonMax = Math.min(180, center + 0.02);
  }
  if (latMax - latMin < 0.04) {
    const center = (latMin + latMax) / 2;
    latMin = Math.max(-85, center - 0.02);
    latMax = Math.min(85, center + 0.02);
  }
  return { lonMin, lonMax, latMin, latMax };
}
/**
 * How a chart's marks map to values, recorded by the draw routines whose marks are
 * one bar/bin/period per hit region, so a slice of the data can be drawn on them.
 */
interface ValueScale {
  /** Value at the top of the plot. */
  yMax: number;
  top: number;
  plotH: number;
  mode: "bars" | "line";
  /** Bar start and width inside a region (bars only). */
  inset: number;
  barW: number;
  /** The column the marks' click actions refer to. */
  regionColumn: number;
  /** null = row counts; otherwise the aggregate of this measure. */
  measure: { column: number; agg: "count" | "sum" | "mean" | "min" | "max" } | null;
  /** Whether the chart's own scope (chart filter, exclusions) applies to its marks. */
  scoped: boolean;
}

/** Shift+drag on a chart: the ranges (data units) to filter, one per brushed axis. */
export interface BrushRange {
  column: number;
  min: number;
  max: number;
}

/** Where the plot area sits in data units, recorded by each draw routine for the brush. */
interface BrushSpace {
  left: number;
  top: number;
  plotW: number;
  plotH: number;
  xColumn: number;
  xMin: number;
  xMax: number;
  /** Share of the plot width the x domain spans (less than 1 when an overflow bar follows it). */
  xFraction: number;
  /**
   * Aggregated time axes put one period in each slot: the brush snaps to whole
   * periods and returns their combined date range.
   */
  slots?: { count: number; range(first: number, last: number): { min: number; max: number } | null };
  /** Present for two-axis charts (scatter, density, bubble). */
  yColumn?: number;
  yMin?: number;
  yMax?: number;
}

export interface MapBrushSelection {
  lonColumn: number;
  lonMin: number;
  lonMax: number;
  latColumn: number;
  latMin: number;
  latMax: number;
}

/** Draws over a map card's plot: the lon/lat window shown and the plot rectangle in CSS pixels. */
export type MapOverlay = (
  ctx: CanvasRenderingContext2D,
  view: MapViewport,
  plot: { x: number; y: number; w: number; h: number; ui: number },
) => void;

/** A dot's border is a darker shade of its fill and nearly opaque, so each dot reads even where the fill is see-through. */
export const BORDER_DARKER = 0.5;
export const BORDER_ALPHA = 0.95;

/** The shape of a dot on a scatter or a map. Circles are the default. */
export type MarkerShape = "circle" | "square" | "diamond" | "triangle";

export const MARKER_SHAPES: readonly { id: MarkerShape; label: string }[] = [
  { id: "circle", label: "Circle" },
  { id: "square", label: "Square" },
  { id: "diamond", label: "Diamond" },
  { id: "triangle", label: "Triangle" },
];

/** Adds one marker to the current path, centred on (x, y) and about as big as a circle of radius r. */
export function addMarkerPath(ctx: CanvasRenderingContext2D, shape: MarkerShape, x: number, y: number, r: number): void {
  switch (shape) {
    case "square":
      ctx.rect(x - r, y - r, r * 2, r * 2);
      break;
    case "diamond":
      ctx.moveTo(x, y - r * 1.3);
      ctx.lineTo(x + r * 1.3, y);
      ctx.lineTo(x, y + r * 1.3);
      ctx.lineTo(x - r * 1.3, y);
      ctx.closePath();
      break;
    case "triangle":
      ctx.moveTo(x, y - r * 1.3);
      ctx.lineTo(x + r * 1.2, y + r * 0.9);
      ctx.lineTo(x - r * 1.2, y + r * 0.9);
      ctx.closePath();
      break;
    default:
      ctx.moveTo(x + r, y);
      ctx.arc(x, y, r, 0, Math.PI * 2);
  }
}

/** Ordinary least squares through the first `n` points; null when x does not vary. */
export function leastSquares(x: ArrayLike<number>, y: ArrayLike<number>, n: number): { slope: number; intercept: number; r2: number } | null {
  let count = 0;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    const a = x[i];
    const b = y[i];
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    count++;
    sx += a;
    sy += b;
    sxx += a * a;
    syy += b * b;
    sxy += a * b;
  }
  if (count < 3) return null;
  const vx = sxx - (sx * sx) / count;
  const vy = syy - (sy * sy) / count;
  const cov = sxy - (sx * sy) / count;
  if (!(vx > 0)) return null;
  const slope = cov / vx;
  return { slope, intercept: (sy - slope * sx) / count, r2: vy > 0 ? (cov * cov) / (vx * vy) : 0 };
}

/** One reference line: across (a y value) or up (an x value), at a typed value or the mean of the plotted column. */
export interface RefLine {
  axis: "x" | "y";
  source: "value" | "mean";
  value?: number;
}

/** A marker the person placed on the Map page; draw paints its symbol centred on (x, y). */
export interface MapMarkerDraw {
  lon: number;
  lat: number;
  label: string;
  /** Radius in CSS pixels (7 when absent). */
  size?: number;
  draw(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void;
}

// Only one card's Settings popover may stay open at a time.
let openSettingsDisclosure: HTMLDetailsElement | null = null;

export type DensityStyle = "heat" | "contours" | "both";

/** Above this many categories a value bar chart reads better on its side, with its names in full. */
const RANKED_BARS_ABOVE = 12;

export interface SeriesRequestInput {
  xColumn: number;
  yColumn: number;
  colorColumn: number;
  sizeColumn: number;
  mode: SeriesMode;
  /** Map cards: one dot per distinct place, valued by the row count or this aggregate of the size column. */
  places?: { agg: "count" | "sum" | "mean" | "min" | "max" };
  limit?: number;
  /** false keeps the full data range; the map card sets this. */
  clip?: boolean;
  chartFilter?: { column: number; code: number };
  chartExclude?: ChartExclusion[];
  respectFilters?: boolean;
}

export interface ChartCardOptions {
  datasetName(): string;
  requestBins(
    column: number,
    options: ChartBinOptions,
    exclude?: ChartExclusion[],
  ): Promise<ChartBinsMessage>;
  requestSeries(input: SeriesRequestInput): Promise<ChartSeriesMessage>;
  /** Map card rectangle brush: filter both coordinate columns to the area. */
  onMapBrush?(selection: MapBrushSelection): void;
  /** Shift+drag on a scatter, density, bubble, line or histogram: filter to the brushed ranges. */
  onBrush?(ranges: BrushRange[]): void;
  /**
   * The slice under the pointer (as click actions), or null when the pointer
   * leaves. The panel passes it to the other cards so the same slice lights up.
   */
  onHighlight?(source: ChartCard, actions: readonly HitAction[] | null, label?: string): void;
  /** Per-mark share of a hovered slice, for highlighting across columns. */
  requestSliceBreakdown?(
    input: Omit<GetSliceBreakdownRequest, "type" | "requestId">,
  ): Promise<SliceBreakdownMessage>;
  requestBoxStats(input: {
    valueColumn: number;
    categoryColumn: number;
    topN: number;
    groupOther: boolean;
    chartFilter?: { column: number; code: number };
    chartExclude?: ChartExclusion[];
    respectFilters?: boolean;
  }): Promise<BoxStatsMessage>;
  requestCrosstab(input: {
    xColumn: number;
    yColumn: number;
    topX: number;
    topY: number;
    groupOther: boolean;
    chartFilter?: { column: number; code: number };
    chartExclude?: ChartExclusion[];
    respectFilters?: boolean;
  }): Promise<CrosstabMessage>;
  requestCorrelation(
    columns: number[],
    scope?: {
      chartFilter?: { column: number; code: number };
      chartExclude?: ChartExclusion[];
      respectFilters?: boolean;
    },
  ): Promise<CorrelationMessage>;
  /** Bins split by a category column, for grouped time series. */
  requestGroupedBins?(input: {
    column: number;
    groupColumn: number;
    options: ChartBinOptions;
    topN: number;
    chartExclude?: ChartExclusion[];
  }): Promise<GroupedBinsMessage>;
  /** Aggregate result for a view-bound card (null when the view is gone). */
  requestViewAggregate?(source: string, shape?: PivotChartShape): Promise<AggregateMessage | null>;
  /** Go to the Pivot View this chart draws, as it was left. */
  onOpenSource?(source: string): void;
  /** The Chart page's cards fold their settings into Data, Refine and Format; the Map page's panel stays whole. */
  sectionedSettings?: boolean;
  /** Worker pivot result for a pivot-bound heatmap card. */
  requestViewPivot?(source: string): Promise<PivotMessage | null>;
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
    scope?: {
      chartFilter?: { column: number; code: number };
      chartExclude?: ChartExclusion[];
      respectFilters?: boolean;
    },
  ): Promise<GridCountsMessage>;
  /** Per-time-bucket frames for animated bar, bubble, histogram and treemap charts. */
  requestRegions?: RegionRequests;
  requestErrorBars?(
    input: { view: ViewDef; kind: IntervalKind },
    onProgress: (message: ErrorBarsProgressMessage) => void,
  ): { done: Promise<ErrorBarsMessage>; cancel: () => void };
  requestAnimation?(input: {
    timeColumn: number;
    grain: FrameStep;
    chart: "bar" | "bubble" | "histogram" | "places";
    column: number;
    yColumn: number;
    bins?: number;
    topN?: number;
    measure?: { column: number; agg: "sum" | "mean" | "min" | "max" };
    groupColumn?: number;
    colorMeasure?: { column: number; agg: "sum" | "mean" | "min" | "max" };
    labelColumn?: number;
    chartFilter?: { column: number; code: number };
    chartExclude?: ChartExclusion[];
    respectFilters?: boolean;
  }): Promise<AnimationMessage>;
  /** Label for the filtered-table source: "Table" when no filters apply. */
  tableSourceLabel?(): string;
  /** Applies a filter from a click on a chart region (bars, bins, cells). */
  onFilter?(column: number, filter: ColumnFilter | null, preview?: boolean): void;
  /** Reads the app's current filter for a column, so clicks can toggle. */
  currentFilter?(column: number): ColumnFilter | null;
  /** On the Chart page: settings beside the plot, one headline, the plot filling the window. */
  docked?: boolean;
  /** Whether the docked settings panel starts open, and news of it being toggled. */
  settingsOpen?: boolean;
  onSettingsToggle?(open: boolean): void;
  onRemove(card: ChartCard): void;
  onDuplicate(card: ChartCard): void;
  /** The card's title may have changed (typed, or its columns changed): tabs follow it. */
  onTitleChange?(card: ChartCard): void;
  onExport(card: ChartCard, anchor?: HTMLElement): void;
  /** Edit this card through the shared setup dialog. */
  onEdit?(card: ChartCard): void;
  /** Rebuild this card from the gallery fit policy. */
  onResetSuggested?(card: ChartCard): void;
  /** Apply ordinary, visible table filters from a chart selection. */
  onFilterTable?(filters: readonly ChartTableFilter[], label: string): void;
  /** Apply filters, switch to the table, and show the matching rows. */
  onShowRows?(filters: readonly ChartTableFilter[], label: string): void;
  /** Drill the selected chart to a finer time grain or a new breakdown. */
  onDrill?(card: ChartCard, filters: readonly ChartTableFilter[], label: string): void;
  /** Open the shared setup dialog for a new breakdown chart. */
  onBreakDown?(card: ChartCard): void;
  /** Duplicate the current chart as an explicit comparison. */
  /** Open this line card's series on the Time Series page. */
  onDeepDive?(series: ChartSeriesTarget): void;
  /** Open this map card full width on the Map page. */
  onOpenMap?(preset: Partial<ChartCardConfig>): void;
  /** False in General mode: the Time Series and Map pages are hidden, so are links to them. */
  research?(): boolean;
  /** Map card with no coordinate columns: leave them unset instead of picking any number columns. */
  keepEmptyMap?: boolean;
  /** The title is shown by the page around the card: it goes on exports, not on the plot. */
  titleOutside?: boolean;
  /** Apply the existing null-policy conversion for placeholder tokens. */
  onConvertToken?(column: number, tokens: string[]): void;
  /** Apply an existing column suggestion (for example a sentinel code). */
  onSuggestion?(column: number, suggestion: ColumnSuggestion): void;
}

/** A line card's series as the Time Series page reads it. */
export interface ChartSeriesTarget {
  dateColumn: number;
  /** Category column the lines are split by (-1 = none). */
  groupColumn: number;
  /** Numeric column plotted (-1 = row count). */
  valueColumn: number;
  valueAgg: ChartCardConfig["valueAgg"];
  grain: TimeGrain | "auto";
  /** Buckets of `every` grains (2 weeks, say). */
  every: number;
}

export interface ChartTableFilter {
  column: number;
  filter: ColumnFilter;
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
  /** Optional centre for diverging domains (usually zero). */
  colorCenter?: number | null;
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
  valueAgg?:
    | "mean"
    | "sum"
    | "median"
    | "min"
    | "max"
    | "stddev"
    | "variance"
    | "p25"
    | "p75"
    | "p90"
    | "p95"
    | "count"
    | "distinct"
    | "first"
    | "last"
    | "mode"
    | "true"
    | "false"
    | "missing"
    | "truePct";
  /** Bucket grain for the value line; "auto"/undefined derives it from the span. */
  valueGrain?: TimeGrain | "auto";
  /** Bucket width in grain units (15 with minute = every 15 minutes); undefined or 1 is one unit. */
  valueEvery?: number;
  /**
   * Periods with no rows: show a gap, treat as zero, or carry the last value forward.
   * Undefined picks zero for sums and counts (an empty period really adds up to 0)
   * and a gap for everything else (an average of nothing is not 0).
   */
  valueFill?: "gap" | "zero" | "carry";
  /** Week buckets start on Sunday (0) instead of Monday (undefined or 1). */
  valueWeekStart?: 0 | 1;
  /** 2-12: the fiscal year starts in this month; undefined or 1 is the calendar year. */
  valueFiscalStart?: number;
  /** Non-destructive post-aggregation calculation for the card's measure. */
  valueCalc?:
    | "rolling7"
    | "cumulative"
    | "diff"
    | "pctChange"
    | "pctTotal"
    | "pctRows"
    | "rank"
    | "yoy";
  /** Chart-scoped category filter; -1/undefined means no chart filter. */
  filterColumn?: number;
  filterCode?: number;
  /** Things this card leaves out (values, ranges, text terms); not applied to the table. */
  excludes?: ChartExclusion[];
  /** Aggregate-backed cards: include the current table filters (default true). */
  respectFilters?: boolean;
  /** Bubble grid resolution per axis. */
  bubbleBins?: number;
  /** Bubble size measure: rows per cell or an aggregate of a numeric column. */
  bubbleAgg?: "count" | "sum" | "mean" | "min" | "max";
  /** How bubble radius maps from the measure value. */
  bubbleScale?: "area" | "radius" | "log";
  /** Map display: one dot per place (default), one dot per row, or an aggregated heat grid. */
  mapMode?: "points" | "heat" | "places" | "regions";
  /**
   * Map dots. Radius in pixels of the smallest and largest dot (one size for all when nothing
   * sizes them), the value range those radii span (unset: the data's own), how value becomes
   * radius, and how see-through the dots are.
   */
  dotMinRadius?: number;
  dotMaxRadius?: number;
  dotValueMin?: number | null;
  dotValueMax?: number | null;
  dotScale?: DotScale;
  /** Error bars on bars and lines of an average or similar: off until ticked. */
  errorBars?: boolean;
  errorBarKind?: IntervalKind;
  /** One dot per place: how the rows at a place combine into its colour. */
  mapColorAgg?: "sum" | "mean" | "min" | "max";
  /** How a number becomes a colour on a map: long tails read better on a logarithmic scale. */
  mapColorScale?: "linear" | "log";
  /** The column that names a place when hovering; undefined finds one, -1 is none. */
  mapLabelColumn?: number;
  dotOpacity?: number;
  /** Straight lines across the plot at one value each, on any chart with a numeric axis. */
  refLines?: RefLine[];
  /** The shape of the dots on a scatter or map (circle unless chosen). */
  markerShape?: MarkerShape;
  /** Map markers: nearby ones are drawn as one numbered circle, and a click on it zooms in. */
  mapCluster?: boolean;
  /** A scatter's dashed line of best fit, and the R² beside it (both on unless switched off). */
  fitLine?: boolean;
  fitR2?: boolean;
  /** Card width in the grid: normal cell or the whole row. */
  span?: "auto" | "full";
  /** The column frames step through, a date or a number column (-1 = off). */
  animationTimeColumn?: number;
  /** Frame length when that column holds dates. */
  animationGrain?: TimeGrain;
  /** Frames when it holds numbers: each distinct value, or equal steps of this width. */
  animationStep?: "value" | number;
  /** Playback/export speed multiplier (0.5, 1, 2, 4). */
  animationSpeed?: number;
  /** "Suggested: …" reason shown in the note for rule-picked default cards. */
  suggested: string;
  correlationColumns: number[];
  /** Aggregate-backed chart ordering; sorting never re-aggregates. */
  chartSort?: "none" | "valueDesc" | "valueAsc" | "labelAsc" | "labelDesc" | "timeAsc" | "timeDesc";
  /** Pivot heatmap: index level, column level and measure. */
  pivotRowLevel?: number;
  pivotColLevel?: number;
  pivotMeasure?: number;
  /**
   * A chart of a Pivot View: which of the pivot's fields is the axis, which splits it into
   * series (-1 none) and which value is drawn. Unset follows the pivot: Rows, then Columns.
   */
  viewAxis?: number;
  viewSeries?: number;
  viewMeasure?: number;
  /**
   * More numeric columns drawn beside Value on a line or bar chart, each its own series, added
   * up the same way as Value. Not combined with Group by: a chart is split one way at a time.
   */
  extraValueColumns?: number[];
}

/** The most values one chart draws as separate series. */
const MAX_VALUES = 6;

/** A source in a card's Source list: the table, or a Pivot View with the fields a chart of it can use. */
export interface ChartSource {
  id: string;
  name: string;
  kind?: "pivot" | "view";
  fields?: { dimensions: PivotChartField[]; measures: string[]; shape: PivotChartShape };
}

/** The colour maps offered before "More colour maps…": seven that cover what most charts need. */
const SHORT_PALETTES: readonly string[] = ["tab10", "colorblind", "Set2", "Blues", "rocket", "Blue to red", "RdBu"];
const MORE_PALETTES = "__more";

/** A chart of a pivot split into series draws at most this many groups of bars along its axis. */
const SPLIT_AXIS_LIMIT = 20;

/** One overlaid bubble set (a group, or the whole chart when ungrouped). */
interface BubbleLayer {
  label: string;
  code: number;
  counts: Uint32Array;
  values: Float64Array | null;
  color: string;
}

export interface Frame {
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

/** What the Map page's regions ask of the worker. */
export type RegionRequests = Pick<MapRegionsOptions, "load" | "suggest" | "values" | "clear" | "preview">;
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

/**
 * One chart in the multi-chart grid: its own type, columns, settings, canvas,
 * note and PNG export. Data flows in from the panel (`setColumns`,
 * `setFiltered`, `setRowCount`); scatter/density request their own sample or
 * density grid from the worker and drop stale responses via a generation
 * counter.
 */
/** Width of the Gaussian that smooths a histogram's bins into its KDE curve, in bins. */
const KDE_SIGMA_BINS = 1.4;

/** Single-series bars and lines of a statistic. */
export const ERROR_BAR_KINDS: ReadonlySet<ChartCardKind> = new Set<ChartCardKind>(["line", "bar", "barplot"]);
export const ERROR_BARS_ASK_CERTAINTY: ReadonlySet<IntervalKind> = new Set<IntervalKind>(["ci", "bootstrap", "se"]);
export const TIME_SERIES_WARNING = "Warning: periods in a time series are related, not independent, so these intervals are likely too narrow";

/** Map joins these only in one dot per place: see animatesPlaces. */
const ANIMATED_KINDS: ReadonlySet<ChartCardKind> = new Set<ChartCardKind>(["bar", "bubble", "histogram", "treemap", "density", "map"]);

export const MAP_COLOR_AGG_NAMES = { mean: "average", sum: "total", min: "lowest", max: "highest" } as const;

export class ChartCard {
  readonly root: HTMLElement;

  /** Staleness token for the value-aggregate request only. */
  private valueGeneration = 0;
  /** Same for the bound view or pivot request, which sibling refreshes must not discard. */
  private viewGeneration = 0;
  config = chartConfigWithDefaults();
  columns: ColumnMeta[] = [];
  private facets: Record<number, number[]> = {};
  private histograms: Record<number, number[]> = {};
  private rowCount = 0;
  generation = 0;
  disposed = false;

  private pickerSignature = "";
  private binResult: ChartBins | null = null;
  private lineBinResult: ChartBins | null = null;
  private lineBinRange: { min: number; max: number } | null = null;
  private lineBinSignature = "";
  private binMedian: number | null = null;
  seriesResult: SeriesPoints | SeriesGrid | null = null;
  /** Decoded 110m basemap for map cards (shared module cache, first paint). */
  basemap: Basemap | null = null;
  /** Regional 50m basemap, loaded lazily when the viewport zooms in. */
  detailBasemap: Basemap | null = null;
  detailBasemapRequested = false;
  detailBasemapFailed = false;
  detailBasemapLoading = false;
  /** Live map brush rectangle in canvas pixels while dragging. */
  mapBrush: { x0: number; y0: number; x1: number; y1: number } | null = null;
  /** Data-space geometry of the last paint, for Shift+drag brushing (null when not brushable). */
  brushSpace: BrushSpace | null = null;
  /** Slice another card's pointer is over; this card outlines the matching marks. */
  private linked: readonly HitAction[] | null = null;
  /** Caption for the linked slice ("East", "18.3 – 18.9"). */
  private linkedLabel = "";
  /** How the last paint scaled its marks, so another chart's slice can be drawn on them. */
  private valueScale: ValueScale | null = null;
  /** The slice's value per mark of this chart (another column's hover), or null. */
  private sliceValues: Float64Array | null = null;
  /** Scatter cards: the points of the hovered slice (same scope, other column's rows). */
  private slicePoints: { x: Float64Array; y: Float64Array; shown: number } | null = null;
  private sliceTimer: number | null = null;
  private sliceGeneration = 0;
  /** Whether the last paint outlined anything for the linked slice. */
  private linkedShown = false;
  /** Key of the last slice sent to the panel, so moving within one mark sends nothing. */
  private emittedKey = "";
  /** Live Shift+drag rectangle in canvas pixels. */
  brushDrag: { x0: number; y0: number; x1: number; y1: number } | null = null;
  mapBrushStart: { x: number; y: number } | null = null;
  /** Frame of the last paint, used to map brush pixels to lon/lat. */
  lastFrame: Frame | null = null;
  /** Treemap tiles: group labels, the aggregate and the raw row count. */
  private treemapResult: {
    labels: string[];
    values: number[];
    rows: number[];
    totalGroups: number;
    truncated: boolean;
  } | null = null;
  /** Top-terms payload: token frequencies plus shape detection. */
  private textResult: TextProfileMessage | null = null;
  seriesLabels: string[] | null = null;
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
  animationResult: AnimationResult | null = null;
  animationFrame = 0;
  private animationPlaying = false;
  private animationTimer: number | null = null;
  private animationSetupOpen = false;
  private readonly bubbleBinsInput: HTMLInputElement;
  readonly gridField: HTMLElement;
  readonly gridHint: HTMLElement;
  private readonly bubbleAggSelect: HTMLSelectElement;
  private bubbleAggHint!: HTMLElement;
  private readonly bubbleScaleSelect: HTMLSelectElement;
  private readonly animateButton: HTMLButtonElement;
  private readonly focusButton: HTMLButtonElement;
  readonly pngButton: HTMLButtonElement;
  readonly statsButton: HTMLButtonElement;
  private kindButton: HTMLButtonElement | null = null;
  private undoButton: HTMLButtonElement | null = null;
  /** Earlier settings of this chart, newest last, as JSON. */
  private undoStack: string[] = [];
  /** The settings as they were when the person last reached for a control. */
  private undoBefore: string | null = null;
  /** The bar, bin or cell clicked: highlighted, with Filter to this offered beside it. */
  private selectedRegion: HitRegion | null = null;
  private selectionBar: HTMLElement | null = null;
  /** Plot top the docked height was last worked out from: a legend appearing moves it. */
  private dockedTop = -1;  private focusOverlay: HTMLElement | null = null;
  private readonly focusPlaceholder = document.createComment("chart-focus");
  private readonly animationSetup: HTMLElement;
  private readonly bubbleSettings: HTMLElement;
  private readonly bubbleTitle: HTMLElement;
  private readonly bubbleScaleField: HTMLElement;
  readonly mapModeSelect: HTMLSelectElement;
  private readonly mapModeWrap: HTMLElement;
  /** The Dots row under the map's settings: radius, value range, scale and opacity. */
  readonly dotSettings: HTMLElement;
  readonly dotMinInput: HTMLInputElement;
  readonly dotMaxInput: HTMLInputElement;
  readonly dotMaxWrap: HTMLElement;
  readonly dotMinLabel: HTMLElement;
  readonly dotValueMinInput: HTMLInputElement;
  readonly dotValueMaxInput: HTMLInputElement;
  readonly dotValuesWrap: HTMLElement;
  readonly dotScaleSelect: HTMLSelectElement;
  readonly dotScaleWrap: HTMLElement;
  readonly errorBarRow: HTMLElement;
  readonly errorBarInput: HTMLInputElement;
  readonly errorBarSelect: HTMLSelectElement;
  readonly errorBarHint: HTMLElement;
  errorBarResult: ErrorBarsMessage | null = null;
  errorBarIndex = new Map<string, number>();
  errorBarJob: { cancel: () => void } | null = null;
  errorBarRun = 0;
  errorBarProgress: HTMLElement | null = null;
  errorBarProgressTimer: number | null = null;
  readonly mapColorAggSelect: HTMLSelectElement;
  readonly mapColorAggWrap: HTMLElement;
  readonly mapColorScaleSelect: HTMLSelectElement;
  readonly mapColorScaleWrap: HTMLElement;
  readonly mapLabelSelect: HTMLSelectElement;
  readonly mapLabelWrap: HTMLElement;
  /** Names of the places drawn, from the worker, and which place each of the current frame's dots is. */
  placeLabels: string[] | null = null;
  framePlaces: number[] | null = null;
  readonly dotOpacityInput: HTMLInputElement;
  readonly dotShapeSelect: HTMLSelectElement;
  private readonly refSection: HTMLElement;
  private readonly refRows: HTMLElement;
  private refKey = "";
  private readonly dotShapeWrap: HTMLElement;
  /** The clusters drawn last, with the box of the markers each holds, so a click can zoom to it. */
  mapClusters: { x: number; y: number; r: number; lonMin: number; lonMax: number; latMin: number; latMax: number }[] = [];
  readonly fitWrap: HTMLElement;
  readonly fitLineInput: HTMLInputElement;
  readonly fitR2Input: HTMLInputElement;
  readonly dotOpacityOut: HTMLElement;
  private readonly resetViewButton: HTMLButtonElement;
  /** Map heat grid (count or measure per cell), computed by the worker. */
  mapGrid: GridCountsResult | null = null;
  /** Map viewport in degrees (null = the whole world). */
  mapView: MapViewport | null = null;
  mapMarkers: readonly MapMarkerDraw[] = [];
  private mapPicker: ((lon: number, lat: number) => void) | null = null;
  mapOverlay: MapOverlay | null = null;
  /** Optional user-supplied regions (GeoJSON / zipped Shapefile). */
  readonly regions: MapRegions | null;
  mapDrag: { x: number; y: number } | null = null;
  /** True once a drag moved: the release click must not also fire a filter. */
  dragMoved = false;
  /** Scatter/density viewport in data units (null = the full series bounds). */
  plotView: { xMin: number; xMax: number; yMin: number; yMax: number } | null = null;
  plotDrag: { x: number; y: number } | null = null;
  /** Line/histogram x-axis zoom in data units (null = the full range). */
  chartXZoom: { min: number; max: number } | null = null;
  /** Bar chart category window: start index and count over the sorted bars. */
  barWindow: { start: number; count: number } | null = null;
  /** Heatmap category windows on both axes. */
  heatWindow: {
    xStart: number;
    xCount: number;
    yStart: number;
    yCount: number;
  } | null = null;
  /** Box plot category window and optional numeric Y window. */
  boxWindow: { start: number; count: number } | null = null;
  boxY: { min: number; max: number } | null = null;
  /** Correlation matrix row/column window. */
  corrWindow: { start: number; count: number } | null = null;
  /** Treemap / top-terms item window. */
  itemWindow: { start: number; count: number } | null = null;
  private readonly animationTimeSelect: HTMLSelectElement;
  private readonly animationGrainSelect: HTMLSelectElement;
  /** "every" before a time grain, "by" before each value / steps of N. */
  private readonly animationStepLabel = el("span", { class: "chart-field-label" }, ["every"]);
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
  readonly sourceWrap: HTMLElement;
  private sources: ChartSource[] = [];
  private readonly viewKindSelect: HTMLSelectElement;
  private readonly viewAxisSelect: HTMLSelectElement;
  private readonly viewSeriesSelect: HTMLSelectElement;
  private readonly viewMeasureSelect: HTMLSelectElement;
  private readonly viewAxisWrap: HTMLElement;
  private readonly viewSeriesWrap: HTMLElement;
  private readonly viewMeasureWrap: HTMLElement;
  private readonly backToSource: HTMLButtonElement;
  private readonly sourceChip = el(
    "button",
    { class: "chart-source-chip hidden", type: "button", title: "Open the Pivot View this chart draws, as you left it" },
    [],
  ) as HTMLButtonElement;
  private readonly extraValuesWrap = el("div", { class: "chart-extra-values hidden", role: "group", "aria-label": "More values" });
  private extraValuesKey = "";
  private viewResult: AggregateMessage | null = null;
  /** A view-bound card cannot change type, so its real type is shown as text. */
  private readonly kindStatic = el("span", { class: "chart-kind-static hidden" });
  private pivotResult: PivotMessage | null = null;
  private readonly pivotRowSelect: HTMLSelectElement;
  private readonly pivotColSelect: HTMLSelectElement;
  private readonly pivotMeasureSelect: HTMLSelectElement;
  private readonly pivotRowWrap: HTMLElement;
  private readonly pivotColWrap: HTMLElement;
  private readonly pivotMeasureWrap: HTMLElement;
  private readonly primarySelect: HTMLSelectElement;
  private readonly groupSelect: HTMLSelectElement;
  private readonly groupWrap: HTMLElement;
  private readonly valueSelect: HTMLSelectElement;
  private readonly valueWrap: HTMLElement;
  private readonly valueAggSelect: HTMLSelectElement;
  private readonly valueAggWrap: HTMLElement;
  private readonly valueGrainSelect: HTMLSelectElement;
  private readonly valueGrainWrap: HTMLElement;
  private readonly valueEveryInput: HTMLInputElement;
  private readonly valueEveryWrap: HTMLElement;
  private readonly valueFillSelect: HTMLSelectElement;
  private readonly valueFillWrap: HTMLElement;
  private readonly weekStartSelect: HTMLSelectElement;
  private readonly weekStartWrap: HTMLElement;
  private readonly fiscalSelect: HTMLSelectElement;
  private readonly fiscalWrap: HTMLElement;
  /** Series colours of the last split-by time chart, for the one shared legend. */
  private splitLegend: { label: string; color: string }[] | null = null;
  private readonly hiddenSplit = new Set<string>();
  private readonly valueCalcSelect: HTMLSelectElement;
  private readonly valueCalcWrap: HTMLElement;
  private readonly sortSelect: HTMLSelectElement;
  private readonly sortWrap: HTMLElement;
  private readonly filterColumnSelect: HTMLSelectElement;
  private readonly filterValueSelect: HTMLSelectElement;
  private readonly filterRespectInput: HTMLInputElement;
  readonly chartFilterRow: HTMLElement;
  /** Aggregate result for the card's own value-over-time line. */
  private valueResult: AggregateMessage | null = null;
  private readonly xSelect: HTMLSelectElement;
  private readonly ySelect: HTMLSelectElement;
  readonly colorSelect: HTMLSelectElement;
  private readonly sizeSelect: HTMLSelectElement;
  private readonly modeSelect: HTMLSelectElement;
  private readonly densityStyleSelect: HTMLSelectElement;
  private readonly kdeInput: HTMLInputElement;
  private readonly correlationSelect: HTMLSelectElement;
  private readonly primaryWrap: HTMLElement;
  private readonly axesPanel: HTMLElement;
  private readonly xWrap: HTMLElement;
  private readonly yWrap: HTMLElement;
  readonly colorWrap: HTMLElement;
  private readonly sizeWrap: HTMLElement;
  private readonly sizeTagLabel: HTMLElement;
  private readonly primaryTagLabel: HTMLElement;
  readonly bubbleAggField: HTMLElement;
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
  private readonly colorCenterInput: HTMLInputElement;
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
  readonly canvas: HTMLCanvasElement;
  private readonly mapControls: HTMLElement;
  readonly canvasWrap: HTMLElement;
  private readonly scopeEl: HTMLElement;
  readonly summaryEl: HTMLElement;
  /** One short note under the heading (see lint); dismissed notes stay dismissed. */
  private readonly lintEl = el("div", { class: "chart-lint hidden", role: "note" });
  private readonly dismissedNotes = new Set<string>();
  private readonly dataIssueEl: HTMLElement;
  private readonly deepDiveEl: HTMLElement;
  private issueSignature = "";
  readonly noteEl: HTMLElement;
  private totalRowCount = 0;
  private readonly legendEl: HTMLElement;
  private readonly tooltipEl: HTMLElement;
  readonly settingsBody: HTMLElement;
  private settingsDisclosure: HTMLDetailsElement | null = null;
  sidebar!: HTMLElement;
  private sidebarToggle!: HTMLButtonElement;
  private layoutEl!: HTMLElement;
  sidebarShown = false;
  private settingsDismiss: (() => void) | null = null;
  hitRegions: HitRegion[] = [];
  private exclusionBar!: HTMLElement;
  private pointerAt: { x: number; y: number; clientX: number; clientY: number } | null = null;
  /** Last hovered/clicked region, retained while the card menu is open. */
  private lastActionRegion: HitRegion | null = null;
  private pointerFrame: number | null = null;

  private readonly onResize = (): void => this.scheduleRender(this.options.docked === true);
  private readonly onThemeChange = (): void => this.scheduleRender(true);
  private renderQueued = false;
  private renderForce = false;
  /** True while the frame only shows an empty-state message, so no axes. */
  private plotMessageDrawn = false;
  /** Set while drawing on the Chart page, where the headline above the plot says what it is. */
  private plotHasHeadline = false;
  /** Wrap width of the last paint, used to ignore no-op resize callbacks. */
  private lastWrapWidth = -1;
  /** The width before the last repaint; a return to it is a scrollbar feedback flip. */
  private prevWrapWidth = -1;
  private resizeObserver: ResizeObserver | null = null;

  constructor(
    root: HTMLElement,
    readonly options: ChartCardOptions,
    preset?: Partial<ChartCardConfig>,
  ) {
    this.root = root;
    this.root.classList.add("chart-card");
    this.config = chartConfigWithDefaults(preset);

    const head = el("div", { class: "chart-card-head" });
    // Source selector: the filtered table or a saved aggregate view. A card
    // bound to a view reads that view's result; there is no raw-row path.
    const sourceWrap = el("label", { class: "chart-field chart-source-field" });
    sourceWrap.append(el("span", { class: "chart-field-label" }, ["Source"]));
    this.sourceSelect = this.buildSelect("chart-picker chart-picker-small chart-source", "Data source");
    this.renderSourceOptions();
    this.sourceSelect.addEventListener("change", () => {
      this.config.source = this.sourceSelect.value;
      this.config.viewAxis = undefined;
      this.config.viewSeries = undefined;
      this.config.viewMeasure = undefined;
      this.generation++;
      this.viewResult = null;
      this.pivotResult = null;
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
      // Maps are the Map page's; a card there or from an old spec still needs its own name here.
      if (kind === "map" && this.config.kind !== "map") return;
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
      // Split by a field or by several values, one at a time.
      if (this.config.groupColumn >= 0) this.config.extraValueColumns = [];
      this.hiddenGroups.clear();
      this.generation++;
      this.refreshGroupedBins();
      this.refreshBubble();
      this.refreshAnimation();
      this.refreshValue();
      this.renderControls();
      this.render();
    });
    this.groupWrap = this.tagged("Group by", this.groupSelect).wrap;

    this.valueSelect = this.buildSelect("chart-picker chart-picker-small", "Value column");
    this.valueSelect.addEventListener("change", () => {
      this.config.valueColumn = Number(this.valueSelect.value);
      this.syncValueAggOptions();
      // A numeric treemap measure defaults to sum, matching pivot conventions.
      if (this.config.kind === "treemap" && (this.config.valueColumn ?? -1) >= 0) {
        this.config.valueAgg = "sum";
        this.valueAggSelect.value = "sum";
      }
      // A value and a group can only share a chart whose type splits into series
      // (lines, bars and their relatives); anywhere else the value choice clears the group.
      if ((this.config.valueColumn ?? -1) >= 0 && !SPLIT_KINDS.includes(this.config.kind)) {
        this.config.groupColumn = -1;
      }
      this.generation++;
      this.syncOptions();
      this.renderControls();
      this.refreshValue();
      this.refreshTreemap();
      this.render();
    });
    this.valueWrap = this.tagged("Value", this.valueSelect).wrap;

    this.valueAggSelect = this.buildSelect("chart-picker chart-picker-small", "Aggregation");
    (
      [
        ["mean", "Average (mean)"],
        ["sum", "Sum"],
        ["median", "Median"],
        ["min", "Min"],
        ["max", "Max"],
        ["count", "Count of values"],
        ["distinct", "Distinct values"],
      ] as const
    ).forEach(([value, label]) => {
      this.valueAggSelect.append(el("option", { value }, [label]) as HTMLOptionElement);
    });
    this.valueAggSelect.addEventListener("change", () => {
      this.config.valueAgg = this.valueAggSelect.value as ChartCardConfig["valueAgg"];
      this.generation++;
      this.refreshValue();
      this.refreshTreemap();
      this.render();
    });
    this.valueAggWrap = this.tagged("Aggregate", this.valueAggSelect).wrap;

    this.valueGrainSelect = this.buildSelect("chart-picker chart-picker-small", "Bucket");
    (["auto", "second", "minute", "hour", "day", "week", "month", "quarter", "year"] as const).forEach(
      (grain) => {
        const label = grain === "auto" ? "Auto" : grain.charAt(0).toUpperCase() + grain.slice(1);
        this.valueGrainSelect.append(el("option", { value: grain }, [label]) as HTMLOptionElement);
      },
    );
    this.valueGrainSelect.addEventListener("change", () => {
      this.config.valueGrain = this.valueGrainSelect.value as ChartCardConfig["valueGrain"];
      this.generation++;
      this.renderControls();
      this.refreshValue();
      this.render();
    });
    this.valueGrainSelect.title = "How finely time is grouped. Dates are used as stored: no time-zone shift is applied.";
    this.valueGrainWrap = this.tagged("Time resolution", this.valueGrainSelect).wrap;

    this.valueEveryInput = el("input", {
      class: "chart-picker chart-picker-small chart-every-input",
      type: "number",
      min: "1",
      step: "1",
      inputmode: "numeric",
      "aria-label": "Every N time units",
      title: "Group every N units together: 15 with Minute is quarter-hourly, 2 with Week is fortnightly.",
    }) as HTMLInputElement;
    this.valueEveryInput.addEventListener("change", () => {
      const value = Math.floor(Number(this.valueEveryInput.value));
      this.config.valueEvery = Number.isFinite(value) && value >= 2 ? Math.min(value, 100_000) : undefined;
      this.valueEveryInput.value = String(this.config.valueEvery ?? 1);
      this.generation++;
      this.renderControls();
      this.refreshValue();
      this.render();
    });
    this.valueEveryWrap = el("label", { class: "chart-tag" }, [
      el("span", { class: "chart-tag-label" }, ["Every"]),
      this.valueEveryInput,
    ]);

    this.valueFillSelect = this.buildSelect("chart-picker chart-picker-small", "Missing periods");
    (
      [
        ["auto", "Automatic"],
        ["gap", "Show gaps"],
        ["zero", "Count as zero"],
        ["carry", "Carry last value"],
      ] as const
    ).forEach(([value, label]) => {
      this.valueFillSelect.append(el("option", { value }, [label]) as HTMLOptionElement);
    });
    this.valueFillSelect.addEventListener("change", () => {
      const value = this.valueFillSelect.value;
      this.config.valueFill = value === "auto" ? undefined : (value as "gap" | "zero" | "carry");
      this.generation++;
      this.refreshValue();
      this.render();
    });
    this.valueFillWrap = this.tagged("Missing periods", this.valueFillSelect).wrap;

    this.weekStartSelect = this.buildSelect("chart-picker chart-picker-small", "Week starts on");
    [["1", "Monday"], ["0", "Sunday"]].forEach(([value, label]) => {
      this.weekStartSelect.append(el("option", { value }, [label]) as HTMLOptionElement);
    });
    this.weekStartSelect.addEventListener("change", () => {
      this.config.valueWeekStart = this.weekStartSelect.value === "0" ? 0 : undefined;
      this.generation++;
      this.refreshValue();
      this.render();
    });
    this.weekStartWrap = this.tagged("Week starts", this.weekStartSelect).wrap;

    this.fiscalSelect = this.buildSelect("chart-picker chart-picker-small", "Financial year starts in");
    ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"].forEach((label, index) => {
      this.fiscalSelect.append(el("option", { value: String(index + 1) }, [index === 0 ? "January (calendar year)" : label]) as HTMLOptionElement);
    });
    this.fiscalSelect.addEventListener("change", () => {
      const month = Number(this.fiscalSelect.value);
      this.config.valueFiscalStart = month > 1 ? month : undefined;
      this.generation++;
      this.refreshValue();
      this.render();
    });
    this.fiscalWrap = this.tagged("Year starts", this.fiscalSelect).wrap;

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
        ["pctRows", "% of rows"],
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

    this.sortSelect = this.buildSelect(
      "chart-picker chart-picker-small",
      "Chart sort order",
    );
    for (const [value, label] of [
      ["none", "Automatic"],
      ["valueDesc", "Value high to low"],
      ["valueAsc", "Value low to high"],
      ["labelAsc", "Label A-Z"],
      ["labelDesc", "Label Z-A"],
      ["timeAsc", "Oldest first"],
      ["timeDesc", "Newest first"],
    ] as const) {
      this.sortSelect.append(el("option", { value }, [label]) as HTMLOptionElement);
    }
    this.sortSelect.addEventListener("change", () => {
      this.config.chartSort = this.sortSelect.value as ChartCardConfig["chartSort"];
      this.render();
    });
    this.sortWrap = this.tagged("Sort", this.sortSelect).wrap;

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
      this.regions?.refresh();
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
      this.regions?.refresh();
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
      this.regions?.refresh();
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
      this.refreshAnimation();
      this.renderControls();
      this.syncPalette();
      this.render();
    });
    this.colorWrap = this.tagged("Colour", this.colorSelect).wrap;

    this.sizeSelect = this.buildSelect("chart-picker chart-picker-small", "Size column");
    this.sizeSelect.addEventListener("change", () => {
      this.config.sizeColumn = Number(this.sizeSelect.value);
      // Picking a column for a bubble or heat map means "measure by this
      // column": switch the measure away from count so the choice takes
      // effect immediately, and back to count when the column is cleared.
      if (this.config.kind === "bubble" || (this.config.kind === "map" && (this.config.mapMode ?? DEFAULT_MAP_MODE) !== "points")) {
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
      ["points", "Points"],
      ["density", "Density (heat map)"],
    ] as const).forEach(([value, label]) => {
      this.modeSelect.append(el("option", { value }, [label]) as HTMLOptionElement);
    });
    this.modeSelect.addEventListener("change", () => {
      this.config.mode = this.modeSelect.value as SeriesMode;
      this.generation++;
      this.renderControls();
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
    this.focusButton = el(
      "button",
      {
        class: "ghost small chart-focus-btn",
        type: "button",
        title: "Expand this chart for a closer look (Esc to close)",
        "aria-label": "Focus chart",
      },
      [],
    ) as HTMLButtonElement;
    this.focusButton.append(focusIcon(), el("span", {}, ["Focus"]));
    this.focusButton.addEventListener("click", () => this.toggleFocus());
    this.pngButton = el(
      "button",
      {
        class: "ghost small chart-png-btn",
        type: "button",
        title: "Download this chart as a PNG",
        "aria-label": "Download PNG",
      },
      [],
    ) as HTMLButtonElement;
    this.pngButton.append(pngIcon(), el("span", {}, ["PNG"]));
    this.pngButton.addEventListener("click", () => this.options.onExport(this));
    this.statsButton = el(
      "button",
      { class: "ghost small chart-stats-btn", type: "button", "aria-label": "Extract chart stats", title: "See and copy the numbers behind this chart: bin counts, box ranges, curve and line parameters" },
      [el("span", { class: "chart-stats-long" }, ["Extract stats"]), el("span", { class: "chart-stats-short" }, ["Stats"])],
    ) as HTMLButtonElement;
    this.statsButton.addEventListener("click", () => this.openStats());
    this.animateButton = el(
      "button",
      {
        class: "ghost small chart-animate-btn",
        type: "button",
        title: "Step this chart through time",
        "aria-label": "Animate chart",
      },
      [],
    ) as HTMLButtonElement;
    this.animateButton.append(movieIcon(), el("span", {}, ["Animate"]));
    this.animateButton.addEventListener("click", () => this.toggleAnimationSetup());

    this.pivotRowSelect = this.buildSelect(
      "chart-picker chart-picker-small",
      "Pivot row level",
    );
    this.pivotRowSelect.addEventListener("change", () => {
      this.config.pivotRowLevel = Number(this.pivotRowSelect.value);
      this.render();
    });
    this.pivotRowWrap = this.tagged("Rows", this.pivotRowSelect).wrap;
    this.pivotColSelect = this.buildSelect(
      "chart-picker chart-picker-small",
      "Pivot column level",
    );
    this.pivotColSelect.addEventListener("change", () => {
      this.config.pivotColLevel = Number(this.pivotColSelect.value);
      this.render();
    });
    this.pivotColWrap = this.tagged("Columns", this.pivotColSelect).wrap;
    this.pivotMeasureSelect = this.buildSelect(
      "chart-picker chart-picker-small",
      "Pivot measure",
    );
    this.pivotMeasureSelect.addEventListener("change", () => {
      this.config.pivotMeasure = Number(this.pivotMeasureSelect.value);
      this.render();
    });
    this.pivotMeasureWrap = this.tagged("Value", this.pivotMeasureSelect).wrap;

    // A chart of a Pivot View: bars and lines or a heatmap, and which pivot field goes where.
    this.viewKindSelect = this.buildSelect("chart-picker chart-picker-small hidden", "Chart type for this pivot");
    this.viewKindSelect.addEventListener("change", () => {
      this.noteBeforeChange();
      this.config.kind = this.viewKindSelect.value === "pivotHeatmap" ? "pivotHeatmap" : "bar";
      this.viewResult = null;
      this.pivotResult = null;
      this.syncSourceControls();
      this.refreshForConfig();
    });
    const shapeSelect = (label: string, key: "viewAxis" | "viewSeries" | "viewMeasure"): HTMLSelectElement => {
      const select = this.buildSelect("chart-picker chart-picker-small", label);
      select.addEventListener("change", () => this.setViewShape(key, Number(select.value)));
      return select;
    };
    this.viewAxisSelect = shapeSelect("Pivot field on the axis", "viewAxis");
    this.viewSeriesSelect = shapeSelect("Pivot field for the series", "viewSeries");
    this.viewMeasureSelect = shapeSelect("Pivot value", "viewMeasure");
    this.viewAxisWrap = this.tagged("Axis", this.viewAxisSelect).wrap;
    this.viewSeriesWrap = this.tagged("Series", this.viewSeriesSelect).wrap;
    this.viewMeasureWrap = this.tagged("Value", this.viewMeasureSelect).wrap;
    this.backToSource = el(
      "button",
      { class: "link small chart-back-to-source hidden", type: "button", title: "Open the Pivot View this chart draws, as you left it" },
      ["← Back to pivot"],
    ) as HTMLButtonElement;
    this.backToSource.addEventListener("click", () => {
      if (this.config.source !== "") this.options.onOpenSource?.(this.config.source);
    });
    // Every control below already shows or hides itself for the chart type;
    // the sidebar only decides where they live.
    const sidebarRow = (label: string, control: HTMLElement): HTMLElement =>
      el("label", { class: "chart-tag chart-side-row" }, [
        el("span", { class: "chart-tag-label" }, [label]),
        control,
      ]);
    const sideSection = (...children: HTMLElement[]): HTMLElement =>
      el("div", { class: "chart-side-section" }, children);
    this.kindSelect.classList.add("chart-picker");
    this.sidebar = el("aside", { class: "chart-sidebar", "aria-label": "Chart settings" }, [
      sideSection(
        sidebarRow(
          "Chart type",
          el("span", { class: "chart-kind-field" }, [this.kindSelect, this.kindStatic, this.viewKindSelect]),
        ),
        this.sourceWrap,
        this.backToSource,
      ),
      sideSection(this.axesPanel, this.sortWrap),
      sideSection(this.valueWrap, this.extraValuesWrap, this.groupWrap, this.valueCalcWrap),
      sideSection(this.viewAxisWrap, this.viewSeriesWrap, this.viewMeasureWrap),
      sideSection(this.pivotRowWrap, this.pivotColWrap, this.pivotMeasureWrap),
    ]);
    this.sidebarToggle = el(
      "button",
      {
        class: "ghost small chart-sidebar-toggle",
        type: "button",
        title: "Open the settings drawer: type, fields, colours",
        "aria-label": "Customize this chart",
        "aria-expanded": "false",
      },
      ["Customize"],
    ) as HTMLButtonElement;
    this.sidebarToggle.addEventListener("click", () => this.toggleSidebar());
    // A visible way out: the drawer overlays the card, so it carries its own Done button at the top, always in view.
    const sideHead = el("div", { class: "chart-side-head" }, [el("b", {}, ["Chart settings"])]);
    const sideDone = el("button", { class: "ghost small", type: "button", "aria-label": "Close the settings drawer", title: "Close the settings (Escape)" }, ["Done"]);
    sideDone.addEventListener("click", () => { this.toggleSidebar(); this.sidebarToggle.focus(); });
    sideHead.append(sideDone);
    this.sidebar.prepend(sideHead);
    this.sidebar.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || !this.sidebarShown || this.options.docked === true) return;
      event.stopPropagation();
      this.toggleSidebar();
      this.sidebarToggle.focus();
    });
    head.prepend(this.sidebarToggle);
    head.append(
      el("span", { class: "grow" }),
      this.focusButton,
      this.statsButton,
      this.pngButton,
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
    this.errorBarInput = el("input", { type: "checkbox", "aria-label": "Error bars" }) as HTMLInputElement;
    this.errorBarInput.checked = this.config.errorBars === true;
    this.errorBarInput.addEventListener("change", () => {
      this.config.errorBars = this.errorBarInput.checked;
      this.syncErrorBarControls();
      this.refreshErrorBars();
      this.render();
    });
    this.errorBarSelect = el("select", { class: "chart-picker chart-picker-small", "aria-label": "Error bar type" }) as HTMLSelectElement;
    for (const { id, label, asks } of INTERVAL_KINDS) {
      this.errorBarSelect.append(el("option", { value: id, title: asks }, [label]) as HTMLOptionElement);
    }
    this.errorBarSelect.addEventListener("change", () => {
      this.config.errorBarKind = this.errorBarSelect.value as IntervalKind;
      this.syncErrorBarControls();
      this.refreshErrorBars();
      this.render();
    });
    this.errorBarHint = el("span", { class: "chart-field-hint chart-error-hint" });
    this.errorBarRow = el("div", { class: "chart-settings chart-error-row" }, [
      el("label", { class: "control check clean-check chart-check" }, [this.errorBarInput, "Error bars"]),
      this.errorBarSelect,
      this.errorBarHint,
    ]);
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
    this.gridHint = el("span", { class: "chart-field-hint" });
    bubbleField.append(
      el("span", { class: "chart-field-label" }, ["Grid"]),
      this.bubbleBinsInput,
      this.gridHint,
    );
    this.gridField = bubbleField;
    this.bubbleAggSelect = el("select", {
      class: "chart-picker chart-picker-small",
      "aria-label": "Bubble size measure",
      title: "What the bubble area represents: rows per cell or an aggregate of a numeric column",
    }) as HTMLSelectElement;
    for (const [value, label] of [
      ["count", "Rows"],
      ["sum", "Sum"],
      ["mean", "Average (mean)"],
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
      this.refreshSeries();
      this.refreshMapGrid();
      this.refreshAnimation();
      this.render();
    });
    const bubbleAggField = el("label", { class: "chart-field" });
    this.bubbleAggField = bubbleAggField;
    bubbleAggField.title = "How the rows in each area combine into one value";
    this.bubbleAggHint = el("span", { class: "chart-field-hint" });
    bubbleAggField.append(
      el("span", { class: "chart-field-label" }, ["Aggregate"]),
      this.bubbleAggSelect,
      this.bubbleAggHint,
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
      ["places", "One dot per place"],
      ["points", "One dot per row"],
      ["cluster", "One dot per row, clustered"],
    ] as const) {
      this.mapModeSelect.append(el("option", { value }, [label]) as HTMLOptionElement);
    }
    if (this.config.mapMode !== "heat" && this.config.mapMode !== "regions") this.mapModeSelect.value = this.mapModeChoice();
    this.mapModeSelect.addEventListener("change", () => {
      const value = this.mapModeSelect.value;
      // Clustering is a way of drawing one dot per row: it is the points mode with the groups switched on.
      this.config.mapCluster = value === "cluster";
      this.setMapMode(value === "places" ? "places" : "points");
    });
    this.mapModeWrap = this.tagged("Show", this.mapModeSelect).wrap;
    this.regions = this.options.requestRegions === undefined ? null : new MapRegions(this.regionOptions(this.options.requestRegions));
    this.bubbleScaleField = bubbleScaleField;
    this.bubbleSettings = el("div", { class: "chart-bubble-settings hidden" }, [
      this.bubbleTitle,
      this.mapModeWrap,
      ...(this.regions === null ? [] : [this.regions.root]),
      bubbleField,
      bubbleAggField,
      bubbleScaleField,
    ]);

    // Dots: what a GIS calls proportional symbols. Radius of the smallest and largest dot, the value
    // range they span, how value becomes radius, and opacity. Pure drawing, so nothing is refetched.
    const dotNumber = (label: string, title: string, min: string, step: string): HTMLInputElement =>
      el("input", {
        class: "chart-number chart-dot-number",
        type: "number",
        min,
        step,
        "aria-label": label,
        title,
      }) as HTMLInputElement;
    this.dotMinInput = dotNumber("Smallest dot radius (pixels)", "Radius in pixels of the smallest dot (or of every dot when nothing sizes them)", "0.5", "0.5");
    this.dotMaxInput = dotNumber("Largest dot radius (pixels)", "Radius in pixels of the largest dot", "0.5", "0.5");
    this.dotValueMinInput = dotNumber("Value for the smallest dot", "The value that gets the smallest dot; smaller values are drawn the same size. Leave empty to use the lowest value in the data.", "", "any");
    this.dotValueMaxInput = dotNumber("Value for the largest dot", "The value that gets the largest dot; larger values are drawn the same size. Leave empty to use the highest value in the data.", "", "any");
    this.dotScaleSelect = el("select", {
      class: "chart-picker chart-picker-small",
      "aria-label": "How value becomes dot radius",
      title: "How value becomes radius",
    }) as HTMLSelectElement;
    for (const scale of DOT_SCALES) {
      this.dotScaleSelect.append(el("option", { value: scale.id, title: scale.hint }, [scale.label]) as HTMLOptionElement);
    }
    this.dotOpacityInput = el("input", {
      type: "range",
      min: "10",
      max: "100",
      step: "5",
      class: "chart-dot-opacity",
      "aria-label": "Dot opacity",
      title: "How see-through the dots are: lower shows where dots pile up",
    }) as HTMLInputElement;
    this.dotOpacityOut = el("output", { class: "chart-field-hint" });
    const dotField = (label: string, children: (HTMLElement | string)[], title: string): HTMLElement =>
      el("label", { class: "chart-field", title }, [el("span", { class: "chart-field-label" }, [label]), ...children]);
    this.dotMinLabel = el("span", { class: "chart-field-label" }, ["Radius"]);
    this.dotMaxWrap = el("span", { class: "chart-dot-to" }, ["to ", this.dotMaxInput]);
    const dotRadiusField = el("label", { class: "chart-field", title: "Radius of the dots, in pixels" }, [
      this.dotMinLabel,
      this.dotMinInput,
      this.dotMaxWrap,
      el("span", { class: "chart-field-hint" }, ["px"]),
    ]);
    this.dotValuesWrap = dotField("Values", [this.dotValueMinInput, "to", this.dotValueMaxInput], "The value range the radii span: values outside it get the smallest or largest dot, so one extreme cannot shrink the rest");
    this.dotScaleWrap = dotField("Scale", [this.dotScaleSelect], "How value becomes radius");
    this.mapColorAggSelect = el("select", { class: "chart-picker chart-picker-small", "aria-label": "Colour of a place" }) as HTMLSelectElement;
    for (const [value, label] of [["mean", "Average (mean)"], ["sum", "Sum"], ["min", "Min"], ["max", "Max"]] as const) {
      this.mapColorAggSelect.append(el("option", { value }, [label]) as HTMLOptionElement);
    }
    this.mapColorAggSelect.addEventListener("change", () => {
      this.config.mapColorAgg = this.mapColorAggSelect.value as "sum" | "mean" | "min" | "max";
      this.generation++;
      this.refreshSeries();
      this.refreshAnimation();
      this.render();
    });
    this.mapColorAggWrap = dotField("Colour is the", [this.mapColorAggSelect], "How the rows at a place combine into its colour");
    this.mapColorScaleSelect = el("select", { class: "chart-picker chart-picker-small", "aria-label": "Colour scale" }) as HTMLSelectElement;
    for (const [value, label] of [["linear", "Linear"], ["log", "Logarithmic"]] as const) {
      this.mapColorScaleSelect.append(el("option", { value }, [label]) as HTMLOptionElement);
    }
    this.mapColorScaleSelect.addEventListener("change", () => {
      this.config.mapColorScale = this.mapColorScaleSelect.value as "linear" | "log";
      this.render();
    });
    this.mapColorScaleWrap = dotField("Colour scale", [this.mapColorScaleSelect], "Logarithmic spreads out values with a long tail, such as durations or prices");
    this.mapLabelSelect = el("select", { class: "chart-picker chart-picker-small", "aria-label": "Place label" }) as HTMLSelectElement;
    this.mapLabelSelect.addEventListener("change", () => {
      this.config.mapLabelColumn = Number(this.mapLabelSelect.value);
      this.generation++;
      this.refreshSeries();
      this.refreshAnimation();
      this.render();
    });
    this.mapLabelWrap = dotField("Label", [this.mapLabelSelect], "The column that names a place when you hover its dot");
    this.dotShapeSelect = el("select", { class: "chart-picker chart-picker-small", "aria-label": "Dot shape", title: "The shape of each dot" }) as HTMLSelectElement;
    for (const shape of MARKER_SHAPES) this.dotShapeSelect.append(el("option", { value: shape.id }, [shape.label]) as HTMLOptionElement);
    this.dotShapeWrap = dotField("Shape", [this.dotShapeSelect], "The shape of each dot");
    this.fitLineInput = el("input", { type: "checkbox", "aria-label": "Line of best fit" }) as HTMLInputElement;
    this.fitR2Input = el("input", { type: "checkbox", "aria-label": "Show R squared" }) as HTMLInputElement;
    this.fitWrap = el("div", { class: "chart-field chart-fit" }, [
      el("label", { class: "chart-check", title: "A dashed least-squares line through the points" }, [this.fitLineInput, " Line of best fit"]),
      el("label", { class: "chart-check", title: "How much of the spread in Y the line accounts for (0 to 1). Shown only with the line." }, [this.fitR2Input, " R²"]),
    ]);
    this.dotShapeSelect.addEventListener("change", () => {
      this.config.markerShape = this.dotShapeSelect.value as MarkerShape;
      this.render();
    });
    this.fitLineInput.addEventListener("change", () => {
      this.config.fitLine = this.fitLineInput.checked;
      this.fitR2Input.disabled = !this.fitLineInput.checked;
      this.render();
    });
    this.fitR2Input.addEventListener("change", () => {
      this.config.fitR2 = this.fitR2Input.checked;
      this.render();
    });
    this.dotSettings = el("div", { class: "chart-bubble-settings chart-dot-settings hidden" }, [
      el("span", { class: "chart-animate-title" }, ["Dots"]),
      this.dotShapeWrap,
      dotRadiusField,
      this.dotValuesWrap,
      this.dotScaleWrap,
      this.mapColorAggWrap,
      this.mapColorScaleWrap,
      this.mapLabelWrap,
      dotField("Opacity", [this.dotOpacityInput, this.dotOpacityOut], "How see-through the dots are"),
      this.fitWrap,
    ]);
    this.refRows = el("div", { class: "chart-ref-rows" });
    const addRef = el("button", { class: "ghost small", type: "button", title: "Add a line across the chart at one value" }, ["+ Add a line"]);
    addRef.addEventListener("click", () => {
      const axis = this.refAxisColumn("y") >= 0 || this.hasValueAxis() ? "y" : "x";
      this.config.refLines = [...(this.config.refLines ?? []), { axis, source: "value" }];
      this.refKey = "";
      this.syncRefLines();
      this.render();
    });
    this.refSection = el("div", { class: "chart-bubble-settings chart-ref-settings" }, [
      el("span", { class: "chart-animate-title" }, ["Reference lines"]),
      this.refRows,
      el("div", { class: "chart-field" }, [addRef]),
      el("span", { class: "chart-field-hint chart-ref-hint" }, ["Drawn on charts with a numeric axis. A line is one value: type it, or use the mean of the plotted column (all rows)."]),
    ]);
    const dotNumberValue = (input: HTMLInputElement): number | null => {
      const text = input.value.trim();
      const value = Number(text);
      return text !== "" && Number.isFinite(value) ? value : null;
    };
    this.dotMinInput.addEventListener("input", () => {
      const value = dotNumberValue(this.dotMinInput);
      if (value !== null && value > 0) this.config.dotMinRadius = value;
      this.render();
    });
    this.dotMaxInput.addEventListener("input", () => {
      const value = dotNumberValue(this.dotMaxInput);
      if (value !== null && value > 0) this.config.dotMaxRadius = value;
      this.render();
    });
    this.dotValueMinInput.addEventListener("input", () => {
      this.config.dotValueMin = dotNumberValue(this.dotValueMinInput);
      this.render();
    });
    this.dotValueMaxInput.addEventListener("input", () => {
      this.config.dotValueMax = dotNumberValue(this.dotValueMaxInput);
      this.render();
    });
    this.dotScaleSelect.addEventListener("change", () => {
      this.config.dotScale = this.dotScaleSelect.value as DotScale;
      this.render();
    });
    this.dotOpacityInput.addEventListener("input", () => {
      this.config.dotOpacity = Number(this.dotOpacityInput.value) / 100;
      this.dotOpacityOut.textContent = `${this.dotOpacityInput.value}%`;
      this.render();
    });

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
    this.fillPaletteOptions(false);
    this.paletteSelect.value = this.config.palette ?? DEFAULT_PALETTE;
    this.paletteSelect.addEventListener("change", () => {
      if (this.paletteSelect.value === MORE_PALETTES) {
        // Seven colour maps cover most charts; the whole list opens on request.
        this.fillPaletteOptions(true);
        this.paletteSelect.value = this.rampPaletteName();
        try {
          this.paletteSelect.showPicker?.();
        } catch {
          // Opening the list for the person is a courtesy; a click does the same.
        }
        return;
      }
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
    this.colorCenterInput = el("input", {
      class: "text-input chart-color-bound",
      type: "number",
      step: "any",
      placeholder: "Auto",
      "aria-label": "Colour scale centre",
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
      const center =
        this.colorCenterInput.value.trim() === ""
          ? null
          : parseChartNumber(this.colorCenterInput.value);
      if (min !== null && max !== null && !(max > min)) {
        this.paletteStatus.textContent = "Colour max must be greater than min";
        return;
      }
      this.config.colorMin = min;
      this.config.colorMax = max;
      this.config.colorCenter = center;
      this.paletteStatus.textContent = "";
      this.render();
    };
    this.colorMinInput.addEventListener("change", applyColorDomain);
    this.colorMaxInput.addEventListener("change", applyColorDomain);
    this.colorCenterInput.addEventListener("change", applyColorDomain);
    this.colorDomainRow = el("div", { class: "chart-color-domain" }, [
      el("label", { class: "chart-tag" }, [
        el("span", { class: "chart-tag-label" }, ["Min"]),
        this.colorMinInput,
      ]),
      el("label", { class: "chart-tag" }, [
        el("span", { class: "chart-tag-label" }, ["Max"]),
        this.colorMaxInput,
      ]),
      el("label", { class: "chart-tag", title: "Centre for diverging scales; ignored when outside Min/Max" }, [
        el("span", { class: "chart-tag-label" }, ["Centre"]),
        this.colorCenterInput,
      ]),
    ]);
    this.paletteStatus = el("span", { class: "chart-palette-status" });
    this.paletteGroup = el(
      "div",
      { class: "chart-palette" },
      [
        this.paletteSelect,
        this.palettePreview,
        reverseLabel,
        this.colorDomainRow,
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
      this.options.onTitleChange?.(this);
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
      "aria-label": "Animate over",
      title: "Step this chart through a date column (one frame per period) or a number column (in order, one frame per value or step)",
    }) as HTMLSelectElement;
    this.animationTimeSelect.addEventListener("change", () => {
      const value = Number(this.animationTimeSelect.value);
      this.setAnimationTime(Number.isFinite(value) ? value : -1);
    });
    this.animationGrainSelect = el("select", {
      class: "chart-picker chart-picker-small",
      "aria-label": "Frame length",
      title: "How much each frame covers",
    }) as HTMLSelectElement;
    this.syncFrameOptions();
    this.animationGrainSelect.addEventListener("change", () => {
      const value = this.animationGrainSelect.value;
      if (value === "value") this.config.animationStep = "value";
      else if (value.startsWith("step:")) this.config.animationStep = Number(value.slice(5));
      else this.config.animationGrain = value as TimeGrain;
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
      this.animationStepLabel,
      this.animationGrainSelect,
      el("span", { class: "chart-animate-hint" }, [
        "Playback appears under the chart; export one loop as a GIF.",
      ]),
    ]);

    const settingsClose = el(
      "button",
      {
        class: "icon-btn chart-settings-close",
        type: "button",
        title: "Close settings",
        "aria-label": "Close settings",
      },
      ["×"],
    ) as HTMLButtonElement;
    settingsClose.addEventListener("click", () => {
      if (this.settingsDisclosure !== null) {
        this.settingsDisclosure.open = false;
        this.settingsDisclosure.querySelector<HTMLElement>("summary")?.focus();
      }
    });
    const settingsBody = el("div", { class: "chart-settings-body" }, [
      settingsClose,
      this.colorWrap,
      this.sizeWrap,
      this.modeWrap,
      this.densityStyleWrap,
      this.errorBarRow,
      this.chartFilterRow,
      this.histogramSettings,
      this.barSettings,
      this.correlationSettings,
      lookRow,
    ]);
    this.settingsBody = settingsBody;
    this.sidebar.append(
      el("div", { class: "chart-side-section chart-side-settings" }, [
        el("div", { class: "chart-side-title" }, ["Colour, filter and format"]),
        settingsBody,
      ]),
    );

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
    const mapControls = el("div", { class: "chart-map-controls hidden" });
    const mapZoomIn = el(
      "button",
      {
        class: "chart-map-control",
        type: "button",
        title: "Zoom in",
        "aria-label": "Zoom the map in",
      },
      ["+"],
    ) as HTMLButtonElement;
    mapZoomIn.addEventListener("click", () => this.zoomMap(0.8));
    const mapZoomOut = el(
      "button",
      {
        class: "chart-map-control",
        type: "button",
        title: "Zoom out",
        "aria-label": "Zoom the map out",
      },
      ["−"],
    ) as HTMLButtonElement;
    mapZoomOut.addEventListener("click", () => this.zoomMap(1.25));
    const mapFit = el(
      "button",
      {
        class: "chart-map-control chart-map-fit",
        type: "button",
        title: "Fit the map to what is plotted and your markers",
        "aria-label": "Fit the map to what is plotted and your markers",
      },
      ["Fit all"],
    ) as HTMLButtonElement;
    mapFit.addEventListener("click", () => this.resetMapZoom());
    mapControls.append(mapZoomIn, mapZoomOut, mapFit);
    this.mapControls = mapControls;
    canvasWrap.append(this.resetViewButton, mapControls);
    this.canvasWrap = canvasWrap;
    this.regions?.attachDrop(canvasWrap);
    this.summaryEl = el("div", { class: "chart-summary" });
    this.dataIssueEl = el("div", { class: "chart-data-issues hidden" });
    this.scopeEl = el("div", { class: "chart-scope" });
    this.noteEl = el("div", { class: "chart-note" });
    this.deepDiveEl = el("div", { class: "chart-deep-dive hidden" });
    this.legendEl = el("div", { class: "chart-legend hidden" });
    this.exclusionBar = el("div", { class: "chart-exclusions hidden", "aria-label": "Left out of this chart" });
    this.tooltipEl = el("div", { class: "chart-tooltip hidden", role: "tooltip" });
    this.canvas.addEventListener("pointermove", (event) =>
      this.queuePointer(event as PointerEvent),
    );
    this.canvas.addEventListener("pointerleave", () => this.hideTooltip());
    this.canvas.addEventListener("click", (event) => this.handleCanvasClick(event));
    this.canvas.addEventListener("contextmenu", (event) => this.handleCanvasContextMenu(event));
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

    this.root.append(head);
    // How the numbers are rolled up (Sum, Max, ...) and over which period stay on
    // the card, not in the Customize drawer; each wrap hides itself when unused.
    const quickRow = el("div", { class: "chart-quick", role: "group", "aria-label": "Aggregation" }, [
      this.valueAggWrap,
      this.valueGrainWrap,
      this.valueEveryWrap,
      this.valueFillWrap,
      this.weekStartWrap,
      this.fiscalWrap,
    ]);
    const main = el("div", { class: "chart-card-main" }, [
      quickRow,
      this.summaryEl,
      this.lintEl,
      this.dataIssueEl,
      this.scopeEl,
      this.animationSetup,
      this.bubbleSettings,
      this.dotSettings,
      this.exclusionBar,
      // Above the plot: naming the lines must never take a scroll.
      this.legendEl,
      canvasWrap,
      this.animationBar,
      this.deepDiveEl,
      this.noteEl,
    ]);
    this.layoutEl = el("div", { class: "chart-card-layout" }, this.options.docked === true ? [main, this.sidebar] : [this.sidebar, main]);

    this.root.append(this.layoutEl, this.tooltipEl);
    if (this.options.docked === true) this.dock(head, quickRow, sideHead, canvasWrap);

    this.syncSwatches();
    this.syncOptions();
    this.renderControls();
    // Skip the first paint while the lens is hidden: a 1x1 canvas would flash
    // before the ResizeObserver paints the real size.
    if ((this.canvas.parentElement?.clientWidth ?? 0) > 1) this.render();
    window.addEventListener("resize", this.onResize);
    window.addEventListener("themechange", this.onThemeChange);
  }

  /**
   * The settings panel in three parts. What every chart needs stays in view: its type, its fields
   * and how they are added up. Refine (calculations, missing periods, top N, a chart's own filter,
   * reference lines) and Format (titles and colours) are one click away and stay as the person
   * left them, on every chart.
   */
  private groupSettings(): void {
    const group = (key: SettingsGroup, title: string, hint: string, children: (Element | null)[]): HTMLDetailsElement => {
      const details = el("details", { class: "chart-side-group", "data-group": key }) as HTMLDetailsElement;
      details.append(
        el("summary", { class: "chart-side-group-title" }, [
          el("span", { class: "chart-side-group-name" }, [title]),
          el("span", { class: "chart-side-group-hint" }, [hint]),
        ]),
        ...children.filter((child): child is Element => child !== null),
      );
      details.open = readGroupOpen(key);
      details.addEventListener("toggle", () => writeGroupOpen(key, details.open));
      this.settingsGroups.push(details);
      return details;
    };
    const settings = this.sidebar.querySelector(".chart-side-settings");
    settings?.querySelector(".chart-side-title")?.remove();
    const refine = group("refine", "Refine", "calculations, top N, filter, reference lines", [
      el("div", { class: "chart-side-section" }, [
        this.valueCalcWrap,
        this.valueEveryWrap,
        this.valueFillWrap,
        this.weekStartWrap,
        this.fiscalWrap,
      ]),
      el("div", { class: "chart-side-section chart-side-refine" }, [
        this.barSettings,
        this.histogramSettings,
        this.chartFilterRow,
        this.errorBarRow,
        this.correlationSettings,
      ]),
      this.sidebar.querySelector(".chart-side-map"),
      this.sidebar.querySelector(".chart-side-ref"),
    ]);
    const format = group("format", "Format", "titles and colours", [settings]);
    this.sidebar.append(refine, format);
  }

  private readonly dataDrawer = new ChartDataDrawer(() => this.dataDrawerRows());

  /** The chart's numbers as a table: a chart split into series reads across, one column per series. */
  private dataDrawerRows(): string[][] {
    const aggregate = this.usesAggregate() && this.config.kind !== "pivotHeatmap" ? this.aggregateResult() : null;
    if (aggregate === null || aggregate.dimensions.length !== 2 || aggregate.groupCount === 0) return this.chartCsvRows();
    const [axis, series] = aggregate.dimensions as [string[], string[]];
    const values = aggregate.measures[0] ?? new Float64Array(0);
    const columns = [...new Set(series)];
    const columnAt = new Map(columns.map((label, index) => [label, index]));
    const rowAt = new Map<string, string[]>();
    for (let i = 0; i < aggregate.groupCount; i++) {
      const label = axis[i] ?? "";
      let row = rowAt.get(label);
      if (row === undefined) {
        row = [label, ...columns.map(() => "")];
        rowAt.set(label, row);
      }
      const value = values[i];
      if (value !== undefined && Number.isFinite(value)) row[1 + (columnAt.get(series[i] ?? "") ?? 0)] = String(value);
    }
    return [[aggregate.dimensionNames[0] ?? "", ...columns], ...rowAt.values()];
  }

  /** The Refine and Format sections of this card, to bring in step with the other charts' when its tab opens. */
  private readonly settingsGroups: HTMLDetailsElement[] = [];

  /**
   * The Chart page's arrangement of the same controls: one headline above the plot, and every
   * setting in one panel beside it, so the plot is never covered while it is being changed.
   */
  private dock(head: HTMLElement, quickRow: HTMLElement, sideHead: HTMLElement, canvasWrap: HTMLElement): void {
    this.root.classList.add("chart-card-docked");
    this.layoutEl.classList.add("docked");
    sideHead.remove();
    this.sourceChip.addEventListener("click", () => {
      if (this.config.source !== "") this.options.onOpenSource?.(this.config.source);
    });
    head.prepend(el("div", { class: "chart-headline" }, [this.summaryEl, this.scopeEl, this.sourceChip]));
    this.undoButton = el(
      "button",
      { class: "ghost small chart-undo-btn", type: "button", title: "Undo the last change to this chart (Ctrl+Z)", "aria-label": "Undo the last change to this chart", disabled: "disabled" },
      ["Undo"],
    ) as HTMLButtonElement;
    this.undoButton.addEventListener("click", () => this.undo());
    head.insertBefore(this.undoButton, this.focusButton);
    head.append(this.sidebarToggle);

    // The one chart-type control: a button naming the type, opening the pictures.
    this.kindSelect.hidden = true;
    this.kindButton = el("button", { class: "chart-kind-button", type: "button", "aria-haspopup": "dialog", "aria-label": "Chart type" }) as HTMLButtonElement;
    this.kindButton.addEventListener("click", () => this.openKindPicker());
    this.kindSelect.after(this.kindButton);
    this.syncKindButton();

    // Rolled-up values, map layers and dot sizing join the rest of the settings.
    const valueSection = this.valueWrap.parentElement;
    if (valueSection !== null) valueSection.after(el("div", { class: "chart-side-section" }, [quickRow]));
    const colours = this.sidebar.querySelector(".chart-side-settings");
    this.sidebar.insertBefore(el("div", { class: "chart-side-section chart-side-map" }, [this.bubbleSettings, this.dotSettings]), colours);
    this.sidebar.insertBefore(el("div", { class: "chart-side-section chart-side-ref" }, [this.refSection]), colours);
    if (this.options.sectionedSettings === true) {
      this.groupSettings();
      this.noteEl.after(this.dataDrawer.root);
    }

    this.selectionBar = el("div", { class: "chart-selection hidden", role: "group", "aria-label": "Selected in the chart" });
    canvasWrap.append(this.selectionBar);

    for (const type of ["pointerdown", "focusin"] as const) {
      this.root.addEventListener(type, () => this.noteBeforeChange(), true);
    }
    this.root.addEventListener("keydown", (event) => {
      const target = event.target as HTMLElement;
      if (!(target instanceof HTMLInputElement && (target.type === "text" || target.type === "number"))) this.noteBeforeChange();
    }, true);
    for (const type of ["change", "click"] as const) {
      this.root.addEventListener(type, () => this.noteAfterChange());
    }
    this.setSettingsOpen(this.options.settingsOpen ?? true);
  }

  /** The settings as they stand, before whatever the person is about to do. */
  private noteBeforeChange(): void {
    this.undoBefore = JSON.stringify(this.getConfig());
  }

  /** Handlers run first, so a real change shows here as a difference from the note above. */
  private noteAfterChange(): void {
    if (this.undoBefore === null) return;
    const now = JSON.stringify(this.getConfig());
    if (now === this.undoBefore) return;
    this.undoStack.push(this.undoBefore);
    if (this.undoStack.length > 50) this.undoStack.shift();
    this.undoBefore = now;
    this.syncUndo();
  }

  private syncUndo(): void {
    if (this.undoButton !== null) this.undoButton.disabled = this.undoStack.length === 0;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  /** Puts the chart back as it was before its last change. */
  undo(): void {
    const previous = this.undoStack.pop();
    if (previous === undefined) return;
    this.config = chartConfigWithDefaults(JSON.parse(previous) as Partial<ChartCardConfig>);
    this.undoBefore = previous;
    this.hiddenGroups.clear();
    this.plotView = null;
    this.mapView = null;
    this.chartXZoom = null;
    this.barWindow = null;
    this.clearSelection();
    this.pickerSignature = "";
    this.titleInput.value = this.config.title;
    this.setColumns(this.columns);
    this.refreshForConfig();
    this.syncUndo();
    this.options.onTitleChange?.(this);
  }

  private syncKindButton(): void {
    const button = this.kindButton;
    if (button === null) return;
    const kind = this.config.kind;
    button.replaceChildren(kindIcon(kind), el("span", {}, [CHART_KIND_LABELS[kind]]), el("span", { class: "chart-kind-caret", "aria-hidden": "true" }, ["▾"]));
    button.classList.toggle("hidden", this.config.source !== "");
  }

  /** Every chart type as a picture, grouped by the question it answers; ones the data cannot draw say why. */
  private openKindPicker(): void {
    const anchor = this.kindButton;
    if (anchor === null) return;
    // Bar is one choice: the chart keeps the bar kind it has, or takes the one these columns can make.
    const current = this.config.kind;
    const barKind = current === "bar" || current === "barplot" ? current : barKindFor(this.columns, this.rowCount);
    const common = { question: "Most used", kinds: COMMON_KINDS.map((kind) => (kind === "barplot" ? barKind : kind)) };
    const groups = [common, ...MORE_GROUPS].map((group) =>
      el("div", { class: "chart-kind-group" }, [
        el("div", { class: "chart-kind-question" }, [group.question]),
        el("div", { class: "chart-kind-options" }, group.kinds.map((kind) => {
          const fit = fitChartKind(kind, this.columns, this.rowCount);
          const option = el(
            "button",
            {
              class: `chart-kind-option${kind === this.config.kind ? " active" : ""}`,
              type: "button",
              title: fit.ok ? `${CHART_KIND_LABELS[kind]}: ${group.question.replace(/\?$/, "").toLowerCase()}` : `${CHART_KIND_LABELS[kind]}: ${fit.reason}`,
              ...(fit.ok || kind === this.config.kind ? {} : { disabled: "disabled" }),
            },
            [kindIcon(kind), el("span", {}, [CHART_KIND_LABELS[kind]])],
          );
          option.addEventListener("click", () => {
            close();
            this.noteBeforeChange();
            this.setKind(kind);
            this.kindSelect.value = kind;
            this.noteAfterChange();
            anchor.focus();
          });
          return option;
        })),
      ]),
    );
    const pop = el("div", { class: "chart-kind-pop", role: "dialog", "aria-label": "Chart type" }, groups);
    const close = (): void => {
      pop.remove();
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("keydown", onKey, true);
    };
    const outside = (event: Event): void => {
      if (!pop.contains(event.target as Node)) close();
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      close();
      anchor.focus();
    };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", onKey, true);
    document.body.append(pop);
    const rect = anchor.getBoundingClientRect();
    pop.style.top = `${Math.max(8, Math.min(rect.top, window.innerHeight - pop.offsetHeight - 8))}px`;
    pop.style.right = `${Math.max(8, window.innerWidth - rect.right)}px`;
    pop.querySelector<HTMLElement>(".chart-kind-option.active, .chart-kind-option:not([disabled])")?.focus();
  }

  /** The places a chart of this type has for a field, each one a setting already on the panel. */
  private fieldControls(): { label: string; select: HTMLSelectElement; wrap: HTMLElement }[] {
    const pairs: [HTMLElement, HTMLSelectElement][] = [
      [this.primaryWrap, this.primarySelect],
      [this.xWrap, this.xSelect],
      [this.yWrap, this.ySelect],
      [this.valueWrap, this.valueSelect],
      [this.groupWrap, this.groupSelect],
      [this.colorWrap, this.colorSelect],
      [this.sizeWrap, this.sizeSelect],
    ];
    if (this.config.source !== "") return [];
    return pairs
      .filter(([wrap, select]) => !wrap.classList.contains("hidden") && !select.disabled)
      .map(([wrap, select]) => ({ wrap, select, label: wrap.querySelector(".chart-tag-label")?.textContent ?? "" }));
  }

  /** The columns this chart plots, for the field list to mark. */
  usedFields(): Set<number> {
    const used = new Set<number>(this.extraValues());
    for (const { select } of this.fieldControls()) {
      const index = Number(select.value);
      if (index >= 0) used.add(index);
    }
    return used;
  }

  /** What each plotted column is on this chart ("Value", "Group by"), for the field list to say. */
  fieldRoles(): Map<number, string> {
    const roles = new Map<number, string>();
    for (const { label, select } of this.fieldControls()) {
      const index = Number(select.value);
      if (index >= 0 && !roles.has(index)) roles.set(index, label);
    }
    for (const extra of this.extraValues()) if (!roles.has(extra)) roles.set(extra, "Value");
    return roles;
  }

  /** Where this column can go on this chart. `empty`: the place has no field yet, so taking it replaces nothing. */
  fieldSlots(column: number): { label: string; active: boolean; clearable: boolean; empty: boolean; toggle(): void }[] {
    const value = String(column);
    const out: { label: string; active: boolean; clearable: boolean; empty: boolean; toggle(): void }[] = [];
    for (const { label, select } of this.fieldControls()) {
      const option = [...select.options].find((candidate) => candidate.value === value);
      if (option === undefined || option.disabled) continue;
      // Offer the places a field suits: a list's "Other" group and a Value of text are there for the rare case, in the panel.
      if ((option.parentElement as HTMLOptGroupElement | null)?.label === "Other") continue;
      if (select === this.valueSelect && !isNumericType(this.meta(column)?.type ?? "string")) continue;
      const clearable = [...select.options].some((candidate) => candidate.value === "-1");
      out.push({
        label,
        active: select.value === value,
        clearable,
        empty: Number(select.value) < 0,
        toggle: () => {
          this.noteBeforeChange();
          select.value = select.value === value ? "-1" : value;
          const view = select.ownerDocument.defaultView as (Window & typeof globalThis) | null;
          select.dispatchEvent(new (view?.Event ?? Event)("change", { bubbles: true }));
        },
      });
    }
    if (this.allowsExtraValues() && column !== this.config.valueColumn && isNumericType(this.meta(column)?.type ?? "string")) {
      const active = this.extraValues().includes(column);
      if (active || this.extraValues().length < MAX_VALUES - 1) {
        out.push({ label: "Another value", active, clearable: true, empty: true, toggle: () => this.toggleExtraValue(column) });
      }
    }
    return out;
  }

  /** Opens or closes the docked settings panel; the chart takes the room it leaves. */
  setSettingsOpen(open: boolean): void {
    if (this.options.docked !== true) return;
    this.sidebarShown = open;
    this.layoutEl.classList.toggle("sidebar-open", open);
    this.layoutEl.classList.toggle("sidebar-collapsed", !open);
    this.sidebarToggle.setAttribute("aria-expanded", String(open));
    this.sidebarToggle.textContent = open ? "Hide settings" : "Customize";
    this.sidebarToggle.setAttribute("aria-label", open ? "Hide the chart settings" : "Customize this chart");
    this.sidebarToggle.title = open ? "Give the chart the whole width" : "Show every setting beside the chart";
  }

  /** The bar, bin or cell the person clicked: marked on the plot, with what can be done with it. */
  private selectRegion(region: HitRegion): void {
    const same = this.selectedRegion?.lines[0] === region.lines[0];
    this.clearSelection();
    this.hideTooltip();
    if (same) {
      this.render();
      return;
    }
    this.selectedRegion = region;
    const bar = this.selectionBar;
    if (bar !== null) {
      const name = region.lines[0] ?? "Selection";
      const filter = el("button", { class: "primary small", type: "button", title: `Filter every page to ${name}` }, ["Filter to this"]);
      filter.addEventListener("click", () => {
        const actions = region.actions;
        this.clearSelection();
        for (const action of actions) this.applyHitAction(action);
      });
      const rows = tableFiltersForHitActions(region.actions);
      const show = el("button", { class: "ghost small", type: "button", title: `Open the Table on the rows behind ${name}` }, ["Show rows"]);
      show.addEventListener("click", () => {
        this.clearSelection();
        this.render();
        this.options.onShowRows?.(rows, name);
      });
      const dismiss = el("button", { class: "icon-btn", type: "button", title: "Clear the selection", "aria-label": "Clear the selection" }, ["×"]);
      dismiss.addEventListener("click", () => {
        this.clearSelection();
        this.render();
      });
      bar.replaceChildren(el("span", { class: "chart-selection-name", title: name }, [name]), filter, ...(this.options.onShowRows === undefined || rows.length === 0 ? [] : [show]), dismiss);
      bar.classList.remove("hidden");
    }
    this.render();
  }

  private clearSelection(): void {
    this.selectedRegion = null;
    this.selectionBar?.classList.add("hidden");
    this.selectionBar?.replaceChildren();
  }

  /** Marks the selected region; if the chart no longer has it (the data changed), the selection ends. */
  private drawSelection(ctx: CanvasRenderingContext2D): void {
    const selected = this.selectedRegion;
    if (selected === null) return;
    const region = this.hitRegions.find((candidate) => candidate.lines[0] === selected.lines[0]);
    if (region === undefined) {
      this.clearSelection();
      return;
    }
    ctx.save();
    ctx.fillStyle = this.primaryColor();
    ctx.globalAlpha = 0.14;
    ctx.fillRect(region.x, region.y, region.w, region.h);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = cssVar("--accent", "#2563eb");
    ctx.lineWidth = 2;
    ctx.strokeRect(region.x + 1, region.y + 1, Math.max(0, region.w - 2), Math.max(0, region.h - 2));
    ctx.restore();
  }

  /**
   * Settings live in a drawer that overlays the card, closed by default so the
   * chart keeps the full width. Escape closes it and returns focus to Customize.
   */
  /** Escape closes an open drawer wherever focus is (the chart itself cannot hold focus). */
  private readonly onDrawerEscape = (event: KeyboardEvent): void => {
    if (event.key !== "Escape" || !this.sidebarShown || event.defaultPrevented) return;
    this.toggleSidebar();
    this.sidebarToggle.focus();
  };

  private toggleSidebar(): void {
    if (this.options.docked === true) {
      const open = !this.sidebarShown;
      this.setSettingsOpen(open);
      this.options.onSettingsToggle?.(open);
      requestAnimationFrame(() => this.render());
      return;
    }
    this.sidebarShown = !this.sidebarShown;
    if (this.sidebarShown) document.addEventListener("keydown", this.onDrawerEscape);
    else document.removeEventListener("keydown", this.onDrawerEscape);
    this.layoutEl.classList.toggle("sidebar-open", this.sidebarShown);
    this.layoutEl.classList.toggle("sidebar-collapsed", !this.sidebarShown);
    this.sidebarToggle.setAttribute("aria-expanded", String(this.sidebarShown));
    this.sidebarToggle.textContent = this.sidebarShown ? "Done" : "Customize";
    this.sidebarToggle.setAttribute("aria-label", this.sidebarShown ? "Close the chart settings" : "Customize this chart");
    this.sidebarToggle.title = this.sidebarShown ? "Close the settings drawer (Escape)" : "Open the settings drawer: type, fields, colours";
    // The canvas width changes, so redraw at the new size.
    requestAnimationFrame(() => this.render());
  }

  /** One open Settings popover at a time; outside click or Escape dismisses it. */
  private syncSettingsOpen(): void {
    const settings = this.settingsDisclosure;
    if (settings === null) return;
    if (settings.open) {
      if (openSettingsDisclosure !== null && openSettingsDisclosure !== settings) {
        openSettingsDisclosure.open = false;
      }
      openSettingsDisclosure = settings;
      this.bindSettingsDismiss(settings);
    } else {
      if (openSettingsDisclosure === settings) openSettingsDisclosure = null;
      this.unbindSettingsDismiss();
    }
  }

  private bindSettingsDismiss(settings: HTMLDetailsElement): void {
    this.unbindSettingsDismiss();
    const onDocumentClick = (event: Event): void => {
      if (!settings.open) return;
      const target = event.target as { closest?: (selector: string) => unknown } | null;
      if (
        target !== null &&
        typeof target.closest === "function" &&
        target.closest(".chart-settings-disclosure") === settings
      ) {
        return;
      }
      settings.open = false;
    };
    const onKeydown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape" || !settings.open) return;
      settings.open = false;
      settings.querySelector<HTMLElement>("summary")?.focus();
    };
    document.addEventListener("click", onDocumentClick);
    document.addEventListener("keydown", onKeydown);
    this.settingsDismiss = () => {
      document.removeEventListener("click", onDocumentClick);
      document.removeEventListener("keydown", onKeydown);
    };
  }

  private unbindSettingsDismiss(): void {
    this.settingsDismiss?.();
    this.settingsDismiss = null;
  }

  dispose(): void {
    this.disposed = true;
    this.dataDrawer.dispose();
    document.removeEventListener("keydown", this.onDrawerEscape);
    if (openSettingsDisclosure === this.settingsDisclosure) openSettingsDisclosure = null;
    this.unbindSettingsDismiss();
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
    const kept = sanitizeExclusions(this.config.excludes, columns.length);
    this.config.excludes = kept.length > 0 ? kept : undefined;
    this.plotView = null;
    this.mapView = null;
    this.chartXZoom = null;
    this.barWindow = null;
    this.generation++;
    this.pickerSignature = "";
    this.syncOptions();
    this.syncPlaceholder();
    this.syncSourceControls();
    this.regions?.syncColumns();
    this.regions?.refresh();
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

  /**
   * Apply a full config through the same normalisation/refresh path as a
   * column change. Edit and reset both use this instead of ad-hoc setters.
   */
  applyConfig(config: Partial<ChartCardConfig>): void {
    this.config = chartConfigWithDefaults({ ...this.config, ...config });
    this.hiddenGroups.clear();
    this.setColumns(this.columns);
  }
  /** The sources a card can bind to (the table plus each saved view). */
  setSources(sources: ChartSource[]): void {
    this.sources = sources;
    this.renderSourceOptions();
    this.syncSourceControls();
    this.syncScope();
    if (
      this.config.source !== "" &&
      sources.some((source) => source.id === this.config.source)
    ) {
      this.generation++;
      this.refreshView();
    }
  }

  private renderSourceOptions(): void {
    const current = this.config.source;
    this.sourceSelect.replaceChildren();
    const tableGroup = el("optgroup", { label: "Table data" });
    tableGroup.append(
      el("option", { value: "" }, [sourceOption("table", this.options.tableSourceLabel?.() ?? "Table (filtered)")]) as HTMLOptionElement,
    );
    this.sourceSelect.append(tableGroup);
    const pivots = this.sources.filter((source) => source.kind === "pivot");
    const views = this.sources.filter((source) => source.kind !== "pivot");
    if (pivots.length > 0) {
      const group = el("optgroup", { label: "Pivot views" });
      for (const source of pivots) {
        group.append(el("option", { value: source.id }, [sourceOption("view", source.name)]) as HTMLOptionElement);
      }
      this.sourceSelect.append(group);
    }
    if (views.length > 0) {
      const group = el("optgroup", { label: "Saved views" });
      for (const source of views) {
        group.append(el("option", { value: source.id }, [sourceOption("view", source.name)]) as HTMLOptionElement);
      }
      this.sourceSelect.append(group);
    }
    if (
      current !== "" &&
      this.sources.length > 0 &&
      !this.sources.some((source) => source.id === current)
    ) {
      this.config.source = "";
    }
    if (current !== "" && this.sources.length === 0) {
      // Views arrive after the card on a restore; keep the select from reading blank.
      this.sourceSelect.append(
        el("option", { value: current }, [sourceOption("view", this.config.title || "View")]) as HTMLOptionElement,
      );
    }
    this.sourceSelect.value = this.config.source;
  }

  /** A view-bound card hides the raw-column pickers; its type comes from the view. */
  syncSourceControls(): void {
    const bound = this.config.source !== "";
    const kind = this.config.kind;
    this.kindSelect.classList.toggle("hidden", bound);
    // A pivot with a Columns field can also be a heatmap, so its chart gets a choice; a plain view says what it is.
    const choice = bound && this.isPivotSource();
    this.kindStatic.classList.toggle("hidden", !bound || choice);
    this.viewKindSelect.classList.toggle("hidden", !choice);
    this.backToSource.classList.toggle("hidden", !bound || this.options.onOpenSource === undefined);
    const origin = bound ? this.sources.find((entry) => entry.id === this.config.source) : undefined;
    this.sourceChip.classList.toggle("hidden", origin === undefined || this.options.onOpenSource === undefined);
    if (origin !== undefined) this.sourceChip.textContent = `${origin.kind === "pivot" ? "Pivot" : "View"}: ${origin.name} \u2197`;
    this.syncViewShapeOptions();
    this.syncFieldVisibility();
    this.settingsBody.classList.toggle("hidden", bound ? false : !this.canDraw());
    const pivotMode = kind === "pivotHeatmap" && this.isPivotSource();
    this.pivotRowWrap.classList.toggle("hidden", !pivotMode);
    this.pivotColWrap.classList.toggle("hidden", !pivotMode);
    this.pivotMeasureWrap.classList.toggle("hidden", !pivotMode);
  }

  /**
   * Which field and aggregate pickers this chart shows: the one place that decides, for every
   * chart type and for charts of a Pivot View (which hide the raw-column pickers). Everything
   * that changes the type, the source, the value or the columns calls this.
   */
  syncFieldVisibility(): void {
    const bound = this.config.source !== "";
    const kind = this.config.kind;
    const pair = isPairKind(kind);
    const groupable = this.columns.some((meta) => isGroupable(meta));
    const measureKinds = VALUE_AGGREGATE_KINDS.includes(kind) || kind === "treemap";
    const grainKinds =
      kind === "line" ||
      kind === "smallmultiples" ||
      ((kind === "kpi" || kind === "slopegraph" || kind === "waterfall") &&
        this.isDateLike(this.meta(this.config.column)));
    const valueOn =
      measureKinds && this.config.source === "" && (this.config.valueColumn ?? -1) >= 0;
    const kpiPrimaryHidden =
      kind === "kpi" && !this.columns.some((meta) => this.isDateLike(meta));
    const groupedValue =
      valueOn && SPLIT_KINDS.includes(kind);
    this.primaryWrap.classList.toggle(
      "hidden",
      bound || pair || kind === "correlation" || kpiPrimaryHidden,
    );
    this.groupWrap.classList.toggle(
      "hidden",
      bound ||
      (!SPLIT_KINDS.includes(kind) && kind !== "histogram" && kind !== "bubble") ||
        !groupable ||
        (valueOn && !groupedValue),
    );
    this.valueWrap.classList.toggle("hidden", bound || !measureKinds);
    this.valueAggWrap.classList.toggle("hidden", bound || !measureKinds || !valueOn);
    this.valueGrainWrap.classList.toggle("hidden", bound || !grainKinds || !valueOn);
    this.valueEveryWrap.classList.toggle("hidden", bound || !grainKinds || !valueOn || !this.hasExplicitGrain());
    this.valueFillWrap.classList.toggle("hidden", bound || !grainKinds || !valueOn);
    this.weekStartWrap.classList.toggle("hidden", bound || !grainKinds || !valueOn || this.resolvedGrain() !== "week");
    this.fiscalWrap.classList.toggle("hidden", bound || !grainKinds || !valueOn || (this.resolvedGrain() !== "quarter" && this.resolvedGrain() !== "year"));
    this.valueCalcWrap.classList.toggle("hidden", bound || !valueOn || kind === "treemap");
    this.syncExtraValues();
    // Regions matched by name need no coordinates, so a map of them hides X and Y too.
    const noAxes = bound || !pair || (this.regionsOn() && this.regions?.usesCoordinates !== true);
    this.xWrap.classList.toggle("hidden", noAxes);
    this.yWrap.classList.toggle("hidden", noAxes);
    this.axesPanel.classList.toggle("hidden", bound || kind === "correlation");
  }

  /** Fetches the bound aggregate or pivot result (generation-guarded). */
  refreshView(): void {
    if (this.config.source === "") {
      this.viewResult = null;
      this.pivotResult = null;
      this.render();
      return;
    }
    const source = this.config.source;
    const generation = ++this.viewGeneration;
    if (this.config.kind === "pivotHeatmap") {
      const pivotSource =
        this.sources.find((entry) => entry.id === source)?.kind === "pivot";
      if (!pivotSource || this.options.requestViewPivot === undefined) {
        this.pivotResult = null;
        this.render();
        return;
      }
      void this.options
        .requestViewPivot(source)
        .then((message) => {
          if (generation !== this.viewGeneration || this.disposed || this.config.source !== source) return;
          this.pivotResult = message;
          this.syncPivotOptions();
          this.render();
        })
        .catch(() => {
          this.pivotResult = null;
          this.render();
        });
      return;
    }
    if (this.options.requestViewAggregate === undefined) {
      this.viewResult = null;
      this.render();
      return;
    }
    void this.options
      .requestViewAggregate(source, this.viewShape() ?? undefined)
      .then((message) => {
        if (generation !== this.viewGeneration || this.disposed || this.config.source !== source) return;
        this.viewResult = message;
        this.syncSummary();
        this.render();
      })
      .catch(() => {
        // Keep the last result as the fallback.
      });
  }

  /** Whether this chart can draw more than one value: a line or bars of the table, not already split by a field. */
  private allowsExtraValues(): boolean {
    const kind = this.config.kind;
    const agg = this.config.valueAgg ?? "mean";
    return (
      this.config.source === "" &&
      (kind === "line" || kind === "barplot") &&
      (this.config.valueColumn ?? -1) >= 0 &&
      this.config.groupColumn < 0 &&
      agg !== "true" && agg !== "false" && agg !== "missing" && agg !== "truePct"
    );
  }

  /** The extra value columns in use: only where the chart can draw them, and only numbers still in the table. */
  private extraValues(): number[] {
    if (!this.allowsExtraValues()) return [];
    return (this.config.extraValueColumns ?? []).filter(
      (column, index, all) =>
        column !== this.config.valueColumn &&
        all.indexOf(column) === index &&
        isNumericType(this.meta(column)?.type ?? "string"),
    );
  }

  /** Adds or removes a column as another value; a chart with several values is not also split by a field. */
  private toggleExtraValue(column: number): void {
    const current = this.config.extraValueColumns ?? [];
    this.noteBeforeChange();
    this.config.extraValueColumns = current.includes(column)
      ? current.filter((other) => other !== column)
      : [...current, column].slice(0, MAX_VALUES - 1);
    this.hiddenSplit.clear();
    this.generation++;
    this.renderControls();
    this.refreshValue();
    this.render();
    this.noteAfterChange();
  }

  /** The values drawn beside Value, each with a remove button, and a list to add another. */
  private syncExtraValues(): void {
    const allowed = this.allowsExtraValues();
    const extras = this.extraValues();
    const numeric = this.columns
      .map((meta, index) => ({ meta, index }))
      .filter(({ meta, index }) => isNumericType(meta.type) && meta.role !== "provenance" && index !== this.config.valueColumn && !extras.includes(index));
    const key = `${allowed}|${extras.join(",")}|${numeric.map(({ index }) => index).join(",")}`;
    this.extraValuesWrap.classList.toggle("hidden", !allowed || (extras.length === 0 && numeric.length === 0));
    if (key === this.extraValuesKey) return;
    this.extraValuesKey = key;
    const rows = extras.map((column) => {
      const name = this.meta(column)?.name ?? "value";
      const remove = el("button", { class: "icon-btn chart-extra-remove", type: "button", title: `Stop drawing ${name}`, "aria-label": `Remove ${name}` }, ["\u00d7"]);
      remove.addEventListener("click", () => this.toggleExtraValue(column));
      return el("div", { class: "chart-extra-value" }, [el("span", { class: "chart-extra-name" }, [name]), remove]);
    });
    const add = el("select", { class: "chart-picker chart-picker-small chart-extra-add", "aria-label": "Add another value" }) as HTMLSelectElement;
    add.append(el("option", { value: "" }, ["+ Add another value\u2026"]) as HTMLOptionElement);
    for (const { meta, index } of numeric) add.append(el("option", { value: String(index) }, [meta.name]) as HTMLOptionElement);
    add.disabled = extras.length >= MAX_VALUES - 1 || numeric.length === 0;
    add.addEventListener("change", () => {
      if (add.value !== "") this.toggleExtraValue(Number(add.value));
    });
    this.extraValuesWrap.replaceChildren(...rows, add);
  }

  /** Puts a pivot field on the axis, as the series, or as the value. */
  private setViewShape(key: "viewAxis" | "viewSeries" | "viewMeasure", value: number): void {
    this.noteBeforeChange();
    // Fields the chart had not fixed yet stay as the pivot lays them out.
    const shape = this.viewShape();
    if (shape !== null) {
      this.config.viewAxis ??= shape.axis;
      this.config.viewSeries ??= shape.series;
      this.config.viewMeasure ??= shape.measure;
    }
    this.config[key] = value;
    // The axis cannot also be the series: taking a field for one frees the other.
    if (key === "viewAxis" && this.config.viewSeries === this.config.viewAxis) this.config.viewSeries = -1;
    this.hiddenSplit.clear();
    this.syncViewShapeOptions();
    this.renderControls();
    this.refreshView();
  }

  /**
   * The fields of the pivot this chart draws, for the field list to show in place of the table's
   * columns: what each is on the chart, and the places it could go. Null for a chart of the table.
   */
  pivotRailItems(): {
    name: string;
    glyph: string;
    role: string;
    slots: { label: string; active: boolean; clearable: boolean; empty: boolean; toggle(): void }[];
  }[] | null {
    const fields = this.viewFields();
    const shape = this.viewShape();
    if (fields === null || shape === null) return null;
    const live = this.config.kind !== "pivotHeatmap";
    const dimensions = fields.dimensions.map((field, index) => {
      const slots: { label: string; active: boolean; clearable: boolean; empty: boolean; toggle(): void }[] = [];
      if (live) {
        slots.push({ label: "Axis", active: shape.axis === index, clearable: false, empty: false, toggle: () => this.setViewShape("viewAxis", index) });
        // The axis field cannot also split the series, so it offers the axis only.
        if (shape.axis !== index) {
          slots.push({
            label: "Series",
            active: shape.series === index,
            clearable: true,
            empty: shape.series < 0,
            toggle: () => this.setViewShape("viewSeries", shape.series === index ? -1 : index),
          });
        }
      }
      const role = shape.axis === index ? "Axis" : shape.series === index ? "Series" : "";
      return { name: field.name, glyph: field.time ? "T" : "C", role: live ? role : "", slots };
    });
    const measures = fields.measures.map((name, index) => ({
      name,
      glyph: "#",
      role: live && shape.measure === index ? "Value" : "",
      slots: live ? [{ label: "Value", active: shape.measure === index, clearable: false, empty: false, toggle: () => this.setViewShape("viewMeasure", index) }] : [],
    }));
    return [...dimensions, ...measures];
  }

  /** The pivot fields this chart can use, when its source is a Pivot View that offered them. */
  private viewFields(): NonNullable<ChartSource["fields"]> | null {
    if (this.config.source === "") return null;
    return this.sources.find((entry) => entry.id === this.config.source)?.fields ?? null;
  }

  /** Axis, series and value as chosen, each falling back to the pivot's own layout. */
  private viewShape(): PivotChartShape | null {
    const fields = this.viewFields();
    if (fields === null) return null;
    const dims = fields.dimensions.length;
    const ok = (index: number | undefined): index is number => index !== undefined && index >= 0 && index < dims;
    const axis = ok(this.config.viewAxis) ? this.config.viewAxis : fields.shape.axis;
    const chosen = this.config.viewSeries;
    let series = chosen === -1 ? -1 : ok(chosen) ? chosen : fields.shape.series;
    if (series === axis) series = fields.shape.series === axis ? -1 : fields.shape.series;
    const measure =
      this.config.viewMeasure !== undefined && this.config.viewMeasure >= 0 && this.config.viewMeasure < fields.measures.length
        ? this.config.viewMeasure
        : fields.shape.measure;
    return { axis, series, measure };
  }

  /** Fills the Axis, Series and Value pickers from the pivot's fields and shows the ones with a choice to make. */
  private syncViewShapeOptions(): void {
    const fields = this.viewFields();
    const shape = this.viewShape();
    const on = fields !== null && shape !== null && this.config.kind !== "pivotHeatmap";
    this.viewAxisWrap.classList.toggle("hidden", !on || fields.dimensions.length < 2);
    this.viewSeriesWrap.classList.toggle("hidden", !on || fields.dimensions.length < 2);
    this.viewMeasureWrap.classList.toggle("hidden", !on || fields.measures.length < 2);
    if (this.isPivotSource()) {
      const lines = shape !== null && fields?.dimensions[shape.axis]?.time === true;
      this.viewKindSelect.replaceChildren(
        el("option", { value: "bar" }, [lines ? "Lines" : "Bars"]) as HTMLOptionElement,
        el("option", { value: "pivotHeatmap" }, ["Heatmap"]) as HTMLOptionElement,
      );
      this.viewKindSelect.value = this.config.kind === "pivotHeatmap" ? "pivotHeatmap" : "bar";
    }
    if (!on) return;
    const zone = (index: number): string => (fields.dimensions[index]?.zone === "columns" ? "Columns" : "Rows");
    const option = (index: number): HTMLOptionElement =>
      el("option", { value: String(index) }, [`${fields.dimensions[index]?.name ?? ""} (${zone(index)})`]) as HTMLOptionElement;
    this.viewAxisSelect.replaceChildren(...fields.dimensions.map((_, index) => option(index)));
    this.viewAxisSelect.value = String(shape.axis);
    this.viewSeriesSelect.replaceChildren(
      el("option", { value: "-1" }, ["None"]) as HTMLOptionElement,
      ...fields.dimensions.map((_, index) => index).filter((index) => index !== shape.axis).map(option),
    );
    this.viewSeriesSelect.value = String(shape.series);
    this.viewMeasureSelect.replaceChildren(
      ...fields.measures.map((name, index) => el("option", { value: String(index) }, [name]) as HTMLOptionElement),
    );
    this.viewMeasureSelect.value = String(shape.measure);
  }

  /** Levels and measures exposed by the bound pivot result. */
  private syncPivotOptions(): void {
    const pivot = this.pivotResult;
    if (pivot === null) return;
    const fill = (
      select: HTMLSelectElement,
      labels: string[],
      selected: number | undefined,
    ): void => {
      select.replaceChildren();
      labels.forEach((label, index) => {
        select.append(
          el("option", { value: String(index) }, [
            label || `Level ${index + 1}`,
          ]) as HTMLOptionElement,
        );
      });
      const value = Math.max(
        0,
        Math.min(labels.length - 1, selected ?? labels.length - 1),
      );
      select.value = String(value);
    };
    fill(this.pivotRowSelect, pivot.rowNames, this.config.pivotRowLevel);
    fill(this.pivotColSelect, pivot.colNames, this.config.pivotColLevel);
    fill(
      this.pivotMeasureSelect,
      pivot.measures.map((measure) => measure.name),
      this.config.pivotMeasure,
    );
    this.config.pivotRowLevel = Number(this.pivotRowSelect.value);
    this.config.pivotColLevel = Number(this.pivotColSelect.value);
    this.config.pivotMeasure = Number(this.pivotMeasureSelect.value);
  }

  private isPivotSource(): boolean {
    return (
      this.config.source !== "" &&
      this.sources.find((entry) => entry.id === this.config.source)?.kind === "pivot"
    );
  }
  /** True when this card plots its own measure aggregate (line/bar/KPI/bins). */
  private usesValueAggregate(): boolean {    return (
      this.config.source === "" &&
      VALUE_AGGREGATE_KINDS.includes(this.config.kind) &&
      (this.config.valueColumn ?? -1) >= 0
    );
  }

  /** True when the card draws an aggregate result (bound view or own value). */
  private usesAggregate(): boolean {
    return this.config.source !== "" || this.usesValueAggregate();
  }

  private aggregateResult(): AggregateMessage | null {
    const result = this.config.source !== "" ? this.viewResult : this.valueResult;
    if (result === null) return null;
    const order = this.config.chartSort ?? "none";
    if (order === "none" || result.groupCount < 2) return result;
    const indexes = Array.from({ length: result.groupCount }, (_, index) => index);
    const dimension = result.dimensions[0] ?? [];
    const times = result.dimensionTimes[0];
    const measure = result.measures[0];
    const compare = (a: number, b: number): number => {
      let delta = 0;
      if (order === "valueDesc" || order === "valueAsc") {
        const av = measure?.[a] ?? Number.NaN;
        const bv = measure?.[b] ?? Number.NaN;
        const af = Number.isFinite(av);
        const bf = Number.isFinite(bv);
        delta = !af && !bf ? 0 : !af ? 1 : !bf ? -1 : order === "valueDesc" ? bv - av : av - bv;
      } else if (order === "timeAsc" || order === "timeDesc") {
        const at = times?.[a] ?? Number.NaN;
        const bt = times?.[b] ?? Number.NaN;
        const af = Number.isFinite(at);
        const bf = Number.isFinite(bt);
        delta = !af && !bf ? 0 : !af ? 1 : !bf ? -1 : order === "timeAsc" ? at - bt : bt - at;
      } else {
        delta = String(dimension[a] ?? "").localeCompare(String(dimension[b] ?? ""), undefined, {
          numeric: true,
        });
        if (order === "labelDesc") delta = -delta;
      }
      return delta === 0 ? a - b : delta;
    };
    indexes.sort(compare);
    return {
      ...result,
      labels: indexes.map((index) => result.labels[index] ?? ""),
      dimensions: result.dimensions.map((values) =>
        indexes.map((index) => values[index] ?? ""),
      ),
      dimensionTimes: result.dimensionTimes.map((values) =>
        Float64Array.from(indexes, (index) => values[index] ?? Number.NaN),
      ),
      measures: result.measures.map((values) =>
        Float64Array.from(indexes, (index) => values[index] ?? Number.NaN),
      ),
      partials:
        result.partials === null || result.partials === undefined
          ? result.partials
          : indexes.map((index) => result.partials?.[index] === true),
    };
  }

  /** The time dimension with the card's calendar options (week start, financial year). */
  private timeBy(grain: TimeGrain): { time: TimeGrain; every?: number; weekStart?: 0 | 1; fiscalStartMonth?: number } {
    const every = this.everyFor(grain);
    return {
      time: grain,
      ...(every > 1 ? { every } : {}),
      ...(this.config.valueWeekStart === 0 ? { weekStart: 0 as const } : {}),
      ...(this.config.valueFiscalStart !== undefined && this.config.valueFiscalStart > 1
        ? { fiscalStartMonth: this.config.valueFiscalStart }
        : {}),
    };
  }

  /** What to do with a period that has no rows (see ChartCardConfig.valueFill). */
  private fillPolicy(): "gap" | "zero" | "carry" {
    if (this.config.valueFill !== undefined) return this.config.valueFill;
    const agg = this.config.valueAgg ?? "mean";
    return agg === "sum" || agg === "count" || agg === "distinct" ? "zero" : "gap";
  }

  /** The grain in use: the chosen one, or the automatic one for this date column. */
  private resolvedGrain(): TimeGrain {
    return this.config.valueGrain === undefined || this.config.valueGrain === "auto"
      ? this.defaultGrainFor(this.config.column)
      : this.config.valueGrain;
  }

  /** True once a grain is picked by hand; Auto chooses width and unit together. */
  private hasExplicitGrain(): boolean {
    return this.config.valueGrain !== undefined && this.config.valueGrain !== "auto";
  }

  /** Bucket width for `grain`: the typed one, or what Auto chose for the default grain. */
  private everyFor(grain: TimeGrain): number {
    if (this.hasExplicitGrain()) return Math.max(1, Math.floor(this.config.valueEvery ?? 1));
    const auto = this.defaultStepFor(this.config.column);
    return auto.grain === grain ? auto.every : 1;
  }

  /** "week", "15 minutes": the bucket in use, for headlines. */
  private stepNoun(plural = false): string {
    const grain = this.resolvedGrain();
    return describeStep(grain, this.everyFor(grain), plural);
  }

  /** Implicit view definition: the measure aggregated over time, categories or bins. */
  valueViewDef(): ViewDef | null {
    if (!this.usesValueAggregate() || this.options.requestAggregate === undefined) return null;
    const column = this.config.valueColumn ?? -1;
    if (column < 0) return null;
    const datedColumn = this.isDateLike(this.meta(this.config.column));
    // Lines and small multiples run over time; a slopegraph or waterfall does
    // when its column is a date, and over category values otherwise.
    const line =
      this.config.kind === "line" ||
      this.config.kind === "smallmultiples" ||
      ((this.config.kind === "slopegraph" || this.config.kind === "waterfall") && datedColumn);
    const kpi = this.config.kind === "kpi";
    const histogram = this.config.kind === "histogram";
    if ((this.config.kind === "line" || this.config.kind === "smallmultiples") && !datedColumn) return null;
    // A KPI with a date column reads the series (latest bucket + comparison);
    // without one it is the grand total over every filtered row.
    const overTime = kpi && this.isDateLike(this.meta(this.config.column));
    if (!line && !kpi && this.config.column < 0) return null;
    const grain =
      this.config.valueGrain === undefined || this.config.valueGrain === "auto"
        ? this.config.kind === "slopegraph"
          ? this.slopeGrainFor(this.config.column)
          : this.defaultGrainFor(this.config.column)
        : this.config.valueGrain;
    // Split-by: line/bar cards with a Group draw one series per group value
    // (dimension 2); the renderer pivots the returned groups into series.
    const groupMetaForSplit = this.meta(this.config.groupColumn);
    const split =
      (line || SPLIT_KINDS.includes(this.config.kind)) &&
      this.config.groupColumn >= 0 &&
      groupMetaForSplit !== undefined &&
      isGroupable(groupMetaForSplit);
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
    const valueAgg = this.config.valueAgg ?? "mean";
    const fillPolicy = this.fillPolicy();
    const measure: MeasureSpec =
      valueAgg === "true" || valueAgg === "false" || valueAgg === "missing"
        ? {
            column: null,
            agg: "count",
            where:
              valueAgg === "missing"
                ? { column, isNull: true }
                : {
                    column,
                    values:
                      valueAgg === "true"
                        ? ["true", "yes", "y", "t", "1"]
                        : ["false", "no", "n", "f", "0"],
                  },
          }
        : valueAgg === "truePct"
          ? {
              column: null,
              agg: "count",
              where: { column, values: ["true", "yes", "y", "t", "1"] },
              post: [{ op: "pctRows" }],
            }
          : {
              column,
              agg: valueAgg as Aggregate,
              ...(post === undefined ? {} : { post: [...post] }),
            };    return {
      id: "card-value",
      name: this.config.title.trim() === "" ? this.defaultTitle() : this.config.title.trim(),
      dimensions:
        line || overTime
          ? split
            ? [
                { column: this.config.column, by: this.timeBy(grain) },
                { column: this.config.groupColumn, by: "value" },
              ]
            : [{ column: this.config.column, by: this.timeBy(grain) }]
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
        measure,
        ...this.extraValues().map((extra): MeasureSpec => ({
          column: extra,
          agg: valueAgg as Aggregate,
          ...(post === undefined ? {} : { post: [...post] }),
        })),
      ],
      fill: line && !split ? (fillPolicy === "zero" ? "zero" : fillPolicy === "carry" ? "carry" : "none") : "none",
      ...(line && !split && fillPolicy === "gap" ? { showGaps: true } : {}),
      sort:
        line || overTime || histogram
          ? { key: "dim0", dir: "asc" }
          : { key: "m0", dir: "desc" },
      limit: 5000,
      respectFilters: this.config.respectFilters !== false,
      filterColumn: this.config.filterColumn ?? -1,
      filterCode: this.config.filterCode ?? -1,
      ...(this.excludes().length > 0 ? { exclude: this.excludes() } : {}),
    };
  }

  /** Fetches the card's own value-over-time aggregate (generation-guarded). */
  refreshValue(): void {
    this.syncErrorBarControls();
    const def = this.valueViewDef();
    if (def === null) {
      this.valueGeneration++;
      if (this.valueResult !== null) this.valueResult = null;
      return;
    }
    // Own counter: the sibling refreshes (line bins, series, ...) bump
    // `generation` right after this call and used to discard this response,
    // leaving a freshly added chart on "no groups to draw yet".
    const generation = ++this.valueGeneration;
    void this.options
      .requestAggregate(def)
      .then((message) => {
        if (generation !== this.valueGeneration || this.disposed || !this.usesValueAggregate()) return;
        this.valueResult = message;
        this.refreshErrorBars();
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
    this.regions?.refresh();
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
    this.syncSummary();
  }

  /**
   * The chart's real type. A view bar that sums or averages a column is a
   * barplot; "Count plot" would misdescribe it.
   */
  private viewKindLabel(): string {
    const kind = this.config.kind;
    if (kind === "bar" && this.config.source !== "") {
      const measure = this.viewResult?.measureNames[0];
      if (measure !== undefined && measure !== "count(*)") return CHART_KIND_LABELS.barplot;
    }
    return CHART_KIND_LABELS[kind];
  }

  /** Plain-language sentence describing every semantic choice in the card. */
  private syncSummary(): void {
    this.syncSummaryText();
    this.syncNote();
  }

  /** The most useful lint note for this chart, if any; errors before warnings. */
  private syncNote(): void {
    const note = this.lintNote();
    this.lintEl.classList.toggle("hidden", note === null);
    if (note === null) {
      delete this.lintEl.dataset.msg;
      this.lintEl.replaceChildren();
      return;
    }
    if (this.lintEl.dataset.msg === note.msg) return;
    this.lintEl.dataset.msg = note.msg;
    this.lintEl.className = `chart-lint ${note.level}`;
    const dismiss = el("button", { class: "chart-lint-x", type: "button", title: "Dismiss this note", "aria-label": "Dismiss this note" }, ["×"]);
    dismiss.addEventListener("click", () => {
      this.dismissedNotes.add(note.msg);
      delete this.lintEl.dataset.msg;
      this.syncNote();
    });
    this.lintEl.replaceChildren(el("span", {}, [note.msg]), dismiss);
  }

  private lintNote(): LintNote | null {
    const config = this.config;
    if (config.kind === "pivotHeatmap" || config.source !== "" || this.columns.length === 0) return null;
    const type =
      config.kind === "barplot" ? "barplot" : config.kind === "bar" ? "countplot" : config.kind === "line" ? "timeseries" : null;
    if (type === null) return null;
    const rec = (index: number): RecColumn | null => {
      const meta = this.meta(index);
      return meta === undefined ? null : toRecColumn(meta, index, this.rowCount);
    };
    const fields = [rec(config.valueColumn ?? -1), rec(config.column)].filter((c): c is RecColumn => c !== null);
    const distinct = this.meta(type === "timeseries" ? config.groupColumn : config.column)?.stats.distinct ?? 0;
    const notes = lint(
      {
        type,
        cfg: { agg: config.valueAgg, topN: config.groupOther ? config.topN : null },
        fields,
        categories: type === "timeseries" ? undefined : distinct,
        series: type === "timeseries" ? Math.min(distinct, Math.max(6, config.topN)) : undefined,
      },
      this.rowCount,
    ).filter((note) => !this.dismissedNotes.has(note.msg));
    // A time series is always charted over a date, so the "needs a date" error only
    // applies when the fields really lack one.
    notes.sort((a, b) => Number(b.level === "error") - Number(a.level === "error"));
    return notes[0] ?? null;
  }

  private syncSummaryText(): void {
    const source =
      this.config.source === ""
        ? this.options.tableSourceLabel?.() ?? "Table"
        : (this.sources.find((entry) => entry.id === this.config.source)?.name ?? "View");
    if (this.config.kind === "pivotHeatmap") {
      const data = this.pivotHeatmapData();
      this.summaryEl.textContent =
        data === null
          ? `Pivot heatmap from ${source}`
          : `Pivot heatmap of ${data.measureName} by ${data.rowName} and ${data.colName} from ${source}`;
      return;
    }
    const kind = this.viewKindLabel();
    this.kindStatic.textContent = this.config.source === "" ? "" : kind;
    if (this.config.source !== "") {
      const result = this.viewResult;
      if (result === null) {
        this.summaryEl.textContent = `${kind} from view: ${source}`;
        return;
      }
      const groups = result.groupCount;
      const measureName = plainMeasureName(result.measureNames[0] ?? "measure");
      this.summaryEl.textContent =
        result.dimensionNames.length >= 2
          ? `${result.dimensionIsTime[0] === true ? "Lines" : "Bars"} from view: ${measureName} by ${result.dimensionNames[0]}, one series per ${result.dimensionNames[1]}`
          : `${kind} from view: ${measureName} by ${result.dimensionNames[0] || "group"}` +
            ` · ${groups.toLocaleString()} ${groups === 1 ? "group" : "groups"}`;
      return;
    }
    const name = (index: number): string => this.meta(index)?.name ?? "value";
    if (isPairKind(this.config.kind)) {
      this.summaryEl.textContent = `${kind}: ${name(this.config.y)} vs ${name(this.config.x)}${this.options.docked === true ? "" : ` from ${source}`}`;
      return;
    }
    const agg =
      this.config.valueColumn !== undefined && this.config.valueColumn >= 0
        ? `${this.aggPhrase()} of ${[this.config.valueColumn, ...this.extraValues()].map(name).join(", ")}`
        : "rows";
    const overTime =
      this.config.valueColumn !== undefined &&
      this.config.valueColumn >= 0 &&
      this.isDateLike(this.meta(this.config.column)) &&
      (this.config.kind === "line" || this.config.kind === "smallmultiples");
    const by =
      this.config.column < 0
        ? ""
        : overTime
          ? ` per ${this.stepNoun()} (${name(this.config.column)})`
          : ` by ${name(this.config.column)}`;
    const group =
      this.config.groupColumn >= 0 ? ` grouped by ${name(this.config.groupColumn)}` : "";
    const calc =
      this.config.valueCalc === undefined
        ? ""
        : ` with ${this.valueCalcSelect.selectedOptions[0]?.textContent ?? this.config.valueCalc}`;
    // Docked, the scope sits beside this line and already names the source.
    this.summaryEl.textContent = `${kind}: ${agg}${by}${group}${calc}${this.options.docked === true ? "" : ` from ${source}`}`;
  }

  /** Columns whose missing/placeholder state can affect this chart. */
  private issueColumns(): number[] {
    if (this.config.source !== "" || this.config.kind === "pivotHeatmap") return [];
    const indexes = new Set<number>();
    const add = (index: number | undefined): void => {
      if (index !== undefined && index >= 0) indexes.add(index);
    };
    switch (this.config.kind) {
      case "scatter":
      case "density":
      case "bubble":
        add(this.config.x);
        add(this.config.y);
        add(this.config.colorColumn);
        add(this.config.sizeColumn);
        break;
      case "heatmap":
      case "box":
        add(this.config.x);
        add(this.config.y);
        break;
      case "map":
        add(this.config.x);
        add(this.config.y);
        add(this.config.colorColumn);
        break;
      case "kpi":
      case "barplot":
      case "dotplot":
      case "waterfall":
        add(this.config.valueColumn);
        add(this.config.column);
        break;
      case "stacked100":
      case "smallmultiples":
      case "slopegraph":
        add(this.config.valueColumn);
        add(this.config.column);
        add(this.config.groupColumn);
        break;
      case "correlation":
        for (const index of this.config.correlationColumns) add(index);
        break;
      case "line":
        add(this.config.groupColumn);
        add(this.config.valueColumn);
        add(this.config.column);
        break;
      default:
        add(this.config.column);
        break;
    }
    return [...indexes].filter((index) => this.meta(index)?.role !== "provenance");
  }

  /** Explain missing/unknown categories and offer filter/fix actions. */
  private syncDataIssues(): void {
    const issues = this.issueColumns()
      .map((index) => {
        const meta = this.meta(index);
        if (meta === undefined) return null;
        const missing = meta.stats.nulls;
        const tokens = meta.nullTokens.filter(
          (token) => token.label !== "" && token.count > 0,
        );
        const sentinels = meta.suggestions.filter(
          (suggestion): suggestion is Extract<ColumnSuggestion, { kind: "sentinel" }> =>
            suggestion.kind === "sentinel",
        );
        if (missing === 0 && tokens.length === 0 && sentinels.length === 0) return null;
        const active =
          this.options.currentFilter?.(index)?.kind === "blank" &&
          (this.options.currentFilter?.(index) as { negate?: boolean } | null)?.negate === false;
        return { index, meta, missing, tokens, sentinels, active };
      })
      .filter((issue): issue is NonNullable<typeof issue> => issue !== null);
    const signature = issues
      .map((issue) => `${issue.meta.name}:${issue.missing}:${issue.tokens.length}:${issue.active}`)
      .join("|");
    if (signature === this.issueSignature) return;
    this.issueSignature = signature;
    clear(this.dataIssueEl);
    this.dataIssueEl.classList.toggle("hidden", issues.length === 0);
    if (issues.length === 0) return;
    this.dataIssueEl.append(
      el("span", { class: "chart-issue-heading" }, ["Data issues"]),
    );
    for (const issue of issues.slice(0, 2)) {
      const row = el("div", { class: "chart-issue-row" });
      const tokenCount = issue.tokens.reduce((sum, token) => sum + token.count, 0);
      const details = [`${issue.missing.toLocaleString()} missing`];
      if (tokenCount > 0) details.push(`${tokenCount.toLocaleString()} placeholders`);
      if (issue.sentinels.length > 0) {
        details.push(
          issue.sentinels
            .map((suggestion) => `"${suggestion.value}" in ${suggestion.count.toLocaleString()}`)
            .join(", "),
        );
      }
      row.append(
        el("span", { class: "chart-issue-label", title: details.join(" - ") }, [
          `${issue.meta.name}: ${details.join(" - ")}`,
        ]),
      );
      if (missingOrTokens(issue.missing, tokenCount) && this.options.onFilterTable !== undefined) {
        const filter = el(
          "button",
          {
            class: "chart-issue-chip warn",
            type: "button",
            "aria-pressed": issue.active ? "true" : "false",
            title: `Filter the table to rows where ${issue.meta.name} is blank`,
          },
          [`Filter: ${issue.missing.toLocaleString()} missing`],
        ) as HTMLButtonElement;
        filter.addEventListener("click", () =>
          this.options.onFilterTable?.(
            [{ column: issue.index, filter: { kind: "blank", negate: false } }],
            `${issue.meta.name} is blank`,
          ),
        );
        row.append(filter);
      }
      if (this.options.onShowRows !== undefined) {
        const show = el(
          "button",
          { class: "chart-issue-chip", type: "button", title: "Show the affected rows" },
          ["Show rows"],
        ) as HTMLButtonElement;
        show.addEventListener("click", () =>
          this.options.onShowRows?.(
            [{ column: issue.index, filter: { kind: "blank", negate: false } }],
            `${issue.meta.name} is blank`,
          ),
        );
        row.append(show);
      }
      if (tokenCount > 0 && this.options.onConvertToken !== undefined) {
        const fix = el(
          "button",
          {
            class: "chart-issue-chip fix",
            type: "button",
            title: "Preview-free null-policy change; undo is available in the status bar",
          },
          [`Fix: convert ${tokenCount.toLocaleString()} placeholders`],
        ) as HTMLButtonElement;
        fix.addEventListener("click", () =>
          this.options.onConvertToken?.(
            issue.index,
            issue.tokens.map((token) => token.label),
          ),
        );
        row.append(fix);
      }
      const sentinel = issue.sentinels[0];
      if (sentinel !== undefined && this.options.onSuggestion !== undefined) {
        const fix = el(
          "button",
          {
            class: "chart-issue-chip fix",
            type: "button",
            title: "Use the existing null-policy action; undo is available in the status bar",
          },
          [`Fix: treat "${sentinel.value}" as missing`],
        ) as HTMLButtonElement;
        fix.addEventListener("click", () =>
          this.options.onSuggestion?.(issue.index, sentinel),
        );
        row.append(fix);
      }
      this.dataIssueEl.append(row);
    }
    if (issues.length > 2) {
      this.dataIssueEl.append(
        el("span", { class: "chart-issue-more" }, [
          `+${issues.length - 2} more column${issues.length - 2 === 1 ? "" : "s"}`,
        ]),
      );
    }
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
    this.syncResearchControls();
    for (const details of this.settingsGroups) details.open = readGroupOpen(details.dataset.group as SettingsGroup);
    this.dataDrawer.restoreOpen();
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

  private specSourceName(): string {
    return this.config.source === ""
      ? this.options.tableSourceLabel?.() ?? "Table"
      : (this.sources.find((source) => source.id === this.config.source)?.name ??
        this.config.source);
  }

  /** Lossless, serialisable description of this card. */
  getSpec(): ChartSpec {
    return chartSpecFromConfig(this.config, this.columns, this.specSourceName());
  }

  /**
   * Validate and apply an imported spec in one step. Returns issues instead of
   * partially applying anything when the spec is invalid or uses stale columns.
   */
  applySpecText(text: string): string[] {
    const parsed = parseChartSpec(text, this.columns);
    if (parsed.spec === null || parsed.config === null) return parsed.issues;
    if (
      parsed.config.source !== "" &&
      !this.sources.some((source) => source.id === parsed.config?.source)
    ) {
      return [`Source "${parsed.config.source}" is not available.`];
    }
    this.applyConfig(parsed.config);
    return [];
  }

  /** Hidden file picker for importing a previously downloaded ChartSpec. */
  private importChartSpecFile(): void {
    const input = el("input", {
      type: "file",
      accept: ".json,application/json",
      class: "hidden",
    }) as HTMLInputElement;
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (file === undefined) return;
      void file
        .text()
        .then((text) => {
          const issues = this.applySpecText(text);
          if (issues.length === 0) {
            this.noteEl.textContent = "Applied chart spec.";
            return;
          }
          this.noteEl.textContent = issues[0] ?? "The chart spec could not be applied.";
          void openConfirm({
            title: "Cannot apply chart spec",
            body: issues.join("\n"),
            confirmLabel: "Close",
          });
        })
        .catch((error: unknown) => {
          this.noteEl.textContent =
            error instanceof Error ? error.message : "Could not read the chart spec.";
        });
    });
    input.click();
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
  private openStats(): void {
    const extract = this.chartExtract();
    if (extract.sections.length === 0) {
      this.noteEl.textContent = "No chart numbers are ready yet: finish choosing the fields, or wait for the chart to draw.";
      return;
    }
    openChartStats(extract, `${safeFileName(this.options.datasetName())}-${safeFileName(this.chartName())}-stats.csv`);
  }

  /** What Extract stats shows: how the chart was drawn, then the numbers it was drawn from. */
  chartExtract(): ChartExtract {
    const kind = this.config.kind;
    const facts: [string, string][] = [];
    const scope = this.scopeEl.textContent?.trim() ?? "";
    if (scope !== "") facts.push(["Data", scope]);
    const sections: ExtractSection[] = [];
    const title = this.summaryEl.textContent?.trim() || this.chartName();
    const done = (): ChartExtract => ({ title, facts, sections });
    const table = (name: string, rows: string[][]): void => {
      if (rows.length >= 2) sections.push({ title: name, rows });
    };

    if (this.animationResult !== null && this.animationResult.places === undefined) {
      facts.push(["Animation", "These numbers cover all periods together, not the frame showing"]);
    }
    if (kind === "histogram" && this.groupResult === null) {
      this.histogramExtract(facts, table);
      return done();
    }
    if (this.regionsOn()) {
      this.regions?.extract(facts, table);
      return done();
    }
    if (kind === "map" && this.config.mapMode !== "heat") {
      this.mapExtract(facts, table);
      return done();
    }
    if (kind === "scatter" && this.seriesResult?.mode === "points") {
      const points = this.seriesResult;
      if (Number.isFinite(this.seriesCorrelation)) facts.push(["Pearson r, every row", this.seriesCorrelation.toFixed(4)]);
      const fit = linearFit(points.x, points.y, points.shown);
      if (fit !== null) {
        const where = points.sampled ? `the ${points.shown.toLocaleString()} points sampled from ${points.total.toLocaleString()}` : `all ${points.shown.toLocaleString()} points`;
        facts.push(["Straight line y = a + b·x, on " + where, `a = ${fit.intercept}, b = ${fit.slope}, R² = ${fit.r2.toFixed(4)}`]);
      }
      table("Points", this.chartCsvRows());
      return done();
    }
    if (kind === "box") {
      facts.push(["Box rule", "Tukey: the box is Q1 to Q3; whiskers reach the furthest values within 1.5 × IQR; beyond them are outliers. Every row counts; only the outliers drawn are thinned when there are many"]);
      const result = this.boxResult;
      if (result !== null) {
        const rows = this.chartCsvRows();
        const iqrAt = rows[0]!.indexOf("q3") + 1;
        rows[0]!.splice(iqrAt, 0, "iqr");
        result.groups.forEach((group, index) => rows[index + 1]?.splice(iqrAt, 0, num(group.q3 - group.q1)));
        table("Ranges by group", rows);
      }
      return done();
    }
    const aggregate = this.aggregateResult();
    if (aggregate !== null && aggregate.groupCount > 0 && new Set<ChartCardKind>(VALUE_AGGREGATE_KINDS).has(kind)) {
      const labels = aggregate.dimensions[0] ?? [];
      const summary: string[][] = [["measure", "groups", "total", "mean", "sd", "lowest", "lowest_at", "highest", "highest_at"]];
      aggregate.measures.forEach((values, index) => {
        const stats = summarise(values);
        if (stats === null) return;
        summary.push([
          plainMeasureName(aggregate.measureNames[index] ?? "value"),
          String(stats.n),
          num(stats.sum),
          num(stats.mean),
          num(stats.sd),
          num(stats.min),
          labels[stats.minAt] ?? "",
          num(stats.max),
          labels[stats.maxAt] ?? "",
        ]);
      });
      table("Summary", summary);
      this.errorBarExtract(aggregate, facts, table);
      const series = aggregate.dimensions[1];
      if (series !== undefined && aggregate.measures[0] !== undefined) {
        table(`Each ${aggregate.dimensionNames[1] ?? "series"}`, seriesRows([aggregate.dimensionNames[1] ?? "series"], series, labels, aggregate.measures[0]));
      }
      table("Values", this.chartCsvRows());
      return done();
    }
    table("Values", this.chartCsvRows());
    return done();
  }

  private errorBarExtract(aggregate: AggregateMessage, facts: [string, string][], table: (name: string, rows: string[][]) => void): void {
    return errorBarExtract(this, aggregate, facts, table);
  }

  /** The bins a histogram draws, with their edges: the automatic ones (on a log-like scale when skewed) or the chosen. */
  private drawnBins(): { bins: readonly number[]; edges: number[]; overflow: number; symlog: boolean; below: number; above: number } | null {
    const meta = this.meta(this.config.column);
    const automatic = meta?.histogram;
    if (meta === undefined || automatic === null || automatic === undefined) return null;
    const custom = this.binResult;
    const live = this.histograms[this.config.column] ?? automatic.bins;
    const bins: readonly number[] = custom !== null ? custom.bins : this.withoutExcludedBins(live, automatic.min, automatic.max);
    if (bins.length === 0) return null;
    const min = this.chartXZoom?.min ?? this.config.binOptions?.min ?? automatic.min;
    const max = this.chartXZoom?.max ?? this.config.binOptions?.max ?? automatic.max;
    const symlog = custom === null && automatic.symlog;
    const edges = Array.from({ length: bins.length + 1 }, (_, index) => {
      const share = index / bins.length;
      if (index === 0) return min;
      if (index === bins.length) return max;
      if (symlog) return symlogInverse(symlogValue(min) + share * (symlogValue(max) - symlogValue(min)));
      return min + share * (max - min);
    });
    return {
      bins,
      edges,
      overflow: custom?.overflow ?? 0,
      symlog,
      below: custom === null ? automatic.below : 0,
      above: custom === null ? automatic.above : 0,
    };
  }

  private histogramExtract(facts: [string, string][], table: (name: string, rows: string[][]) => void): void {
    const drawn = this.drawnBins();
    const meta = this.meta(this.config.column);
    if (drawn === null || meta === undefined) return;
    const { bins, edges, overflow, symlog, below, above } = drawn;
    const dated = meta.type === "date" || meta.type === "datetime";
    const format = dated ? (value: number): string => (Number.isFinite(value) ? new Date(value).toISOString() : "") : num;
    const fact = dated ? format : formatChartNumber;
    facts.push(["Bins", `${bins.length}, from ${fact(edges[0]!)} to ${fact(edges[bins.length]!)}`]);
    facts.push(["Bin width", symlog ? "even on a log-like scale, so the edges below are not evenly spaced" : dated ? `${num((edges[1]! - edges[0]!) / 86_400_000)} days` : num(edges[1]! - edges[0]!)]);
    if (overflow > 0) facts.push(["Above the last bin", overflow.toLocaleString()]);
    if (below + above > 0) {
      facts.push(["Left out of the bins", `${below.toLocaleString()} below the first, ${above.toLocaleString()} above the last: the automatic range is the 1st to 99th percentile, so a few extremes cannot flatten the rest. Set a range in the settings to include them`]);
    }
    const summary = binnedSummary(bins, edges);
    if (summary !== null) {
      facts.push(["Rows in the bins", summary.n.toLocaleString()]);
      if (!dated) {
        facts.push(["Mean, estimated from the bins", formatChartNumber(summary.mean)]);
        facts.push(["Standard deviation, estimated from the bins", formatChartNumber(summary.sd)]);
      }
    }
    if (this.binMedian !== null && !dated) facts.push(["Median", num(this.binMedian)]);
    const kde = this.config.kde && bins.length >= 4;
    if (kde) {
      facts.push(["KDE curve", `Gaussian kernel, width ${KDE_SIGMA_BINS} bins${symlog ? "" : ` = ${num(KDE_SIGMA_BINS * (edges[1]! - edges[0]!))} in the column's units`}. It smooths the bin counts rather than being fitted to each row, and is on the count scale`]);
    }
    table("Bins", binRows(bins, edges, kde ? smoothSeries(bins, KDE_SIGMA_BINS) : null, format, overflow));
  }

  private mapExtract(facts: [string, string][], table: (name: string, rows: string[][]) => void): void {
    return mapExtract(this, facts, table);
  }

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
    if (this.config.kind === "pivotHeatmap") {
      const data = this.pivotHeatmapData();
      if (data === null) return [];
      const rows: string[][] = [[data.rowName, ...data.colLabels]];
      data.rowLabels.forEach((label, row) => {
        rows.push([
          label,
          ...data.colLabels.map((_, col) => {
            const value = data.values[row * data.colLabels.length + col];
            return Number.isFinite(value) ? String(value) : "";
          }),
        ]);
      });
      return rows;
    }    const number = (value: number): string =>
      Number.isFinite(value) ? String(value) : "";
    const aggregate = this.aggregateResult();
    const aggregateKinds = new Set<ChartCardKind>(VALUE_AGGREGATE_KINDS);
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
      if (bins === null || range === null) {
        const drawn = this.config.kind === "histogram" ? this.drawnBins() : null;
        return drawn === null ? [] : binRows(drawn.bins, drawn.edges, null).map((row) => row.slice(0, 3));
      }
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
          String(group.outlierCount),
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
      if (result === null) return [];
      return [
        ["label", "value", "rows"],
        ...result.labels.map((label, index) => [
          label,
          number(result.values[index] ?? Number.NaN),
          String(result.rows[index] ?? 0),
        ]),
      ];
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

  meta(index: number): ColumnMeta | undefined {
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
      case "dotplot":
      case "stacked100":
        return isGroupable(meta);
      case "smallmultiples":
        return meta.type === "date" || meta.type === "datetime";
      case "slopegraph":
      case "waterfall":
        return isGroupable(meta) || meta.type === "date" || meta.type === "datetime";
      case "treemap":
        if (meta.role === "provenance") return false;
        return (
          isGroupable(meta) ||
          (meta.type === "string" && !isIdLikeColumn(meta, this.rowCount))
        );
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
        return isGroupable(meta);
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
        return isGroupable(meta);
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

  /** Type-aware aggregation choices for the bound value column. */
  /** The aggregation as a sentence has it: "Average of price", not the menu's "Average (mean)". */
  private aggPhrase(): string {
    const label = this.valueAggSelect.selectedOptions[0]?.textContent ?? this.config.valueAgg ?? "Average";
    return label.replace(/ \(mean\)$/, "");
  }

  private syncValueAggOptions(): void {
    const meta = this.meta(this.config.valueColumn ?? -1);
    const options: [NonNullable<ChartCardConfig["valueAgg"]>, string][] =
      meta === undefined
        ? [["mean", "Average (mean)"], ["sum", "Sum"]]
        : meta.type === "boolean"
          ? [
              ["true", "True count"],
              ["false", "False count"],
              ["truePct", "True % of rows"],
              ["missing", "Missing count"],
              ["count", "Count of values"],
              ["distinct", "Distinct values"],
              ["mode", "Mode"],
            ]
          : meta.type === "date" || meta.type === "datetime"
            ? [
                ["min", "Earliest"],
                ["max", "Latest"],
                ["count", "Count of values"],
                ["distinct", "Distinct values"],
                ["mode", "Mode"],
                ["first", "First (by row order)"],
                ["last", "Last (by row order)"],
              ]
            : meta.type === "category" || meta.type === "string" || meta.type === "identifier"
              ? [
                  ["count", "Count of values"],
                  ["distinct", "Distinct values"],
                  ["mode", "Mode"],
                ]
              : [
                  ["mean", "Average (mean)"],
                  ["sum", "Sum"],
                  ["median", "Median"],
                  ["min", "Min"],
                  ["max", "Max"],
                  ["stddev", "Std deviation"],
                  ["variance", "Variance"],
                  ["p25", "25th percentile"],
                  ["p75", "75th percentile"],
                  ["p90", "90th percentile"],
                  ["p95", "95th percentile"],
                  ["count", "Count of values"],
                  ["distinct", "Distinct values"],
                  ["first", "First (by row order)"],
                  ["last", "Last (by row order)"],
                  ["mode", "Mode"],
                ];
    const current = this.config.valueAgg ?? options[0]?.[0];
    this.valueAggSelect.replaceChildren();
    for (const [value, label] of options) {
      this.valueAggSelect.append(el("option", { value }, [label]) as HTMLOptionElement);
    }
    const selected = options.some(([value]) => value === current) ? current : options[0]?.[0];
    if (selected !== undefined) {
      this.valueAggSelect.value = selected;
      this.config.valueAgg = selected;
    }
  }
  private defaultCorrelationColumns(): number[] {
    return this.allowedIndexes(
      (meta) =>
        isNumericType(meta.type) &&
        !isIdLikeColumn(meta, this.rowCount) &&
        !looksLikeIdName(meta.name),
    ).slice(0, 8);
  }

  /**
   * The fields a chart was using, so a new chart type starts from them: its measures (numeric
   * columns plotted as values), then the date and category columns it was split or laid out by.
   */
  private fieldsInUse(): { measures: number[]; dimensions: number[] } {
    const c = this.config;
    const pair = isPairKind(c.kind);
    const used = pair ? [c.y, c.x] : [c.valueColumn ?? -1, c.column, c.groupColumn];
    const measures: number[] = [];
    const dimensions: number[] = [];
    for (const index of used) {
      const meta = this.meta(index);
      if (meta === undefined) continue;
      const measure = isNumericType(meta.type) && (pair || index === c.valueColumn || !isGroupable(meta));
      const list = measure ? measures : dimensions;
      if (!list.includes(index)) list.push(index);
    }
    return { measures, dimensions };
  }

  private setKind(kind: ChartCardKind): void {
    if (kind === this.config.kind) return;
    const { measures, dimensions } = this.fieldsInUse();
    this.config.kind = kind;
    this.plotView = null;
    this.mapView = null;
    this.mapGrid = null;
    this.chartXZoom = null;
    this.barWindow = null;
    if (isPairKind(kind)) {
      const xAllowed = this.allowedIndexes((meta) => this.allowsX(meta));
      const yAllowed = this.allowedIndexes((meta) => this.allowsY(meta));
      // Keep what was charted: a measure goes on Y, and X takes the next field that fits.
      const fromField = [...dimensions, ...measures];
      const y = measures.find((index) => yAllowed.includes(index));
      if (y !== undefined) this.config.y = y;
      const x = fromField.find((index) => index !== this.config.y && xAllowed.includes(index));
      if (x !== undefined) this.config.x = x;
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
      const takesValue = VALUE_AGGREGATE_KINDS.includes(kind) || kind === "treemap";
      // A chart of one column plots the measure itself; one with a Value keeps the measure there
      // and is laid out by the date or category it had.
      const lead = kind === "histogram" ? [...measures, ...dimensions] : [...dimensions, ...measures];
      const column = lead.find((index) => primary.includes(index));
      if (column !== undefined) this.config.column = column;
      if (!primary.includes(this.config.column)) this.config.column = primary[0] ?? -1;
      // A count plot counts rows; every other chart with a Value keeps the measure.
      if (takesValue && kind !== "histogram" && kind !== "bar") {
        const value = measures.find((index) => index !== this.config.column);
        if (value !== undefined && (this.config.valueColumn ?? -1) < 0) this.config.valueColumn = value;
      } else if (kind === "histogram") this.config.valueColumn = -1;
      if (kind === "histogram") this.applyColumnDefaults();
    }
    this.dropSettingsTheNewKindCannotUse();
    this.pickerSignature = "";
    this.refreshForConfig();
  }

  /**
   * After a change of chart type: settings that made sense on the old chart and say nothing on
   * the new one are cleared, so the title never reads "by usertype grouped by usertype" or keeps
   * a year-over-year change on bars of categories.
   */
  private dropSettingsTheNewKindCannotUse(): void {
    const kind = this.config.kind;
    if (isPairKind(kind) || kind === "correlation") return;
    // Splitting a chart by the field it is already laid out by gives one series per bar.
    if (this.config.groupColumn >= 0 && this.config.groupColumn === this.config.column) {
      this.config.groupColumn = -1;
      this.hiddenGroups.clear();
    }
    // These calculations compare each period with the one before it: they need a date axis.
    const calc = this.config.valueCalc;
    const needsTime = calc === "rolling7" || calc === "diff" || calc === "pctChange" || calc === "yoy" || calc === "cumulative";
    if (needsTime && !this.isDateLike(this.meta(this.config.column))) this.config.valueCalc = undefined;
  }

  /** Refetches and repaints everything a whole-chart settings change can touch. */
  private refreshForConfig(): void {
    this.generation++;
    this.syncOptions();
    this.syncPlaceholder();
    this.renderControls();
    this.refreshBins();
    this.refreshValue();
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
    if (this.config.source !== "") this.refreshView();
    this.render();
  }

  private setPrimaryColumn(index: number): void {
    if (index === this.config.column) return;
    this.config.column = index;
    this.chartXZoom = null;
    this.barWindow = null;
    if (this.config.kind === "histogram") this.applyColumnDefaults();
    this.dropSettingsTheNewKindCannotUse();
    this.groupSelect.value = String(this.config.groupColumn);
    this.valueCalcSelect.value = this.config.valueCalc ?? "";
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
    this.fillColumnSelect(this.primarySelect, primary, this.config.kind === "kpi" ? 1 : 0);
    if (primary.length === 0) {
      const placeholder = this.option("-1", "No matching column");
      placeholder.disabled = true;
      this.primarySelect.append(placeholder);
    }
    if (this.config.column >= 0) this.primarySelect.value = String(this.config.column);

    const groupable = this.allowedIndexes((meta) => isGroupable(meta));
    if (!groupable.includes(this.config.groupColumn)) this.config.groupColumn = -1;
    this.fillColumnSelect(this.groupSelect, groupable, 2, [this.option("-1", "None")]);
    this.groupSelect.value = String(this.config.groupColumn);

    const valueAllowed = this.allowedIndexes(
      (meta) =>
        meta.role !== "provenance" &&
        (this.config.kind !== "treemap" ||
          isNumericType(meta.type) ||
          meta.type === "duration"),
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
    this.syncValueAggOptions();
    this.valueGrainSelect.value = this.config.valueGrain ?? "auto";
    this.valueEveryInput.value = String(this.config.valueEvery ?? 1);
    this.valueFillSelect.value = this.config.valueFill ?? "auto";
    this.weekStartSelect.value = String(this.config.valueWeekStart ?? 1);
    this.fiscalSelect.value = String(this.config.valueFiscalStart ?? 1);
    // Say what "Auto" currently means, and offer only grains the column can support.
    const dateOnly = this.meta(this.config.column)?.type === "date";
    const autoOption = this.valueGrainSelect.options[0];
    if (autoOption !== undefined) {
      const auto = this.defaultStepFor(this.config.column);
      autoOption.textContent = `Auto (${describeStep(auto.grain, auto.every)})`;
    }
    for (const option of Array.from(this.valueGrainSelect.options)) {
      option.hidden = dateOnly && (option.value === "minute" || option.value === "hour" || option.value === "second");
    }
    this.valueCalcSelect.value = this.config.valueCalc ?? "";
    this.barStackInput.checked = (this.config.barLayout ?? "group") === "stack";

    const xAllowed = this.allowedIndexes((meta) => this.allowsX(meta));
    const yAllowed = this.allowedIndexes((meta) => this.allowsY(meta));
    // The Map page's map with no coordinate columns stays empty (basemap and markers only).
    const keepEmpty = this.options.keepEmptyMap === true && this.config.kind === "map" && this.config.x === -1 && this.config.y === -1;
    if (!keepEmpty && !xAllowed.includes(this.config.x)) this.config.x = xAllowed[0] ?? -1;
    if (!keepEmpty && (!yAllowed.includes(this.config.y) || (this.config.y === this.config.x && yAllowed.length > 1))) {
      this.config.y = yAllowed.find((index) => index !== this.config.x) ?? yAllowed[0] ?? -1;
    }
    for (const [select, allowed, selected] of [
      [this.xSelect, xAllowed, this.config.x],
      [this.ySelect, yAllowed, this.config.y],
    ] as const) {
      this.fillColumnSelect(select, allowed, select === this.xSelect ? 0 : 1);
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
    // "Auto" is retired: older charts that had it draw points, the plain default.
    this.modeSelect.value = this.config.mode === "auto" ? "points" : this.config.mode;
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
    this.sortSelect.value = this.config.chartSort ?? "none";
    this.sortWrap.classList.toggle(
      "hidden",
      !this.usesAggregate() || this.config.kind === "pivotHeatmap" || this.config.kind === "kpi",
    );
    this.syncSummary();
  }

  /** Category filter choices for this chart, plus its table-filter scope. */
  private syncChartFilterControls(): void {
    const categoryIndexes = this.allowedIndexes((meta) => isGroupable(meta));
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
      this.regionsOn();
    this.chartFilterRow.classList.toggle("hidden", !aggregateBacked);
  }

  /** Columns to animate over: dates, then numbers (shaded regions step through dates only). */
  private syncAnimationOptions(): void {
    const dates = this.allowedIndexes((meta) => this.isDateLike(meta));
    const numbers = this.regionsOn() ? [] : this.allowedIndexes((meta) => this.isFrameNumber(meta));
    const current = this.config.animationTimeColumn ?? -1;
    if (current >= 0 && !dates.includes(current) && !numbers.includes(current)) this.config.animationTimeColumn = -1;
    this.animationTimeSelect.replaceChildren(this.option("-1", "Off"));
    const group = (label: string, indexes: number[]): void => {
      if (indexes.length === 0) return;
      const optgroup = el("optgroup", { label }) as HTMLOptGroupElement;
      for (const index of indexes) optgroup.append(this.option(String(index), this.columns[index]!.name));
      this.animationTimeSelect.append(optgroup);
    };
    group("Dates", dates);
    group("Numbers", numbers);
    this.animationTimeSelect.value = String(this.config.animationTimeColumn ?? -1);
    this.syncFrameOptions();
  }

  /** A number column frames can step through in order: integers and decimals (dates are offered on their own). */
  private isFrameNumber(meta: ColumnMeta | undefined): boolean {
    return meta !== undefined && (meta.type === "integer" || meta.type === "number") && meta.stats.min !== null && meta.stats.max !== null;
  }

  /**
   * Step widths for a number column that give roughly 10, 20 and 50 frames
   * over its range, rounded to 1, 2 or 5 times a power of ten.
   */
  private frameWidths(meta: ColumnMeta): number[] {
    const span = (meta.stats.max ?? 0) - (meta.stats.min ?? 0);
    if (!(span > 0)) return [1];
    const nice = (raw: number): number => {
      const power = 10 ** Math.floor(Math.log10(raw));
      const unit = raw / power;
      return Number(((unit < 1.5 ? 1 : unit < 3.5 ? 2 : unit < 7.5 ? 5 : 10) * power).toPrecision(12));
    };
    const widths = [...new Set([10, 20, 50].map((frames) => nice(span / frames)))];
    // Whole numbers step by at least 1.
    return (meta.type === "integer" ? widths.map((width) => Math.max(1, Math.round(width))) : widths).filter((width, i, all) => all.indexOf(width) === i).sort((a, b) => b - a);
  }

  /** Each value when a number column has few enough of them to watch, else steps for about 20 frames. */
  private defaultFrameStep(meta: ColumnMeta): "value" | number {
    if (meta.stats.distinct <= 60) return "value";
    const widths = this.frameWidths(meta);
    return widths[Math.min(1, widths.length - 1)]!;
  }

  /** The frame dropdown for the chosen column: time grains for dates, each value or steps for numbers. */
  private syncFrameOptions(): void {
    const meta = this.meta(this.config.animationTimeColumn ?? -1);
    const select = this.animationGrainSelect;
    select.replaceChildren();
    if (meta !== undefined && this.isFrameNumber(meta)) {
      this.animationStepLabel.textContent = "by";
      select.title = "Frames in the column's numeric order: one per value, or one per step";
      if (meta.stats.distinct <= MAX_FRAMES) select.append(el("option", { value: "value" }, ["each value"]) as HTMLOptionElement);
      for (const width of this.frameWidths(meta)) {
        select.append(el("option", { value: `step:${width}` }, [`steps of ${width.toLocaleString("en", { maximumFractionDigits: 6 })}`]) as HTMLOptionElement);
      }
      const step = this.config.animationStep ?? this.defaultFrameStep(meta);
      const wanted = step === "value" ? "value" : `step:${step}`;
      if (![...select.options].some((option) => option.value === wanted)) {
        select.append(el("option", { value: wanted }, [step === "value" ? "each value" : `steps of ${step}`]) as HTMLOptionElement);
      }
      select.value = wanted;
      return;
    }
    this.animationStepLabel.textContent = "every";
    select.title = "How much time each frame covers";
    for (const grain of ["hour", "day", "week", "month", "quarter", "year"] as TimeGrain[]) {
      select.append(el("option", { value: grain }, [grain.charAt(0).toUpperCase() + grain.slice(1)]) as HTMLOptionElement);
    }
    select.value = this.config.animationGrain ?? "day";
  }

  /** The frames to ask the worker for: the time grain for a date column, each value or steps for a number column. */
  private frameStep(): FrameStep {
    const meta = this.meta(this.config.animationTimeColumn ?? -1);
    if (meta !== undefined && this.isFrameNumber(meta)) {
      const step = this.config.animationStep ?? this.defaultFrameStep(meta);
      return step === "value" ? { kind: "value" } : { kind: "range", width: step };
    }
    return this.config.animationGrain ?? "day";
  }

  /** A slopegraph compares whole periods, so it buckets coarser than a time series. */
  private slopeGrainFor(column: number): TimeGrain {
    const meta = this.meta(column);
    const min = meta?.stats.min;
    const max = meta?.stats.max;
    if (typeof min !== "number" || typeof max !== "number" || !(max > min)) return "month";
    const days = (max - min) / 86_400_000;
    return days > 700 ? "year" : days > 270 ? "quarter" : days > 60 ? "month" : "week";
  }

  /** Sensible default frame length for a date column's span. */
  private defaultGrainFor(column: number): TimeGrain {
    return this.defaultStepFor(column).grain;
  }

  /**
   * Automatic bucket for a date column: a short span of timestamps gets minutes
   * or half-hours (about sixty points), longer ones day, week or month.
   */
  private defaultStepFor(column: number): { grain: TimeGrain; every: number } {
    const meta = this.meta(column);
    const min = meta?.stats.min;
    const max = meta?.stats.max;
    if (typeof min !== "number" || typeof max !== "number" || !(max > min)) return { grain: "month", every: 1 };
    const days = (max - min) / 86_400_000;
    if (days <= 2) {
      return meta?.type === "date" ? { grain: "day", every: 1 } : autoShortStep(max - min);
    }
    if (days <= 120) return { grain: "day", every: 1 };
    if (days <= 840) return { grain: "week", every: 1 };
    return { grain: "month", every: 1 };
  }

  /**
   * Fills a column select from the registry: columns that suit the slot first,
   * the rest under "Other" with the reason as a tooltip. Nothing is hidden.
   */
  private fillColumnSelect(
    select: HTMLSelectElement,
    allowed: readonly number[],
    slotIndex: number,
    leading: HTMLOptionElement[] = [],
  ): void {
    const fields = fieldsFor(this.config.kind, slotIndex, this.columns, this.rowCount);
    const reasons = new Map(fields.other.map((entry) => [entry.index, entry.reason]));
    const suggested = allowed.filter((index) => !reasons.has(index));
    const other = allowed.filter((index) => reasons.has(index));
    const make = (index: number): HTMLOptionElement => {
      const meta = this.columns[index];
      const option = this.option(String(index), `${meta.name} (${TYPE_LABELS[meta.type]})`);
      const reason = reasons.get(index);
      if (reason !== undefined) option.title = reason;
      return option;
    };
    select.replaceChildren(...leading);
    if (suggested.length > 0 && other.length > 0) {
      const good = el("optgroup", { label: "Suggested" }) as HTMLOptGroupElement;
      good.append(...suggested.map(make));
      const rest = el("optgroup", { label: "Other" }) as HTMLOptGroupElement;
      rest.append(...other.map(make));
      select.append(good, rest);
    } else {
      select.append(...allowed.map(make));
    }
  }

  option(value: string, label: string): HTMLOptionElement {
    return el("option", { value }, [label]) as HTMLOptionElement;
  }

  renderControls(): void {
    const kind = this.config.kind;
    const pair = isPairKind(kind);
    this.syncFieldVisibility();
    this.primaryTagLabel.textContent =
      kind === "histogram"
        ? "Values"
        : kind === "line"
          ? "Date"
          : kind === "kpi"
            ? "Date (optional)"
            : kind === "treemap"
              ? "Group by"
              : kind === "bar" || kind === "barplot" || kind === "dotplot" || kind === "stacked100"
                ? "Category"
                : kind === "terms"
                  ? "Text"
                  : "Column";
    const valueLabel = this.valueWrap.querySelector<HTMLElement>(".chart-tag-label");
    if (valueLabel !== null) valueLabel.textContent = kind === "treemap" ? "Size by" : "Value";
    const groupable = this.columns.some((meta) => isGroupable(meta));
    const measureKinds = VALUE_AGGREGATE_KINDS.includes(kind) || kind === "treemap";
    const grainKinds =
      kind === "line" ||
      kind === "smallmultiples" ||
      ((kind === "kpi" || kind === "slopegraph" || kind === "waterfall") &&
        this.isDateLike(this.meta(this.config.column)));
    const valueOn =
      measureKinds && this.config.source === "" && (this.config.valueColumn ?? -1) >= 0;
    const groupedValue =
      valueOn && SPLIT_KINDS.includes(kind);
    const seriesKind = kind === "scatter" || kind === "density";
    const mapKind = kind === "map";
    this.mapModeWrap.classList.toggle("hidden", !mapKind || this.config.mapMode === "heat" || this.config.mapMode === "regions");
    this.regions?.root.classList.toggle("hidden", !this.regionsOn());
    this.regions?.setDropActive(mapKind);
    this.regions?.setLanding(this.regionsOn());
    this.syncRegionAxes();
    this.colorWrap.classList.toggle("hidden", (!seriesKind && !mapKind) || this.regionsOn());
    this.sizeTagLabel.textContent =
      mapKind && this.config.mapMode === "heat" ? "Measure" : "Size";
    this.sizeWrap.classList.toggle(
      "hidden",
      !seriesKind && kind !== "treemap" && kind !== "bubble" && (!mapKind || this.regionsOn()),
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
    // Heat and contour lines belong to the density (heat map) render: with plain points they do nothing, so the control says so.
    const heatRender = kind === "density" || (kind === "scatter" && this.config.mode === "density");
    this.densityStyleSelect.disabled = !heatRender;
    this.densityStyleWrap.classList.toggle("disabled", !heatRender);
    this.densityStyleWrap.title = heatRender ? "" : "Only used when Render is set to Density (heat map)";
    this.colorGroup.classList.toggle("hidden", kind === "correlation");
    this.paletteGroup.classList.toggle("hidden", kind === "correlation");
    this.histogramSettings.classList.toggle("hidden", kind !== "histogram");
    this.syncErrorBarControls();
    this.barStackField.classList.toggle(
      "hidden",
      this.config.source !== ""
        ? kind === "pivotHeatmap" || (this.viewShape()?.series ?? -1) < 0
        : kind !== "barplot" || this.config.groupColumn < 0,
    );
    this.barSettings.classList.toggle(
      "hidden",
      kind !== "bar" &&
        kind !== "barplot" &&
        kind !== "box" &&
        kind !== "heatmap" &&
        kind !== "treemap" &&
        kind !== "bubble",
    );
    // Always there, so it can be found: grey says why it cannot run yet. Not truly disabled, or hover and focus could miss the reason.
    const animateBlock = this.animationBlock();
    this.animateButton.setAttribute("aria-disabled", String(animateBlock !== null));
    this.animateButton.title = animateBlock ?? "Step this chart through time";
    this.animateButton.classList.toggle("active", this.animationSetupOpen && animateBlock === null);
    this.animationSetup.classList.toggle("hidden", !(animateBlock === null && this.animationSetupOpen));
    const bubbleOnly = kind === "bubble";
    this.bubbleSettings.classList.toggle("hidden", !bubbleOnly && !mapKind);
    this.bubbleTitle.textContent = mapKind ? "Map" : "Bubbles";
    this.bubbleScaleField.classList.toggle("hidden", mapKind);
    if (this.config.mapMode !== "heat" && this.config.mapMode !== "regions") this.mapModeSelect.value = this.mapModeChoice();
    this.syncDotControls(mapKind, kind === "scatter");
    this.syncRefLines();
    this.syncKindButton();
    // On a map the grid only matters for the heat view: the plain dots need no cells.
    this.gridField.classList.toggle("hidden", mapKind && this.config.mapMode !== "heat");
    (this.gridField.firstElementChild as HTMLElement).textContent = mapKind ? "Heat cells" : "Grid";
    this.gridField.title = mapKind
      ? "Heat view only. The map is cut into this many cells across and down, and the rows in each cell are counted. Fewer cells (10 to 20): broad, smooth regions. More cells (80 to 120): fine detail, but each cell holds few rows so it looks patchy. 30 to 60 suits most data."
      : "Bubble view. The chart is cut into this many cells along each axis and the rows in each cell become one bubble. Fewer: bigger, smoother bubbles. More: finer, patchier.";
    this.bubbleBinsInput.title = mapKind
      ? "Heat cells across and down (4–120): fewer = coarse and smooth, more = fine and patchy"
      : "Bubble grid resolution per axis (4–120)";
    // Reduce stays visible so the option is discoverable; it only becomes
    // usable once a Size column is chosen.
    const reduceEnabled = this.config.sizeColumn >= 0;
    this.bubbleAggSelect.disabled = !reduceEnabled;
    this.bubbleAggField.title = reduceEnabled
      ? mapKind
        ? "How the rows in each grid cell or place combine into one value"
        : "How the rows in each area combine into one value"
      : "Pick a numeric column under Size first - then choose how rows combine";
    // Said on the page, not only in a tooltip: a greyed-out control with no reason reads as broken.
    this.bubbleAggHint.textContent = reduceEnabled ? "" : "(pick a Size column first)";
    if (!reduceEnabled) this.bubbleAggSelect.value = "count";
    this.topLabel.parentElement?.classList.toggle("hidden", bubbleOnly);
    this.multiInput.parentElement?.classList.toggle("hidden", bubbleOnly || kind === "barplot");
    this.correlationSettings.classList.toggle("hidden", kind !== "correlation");
    this.topLabel.textContent =
      kind === "bar" || kind === "barplot"
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
    this.settingsBody.classList.toggle("hidden", !this.canDraw() && !this.regionsOn());
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
  rampStopsFor(name: string): string[] {
    const stops = paletteStops(name, parseCustomColors(this.config.paletteCustom ?? ""));
    return this.config.paletteReversed === true ? [...stops].reverse() : stops;
  }

  /**
   * The single-series colour: the palette's first colour unless the user
   * picked one, so choosing a palette applies to every chart immediately.
   */
  primaryColor(): string {
    if (this.config.colorCustom === true) return this.config.color;
    return this.paletteColor(0, 1) || this.config.color;
  }

  private paletteColor(index: number, count = 12): string {
    const colors = this.paletteColors(count);
    return colors[index % colors.length] ?? this.primaryColor();
  }

  private regionOptions(requests: RegionRequests): MapRegionsOptions {
    return regionOptions(this, requests);
  }

  setMapMode(mode: "points" | "heat" | "places" | "regions"): void {
    return setMapMode(this, mode);
  }

  /** The current kind of map, and news of it changing, for the Map page's picker. */
  get mapMode(): "points" | "heat" | "places" | "regions" {
    return this.config.mapMode ?? DEFAULT_MAP_MODE;
  }

  onMapModeChange: ((mode: "points" | "heat" | "places" | "regions") => void) | null = null;

  syncRegionAxes(): void {
    return syncRegionAxes(this);
  }

  /** News for the Map page, whose "no coordinates" notice does not apply to regions. */
  onRegionsChange: ((showing: boolean) => void) | null = null;

  regionsOn(): boolean {
    return this.config.kind === "map" && this.config.mapMode === "regions";
  }

  /** Blue for low and red for high on a map coloured by a number, unless a palette was chosen. */
  private rampPaletteName(): string {
    const chosen = this.config.palette ?? DEFAULT_PALETTE;
    const meta = this.meta(this.config.colorColumn);
    // A list of separate colours cannot show low to high, so it is no choice for this.
    return !isRampPalette(chosen) && this.config.kind === "map" && meta !== undefined && isNumericType(meta.type) ? "Blue to red" : chosen;
  }

  /** The colour maps on offer: a short list, always with the one in use; every map once asked for. */
  private fillPaletteOptions(all: boolean): void {
    const current = this.rampPaletteName();
    const shown = (name: string): boolean => all || SHORT_PALETTES.includes(name) || name === current;
    this.paletteSelect.replaceChildren();
    const groups: [string, "qualitative" | "sequential" | "diverging"][] = [
      ["Qualitative", "qualitative"],
      ["Sequential", "sequential"],
      ["Diverging", "diverging"],
    ];
    for (const [label, kind] of groups) {
      const entries = PALETTES.filter((palette) => palette.kind === kind && shown(palette.name));
      if (entries.length === 0) continue;
      const group = el("optgroup", { label }) as HTMLOptGroupElement;
      for (const palette of entries) group.append(el("option", { value: palette.name }, [palette.name]) as HTMLOptionElement);
      this.paletteSelect.append(group);
    }
    if (!all) this.paletteSelect.append(el("option", { value: MORE_PALETTES }, ["More colour maps…"]) as HTMLOptionElement);
    this.paletteSelect.append(el("option", { value: CUSTOM_PALETTE }, ["Custom…"]) as HTMLOptionElement);
  }

  private syncPalette(): void {
    // A map chosen elsewhere (a spec, undo) that the short list leaves out joins it.
    if (![...this.paletteSelect.options].some((option) => option.value === this.rampPaletteName())) {
      this.fillPaletteOptions(false);
    }
    this.paletteSelect.value = this.rampPaletteName();
    this.paletteReverseInput.checked = this.config.paletteReversed === true;
    clear(this.palettePreview);
    for (const color of this.paletteColors(10)) {
      const dot = el("span", { class: "chart-palette-dot" });
      dot.style.background = color;
      this.palettePreview.append(dot);
    }
    const colorMeta = this.meta(this.config.colorColumn);
    const numericColor =
      colorMeta !== undefined &&
      this.config.colorColumn >= 0 &&
      !isCategoryType(colorMeta.type) &&
      colorMeta.type !== "boolean";
    const ramp =
      isRampPalette(this.rampPaletteName()) ||
      this.config.kind === "pivotHeatmap" ||
      numericColor;
    this.colorDomainRow.classList.toggle("hidden", !ramp);
    this.colorMinInput.value =
      this.config.colorMin === null || this.config.colorMin === undefined
        ? ""
        : String(this.config.colorMin);
    this.colorMaxInput.value =
      this.config.colorMax === null || this.config.colorMax === undefined
        ? ""
        : String(this.config.colorMax);
    this.colorCenterInput.value =
      this.config.colorCenter === null || this.config.colorCenter === undefined
        ? ""
        : String(this.config.colorCenter);
  }

  /** Loads a palette from JSON text: array of hex colours or {colors: [...]}. */
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
  confirmRemove(): void {
    void openConfirm({
      title: "Remove this chart?",
      body: `“${this.chartName()}” will be removed with its tab. Chart settings are not part of the Recipe, so this cannot be undone with Undo.`,
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

  /** The title as shown: the person's own, or the one the chart's fields give it. */
  displayTitle(): string {
    const own = this.config.title.trim();
    return own === "" ? this.defaultTitle() : own;
  }

  /** Renames the chart; an empty name goes back to the automatic title. */
  setTitle(title: string): void {
    this.config.title = title;
    this.titleInput.value = title;
    this.render();
    this.options.onTitleChange?.(this);
  }

  /** "average_price over date", "total_volume by geography": what an aggregate chart shows, for its tab and placeholder. */
  private aggregateTitle(): string {
    if (this.config.source !== "") return this.sources.find((source) => source.id === this.config.source)?.name ?? "View";
    const measure = this.meta(this.config.valueColumn ?? -1)?.name ?? "Rows";
    const dimension = this.meta(this.config.column)?.name;
    const group = this.meta(this.config.groupColumn)?.name;
    if (dimension === undefined) return measure;
    const link = this.isDateLike(this.meta(this.config.column)) ? "over" : "by";
    return `${measure} ${link} ${dimension}${group === undefined ? "" : ` by ${group}`}`;
  }

  private defaultTitle(): string {
    if (this.config.kind === "kpi") {
      const measure = this.meta(this.config.valueColumn ?? -1)?.name ?? "Count of rows";
      return defaultChartTitle(measure);
    }
    if (this.config.kind === "pivotHeatmap") {
      const data = this.pivotHeatmapData();
      return data === null
        ? "Pivot heatmap"
        : defaultChartTitle(`${data.measureName} by ${data.rowName} x ${data.colName}`);
    }
    if (this.usesAggregate()) return this.aggregateTitle();
    if (this.config.kind === "map") return "Map";
    if (isPairKind(this.config.kind)) {
      return defaultChartTitle(this.pairLabel("vs"));
    }
    if (this.config.kind === "correlation") {
      return defaultChartTitle("Correlation");
    }
    return defaultChartTitle(this.meta(this.config.column)?.name ?? "");
  }

  /** The series a line card plots, when the Time Series page can read it. */
  private seriesTarget(): ChartSeriesTarget | null {
    if (this.config.kind !== "line" || this.config.source !== "" || this.options.onDeepDive === undefined) return null;
    if (this.options.research?.() === false) return null;
    if (!this.isDateLike(this.meta(this.config.column))) return null;
    const value = this.config.valueColumn ?? -1;
    return {
      dateColumn: this.config.column,
      groupColumn: this.config.groupColumn,
      valueColumn: value >= 0 && this.meta(value) !== undefined ? value : -1,
      valueAgg: this.config.valueAgg,
      // The bucket the value line draws (count lines bin by span, so the page picks).
      grain: value >= 0 ? this.resolvedGrain() : "auto",
      every: value >= 0 ? this.everyFor(this.resolvedGrain()) : 1,
    };
  }

  /** Line cards point to the Time Series page for trend, seasons and a forecast; map cards to the Map page. */
  private syncDeepDive(): void {
    if (this.config.kind === "map") {
      const on = this.options.onOpenMap !== undefined && this.options.research?.() !== false;
      const key = on ? "map" : "";
      if (this.deepDiveEl.dataset.key === key) return;
      this.deepDiveEl.dataset.key = key;
      clear(this.deepDiveEl);
      this.deepDiveEl.classList.toggle("hidden", !on);
      if (!on) return;
      const button = el(
        "button",
        { class: "chart-deep-dive-link", type: "button", title: "Open this map on the Map page" },
        ["Open in Map →"],
      ) as HTMLButtonElement;
      button.addEventListener("click", () => this.options.onOpenMap?.(this.getConfig()));
      this.deepDiveEl.append(el("span", {}, ["Full width, with your own offline map picture underneath."]), button);
      return;
    }
    const target = this.seriesTarget();
    const key = target === null ? "" : JSON.stringify(target);
    if (this.deepDiveEl.dataset.key === key) return;
    this.deepDiveEl.dataset.key = key;
    clear(this.deepDiveEl);
    this.deepDiveEl.classList.toggle("hidden", target === null);
    if (target === null) return;
    const group = this.meta(target.groupColumn)?.name;
    const button = el(
      "button",
      { class: "chart-deep-dive-link", type: "button", title: "Open this series on the Time Series page" },
      ["Open in Time Series →"],
    ) as HTMLButtonElement;
    button.addEventListener("click", () => {
      const current = this.seriesTarget();
      if (current !== null) this.options.onDeepDive?.(current);
    });
    this.deepDiveEl.append(
      el("span", {}, [
        group === undefined
          ? "Deep dive on this series: trend, seasons, typical day and a forecast."
          : `Deep dive on one ${group} at a time: trend, seasons, typical day and a forecast.`,
      ]),
      button,
    );
  }

  /** Duplicate, PNG and remove live behind one ⋯ menu, plus the red ×. */
  private openCardMenu(anchor: HTMLElement): void {
    const pivotHeatmap = this.config.kind === "pivotHeatmap";
    const region = this.lastActionRegion;
    const filters = region === null ? [] : tableFiltersForHitActions(region.actions);
    const selectionLabel = region?.lines[0] ?? "the current selection";
    openMenu(
      anchor,
      [
        {
          label: "Put back everything left out",
          title: "Right-click a bar, box, bin or legend entry to leave it out of this chart",
          disabled: this.excludes().length === 0,
          action: () => this.setExcludes([]),
        },
        {
          label: "Edit chart",
          title: "Edit this chart in the shared setup dialog",
          disabled: this.options.onEdit === undefined,
          action: () => this.options.onEdit?.(this),
        },
        {
          label: "Reset to suggested",
          title: "Rebuild this card from the suggested fields for its chart type",
          disabled: this.options.onResetSuggested === undefined || pivotHeatmap,
          action: () => this.options.onResetSuggested?.(this),
        },
        {
          label: "Filter table to selection",
          title: `Add visible table filters for ${selectionLabel}`,
          disabled: filters.length === 0 || this.options.onFilterTable === undefined,
          action: () => this.options.onFilterTable?.(filters, selectionLabel),
        },
        {
          label: "Show underlying rows",
          title: `Switch to the table with rows filtered to ${selectionLabel}`,
          disabled: filters.length === 0 || this.options.onShowRows === undefined,
          action: () => this.options.onShowRows?.(filters, selectionLabel),
        },
        {
          label: "Drill to finer grain",
          title: "Add a finer-grained or broken-down version of this selection",
          disabled: region === null || this.options.onDrill === undefined,
          action: () => this.options.onDrill?.(this, filters, selectionLabel),
        },
        {
          label: "Break down by another field",
          title: "Open the chart builder for a new breakdown",
          disabled: this.options.onBreakDown === undefined,
          action: () => this.options.onBreakDown?.(this),
        },
        // The Time Series page is a Research view: General mode leaves the item out.
        ...(this.options.research?.() === false
          ? []
          : [
              {
                label: "Open in Time Series",
                title: "Trend, seasons, typical day and a forecast for this series",
                disabled: this.seriesTarget() === null,
                action: () => {
                  const target = this.seriesTarget();
                  if (target !== null) this.options.onDeepDive?.(target);
                },
              },
            ]),
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
          disabled: pivotHeatmap,
          action: () => this.downloadChartSpec(),
        },
        {
          label: "Apply chart spec (JSON)",
          title: "Validate and apply a previously downloaded chart spec",
          disabled: pivotHeatmap,
          action: () => this.importChartSpecFile(),
        },
        {
          label: "Download pandas code",
          title: "Download Python that rebuilds the supported chart aggregation",
          disabled: pivotHeatmap,
          action: () => this.downloadChartCode(true),
        },
        {
          label: "Download Polars code",
          title: "Download Polars code that rebuilds the supported chart aggregation",
          disabled: pivotHeatmap,
          action: () => this.downloadChartCode(false),
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

  refreshBins(): void {
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
      const signature = `${this.config.column}|${binCount}|${min}|${max}|${JSON.stringify(this.excludes())}`;
      if (this.lineBinSignature === signature && this.lineBinResult !== null) return;
      this.lineBinSignature = signature;
      const generation = ++this.generation;
      this.lineBinRange = { min, max };
      void this.options
        .requestBins(
          this.config.column,
          { min, max, binCount, overflow: false },
          this.excludes().length > 0 ? this.excludes() : undefined,
        )
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
      .requestBins(column, binOptions, this.excludes().length > 0 ? this.excludes() : undefined)
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
    // Live count bars come straight from the table facets, so excluded values
    // are simply left out and the shares are recomputed from what remains.
    const gone = this.excludedLabels(this.config.column);
    const total = categories.labels.reduce(
      (sum, label, index) => (gone.has(label) ? sum : sum + (counts[index] ?? 0)),
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
      .filter((bar) => !gone.has(bar.label))
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
  chartScope(): {
    chartFilter?: { column: number; code: number };
    chartExclude?: ChartExclusion[];
    respectFilters: boolean;
  } {
    const column = this.config.filterColumn ?? -1;
    const code = this.config.filterCode ?? -1;
    return {
      ...(column >= 0 && code >= 0 ? { chartFilter: { column, code } } : {}),
      ...this.excludeScope(),
      respectFilters: this.config.respectFilters !== false,
    };
  }

  private excludes(): ChartExclusion[] {
    return this.config.excludes ?? [];
  }

  /** The `chartExclude` field for worker requests (absent when nothing is excluded). */
  private excludeScope(): { chartExclude?: ChartExclusion[] } {
    const list = this.excludes();
    return list.length > 0 ? { chartExclude: list } : {};
  }

  refreshSeries(): void {
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
      this.config.kind === "density" ? "density" : map ? "points" : this.config.mode === "auto" ? "points" : this.config.mode;
    const places = map && this.config.mapMode === "places" ? { agg: this.config.bubbleAgg ?? "count", colorAgg: this.config.mapColorAgg ?? "mean", ...(this.mapLabelColumn() >= 0 ? { labelColumn: this.mapLabelColumn() } : {}) } : undefined;
    void this.options
      .requestSeries({
        ...(places ? { places } : {}),
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
        this.placeLabels = message.placeLabels ?? null;
        this.seriesMs = message.ms;
        this.seriesCorrelation = message.correlation;
        this.render();
      })
      .catch(() => {
        // Keep the last payload as the fallback.
      });
  }

  /**
   * Treemap data: always one aggregation over the group column. The measure is
   * count(*) unless a numeric column is chosen; a row-count measure rides along
   * so every tile tooltip can show the rows behind its area.
   */
  private refreshTreemap(): void {
    if (this.config.kind !== "treemap") {
      this.treemapResult = null;
      return;
    }
    const meta = this.meta(this.config.column);
    if (meta === undefined || !this.allowsPrimary(meta)) {
      this.treemapResult = null;
      return;
    }
    const measureColumn = this.config.valueColumn ?? -1;
    const requestedAgg = this.config.valueAgg ?? "sum";
    const agg: Aggregate = [
      "count",
      "distinct",
      "sum",
      "mean",
      "median",
      "min",
      "max",
    ].includes(requestedAgg)
      ? (requestedAgg as Aggregate)
      : "sum";
    const measure: MeasureSpec =
      measureColumn >= 0
        ? { column: measureColumn, agg }
        : { column: null, agg: "count" };
    const generation = ++this.generation;
    const view: ViewDef = {
      id: "chart-treemap",
      name: "Treemap",
      dimensions: [{ column: this.config.column, by: "value" }],
      measures: [measure, { column: null, agg: "count" }],
      fill: "none",
      sort: { key: "m0", dir: "desc" },
      limit: 5000,
      respectFilters: this.config.respectFilters !== false,
      filterColumn: this.config.filterColumn ?? -1,
      filterCode: this.config.filterCode ?? -1,
      ...(this.excludes().length > 0 ? { exclude: this.excludes() } : {}),
    };
    void this.options
      .requestAggregate(view)
      .then((message) => {
        if (generation !== this.generation || this.disposed) return;
        this.treemapResult = {
          labels: message.labels,
          values: [...(message.measures[0] ?? new Float64Array(0))],
          rows: [...(message.measures[1] ?? new Float64Array(0))],
          totalGroups: message.totalGroups,
          truncated: message.truncated,
        };
        this.render();
      })
      .catch(() => {
        // Keep the last payload as the fallback.
      });
  }

  private drawTreemap(ctx: CanvasRenderingContext2D, frame: Frame): void {
    const meta = this.meta(this.config.column);
    if (meta === undefined || !this.allowsPrimary(meta)) {
      const message = "Treemaps need a category or text column — pick one above.";
      this.noteEl.textContent = message;
      this.drawPlotMessage(ctx, frame, message);
      return;
    }
    if (this.animationResult?.bar !== undefined) {
      this.drawAnimatedTreemap(ctx, frame);
      return;
    }

    const measureColumn = this.config.valueColumn ?? -1;
    const measureMeta = this.meta(measureColumn);
    const measured = measureColumn >= 0 && measureMeta !== undefined;
    const measureLabel = measured
      ? `${
          this.aggPhrase()
        } of ${measureMeta.name}`
      : "Count of rows";
    const result = this.treemapResult;
    if (result === null) {
      const message = "Grouping the rows…";
      this.noteEl.textContent = message;
      this.drawPlotMessage(ctx, frame, message);
      return;
    }
    const entries = result.labels
      .map((label, index) => ({
        label,
        value: result.values[index] ?? 0,
        rows: result.rows[index] ?? 0,
        code: meta.categories?.labels.indexOf(label) ?? -1,
      }))
      .filter((entry) => entry.value > 0);
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
        const rows = rest.reduce((sum, entry) => sum + entry.rows, 0);
        shown.push({ label: `Other (${rest.length})`, value, rows, code: -1 });
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
      const entry = shown[index] ?? { label: "", value: 0, rows: 0, code: -1 };
      const share = total > 0 ? (entry.value / total) * 100 : 0;
      return {
        x: rect.x,
        y: rect.y,
        w: rect.w,
        h: rect.h,
        lines: [
          entry.label === "" ? "(blank)" : entry.label,
          measured
            ? `${measureLabel} · ${formatChartNumber(entry.value)} · ${share.toFixed(
                1,
              )}% of total · ${formatCount(entry.rows)} rows`
            : `${formatCount(entry.value)} rows · ${share.toFixed(1)}% of total`,
        ],
        actions:
          entry.code >= 0
            ? [{ kind: "values" as const, column: this.config.column, code: entry.code }]
            : meta.type === "string"
              ? [{ kind: "text" as const, column: this.config.column, query: entry.label }]
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

    const notes = [`${shown.length} tiles`, measureLabel];
    notes.push(
      measured
        ? `${formatChartNumber(total)} total`
        : `${formatCount(total)} rows`,
    );
    if (windowed) {
      notes.push(`${shown.length} of ${entries.length} tiles shown`);
    } else {
      const restCount = Math.max(0, entries.length - Math.min(entries.length, cap));
      if (restCount > 0) notes.push(`${restCount} rest as Other`);
    }
    if (result.truncated) {
      notes.push(
        `top ${entries.length.toLocaleString()} of ${result.totalGroups.toLocaleString()} groups — narrow the group column for full coverage`,
      );
    } else if (meta.type === "string" && meta.stats.distinct > cap) {
      notes.push("high-cardinality text · top tiles + Other");
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
    const goneTerms = this.excludedTerms(this.config.column);
    const baseTerms = profile.topTerms
      .filter((entry) => !goneTerms.has(entry.term.toLowerCase()))
      .slice(0, Math.max(8, this.config.topN));
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
      !isGroupable(category)
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
      !isGroupable(x) ||
      !isGroupable(y)
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
  bubbleMeasure(): { column: number; agg: "sum" | "mean" | "min" | "max" } | undefined {
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
    return meta !== undefined && isGroupable(meta) ? this.config.groupColumn : undefined;
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

  refreshMapGrid(): void {
    return refreshMapGrid(this);
  }

  /**
   * Frames for animated bar and bubble charts: one aggregate per time bucket,
   * computed worker-side in a single pass over the filtered rows.
   */
  refreshAnimation(): void {
    this.stopAnimation();
    const timeColumn = this.config.animationTimeColumn ?? -1;
    if (this.regionsOn()) {
      // The regions work out their own values per period; onFrames brings the periods back.
      if (timeColumn < 0) this.animationResult = null;
      this.regions?.setTime(timeColumn < 0 || !this.isDateLike(this.meta(timeColumn)) ? null : { column: timeColumn, grain: this.config.animationGrain ?? "day" });
      return;
    }
    this.regions?.setTime(null);
    const kind = this.config.kind;
    const animatable =
      kind === "bar" ||
      kind === "bubble" ||
      kind === "histogram" ||
      kind === "treemap" ||
      kind === "density" ||
      this.animatesPlaces();
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
    if (!this.isDateLike(timeMeta) && !this.isFrameNumber(timeMeta)) {
      this.animationResult = null;
      return;
    }
    const isPair = kind === "bubble" || kind === "density" || kind === "map";
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
      if (column === undefined || !isGroupable(column)) {
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
    const colorMeta = this.meta(this.config.colorColumn);
    const chart: "bar" | "bubble" | "histogram" | "places" = kind === "map"
      ? "places"
      : isPair
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
      grain: this.frameStep(),
      chart,
      column: isPair ? this.config.x : this.config.column,
      yColumn: isPair ? this.config.y : -1,
      bins: chart === "histogram" ? histogramBins : chart === "places" ? POINT_LIMIT : (this.config.bubbleBins ?? 40),
      topN: this.config.topN,
      measure: isPair ? this.bubbleMeasure() : undefined,
      // Density is a single aggregate heat map, so grouping is ignored there;
      // bubble charts carry the group dimension.
      groupColumn: kind === "bubble" ? this.bubbleGroupColumn() : undefined,
      colorMeasure:
        chart === "places" && colorMeta !== undefined && isNumericType(colorMeta.type)
          ? { column: this.config.colorColumn, agg: this.config.mapColorAgg ?? "mean" }
          : undefined,
      ...(chart === "places" && this.mapLabelColumn() >= 0 ? { labelColumn: this.mapLabelColumn() } : {}),
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

  errorBarBlock(): string | null {
    return errorBarBlock(this);
  }

  /** The kind of bar in use: the one chosen when it suits the statistic, else the natural one. */
  errorBarKind(): IntervalKind {
    const agg = this.config.valueAgg ?? "mean";
    const chosen = this.config.errorBarKind;
    return chosen !== undefined && intervalBlock(chosen, agg) === null ? chosen : defaultInterval(agg);
  }

  errorBarsOn(): boolean {
    return this.config.errorBars === true && ERROR_BAR_KINDS.has(this.config.kind) && this.errorBarBlock() === null;
  }

  private syncResearchControls(): void {
    return syncResearchControls(this);
  }

  syncErrorBarControls(): void {
    return syncErrorBarControls(this);
  }

  private refreshErrorBars(): void {
    return refreshErrorBars(this);
  }

  cancelErrorBars(): void {
    return cancelErrorBars(this);
  }

  showErrorBarProgress(progress: ErrorBarsProgressMessage | null): void {
    return showErrorBarProgress(this, progress);
  }

  hideErrorBarProgress(): void {
    return hideErrorBarProgress(this);
  }

  private errorBarAt(result: AggregateMessage, index: number): { low: number; high: number; n: number } | null {
    return errorBarAt(this, result, index);
  }

  errorBarName(): string {
    const kind = this.errorBarKind();
    return kind === "ci" ? "95% CI" : kind === "bootstrap" ? "95% CI (bootstrap)" : kind === "se" ? "± 1 standard error" : kind === "sd" ? "± 1 standard deviation" : "Middle 95% of rows";
  }

  /** The bar's end in tooltips. */
  private errorBarLine(result: AggregateMessage, index: number): string[] {
    const bar = this.errorBarAt(result, index);
    return bar === null ? [] : [`${this.errorBarName()}: ${formatChartNumber(bar.low)} to ${formatChartNumber(bar.high)}`, `${bar.n.toLocaleString()} rows`];
  }

  private drawWhisker(ctx: CanvasRenderingContext2D, frame: Frame, x0: number, y0: number, x1: number, y1: number): void {
    return drawWhisker(this, ctx, frame, x0, y0, x1, y1);
  }

  private appendErrorBarNote(result: AggregateMessage | null): void {
    return appendErrorBarNote(this, result);
  }

  /** A map animates its places: each dot stays put while its size and colour change. */
  animatesPlaces(): boolean {
    return this.config.kind === "map" && (this.config.mapMode ?? DEFAULT_MAP_MODE) === "places";
  }

  placeFrame(): SeriesPoints | null {
    return placeFrame(this);
  }

  /** Why this chart cannot step through time right now; null when it can. */
  private animationBlock(): string | null {
    const kind = this.config.kind;
    if (this.regionsOn()) return this.regions?.ready === true ? (this.columns.some((meta) => this.isDateLike(meta)) ? null : "Animating needs a date or datetime column. If yours was read as text, use Convert types") : "Load a boundary file first";
    if (kind === "map" && !this.animatesPlaces()) return "To animate a map, set Show to One dot per place or Regions";
    if (!ANIMATED_KINDS.has(kind)) {
      return `${CHART_KIND_LABELS[kind]} charts can't animate. Bar, Bubble, Histogram, Treemap, Density and Map can`;
    }
    if (this.config.source !== "") return "Charts from a Pivot View can't animate: set Source to Table";
    if (!this.columns.some((meta) => this.isDateLike(meta) || this.isFrameNumber(meta))) {
      return "Animating needs a date or number column to step through. If yours was read as text, use Convert types";
    }
    if (kind === "bubble" || kind === "density" || kind === "map") {
      const x = this.meta(this.config.x);
      const y = this.meta(this.config.y);
      if (x === undefined || y === undefined || !isNumericType(x.type) || !isNumericType(y.type)) {
        return kind === "map" ? "Choose numeric longitude and latitude columns first" : "Choose numeric X and Y columns first";
      }
      return null;
    }
    const column = this.meta(this.config.column);
    if (kind === "histogram") return column !== undefined && isNumericType(column.type) ? null : "Choose a numeric column first";
    return column !== undefined && isGroupable(column) ? null : "Choose a category column first";
  }

  private setAnimationTime(column: number): void {
    this.config.animationTimeColumn = column;
    const meta = this.meta(column);
    if (meta !== undefined && this.isFrameNumber(meta)) this.config.animationStep = this.defaultFrameStep(meta);
    else if (column >= 0) this.config.animationGrain = this.defaultGrainFor(column);
    this.syncFrameOptions();
    this.animationTimeSelect.value = String(column);
    this.stopAnimation();
    this.generation++;
    this.refreshAnimation();
    this.render();
  }

  private toggleAnimationSetup(): void {
    const blocked = this.animationBlock();
    if (blocked !== null) {
      this.noteEl.textContent = `${blocked}.`;
      return;
    }
    this.animationSetupOpen = !this.animationSetupOpen;
    this.renderControls();
    // One click starts it: the first date column (else the first number column) is ready to play; the row beside it can change that or turn it off.
    if (this.animationSetupOpen && (this.config.animationTimeColumn ?? -1) < 0) {
      let first = this.columns.findIndex((meta) => this.isDateLike(meta));
      if (first < 0 && !this.regionsOn()) first = this.columns.findIndex((meta) => this.isFrameNumber(meta));
      if (first >= 0) this.setAnimationTime(first);
    }
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

  stopAnimation(): void {
    if (this.animationTimer !== null) {
      window.clearInterval(this.animationTimer);
      this.animationTimer = null;
    }
    this.animationPlaying = false;
    this.syncAnimationBar();
  }

  /** Playback bar state: visible only while frames exist. */
  syncAnimationBar(): void {
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
    const spec = this.getSpec();
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
    const spec = this.getSpec();
    const generated = pandas ? chartSpecToPandas(spec) : chartSpecToPolars(spec);
    if (generated.code === "") {
      this.noteEl.textContent =
        generated.warnings[0] ?? "No code can be generated for this chart yet.";
      return;
    }
    if (generated.warnings.length > 0) {
      this.noteEl.textContent = `${generated.warnings.length} support note${generated.warnings.length === 1 ? "" : "s"} included in the file.`;
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
      !isGroupable(groupMeta)
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
    void request({ column, groupColumn, options, topN: GROUP_LINE_LIMIT, ...this.excludeScope() })
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
        // A -> B -> A: the canvas height follows its width, so a scrollbar that
        // appears at one height and vanishes at the other would repaint forever.
        if (width === this.prevWrapWidth) return;
      }
      this.render();
    };
    if (typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(run);
    } else {
      window.setTimeout(run, 16);
    }
  }

  render(): void {
    if (this.options.sectionedSettings === true) this.dataDrawer.schedule();
    this.options.onTitleChange?.(this);
    this.syncScope();
    this.syncDeepDive();
    this.canvas.setAttribute("aria-label", this.canvasLabel());
    const wrap = this.canvas.parentElement;
    // Not laid out yet (detached or hidden lens): painting would size the canvas
    // to 1x1 and blank it. The ResizeObserver repaints once it has a width.
    if (wrap !== null && wrap.isConnected && wrap.clientWidth <= 1) return;
    let cssWidth = 640;
    if (wrap !== null) {
      const style = getComputedStyle(wrap);
      const padding =
        (Number.parseFloat(style.paddingLeft) || 0) + (Number.parseFloat(style.paddingRight) || 0);
      cssWidth = wrap.clientWidth - padding;
      const wrapWidth = Math.round(wrap.clientWidth);
      if (wrapWidth !== this.lastWrapWidth) this.prevWrapWidth = this.lastWrapWidth;
      this.lastWrapWidth = wrapWidth;
    }
    // The canvas follows the card at any width; text has a legibility floor
    // instead of the old 300px minimum that overflowed narrow cards.
    cssWidth = Math.max(1, Math.round(cssWidth));
    // 16:9, but never taller than the window allows: a full-width card or an expanded one
    // would otherwise push its own controls off screen. A map is the page's subject and a
    // world is twice as wide as tall, so it gets 16:10 and everything the controls leave,
    // not the half window that flattened it to a strip.
    const roomy = this.config.kind === "map" && this.focusOverlay === null;
    let cap = roomy
      ? Math.max(380, window.innerHeight - 200)
      : Math.max(260, Math.round(window.innerHeight * (this.focusOverlay !== null ? 0.72 : 0.55)));
    let cssHeight = Math.min(Math.round(roomy ? cssWidth * 0.625 : (cssWidth * 9) / 16), cap);
    if (this.options.docked === true && this.focusOverlay === null && wrap !== null) {
      // The plot takes what the window has left below it, so the whole chart is in view at once.
      const scroller = this.root.closest(".workspace-body");
      const top = wrap.getBoundingClientRect().top + (scroller?.scrollTop ?? 0);
      this.dockedTop = top;
      // The playback bar sits under the plot when there are frames to step through.
      const playback = (this.animationResult?.frames.length ?? 0) > 1 ? 48 : 0;
      cap = Math.max(300, Math.round(window.innerHeight - top - 74 - playback));
      cssHeight = Math.min(cap, Math.round(cssWidth * 0.8));
    }
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
    this.brushSpace = null;
    this.valueScale = null;
    this.drawChart(ctx, cssWidth, cssHeight);
    this.drawReferenceLines(ctx);
    this.drawBrushOverlay(ctx);
    this.drawSelection(ctx);
    // Drawing can add a legend above the plot; then the height above was worked out too low.
    if (this.options.docked === true && this.focusOverlay === null && wrap !== null) {
      const scroller = this.root.closest(".workspace-body");
      const top = wrap.getBoundingClientRect().top + (scroller?.scrollTop ?? 0);
      if (top !== this.dockedTop) this.scheduleRender(true);
    }
    this.drawLinkedOverlay(ctx);
    if (this.brushSpace !== null && this.noteEl.textContent?.includes("Shift+drag") !== true) {
      // Appended, not rewritten from the text: the note can hold a link (the density map, one dot per place) that must stay one.
      this.noteEl.append(this.noteEl.textContent === "" ? "Shift+drag to filter" : " · Shift+drag to filter");
    }
    this.syncDataIssues();
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
    const isMap = this.config.kind === "map";
    this.mapControls.classList.toggle("hidden", !isMap);
    this.resetViewButton.classList.toggle(
      "hidden",
      isMap ||
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
          ? `Line chart of ${name(this.config.column)}, ${rows} rows shown`
          : `Line chart of ${name(this.config.column)} by ${group.name}, ${rows} rows shown`;
      }
      case "bar":
        return `Bar chart of ${name(this.config.column)} (a count of rows), ${rows} rows shown`;
      case "dotplot":
      case "stacked100":
      case "smallmultiples":
      case "slopegraph":
      case "waterfall": {
        const group = this.meta(this.config.groupColumn);
        return `${CHART_KIND_LABELS[this.config.kind]} of ${this.config.valueAgg ?? "mean"}(${name(
          this.config.valueColumn ?? -1,
        )}) by ${name(this.config.column)}${group === undefined ? "" : ` and ${group.name}`}, ${rows} rows shown`;
      }
      case "barplot":
        return `Bar chart of ${this.config.valueAgg ?? "mean"}(${name(
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
    if (this.brushDrag !== null) {
      this.dragMoved = true;
      this.brushDrag = {
        ...this.brushDrag,
        x1: event.clientX - rect.left,
        y1: event.clientY - rect.top,
      };
      this.hideTooltip();
      this.render();
      return;
    }
    if (this.config.kind === "map" && this.mapDrag !== null && this.lastFrame !== null) {
      const frame = this.lastFrame;
      const dx = (event.clientX - rect.left - this.mapDrag.x) / frame.plotW;
      const dy = (event.clientY - rect.top - this.mapDrag.y) / frame.plotH;
      this.dragMoved = true;
      this.mapDrag = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      const view = this.mapViewShown();
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
      const slot = frame.plotW / Math.max(1, state.count - 1);
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
    this.lastActionRegion = region;
    this.emitHighlight(region.actions, region.lines[0] ?? "");
    clear(this.tooltipEl);
    const title = el("div", { class: "chart-tooltip-title" }, [region.lines[0] ?? "Value"]);
    this.tooltipEl.append(title);
    for (const line of region.lines.slice(1)) {
      this.tooltipEl.append(el("div", { class: "chart-tooltip-row" }, [line]));
    }
    const details: string[] = [];
    const valueMeta = this.meta(this.config.valueColumn ?? -1);
    if (valueMeta !== undefined) {
      details.push(
        `${this.aggPhrase()} of ${valueMeta.name}`,
      );
    }
    if (this.config.valueGrain !== undefined && this.config.valueGrain !== "auto") {
      details.push(`Bucket: ${describeStep(this.config.valueGrain, this.everyFor(this.config.valueGrain))}`);
    }
    if (this.config.binOptions !== null && this.config.kind === "histogram") {
      details.push(`Bins: ${this.config.binOptions.binCount}`);
    }
    if (this.config.groupColumn >= 0) {
      details.push(`Grouped by ${this.meta(this.config.groupColumn)?.name ?? "group"}`);
    }
    details.push(this.scopeEl.textContent ?? "");
    if (this.canExclude() && (region.actions.length > 0 || (region.contextActions?.length ?? 0) > 0)) {
      details.push("Right-click to leave this out of this chart");
    }
    this.tooltipEl.append(
      el(
        "div",
        { class: "chart-tooltip-detail" },
        details.filter((line) => line.trim() !== "").map((line) => el("div", {}, [line])),
      ),
    );
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

  /** Tells the panel which slice the pointer is over (null when it leaves a mark). */
  private emitHighlight(actions: readonly HitAction[] | null, label = ""): void {
    const usable = actions !== null && actions.length > 0 ? actions : null;
    const key = usable === null ? "" : JSON.stringify(usable);
    if (key === this.emittedKey) return;
    this.emittedKey = key;
    this.options.onHighlight?.(this, usable, label);
  }

  /**
   * Another card's hovered slice. Marks here over the same column are outlined; marks
   * over a different column are redrawn with the slice's share of each (a hovered
   * region in a bar chart shows its share of every week, bin and category here).
   */
  setLinkedHighlight(actions: readonly HitAction[] | null, label = ""): void {
    if (JSON.stringify(actions) === JSON.stringify(this.linked)) return;
    this.linked = actions;
    this.linkedLabel = label;
    this.cancelSliceFetch();
    if (actions !== null) this.scheduleSliceFetch(actions);
    const matches =
      actions !== null && this.hitRegions.some((region) => actionsOverlap(actions, region.actions));
    if (actions === null) {
      this.sliceValues = null;
      this.slicePoints = null;
    }
    // Nothing to draw before or after: skip the repaint entirely.
    if (!matches && !this.linkedShown) return;
    this.scheduleRender(true);
  }

  private cancelSliceFetch(): void {
    this.sliceGeneration++;
    if (this.sliceTimer !== null) {
      window.clearTimeout(this.sliceTimer);
      this.sliceTimer = null;
    }
  }

  /** The marks as slices of their column, or null when they are not (all-or-nothing per chart). */
  private sliceRegions(): SliceRegion[] | null {
    const scale = this.valueScale;
    if (scale === null || this.hitRegions.length === 0) return null;
    const regions: SliceRegion[] = this.hitRegions.map((region) => {
      const only = region.actions.length === 1 ? region.actions[0]! : null;
      if (only === null || only.column !== scale.regionColumn) return null;
      if (only.kind === "values") return { kind: "values", code: only.code };
      if (only.kind === "range") return { kind: "range", min: only.min, max: only.max };
      return null;
    });
    return regions.some((region) => region !== null) ? regions : null;
  }

  /** The hovered slice as "keep only these rows" entries, or null when a value cannot be named. */
  private sliceEntries(actions: readonly HitAction[]): ChartExclusion[] | null {
    const entries: ChartExclusion[] = [];
    for (const action of actions) {
      if (action.kind === "values") {
        const label = this.meta(action.column)?.categories?.labels[action.code];
        if (label === undefined) return null;
        entries.push({ kind: "values", column: action.column, labels: [label] });
      } else if (action.kind === "range") {
        entries.push({ kind: "range", column: action.column, min: action.min, max: action.max });
      } else {
        entries.push({ kind: "text", column: action.column, query: action.query });
      }
    }
    return entries;
  }

  /** After a short pause on a mark, asks the worker for the slice's share of each mark here. */
  private scheduleSliceFetch(actions: readonly HitAction[]): void {
    if (this.config.kind === "scatter") {
      this.scheduleSlicePoints(actions);
      return;
    }
    const request = this.options.requestSliceBreakdown;
    const scale = this.valueScale;
    if (request === undefined || scale === null) return;
    // Same column: the outline already says it.
    if (actions.some((action) => action.column === scale.regionColumn)) return;
    const regions = this.sliceRegions();
    const slice = this.sliceEntries(actions);
    if (regions === null || slice === null) return;
    const generation = this.sliceGeneration;
    this.sliceTimer = window.setTimeout(() => {
      this.sliceTimer = null;
      request({
        slice,
        column: scale.regionColumn,
        regions,
        ...(scale.measure === null ? {} : { measure: scale.measure }),
        ...(scale.scoped ? this.chartScope() : {}),
      })
        .then((message) => {
          if (this.disposed || generation !== this.sliceGeneration || this.linked === null) return;
          this.sliceValues = message.values;
          this.scheduleRender(true);
        })
        .catch(() => {
          // A failed highlight is only a missing overlay.
        });
    }, 70);
  }

  /**
   * Scatter: asks for the points of the hovered slice. It is the card's own sample
   * request with the slice kept (an inverted exclusion), unclipped so the points
   * land on the axes the plot already has.
   */
  private scheduleSlicePoints(actions: readonly HitAction[]): void {
    const request = this.options.requestSeries;
    const slice = this.sliceEntries(actions);
    if (this.seriesResult?.mode !== "points" || slice === null) return;
    const scope = this.chartScope();
    const generation = this.sliceGeneration;
    this.sliceTimer = window.setTimeout(() => {
      this.sliceTimer = null;
      request({
        xColumn: this.config.x,
        yColumn: this.config.y,
        colorColumn: -1,
        sizeColumn: -1,
        mode: "points",
        limit: POINT_LIMIT,
        clip: false,
        ...scope,
        chartExclude: [...(scope.chartExclude ?? []), ...slice.map((entry) => ({ ...entry, invert: true }))],
      })
        .then((message) => {
          if (this.disposed || generation !== this.sliceGeneration || this.linked === null) return;
          if (message.result.mode !== "points") return;
          this.slicePoints = message.result;
          this.scheduleRender(true);
        })
        .catch(() => {
          // A failed highlight is only a missing overlay.
        });
    }, 70);
  }

  /** The slice's own points over the scatter, in the highlight colour; returns how many were drawn. */
  private drawSlicePoints(ctx: CanvasRenderingContext2D, space: BrushSpace): number {
    const points = this.slicePoints;
    const yMin = space.yMin ?? 0;
    const yMax = space.yMax ?? 0;
    if (points === null || space.xMax <= space.xMin || yMax <= yMin) return 0;
    const accent = "#e8590c";
    const xScale = space.plotW / (space.xMax - space.xMin);
    const yScale = space.plotH / (yMax - yMin);
    const radius = points.shown <= 5000 ? 2.8 : 2.2;
    let drawn = 0;
    ctx.save();
    ctx.beginPath();
    ctx.rect(space.left, space.top, space.plotW, space.plotH);
    ctx.clip();
    ctx.fillStyle = accent;
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    for (let i = 0; i < points.shown; i++) {
      const x = space.left + (points.x[i]! - space.xMin) * xScale;
      const y = space.top + space.plotH - (points.y[i]! - yMin) * yScale;
      if (x < space.left || x > space.left + space.plotW || y < space.top || y > space.top + space.plotH) continue;
      addMarkerPath(ctx, this.config.markerShape ?? "circle", x, y, radius);
      drawn++;
    }
    ctx.fill();
    ctx.restore();
    if (drawn > 0 && this.linkedLabel !== "") {
      ctx.save();
      ctx.fillStyle = accent;
      ctx.font = "600 11px system-ui, sans-serif";
      ctx.textAlign = "right";
      ctx.fillText(`Highlighted: ${this.linkedLabel}`, space.left + space.plotW, Math.max(10, space.top - 4));
      ctx.restore();
    }
    return drawn;
  }

  /** Draws the linked slice: outlines on the same column, the slice's share on others. */
  private drawLinkedOverlay(ctx: CanvasRenderingContext2D): void {
    const actions = this.linked;
    let shown = 0;
    if (actions !== null) {
      ctx.save();
      ctx.fillStyle = this.primaryColor();
      ctx.strokeStyle = this.primaryColor();
      ctx.lineWidth = 2;
      for (const region of this.hitRegions) {
        if (!actionsOverlap(actions, region.actions)) continue;
        const w = Math.max(3, region.w);
        ctx.globalAlpha = 0.16;
        ctx.fillRect(region.x, region.y, w, region.h);
        ctx.globalAlpha = 0.95;
        ctx.strokeRect(region.x + 1, region.y + 1, Math.max(1, w - 2), Math.max(1, region.h - 2));
        shown++;
      }
      ctx.restore();
    }
    const values = this.sliceValues;
    const scale = this.valueScale;
    let sliced = 0;
    if (actions !== null && values !== null && scale !== null && values.length === this.hitRegions.length) {
      sliced = this.drawSliceShare(ctx, scale, values);
    }
    if (actions !== null && this.slicePoints !== null && this.brushSpace !== null && this.config.kind === "scatter") {
      sliced = this.drawSlicePoints(ctx, this.brushSpace);
    }
    this.linkedShown = shown > 0 || sliced > 0;
    this.canvas.dataset.linked = String(shown);
    this.canvas.dataset.slice = String(sliced);
  }

  /** The hovered slice's value on every mark, in the highlight colour; returns how many marks have one. */
  private drawSliceShare(ctx: CanvasRenderingContext2D, scale: ValueScale, values: Float64Array): number {
    const accent = "#e8590c";
    const bottom = scale.top + scale.plotH;
    const heightOf = (value: number): number =>
      Math.max(0, Math.min(1, value / Math.max(1e-12, scale.yMax))) * scale.plotH;
    let drawn = 0;
    ctx.save();
    ctx.fillStyle = accent;
    ctx.strokeStyle = accent;
    if (scale.mode === "bars") {
      ctx.globalAlpha = 0.95;
      this.hitRegions.forEach((region, index) => {
        const value = values[index] as number;
        if (!Number.isFinite(value) || value <= 0) return;
        const h = Math.max(2, heightOf(value));
        ctx.fillRect(region.x + scale.inset, bottom - h, Math.max(1, scale.barW), h);
        drawn++;
      });
    } else {
      ctx.lineWidth = 2.5;
      ctx.globalAlpha = 0.95;
      let open = false;
      ctx.beginPath();
      this.hitRegions.forEach((region, index) => {
        const value = values[index] as number;
        if (!Number.isFinite(value)) {
          open = false;
          return;
        }
        const x = region.x + region.w / 2;
        const y = bottom - heightOf(value);
        if (open) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
        open = true;
        drawn++;
      });
      ctx.stroke();
      if (drawn > 0 && drawn <= 60) {
        this.hitRegions.forEach((region, index) => {
          const value = values[index] as number;
          if (!Number.isFinite(value)) return;
          ctx.beginPath();
          ctx.arc(region.x + region.w / 2, bottom - heightOf(value), 2.5, 0, Math.PI * 2);
          ctx.fill();
        });
      }
    }
    if (drawn > 0 && this.linkedLabel !== "") {
      ctx.globalAlpha = 1;
      ctx.font = "600 11px system-ui, sans-serif";
      // Right-aligned so it never sits on the chart's own axis label at the left.
      ctx.textAlign = "right";
      const last = this.hitRegions[this.hitRegions.length - 1];
      ctx.fillText(
        `Highlighted: ${this.linkedLabel}`,
        last === undefined ? 0 : last.x + last.w,
        Math.max(10, scale.top - 4),
      );
    }
    ctx.restore();
    return drawn;
  }

  private hideTooltip(): void {
    this.emitHighlight(null);
    this.tooltipEl.classList.add("hidden");
    this.canvas.classList.remove("chart-clickable");
  }

  private handleCanvasClick(event: MouseEvent): void {
    if (this.dragMoved) {
      this.dragMoved = false;
      return;
    }
    const rect = this.canvas.getBoundingClientRect();
    if (this.config.kind === "map" && this.mapClusters.length > 0 && this.mapPicker === null) {
      const cx = event.clientX - rect.left, cy = event.clientY - rect.top;
      const hit = this.mapClusters.find((c) => (cx - c.x) ** 2 + (cy - c.y) ** 2 <= c.r * c.r);
      if (hit !== undefined) {
        // Zoom to the box of the markers it holds, with some air round it; markers at one spot zoom in a fixed step.
        const lonSpan = Math.max(hit.lonMax - hit.lonMin, 0.02), latSpan = Math.max(hit.latMax - hit.latMin, 0.02);
        const lonMid = (hit.lonMin + hit.lonMax) / 2, latMid = (hit.latMin + hit.latMax) / 2;
        const view = this.mapViewShown(), aspect = (view.lonMax - view.lonMin) / (view.latMax - view.latMin);
        let w = lonSpan * 1.6, h = latSpan * 1.6;
        if (w / h < aspect) w = h * aspect; else h = w / aspect;
        this.mapView = { lonMin: lonMid - w / 2, lonMax: lonMid + w / 2, latMin: latMid - h / 2, latMax: latMid + h / 2 };
        this.render();
        return;
      }
    }
    if (this.config.kind === "map" && this.mapPicker !== null && this.lastFrame !== null) {
      const frame = this.lastFrame;
      const view = this.mapViewShown();
      const fx = (event.clientX - rect.left - frame.left) / frame.plotW;
      const fy = (event.clientY - rect.top - frame.top) / frame.plotH;
      if (fx >= 0 && fx <= 1 && fy >= 0 && fy <= 1) {
        this.mapPicker(view.lonMin + fx * (view.lonMax - view.lonMin), view.latMax - fy * (view.latMax - view.latMin));
      }
      return;
    }
    const region = hitTest(
      this.hitRegions,
      event.clientX - rect.left,
      event.clientY - rect.top,
    );
    if (this.options.docked === true) {
      // A click marks; filtering every page is a second, named step.
      if (region === null || region.actions.length === 0) {
        if (this.selectedRegion !== null) {
          this.clearSelection();
          this.render();
        }
        return;
      }
      this.lastActionRegion = region;
      this.selectRegion(region);
      return;
    }
    if (region === null) return;
    this.lastActionRegion = region;
    for (const action of region.actions) this.applyHitAction(action);
  }

  private beginMapBrush(event: PointerEvent): void {
    return beginMapBrush(this, event);
  }

  private endMapBrush(event: PointerEvent): void {
    return endMapBrush(this, event);
  }

  /**
   * Shift+drag release: converts the pixel rectangle into data ranges on the
   * plotted columns and hands them to the table filters. Drags under 6 px are
   * ignored; one-axis charts (line, histogram) use the horizontal extent only.
   */
  finishBrush(drag: { x0: number; y0: number; x1: number; y1: number }): void {
    const space = this.brushSpace;
    this.render();
    if (space === null || this.options.onBrush === undefined) return;
    const clamp = (value: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, value));
    const left = space.left;
    const right = space.left + space.plotW;
    const top = space.top;
    const bottom = space.top + space.plotH;
    const px0 = clamp(Math.min(drag.x0, drag.x1), left, right);
    const px1 = clamp(Math.max(drag.x0, drag.x1), left, right);
    const py0 = clamp(Math.min(drag.y0, drag.y1), top, bottom);
    const py1 = clamp(Math.max(drag.y0, drag.y1), top, bottom);
    const twoAxes = space.yColumn !== undefined && space.yMin !== undefined && space.yMax !== undefined;
    if (px1 - px0 < 6 || (twoAxes && py1 - py0 < 6)) return;
    if (space.slots !== undefined) {
      const slotW = space.plotW / Math.max(1, space.slots.count);
      const last = space.slots.count - 1;
      const first = clamp(Math.floor((px0 - left) / slotW), 0, last);
      const end = clamp(Math.floor((px1 - left) / slotW), first, last);
      const range = space.slots.range(first, end);
      if (range !== null) this.options.onBrush([{ column: space.xColumn, ...range }]);
      return;
    }
    const xSpan = space.xMax - space.xMin;
    const xWidth = Math.max(1e-9, space.plotW * space.xFraction);
    const toX = (x: number): number => space.xMin + clamp((x - left) / xWidth, 0, 1) * xSpan;
    const ranges: BrushRange[] = [this.roundedRange(space.xColumn, toX(px0), toX(px1))];
    if (twoAxes) {
      const yMin = space.yMin as number;
      const yMax = space.yMax as number;
      const toY = (y: number): number => yMax - ((y - top) / space.plotH) * (yMax - yMin);
      ranges.push(this.roundedRange(space.yColumn as number, toY(py1), toY(py0)));
    }
    this.options.onBrush(ranges);
  }

  /**
   * Brush geometry for an aggregated time axis: slot i covers [times[i], the next
   * period) so a selection of slots a..b is the dates from the start of a to the
   * end of b. The last period is as long as the one before it.
   */
  private timeSlotBrush(times: readonly number[], column: number, frame: Frame): BrushSpace | null {
    if (times.length === 0 || column < 0) return null;
    const end = (i: number): number => {
      const next = times[i + 1];
      if (next !== undefined && Number.isFinite(next)) return next - 1;
      const here = times[i] as number;
      const previous = times[i - 1];
      return previous !== undefined && Number.isFinite(previous) ? here + (here - previous) - 1 : here;
    };
    return {
      left: frame.left,
      top: frame.top,
      plotW: frame.plotW,
      plotH: frame.plotH,
      xColumn: column,
      xMin: 0,
      xMax: 1,
      xFraction: 1,
      slots: {
        count: times.length,
        range: (first, last) => {
          const min = times[first];
          if (min === undefined || !Number.isFinite(min) || !Number.isFinite(times[last])) return null;
          return { min, max: end(last) };
        },
      },
    };
  }

  /** Whole-number columns get whole-number bounds so the edge rows stay in. */
  private roundedRange(column: number, min: number, max: number): BrushRange {
    if (this.meta(column)?.type === "integer") {
      return { column, min: Math.floor(min), max: Math.ceil(max) };
    }
    return { column, min, max };
  }

  /** The live Shift+drag selection: a rectangle, or a full-height band on one-axis charts. */
  private drawBrushOverlay(ctx: CanvasRenderingContext2D): void {
    const space = this.brushSpace;
    if (this.brushDrag === null || space === null) return;
    const clampX = (x: number): number => Math.max(space.left, Math.min(space.left + space.plotW, x));
    const clampY = (y: number): number => Math.max(space.top, Math.min(space.top + space.plotH, y));
    const x = Math.min(clampX(this.brushDrag.x0), clampX(this.brushDrag.x1));
    const w = Math.abs(clampX(this.brushDrag.x1) - clampX(this.brushDrag.x0));
    const oneAxis = space.yColumn === undefined;
    const y = oneAxis ? space.top : Math.min(clampY(this.brushDrag.y0), clampY(this.brushDrag.y1));
    const h = oneAxis ? space.plotH : Math.abs(clampY(this.brushDrag.y1) - clampY(this.brushDrag.y0));
    ctx.save();
    ctx.fillStyle = this.primaryColor();
    ctx.globalAlpha = 0.15;
    ctx.fillRect(x, y, w, h);
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = this.primaryColor();
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w, h);
    ctx.restore();
  }

  /** Wheel zoom on the map, anchored at the pointer; clamped to the world. */
  private onWheel(event: WheelEvent): void {
    const kind = this.config.kind;
    // The wheel scrolls the page unless the person asks to zoom: a chart fills the screen, and
    // trapping the wheel there hides whatever is below it. A map keeps plain wheel zoom, as maps do.
    if (kind !== "map" && !event.ctrlKey && !event.metaKey) return;
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
      this.zoomMap(factor, tx, ty);
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

  private zoomMap(factor: number, tx = 0.5, ty = 0.5): void {
    return zoomMap(this, factor, tx, ty);
  }

  /** Heat grids are drawn as an image of cells, so they go out as a PNG. */
  get canExportMapHtml(): boolean {
    return this.mapHtmlBlock === null;
  }

  get isMap(): boolean {
    return this.config.kind === "map";
  }

  /** Why this map cannot go out as a web page; null when it can. */
  get mapHtmlBlock(): string | null {
    if (this.config.mapMode === "heat") return "A heat grid exports as a PNG. Markers and Choropleth can go out as a web page";
    if (this.regionsOn()) return this.regions?.ready === true ? null : "Load a boundary file first";
    return this.seriesResult?.mode === "points" ? null : "This map has nothing plotted yet";
  }

  /** The export choices, opened from anywhere that offers them. */
  openExport(anchor: HTMLElement): void {
    this.options.onExport(this, anchor);
  }

  get mapTitle(): string {
    return this.config.title;
  }

  setMapTitle(title: string): void {
    this.config.title = title;
    this.titleInput.value = title;
  }

  /** The boundaries in use, for the Map page's city names. */
  get mapRegions(): MapRegions | null {
    return this.regions;
  }

  exportMapHtml(): boolean {
    return exportMapHtml(this);
  }

  mapHtmlPayload(): MapHtmlPayload | null {
    return mapHtmlPayload(this);
  }

  mapViewShown(): MapViewport {
    return mapViewShown(this);
  }

  mapViewOrAuto(): MapViewport {
    return mapViewOrAuto(this);
  }

  dataViewOrNull(): MapViewport | null {
    return dataViewOrNull(this);
  }

  private resetMapZoom(): void {
    return resetMapZoom(this);
  }

  /** Toggles a category value or sets a range/text filter through the app hook. */
  // ---------- leaving things out of one chart ----------

  /** Labels this card already leaves out for one column (value exclusions). */
  private excludedLabels(column: number): Set<string> {
    const out = new Set<string>();
    for (const entry of this.excludes()) {
      if (entry.kind === "values" && entry.column === column) {
        for (const label of entry.labels) out.add(label);
      }
    }
    return out;
  }

  private excludedTerms(column: number): Set<string> {
    const out = new Set<string>();
    for (const entry of this.excludes()) {
      if (entry.kind === "text" && entry.column === column) out.add(entry.query.toLowerCase());
    }
    return out;
  }

  /** Zeroes histogram bins whose centre lies inside a range excluded on this column. */
  private withoutExcludedBins(bins: number[], min: number, max: number): number[] {
    const ranges = this.excludes().filter(
      (entry): entry is Extract<ChartExclusion, { kind: "range" }> =>
        entry.kind === "range" && entry.column === this.config.column,
    );
    if (ranges.length === 0 || bins.length === 0 || !(max > min)) return bins;
    const width = (max - min) / bins.length;
    return bins.map((count, index) => {
      const centre = min + (index + 0.5) * width;
      const inside = ranges.some(
        (range) =>
          (range.min === null || centre >= range.min) && (range.max === null || centre <= range.max),
      );
      return inside ? 0 : count;
    });
  }

  /** Readable range bounds for a column: dates as dates, numbers trimmed. */
  private boundFormatter(column: number): (value: number) => string {
    const type = this.meta(column)?.type;
    if (type === "date" || type === "datetime") {
      return (value) => {
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return String(value);
        const iso = date.toISOString();
        return type === "date" || iso.endsWith("T00:00:00.000Z")
          ? iso.slice(0, 10)
          : `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
      };
    }
    return (value) =>
      Number(value.toPrecision(6)).toLocaleString("en-US", { maximumFractionDigits: 6 });
  }

  /** Legend codes index the grouped result's labels; the group column codes are the same list. */
  private legendCodeToGroupCode(code: number): number {
    return code;
  }

  /** True when this card can leave things out (it draws from the table, not a bound view). */
  private canExclude(): boolean {
    return this.config.source === "";
  }

  private setExcludes(next: ChartExclusion[]): void {
    this.config.excludes = next.length > 0 ? next : undefined;
    this.syncExclusions();
    // Re-request every data path with the new scope, then repaint.
    this.setFiltered(this.facets, this.histograms);
  }

  /** The row of "Left out: Spain ×" chips above the chart. */
  private syncExclusions(): void {
    const list = this.excludes();
    clear(this.exclusionBar);
    this.exclusionBar.classList.toggle("hidden", list.length === 0);
    if (list.length === 0) return;
    this.exclusionBar.append(el("span", { class: "chart-exclusions-label" }, ["Left out:"]));
    const chips = exclusionChips(
      list,
      (column) => this.meta(column)?.name ?? "column",
      (column) => this.boundFormatter(column),
    );
    for (const chip of chips) {
      const button = el(
        "button",
        {
          class: "chart-exclusion-chip",
          type: "button",
          title: `Put back: ${chip.text}`,
          "aria-label": `Put back ${chip.text}`,
        },
        [chip.text, el("span", { class: "chart-exclusion-x", "aria-hidden": "true" }, [" ×"])],
      ) as HTMLButtonElement;
      button.addEventListener("click", () => this.setExcludes(removeChip(this.excludes(), chip)));
      this.exclusionBar.append(button);
    }
    if (chips.length > 1) {
      const clearAll = el("button", { class: "ghost small", type: "button" }, ["Put all back"]);
      clearAll.addEventListener("click", () => this.setExcludes([]));
      this.exclusionBar.append(clearAll);
    }
  }

  private handleCanvasContextMenu(event: MouseEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    const region = hitTest(
      this.hitRegions,
      event.clientX - rect.left,
      event.clientY - rect.top,
    );
    const actions =
      region === null
        ? []
        : region.actions.length > 0
          ? region.actions
          : (region.contextActions ?? []);
    const point = actions.length === 0 ? this.dataPointAt(event.clientX, event.clientY) : null;
    const hasExclusions = this.excludes().length > 0;
    if (actions.length === 0 && point === null && !hasExclusions) return;
    event.preventDefault();
    this.openExclusionMenu(actions, { x: event.clientX, y: event.clientY }, point);
  }

  /**
   * Data coordinates under the pointer for the plots that draw raw points or
   * cells (scatter, density, bubble), so a right-click can trim everything
   * beyond that point on either axis.
   */
  private dataPointAt(clientX: number, clientY: number): { x: number; y: number } | null {
    const kind = this.config.kind;
    if (kind !== "scatter" && kind !== "density" && kind !== "bubble") return null;
    const result = kind === "bubble" ? this.bubbleResult : this.seriesResult;
    const frame = this.lastFrame;
    if (result === null || frame === null || !(frame.plotW > 0) || !(frame.plotH > 0)) return null;
    const rect = this.canvas.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    if (px < frame.left || px > frame.left + frame.plotW) return null;
    if (py < frame.top || py > frame.top + frame.plotH) return null;
    const view = this.plotView ?? {
      xMin: result.xMin,
      xMax: result.xMax,
      yMin: result.yMin,
      yMax: result.yMax,
    };
    if (![view.xMin, view.xMax, view.yMin, view.yMax].every(Number.isFinite)) return null;
    return {
      x: view.xMin + ((px - frame.left) / frame.plotW) * (view.xMax - view.xMin),
      y: view.yMax - ((py - frame.top) / frame.plotH) * (view.yMax - view.yMin),
    };
  }

  /**
   * Right-click menu built from what the clicked shape stands for: a category
   * value, a numeric range or a text term. Every entry is chart-local unless
   * it says "table"; exclusions never touch the table or other cards.
   */
  private openExclusionMenu(
    actions: readonly HitAction[],
    at: { x: number; y: number },
    point: { x: number; y: number } | null = null,
  ): void {
    const items: MenuItem[] = [];
    if (point !== null && this.canExclude()) {
      const axes: { column: number; value: number; name: string }[] = [
        { column: this.config.x, value: point.x, name: this.meta(this.config.x)?.name ?? "X" },
        { column: this.config.y, value: point.y, name: this.meta(this.config.y)?.name ?? "Y" },
      ];
      for (const axis of axes) {
        if (axis.column < 0 || !Number.isFinite(axis.value)) continue;
        const rounded = Number(axis.value.toPrecision(4));
        const text = rounded.toLocaleString("en-US", { maximumFractionDigits: 6 });
        items.push(
          {
            label: `Leave out rows where ${axis.name} is above ${text}`,
            title: "Trim everything beyond this point on this axis, in this chart only",
            action: () =>
              this.setExcludes(
                addExclusion(this.excludes(), {
                  kind: "range",
                  column: axis.column,
                  min: rounded,
                  max: null,
                }),
              ),
          },
          {
            label: `Leave out rows where ${axis.name} is below ${text}`,
            title: "Trim everything beyond this point on this axis, in this chart only",
            action: () =>
              this.setExcludes(
                addExclusion(this.excludes(), {
                  kind: "range",
                  column: axis.column,
                  min: null,
                  max: rounded,
                }),
              ),
          },
        );
      }
    }
    const multiple = actions.length > 1;
    if (this.canExclude()) {
      for (const action of actions) {
        const column = this.meta(action.column);
        const where = multiple && column !== undefined ? ` (${column.name})` : "";
        if (action.kind === "values") {
          const label = column?.categories?.labels[action.code];
          if (label === undefined) continue;
          const shown = label === "" ? "(empty)" : label;
          items.push({
            label: `Leave out “${shown}”${where}`,
            title: "Remove these rows from this chart only; click the chip to put them back",
            action: () =>
              this.setExcludes(
                addExclusion(this.excludes(), { kind: "values", column: action.column, labels: [label] }),
              ),
          });
          items.push({
            label: `Show only “${shown}”${where}`,
            title: "Keep just these rows in this chart",
            action: () => {
              this.config.filterColumn = action.column;
              this.config.filterCode = action.code;
              this.setFiltered(this.facets, this.histograms);
              this.syncChartFilterControls();
            },
          });
        } else if (action.kind === "range") {
          const text = describeRange(action.min, action.max, this.boundFormatter(action.column));
          const name = column?.name ?? "values";
          items.push({
            label: `Leave out ${name} ${text}`,
            title: "Remove values in this range from this chart only",
            action: () =>
              this.setExcludes(
                addExclusion(this.excludes(), {
                  kind: "range",
                  column: action.column,
                  min: action.min,
                  max: action.max,
                }),
              ),
          });
        } else {
          items.push({
            label: `Leave out rows containing “${action.query}”${where}`,
            title: "Remove matching rows from this chart only",
            action: () =>
              this.setExcludes(
                addExclusion(this.excludes(), {
                  kind: "text",
                  column: action.column,
                  query: action.query,
                }),
              ),
          });
        }
      }
    }
    // The click behaviour, spelled out, for anyone who wanted the table instead.
    if (actions.length > 0 && this.options.onFilter !== undefined) {
      const first = actions[0]!;
      const described =
        first.kind === "values"
          ? `“${this.meta(first.column)?.categories?.labels[first.code] ?? "value"}”`
          : first.kind === "range"
            ? describeRange(first.min, first.max, this.boundFormatter(first.column))
            : `“${first.query}”`;
      items.push({
        label: `Filter the table to ${described}`,
        title: "Same as clicking it: an ordinary table filter you can clear in the filter list",
        action: () => {
          for (const action of actions) this.applyHitAction(action);
        },
      });
      if (first.kind === "values") {
        items.push({
          label: `Leave ${described} out of the table too`,
          title: "A table filter that keeps every other value",
          action: () => this.excludeFromTable(first.column, first.code),
        });
      }
    }
    if (this.excludes().length > 0) {
      items.push({
        label: `Put back everything left out (${exclusionChips(this.excludes(), () => "").length})`,
        action: () => this.setExcludes([]),
      });
    }
    if (items.length === 0) return;
    openMenu(this.canvas, items, "context-menu", at);
  }

  /** Table filter keeping every value of a column except one. */
  private excludeFromTable(column: number, code: number): void {
    const onFilter = this.options.onFilter;
    const total = this.meta(column)?.categories?.labels.length ?? 0;
    if (onFilter === undefined || total === 0) return;
    const current = this.options.currentFilter?.(column) ?? null;
    const base =
      current?.kind === "values" ? current.selected : Array.from({ length: total }, (_, i) => i);
    const selected = base.filter((value) => value !== code);
    if (selected.length === 0) return;
    onFilter(column, { kind: "values", selected });
  }

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
  drawPlotMessage(
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
          isGroupable(category) &&
          (isNumericType(measure.type) || measure.type === "duration")
        );
      }
      case "bar":
      case "treemap": {
        const meta = this.meta(this.config.column);
        return meta !== undefined && isGroupable(meta);
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
          count((meta) => isGroupable(meta)) > 0;
      case "treemap": {
        const meta = this.meta(this.config.column);
        return meta !== undefined && isGroupable(meta);
      }
      case "heatmap":
        return count((meta) => isGroupable(meta)) >= 2;
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
      case "dotplot":
      case "stacked100":
      case "smallmultiples":
      case "slopegraph":
      case "waterfall": {
        const column = this.meta(this.config.column);
        const measure = this.meta(this.config.valueColumn ?? -1);
        const kind = this.config.kind;
        const columnOk =
          column !== undefined &&
          (kind === "smallmultiples"
            ? this.isDateLike(column)
            : kind === "waterfall" || kind === "slopegraph"
              ? isGroupable(column) || this.isDateLike(column)
              : isGroupable(column));
        const groupOk = !GROUP_REQUIRED_KINDS.includes(kind) || this.meta(this.config.groupColumn) !== undefined;
        return (
          columnOk &&
          groupOk &&
          measure !== undefined &&
          (isNumericType(measure.type) || measure.type === "duration")
        );
      }
      case "pivotHeatmap":
        return this.config.source !== "";
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
        isGroupable(meta),
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
    const top = (this.plotHasHeadline ? (this.config.title.trim() !== "" && this.options.titleOutside !== true ? 40 : 28) : 58) * ui;
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

  font(ctx: CanvasRenderingContext2D, ui: number, size: number, weight = ""): void {
    ctx.font = weight === "" ? `${size * ui}px system-ui, sans-serif` : `${weight} ${size * ui}px system-ui, sans-serif`;
  }

  fit(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
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
    if (this.config.kind === "pivotHeatmap") {
      const data = this.pivotHeatmapData();
      if (data === null) return "Pivot view - waiting for the first result";
      return `${data.measureName} - ${data.rowName} x ${data.colName} - ${data.rowLabels.length}x${data.colLabels.length} cells`;
    }
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
      const two = result.dimensions.length >= 2;
      if (result.dimensionIsTime[0] === true && this.config.source === "") {
        const periods = result.groupCount;
        const step = this.resolvedGrain();
        const every = this.everyFor(step);
        const unit = every > 1 ? `${every}-${step} period` : step;
        return `${plainMeasureName(result.measureNames[0] ?? "measure")}${
          two ? ` by ${result.dimensionNames[1] ?? "group"}` : ""
        } per ${this.stepNoun()} · ${two ? `${periods.toLocaleString()} values` : `${periods.toLocaleString()} ${periods === 1 ? unit : `${unit}s`}`}`;
      }
      return `${plainMeasureName(result.measureNames[0] ?? "measure")} by ${result.dimensionNames[0] ?? "group"}${
        two ? ` and ${result.dimensionNames[1] ?? "group"}` : ""
      } · ${result.groupCount.toLocaleString()} ${two ? "values" : "groups"}`;
    }
    if (this.config.kind === "scatter" || this.config.kind === "density") {
      const x = this.meta(this.config.x)?.name ?? "X";
      const y = this.meta(this.config.y)?.name ?? "Y";
      const series = this.seriesResult;
      // Not "30,021 rows shown" over a plot of a sample of them.
      const sample = series !== null && series.mode === "points" && series.sampled ? `${series.shown.toLocaleString()} points sampled from ${series.total.toLocaleString()}` : rows;
      return `${x} vs ${y} · ${sample}`;
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
    this.splitLegend = null;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    this.hitRegions = [];
    this.plotMessageDrawn = false;
    const ui = this.textScale(height, forExport);
    const labels = this.axisLabels();
    this.plotHasHeadline = this.options.docked === true && !forExport;
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

    // The card heading above the plot already says what this aggregate is, so a
    // generic "Aggregate" title is not drawn a second time.
    const ownTitle = this.config.title.trim();
    const genericAggregate =
      ownTitle === "" && this.options.docked !== true && this.usesAggregate() && this.config.kind !== "pivotHeatmap" && this.config.kind !== "kpi";
    if (this.plotHasHeadline) {
      // One line above the plot says what this is; a title typed by the person is shown on it too.
      if (ownTitle !== "" && this.options.titleOutside !== true) {
        this.font(ctx, frame.ui, 13, "600");
        ctx.fillStyle = frame.text;
        ctx.fillText(this.fit(ctx, ownTitle, width - frame.left - frame.right), frame.left, 14 * frame.ui);
      }
    } else if (!genericAggregate) {
      const title = ownTitle === "" ? this.defaultTitle() : ownTitle;
      this.font(ctx, frame.ui, 15, "600");
      ctx.fillStyle = frame.text;
      ctx.fillText(this.fit(ctx, title, width - frame.left - frame.right), frame.left, 22 * frame.ui);
    }
    if (!this.plotHasHeadline) {
      this.font(ctx, frame.ui, genericAggregate ? 12 : 11);
      ctx.fillStyle = frame.dim;
      ctx.fillText(
        this.fit(ctx, this.subtitle(), width - frame.left - frame.right),
        frame.left,
        (genericAggregate ? 24 : 40) * frame.ui,
      );
    }

    if (this.config.kind === "pivotHeatmap") {
      this.drawPivotHeatmap(ctx, frame);
      return;
    }

    if (this.usesAggregate()) {
      this.drawViewAggregate(ctx, frame);
      this.appendErrorBarNote(this.aggregateResult());
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
      case "barplot":
      case "dotplot":
      case "stacked100":
      case "smallmultiples":
      case "slopegraph":
      case "waterfall": {
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
    let buckets: string[] = [];
    for (let i = 0; i < n; i++) {
      const label = bucketLabels[i] ?? "";
      if (!bucketIndex.has(label)) {
        bucketIndex.set(label, buckets.length);
        buckets.push(label);
      }
    }
    // A pivot can have hundreds of rows, and a group of bars for each is unreadable: a chart of
    // one shows the biggest (they arrive largest first) and says how many it left out.
    const axisTotal = buckets.length;
    if (this.config.source !== "" && result.dimensionIsTime[0] !== true && buckets.length > SPLIT_AXIS_LIMIT) {
      buckets = buckets.slice(0, SPLIT_AXIS_LIMIT);
      for (const label of [...bucketIndex.keys()]) if ((bucketIndex.get(label) ?? 0) >= SPLIT_AXIS_LIMIT) bucketIndex.delete(label);
    }
    // A time axis keeps empty periods in place (series show a gap there) rather
    // than letting the neighbouring periods close up.
    let bucketTimes: number[] | null = null;
    const groupTimesRaw = result.dimensionTimes[0];
    if (result.dimensionIsTime[0] === true && groupTimesRaw !== undefined && groupTimesRaw.length === n) {
      const labelByTime = new Map<number, string>();
      for (let i = 0; i < n; i++) {
        const time = groupTimesRaw[i];
        if (Number.isFinite(time) && !labelByTime.has(time)) labelByTime.set(time, bucketLabels[i] ?? "");
      }
      const axis = fillTimeAxis([...labelByTime.keys()], this.resolvedGrain(), 20_000, this.everyFor(this.resolvedGrain()));
      if (axis.length > 0) {
        bucketTimes = axis;
        buckets = axis.map((time) => labelByTime.get(time) ?? `${new Date(time).toISOString().slice(0, 10)} (no data)`);
        bucketIndex.clear();
        buckets.forEach((label, index) => bucketIndex.set(label, index));
      }
    }
    interface SplitSeries {
      label: string;
      color: string;
      total: number;
      values: Float64Array;
      /** Where it first appeared: for a pivot chart, the pivot's own column order. */
      first: number;
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
          first: byGroup.size,
        };
        byGroup.set(label, entry);
      }
      const value = values[i] ?? Number.NaN;
      const bucket = bucketIndex.get(bucketLabels[i] ?? "");
      if (Number.isFinite(value) && bucket !== undefined) {
        entry.values[bucket] = value;
        entry.total += Math.abs(value);
      }
    }
    const all = [...byGroup.values()].sort((a, b) => b.total - a.total);
    const seriesLimit = Math.max(1, Math.min(12, this.config.topN));
    let shown = all.slice(0, seriesLimit);
    // The largest are kept, but a pivot's series read in the pivot's order: years in year order.
    if (this.config.source !== "") shown.sort((a, b) => a.first - b.first);
    if (this.config.groupOther && all.length > seriesLimit) {
      const other: SplitSeries = {
        label: "Other",
        color: this.groupColor(shown.length),
        total: 0,
        values: new Float64Array(buckets.length).fill(Number.NaN),
        first: byGroup.size,
      };
      for (const series of all.slice(seriesLimit)) {
        other.total += series.total;
        for (let bucket = 0; bucket < buckets.length; bucket++) {
          const value = series.values[bucket] ?? Number.NaN;
          if (!Number.isFinite(value)) continue;
          other.values[bucket] = Number.isFinite(other.values[bucket])
            ? (other.values[bucket] as number) + value
            : value;
        }
      }
      shown = [...shown, other];
    }
    this.splitLegend = shown.map((series) => ({ label: series.label, color: series.color }));
    shown = shown.filter((series) => !this.hiddenSplit.has(series.label));
    if (shown.length === 0) {
      const message = this.hiddenSplit.size > 0 ? "Every series is hidden. Click a name in the legend to show it." : "The aggregate has no groups to draw yet.";
      this.noteEl.textContent = message;
      this.drawPlotMessage(ctx, frame, message);
      return;
    }
    // Periods a series has no rows for follow the chart's Missing periods rule, as on an unsplit
    // line: a total really is zero there, a running total stays where it was, anything else is a gap.
    if (bucketTimes !== null && this.config.source === "") {
      const calc = this.config.valueCalc;
      const policy = calc === "cumulative" ? "carry" : calc !== undefined ? "gap" : this.fillPolicy();
      if (policy !== "gap") {
        for (const series of shown) {
          let last = Number.NaN;
          let seen = false;
          for (let b = 0; b < series.values.length; b++) {
            const value = series.values[b] ?? Number.NaN;
            if (Number.isFinite(value)) {
              last = value;
              seen = true;
            } else if (policy === "zero") series.values[b] = 0;
            else if (seen) series.values[b] = last;
          }
        }
      }
    }
    const ui = frame.ui;
    const stacked =
      (this.config.kind === "barplot" || this.config.source !== "") && (this.config.barLayout ?? "group") === "stack";
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
      ctx.fillText(formatCompact(value), frame.left - 6 * ui, y + 3 * ui);
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
        // A period with a gap on both sides has no line to belong to: it is drawn as a dot,
        // so a series of scattered periods is never an empty chart.
        const lone: [number, number][] = [];
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
            if (!Number.isFinite(series.values[b + 1] ?? Number.NaN)) lone.push([x, y]);
          } else {
            ctx.lineTo(x, y);
          }
        }
        ctx.stroke();
        ctx.fillStyle = series.color;
        for (const [x, y] of lone) {
          ctx.beginPath();
          ctx.arc(x, y, 1.75 * ui, 0, Math.PI * 2);
          ctx.fill();
        }
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
    if (bucketTimes !== null) {
      const room = Math.max(3, Math.floor(frame.plotW / (70 * ui)));
      for (const tick of calendarTicks(bucketTimes, room)) {
        ctx.fillText(tick.label, frame.left + (tick.index + 0.5) * slot, frame.top + frame.plotH + 14 * ui);
      }
    } else {
      const step = Math.max(1, Math.ceil(buckets.length / 8));
      for (let b = 0; b < buckets.length; b += step) {
        ctx.fillText(
          this.fit(ctx, buckets[b] ?? "", Math.max(16, slot * step - 4 * ui)),
          frame.left + (b + 0.5) * slot,
          frame.top + frame.plotH + 14 * ui,
        );
      }
    }
    ctx.textAlign = "left";
    if (bucketTimes !== null && lineCard && this.config.source === "") {
      this.brushSpace = this.timeSlotBrush(bucketTimes, this.config.column, frame);
    }
    // The legend is the clickable one under the chart (same colours, toggles series).

    const measure = result.measureNames[0] ?? "measure";
    ctx.fillStyle = frame.dim;
    ctx.fillText(
      `${plainMeasureName(measure)} · ${shown.length}${all.length > shown.length ? ` of ${all.length}` : ""} series`,
      frame.left,
      frame.top + frame.plotH + 30 * ui,
    );
    this.noteEl.textContent = `${plainMeasureName(measure)} by ${
      result.dimensionNames[1] ?? "group"
    } · ${shown.length} of ${all.length} series shown${stacked ? " (stacked)" : ""} · ${
      axisTotal > buckets.length && bucketTimes === null
        ? `the ${buckets.length} largest of ${axisTotal.toLocaleString()} ${result.dimensionNames[0] ?? "groups"}`
        : `${result.dimensionNames[0] ?? "group"} advances left to right`
    }`;
  }

  /**
   * Map card: the vendored 110m basemap (lazy, decoded once) with the filtered
   * coordinate points drawn in world space. Drag a rectangle to filter both
   * coordinate columns to that area (plan §8).
   */
  /** The box around the canvas, for controls that float over the chart (the Map page's dock). */
  get canvasHost(): HTMLElement {
    return this.canvasWrap;
  }

  /** The Map page's own markers, drawn over the data. */
  setMapMarkers(markers: readonly MapMarkerDraw[]): void {
    this.mapMarkers = markers;
    this.render();
  }

  fitMapAll(): void {
    return fitMapAll(this);
  }

  markerBox(): MapViewport | null {
    return markerBox(this);
  }

  frameBox(box: MapViewport): MapViewport {
    return frameBox(this, box);
  }

  /** While set, a click on the map calls it with the lon/lat under the pointer instead of filtering. */
  setMapPicker(picker: ((lon: number, lat: number) => void) | null): void {
    this.mapPicker = picker;
    this.canvas.classList.toggle("chart-canvas-pick", picker !== null);
  }

  /** An extra layer drawn over the data and under the markers (the Map page's cities). */
  setMapOverlay(overlay: MapOverlay | null): void {
    this.mapOverlay = overlay;
    this.render();
  }

  private drawMap(ctx: CanvasRenderingContext2D, frame: Frame): void {
    return drawMap(this, ctx, frame);
  }

  /** The key is drawn last: names and markers on top of the map must not write over it. */
  mapLegend: (() => void) | null = null;

  drawMapLayers(ctx: CanvasRenderingContext2D, frame: Frame): void {
    return drawMapLayers(this, ctx, frame);
  }

  drawMapClusters(ctx: CanvasRenderingContext2D, result: SeriesPoints, view: MapViewport, px: (lon: number) => number, py: (lat: number) => number, ui: number, drawAt: (index: number) => void, dotAlpha: number): void {
    return drawMapClusters(this, ctx, result, view, px, py, ui, drawAt, dotAlpha);
  }
  clusterNote = "";
  /** The "Show" choice that matches the config: places, rows, or rows clustered. */
  mapModeChoice(): "places" | "points" | "cluster" {
    const mode = this.config.mapMode ?? DEFAULT_MAP_MODE;
    return mode === "places" ? "places" : this.config.mapCluster === true ? "cluster" : "points";
  }

  drawMapBody(ctx: CanvasRenderingContext2D, frame: Frame): void {
    return drawMapBody(this, ctx, frame);
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
  /**
   * The dot plot, 100% stacked bar, small multiples, slopegraph and waterfall
   * draw from the same aggregate as the other measure charts; their layouts
   * live in chart-extra-draw. Returns false for every other kind.
   */
  private drawExtraKind(
    ctx: CanvasRenderingContext2D,
    frame: Frame,
    result: AggregateMessage,
    values: Float64Array,
  ): boolean {
    const kind = this.config.kind;
    if (
      kind !== "dotplot" &&
      kind !== "stacked100" &&
      kind !== "smallmultiples" &&
      kind !== "slopegraph" &&
      kind !== "waterfall"
    ) {
      return false;
    }
    if (GROUP_REQUIRED_KINDS.includes(kind) && result.dimensions.length < 2) {
      const message = `Pick a Group by column in the card settings: a ${CHART_KIND_LABELS[kind].toLowerCase()} compares groups.`;
      this.noteEl.textContent = message;
      this.drawPlotMessage(ctx, frame, message);
      return true;
    }
    const column = this.config.column;
    const meta = this.meta(column);
    const labels = meta?.categories?.labels ?? [];
    const painter: Painter = {
      font: (c, ui, size, weight) => this.font(c, ui, size, weight),
      fit: (c, text, maxWidth) => this.fit(c, text, maxWidth),
      groupColor: (index) => this.groupColor(index),
      primaryColor: () => this.primaryColor(),
      actionsFor: (label) => {
        const code = labels.indexOf(label);
        return meta !== undefined && code >= 0 ? [{ kind: "values", column, code }] : [];
      },
    };
    const limit = Math.max(2, Math.min(12, this.config.topN));
    const drawn =
      kind === "dotplot"
        ? drawDotPlot(ctx, frame, painter, result, values)
        : kind === "stacked100"
          ? drawStacked100(ctx, frame, painter, result, values, Math.min(8, limit))
          : kind === "smallmultiples"
            ? drawSmallMultiples(ctx, frame, painter, result, values, limit)
            : kind === "slopegraph"
              ? drawSlopegraph(ctx, frame, painter, result, values, Math.max(limit, 8))
              : drawWaterfall(ctx, frame, painter, result, values, 30);
    this.hitRegions = drawn.hits;
    this.noteEl.textContent = drawn.note;
    return true;
  }

  /**
   * Many categories: horizontal bars, every name readable, the first Top N in the chart's order.
   * A total can gather the rest into Other; an average cannot, so the note counts what is left out.
   */
  private drawRankedBars(ctx: CanvasRenderingContext2D, frame: Frame, result: AggregateMessage, values: Float64Array): void {
    const ui = frame.ui;
    const n = result.groupCount;
    const limit = Math.min(n, Math.max(1, this.config.topN));
    const measure = plainMeasureName(result.measureNames[0] ?? "value");
    const agg = this.config.valueAgg ?? "mean";
    const additive = (this.config.valueColumn ?? -1) < 0 || agg === "sum" || agg === "count";
    let rest = 0;
    for (let i = limit; i < n; i++) if (Number.isFinite(values[i])) rest += values[i]!;
    const withOther = additive && this.config.groupOther && limit < n;
    const rows: { label: string; value: number; index: number }[] = [];
    for (let i = 0; i < limit; i++) rows.push({ label: result.labels[i] === "" ? "(blank)" : (result.labels[i] ?? ""), value: values[i] ?? Number.NaN, index: i });
    if (withOther) rows.push({ label: `Other (${(n - limit).toLocaleString()})`, value: rest, index: -1 });
    let top = 0;
    for (const row of rows) if (Number.isFinite(row.value)) top = Math.max(top, Math.abs(row.value));
    for (const row of rows) if (row.index >= 0) top = Math.max(top, this.errorBarAt(result, row.index)?.high ?? 0);
    top = Math.max(top, 1e-12);
    this.font(ctx, ui, 11);
    let widest = 0;
    for (const row of rows) widest = Math.max(widest, ctx.measureText(row.label).width);
    const labelW = Math.min(frame.plotW * 0.34, widest + 8 * ui);
    const left = Math.max(frame.left, labelW + 10 * ui);
    const valueW = 62 * ui;
    const barsW = Math.max(10, frame.left + frame.plotW - left - valueW);
    const slot = frame.plotH / rows.length;
    const barH = Math.max(3, Math.min(slot * 0.72, 30 * ui));
    const dimensionColumn = this.config.source === "" ? this.config.column : -1;
    const codes = this.meta(dimensionColumn)?.categories?.labels ?? [];
    this.hitRegions = [];
    rows.forEach((row, k) => {
      const y = frame.top + k * slot;
      const width = Number.isFinite(row.value) ? (Math.abs(row.value) / top) * barsW : 0;
      ctx.fillStyle = row.index < 0 ? frame.dim : this.primaryColor();
      ctx.globalAlpha = row.index < 0 ? 0.5 : 0.85;
      ctx.fillRect(left, y + (slot - barH) / 2, width, barH);
      ctx.globalAlpha = 1;
      const middle = y + slot / 2 + 4 * ui;
      this.font(ctx, ui, 11);
      ctx.textAlign = "right";
      ctx.fillStyle = frame.text;
      ctx.fillText(this.fit(ctx, row.label, labelW), left - 6 * ui, middle);
      ctx.textAlign = "left";
      ctx.fillStyle = frame.dim;
      const bar = row.index < 0 ? null : this.errorBarAt(result, row.index);
      const barEnd = bar === null ? 0 : (Math.max(0, bar.high) / top) * barsW;
      ctx.fillText(Number.isFinite(row.value) ? formatCompact(row.value) : "—", left + Math.max(width, barEnd) + 5 * ui, middle);
      if (bar !== null) {
        const mid = y + slot / 2;
        this.drawWhisker(ctx, frame, left + (Math.max(0, bar.low) / top) * barsW, mid, left + barEnd, mid);
      }
      const code = row.index < 0 ? -1 : codes.indexOf(result.labels[row.index] ?? "");
      this.hitRegions.push({
        x: 0,
        y,
        w: frame.left + frame.plotW,
        h: slot,
        lines: [row.label, `${measure}: ${Number.isFinite(row.value) ? formatChartNumber(row.value) : "—"}`, ...(row.index < 0 ? [] : this.errorBarLine(result, row.index))],
        actions: code >= 0 ? [{ kind: "values", column: dimensionColumn, code }] : [],
      });
    });
    ctx.textAlign = "left";
    const ordered = (this.config.chartSort ?? "none") === "none" || this.config.chartSort === "valueDesc";
    const leftOut = withOther ? "" : limit < n ? ` · ${(n - limit).toLocaleString()} more not shown (raise Top bars in the chart settings)` : "";
    this.noteEl.textContent = `${ordered ? "Top" : "First"} ${limit.toLocaleString()} of ${n.toLocaleString()} ${result.dimensionNames[0] ?? "groups"}${leftOut}`;
  }

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
    if (this.config.source === "" && this.drawExtraKind(ctx, frame, result, values)) return;
    if (this.config.source === "" && result.dimensions.length === 1 && result.measures.length > 1 && this.extraValues().length > 0) {
      const columns = [this.config.valueColumn ?? -1, ...this.extraValues()];
      const long = measuresToSeries(result, columns.map((column) => this.meta(column)?.name ?? "value"));
      this.drawSplitAggregate(ctx, frame, long, long.measures[0] ?? new Float64Array(0));
      return;
    }
    if (result.dimensions.length >= 2) {
      this.drawSplitAggregate(ctx, frame, result, values);
      return;
    }
    if (this.config.kind === "kpi" && this.config.source === "") {
      this.drawKpi(ctx, frame, result, values);
      return;
    }
    if (result.dimensionIsTime[0] !== true && result.groupCount > RANKED_BARS_ABOVE) {
      this.drawRankedBars(ctx, frame, result, values);
      return;
    }
    const ui = frame.ui;
    const n = result.groupCount;
    let max = 0;
    for (const value of values) {
      if (Number.isFinite(value)) max = Math.max(max, value);
    }
    for (let i = 0; i < n; i++) max = Math.max(max, this.errorBarAt(result, i)?.high ?? 0);
    // Room above the tallest bar for its value label, clear of any whisker.
    const labelled = result.dimensionIsTime[0] !== true && n <= RANKED_BARS_ABOVE && this.options.docked === true;
    const top = Math.max(1, labelled ? max * 1.1 : max);

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
      ctx.fillText(formatCompact(value), frame.left - 6 * ui, y + 3 * ui);
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
    let gapPeriods = 0;
    if (isTime) {
      // A missing period (NaN) breaks the line; it is never drawn as a zero.
      const base = frame.top + frame.plotH;
      let segment: { x: number; y: number }[] = [];
      const flush = (): void => {
        if (segment.length === 0) return;
        ctx.beginPath();
        segment.forEach((point, k) => (k === 0 ? ctx.moveTo(point.x, point.y) : ctx.lineTo(point.x, point.y)));
        ctx.lineWidth = 2;
        ctx.stroke();
        if (segment.length === 1) {
          ctx.beginPath();
          ctx.arc(segment[0]!.x, segment[0]!.y, 2.5 * ui, 0, Math.PI * 2);
          ctx.fill();
        } else if (this.errorBarResult === null) {
          ctx.lineTo(segment[segment.length - 1]!.x, base);
          ctx.lineTo(segment[0]!.x, base);
          ctx.closePath();
          ctx.globalAlpha = 0.18;
          ctx.fill();
          ctx.globalAlpha = 1;
        }
        segment = [];
      };
      // The band first, under the line; it replaces the usual area fill, which would read as part of it.
      if (this.errorBarResult !== null) {
        const clamp = (value: number): number => Math.max(frame.top, Math.min(base, base - (value / top) * frame.plotH));
        let band: { x: number; low: number; high: number }[] = [];
        const paint = (): void => {
          if (band.length === 1) {
            this.drawWhisker(ctx, frame, band[0]!.x, band[0]!.low, band[0]!.x, band[0]!.high);
          } else if (band.length > 1) {
            ctx.beginPath();
            band.forEach((point, k) => (k === 0 ? ctx.moveTo(point.x, point.high) : ctx.lineTo(point.x, point.high)));
            for (let k = band.length - 1; k >= 0; k--) ctx.lineTo(band[k]!.x, band[k]!.low);
            ctx.closePath();
            ctx.globalAlpha = 0.25;
            ctx.fillStyle = this.primaryColor();
            ctx.fill();
            ctx.globalAlpha = 1;
          }
          band = [];
        };
        for (let i = 0; i < n; i++) {
          const bar = this.errorBarAt(result, i);
          if (bar === null) {
            paint();
            continue;
          }
          band.push({ x: frame.left + (i + 0.5) * slot, low: clamp(bar.low), high: clamp(bar.high) });
        }
        paint();
        ctx.fillStyle = this.primaryColor();
        ctx.strokeStyle = this.primaryColor();
      }
      for (let i = 0; i < n; i++) {
        const value = values[i];
        if (!Number.isFinite(value)) {
          gapPeriods++;
          // Shade the empty period so the gap is visible, not just absent.
          ctx.save();
          ctx.globalAlpha = 0.07;
          ctx.fillStyle = frame.dim;
          ctx.fillRect(frame.left + i * slot, frame.top, slot, frame.plotH);
          ctx.restore();
          flush();
          continue;
        }
        segment.push({
          x: frame.left + (i + 0.5) * slot,
          y: base - (value / top) * frame.plotH,
        });
      }
      flush();
    } else {
      // A few bars get air between them and their value on top; many stay a solid profile.
      const roomy = n <= RANKED_BARS_ABOVE && this.options.docked === true;
      const barW = roomy ? Math.max(1, slot * 0.8) : Math.max(1, slot - 1);
      const inset = roomy ? (slot - barW) / 2 : 0;
      for (let i = 0; i < n; i++) {
        const height = ((values[i] || 0) / top) * frame.plotH;
        if (height <= 0) continue;
        ctx.globalAlpha = 0.85;
        ctx.fillStyle = this.primaryColor();
        this.fillTopRounded(ctx, frame.left + i * slot + inset, frame.top + frame.plotH - height, barW, height, 3 * ui);
        ctx.globalAlpha = 1;
        const bar = this.errorBarAt(result, i);
        const base = frame.top + frame.plotH;
        const barTop = bar === null ? base - height : base - (Math.max(0, bar.high) / top) * frame.plotH;
        if (bar !== null) {
          const x = frame.left + (i + 0.5) * slot;
          this.drawWhisker(ctx, frame, x, base - (Math.max(0, bar.low) / top) * frame.plotH, x, barTop);
        }
        if (roomy) {
          this.font(ctx, ui, 10);
          ctx.textAlign = "center";
          ctx.fillStyle = frame.text;
          ctx.fillText(formatCompact(values[i] ?? 0), frame.left + (i + 0.5) * slot, Math.max(frame.top + 10 * ui, Math.min(base - height, barTop) - 4 * ui));
          ctx.textAlign = "left";
        }
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
    const axisTimes = result.dimensionTimes[0];
    if (isTime && axisTimes !== undefined && axisTimes.length === n) {
      // Calendar boundaries (quarters, months, weeks), not arbitrary bucket labels.
      const room = Math.max(3, Math.floor(frame.plotW / (70 * ui)));
      for (const tick of calendarTicks(Array.from(axisTimes), room)) {
        ctx.fillText(tick.label, frame.left + (tick.index + 0.5) * slot, frame.top + frame.plotH + 14 * ui);
      }
    } else {
      const step = Math.max(1, Math.ceil(n / 8));
      for (let i = 0; i < n; i += step) {
        const label = result.labels[i] ?? "";
        ctx.fillText(
          this.fit(ctx, label, Math.max(16, slot * step - 4 * ui)),
          frame.left + (i + 0.5) * slot,
          frame.top + frame.plotH + 14 * ui,
        );
      }
    }
    ctx.textAlign = "left";
    const measure = plainMeasureName(result.measureNames[0] ?? "value");
    ctx.fillText(measure, frame.left, frame.top - 6 * ui);
    if (gapPeriods > 0) {
      ctx.textAlign = "right";
      ctx.fillText(
        `${gapPeriods} ${gapPeriods === 1 ? "period has" : "periods have"} no data`,
        frame.left + frame.plotW,
        frame.top - 6 * ui,
      );
      ctx.textAlign = "left";
    }

    // One hoverable slot per group: a tooltip, and the value/period it stands
    // for so a right-click can leave it out (click filters the table, as for
    // count bars). Bound views have no table column to act on.
    const dimensionColumn = this.config.source === "" ? this.config.column : -1;
    const dimensionMeta = this.meta(dimensionColumn);
    const categoryLabels = dimensionMeta?.categories?.labels ?? [];
    const times = result.dimensionTimes[0];
    this.hitRegions = [];
    for (let i = 0; i < n; i++) {
      const label = result.labels[i] ?? "";
      const value = values[i];
      const actions: HitAction[] = [];
      if (dimensionMeta !== undefined && this.config.kind !== "histogram") {
        if (isTime && times !== undefined && Number.isFinite(times[i])) {
          const lo = times[i] as number;
          const next = times[i + 1];
          const previous = times[i - 1];
          const hi =
            next !== undefined && Number.isFinite(next)
              ? next - 1
              : previous !== undefined && Number.isFinite(previous)
                ? lo + (lo - previous) - 1
                : lo;
          actions.push({ kind: "range", column: dimensionColumn, min: lo, max: hi });
        } else if (!isTime) {
          const code = categoryLabels.indexOf(label);
          if (code >= 0) actions.push({ kind: "values", column: dimensionColumn, code });
        }
      }
      this.hitRegions.push({
        x: frame.left + i * slot,
        y: frame.top,
        w: slot,
        h: frame.plotH,
        lines: [
          label === "" ? "(blank)" : label,
          `${measure}: ${value !== undefined && Number.isFinite(value) ? formatChartNumber(value) : "—"}`,
          ...this.errorBarLine(result, i),
        ],
        actions,
      });
    }

    if (isTime && times !== undefined && times.length === n && this.config.source === "") {
      this.brushSpace = this.timeSlotBrush(Array.from(times), dimensionColumn, frame);
    }
    const valueAgg = this.config.valueAgg ?? "mean";
    if (
      this.config.source === "" &&
      dimensionColumn >= 0 &&
      (this.config.valueCalc ?? "") === "" &&
      (valueAgg === "sum" || valueAgg === "mean" || valueAgg === "min" || valueAgg === "max" || valueAgg === "count") &&
      (this.config.valueColumn ?? -1) >= 0
    ) {
      this.valueScale = {
        yMax: top,
        top: frame.top,
        plotH: frame.plotH,
        mode: isTime ? "line" : "bars",
        inset: 0,
        barW: Math.max(1, slot - 1),
        regionColumn: dimensionColumn,
        measure: { column: this.config.valueColumn as number, agg: valueAgg },
        scoped: true,
      };
    }

    const ms = result.ms < 1 ? "<1" : String(Math.round(result.ms));
    const partialNote =
      partialCount > 0
        ? ` · ${partialCount} incomplete ${partialCount === 1 ? "period" : "periods"} (hatched)`
        : "";
    this.noteEl.textContent = `${n.toLocaleString()} groups · ${plainMeasureName(measure)} by ${
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
    const liveBins = this.histograms[this.config.column] ?? automatic?.bins ?? [];
    const bins =
      custom !== null
        ? custom.bins
        : automatic === null
          ? liveBins
          : this.withoutExcludedBins(liveBins, automatic.min, automatic.max);
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
    this.brushSpace = {
      left: frame.left,
      top: frame.top,
      plotW: frame.plotW,
      plotH: frame.plotH,
      xColumn: this.config.column,
      xMin: min,
      xMax: max,
      xFraction: bins.length / slots,
    };
    this.valueScale = {
      yMax: maxCount,
      top: frame.top,
      plotH: frame.plotH,
      mode: kind === "line" ? "line" : "bars",
      inset: 0,
      barW,
      regionColumn: this.config.column,
      measure: null,
      scoped: true,
    };
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
      const smooth = smoothSeries(bins, KDE_SIGMA_BINS);
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
    const calendarAxis = kind === "line" && (meta.type === "date" || meta.type === "datetime") && tickSpan > 0;
    if (calendarAxis) {
      // Ticks on calendar boundaries across the whole range, not just three raw dates.
      const dayMs = 86_400_000;
      const stepMs = tickSpan / dayMs > 2000 ? 7 * dayMs : tickSpan / dayMs > 3 ? dayMs : 3_600_000;
      const times: number[] = [];
      for (let t = Math.ceil(min / stepMs) * stepMs; t <= max && times.length < 6000; t += stepMs) times.push(t);
      const room = Math.max(3, Math.floor(frame.plotW / (74 * ui)));
      ctx.textAlign = "center";
      for (const tick of calendarTicks(times, room)) {
        const x = frame.left + ((times[tick.index]! - min) / tickSpan) * frame.plotW;
        const half = ctx.measureText(tick.label).width / 2;
        ctx.fillText(tick.label, Math.min(frame.left + frame.plotW - half, Math.max(frame.left + half, x)), frame.top + frame.plotH + 16 * ui);
      }
      ctx.textAlign = "left";
    }
    const minLabel = formatTick(min, tickKind, tickSpan);
    if (!calendarAxis) ctx.fillText(minLabel, frame.left, frame.top + frame.plotH + 16 * ui);
    // On narrow cards the midpoint label collides with the edge labels.
    if (!calendarAxis && frame.plotW >= 220 * (ui / 1.25)) {
      const midLabel = formatTick(mid, tickKind, tickSpan);
      ctx.fillText(
        midLabel,
        frame.left + frame.plotW / 2 - ctx.measureText(midLabel).width / 2,
        frame.top + frame.plotH + 16 * ui,
      );
    }
    const maxLabel = formatTick(max, tickKind, tickSpan);
    if (!calendarAxis) {
      ctx.fillText(
        maxLabel,
        frame.left + frame.plotW - 4 * ui - ctx.measureText(maxLabel).width,
        frame.top + frame.plotH + 16 * ui,
      );
    }
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
    notes.push("Ctrl+scroll to zoom · drag to pan · double-click resets");
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
      [1000, "second"],
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
    if (this.splitLegend !== null && this.usesAggregate()) {
      this.legendEl.classList.remove("hidden");
      this.legendEl.replaceChildren();
      for (const { label, color } of this.splitLegend) {
        const off = this.hiddenSplit.has(label);
        const item = el(
          "button",
          { class: "chart-legend-item", type: "button", "aria-pressed": off ? "false" : "true", title: off ? `Show ${label}` : `Hide ${label}` },
          [label],
        ) as HTMLButtonElement;
        const swatch = el("span", { class: "chart-legend-swatch" });
        swatch.style.background = color;
        item.prepend(swatch);
        item.classList.toggle("off", off);
        item.addEventListener("click", () => {
          if (this.hiddenSplit.has(label)) this.hiddenSplit.delete(label);
          else this.hiddenSplit.add(label);
          this.render();
        });
        this.legendEl.append(item);
      }
      return;
    }
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
      item.addEventListener("contextmenu", (event) => {
        const groupColumn = this.config.groupColumn;
        if (groupColumn < 0) return;
        event.preventDefault();
        this.openExclusionMenu(
          [{ kind: "values", column: groupColumn, code: this.legendCodeToGroupCode(code) }],
          { x: event.clientX, y: event.clientY },
        );
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
  /** What sizes the map's dots: a Size column, or the rows at each place. Null when every dot is alike. */
  dotsAreSized(): boolean {
    return (this.config.mapMode ?? DEFAULT_MAP_MODE) === "places" || this.config.sizeColumn >= 0;
  }

  /** The radii the Dots row currently stands for; a lone radius when nothing sizes the dots. */
  dotDefaults(): { min: number; max: number } {
    if (!this.dotsAreSized()) return { min: 2.2, max: 2.2 };
    return (this.config.mapMode ?? DEFAULT_MAP_MODE) === "places" ? { min: 3, max: 14 } : { min: 2, max: 9 };
  }

  /** Whether this chart has a numeric value axis a horizontal line can sit on. */
  private hasValueAxis(): boolean {
    const kind = this.config.kind;
    return kind === "line" || kind === "bar" || kind === "barplot" || kind === "histogram" || kind === "scatter" || kind === "density" || kind === "bubble";
  }

  /** The column whose values an axis shows, when it is a plain numeric (or date) column; -1 when the axis is counts or categories. */
  private refAxisColumn(axis: "x" | "y"): number {
    const c = this.config;
    let column = -1;
    switch (c.kind) {
      case "scatter":
      case "density":
      case "bubble":
        column = axis === "x" ? c.x : c.y;
        break;
      case "histogram":
        column = axis === "x" ? c.column : -1;
        break;
      case "line":
      case "bar":
      case "barplot":
        column = axis === "y" ? (c.valueColumn ?? -1) : -1;
        break;
      default:
        column = -1;
    }
    const meta = this.meta(column);
    return meta !== undefined && (isNumericType(meta.type) || meta.type === "date" || meta.type === "datetime") ? column : -1;
  }

  /** The value of a reference line: typed, or the mean of its axis column. */
  private refValue(line: RefLine): number | null {
    if (line.source === "value") return line.value !== undefined && Number.isFinite(line.value) ? line.value : null;
    const meta = this.meta(this.refAxisColumn(line.axis));
    const value = meta?.stats.mean;
    return value === null || value === undefined || !Number.isFinite(value) ? null : value;
  }

  /** The reference lines' rows in the sidebar, rebuilt only when the chart's columns or the lines themselves change. */
  private syncRefLines(): void {
    const lines = this.config.refLines ?? [];
    const key = JSON.stringify([this.config.kind, this.config.x, this.config.y, this.config.column, this.config.valueColumn, lines.map((line) => [line.axis, line.source])]);
    const supported = this.config.kind !== "map" && (this.hasValueAxis() || this.config.kind === "histogram");
    this.refSection.parentElement?.classList.toggle("hidden", !supported);
    if (!supported || key === this.refKey) return;
    this.refKey = key;
    this.refRows.replaceChildren();
    lines.forEach((line, index) => {
      const axisSelect = el("select", { class: "chart-picker chart-picker-small", "aria-label": "Line direction" }) as HTMLSelectElement;
      const options: [string, string][] = [];
      if (this.hasValueAxis()) options.push(["y", "Horizontal"]);
      if (this.config.kind !== "bar" && this.config.kind !== "barplot") options.push(["x", "Vertical"]);
      for (const [value, label] of options) axisSelect.append(el("option", { value }, [label]) as HTMLOptionElement);
      axisSelect.value = line.axis;
      const sourceSelect = el("select", { class: "chart-picker chart-picker-small", "aria-label": "Where the line sits" }) as HTMLSelectElement;
      const column = this.refAxisColumn(line.axis);
      const name = this.meta(column)?.name ?? "";
      sourceSelect.append(el("option", { value: "value" }, ["At a value"]) as HTMLOptionElement);
      if (column >= 0) {
        sourceSelect.append(el("option", { value: "mean" }, [`Mean of ${name}`]) as HTMLOptionElement);
      }
      sourceSelect.value = column >= 0 || line.source === "value" ? line.source : "value";
      const isDate = this.meta(column)?.type === "date" || this.meta(column)?.type === "datetime";
      const input = el("input", {
        class: "chart-number chart-ref-value",
        type: "text",
        inputmode: "decimal",
        placeholder: isDate ? "e.g. 2021-03-01" : "e.g. 10.8",
        "aria-label": "Value of the line",
        spellcheck: "false",
      }) as HTMLInputElement;
      if (line.value !== undefined) input.value = isDate ? new Date(line.value).toISOString().slice(0, 10) : String(line.value);
      input.classList.toggle("hidden", line.source !== "value");
      const remove = el("button", { class: "icon-btn", type: "button", title: "Remove this line", "aria-label": "Remove this line" }, ["×"]) as HTMLButtonElement;
      const update = (patch: Partial<RefLine>): void => {
        const next = [...(this.config.refLines ?? [])];
        next[index] = { ...next[index]!, ...patch };
        this.config.refLines = next;
      };
      axisSelect.addEventListener("change", () => {
        update({ axis: axisSelect.value as "x" | "y", source: "value" });
        this.refKey = "";
        this.syncRefLines();
        this.render();
      });
      sourceSelect.addEventListener("change", () => {
        update({ source: sourceSelect.value as RefLine["source"] });
        this.refKey = "";
        this.syncRefLines();
        this.render();
      });
      input.addEventListener("input", () => {
        const text = input.value.trim().replace(/,/g, "");
        const value = isDate ? Date.parse(text.length === 10 ? `${text}T00:00:00Z` : text) : text === "" ? Number.NaN : Number(text);
        const next = [...(this.config.refLines ?? [])];
        next[index] = { ...next[index]!, value: Number.isFinite(value) ? value : undefined };
        this.config.refLines = next;
        this.render();
      });
      remove.addEventListener("click", () => {
        this.config.refLines = (this.config.refLines ?? []).filter((_, i) => i !== index);
        this.refKey = "";
        this.syncRefLines();
        this.render();
      });
      this.refRows.append(el("div", { class: "chart-ref-row" }, [axisSelect, sourceSelect, input, remove]));
    });
  }

  /** Draws the reference lines over the plot, on whichever numeric axes this chart recorded. */
  private drawReferenceLines(ctx: CanvasRenderingContext2D): void {
    const lines = this.config.refLines ?? [];
    if (lines.length === 0) return;
    const space = this.brushSpace;
    const scale = this.valueScale;
    const isDateAxis = (axis: "x" | "y"): boolean => {
      const type = this.meta(this.refAxisColumn(axis))?.type;
      return type === "date" || type === "datetime";
    };
    const ink = getComputedStyle(this.canvas).color || "#444";
    ctx.save();
    ctx.setLineDash([6, 4]);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = ink;
    ctx.fillStyle = ink;
    ctx.font = "600 11px system-ui, sans-serif";
    for (const line of lines) {
      const value = this.refValue(line);
      if (value === null) continue;
      const label = `${line.source === "value" ? "" : `${line.source} `}${isDateAxis(line.axis) ? new Date(value).toISOString().slice(0, 10) : formatChartNumber(value)}`;
      if (line.axis === "y") {
        let y: number | null = null;
        let left = 0;
        let width = 0;
        if (space !== null && space.yMin !== undefined && space.yMax !== undefined && space.yMax > space.yMin) {
          y = space.top + space.plotH - ((value - space.yMin) / (space.yMax - space.yMin)) * space.plotH;
          ({ left, plotW: width } = space);
          if (value < space.yMin || value > space.yMax) y = null;
        } else if (scale !== null && scale.yMax > 0 && space !== null) {
          y = scale.top + scale.plotH - (value / scale.yMax) * scale.plotH;
          ({ left, plotW: width } = space);
          if (value < 0 || value > scale.yMax) y = null;
        } else if (scale !== null && scale.yMax > 0 && this.hitRegions.length > 0) {
          const first = this.hitRegions[0]!;
          const last = this.hitRegions[this.hitRegions.length - 1]!;
          y = scale.top + scale.plotH - (value / scale.yMax) * scale.plotH;
          left = Math.min(first.x, last.x) - 4;
          width = Math.max(first.x + first.w, last.x + last.w) - left + 4;
          if (value < 0 || value > scale.yMax) y = null;
        }
        if (y === null) continue;
        ctx.beginPath();
        ctx.moveTo(left, y);
        ctx.lineTo(left + width, y);
        ctx.stroke();
        ctx.textAlign = "right";
        ctx.fillText(label, left + width - 4, y - 4);
      } else if (space !== null && space.xMax > space.xMin && value >= space.xMin && value <= space.xMax) {
        const x = space.left + ((value - space.xMin) / (space.xMax - space.xMin)) * space.plotW * space.xFraction;
        ctx.beginPath();
        ctx.moveTo(x, space.top);
        ctx.lineTo(x, space.top + space.plotH);
        ctx.stroke();
        ctx.textAlign = x > space.left + space.plotW * 0.8 ? "right" : "left";
        ctx.fillText(label, x + (ctx.textAlign === "right" ? -4 : 4), space.top + 12);
      }
    }
    ctx.restore();
  }

  private syncDotControls(mapKind: boolean, scatterKind = false): void {
    return syncDotControls(this, mapKind, scatterKind);
  }

  mapLabelColumn(): number {
    return mapLabelColumn(this);
  }

  mapDotLines(result: SeriesPoints, index: number, lon: number, lat: number): string[] {
    return mapDotLines(this, result, index, lon, lat);
  }

  placeFrameActive(): boolean {
    return this.animatesPlaces() && (this.animationResult?.frames.length ?? 0) > 0;
  }

  plateColor(): string {
    return getComputedStyle(document.documentElement).getPropertyValue("--panel").trim() || "#ffffff";
  }

  drawMapSizeLegend(ctx: CanvasRenderingContext2D, frame: Frame, result: SeriesPoints): number {
    return drawMapSizeLegend(this, ctx, frame, result);
  }

  mapRadii(result: SeriesPoints, ui: number): Float64Array | null {
    return mapRadii(this, result, ui);
  }

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
    this.brushSpace = {
      left: frame.left,
      top: frame.top,
      plotW: frame.plotW,
      plotH: frame.plotH,
      xColumn: this.config.x,
      xMin,
      xMax,
      xFraction: 1,
      yColumn: this.config.y,
      yMin,
      yMax,
    };
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
      ctx.fillText(formatCompact(value), frame.left - 6 * ui, y + 3 * ui);
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
          ctx.globalAlpha = 0.9;
          ctx.strokeStyle = darkerColor(layer.color);
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
        y: measure === null ? null : plainMeasureName(`${this.config.valueAgg ?? "mean"}(${measure})`),
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
    // Headroom above the tallest bar, so its count and share sit on the page, not on the bar.
    const maxCount = Math.max(1, ...bars.map((bar) => bar.count)) * 1.12;
    const slotW = frame.plotW / bars.length;
    const barW = Math.max(4, slotW - Math.min(18 * ui, slotW * 0.25));
    const labels = meta.categories?.labels ?? [];
    const codes = bars.map((bar) =>
      bar.other === true ? -1 : labels.indexOf(bar.label),
    );
    this.valueScale = {
      yMax: maxCount,
      top: frame.top,
      plotH: frame.plotH,
      mode: "bars",
      inset: (slotW - barW) / 2,
      barW,
      regionColumn: this.config.column,
      measure: null,
      // Count bars come from the table facets, not this card's own scope.
      scoped: false,
    };
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
    )}${this.config.groupOther && bars.some((bar) => bar.other === true) ? " + Other" : ""}${windowNote} · Ctrl+scroll to zoom · drag to pan · double-click resets`;
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
    this.brushSpace = {
      left: frame.left,
      top: frame.top,
      plotW: frame.plotW,
      plotH: frame.plotH,
      xColumn: this.config.x,
      xMin,
      xMax,
      xFraction: 1,
      yColumn: this.config.y,
      yMin,
      yMax,
    };
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
    if (result.size === null || (result.places !== true && this.config.sizeColumn < 0)) return null;
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
      sizes[i] = result.places === true ? (3 + 11 * Math.sqrt(t)) * ui : (1.6 + 3.4 * Math.sqrt(t)) * ui;
    }
    return sizes;
  }

  colorBuckets(result: SeriesPoints): {
    buckets: Uint8Array;
    colors: string[];
    domain?: ReturnType<typeof resolveColorDomain>;
  } | null {
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
      // Places are averages over few rows or many, so their tails are wild: the scale spans the middle of them,
      // the same scale for every frame while stepping through time.
      const robust = result.places !== true ? null : (this.placeFrame() === null ? robustRange(result.colorValues, n) : (this.animationResult?.places?.colorRange ?? null));
      const domain = resolveColorDomain({
        autoMin: robust?.min ?? min,
        autoMax: robust?.max ?? max,
        min: this.config.colorMin,
        max: this.config.colorMax,
        center: this.config.colorCenter,
      });
      const buckets = new Uint8Array(n).fill(16);
      const paletteName = this.rampPaletteName();
      const ramp = isRampPalette(paletteName) ? this.rampStopsFor(paletteName) : null;
      const colors = colorRamp(ramp, 16, rampColor);
      colors.push(this.primaryColor());
      // Only positive values have a logarithm: a range reaching zero or below stays linear.
      const logColor = this.config.kind === "map" && this.config.mapColorScale === "log" && domain.min > 0 && domain.max > domain.min;
      const logFraction = (value: number): number =>
        Math.max(0, Math.min(1, Math.log(Math.max(value, domain.min) / domain.min) / Math.log(domain.max / domain.min)));
      for (let i = 0; i < n; i++) {
        const value = result.colorValues[i];
        if (!Number.isFinite(value)) continue;
        buckets[i] = Math.round((logColor ? logFraction(value) : colorFraction(value, domain)) * 15);
      }
      return { buckets, colors, domain };
    }
    return null;
  }

  /** One compact gradient legend used by every numeric colour path. */
  drawColorBar(
    ctx: CanvasRenderingContext2D,
    frame: Frame,
    colors: readonly string[],
    domain: ReturnType<typeof resolveColorDomain>,
    /** On a map: stand this far above the plot's bottom, on a solid plate, clear of the floating tools and the dots. */
    aboveBottom?: number,
  ): void {
    const ui = frame.ui;
    const barW = Math.min(150 * ui, frame.plotW * 0.42);
    const barH = 6 * ui;
    const barX = frame.left + frame.plotW - barW - 10 * ui;
    const barY = aboveBottom === undefined ? frame.top + 10 * ui : frame.top + frame.plotH - aboveBottom - barH - 12 * ui;
    ctx.fillStyle = aboveBottom === undefined ? frame.text : this.plateColor();
    ctx.globalAlpha = aboveBottom === undefined ? 0.1 : 0.9;
    ctx.fillRect(barX - 5 * ui, barY - 12 * ui, barW + 10 * ui, barH + 19 * ui);
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
    const minLabel = formatTick(domain.min, null);
    const maxLabel = formatTick(domain.max, null);
    ctx.fillText(minLabel, barX, barY - 3 * ui);
    ctx.fillText(maxLabel, barX + barW - ctx.measureText(maxLabel).width, barY - 3 * ui);
    if (domain.centered) {
      const centerLabel = formatTick((domain.min + domain.max) / 2, null);
      ctx.fillText(
        centerLabel,
        barX + barW / 2 - ctx.measureText(centerLabel).width / 2,
        barY - 3 * ui,
      );
    }
  }
  colorNote(result: SeriesPoints): string | null {
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
        const domain = resolveColorDomain({
          autoMin: min,
          autoMax: max,
          min: this.config.colorMin,
          max: this.config.colorMax,
          center: this.config.colorCenter,
        });
        return `colour: ${meta.name} (${describeColorDomain(domain, (value) =>
          formatTick(value, null),
        )})`;
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
    const radius = (this.config.dotMinRadius ?? 2.2) * frame.ui;
    const alpha = this.config.dotOpacity ?? 0.55;
    const shape = this.config.markerShape ?? "circle";
    // Up to 5,000 points each gets an outline; past that they are filled in one batch per colour, still the chosen shape.
    const detailed = result.shown <= 5000;
    ctx.lineWidth = Math.max(0.9, 1 * frame.ui);

    const drawAt = (index: number): void => {
      const r = Math.max(0.5, sizes === null ? radius : sizes[index]);
      const x = frame.left + (result.x[index] - result.xMin) * xScale;
      const y = frame.top + frame.plotH - (result.y[index] - result.yMin) * yScale;
      if (detailed) {
        ctx.beginPath();
        addMarkerPath(ctx, shape, x, y, r);
        ctx.globalAlpha = alpha;
        ctx.fill();
        ctx.globalAlpha = BORDER_ALPHA;
        ctx.stroke();
      } else {
        addMarkerPath(ctx, shape, x, y, r);
      }
    };

    // Zoom/pan can move points past the plot: clip the marks, not the axes.
    ctx.save();
    ctx.beginPath();
    ctx.rect(frame.left, frame.top, frame.plotW, frame.plotH);
    ctx.clip();
    ctx.globalAlpha = alpha;
    if (buckets === null) {
      ctx.fillStyle = this.primaryColor();
      ctx.strokeStyle = darkerColor(this.primaryColor(), BORDER_DARKER);
      if (!detailed) ctx.beginPath();
      for (let i = 0; i < result.shown; i++) drawAt(i);
      if (!detailed) {
        ctx.globalAlpha = alpha;
        ctx.fill();
        ctx.globalAlpha = BORDER_ALPHA;
        ctx.stroke();
      }
    } else {
      for (let bucket = 0; bucket < buckets.colors.length; bucket++) {
        ctx.fillStyle = buckets.colors[bucket];
        ctx.strokeStyle = darkerColor(buckets.colors[bucket]!, BORDER_DARKER);
        if (!detailed) ctx.beginPath();
        for (let i = 0; i < result.shown; i++) {
          if (buckets.buckets[i] === bucket) drawAt(i);
        }
        if (!detailed) {
          ctx.globalAlpha = alpha;
          ctx.fill();
          ctx.globalAlpha = BORDER_ALPHA;
          ctx.stroke();
        }
      }
    }
    ctx.globalAlpha = 1;
    const fit = this.config.fitLine ?? true ? leastSquares(result.x, result.y, result.shown) : null;
    if (fit !== null) {
      // The dashed line of best fit, across the whole plot.
      const y0 = frame.top + frame.plotH - (fit.intercept + fit.slope * result.xMin - result.yMin) * yScale;
      const y1 = frame.top + frame.plotH - (fit.intercept + fit.slope * result.xMax - result.yMin) * yScale;
      ctx.save();
      ctx.setLineDash([7 * frame.ui, 5 * frame.ui]);
      ctx.lineWidth = Math.max(1.5, 1.8 * frame.ui);
      ctx.strokeStyle = frame.text;
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.moveTo(frame.left, y0);
      ctx.lineTo(frame.left + frame.plotW, y1);
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();

    this.drawCorrelationNote(ctx, frame, fit);
    if (buckets?.domain !== undefined) {
      this.drawColorBar(ctx, frame, buckets.colors, buckets.domain);
    }

    const notes: string[] = [`${result.shown.toLocaleString()} points`];
    if (result.sampled) notes.push(`sampled from ${result.total.toLocaleString()}`);
    if (result.outside > 0) notes.push(`${result.outside.toLocaleString()} outside p1–p99`);
    const colorText = this.colorNote(result);
    if (colorText !== null) notes.push(colorText);
    const sizeMeta = this.meta(this.config.sizeColumn);
    if (sizes !== null && sizeMeta !== undefined) notes.push(`size: ${sizeMeta.name}`);
    notes.push("Ctrl+scroll to zoom · drag to pan · double-click resets");
    if (this.seriesMs > 0) notes.push(`${Math.round(this.seriesMs)} ms`);
    this.noteEl.textContent = notes.join(" · ");
    // Too many points to draw one by one: offer the fancier view instead of choosing it for the person.
    if (result.sampled && this.config.kind === "scatter") {
      const nudge = el("button", { class: "link small chart-density-nudge", type: "button", title: "Count every row in a grid and colour it by how many fall in each cell" }, ["Show all of them as a density map"]);
      nudge.addEventListener("click", () => {
        this.config.mode = "density";
        this.modeSelect.value = "density";
        this.generation++;
        this.renderControls();
        this.refreshSeries();
        this.render();
      });
      this.noteEl.append(" ", nudge);
    }
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
    notes.push("Ctrl+scroll to zoom · drag to pan · double-click resets");
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

  private drawCorrelationNote(ctx: CanvasRenderingContext2D, frame: Frame, fit: { slope: number; intercept: number; r2: number } | null = null): void {
    if (!Number.isFinite(this.seriesCorrelation)) return;
    this.font(ctx, frame.ui, 11, "600");
    ctx.fillStyle = frame.dim;
    ctx.textAlign = "right";
    // R² is the line's: it appears only with the line, and can be switched off on its own. Every row, like r.
    const r2 = fit !== null && (this.config.fitR2 ?? true) ? `  ·  R² = ${(this.seriesCorrelation ** 2).toFixed(2)}` : "";
    ctx.fillText(
      `r = ${this.seriesCorrelation.toFixed(2)}${r2}`,
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
    const leftOut = this.excludedLabels(this.config.y);
    const emptyLabels = (groupMeta?.categories?.labels ?? [])
      .filter((label) => label !== "Other" && !present.has(label) && !leftOut.has(label))
      .slice(0, 3);
    const slotCount = groups.length + emptyLabels.length;
    this.hitRegions = boxHitRegions(
      { left: frame.left, top: frame.top, plotW: frame.plotW, plotH: frame.plotH },
      groups,
      slotCount,
    );
    // A box stands for one category value: right-click can leave it out.
    const boxLabels = groupMeta?.categories?.labels ?? [];
    this.hitRegions.forEach((region, index) => {
      const code = boxLabels.indexOf(groups[index]?.label ?? "");
      if (code >= 0 && groups[index]?.label !== "Other") {
        region.contextActions = [{ kind: "values", column: this.config.y, code }];
      }
    });
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
      ctx.beginPath();
      for (const value of group.outliers) addMarkerPath(ctx, "circle", cx, yOf(value), r);
      ctx.fill();
      ctx.strokeStyle = darkerColor(this.primaryColor(), BORDER_DARKER);
      ctx.globalAlpha = BORDER_ALPHA;
      ctx.lineWidth = Math.max(0.9, ui);
      ctx.stroke();
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

  private pivotHeatmapData(): {
    rowLabels: string[];
    colLabels: string[];
    values: Float64Array;
    measureName: string;
    rowName: string;
    colName: string;
    rowLevel: number;
    colLevel: number;
    truncated: boolean;
  } | null {
    const pivot = this.pivotResult;
    if (pivot === null || pivot.measures.length === 0) return null;
    const rowLevel =
      pivot.rowNames.length === 0
        ? -1
        : Math.max(
            0,
            Math.min(
              pivot.rowNames.length - 1,
              this.config.pivotRowLevel ?? pivot.rowNames.length - 1,
            ),
          );
    const colLevel =
      pivot.colNames.length === 0
        ? -1
        : Math.max(
            0,
            Math.min(
              pivot.colNames.length - 1,
              this.config.pivotColLevel ?? pivot.colNames.length - 1,
            ),
          );
    const measureIndex = Math.max(
      0,
      Math.min(
        pivot.measures.length - 1,
        this.config.pivotMeasure ?? 0,
      ),
    );
    const measure = pivot.measures[measureIndex]!;
    const rowFor = (parts: string[]): string =>
      rowLevel < 0 ? "All" : parts[rowLevel] || "All";
    const colFor = (parts: string[]): string =>
      colLevel < 0 ? "All" : parts[colLevel] || "All";
    const rowSet = new Set<string>();
    const colSet = new Set<string>();
    pivot.rowLabels.forEach((parts) => rowSet.add(rowFor(parts)));
    pivot.colLabels.forEach((parts) => colSet.add(colFor(parts)));
    const allRows = [...rowSet];
    const allCols = [...colSet];
    const rowLimit = 80;
    const colLimit = 60;
    const rowLabels = allRows.slice(0, rowLimit);
    const colLabels = allCols.slice(0, colLimit);
    const rowIndex = new Map(rowLabels.map((label, index) => [label, index]));
    const colIndex = new Map(colLabels.map((label, index) => [label, index]));
    const values = new Float64Array(rowLabels.length * colLabels.length).fill(
      Number.NaN,
    );
    for (let row = 0; row < pivot.rowLabels.length; row++) {
      const r = rowIndex.get(rowFor(pivot.rowLabels[row] ?? []));
      if (r === undefined) continue;
      for (let col = 0; col < pivot.colLabels.length; col++) {
        const c = colIndex.get(colFor(pivot.colLabels[col] ?? []));
        if (c === undefined) continue;
        const value = measure.values[row * pivot.colLabels.length + col];
        if (!Number.isFinite(value)) continue;
        const at = r * colLabels.length + c;
        values[at] = Number.isFinite(values[at])
          ? (values[at] as number) + value
          : value;
      }
    }
    return {
      rowLabels,
      colLabels,
      values,
      measureName: measure.name,
      rowName: pivot.rowNames[rowLevel] ?? "All",
      colName: pivot.colNames[colLevel] ?? "All",
      rowLevel,
      colLevel,
      truncated: rowLabels.length < allRows.length || colLabels.length < allCols.length,
    };
  }

  private drawPivotHeatmap(ctx: CanvasRenderingContext2D, frame: Frame): void {
    if (this.config.source === "" || !this.isPivotSource()) {
      const message = "Choose a pivot view source in the Source menu.";
      this.noteEl.textContent = message;
      this.drawPlotMessage(ctx, frame, message);
      return;
    }
    const data = this.pivotHeatmapData();
    if (
      data === null ||
      data.rowLabels.length === 0 ||
      data.colLabels.length === 0
    ) {
      const message = "The pivot has no rows or columns to draw.";
      this.noteEl.textContent = message;
      this.drawPlotMessage(ctx, frame, message);
      return;
    }
    const { rowLabels, colLabels, values } = data;
    const rowCount = rowLabels.length;
    const colCount = colLabels.length;
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (const value of values) {
      if (!Number.isFinite(value)) continue;
      min = Math.min(min, value);
      max = Math.max(max, value);
    }
    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      const message = "The selected pivot measure has no finite values.";
      this.noteEl.textContent = message;
      this.drawPlotMessage(ctx, frame, message);
      return;
    }
    const domain = resolveColorDomain({
      autoMin: min,
      autoMax: max,
      min: this.config.colorMin,
      max: this.config.colorMax,
      center: this.config.colorCenter,
    });
    const cellW = frame.plotW / colCount;
    const cellH = frame.plotH / rowCount;
    const showText = cellW >= 30 * frame.ui && cellH >= 16 * frame.ui;
    const rampName = this.config.palette ?? DEFAULT_PALETTE;
    const rampStops = isRampPalette(rampName) ? this.rampStopsFor(rampName) : null;
    const colorFor = (t: number): string => colorForFraction(t, rampStops, rampColor);
    const legendColors = colorRamp(rampStops, 16, rampColor);
    this.font(ctx, frame.ui, 9);
    for (let row = 0; row < rowCount; row++) {
      for (let col = 0; col < colCount; col++) {
        const value = values[row * colCount + col] ?? Number.NaN;
        const x = frame.left + col * cellW;
        const y = frame.top + row * cellH;
        if (!Number.isFinite(value)) {
          ctx.fillStyle = frame.border;
          ctx.globalAlpha = 0.3;
          ctx.fillRect(x + 0.5, y + 0.5, Math.max(1, cellW - 1), Math.max(1, cellH - 1));
          ctx.globalAlpha = 1;
          continue;
        }
        const t = colorFraction(value, domain);
        ctx.fillStyle = colorFor(t);
        ctx.fillRect(x + 0.5, y + 0.5, Math.max(1, cellW - 1), Math.max(1, cellH - 1));
        if (showText) {
          ctx.fillStyle = t > 0.55 ? "#ffffff" : frame.text;
          ctx.textAlign = "center";
          ctx.fillText(
            formatChartNumber(value),
            x + cellW / 2,
            y + cellH / 2 + 3.5 * frame.ui,
          );
        }
      }
    }
    this.drawColorBar(ctx, frame, legendColors, domain);
    ctx.textAlign = "center";
    colLabels.forEach((label, col) => {
      ctx.fillStyle = frame.dim;
      ctx.fillText(
        this.fit(ctx, label, Math.max(8, cellW - 4 * frame.ui)),
        frame.left + (col + 0.5) * cellW,
        frame.top + frame.plotH + 14 * frame.ui,
      );
    });
    ctx.textAlign = "right";
    rowLabels.forEach((label, row) => {
      ctx.fillStyle = frame.dim;
      ctx.fillText(
        this.fit(ctx, label, Math.max(8, frame.left - frame.labelPad - 8 * frame.ui)),
        frame.left - frame.labelPad - 4 * frame.ui,
        frame.top + (row + 0.5) * cellH + 3.5 * frame.ui,
      );
    });
    ctx.textAlign = "left";
    const notes = [
      `${data.measureName} by ${data.rowName} x ${data.colName}`,
      `${rowCount}x${colCount} cells`,
    ];
    if (data.truncated) notes.push("large pivot truncated for display");
    if (Number.isFinite(this.pivotResult?.ms ?? Number.NaN)) {
      notes.push(`${Math.round(this.pivotResult?.ms ?? 0)} ms`);
    }
    this.noteEl.textContent = notes.join(" - ");
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
    // Lower triangle only: r is the same both ways round and a column with itself is 1, so a full square would show every pair
    // twice. Row i is column i + 1 against the columns before it.
    const slots = n - 1;
    const sizeX = frame.plotW / slots;
    const sizeY = frame.plotH / slots;
    const gridH = frame.plotH;
    const left = frame.left;
    const top = frame.top;
    const zeroColor = cssVar("--border-subtle", "#eaeef2");
    const showText = Math.min(sizeX, sizeY) >= 30 * ui;
    let minCount = Infinity;

    this.font(ctx, ui, showText ? 10 : 9);
    ctx.strokeStyle = frame.border;
    ctx.lineWidth = 1;
    for (let row = 0; row < slots; row++) {
      for (let column = 0; column <= row; column++) {
        const index = (row + 1) * n + column;
        const r = values[index];
        const cell = correlationCell(r, zeroColor);
        ctx.fillStyle = cell.bg;
        ctx.fillRect(left + column * sizeX, top + row * sizeY, sizeX, sizeY);
        ctx.strokeRect(left + column * sizeX + 0.5, top + row * sizeY + 0.5, sizeX - 1, sizeY - 1);
        if (showText) {
          ctx.fillStyle = cell.fg;
          ctx.textAlign = "center";
          const text = Number.isFinite(r) ? r.toFixed(2) : "—";
          ctx.fillText(text, left + (column + 0.5) * sizeX, top + (row + 0.5) * sizeY + 3.5 * ui);
        }
        const count = counts[index];
        if (count > 0 && count < minCount) minCount = count;
      }
    }
    const corrDomain = resolveColorDomain({ autoMin: -1, autoMax: 1, center: 0 });
    const corrStops = ["#ef4444", zeroColor, "#2563eb"];
    this.drawColorBar(
      ctx,
      frame,
      colorRamp(corrStops, 16, rampColor),
      corrDomain,
    );
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
    labels.slice(0, slots).forEach((label, column) => {
      ctx.fillStyle = frame.dim;
      ctx.fillText(abbreviate(label), left + (column + 0.5) * sizeX, top + gridH + 14 * ui);
    });
    ctx.textAlign = "right";
    labels.slice(1).forEach((label, row) => {
      ctx.fillStyle = frame.dim;
      ctx.fillText(
        this.fit(ctx, label, Math.max(8, left - frame.left - 6 * ui)),
        left - 4 * ui,
        top + (row + 0.5) * sizeY + 3.5 * ui,
      );
    });
    ctx.textAlign = "left";

    const notes = [`${n} columns, each pair once`];
    if (Number.isFinite(minCount)) notes.push(`${minCount.toLocaleString()} min pairwise observations`);
    if (this.statsMs > 0) notes.push(`${Math.round(this.statsMs)} ms`);
    this.noteEl.textContent = notes.join(" · ");
  }
}

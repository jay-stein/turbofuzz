/**
 * The types and constants the chart card is described by (its options and config, the shapes it
 * draws and reports, the limits it works within) and a few small pure helpers. Nothing here touches the page.
 */
import { setColumns } from "./chart-card-data.js";
import { mapLabelColumn } from "./chart-map-draw.js";
import type { ChartBinOptions } from "../data/chart-bins.js";
import { type HitAction } from "./chart-hit-regions.js";
import { type PivotChartField, type PivotChartShape } from "../data/pivot-chart.js";
import type { GetSliceBreakdownRequest, SliceBreakdownMessage } from "../worker/protocol.js";
import { type ChartExclusion } from "../data/chart-exclusions.js";
import type { SeriesGrid, SeriesMode } from "../data/chart-series.js";
import { type IntervalKind } from "../data/error-bars.js";
import { type DotScale } from "../data/dot-size.js";
import type { ColumnSuggestion } from "../data/suggestions.js";
import { CUSTOM_PALETTE, PALETTES } from "../data/palettes.js";
import type { Aggregate, TimeGrain, ViewDef } from "../data/aggregate.js";
import { type FrameStep } from "../data/chart-frames.js";
import type { ColumnFilter } from "../search/query-engine.js";
import type { ErrorBarsMessage, ErrorBarsProgressMessage } from "../worker/protocol.js";
import type { AggregateMessage, BoxStatsMessage, ChartBinsMessage, ChartSeriesMessage, PivotMessage, CorrelationMessage, CrosstabMessage, GroupedBinsMessage, GridCountsMessage, AnimationMessage, TextProfileMessage } from "../worker/protocol.js";
import { type ChartCardKind } from "./chart-utils.js";
import { clear } from "./dom.js";
import { type MapRegionsOptions } from "./map-regions.js";
import type { ChartCard } from "./chart-card.js";


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
export interface ValueScale {
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
export interface BrushSpace {
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


export type DensityStyle = "heat" | "contours" | "both";

/** Above this many categories a value bar chart reads better on its side, with its names in full. */
export const RANKED_BARS_ABOVE = 12;

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
export const MAX_VALUES = 6;

/** A source in a card's Source list: the table, or a Pivot View with the fields a chart of it can use. */
export interface ChartSource {
  id: string;
  name: string;
  kind?: "pivot" | "view";
  fields?: { dimensions: PivotChartField[]; measures: string[]; shape: PivotChartShape };
}

/** The colour maps offered before "More colour maps…": seven that cover what most charts need. */
export const SHORT_PALETTES: readonly string[] = ["tab10", "colorblind", "Set2", "Blues", "rocket", "Blue to red", "RdBu"];
export const MORE_PALETTES = "__more";

/** A chart of a pivot split into series draws at most this many groups of bars along its axis. */
export const SPLIT_AXIS_LIMIT = 20;

/** One overlaid bubble set (a group, or the whole chart when ungrouped). */
export interface BubbleLayer {
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

export const DEFAULT_BIN_COUNT = 32;
export const POINT_LIMIT = 20_000;
/** Grouped time series: distinct lines before the rest folds into Other. */
export const GROUP_LINE_LIMIT = 8;
export const HEX = /^#?[0-9a-f]{6}$/i;

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
export const KDE_SIGMA_BINS = 1.4;

/** Single-series bars and lines of a statistic. */
export const ERROR_BAR_KINDS: ReadonlySet<ChartCardKind> = new Set<ChartCardKind>(["line", "bar", "barplot"]);
export const ERROR_BARS_ASK_CERTAINTY: ReadonlySet<IntervalKind> = new Set<IntervalKind>(["ci", "bootstrap", "se"]);
export const TIME_SERIES_WARNING = "Warning: periods in a time series are related, not independent, so these intervals are likely too narrow";

/** Map joins these only in one dot per place: see animatesPlaces. */
export const ANIMATED_KINDS: ReadonlySet<ChartCardKind> = new Set<ChartCardKind>(["bar", "bubble", "histogram", "treemap", "density", "map"]);

export const MAP_COLOR_AGG_NAMES = { mean: "average", sum: "total", min: "lowest", max: "highest" } as const;

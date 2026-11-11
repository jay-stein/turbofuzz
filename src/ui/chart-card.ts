import { groupSettings, dock, fieldSlots, toggleSidebar, syncSettingsOpen, bindSettingsDismiss, renderSourceOptions, syncSourceControls, syncFieldVisibility, toggleExtraValue, syncExtraValues, setViewShape, pivotRailItems, syncViewShapeOptions, syncPivotOptions, allowsPrimary, syncValueAggOptions, syncOptions, syncChartFilterControls, fillColumnSelect, renderControls, fillPaletteOptions, syncPalette, applyPalette , forgetSettingsDisclosure } from "./chart-card-settings.js";
import { importChartSpecFile, exportPng, openStats, chartExtract, drawnBins, histogramExtract, exportCsv, chartCsvRows, gridCsvRows, syncDeepDive, openCardMenu, toggleFocus, closeFocus, openExportMenu, downloadChartSpec, downloadChartCode, downloadBlob } from "./chart-card-export.js";
import { openKindPicker, selectRegion, drawSelection, queuePointer, showTooltipAtPointer, emitHighlight, setLinkedHighlight, cancelSliceFetch, sliceRegions, sliceEntries, scheduleSliceFetch, scheduleSlicePoints, drawSlicePoints, drawLinkedOverlay, drawSliceShare, handleCanvasClick, finishBrush, timeSlotBrush, drawBrushOverlay, onWheel, withoutExcludedBins, syncExclusions, handleCanvasContextMenu, dataPointAt, openExclusionMenu, excludeFromTable, applyHitAction } from "./chart-interaction.js";
import { allCategoryBars, refreshSeries, refreshTreemap, drawTreemap, refreshText, drawTerms, refreshBox, refreshGroupedBins, widestYLabel, fillTopRounded, drawKpi, drawExtraKind, syncRefLines, drawReferenceLines, axisLabels, drawAxisTitles, drawBars, drawAxes, drawBox } from "./chart-draw-bars.js";
import { refreshCrosstab, refreshBubble, refreshCorrelation, drawBubble, bubbleFraction, drawBubbleGrid, drawScatterLike, pointSizes, colorBuckets, drawColorBar, colorNote, drawPoints, drawDensity, paintDensityHeat, paintDensityBands, paintContourLines, drawCorrelationNote, pivotHeatmapData, drawPivotHeatmap, drawHeatmap, drawCorrelation } from "./chart-draw-points.js";
import { syncAnimationOptions, frameWidths, syncFrameOptions, refreshAnimation, animationBlock, setAnimationTime, toggleAnimationSetup, toggleAnimation, setAnimationSpeed, promptAnimationSpeed, playAnimation, stopAnimation, syncAnimationBar, renderAnimationFrames, exportAnimationGif, exportAnimationVideo, drawAnimatedHistogram, drawAnimatedTreemap, drawAnimatedDensity, drawAnimatedBars } from "./chart-draw-animated.js";
import { drawPlotMessage, emptySeriesMessage, subtitle, drawChart, drawSplitAggregate, drawRankedBars, drawViewAggregate, drawSeries, drawCountAxis, lineUnitLabel, drawGroupedHistogram, drawGroupedLines, syncLegend } from "./chart-draw-aggregate.js";
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
export const KDE_SIGMA_BINS = 1.4;

/** Single-series bars and lines of a statistic. */
export const ERROR_BAR_KINDS: ReadonlySet<ChartCardKind> = new Set<ChartCardKind>(["line", "bar", "barplot"]);
export const ERROR_BARS_ASK_CERTAINTY: ReadonlySet<IntervalKind> = new Set<IntervalKind>(["ci", "bootstrap", "se"]);
export const TIME_SERIES_WARNING = "Warning: periods in a time series are related, not independent, so these intervals are likely too narrow";

/** Map joins these only in one dot per place: see animatesPlaces. */
export const ANIMATED_KINDS: ReadonlySet<ChartCardKind> = new Set<ChartCardKind>(["bar", "bubble", "histogram", "treemap", "density", "map"]);

export const MAP_COLOR_AGG_NAMES = { mean: "average", sum: "total", min: "lowest", max: "highest" } as const;

export class ChartCard {
  readonly root: HTMLElement;

  /** Staleness token for the value-aggregate request only. */
  private valueGeneration = 0;
  /** Same for the bound view or pivot request, which sibling refreshes must not discard. */
  private viewGeneration = 0;
  config = chartConfigWithDefaults();
  columns: ColumnMeta[] = [];
  facets: Record<number, number[]> = {};
  histograms: Record<number, number[]> = {};
  rowCount = 0;
  generation = 0;
  disposed = false;

  pickerSignature = "";
  binResult: ChartBins | null = null;
  lineBinResult: ChartBins | null = null;
  lineBinRange: { min: number; max: number } | null = null;
  private lineBinSignature = "";
  binMedian: number | null = null;
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
  linked: readonly HitAction[] | null = null;
  /** Caption for the linked slice ("East", "18.3 – 18.9"). */
  linkedLabel = "";
  /** How the last paint scaled its marks, so another chart's slice can be drawn on them. */
  valueScale: ValueScale | null = null;
  /** The slice's value per mark of this chart (another column's hover), or null. */
  sliceValues: Float64Array | null = null;
  /** Scatter cards: the points of the hovered slice (same scope, other column's rows). */
  slicePoints: { x: Float64Array; y: Float64Array; shown: number } | null = null;
  sliceTimer: number | null = null;
  sliceGeneration = 0;
  /** Whether the last paint outlined anything for the linked slice. */
  linkedShown = false;
  /** Key of the last slice sent to the panel, so moving within one mark sends nothing. */
  emittedKey = "";
  /** Live Shift+drag rectangle in canvas pixels. */
  brushDrag: { x0: number; y0: number; x1: number; y1: number } | null = null;
  mapBrushStart: { x: number; y: number } | null = null;
  /** Frame of the last paint, used to map brush pixels to lon/lat. */
  lastFrame: Frame | null = null;
  /** Treemap tiles: group labels, the aggregate and the raw row count. */
  treemapResult: {
    labels: string[];
    values: number[];
    rows: number[];
    totalGroups: number;
    truncated: boolean;
  } | null = null;
  /** Top-terms payload: token frequencies plus shape detection. */
  textResult: TextProfileMessage | null = null;
  seriesLabels: string[] | null = null;
  seriesMs = 0;
  seriesCorrelation = Number.NaN;
  boxResult: BoxStatsResult | null = null;
  crossResult: CrossTabResult | null = null;
  correlationResult: {
    labels: string[];
    values: Float64Array;
    counts: Uint32Array;
  } | null = null;
  groupResult: GroupedBinsMessage | null = null;
  bubbleResult: GridCountsResult | null = null;
  animationResult: AnimationResult | null = null;
  animationFrame = 0;
  animationPlaying = false;
  animationTimer: number | null = null;
  animationSetupOpen = false;
  readonly bubbleBinsInput: HTMLInputElement;
  readonly gridField: HTMLElement;
  readonly gridHint: HTMLElement;
  readonly bubbleAggSelect: HTMLSelectElement;
  bubbleAggHint!: HTMLElement;
  private readonly bubbleScaleSelect: HTMLSelectElement;
  readonly animateButton: HTMLButtonElement;
  readonly focusButton: HTMLButtonElement;
  readonly pngButton: HTMLButtonElement;
  readonly statsButton: HTMLButtonElement;
  kindButton: HTMLButtonElement | null = null;
  undoButton: HTMLButtonElement | null = null;
  /** Earlier settings of this chart, newest last, as JSON. */
  private undoStack: string[] = [];
  /** The settings as they were when the person last reached for a control. */
  private undoBefore: string | null = null;
  /** The bar, bin or cell clicked: highlighted, with Filter to this offered beside it. */
  selectedRegion: HitRegion | null = null;
  selectionBar: HTMLElement | null = null;
  /** Plot top the docked height was last worked out from: a legend appearing moves it. */
  private dockedTop = -1;  focusOverlay: HTMLElement | null = null;
  readonly focusPlaceholder = document.createComment("chart-focus");
  readonly animationSetup: HTMLElement;
  readonly bubbleSettings: HTMLElement;
  readonly bubbleTitle: HTMLElement;
  readonly bubbleScaleField: HTMLElement;
  readonly mapModeSelect: HTMLSelectElement;
  readonly mapModeWrap: HTMLElement;
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
  readonly refSection: HTMLElement;
  readonly refRows: HTMLElement;
  refKey = "";
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
  mapPicker: ((lon: number, lat: number) => void) | null = null;
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
  readonly animationTimeSelect: HTMLSelectElement;
  readonly animationGrainSelect: HTMLSelectElement;
  /** "every" before a time grain, "by" before each value / steps of N. */
  readonly animationStepLabel = el("span", { class: "chart-field-label" }, ["every"]);
  readonly animationBar: HTMLElement;
  readonly animationPlayButton: HTMLButtonElement;
  readonly animationSlider: HTMLInputElement;
  readonly animationSpeedSelect: HTMLSelectElement;
  readonly animationFrameLabel: HTMLElement;
  readonly animationLoopInput: HTMLInputElement;
  private readonly animationExportButton: HTMLButtonElement;
  readonly hiddenGroups = new Set<number>();
  statsMs = 0;

  readonly kindSelect: HTMLSelectElement;
  readonly sourceSelect: HTMLSelectElement;
  readonly sourceWrap: HTMLElement;
  sources: ChartSource[] = [];
  readonly viewKindSelect: HTMLSelectElement;
  readonly viewAxisSelect: HTMLSelectElement;
  readonly viewSeriesSelect: HTMLSelectElement;
  readonly viewMeasureSelect: HTMLSelectElement;
  readonly viewAxisWrap: HTMLElement;
  readonly viewSeriesWrap: HTMLElement;
  readonly viewMeasureWrap: HTMLElement;
  readonly backToSource: HTMLButtonElement;
  readonly sourceChip = el(
    "button",
    { class: "chart-source-chip hidden", type: "button", title: "Open the Pivot View this chart draws, as you left it" },
    [],
  ) as HTMLButtonElement;
  readonly extraValuesWrap = el("div", { class: "chart-extra-values hidden", role: "group", "aria-label": "More values" });
  extraValuesKey = "";
  private viewResult: AggregateMessage | null = null;
  /** A view-bound card cannot change type, so its real type is shown as text. */
  readonly kindStatic = el("span", { class: "chart-kind-static hidden" });
  pivotResult: PivotMessage | null = null;
  readonly pivotRowSelect: HTMLSelectElement;
  readonly pivotColSelect: HTMLSelectElement;
  readonly pivotMeasureSelect: HTMLSelectElement;
  readonly pivotRowWrap: HTMLElement;
  readonly pivotColWrap: HTMLElement;
  readonly pivotMeasureWrap: HTMLElement;
  readonly primarySelect: HTMLSelectElement;
  readonly groupSelect: HTMLSelectElement;
  readonly groupWrap: HTMLElement;
  readonly valueSelect: HTMLSelectElement;
  readonly valueWrap: HTMLElement;
  readonly valueAggSelect: HTMLSelectElement;
  readonly valueAggWrap: HTMLElement;
  readonly valueGrainSelect: HTMLSelectElement;
  readonly valueGrainWrap: HTMLElement;
  readonly valueEveryInput: HTMLInputElement;
  readonly valueEveryWrap: HTMLElement;
  readonly valueFillSelect: HTMLSelectElement;
  readonly valueFillWrap: HTMLElement;
  readonly weekStartSelect: HTMLSelectElement;
  readonly weekStartWrap: HTMLElement;
  readonly fiscalSelect: HTMLSelectElement;
  readonly fiscalWrap: HTMLElement;
  /** Series colours of the last split-by time chart, for the one shared legend. */
  splitLegend: { label: string; color: string }[] | null = null;
  readonly hiddenSplit = new Set<string>();
  readonly valueCalcSelect: HTMLSelectElement;
  readonly valueCalcWrap: HTMLElement;
  readonly sortSelect: HTMLSelectElement;
  readonly sortWrap: HTMLElement;
  readonly filterColumnSelect: HTMLSelectElement;
  readonly filterValueSelect: HTMLSelectElement;
  readonly filterRespectInput: HTMLInputElement;
  readonly chartFilterRow: HTMLElement;
  /** Aggregate result for the card's own value-over-time line. */
  private valueResult: AggregateMessage | null = null;
  readonly xSelect: HTMLSelectElement;
  readonly ySelect: HTMLSelectElement;
  readonly colorSelect: HTMLSelectElement;
  readonly sizeSelect: HTMLSelectElement;
  readonly modeSelect: HTMLSelectElement;
  readonly densityStyleSelect: HTMLSelectElement;
  readonly kdeInput: HTMLInputElement;
  readonly correlationSelect: HTMLSelectElement;
  readonly primaryWrap: HTMLElement;
  readonly axesPanel: HTMLElement;
  readonly xWrap: HTMLElement;
  readonly yWrap: HTMLElement;
  readonly colorWrap: HTMLElement;
  readonly sizeWrap: HTMLElement;
  readonly sizeTagLabel: HTMLElement;
  readonly primaryTagLabel: HTMLElement;
  readonly bubbleAggField: HTMLElement;
  readonly modeWrap: HTMLElement;
  readonly densityStyleWrap: HTMLElement;
  readonly xTagLabel: HTMLElement;
  readonly yTagLabel: HTMLElement;
  readonly colorGroup: HTMLElement;
  readonly paletteGroup: HTMLElement;
  readonly paletteSelect: HTMLSelectElement;
  readonly palettePreview: HTMLElement;
  readonly paletteReverseInput: HTMLInputElement;
  private readonly paletteStatus: HTMLElement;
  readonly colorMinInput: HTMLInputElement;
  readonly colorMaxInput: HTMLInputElement;
  readonly colorCenterInput: HTMLInputElement;
  readonly colorDomainRow: HTMLElement;
  readonly histogramSettings: HTMLElement;
  readonly barSettings: HTMLElement;
  readonly barStackField: HTMLElement;
  readonly barStackInput: HTMLInputElement;
  readonly correlationSettings: HTMLElement;
  readonly topLabel: HTMLElement;
  readonly minInput: HTMLInputElement;
  readonly maxInput: HTMLInputElement;
  readonly binsInput: HTMLInputElement;
  readonly overflowInput: HTMLInputElement;
  private readonly topInput: HTMLInputElement;
  private readonly otherInput: HTMLInputElement;
  readonly multiInput: HTMLInputElement;
  private readonly swatches: HTMLButtonElement[] = [];
  readonly hexInput: HTMLInputElement;
  private readonly titleInput: HTMLInputElement;
  private readonly xTitleInput: HTMLInputElement;
  private readonly yTitleInput: HTMLInputElement;
  private readonly yUnitInput: HTMLInputElement;
  readonly canvas: HTMLCanvasElement;
  private readonly mapControls: HTMLElement;
  readonly canvasWrap: HTMLElement;
  readonly scopeEl: HTMLElement;
  readonly summaryEl: HTMLElement;
  /** One short note under the heading (see lint); dismissed notes stay dismissed. */
  private readonly lintEl = el("div", { class: "chart-lint hidden", role: "note" });
  private readonly dismissedNotes = new Set<string>();
  private readonly dataIssueEl: HTMLElement;
  readonly deepDiveEl: HTMLElement;
  private issueSignature = "";
  readonly noteEl: HTMLElement;
  private totalRowCount = 0;
  readonly legendEl: HTMLElement;
  readonly tooltipEl: HTMLElement;
  readonly settingsBody: HTMLElement;
  settingsDisclosure: HTMLDetailsElement | null = null;
  sidebar!: HTMLElement;
  sidebarToggle!: HTMLButtonElement;
  layoutEl!: HTMLElement;
  sidebarShown = false;
  settingsDismiss: (() => void) | null = null;
  hitRegions: HitRegion[] = [];
  exclusionBar!: HTMLElement;
  pointerAt: { x: number; y: number; clientX: number; clientY: number } | null = null;
  /** Last hovered/clicked region, retained while the card menu is open. */
  lastActionRegion: HitRegion | null = null;
  pointerFrame: number | null = null;

  private readonly onResize = (): void => this.scheduleRender(this.options.docked === true);
  private readonly onThemeChange = (): void => this.scheduleRender(true);
  private renderQueued = false;
  private renderForce = false;
  /** True while the frame only shows an empty-state message, so no axes. */
  plotMessageDrawn = false;
  /** Set while drawing on the Chart page, where the headline above the plot says what it is. */
  plotHasHeadline = false;
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

  groupSettings(): void {
    return groupSettings(this);
  }

  readonly dataDrawer = new ChartDataDrawer(() => this.dataDrawerRows());

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
  readonly settingsGroups: HTMLDetailsElement[] = [];

  private dock(head: HTMLElement, quickRow: HTMLElement, sideHead: HTMLElement, canvasWrap: HTMLElement): void {
    return dock(this, head, quickRow, sideHead, canvasWrap);
  }

  /** The settings as they stand, before whatever the person is about to do. */
  noteBeforeChange(): void {
    this.undoBefore = JSON.stringify(this.getConfig());
  }

  /** Handlers run first, so a real change shows here as a difference from the note above. */
  noteAfterChange(): void {
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

  syncKindButton(): void {
    const button = this.kindButton;
    if (button === null) return;
    const kind = this.config.kind;
    button.replaceChildren(kindIcon(kind), el("span", {}, [CHART_KIND_LABELS[kind]]), el("span", { class: "chart-kind-caret", "aria-hidden": "true" }, ["▾"]));
    button.classList.toggle("hidden", this.config.source !== "");
  }

  openKindPicker(): void {
    return openKindPicker(this);
  }

  /** The places a chart of this type has for a field, each one a setting already on the panel. */
  fieldControls(): { label: string; select: HTMLSelectElement; wrap: HTMLElement }[] {
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

  fieldSlots(column: number): { label: string; active: boolean; clearable: boolean; empty: boolean; toggle(): void }[] {
    return fieldSlots(this, column);
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

  selectRegion(region: HitRegion): void {
    return selectRegion(this, region);
  }

  clearSelection(): void {
    this.selectedRegion = null;
    this.selectionBar?.classList.add("hidden");
    this.selectionBar?.replaceChildren();
  }

  private drawSelection(ctx: CanvasRenderingContext2D): void {
    return drawSelection(this, ctx);
  }

  /**
   * Settings live in a drawer that overlays the card, closed by default so the
   * chart keeps the full width. Escape closes it and returns focus to Customize.
   */
  /** Escape closes an open drawer wherever focus is (the chart itself cannot hold focus). */
  readonly onDrawerEscape = (event: KeyboardEvent): void => {
    if (event.key !== "Escape" || !this.sidebarShown || event.defaultPrevented) return;
    this.toggleSidebar();
    this.sidebarToggle.focus();
  };

  private toggleSidebar(): void {
    return toggleSidebar(this);
  }

  private syncSettingsOpen(): void {
    return syncSettingsOpen(this);
  }

  bindSettingsDismiss(settings: HTMLDetailsElement): void {
    return bindSettingsDismiss(this, settings);
  }

  unbindSettingsDismiss(): void {
    this.settingsDismiss?.();
    this.settingsDismiss = null;
  }

  dispose(): void {
    this.disposed = true;
    this.dataDrawer.dispose();
    document.removeEventListener("keydown", this.onDrawerEscape);
    forgetSettingsDisclosure(this.settingsDisclosure);
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
    return renderSourceOptions(this);
  }

  syncSourceControls(): void {
    return syncSourceControls(this);
  }

  syncFieldVisibility(): void {
    return syncFieldVisibility(this);
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
  allowsExtraValues(): boolean {
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
  extraValues(): number[] {
    if (!this.allowsExtraValues()) return [];
    return (this.config.extraValueColumns ?? []).filter(
      (column, index, all) =>
        column !== this.config.valueColumn &&
        all.indexOf(column) === index &&
        isNumericType(this.meta(column)?.type ?? "string"),
    );
  }

  toggleExtraValue(column: number): void {
    return toggleExtraValue(this, column);
  }

  syncExtraValues(): void {
    return syncExtraValues(this);
  }

  setViewShape(key: "viewAxis" | "viewSeries" | "viewMeasure", value: number): void {
    return setViewShape(this, key, value);
  }

  pivotRailItems(): {
    name: string;
    glyph: string;
    role: string;
    slots: { label: string; active: boolean; clearable: boolean; empty: boolean; toggle(): void }[];
  }[] | null {
    return pivotRailItems(this);
  }

  /** The pivot fields this chart can use, when its source is a Pivot View that offered them. */
  viewFields(): NonNullable<ChartSource["fields"]> | null {
    if (this.config.source === "") return null;
    return this.sources.find((entry) => entry.id === this.config.source)?.fields ?? null;
  }

  /** Axis, series and value as chosen, each falling back to the pivot's own layout. */
  viewShape(): PivotChartShape | null {
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

  syncViewShapeOptions(): void {
    return syncViewShapeOptions(this);
  }

  private syncPivotOptions(): void {
    return syncPivotOptions(this);
  }

  isPivotSource(): boolean {
    return (
      this.config.source !== "" &&
      this.sources.find((entry) => entry.id === this.config.source)?.kind === "pivot"
    );
  }
  /** True when this card plots its own measure aggregate (line/bar/KPI/bins). */
  usesValueAggregate(): boolean {    return (
      this.config.source === "" &&
      VALUE_AGGREGATE_KINDS.includes(this.config.kind) &&
      (this.config.valueColumn ?? -1) >= 0
    );
  }

  /** True when the card draws an aggregate result (bound view or own value). */
  usesAggregate(): boolean {
    return this.config.source !== "" || this.usesValueAggregate();
  }

  aggregateResult(): AggregateMessage | null {
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
  fillPolicy(): "gap" | "zero" | "carry" {
    if (this.config.valueFill !== undefined) return this.config.valueFill;
    const agg = this.config.valueAgg ?? "mean";
    return agg === "sum" || agg === "count" || agg === "distinct" ? "zero" : "gap";
  }

  /** The grain in use: the chosen one, or the automatic one for this date column. */
  resolvedGrain(): TimeGrain {
    return this.config.valueGrain === undefined || this.config.valueGrain === "auto"
      ? this.defaultGrainFor(this.config.column)
      : this.config.valueGrain;
  }

  /** True once a grain is picked by hand; Auto chooses width and unit together. */
  hasExplicitGrain(): boolean {
    return this.config.valueGrain !== undefined && this.config.valueGrain !== "auto";
  }

  /** Bucket width for `grain`: the typed one, or what Auto chose for the default grain. */
  everyFor(grain: TimeGrain): number {
    if (this.hasExplicitGrain()) return Math.max(1, Math.floor(this.config.valueEvery ?? 1));
    const auto = this.defaultStepFor(this.config.column);
    return auto.grain === grain ? auto.every : 1;
  }

  /** "week", "15 minutes": the bucket in use, for headlines. */
  stepNoun(plural = false): string {
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
  syncSummary(): void {
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

  importChartSpecFile(): void {
    return importChartSpecFile(this);
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
    return exportPng(this, width, height);
  }

  private openStats(): void {
    return openStats(this);
  }

  chartExtract(): ChartExtract {
    return chartExtract(this);
  }

  errorBarExtract(aggregate: AggregateMessage, facts: [string, string][], table: (name: string, rows: string[][]) => void): void {
    return errorBarExtract(this, aggregate, facts, table);
  }

  drawnBins(): { bins: readonly number[]; edges: number[]; overflow: number; symlog: boolean; below: number; above: number } | null {
    return drawnBins(this);
  }

  histogramExtract(facts: [string, string][], table: (name: string, rows: string[][]) => void): void {
    return histogramExtract(this, facts, table);
  }

  mapExtract(facts: [string, string][], table: (name: string, rows: string[][]) => void): void {
    return mapExtract(this, facts, table);
  }

  exportCsv(): void {
    return exportCsv(this);
  }

  chartCsvRows(): string[][] {
    return chartCsvRows(this);
  }

  binRangeFor(kind: ChartCardKind): { min: number; max: number } | null {
    if (kind === "histogram") return this.config.binOptions;
    return this.lineBinRange;
  }

  gridCsvRows(grid: GridCountsResult): string[][] {
    return gridCsvRows(this, grid);
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
  isDateLike(meta: ColumnMeta | undefined): boolean {
    return meta !== undefined && (meta.type === "date" || meta.type === "datetime");
  }

  allowsPrimary(meta: ColumnMeta): boolean {
    return allowsPrimary(this, meta);
  }

  allowsAxis(meta: ColumnMeta): boolean {
    return (
      isNumericType(meta.type) ||
      meta.type === "date" ||
      meta.type === "datetime" ||
      meta.type === "duration"
    );
  }

  allowsX(meta: ColumnMeta): boolean {
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

  allowsY(meta: ColumnMeta): boolean {
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

  allowedIndexes(allow: (meta: ColumnMeta) => boolean): number[] {
    const out: number[] = [];
    this.columns.forEach((meta, index) => {
      if (allow(meta)) out.push(index);
    });
    return out;
  }

  /** Type-aware aggregation choices for the bound value column. */
  /** The aggregation as a sentence has it: "Average of price", not the menu's "Average (mean)". */
  aggPhrase(): string {
    const label = this.valueAggSelect.selectedOptions[0]?.textContent ?? this.config.valueAgg ?? "Average";
    return label.replace(/ \(mean\)$/, "");
  }

  syncValueAggOptions(): void {
    return syncValueAggOptions(this);
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

  setKind(kind: ChartCardKind): void {
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
    return syncOptions(this);
  }

  syncChartFilterControls(): void {
    return syncChartFilterControls(this);
  }

  syncAnimationOptions(): void {
    return syncAnimationOptions(this);
  }

  /** A number column frames can step through in order: integers and decimals (dates are offered on their own). */
  isFrameNumber(meta: ColumnMeta | undefined): boolean {
    return meta !== undefined && (meta.type === "integer" || meta.type === "number") && meta.stats.min !== null && meta.stats.max !== null;
  }

  frameWidths(meta: ColumnMeta): number[] {
    return frameWidths(this, meta);
  }

  /** Each value when a number column has few enough of them to watch, else steps for about 20 frames. */
  defaultFrameStep(meta: ColumnMeta): "value" | number {
    if (meta.stats.distinct <= 60) return "value";
    const widths = this.frameWidths(meta);
    return widths[Math.min(1, widths.length - 1)]!;
  }

  syncFrameOptions(): void {
    return syncFrameOptions(this);
  }

  /** The frames to ask the worker for: the time grain for a date column, each value or steps for a number column. */
  frameStep(): FrameStep {
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
  defaultGrainFor(column: number): TimeGrain {
    return this.defaultStepFor(column).grain;
  }

  /**
   * Automatic bucket for a date column: a short span of timestamps gets minutes
   * or half-hours (about sixty points), longer ones day, week or month.
   */
  defaultStepFor(column: number): { grain: TimeGrain; every: number } {
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

  fillColumnSelect(select: HTMLSelectElement, allowed: readonly number[], slotIndex: number, leading: HTMLOptionElement[] = []): void {
    return fillColumnSelect(this, select, allowed, slotIndex, leading);
  }

  option(value: string, label: string): HTMLOptionElement {
    return el("option", { value }, [label]) as HTMLOptionElement;
  }

  renderControls(): void {
    return renderControls(this);
  }

  syncSwatches(): void {
    for (const swatch of this.swatches) {
      const active = swatch.title.toLowerCase() === this.primaryColor().toLowerCase();
      swatch.classList.toggle("active", active);
    }
  }

  /** Colours sampled from the card's palette for `count` series/buckets. */
  paletteColors(count: number): string[] {
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

  paletteColor(index: number, count = 12): string {
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
  rampPaletteName(): string {
    const chosen = this.config.palette ?? DEFAULT_PALETTE;
    const meta = this.meta(this.config.colorColumn);
    // A list of separate colours cannot show low to high, so it is no choice for this.
    return !isRampPalette(chosen) && this.config.kind === "map" && meta !== undefined && isNumericType(meta.type) ? "Blue to red" : chosen;
  }

  fillPaletteOptions(all: boolean): void {
    return fillPaletteOptions(this, all);
  }

  syncPalette(): void {
    return syncPalette(this);
  }

  private async applyPalette(value: string): Promise<void> {
    return applyPalette(this, value);
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

  defaultTitle(): string {
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
  seriesTarget(): ChartSeriesTarget | null {
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

  private syncDeepDive(): void {
    return syncDeepDive(this);
  }

  private openCardMenu(anchor: HTMLElement): void {
    return openCardMenu(this, anchor);
  }

  chartName(): string {
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

  allCategoryBars(): CategoryBar[] {
    return allCategoryBars(this);
  }

  /** The full data range a line/histogram x axis can zoom within. */
  xZoomBase(): { min: number; max: number } | null {
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

  excludes(): ChartExclusion[] {
    return this.config.excludes ?? [];
  }

  /** The `chartExclude` field for worker requests (absent when nothing is excluded). */
  excludeScope(): { chartExclude?: ChartExclusion[] } {
    const list = this.excludes();
    return list.length > 0 ? { chartExclude: list } : {};
  }

  refreshSeries(): void {
    return refreshSeries(this);
  }

  private refreshTreemap(): void {
    return refreshTreemap(this);
  }

  drawTreemap(ctx: CanvasRenderingContext2D, frame: Frame): void {
    return drawTreemap(this, ctx, frame);
  }

  private refreshText(): void {
    return refreshText(this);
  }

  drawTerms(ctx: CanvasRenderingContext2D, frame: Frame): void {
    return drawTerms(this, ctx, frame);
  }

  private refreshBox(): void {
    return refreshBox(this);
  }

  private refreshCrosstab(): void {
    return refreshCrosstab(this);
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
  bubbleGroupColumn(): number | undefined {
    if (this.config.groupColumn < 0) return undefined;
    const meta = this.meta(this.config.groupColumn);
    return meta !== undefined && isGroupable(meta) ? this.config.groupColumn : undefined;
  }

  private refreshBubble(): void {
    return refreshBubble(this);
  }

  refreshMapGrid(): void {
    return refreshMapGrid(this);
  }

  refreshAnimation(): void {
    return refreshAnimation(this);
  }

  private toggleFocus(): void {
    return toggleFocus(this);
  }

  closeFocus(): void {
    return closeFocus(this);
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

  errorBarAt(result: AggregateMessage, index: number): { low: number; high: number; n: number } | null {
    return errorBarAt(this, result, index);
  }

  errorBarName(): string {
    const kind = this.errorBarKind();
    return kind === "ci" ? "95% CI" : kind === "bootstrap" ? "95% CI (bootstrap)" : kind === "se" ? "± 1 standard error" : kind === "sd" ? "± 1 standard deviation" : "Middle 95% of rows";
  }

  /** The bar's end in tooltips. */
  errorBarLine(result: AggregateMessage, index: number): string[] {
    const bar = this.errorBarAt(result, index);
    return bar === null ? [] : [`${this.errorBarName()}: ${formatChartNumber(bar.low)} to ${formatChartNumber(bar.high)}`, `${bar.n.toLocaleString()} rows`];
  }

  drawWhisker(ctx: CanvasRenderingContext2D, frame: Frame, x0: number, y0: number, x1: number, y1: number): void {
    return drawWhisker(this, ctx, frame, x0, y0, x1, y1);
  }

  appendErrorBarNote(result: AggregateMessage | null): void {
    return appendErrorBarNote(this, result);
  }

  /** A map animates its places: each dot stays put while its size and colour change. */
  animatesPlaces(): boolean {
    return this.config.kind === "map" && (this.config.mapMode ?? DEFAULT_MAP_MODE) === "places";
  }

  placeFrame(): SeriesPoints | null {
    return placeFrame(this);
  }

  animationBlock(): string | null {
    return animationBlock(this);
  }

  setAnimationTime(column: number): void {
    return setAnimationTime(this, column);
  }

  private toggleAnimationSetup(): void {
    return toggleAnimationSetup(this);
  }

  private toggleAnimation(): void {
    return toggleAnimation(this);
  }

  /** Milliseconds per frame: 0.5 s at 1×, faster at higher speeds. */
  frameIntervalMs(): number {
    const speed = this.config.animationSpeed ?? 1;
    const safe = Number.isFinite(speed) && speed > 0 ? speed : 1;
    return Math.max(60, Math.round(500 / safe));
  }

  setAnimationSpeed(speed: number): void {
    return setAnimationSpeed(this, speed);
  }

  private async promptAnimationSpeed(): Promise<void> {
    return promptAnimationSpeed(this);
  }

  playAnimation(): void {
    return playAnimation(this);
  }

  stopAnimation(): void {
    return stopAnimation(this);
  }

  syncAnimationBar(): void {
    return syncAnimationBar(this);
  }

  private openExportMenu(anchor: HTMLElement): void {
    return openExportMenu(this, anchor);
  }

  async renderAnimationFrames(): Promise<
    { frames: GifFrameInput[]; width: number; height: number } | null
  > {
    return renderAnimationFrames(this);
  }

  downloadChartSpec(): void {
    return downloadChartSpec(this);
  }

  downloadChartCode(pandas: boolean): void {
    return downloadChartCode(this, pandas);
  }

  downloadBlob(blob: Blob, extension: string): void {
    return downloadBlob(this, blob, extension);
  }

  async exportAnimationGif(): Promise<void> {
    return exportAnimationGif(this);
  }

  async exportAnimationVideo(): Promise<void> {
    return exportAnimationVideo(this);
  }

  private refreshCorrelation(): void {
    return refreshCorrelation(this);
  }

  private refreshGroupedBins(): void {
    return refreshGroupedBins(this);
  }

  /** Coalesces resize-driven redraws into one animation frame. */
  /**
   * Coalesces resize-driven redraws into one animation frame. Repaints are
   * skipped when the wrap width has not actually changed: the canvas height is
   * derived from the width, so reacting to every wrap mutation can oscillate
   * (scrollbar thresholds, sticky layouts). Theme changes force a repaint.
   */
  scheduleRender(force = false): void {
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

  private queuePointer(event: PointerEvent): void {
    return queuePointer(this, event);
  }

  showTooltipAtPointer(): void {
    return showTooltipAtPointer(this);
  }

  emitHighlight(actions: readonly HitAction[] | null, label = ""): void {
    return emitHighlight(this, actions, label);
  }

  setLinkedHighlight(actions: readonly HitAction[] | null, label = ""): void {
    return setLinkedHighlight(this, actions, label);
  }

  cancelSliceFetch(): void {
    return cancelSliceFetch(this);
  }

  sliceRegions(): SliceRegion[] | null {
    return sliceRegions(this);
  }

  sliceEntries(actions: readonly HitAction[]): ChartExclusion[] | null {
    return sliceEntries(this, actions);
  }

  scheduleSliceFetch(actions: readonly HitAction[]): void {
    return scheduleSliceFetch(this, actions);
  }

  scheduleSlicePoints(actions: readonly HitAction[]): void {
    return scheduleSlicePoints(this, actions);
  }

  drawSlicePoints(ctx: CanvasRenderingContext2D, space: BrushSpace): number {
    return drawSlicePoints(this, ctx, space);
  }

  private drawLinkedOverlay(ctx: CanvasRenderingContext2D): void {
    return drawLinkedOverlay(this, ctx);
  }

  drawSliceShare(ctx: CanvasRenderingContext2D, scale: ValueScale, values: Float64Array): number {
    return drawSliceShare(this, ctx, scale, values);
  }

  hideTooltip(): void {
    this.emitHighlight(null);
    this.tooltipEl.classList.add("hidden");
    this.canvas.classList.remove("chart-clickable");
  }

  private handleCanvasClick(event: MouseEvent): void {
    return handleCanvasClick(this, event);
  }

  private beginMapBrush(event: PointerEvent): void {
    return beginMapBrush(this, event);
  }

  private endMapBrush(event: PointerEvent): void {
    return endMapBrush(this, event);
  }

  finishBrush(drag: { x0: number; y0: number; x1: number; y1: number }): void {
    return finishBrush(this, drag);
  }

  timeSlotBrush(times: readonly number[], column: number, frame: Frame): BrushSpace | null {
    return timeSlotBrush(this, times, column, frame);
  }

  /** Whole-number columns get whole-number bounds so the edge rows stay in. */
  roundedRange(column: number, min: number, max: number): BrushRange {
    if (this.meta(column)?.type === "integer") {
      return { column, min: Math.floor(min), max: Math.ceil(max) };
    }
    return { column, min, max };
  }

  private drawBrushOverlay(ctx: CanvasRenderingContext2D): void {
    return drawBrushOverlay(this, ctx);
  }

  private onWheel(event: WheelEvent): void {
    return onWheel(this, event);
  }

  zoomMap(factor: number, tx = 0.5, ty = 0.5): void {
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
  excludedLabels(column: number): Set<string> {
    const out = new Set<string>();
    for (const entry of this.excludes()) {
      if (entry.kind === "values" && entry.column === column) {
        for (const label of entry.labels) out.add(label);
      }
    }
    return out;
  }

  excludedTerms(column: number): Set<string> {
    const out = new Set<string>();
    for (const entry of this.excludes()) {
      if (entry.kind === "text" && entry.column === column) out.add(entry.query.toLowerCase());
    }
    return out;
  }

  withoutExcludedBins(bins: number[], min: number, max: number): number[] {
    return withoutExcludedBins(this, bins, min, max);
  }

  /** Readable range bounds for a column: dates as dates, numbers trimmed. */
  boundFormatter(column: number): (value: number) => string {
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
  legendCodeToGroupCode(code: number): number {
    return code;
  }

  /** True when this card can leave things out (it draws from the table, not a bound view). */
  canExclude(): boolean {
    return this.config.source === "";
  }

  setExcludes(next: ChartExclusion[]): void {
    this.config.excludes = next.length > 0 ? next : undefined;
    this.syncExclusions();
    // Re-request every data path with the new scope, then repaint.
    this.setFiltered(this.facets, this.histograms);
  }

  private syncExclusions(): void {
    return syncExclusions(this);
  }

  private handleCanvasContextMenu(event: MouseEvent): void {
    return handleCanvasContextMenu(this, event);
  }

  dataPointAt(clientX: number, clientY: number): { x: number; y: number } | null {
    return dataPointAt(this, clientX, clientY);
  }

  openExclusionMenu(actions: readonly HitAction[], at: { x: number; y: number }, point: { x: number; y: number } | null = null): void {
    return openExclusionMenu(this, actions, at, point);
  }

  excludeFromTable(column: number, code: number): void {
    return excludeFromTable(this, column, code);
  }

  applyHitAction(action: HitAction): void {
    return applyHitAction(this, action);
  }

  drawPlotMessage(ctx: CanvasRenderingContext2D, frame: Frame, message: string): void {
    return drawPlotMessage(this, ctx, frame, message);
  }

  /** False while the card has nothing its kind can plot. */
  canDraw(): boolean {
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

  emptySeriesMessage(kind: "histogram" | "line" | "bar"): string {
    return emptySeriesMessage(this, kind);
  }

  /**
   * Text scale: on screen the smallest 9px label must stay at least 11px, so
   * ui never drops below 1.25; exports keep the reference height/540 scale.
   */
  textScale(height: number, forExport: boolean): number {
    const scale = height / 540;
    return forExport ? Math.max(0.7, Math.min(2.6, scale)) : Math.max(1.25, scale);
  }

  frame(
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

  widestYLabel(ctx: CanvasRenderingContext2D, ui: number): string {
    return widestYLabel(this, ctx, ui);
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

  fillTopRounded(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, radius: number): void {
    return fillTopRounded(this, ctx, x, y, w, h, radius);
  }

  subtitle(): string {
    return subtitle(this);
  }

  drawChart(ctx: CanvasRenderingContext2D, width: number, height: number, forExport = false): void {
    return drawChart(this, ctx, width, height, forExport);
  }

  drawSplitAggregate(ctx: CanvasRenderingContext2D, frame: Frame, result: AggregateMessage, values: Float64Array): void {
    return drawSplitAggregate(this, ctx, frame, result, values);
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

  drawMap(ctx: CanvasRenderingContext2D, frame: Frame): void {
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

  drawKpi(ctx: CanvasRenderingContext2D, frame: Frame, result: AggregateMessage, values: Float64Array): void {
    return drawKpi(this, ctx, frame, result, values);
  }

  drawExtraKind(ctx: CanvasRenderingContext2D, frame: Frame, result: AggregateMessage, values: Float64Array): boolean {
    return drawExtraKind(this, ctx, frame, result, values);
  }

  drawRankedBars(ctx: CanvasRenderingContext2D, frame: Frame, result: AggregateMessage, values: Float64Array): void {
    return drawRankedBars(this, ctx, frame, result, values);
  }

  drawViewAggregate(ctx: CanvasRenderingContext2D, frame: Frame): void {
    return drawViewAggregate(this, ctx, frame);
  }

  drawSeries(ctx: CanvasRenderingContext2D, frame: Frame, kind: "histogram" | "line"): void {
    return drawSeries(this, ctx, frame, kind);
  }

  drawCountAxis(ctx: CanvasRenderingContext2D, frame: Frame, maxCount: number): void {
    return drawCountAxis(this, ctx, frame, maxCount);
  }

  lineUnitLabel(min: number, max: number, bins: number): string {
    return lineUnitLabel(this, min, max, bins);
  }

  drawGroupedHistogram(ctx: CanvasRenderingContext2D, frame: Frame): void {
    return drawGroupedHistogram(this, ctx, frame);
  }

  drawGroupedLines(ctx: CanvasRenderingContext2D, frame: Frame): void {
    return drawGroupedLines(this, ctx, frame);
  }

  groupColor(index: number): string {
    return this.paletteColor(index);
  }

  private syncLegend(): void {
    return syncLegend(this);
  }

  drawAnimatedHistogram(ctx: CanvasRenderingContext2D, frame: Frame): void {
    return drawAnimatedHistogram(this, ctx, frame);
  }

  drawAnimatedTreemap(ctx: CanvasRenderingContext2D, frame: Frame): void {
    return drawAnimatedTreemap(this, ctx, frame);
  }

  drawAnimatedDensity(ctx: CanvasRenderingContext2D, frame: Frame): void {
    return drawAnimatedDensity(this, ctx, frame);
  }

  drawAnimatedBars(ctx: CanvasRenderingContext2D, frame: Frame): void {
    return drawAnimatedBars(this, ctx, frame);
  }

  drawBubble(ctx: CanvasRenderingContext2D, frame: Frame): void {
    return drawBubble(this, ctx, frame);
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
  hasValueAxis(): boolean {
    const kind = this.config.kind;
    return kind === "line" || kind === "bar" || kind === "barplot" || kind === "histogram" || kind === "scatter" || kind === "density" || kind === "bubble";
  }

  /** The column whose values an axis shows, when it is a plain numeric (or date) column; -1 when the axis is counts or categories. */
  refAxisColumn(axis: "x" | "y"): number {
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
  refValue(line: RefLine): number | null {
    if (line.source === "value") return line.value !== undefined && Number.isFinite(line.value) ? line.value : null;
    const meta = this.meta(this.refAxisColumn(line.axis));
    const value = meta?.stats.mean;
    return value === null || value === undefined || !Number.isFinite(value) ? null : value;
  }

  syncRefLines(): void {
    return syncRefLines(this);
  }

  private drawReferenceLines(ctx: CanvasRenderingContext2D): void {
    return drawReferenceLines(this, ctx);
  }

  syncDotControls(mapKind: boolean, scatterKind = false): void {
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

  bubbleSizeLabel(): string {
    const measure = this.bubbleMeasure();
    if (measure === undefined) return "rows per cell";
    const name = this.meta(measure.column)?.name ?? "?";
    return `${measure.agg}(${name}) per cell`;
  }

  bubbleFraction(value: number, max: number): number {
    return bubbleFraction(this, value, max);
  }

  drawBubbleGrid(ctx: CanvasRenderingContext2D, frame: Frame, input: {
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
    }): void {
    return drawBubbleGrid(this, ctx, frame, input);
  }

  axisLabels(): { x: string | null; y: string | null } {
    return axisLabels(this);
  }

  drawAxisTitles(ctx: CanvasRenderingContext2D, frame: Frame, xLabel: string | null, yLabel: string | null): void {
    return drawAxisTitles(this, ctx, frame, xLabel, yLabel);
  }

  drawBars(ctx: CanvasRenderingContext2D, frame: Frame): void {
    return drawBars(this, ctx, frame);
  }

  drawScatterLike(ctx: CanvasRenderingContext2D, frame: Frame): void {
    return drawScatterLike(this, ctx, frame);
  }

  drawAxes(ctx: CanvasRenderingContext2D, frame: Frame, xMin: number, xMax: number, yMin: number, yMax: number, xKind: "histogram" | AxisFormat, yKind: "histogram" | AxisFormat): void {
    return drawAxes(this, ctx, frame, xMin, xMax, yMin, yMax, xKind, yKind);
  }

  pointSizes(result: SeriesPoints, ui: number): Float64Array | null {
    return pointSizes(this, result, ui);
  }

  colorBuckets(result: SeriesPoints): {
    buckets: Uint8Array;
    colors: string[];
    domain?: ReturnType<typeof resolveColorDomain>;
  } | null {
    return colorBuckets(this, result);
  }

  drawColorBar(ctx: CanvasRenderingContext2D, frame: Frame, colors: readonly string[], domain: ReturnType<typeof resolveColorDomain>, aboveBottom?: number): void {
    return drawColorBar(this, ctx, frame, colors, domain, aboveBottom);
  }

  colorNote(result: SeriesPoints): string | null {
    return colorNote(this, result);
  }

  drawPoints(ctx: CanvasRenderingContext2D, frame: Frame, result: SeriesPoints, xMeta: ColumnMeta, yMeta: ColumnMeta): void {
    return drawPoints(this, ctx, frame, result, xMeta, yMeta);
  }

  drawDensity(ctx: CanvasRenderingContext2D, frame: Frame, result: SeriesGrid, xMeta: ColumnMeta, yMeta: ColumnMeta, viewport: { xMin: number; xMax: number; yMin: number; yMax: number } | null = null): void {
    return drawDensity(this, ctx, frame, result, xMeta, yMeta, viewport);
  }

  paintDensityHeat(ctx: CanvasRenderingContext2D, frame: Frame, result: SeriesGrid, alphaScale: number): void {
    return paintDensityHeat(this, ctx, frame, result, alphaScale);
  }

  paintDensityBands(ctx: CanvasRenderingContext2D, frame: Frame, result: SeriesGrid, smooth: Float64Array, smoothMax: number): void {
    return paintDensityBands(this, ctx, frame, result, smooth, smoothMax);
  }

  paintContourLines(ctx: CanvasRenderingContext2D, frame: Frame, result: SeriesGrid, smooth: Float64Array, smoothMax: number): void {
    return paintContourLines(this, ctx, frame, result, smooth, smoothMax);
  }

  drawCorrelationNote(ctx: CanvasRenderingContext2D, frame: Frame, fit: { slope: number; intercept: number; r2: number } | null = null): void {
    return drawCorrelationNote(this, ctx, frame, fit);
  }

  drawBox(ctx: CanvasRenderingContext2D, frame: Frame): void {
    return drawBox(this, ctx, frame);
  }

  pivotHeatmapData(): {
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
    return pivotHeatmapData(this);
  }

  drawPivotHeatmap(ctx: CanvasRenderingContext2D, frame: Frame): void {
    return drawPivotHeatmap(this, ctx, frame);
  }

  drawHeatmap(ctx: CanvasRenderingContext2D, frame: Frame): void {
    return drawHeatmap(this, ctx, frame);
  }

  drawCorrelation(ctx: CanvasRenderingContext2D, frame: Frame): void {
    return drawCorrelation(this, ctx, frame);
  }
}

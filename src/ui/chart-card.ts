import { buildPart7, buildPart8 } from "./chart-card-build-3.js";
import { buildPart4, buildPart5, buildPart6 } from "./chart-card-build-2.js";
import { buildPart1, buildPart2, buildPart3 } from "./chart-card-build-1.js";
import { dataDrawerRows, undo, setColumns, setSources, refreshView, aggregateResult, valueViewDef, refreshValue, syncScope, syncNote, lintNote, syncSummaryText, issueColumns, syncDataIssues, fieldsInUse, setKind, dropSettingsTheNewKindCannotUse, refreshForConfig, setPrimaryColumn, applyColumnDefaults, defaultStepFor, defaultTitle, seriesTarget, resetBinRange, commitBinOptions, refreshBins, xZoomBase, chartScope, canvasLabel, boundFormatter, canDraw } from "./chart-card-data.js";
import { groupSettings, dock, fieldSlots, toggleSidebar, bindSettingsDismiss, renderSourceOptions, syncSourceControls, syncFieldVisibility, toggleExtraValue, syncExtraValues, setViewShape, pivotRailItems, syncViewShapeOptions, syncPivotOptions, allowsPrimary, syncValueAggOptions, syncOptions, syncChartFilterControls, fillColumnSelect, renderControls, fillPaletteOptions, syncPalette, applyPalette, forgetSettingsDisclosure } from "./chart-card-settings.js";
import { importChartSpecFile, exportPng, openStats, chartExtract, drawnBins, histogramExtract, exportCsv, chartCsvRows, gridCsvRows, syncDeepDive, openCardMenu, toggleFocus, closeFocus, openExportMenu, downloadChartSpec, downloadChartCode, downloadBlob } from "./chart-card-export.js";
import { openKindPicker, selectRegion, drawSelection, queuePointer, showTooltipAtPointer, emitHighlight, setLinkedHighlight, cancelSliceFetch, sliceRegions, sliceEntries, scheduleSliceFetch, scheduleSlicePoints, drawSlicePoints, drawLinkedOverlay, drawSliceShare, handleCanvasClick, finishBrush, timeSlotBrush, drawBrushOverlay, onWheel, withoutExcludedBins, syncExclusions, handleCanvasContextMenu, dataPointAt, openExclusionMenu, excludeFromTable, applyHitAction } from "./chart-interaction.js";
import { allCategoryBars, refreshSeries, refreshTreemap, drawTreemap, refreshText, drawTerms, refreshBox, refreshGroupedBins, widestYLabel, fillTopRounded, drawKpi, drawExtraKind, syncRefLines, drawReferenceLines, axisLabels, drawAxisTitles, drawBars, drawAxes, drawBox } from "./chart-draw-bars.js";
import { refreshCrosstab, refreshBubble, refreshCorrelation, drawBubble, bubbleFraction, drawBubbleGrid, drawScatterLike, pointSizes, colorBuckets, drawColorBar, colorNote, drawPoints, drawDensity, paintDensityHeat, paintDensityBands, paintContourLines, drawCorrelationNote, pivotHeatmapData, drawPivotHeatmap, drawHeatmap, drawCorrelation } from "./chart-draw-points.js";
import { syncAnimationOptions, frameWidths, syncFrameOptions, refreshAnimation, animationBlock, setAnimationTime, toggleAnimationSetup, toggleAnimation, setAnimationSpeed, promptAnimationSpeed, playAnimation, stopAnimation, syncAnimationBar, renderAnimationFrames, exportAnimationGif, exportAnimationVideo, drawAnimatedHistogram, drawAnimatedTreemap, drawAnimatedDensity, drawAnimatedBars } from "./chart-draw-animated.js";
import { drawPlotMessage, emptySeriesMessage, subtitle, drawChart, drawSplitAggregate, drawRankedBars, drawViewAggregate, drawSeries, drawCountAxis, lineUnitLabel, drawGroupedHistogram, drawGroupedLines, syncLegend } from "./chart-draw-aggregate.js";
import { mapExtract, regionOptions, setMapMode, syncRegionAxes, refreshMapGrid, placeFrame, beginMapBrush, endMapBrush, zoomMap, exportMapHtml, mapHtmlPayload, mapViewShown, mapViewOrAuto, dataViewOrNull, resetMapZoom, fitMapAll, markerBox, frameBox, drawMap, drawMapLayers, drawMapClusters, drawMapBody, syncDotControls, mapLabelColumn, mapDotLines, drawMapSizeLegend, mapRadii } from "./chart-map-draw.js";
import { errorBarExtract, errorBarBlock, syncErrorBarControls, refreshErrorBars, cancelErrorBars, showErrorBarProgress, hideErrorBarProgress, errorBarAt, drawWhisker, appendErrorBarNote } from "./chart-error-bars.js";
import type { ChartBins } from "../data/chart-bins.js";
import { ChartDataDrawer } from "./chart-data-drawer.js";
import { cssVar, readGroupOpen, type SettingsGroup } from "./chart-card-parts.js";
import { type Basemap } from "./chart-basemap.js";
import { type HitAction, type HitRegion } from "./chart-hit-regions.js";
export * from "./chart-hit-regions.js";
import { type PivotChartShape } from "../data/pivot-chart.js";
import type { SliceRegion } from "../worker/protocol.js";
import { type ChartExclusion } from "../data/chart-exclusions.js";
import type { SeriesGrid, SeriesPoints } from "../data/chart-series.js";
import type { BoxStatsResult, CrossTabResult, GridCountsResult } from "../data/chart-stats.js";
import type { AnimationResult } from "../data/chart-frames.js";
import { type GifFrameInput } from "../data/gif.js";
import { defaultInterval, intervalBlock, type IntervalKind } from "../data/error-bars.js";
import { type ChartExtract } from "../data/chart-extract.js";
import { DEFAULT_PALETTE, isRampPalette, paletteStops, parseCustomColors, samplePalette } from "../data/palettes.js";
import type { TimeGrain, ViewDef } from "../data/aggregate.js";
import { type FrameStep } from "../data/chart-frames.js";
import { chartSpecFromConfig, parseChartSpec, type ChartSpec } from "./chart-spec.js";
import { chartConfigWithDefaults } from "./chart-builder.js";
import { kindIcon } from "./chart-gallery.js";
import type { ErrorBarsMessage, ErrorBarsProgressMessage } from "../worker/protocol.js";
import { type LintNote } from "./chart-recommender.js";
import { resolveColorDomain } from "./color-scale.js";
import type { AggregateMessage, ColumnMeta, PivotMessage, GroupedBinsMessage, TextProfileMessage } from "../worker/protocol.js";
import { type AxisFormat, type CategoryBar, CHART_KIND_LABELS, type ChartCardKind, DEFAULT_MAP_MODE, formatChartNumber, describeStep, isGroupable, isIdLikeColumn, isNumericType, isPairKind, looksLikeIdName, VALUE_AGGREGATE_KINDS } from "./chart-utils.js";
import { el } from "./dom.js";
import { openConfirm } from "./dialog.js";
import { MapRegions, type MapRegionsOptions } from "./map-regions.js";
import { type MapHtmlPayload } from "./map-html-export.js";
import { ERROR_BAR_KINDS, type MapViewport, type ValueScale, type BrushRange, type BrushSpace, type MapOverlay, type RefLine, type MapMarkerDraw, type ChartCardOptions, type ChartSeriesTarget, type ChartCardConfig, type ChartSource, type BubbleLayer, type Frame, type RegionRequests } from "./chart-card-types.js";
export * from "./chart-card-types.js";


/**
 * One chart in the multi-chart grid: its own type, columns, settings, canvas, note and PNG export.
 * Data flows in from the panel (`setColumns`, `setFiltered`, `setRowCount`). The work is spread over
 * the chart-card-* and chart-draw-* modules: each moved method is a function taking the card, and
 * the card keeps a method of the same name that calls it.
 */
export class ChartCard {
  root!: HTMLElement;

  /** Staleness token for the value-aggregate request only. */
  valueGeneration = 0;
  /** Same for the bound view or pivot request, which sibling refreshes must not discard. */
  viewGeneration = 0;
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
  lineBinSignature = "";
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
  bubbleBinsInput!: HTMLInputElement;
  gridField!: HTMLElement;
  gridHint!: HTMLElement;
  bubbleAggSelect!: HTMLSelectElement;
  bubbleAggHint!: HTMLElement;
  bubbleScaleSelect!: HTMLSelectElement;
  animateButton!: HTMLButtonElement;
  focusButton!: HTMLButtonElement;
  pngButton!: HTMLButtonElement;
  statsButton!: HTMLButtonElement;
  kindButton: HTMLButtonElement | null = null;
  undoButton: HTMLButtonElement | null = null;
  /** Earlier settings of this chart, newest last, as JSON. */
  undoStack: string[] = [];
  /** The settings as they were when the person last reached for a control. */
  undoBefore: string | null = null;
  /** The bar, bin or cell clicked: highlighted, with Filter to this offered beside it. */
  selectedRegion: HitRegion | null = null;
  selectionBar: HTMLElement | null = null;
  /** Plot top the docked height was last worked out from: a legend appearing moves it. */
  private dockedTop = -1;  focusOverlay: HTMLElement | null = null;
  readonly focusPlaceholder = document.createComment("chart-focus");
  animationSetup!: HTMLElement;
  bubbleSettings!: HTMLElement;
  bubbleTitle!: HTMLElement;
  bubbleScaleField!: HTMLElement;
  mapModeSelect!: HTMLSelectElement;
  mapModeWrap!: HTMLElement;
  /** The Dots row under the map's settings: radius, value range, scale and opacity. */
  dotSettings!: HTMLElement;
  dotMinInput!: HTMLInputElement;
  dotMaxInput!: HTMLInputElement;
  dotMaxWrap!: HTMLElement;
  dotMinLabel!: HTMLElement;
  dotValueMinInput!: HTMLInputElement;
  dotValueMaxInput!: HTMLInputElement;
  dotValuesWrap!: HTMLElement;
  dotScaleSelect!: HTMLSelectElement;
  dotScaleWrap!: HTMLElement;
  errorBarRow!: HTMLElement;
  errorBarInput!: HTMLInputElement;
  errorBarSelect!: HTMLSelectElement;
  errorBarHint!: HTMLElement;
  errorBarResult: ErrorBarsMessage | null = null;
  errorBarIndex = new Map<string, number>();
  errorBarJob: { cancel: () => void } | null = null;
  errorBarRun = 0;
  errorBarProgress: HTMLElement | null = null;
  errorBarProgressTimer: number | null = null;
  mapColorAggSelect!: HTMLSelectElement;
  mapColorAggWrap!: HTMLElement;
  mapColorScaleSelect!: HTMLSelectElement;
  mapColorScaleWrap!: HTMLElement;
  mapLabelSelect!: HTMLSelectElement;
  mapLabelWrap!: HTMLElement;
  /** Names of the places drawn, from the worker, and which place each of the current frame's dots is. */
  placeLabels: string[] | null = null;
  framePlaces: number[] | null = null;
  dotOpacityInput!: HTMLInputElement;
  dotShapeSelect!: HTMLSelectElement;
  refSection!: HTMLElement;
  refRows!: HTMLElement;
  refKey = "";
  dotShapeWrap!: HTMLElement;
  /** The clusters drawn last, with the box of the markers each holds, so a click can zoom to it. */
  mapClusters: { x: number; y: number; r: number; lonMin: number; lonMax: number; latMin: number; latMax: number }[] = [];
  fitWrap!: HTMLElement;
  fitLineInput!: HTMLInputElement;
  fitR2Input!: HTMLInputElement;
  dotOpacityOut!: HTMLElement;
  resetViewButton!: HTMLButtonElement;
  /** Map heat grid (count or measure per cell), computed by the worker. */
  mapGrid: GridCountsResult | null = null;
  /** Map viewport in degrees (null = the whole world). */
  mapView: MapViewport | null = null;
  mapMarkers: readonly MapMarkerDraw[] = [];
  mapPicker: ((lon: number, lat: number) => void) | null = null;
  mapOverlay: MapOverlay | null = null;
  /** Optional user-supplied regions (GeoJSON / zipped Shapefile). */
  regions!: MapRegions | null;
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
  animationTimeSelect!: HTMLSelectElement;
  animationGrainSelect!: HTMLSelectElement;
  /** "every" before a time grain, "by" before each value / steps of N. */
  readonly animationStepLabel = el("span", { class: "chart-field-label" }, ["every"]);
  animationBar!: HTMLElement;
  animationPlayButton!: HTMLButtonElement;
  animationSlider!: HTMLInputElement;
  animationSpeedSelect!: HTMLSelectElement;
  animationFrameLabel!: HTMLElement;
  animationLoopInput!: HTMLInputElement;
  animationExportButton!: HTMLButtonElement;
  readonly hiddenGroups = new Set<number>();
  statsMs = 0;

  kindSelect!: HTMLSelectElement;
  sourceSelect!: HTMLSelectElement;
  sourceWrap!: HTMLElement;
  sources: ChartSource[] = [];
  viewKindSelect!: HTMLSelectElement;
  viewAxisSelect!: HTMLSelectElement;
  viewSeriesSelect!: HTMLSelectElement;
  viewMeasureSelect!: HTMLSelectElement;
  viewAxisWrap!: HTMLElement;
  viewSeriesWrap!: HTMLElement;
  viewMeasureWrap!: HTMLElement;
  backToSource!: HTMLButtonElement;
  readonly sourceChip = el(
    "button",
    { class: "chart-source-chip hidden", type: "button", title: "Open the Pivot View this chart draws, as you left it" },
    [],
  ) as HTMLButtonElement;
  readonly extraValuesWrap = el("div", { class: "chart-extra-values hidden", role: "group", "aria-label": "More values" });
  extraValuesKey = "";
  viewResult: AggregateMessage | null = null;
  /** A view-bound card cannot change type, so its real type is shown as text. */
  readonly kindStatic = el("span", { class: "chart-kind-static hidden" });
  pivotResult: PivotMessage | null = null;
  pivotRowSelect!: HTMLSelectElement;
  pivotColSelect!: HTMLSelectElement;
  pivotMeasureSelect!: HTMLSelectElement;
  pivotRowWrap!: HTMLElement;
  pivotColWrap!: HTMLElement;
  pivotMeasureWrap!: HTMLElement;
  primarySelect!: HTMLSelectElement;
  groupSelect!: HTMLSelectElement;
  groupWrap!: HTMLElement;
  valueSelect!: HTMLSelectElement;
  valueWrap!: HTMLElement;
  valueAggSelect!: HTMLSelectElement;
  valueAggWrap!: HTMLElement;
  valueGrainSelect!: HTMLSelectElement;
  valueGrainWrap!: HTMLElement;
  valueEveryInput!: HTMLInputElement;
  valueEveryWrap!: HTMLElement;
  valueFillSelect!: HTMLSelectElement;
  valueFillWrap!: HTMLElement;
  weekStartSelect!: HTMLSelectElement;
  weekStartWrap!: HTMLElement;
  fiscalSelect!: HTMLSelectElement;
  fiscalWrap!: HTMLElement;
  /** Series colours of the last split-by time chart, for the one shared legend. */
  splitLegend: { label: string; color: string }[] | null = null;
  readonly hiddenSplit = new Set<string>();
  valueCalcSelect!: HTMLSelectElement;
  valueCalcWrap!: HTMLElement;
  sortSelect!: HTMLSelectElement;
  sortWrap!: HTMLElement;
  filterColumnSelect!: HTMLSelectElement;
  filterValueSelect!: HTMLSelectElement;
  filterRespectInput!: HTMLInputElement;
  chartFilterRow!: HTMLElement;
  /** Aggregate result for the card's own value-over-time line. */
  valueResult: AggregateMessage | null = null;
  xSelect!: HTMLSelectElement;
  ySelect!: HTMLSelectElement;
  colorSelect!: HTMLSelectElement;
  sizeSelect!: HTMLSelectElement;
  modeSelect!: HTMLSelectElement;
  densityStyleSelect!: HTMLSelectElement;
  kdeInput!: HTMLInputElement;
  correlationSelect!: HTMLSelectElement;
  primaryWrap!: HTMLElement;
  axesPanel!: HTMLElement;
  xWrap!: HTMLElement;
  yWrap!: HTMLElement;
  colorWrap!: HTMLElement;
  sizeWrap!: HTMLElement;
  sizeTagLabel!: HTMLElement;
  primaryTagLabel!: HTMLElement;
  bubbleAggField!: HTMLElement;
  modeWrap!: HTMLElement;
  densityStyleWrap!: HTMLElement;
  xTagLabel!: HTMLElement;
  yTagLabel!: HTMLElement;
  colorGroup!: HTMLElement;
  paletteGroup!: HTMLElement;
  paletteSelect!: HTMLSelectElement;
  palettePreview!: HTMLElement;
  paletteReverseInput!: HTMLInputElement;
  paletteStatus!: HTMLElement;
  colorMinInput!: HTMLInputElement;
  colorMaxInput!: HTMLInputElement;
  colorCenterInput!: HTMLInputElement;
  colorDomainRow!: HTMLElement;
  histogramSettings!: HTMLElement;
  barSettings!: HTMLElement;
  barStackField!: HTMLElement;
  barStackInput!: HTMLInputElement;
  correlationSettings!: HTMLElement;
  topLabel!: HTMLElement;
  minInput!: HTMLInputElement;
  maxInput!: HTMLInputElement;
  binsInput!: HTMLInputElement;
  overflowInput!: HTMLInputElement;
  topInput!: HTMLInputElement;
  otherInput!: HTMLInputElement;
  multiInput!: HTMLInputElement;
  readonly swatches: HTMLButtonElement[] = [];
  hexInput!: HTMLInputElement;
  titleInput!: HTMLInputElement;
  xTitleInput!: HTMLInputElement;
  yTitleInput!: HTMLInputElement;
  yUnitInput!: HTMLInputElement;
  canvas!: HTMLCanvasElement;
  mapControls!: HTMLElement;
  canvasWrap!: HTMLElement;
  scopeEl!: HTMLElement;
  summaryEl!: HTMLElement;
  /** One short note under the heading (see lint); dismissed notes stay dismissed. */
  readonly lintEl = el("div", { class: "chart-lint hidden", role: "note" });
  readonly dismissedNotes = new Set<string>();
  dataIssueEl!: HTMLElement;
  deepDiveEl!: HTMLElement;
  issueSignature = "";
  noteEl!: HTMLElement;
  totalRowCount = 0;
  legendEl!: HTMLElement;
  tooltipEl!: HTMLElement;
  settingsBody!: HTMLElement;
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

  readonly onResize = (): void => this.scheduleRender(this.options.docked === true);
  readonly onThemeChange = (): void => this.scheduleRender(true);
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
  resizeObserver: ResizeObserver | null = null;

  constructor(
    root: HTMLElement,
    readonly options: ChartCardOptions,
    preset?: Partial<ChartCardConfig>,
  ) {
    const { head } = buildPart1(this, root, preset);
    buildPart2(this);
    const { more } = buildPart3(this);
    const { sideHead, field } = buildPart4(this, head, more);
    buildPart5(this, field);
    buildPart6(this);
    const { canvasWrap } = buildPart7(this, field);
    buildPart8(this, head, sideHead, canvasWrap);
  }

  groupSettings(): void {
    return groupSettings(this);
  }

  readonly dataDrawer = new ChartDataDrawer(
    () => this.dataDrawerRows(),
    () => (this.config.source === "" ? this.options.onShowTable : undefined),
  );

  private dataDrawerRows(): string[][] {
    return dataDrawerRows(this);
  }

  /** The Refine and Format sections of this card, to bring in step with the other charts' when its tab opens. */
  readonly settingsGroups: HTMLDetailsElement[] = [];

  dock(head: HTMLElement, quickRow: HTMLElement, sideHead: HTMLElement, canvasWrap: HTMLElement): void {
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

  syncUndo(): void {
    if (this.undoButton !== null) this.undoButton.disabled = this.undoStack.length === 0;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  undo(): void {
    return undo(this);
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

  toggleSidebar(): void {
    return toggleSidebar(this);
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
    return setColumns(this, columns);
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

  setSources(sources: ChartSource[]): void {
    return setSources(this, sources);
  }

  renderSourceOptions(): void {
    return renderSourceOptions(this);
  }

  syncSourceControls(): void {
    return syncSourceControls(this);
  }

  syncFieldVisibility(): void {
    return syncFieldVisibility(this);
  }

  refreshView(): void {
    return refreshView(this);
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

  syncPivotOptions(): void {
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
    return aggregateResult(this);
  }

  /** The time dimension with the card's calendar options (week start, financial year). */
  timeBy(grain: TimeGrain): { time: TimeGrain; every?: number; weekStart?: 0 | 1; fiscalStartMonth?: number } {
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

  valueViewDef(): ViewDef | null {
    return valueViewDef(this);
  }

  refreshValue(): void {
    return refreshValue(this);
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

  syncScope(): void {
    return syncScope(this);
  }

  /**
   * The chart's real type. A view bar that sums or averages a column is a
   * barplot; "Count plot" would misdescribe it.
   */
  viewKindLabel(): string {
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

  syncNote(): void {
    return syncNote(this);
  }

  lintNote(): LintNote | null {
    return lintNote(this);
  }

  private syncSummaryText(): void {
    return syncSummaryText(this);
  }

  issueColumns(): number[] {
    return issueColumns(this);
  }

  private syncDataIssues(): void {
    return syncDataIssues(this);
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
    this.syncErrorBarControls();
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

  openStats(): void {
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

  buildSelect(className: string, label: string): HTMLSelectElement {
    return el("select", { class: className, "aria-label": label }) as HTMLSelectElement;
  }

  tagged(tag: string, select: HTMLSelectElement): { wrap: HTMLElement; label: HTMLElement } {
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
  defaultCorrelationColumns(): number[] {
    return this.allowedIndexes(
      (meta) =>
        isNumericType(meta.type) &&
        !isIdLikeColumn(meta, this.rowCount) &&
        !looksLikeIdName(meta.name),
    ).slice(0, 8);
  }

  fieldsInUse(): { measures: number[]; dimensions: number[] } {
    return fieldsInUse(this);
  }

  setKind(kind: ChartCardKind): void {
    return setKind(this, kind);
  }

  dropSettingsTheNewKindCannotUse(): void {
    return dropSettingsTheNewKindCannotUse(this);
  }

  refreshForConfig(): void {
    return refreshForConfig(this);
  }

  setPrimaryColumn(index: number): void {
    return setPrimaryColumn(this, index);
  }

  applyColumnDefaults(): void {
    return applyColumnDefaults(this);
  }

  syncOptions(): void {
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
  slopeGrainFor(column: number): TimeGrain {
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

  defaultStepFor(column: number): { grain: TimeGrain; every: number } {
    return defaultStepFor(this, column);
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

  regionOptions(requests: RegionRequests): MapRegionsOptions {
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

  async applyPalette(value: string): Promise<void> {
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

  syncPlaceholder(): void {
    this.titleInput.placeholder = this.defaultTitle();
  }

  pairLabel(separator: string): string {
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
  aggregateTitle(): string {
    if (this.config.source !== "") return this.sources.find((source) => source.id === this.config.source)?.name ?? "View";
    const measure = this.meta(this.config.valueColumn ?? -1)?.name ?? "Rows";
    const dimension = this.meta(this.config.column)?.name;
    const group = this.meta(this.config.groupColumn)?.name;
    if (dimension === undefined) return measure;
    const link = this.isDateLike(this.meta(this.config.column)) ? "over" : "by";
    return `${measure} ${link} ${dimension}${group === undefined ? "" : ` by ${group}`}`;
  }

  defaultTitle(): string {
    return defaultTitle(this);
  }

  seriesTarget(): ChartSeriesTarget | null {
    return seriesTarget(this);
  }

  private syncDeepDive(): void {
    return syncDeepDive(this);
  }

  openCardMenu(anchor: HTMLElement): void {
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

  resetBinRange(): void {
    return resetBinRange(this);
  }

  commitBinOptions(): void {
    return commitBinOptions(this);
  }

  /**
   * Preferred bucket count for a time series: human periods instead of the
   * fixed 64-bin histogram, which turns date-only data into an hourly comb.
   * One extra bucket because the last edge is inclusive of the maximum.
   */
  preferredLineBins(spanMs: number): number {
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
    return refreshBins(this);
  }

  allCategoryBars(): CategoryBar[] {
    return allCategoryBars(this);
  }

  xZoomBase(): { min: number; max: number } | null {
    return xZoomBase(this);
  }

  chartScope(): {
    chartFilter?: { column: number; code: number };
    chartExclude?: ChartExclusion[];
    respectFilters: boolean;
  } {
    return chartScope(this);
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

  refreshTreemap(): void {
    return refreshTreemap(this);
  }

  drawTreemap(ctx: CanvasRenderingContext2D, frame: Frame): void {
    return drawTreemap(this, ctx, frame);
  }

  refreshText(): void {
    return refreshText(this);
  }

  drawTerms(ctx: CanvasRenderingContext2D, frame: Frame): void {
    return drawTerms(this, ctx, frame);
  }

  refreshBox(): void {
    return refreshBox(this);
  }

  refreshCrosstab(): void {
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

  refreshBubble(): void {
    return refreshBubble(this);
  }

  refreshMapGrid(): void {
    return refreshMapGrid(this);
  }

  refreshAnimation(): void {
    return refreshAnimation(this);
  }

  toggleFocus(): void {
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

  syncErrorBarControls(): void {
    return syncErrorBarControls(this);
  }

  refreshErrorBars(): void {
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

  toggleAnimationSetup(): void {
    return toggleAnimationSetup(this);
  }

  toggleAnimation(): void {
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

  async promptAnimationSpeed(): Promise<void> {
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

  openExportMenu(anchor: HTMLElement): void {
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

  refreshCorrelation(): void {
    return refreshCorrelation(this);
  }

  refreshGroupedBins(): void {
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

  private canvasLabel(): string {
    return canvasLabel(this);
  }

  queuePointer(event: PointerEvent): void {
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

  handleCanvasClick(event: MouseEvent): void {
    return handleCanvasClick(this, event);
  }

  beginMapBrush(event: PointerEvent): void {
    return beginMapBrush(this, event);
  }

  endMapBrush(event: PointerEvent): void {
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

  onWheel(event: WheelEvent): void {
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

  resetMapZoom(): void {
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

  boundFormatter(column: number): (value: number) => string {
    return boundFormatter(this, column);
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

  handleCanvasContextMenu(event: MouseEvent): void {
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

  canDraw(): boolean {
    return canDraw(this);
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

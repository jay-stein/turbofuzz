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
  rampAt,
  samplePalette,
} from "../data/palettes.js";
import type { TimeGrain, ViewDef } from "../data/aggregate.js";
import type { ColumnFilter } from "../search/query-engine.js";
import { TYPE_LABELS } from "../types.js";
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
  niceTicks,
  parseChartNumber,
  rampColor,
  safeFileName,
  suggestedBinRange,
} from "./chart-utils.js";
import { clear, el } from "./dom.js";
import { openConfirm, openPrompt } from "./dialog.js";
import { openMenu } from "./menu.js";

export type DensityStyle = "heat" | "contours" | "both";

export interface SeriesRequestInput {
  xColumn: number;
  yColumn: number;
  colorColumn: number;
  sizeColumn: number;
  mode: SeriesMode;
  limit?: number;
}

export interface ChartCardOptions {
  datasetName(): string;
  requestBins(column: number, options: ChartBinOptions): Promise<ChartBinsMessage>;
  requestSeries(input: SeriesRequestInput): Promise<ChartSeriesMessage>;
  requestBoxStats(input: {
    valueColumn: number;
    categoryColumn: number;
    topN: number;
    groupOther: boolean;
  }): Promise<BoxStatsMessage>;
  requestCrosstab(input: {
    xColumn: number;
    yColumn: number;
    topX: number;
    topY: number;
    groupOther: boolean;
  }): Promise<CrosstabMessage>;
  requestCorrelation(columns: number[]): Promise<CorrelationMessage>;
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
  /** Row counts per x/y grid cell, for the bubble chart. */
  requestGridCounts?(xColumn: number, yColumn: number, bins?: number): Promise<GridCountsMessage>;
  /** Per-time-bucket frames for animated bar and bubble charts. */
  requestAnimation?(input: {
    timeColumn: number;
    grain: TimeGrain;
    chart: "bar" | "bubble";
    column: number;
    yColumn: number;
    bins?: number;
    topN?: number;
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
  topN: number;
  groupOther: boolean;
  binOptions: ChartBinOptions | null;
  binClipped: boolean;
  title: string;
  /** Category column splitting a time series into one line per value (-1 = off). */
  groupColumn: number;
  /** Bubble grid resolution per axis. */
  bubbleBins?: number;
  /** Time column for frame animation (-1 = off). */
  animationTimeColumn?: number;
  animationGrain?: TimeGrain;
  /** "Suggested: …" reason shown in the note for rule-picked default cards. */
  suggested: string;
  correlationColumns: number[];
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
}

/** One hoverable slot per histogram bin (and the overflow bar). */
export function seriesHitRegions(geom: PlotGeometry, input: SeriesHitInput): HitRegion[] {
  const { bins, overflow, min, max, column, dateAxis } = input;
  const slots = bins.length + (overflow > 0 ? 1 : 0);
  if (slots === 0) return [];
  const slotW = geom.plotW / slots;
  const step = bins.length === 0 ? 0 : (max - min) / bins.length;
  const format = (value: number): string =>
    formatTick(value, dateAxis ? "line" : "histogram");
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
  const regions: HitRegion[] = [];
  for (let index = 0; index < binCount; index++) {
    const lo = input.min + index * step;
    const hi = index === binCount - 1 ? input.max : input.min + (index + 1) * step;
    const lines = [`${formatTick(lo, "line")} – ${formatTick(hi, "line")}`];
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
    topN: 5,
    groupOther: true,
    binOptions: null,
    binClipped: false,
    title: "",
    groupColumn: -1,
    bubbleBins: 40,
    animationTimeColumn: -1,
    animationGrain: "day",
    suggested: "",
    correlationColumns: [],
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
  private binMedian: number | null = null;
  private seriesResult: SeriesPoints | SeriesGrid | null = null;
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
  private readonly bubbleBinsInput: HTMLInputElement;
  private readonly animationSettings: HTMLElement;
  private readonly animationTimeSelect: HTMLSelectElement;
  private readonly animationGrainSelect: HTMLSelectElement;
  private readonly animationBar: HTMLElement;
  private readonly animationPlayButton: HTMLButtonElement;
  private readonly animationSlider: HTMLInputElement;
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
  private readonly modeWrap: HTMLElement;
  private readonly densityStyleWrap: HTMLElement;
  private readonly xTagLabel: HTMLElement;
  private readonly yTagLabel: HTMLElement;
  private readonly colorGroup: HTMLElement;
  private readonly paletteGroup: HTMLElement;
  private readonly paletteSelect: HTMLSelectElement;
  private readonly palettePreview: HTMLElement;
  private readonly histogramSettings: HTMLElement;
  private readonly barSettings: HTMLElement;
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
  private readonly canvas: HTMLCanvasElement;
  private readonly noteEl: HTMLElement;
  private readonly legendEl: HTMLElement;
  private readonly tooltipEl: HTMLElement;
  private readonly settingsBody: HTMLElement;
  private hitRegions: HitRegion[] = [];
  private pointerAt: { x: number; y: number; clientX: number; clientY: number } | null = null;
  private pointerFrame: number | null = null;

  private readonly onResize = (): void => this.scheduleRender();
  private renderQueued = false;
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
    this.primaryWrap = this.tagged("Column", this.primarySelect).wrap;

    this.groupSelect = this.buildSelect(
      "chart-picker chart-picker-small",
      "Group by",
    );
    this.groupSelect.addEventListener("change", () => {
      this.config.groupColumn = Number(this.groupSelect.value);
      this.hiddenGroups.clear();
      this.generation++;
      this.refreshGroupedBins();
      this.render();
    });
    this.groupWrap = this.tagged("Group", this.groupSelect).wrap;

    this.xSelect = this.buildSelect("chart-picker", "X column");
    this.xSelect.addEventListener("change", () => {
      this.config.x = Number(this.xSelect.value);
      this.generation++;
      this.refreshSeries();
      this.refreshBox();
      this.refreshCrosstab();
      this.refreshBubble();
      this.refreshAnimation();
      this.render();
    });
    const xTag = this.tagged("X", this.xSelect);
    this.xWrap = xTag.wrap;
    this.xTagLabel = xTag.label;

    this.ySelect = this.buildSelect("chart-picker", "Y column");
    this.ySelect.addEventListener("change", () => {
      this.config.y = Number(this.ySelect.value);
      this.generation++;
      this.refreshSeries();
      this.refreshBox();
      this.refreshCrosstab();
      this.refreshBubble();
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
      this.generation++;
      this.refreshSeries();
      this.refreshTreemap();
      this.render();
    });
    this.sizeWrap = this.tagged("Size", this.sizeSelect).wrap;

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
    head.append(
      this.sourceWrap,
      this.kindSelect,
      this.groupWrap,
      this.axesPanel,
      el("span", { class: "grow" }),
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
    this.barSettings = el("div", { class: "chart-settings" }, [
      topField,
      bubbleField,
      otherField,
      multiField,
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
    this.paletteGroup = el(
      "div",
      { class: "chart-palette" },
      [this.paletteSelect, this.palettePreview],
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
    const lookRow = el("div", { class: "chart-card-look" }, [
      this.colorGroup,
      this.paletteGroup,
      this.titleInput,
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
    this.animationSettings = el("div", { class: "chart-settings" }, [
      el("span", { class: "chart-field-label" }, ["Animate over"]),
      this.animationTimeSelect,
      this.animationGrainSelect,
    ]);

    const settingsBody = el("div", { class: "chart-settings-body" }, [
      this.colorWrap,
      this.sizeWrap,
      this.modeWrap,
      this.densityStyleWrap,
      this.histogramSettings,
      this.barSettings,
      this.correlationSettings,
      this.animationSettings,
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
    this.noteEl = el("div", { class: "chart-note" });
    this.legendEl = el("div", { class: "chart-legend hidden" });
    this.tooltipEl = el("div", { class: "chart-tooltip hidden", role: "tooltip" });
    this.canvas.addEventListener("pointermove", (event) =>
      this.queuePointer(event as PointerEvent),
    );
    this.canvas.addEventListener("pointerleave", () => this.hideTooltip());
    this.canvas.addEventListener("click", (event) => this.handleCanvasClick(event));
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
    this.animationLoopInput = el("input", { type: "checkbox" }) as HTMLInputElement;
    this.animationLoopInput.checked = true;
    const loopField = el("label", { class: "control check clean-check chart-check" });
    loopField.title = "Restart from the first frame after the last";
    loopField.append(this.animationLoopInput, "Loop");
    this.animationExportButton = el(
      "button",
      { class: "ghost small", type: "button", title: "Encode one loop as an animated GIF" },
      ["Export GIF"],
    ) as HTMLButtonElement;
    this.animationExportButton.addEventListener("click", () => this.exportAnimationGif());
    this.animationBar = el(
      "div",
      { class: "chart-animation hidden" },
      [
        this.animationPlayButton,
        this.animationSlider,
        this.animationFrameLabel,
        loopField,
        this.animationExportButton,
      ],
    );

    this.root.append(head, canvasWrap, this.animationBar, this.legendEl, this.noteEl, this.tooltipEl);

    this.syncSwatches();
    this.syncOptions();
    this.renderControls();
    this.render();
    window.addEventListener("resize", this.onResize);
    window.addEventListener("themechange", this.onResize);
  }

  dispose(): void {
    this.disposed = true;
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
    window.removeEventListener("themechange", this.onResize);
  }

  setColumns(columns: ColumnMeta[]): void {
    this.columns = columns;
    this.generation++;
    this.pickerSignature = "";
    this.syncOptions();
    this.syncPlaceholder();
    this.syncSourceControls();
    this.renderControls();
    this.refreshBins();
    this.refreshSeries();
    this.refreshTreemap();
    this.refreshText();
    this.refreshBox();
    this.refreshCrosstab();
    this.refreshBubble();
    this.refreshAnimation();
    this.refreshCorrelation();
    this.refreshGroupedBins();
    this.render();
  }

  /** The sources a card can bind to (the table plus each saved view). */
  setSources(sources: { id: string; name: string }[]): void {
    this.sources = sources;
    this.renderSourceOptions();
    this.syncSourceControls();
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
    this.kindSelect.classList.toggle("hidden", bound);
    this.primaryWrap.classList.toggle("hidden", bound);
    this.groupWrap.classList.toggle("hidden", bound);
    this.xWrap.classList.toggle("hidden", bound);
    this.yWrap.classList.toggle("hidden", bound);
    this.axesPanel.classList.toggle("hidden", bound);
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
    this.refreshBins();
    this.refreshSeries();
    this.refreshTreemap();
    this.refreshText();
    this.refreshBox();
    this.refreshCrosstab();
    this.refreshBubble();
    this.refreshAnimation();
    this.refreshCorrelation();
    this.refreshGroupedBins();
    this.render();
  }

  setRowCount(count: number): void {
    this.rowCount = count;
    this.render();
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
    this.refreshAnimation();
    this.refreshCorrelation();
    this.refreshGroupedBins();
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

  private allowsPrimary(meta: ColumnMeta): boolean {
    switch (this.config.kind) {
      case "histogram":
        return isNumericType(meta.type);
      case "line":
        return meta.type === "date";
      case "bar":
      case "treemap":
        return isCategoryType(meta.type);
      case "terms":
        return meta.type === "string";
      default:
        return false;
    }
  }

  private allowsAxis(meta: ColumnMeta): boolean {
    return isNumericType(meta.type) || meta.type === "date";
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
    this.refreshAnimation();
    this.refreshCorrelation();
    this.refreshGroupedBins();
    this.render();
  }

  private setPrimaryColumn(index: number): void {
    if (index === this.config.column) return;
    this.config.column = index;
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
      if (selected >= 0) select.value = String(selected);
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
      sizeNone.textContent = this.config.kind === "treemap" ? "Count (rows)" : "None";
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
  }

  /** Date columns available as animation time axes. */
  private syncAnimationOptions(): void {
    const dates = this.allowedIndexes((meta) => meta.type === "date");
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
    this.primaryWrap.classList.toggle("hidden", pair || kind === "correlation");
    this.axesPanel.classList.toggle(
      "hidden",
      this.config.source !== "" || kind === "correlation",
    );
    const groupable = this.columns.some((meta) => isCategoryType(meta.type));
    this.groupWrap.classList.toggle(
      "hidden",
      (kind !== "line" && kind !== "histogram") || !groupable,
    );
    this.xWrap.classList.toggle("hidden", !pair);
    this.yWrap.classList.toggle("hidden", !pair);
    const seriesKind = kind === "scatter" || kind === "density";
    this.colorWrap.classList.toggle("hidden", !seriesKind);
    this.sizeWrap.classList.toggle("hidden", !seriesKind && kind !== "treemap");
    this.modeWrap.classList.toggle("hidden", kind !== "scatter");
    this.densityStyleWrap.classList.toggle("hidden", !seriesKind);
    this.colorGroup.classList.toggle("hidden", kind === "correlation");
    this.paletteGroup.classList.toggle("hidden", kind === "correlation");
    this.histogramSettings.classList.toggle("hidden", kind !== "histogram");
    this.barSettings.classList.toggle(
      "hidden",
      kind !== "bar" &&
        kind !== "box" &&
        kind !== "heatmap" &&
        kind !== "treemap" &&
        kind !== "bubble",
    );
    const animatable = kind === "bar" || kind === "bubble";
    this.animationSettings.classList.toggle(
      "hidden",
      !animatable || !this.columns.some((meta) => meta.type === "date"),
    );
    this.bubbleBinsInput.parentElement?.classList.toggle("hidden", kind !== "bubble");
    this.topLabel.parentElement?.classList.toggle("hidden", kind === "bubble");
    this.multiInput.parentElement?.classList.toggle("hidden", kind === "bubble");
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
    return samplePalette(
      this.config.palette ?? DEFAULT_PALETTE,
      count,
      parseCustomColors(this.config.paletteCustom ?? ""),
    );
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

  private syncPalette(): void {
    this.paletteSelect.value = this.config.palette ?? DEFAULT_PALETTE;
    clear(this.palettePreview);
    for (const color of this.paletteColors(10)) {
      const dot = el("span", { class: "chart-palette-dot" });
      dot.style.background = color;
      this.palettePreview.append(dot);
    }
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
    if (this.config.source !== "") return "Aggregate";
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
    this.renderControls();
    this.refreshBins();
    this.render();
  }

  private refreshBins(): void {
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
    const binOptions = this.config.binOptions;
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

  private refreshSeries(): void {
    if (this.config.kind !== "scatter" && this.config.kind !== "density") {
      this.seriesResult = null;
      return;
    }
    const x = this.meta(this.config.x);
    const y = this.meta(this.config.y);
    if (x === undefined || y === undefined || !this.allowsAxis(x) || !this.allowsAxis(y)) {
      this.seriesResult = null;
      return;
    }
    const generation = ++this.generation;
    const mode: SeriesMode = this.config.kind === "density" ? "density" : this.config.mode;
    void this.options
      .requestSeries({
        xColumn: this.config.x,
        yColumn: this.config.y,
        colorColumn: this.config.colorColumn,
        sizeColumn: this.config.sizeColumn,
        mode,
        limit: POINT_LIMIT,
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
      respectFilters: true,
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
    const shown = entries.slice(0, cap);
    const rest = entries.slice(cap);
    if (rest.length > 0) {
      const value = rest.reduce((sum, entry) => sum + entry.value, 0);
      shown.push({ label: `Other (${rest.length})`, value, code: -1 });
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
    if (rest.length > 0) notes.push(`${rest.length} rest as Other`);
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
    const terms = profile.topTerms.slice(0, Math.max(8, this.config.topN));
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
      .requestGridCounts(this.config.x, this.config.y, this.config.bubbleBins ?? 40)
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
   * Frames for animated bar and bubble charts: one aggregate per time bucket,
   * computed worker-side in a single pass over the filtered rows.
   */
  private refreshAnimation(): void {
    this.stopAnimation();
    const timeColumn = this.config.animationTimeColumn ?? -1;
    const kind = this.config.kind;
    const animatable = kind === "bar" || kind === "bubble";
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
    if (timeMeta === undefined || timeMeta.type !== "date") {
      this.animationResult = null;
      return;
    }
    if (kind === "bar") {
      const column = this.meta(this.config.column);
      if (column === undefined || !isCategoryType(column.type)) {
        this.animationResult = null;
        return;
      }
    } else {
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
    }
    const generation = ++this.generation;
    this.animationFrame = 0;
    void request({
      timeColumn,
      grain: this.config.animationGrain ?? "day",
      chart: kind === "bar" ? "bar" : "bubble",
      column: kind === "bar" ? this.config.column : this.config.x,
      yColumn: kind === "bubble" ? this.config.y : -1,
      bins: this.config.bubbleBins ?? 40,
      topN: this.config.topN,
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

  private toggleAnimation(): void {
    if (this.animationPlaying) this.stopAnimation();
    else this.playAnimation();
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
    }, 500);
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
    const frame = result.frames[this.animationFrame];
    this.animationFrameLabel.textContent = `${frame?.label ?? ""} (${
      this.animationFrame + 1
    }/${result.frames.length})`;
  }

  /**
   * Encodes exactly one loop of the animation as an animated GIF. Every frame
   * is drawn to an offscreen canvas and packed directly (2x the card's CSS
   * size), so the export is deterministic — no real-time canvas capture.
   */
  private exportAnimationGif(): void {
    const result = this.animationResult;
    if (result === null || result.frames.length < 2) {
      this.noteEl.textContent =
        "Set up an animation first — pick a time column and frame length above.";
      return;
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
      return;
    }
    const previous = this.animationFrame;
    let message = "Could not encode the GIF in this browser.";
    try {
      const frames: GifFrameInput[] = [];
      for (let index = 0; index < result.frames.length; index++) {
        this.animationFrame = index;
        ctx.setTransform(scale, 0, 0, scale, 0, 0);
        this.drawChart(ctx, cssWidth, cssHeight, true);
        const image = ctx.getImageData(0, 0, offscreen.width, offscreen.height);
        frames.push({ data: image.data, width: offscreen.width, height: offscreen.height });
      }
      const bytes = encodeGif(frames, 500);
      if (bytes.length > 0 && typeof URL.createObjectURL === "function") {
        const blob = new Blob([bytes as BlobPart], { type: "image/gif" });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = `${safeFileName(this.options.datasetName())}-${safeFileName(
          this.chartName(),
        )}-animation.gif`;
        document.body.append(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(url);
        message = `Exported ${result.frames.length} frames as a GIF · 0.5 s per frame · ${(
          bytes.length / 1024
        ).toFixed(0)} KB`;
      }
    } catch {
      // Keep the fallback message.
    } finally {
      this.animationFrame = previous;
      this.render();
    }
    this.noteEl.textContent = message;
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
      .requestCorrelation(columns)
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
    const numericAxis =
      meta !== undefined &&
      (meta.type === "date" || meta.type === "integer" || meta.type === "number");
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
  private scheduleRender(): void {
    if (this.renderQueued || this.disposed) return;
    this.renderQueued = true;
    const run = (): void => {
      this.renderQueued = false;
      if (!this.disposed) this.render();
    };
    if (typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(run);
    } else {
      window.setTimeout(run, 16);
    }
  }

  private render(): void {
    this.canvas.setAttribute("aria-label", this.canvasLabel());
    const wrap = this.canvas.parentElement;
    let cssWidth = 640;
    if (wrap !== null) {
      const style = getComputedStyle(wrap);
      const padding =
        (Number.parseFloat(style.paddingLeft) || 0) + (Number.parseFloat(style.paddingRight) || 0);
      cssWidth = wrap.clientWidth - padding;
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
        return `Bar chart of ${name(this.config.column)}, ${rows} rows shown`;
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
    const rect = this.canvas.getBoundingClientRect();
    const region = hitTest(
      this.hitRegions,
      event.clientX - rect.left,
      event.clientY - rect.top,
    );
    if (region === null) return;
    for (const action of region.actions) this.applyHitAction(action);
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
        return meta !== undefined && isNumericType(meta.type);
      }
      case "line":
        return count((meta) => meta.type === "date") > 0;
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
    }
  }

  /** Honest reason a series-style card has nothing to plot. */
  private emptySeriesMessage(kind: "histogram" | "line" | "bar"): string {
    if (kind === "line" && !this.columns.some((meta) => meta.type === "date")) {
      return "No date column in this file.";
    }
    const chartable = this.columns.some(
      (meta) =>
        isNumericType(meta.type) ||
        meta.type === "date" ||
        isCategoryType(meta.type),
    );
    if (!chartable) {
      return "This file has no numeric, date or category columns. Change a column's type in the filter list.";
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
  ): Frame {
    const ui = this.textScale(height, forExport);
    this.font(ctx, ui, 10);
    const baseLeft = 56 * ui;
    const left =
      widestTick === "" ? baseLeft : Math.max(baseLeft, ctx.measureText(widestTick).width + 8);
    const right = 18 * ui;
    const top = 58 * ui;
    const bottom = 40 * ui;
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
        const dateAxis = meta !== undefined && axisKindFor(meta.type) === "line";
        return widest(
          niceTicks(yMin, yMax, 4).map((value) => formatTick(value, dateAxis ? "line" : null)),
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
    const rows = `${this.rowCount.toLocaleString()} rows shown`;
    if (this.config.source !== "") {
      const result = this.viewResult;
      if (result === null) return "Aggregate view · waiting for the first result";
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
    const ui = this.textScale(height, forExport);
    const frame = this.frame(ctx, width, height, forExport, this.widestYLabel(ctx, ui));

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

    if (this.config.source !== "") {
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
      default:
        this.drawSeries(ctx, frame, this.config.kind);
        break;
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
   * A card bound to a saved view draws that view's aggregate result: a line
   * when the first dimension is a time bucket, bars otherwise.
   */
  private drawViewAggregate(ctx: CanvasRenderingContext2D, frame: Frame): void {
    const result = this.viewResult;
    if (result === null || result.groupCount === 0) {
      const message = "The bound view has no groups to draw yet.";
      this.noteEl.textContent = message;
      this.drawPlotMessage(ctx, frame, message);
      return;
    }
    const values = result.measures[0];
    if (values === undefined) {
      const message = "The bound view has no measures.";
      this.noteEl.textContent = message;
      this.drawPlotMessage(ctx, frame, message);
      return;
    }
    const ui = frame.ui;
    const n = result.groupCount;
    let max = 0;
    for (const value of values) {
      if (Number.isFinite(value)) max = Math.max(max, value);
    }
    const top = Math.max(1, max);

    const yTicks = niceTicks(0, top, 4);
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
    const automatic = meta.histogram;
    const custom = kind === "histogram" ? this.binResult : null;
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
    const min = this.config.binOptions?.min ?? automatic.min;
    const max = this.config.binOptions?.max ?? automatic.max;
    this.hitRegions = seriesHitRegions(
      { left: frame.left, top: frame.top, plotW: frame.plotW, plotH: frame.plotH },
      {
        column: this.config.column,
        bins,
        overflow: hasOverflow ? overflowCount : 0,
        min,
        max,
        dateAxis: kind === "line",
      },
    );

    this.drawCountAxis(ctx, frame, maxCount);

    if (kind === "line") {
      // Say what one point on the line counts: "Rows per day" and not just ticks.
      const unit = this.lineUnitLabel(min, max, bins.length);
      ctx.fillStyle = frame.dim;
      this.font(ctx, ui, 10);
      ctx.textAlign = "left";
      ctx.fillText(unit, frame.left, frame.top - 6 * ui);
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
    const mid = (min + max) / 2;
    ctx.fillText(formatTick(min, kind), frame.left, frame.top + frame.plotH + 16 * ui);
    const midLabel = formatTick(mid, kind);
    ctx.fillText(
      midLabel,
      frame.left + frame.plotW / 2 - ctx.measureText(midLabel).width / 2,
      frame.top + frame.plotH + 16 * ui,
    );
    const maxLabel = formatTick(max, kind);
    ctx.fillText(
      maxLabel,
      frame.left + frame.plotW - 4 * ui - ctx.measureText(maxLabel).width,
      frame.top + frame.plotH + 16 * ui,
    );
    if (hasOverflow) {
      const overflowLabel = `> ${formatTick(max, kind)}`;
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
      if (outside > 0) notes.push(`${outside.toLocaleString()} values beyond the p1–p99 chart range`);
    }
    this.noteEl.textContent = notes.join(" · ");
  }

  /** Shared count-axis grid and baseline for histogram and line kinds. */
  private drawCountAxis(
    ctx: CanvasRenderingContext2D,
    frame: Frame,
    maxCount: number,
  ): void {
    const ui = frame.ui;
    const yTicks = niceTicks(0, maxCount, 4).filter((value, index, all) => index === 0 || value !== all[index - 1]);
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
    const yTicks = niceTicks(0, maxShare, 4).filter((value, index, all) => index === 0 || value !== all[index - 1]);
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
    const mid = (min + max) / 2;
    ctx.fillText(formatTick(min, "histogram"), frame.left, frame.top + frame.plotH + 16 * ui);
    const midLabel = formatTick(mid, "histogram");
    ctx.fillText(
      midLabel,
      frame.left + frame.plotW / 2 - ctx.measureText(midLabel).width / 2,
      frame.top + frame.plotH + 16 * ui,
    );
    const maxLabel = formatTick(max, "histogram");
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
    const mid = (min + max) / 2;
    ctx.fillText(formatTick(min, "line"), frame.left, frame.top + frame.plotH + 16 * ui);
    const midLabel = formatTick(mid, "line");
    ctx.fillText(
      midLabel,
      frame.left + frame.plotW / 2 - ctx.measureText(midLabel).width / 2,
      frame.top + frame.plotH + 16 * ui,
    );
    const maxLabel = formatTick(max, "line");
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
    const grouped =
      (this.config.kind === "line" || this.config.kind === "histogram") && result !== null;
    this.legendEl.classList.toggle("hidden", !grouped);
    this.legendEl.replaceChildren();
    if (!grouped || result === null) return;
    result.labels.forEach((label, index) => {
      const code = result.codes[index];
      const off = this.hiddenGroups.has(code);
      const item = el(
        "button",
        {
          class: "chart-legend-item",
          type: "button",
          "aria-pressed": off ? "false" : "true",
          title: off ? `Show the ${label} line` : `Hide the ${label} line`,
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
    let maxCount = 1;
    for (let index = 0; index < width; index++) {
      maxCount = Math.max(maxCount, barData.counts[offset + index] ?? 0);
    }
    const slotW = frame.plotW / width;
    const barW = Math.max(4, slotW - Math.min(18 * ui, slotW * 0.25));

    const yTicks = niceTicks(0, maxCount, 4).filter((value, index, all) => index === 0 || value !== all[index - 1]);
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
    this.noteEl.textContent = `${time} · frame ${frameIndex + 1} of ${
      result.frames.length
    } · ${result.total.toLocaleString()} rows · play or scrub below`;
  }

  /** Bubble chart: rows per x/y grid cell, sized by count (static or a frame). */
  private drawBubble(ctx: CanvasRenderingContext2D, frame: Frame): void {
    const animated = this.animationResult?.bubble;
    if (animated !== undefined && this.animationResult !== null) {
      const frames = this.animationResult.frames;
      const index = Math.min(Math.max(0, this.animationFrame), Math.max(0, frames.length - 1));
      const cellCount = animated.bins * animated.bins;
      const grid = animated.grids.subarray(index * cellCount, (index + 1) * cellCount);
      this.drawBubbleGrid(ctx, frame, {
        xMin: animated.xMin,
        xMax: animated.xMax,
        yMin: animated.yMin,
        yMax: animated.yMax,
        bins: animated.bins,
        grid,
        maxCount: this.animationResult.maxCount,
        total: this.animationResult.total,
        caption: frames[index]?.label ?? "",
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
    this.drawBubbleGrid(ctx, frame, {
      xMin: result.xMin,
      xMax: result.xMax,
      yMin: result.yMin,
      yMax: result.yMax,
      bins: result.bins,
      grid: result.counts,
      maxCount: result.maxCount,
      total: result.total,
      caption: "",
    });
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
      grid: Uint32Array;
      maxCount: number;
      total: number;
      caption: string;
    },
  ): void {
    const ui = frame.ui;
    const { xMin, xMax, yMin, yMax, bins, grid } = input;
    const maxCount = Math.max(1, input.maxCount);

    const xTicks = niceTicks(xMin, xMax, 4);
    const yTicks = niceTicks(yMin, yMax, 4).filter((value, index, all) => index === 0 || value !== all[index - 1]);
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
      const x =
        frame.left + ((value - xMin) / Math.max(1e-12, xMax - xMin)) * frame.plotW;
      ctx.fillText(formatChartNumber(value), x, frame.top + frame.plotH + 14 * ui);
    }
    ctx.textAlign = "left";

    const color = this.primaryColor();
    let cells = 0;
    let frameRows = 0;
    for (let by = 0; by < bins; by++) {
      for (let bx = 0; bx < bins; bx++) {
        const count = grid[by * bins + bx] ?? 0;
        if (count === 0) continue;
        cells++;
        frameRows += count;
        const x = frame.left + ((bx + 0.5) / bins) * frame.plotW;
        const y = frame.top + frame.plotH - ((by + 0.5) / bins) * frame.plotH;
        const radius = (1.5 + 13 * Math.sqrt(count / maxCount)) * ui;
        ctx.globalAlpha = 0.24 + 0.5 * (count / maxCount);
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 0.75;
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.globalAlpha = 1;
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
    this.noteEl.textContent = `${caption}${frameRows.toLocaleString()} rows in ${cells.toLocaleString()} cells · ${xName} × ${yName} · bubble area ∝ rows`;
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
    const bars = categorySeries(meta, this.facets[this.config.column], this.config.topN, this.config.groupOther);
    if (bars.length === 0) {
      const message = "This column has no category data yet.";
      this.noteEl.textContent = message;
      this.drawPlotMessage(ctx, frame, message);
      return;
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

    const yTicks = niceTicks(0, maxCount, 4).filter((value, index, all) => index === 0 || value !== all[index - 1]);
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
    this.noteEl.textContent = `${bars.length} bars covering ${shown.toLocaleString()} values · top ${Math.min(
      this.config.topN,
      bars.length,
    )}${this.config.groupOther && bars.some((bar) => bar.other === true) ? " + Other" : ""}`;
  }

  private drawScatterLike(ctx: CanvasRenderingContext2D, frame: Frame): void {
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
    if (result.mode === "density") this.drawDensity(ctx, frame, result, xMeta, yMeta);
    else this.drawPoints(ctx, frame, result, xMeta, yMeta);
  }

  private drawAxes(
    ctx: CanvasRenderingContext2D,
    frame: Frame,
    xMin: number,
    xMax: number,
    yMin: number,
    yMax: number,
    xKind: "histogram" | "line",
    yKind: "histogram" | "line",
  ): void {
    const ui = frame.ui;
    const xTicks = niceTicks(xMin, xMax, 5);
    const yTicks = niceTicks(yMin, yMax, 4).filter((value, index, all) => index === 0 || value !== all[index - 1]);
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
      ctx.fillText(formatTick(value, yKind), frame.left - 6 * ui, y + 3 * ui);
    }
    ctx.textAlign = "center";
    for (const value of xTicks) {
      const x = frame.left + ((value - xMin) / (xMax - xMin)) * frame.plotW;
      ctx.fillText(formatTick(value, xKind), x, frame.top + frame.plotH + 16 * ui);
    }
    ctx.textAlign = "left";
    ctx.beginPath();
    ctx.moveTo(frame.left, frame.top + frame.plotH + 0.5);
    ctx.lineTo(frame.left + frame.plotW, frame.top + frame.plotH + 0.5);
    ctx.stroke();
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
      const buckets = new Uint8Array(n).fill(16);
      const paletteName = this.config.palette ?? DEFAULT_PALETTE;
      const ramp = isRampPalette(paletteName)
        ? paletteStops(paletteName, parseCustomColors(this.config.paletteCustom ?? ""))
        : null;
      const colors =
        ramp === null
          ? Array.from({ length: 16 }, (_, index) => rampColor(index / 15))
          : Array.from({ length: 16 }, (_, index) => rampAt(ramp, index / 15));
      colors.push(this.primaryColor());
      for (let i = 0; i < n; i++) {
        const value = result.colorValues[i];
        if (!Number.isFinite(value)) continue;
        const t = max > min ? (value - min) / (max - min) : 0.5;
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
        return `colour: ${meta.name} (${formatTick(min, null)} – ${formatTick(max, null)})`;
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

    const drawAt = (index: number): void => {
      const r = sizes === null ? radius : sizes[index];
      const x = frame.left + (result.x[index] - result.xMin) * xScale;
      const y = frame.top + frame.plotH - (result.y[index] - result.yMin) * yScale;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    };

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

    this.drawCorrelationNote(ctx, frame);

    const notes: string[] = [`${result.shown.toLocaleString()} points`];
    if (result.sampled) notes.push(`sampled from ${result.total.toLocaleString()}`);
    if (result.outside > 0) notes.push(`${result.outside.toLocaleString()} outside p1–p99`);
    const colorText = this.colorNote(result);
    if (colorText !== null) notes.push(colorText);
    const sizeMeta = this.meta(this.config.sizeColumn);
    if (sizes !== null && sizeMeta !== undefined) notes.push(`size: ${sizeMeta.name}`);
    if (this.seriesMs > 0) notes.push(`${Math.round(this.seriesMs)} ms`);
    this.noteEl.textContent = notes.join(" · ");
  }

  private drawDensity(
    ctx: CanvasRenderingContext2D,
    frame: Frame,
    result: SeriesGrid,
    xMeta: ColumnMeta,
    yMeta: ColumnMeta,
  ): void {
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
      this.paintDensityHeat(ctx, frame, result, style === "both" ? 0.45 : 1);
    }
    if (smooth !== null && smoothMax > 0) {
      if (style === "contours") this.paintDensityBands(ctx, frame, result, smooth, smoothMax);
      this.paintContourLines(ctx, frame, result, smooth, smoothMax);
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
    const groups = result.groups;
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
    const codeOf = (meta: ColumnMeta | undefined, label: string): number =>
      meta?.categories?.labels.indexOf(label) ?? -1;
    this.hitRegions = heatmapHitRegions(
      { left: frame.left, top: frame.top, plotW: frame.plotW, plotH: frame.plotH },
      {
        xLabels: result.xLabels,
        yLabels: result.yLabels,
        counts: result.counts,
        total: result.total,
        xColumn: this.config.x,
        yColumn: this.config.y,
        codeOfX: (label) => codeOf(xMeta, label),
        codeOfY: (label) => codeOf(yMeta, label),
      },
    );
    const xCount = result.xLabels.length;
    const yCount = result.yLabels.length;
    const cellW = frame.plotW / xCount;
    const cellH = frame.plotH / yCount;
    let max = 0;
    for (const count of result.counts) if (count > max) max = count;
    const [r, g, b] = hexToRgb(this.primaryColor());
    const showText = cellW >= 26 * ui && cellH >= 15 * ui;

    this.font(ctx, ui, 10);
    for (let y = 0; y < yCount; y++) {
      for (let x = 0; x < xCount; x++) {
        const count = result.counts[y * xCount + x];
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
    result.xLabels.forEach((label, x) => {
      ctx.fillText(
        this.fit(ctx, label, Math.max(8, cellW - 4 * ui)),
        frame.left + (x + 0.5) * cellW,
        frame.top + frame.plotH + 16 * ui,
      );
    });
    ctx.textAlign = "right";
    result.yLabels.forEach((label, y) => {
      ctx.fillText(
        this.fit(ctx, label, Math.max(8, frame.left - 8 * ui)),
        frame.left - 4 * ui,
        frame.top + (y + 0.5) * cellH + 3.5 * ui,
      );
    });
    ctx.textAlign = "left";

    const notes = [
      `${xCount}×${yCount} cells`,
      `${result.total.toLocaleString()} rows`,
      `peak ${max.toLocaleString()}`,
    ];
    if (result.xLabels.includes("Other") || result.yLabels.includes("Other")) {
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
    const n = result.labels.length;
    this.hitRegions = correlationHitRegions(
      { left: frame.left, top: frame.top, plotW: frame.plotW, plotH: frame.plotH },
      { labels: result.labels, values: result.values, counts: result.counts },
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
        const r = result.values[index];
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
          const count = result.counts[index];
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
    result.labels.forEach((label, column) => {
      ctx.fillStyle = frame.dim;
      ctx.fillText(abbreviate(label), left + (column + 0.5) * sizeX, top + gridH + 14 * ui);
    });
    ctx.textAlign = "right";
    result.labels.forEach((label, row) => {
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

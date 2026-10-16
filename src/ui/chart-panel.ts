import type { ChartBinOptions } from "../data/chart-bins.js";
import type { TimeGrain, ViewDef } from "../data/aggregate.js";
import type { ColumnFilter } from "../search/query-engine.js";
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
import { ChartCard, type ChartCardConfig, type MapBrushSelection, type SeriesRequestInput } from "./chart-card.js";
import {
  CHART_KIND_ICONS,
  GALLERY_KINDS,
  fitChartKind,
  openChartGallery,
  type KindFit,
} from "./chart-gallery.js";
import { openChartSetupDialog } from "./chart-setup.js";
import {
  CHART_KIND_LABELS,
  DEFAULT_EXPORT_SIZE,
  EXPORT_SIZES,
  type ChartCardKind,
  isCategoryType,
  isNumericType,
  isPairKind,
  pickDefaultCard,
} from "./chart-utils.js";
import { el } from "./dom.js";

const RAIL_KEY = "turbofuzz.charts.rail";

function readRailCollapsed(): boolean {
  try {
    return localStorage.getItem(RAIL_KEY) === "1";
  } catch {
    return false;
  }
}

export interface ChartsPanelOptions {
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
  /** Ad-hoc aggregation for the treemap measure. */
  requestAggregate(view: ViewDef): Promise<AggregateMessage>;
  /** Token frequencies for the top-terms chart. */
  requestTextProfile(column: number): Promise<TextProfileMessage>;
  /** Row counts (and optional per-cell measure) for the bubble chart. */
  requestGridCounts?(
    xColumn: number,
    yColumn: number,
    bins?: number,
    measure?: { column: number; agg: "sum" | "mean" | "min" | "max" },
    groupColumn?: number,
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
  }): Promise<AnimationMessage>;
  /** Label for the filtered-table source: "Table" when no filters apply. */
  tableSourceLabel?(): string;
  /** Applied when a card lands in the grid (status feedback in the app). */
  onCardAdded?(label: string): void;
  /** Applies a filter from a click on a chart region (bars, bins, cells). */
  onFilter?(column: number, filter: ColumnFilter | null, preview?: boolean): void;
  /** Reads the app's current filter for a column, so clicks can toggle. */
  currentFilter?(column: number): ColumnFilter | null;
  /** Map card rectangle brush: filter both coordinate columns to the area. */
  onMapBrush?(selection: MapBrushSelection): void;
}

const LAYOUT_KEY = "turbofuzz.charts.columns";
const DEFAULT_LAYOUT = 2;

/** A card config with column references stored by name, for transform safety. */
export interface NamedChartCardConfig
  extends Omit<
    ChartCardConfig,
    "column" | "x" | "y" | "colorColumn" | "sizeColumn" | "groupColumn" | "correlationColumns"
  > {
  column: string | null;
  x: string | null;
  y: string | null;
  colorColumn: string | null;
  sizeColumn: string | null;
  groupColumn: string | null;
  correlationColumns: string[];
}

export function configToNames(
  config: ChartCardConfig,
  columns: readonly ColumnMeta[],
): NamedChartCardConfig {
  const nameOf = (index: number): string | null =>
    index >= 0 && index < columns.length ? columns[index].name : null;
  return {
    ...config,
    column: nameOf(config.column),
    x: nameOf(config.x),
    y: nameOf(config.y),
    colorColumn: nameOf(config.colorColumn),
    sizeColumn: nameOf(config.sizeColumn),
    groupColumn: nameOf(config.groupColumn),
    correlationColumns: config.correlationColumns
      .map((index) => columns[index]?.name)
      .filter((name): name is string => name !== undefined),
  };
}

/**
 * Maps saved card configs onto new column indexes by name. Cards whose
 * required columns are gone (deleted or renamed) are dropped and counted;
 * a correlation card survives while at least two of its columns remain.
 */
export function remapChartConfigs(
  configs: readonly NamedChartCardConfig[],
  columns: readonly ColumnMeta[],
): {
  configs: Partial<ChartCardConfig>[];
  kept: NamedChartCardConfig[];
  removed: number;
} {
  const indexOfName = new Map<string, number>();
  columns.forEach((meta, index) => indexOfName.set(meta.name, index));
  const out: Partial<ChartCardConfig>[] = [];
  const kept: NamedChartCardConfig[] = [];
  let removed = 0;

  for (const named of configs) {
    const column = named.column === null ? -1 : indexOfName.get(named.column);
    const x = named.x === null ? -1 : indexOfName.get(named.x);
    const y = named.y === null ? -1 : indexOfName.get(named.y);
    const needsPrimary = !isPairKind(named.kind) && named.kind !== "correlation";
    if (needsPrimary && named.column !== null && column === undefined) {
      removed++;
      continue;
    }
    if (
      isPairKind(named.kind) &&
      ((named.x !== null && x === undefined) || (named.y !== null && y === undefined))
    ) {
      removed++;
      continue;
    }
    const correlationColumns = named.correlationColumns
      .map((name) => indexOfName.get(name))
      .filter((index): index is number => index !== undefined);
    if (named.kind === "correlation" && correlationColumns.length < 2) {
      removed++;
      continue;
    }
    kept.push(named);
    out.push({
      ...named,
      column: column ?? -1,
      x: x ?? -1,
      y: y ?? -1,
      colorColumn:
        named.colorColumn === null ? -1 : (indexOfName.get(named.colorColumn) ?? -1),
      sizeColumn: named.sizeColumn === null ? -1 : (indexOfName.get(named.sizeColumn) ?? -1),
      groupColumn:
        named.groupColumn === null ? -1 : (indexOfName.get(named.groupColumn) ?? -1),
      correlationColumns,
    });
  }
  return { configs: out, kept, removed };
}

function indexesWhere(columns: ColumnMeta[], allow: (meta: ColumnMeta) => boolean): number[] {
  const out: number[] = [];
  columns.forEach((meta, index) => {
    if (allow(meta)) out.push(index);
  });
  return out;
}

/** Fresh card defaults, preferring columns no other card is using yet. */
function presetFor(
  columns: ColumnMeta[],
  used: Set<number>,
  kinds: Set<ChartCardKind>,
  rowCount: number,
): Partial<ChartCardConfig> {
  if (used.size > 0) {
    const axisAll = indexesWhere(
      columns,
      (meta) =>
        isNumericType(meta.type) ||
        meta.type === "date" ||
        meta.type === "datetime" ||
        meta.type === "duration",
    );
    const numeric = indexesWhere(columns, (meta) => isNumericType(meta.type));
    const categories = indexesWhere(columns, (meta) => isCategoryType(meta.type));
    if (!kinds.has("scatter") && axisAll.length >= 2) {
      const pool = axisAll.filter((index) => !used.has(index));
      const source = pool.length >= 2 ? pool : axisAll;
      let pair: { x: number; y: number } | null = null;
      for (const x of source) {
        for (const y of source) {
          if (x === y) continue;
          // Never pair two date columns; a date against a date says nothing.
          const xDate = columns[x].type === "date" || columns[x].type === "datetime";
          const yDate = columns[y].type === "date" || columns[y].type === "datetime";
          if (xDate && yDate) continue;
          pair = { x, y };
          break;
        }
        if (pair !== null) break;
      }
      if (pair !== null) return { kind: "scatter", x: pair.x, y: pair.y };
    }
    if (!kinds.has("correlation") && numeric.length >= 3) {
      return { kind: "correlation", correlationColumns: numeric.slice(0, 8) };
    }
    if (!kinds.has("box") && numeric.length >= 1 && categories.length >= 1) {
      const x = numeric.find((index) => !used.has(index)) ?? numeric[0];
      const y = categories.find((index) => !used.has(index)) ?? categories[0];
      return { kind: "box", x, y };
    }
    if (!kinds.has("heatmap") && categories.length >= 2) {
      const x = categories[0];
      const y = categories.find((index) => index !== x) ?? x;
      return { kind: "heatmap", x, y };
    }
  }
  const pick = pickDefaultCard(columns, rowCount);
  return { kind: pick.kind, column: pick.column, suggested: pick.reason };
}

function readLayout(): number {
  try {
    const saved = Number(localStorage.getItem(LAYOUT_KEY));
    if (Number.isFinite(saved) && saved >= 1 && saved <= 4) return saved;
  } catch {
    // localStorage can be unavailable (private mode, file://) — use the default.
  }
  return DEFAULT_LAYOUT;
}

/**
 * The Chart view: a toolbar (add chart, columns per row, PNG export size) and
 * a responsive grid of independent ChartCards. Every card keeps its own type,
 * columns, settings and canvas; the panel only owns layout and forwards the
 * facet/histogram payloads from the worker to each card.
 */
export class ChartsPanel {
  private readonly grid: HTMLElement;
  private readonly empty: HTMLElement;
  private readonly rail: HTMLElement;
  private readonly railList: HTMLElement;
  private readonly railToggle: HTMLButtonElement;
  private railCollapsed = readRailCollapsed();
  private readonly layoutSelect: HTMLSelectElement;
  private readonly sizeSelect: HTMLSelectElement;
  private cards: ChartCard[] = [];
  private columns: ColumnMeta[] = [];
  private sources: { id: string; name: string }[] = [];
  private facets: Record<number, number[]> = {};
  private histograms: Record<number, number[]> = {};
  private rowCount = 0;
  private exportSizeIndex = DEFAULT_EXPORT_SIZE;
  private layoutCols = readLayout();
  /** True while the add-chart setup dialog is open (guards double adds). */
  private setupOpen = false;
  /** True once a dataset's columns have been seen; a cleared grid stays clear. */
  private initialised = false;

  constructor(
    private readonly root: HTMLElement,
    private readonly options: ChartsPanelOptions,
  ) {
    const toolbar = el("div", { class: "charts-toolbar" });
    const add = el(
      "button",
      { class: "primary small", type: "button", title: "Add another chart of the current result set" },
      ["+ Add chart"],
    );
    add.addEventListener("click", () =>
      openChartGallery(add, {
        columns: this.columns,
        rowCount: this.rowCount,
        onPick: (preset) => void this.openChartSetup(preset),
      }),
    );

    this.layoutSelect = el("select", {
      class: "chart-size",
      "aria-label": "Charts per row",
      title: "How many charts fit side by side",
    }) as HTMLSelectElement;
    [1, 2, 3, 4].forEach((count) => {
      this.layoutSelect.append(
        el("option", { value: String(count) }, [`${count} per row`]) as HTMLOptionElement,
      );
    });
    this.layoutSelect.value = String(this.layoutCols);
    this.layoutSelect.addEventListener("change", () => {
      this.layoutCols = Number(this.layoutSelect.value);
      this.syncLayout();
    });

    this.sizeSelect = el("select", {
      class: "chart-size",
      "aria-label": "PNG export size",
      title: "Pixel size used by every chart's PNG button",
    }) as HTMLSelectElement;
    EXPORT_SIZES.forEach((size, index) => {
      this.sizeSelect.append(
        el("option", { value: String(index) }, [size.label]) as HTMLOptionElement,
      );
    });
    this.sizeSelect.value = String(this.exportSizeIndex);
    this.sizeSelect.addEventListener("change", () => {
      this.exportSizeIndex = Number(this.sizeSelect.value);
    });

    toolbar.append(
      add,
      this.layoutSelect,
      el("span", { class: "grow" }),
      el("span", { class: "chart-toolbar-label" }, ["PNG size"]),
      this.sizeSelect,
    );

    this.grid = el("div", { class: "charts-grid" });
    this.empty = el("div", { class: "charts-empty" }, [
      "No charts yet — use “+ Add chart” to plot the current result set.",
    ]);

    // Left rail: every chart type as an icon tile, collapsible to icons only.
    this.railToggle = el(
      "button",
      { class: "icon-btn charts-rail-toggle", type: "button" },
      ["⟨"],
    ) as HTMLButtonElement;
    this.railToggle.addEventListener("click", () => this.toggleRail());
    this.railList = el("div", { class: "charts-rail-list" });
    this.rail = el("div", { class: "charts-rail" }, [
      el("div", { class: "charts-rail-head" }, [
        el("span", { class: "charts-rail-title" }, ["Chart types"]),
        this.railToggle,
      ]),
      this.railList,
    ]);
    this.root.classList.add("charts-panel");
    const main = el("div", { class: "charts-main" }, [toolbar, this.grid, this.empty]);
    // The wrapper guarantees the rail sits beside the whole panel (toolbar and
    // grid), regardless of the host element's own display rules.
    this.root.append(el("div", { class: "charts-layout" }, [this.rail, main]));
    this.applyRailState();
    this.syncRail();
    this.syncLayout();
    this.syncEmpty();
  }

  /** Rebuilds the rail tiles from the current columns and their fit. */
  private syncRail(): void {
    this.railList.replaceChildren();
    for (const kind of GALLERY_KINDS) {
      const fit = fitChartKind(kind, this.columns, this.rowCount);
      const tile = el(
        "button",
        { class: "charts-rail-tile", type: "button" },
        [],
      ) as HTMLButtonElement;
      const icon = el("span", { class: "charts-rail-icon" });
      icon.innerHTML = `<svg viewBox="0 0 72 48" aria-hidden="true">${CHART_KIND_ICONS[kind]}</svg>`;
      tile.append(icon, el("span", { class: "charts-rail-label" }, [CHART_KIND_LABELS[kind]]));
      tile.disabled = !fit.ok;
      tile.title = fit.ok
        ? `Add a ${CHART_KIND_LABELS[kind].toLowerCase()} chart`
        : `${CHART_KIND_LABELS[kind]} — ${fit.reason}`;
      tile.addEventListener("click", () => {
        void this.openChartSetup(fit.preset);
      });
      this.railList.append(tile);
    }
  }

  /**
   * Confirmation step shared by the rail and the gallery: shows the chart
   * type and its columns, and only then adds the card, so a stray click can
   * never add an invisible chart. The new card is scrolled into view and
   * briefly highlighted.
   */
  private async openChartSetup(preset: Partial<ChartCardConfig>): Promise<void> {
    if (this.setupOpen) return;
    this.setupOpen = true;
    const kind = preset.kind ?? "histogram";
    try {
      const config = await openChartSetupDialog(kind, this.columns, preset);
      if (config === null) return;
      const card = this.addCard(config);
      card.root.classList.add("chart-card-new");
      card.root.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
      window.setTimeout(() => card.root.classList.remove("chart-card-new"), 1500);
      this.options.onCardAdded?.(CHART_KIND_LABELS[kind]);
    } finally {
      this.setupOpen = false;
    }
  }

  private toggleRail(): void {
    this.railCollapsed = !this.railCollapsed;
    try {
      localStorage.setItem(RAIL_KEY, this.railCollapsed ? "1" : "0");
    } catch {
      // Persisting the preference is best-effort.
    }
    this.applyRailState();
  }

  private applyRailState(): void {
    this.rail.classList.toggle("collapsed", this.railCollapsed);
    this.railToggle.textContent = this.railCollapsed ? "⟩" : "⟨";
    this.railToggle.title = this.railCollapsed
      ? "Expand the chart type list"
      : "Collapse to icons";
  }

  addCard(preset?: Partial<ChartCardConfig>): ChartCard {
    const used = new Set<number>();
    const kinds = new Set<ChartCardKind>();
    for (const existing of this.cards) {
      for (const index of existing.usedColumns()) used.add(index);
      kinds.add(existing.getConfig().kind);
    }
    const section = el("section", { class: "chart-card" });
    const card = new ChartCard(
      section,
      {
        datasetName: this.options.datasetName,
        requestBins: this.options.requestBins,
        requestSeries: this.options.requestSeries,
        requestBoxStats: this.options.requestBoxStats,
        requestCrosstab: this.options.requestCrosstab,
        requestCorrelation: this.options.requestCorrelation,
        requestGroupedBins: this.options.requestGroupedBins,
        requestViewAggregate: this.options.requestViewAggregate,
        requestAggregate: this.options.requestAggregate,
        requestTextProfile: this.options.requestTextProfile,
        requestGridCounts: this.options.requestGridCounts,
        requestAnimation: this.options.requestAnimation,
        tableSourceLabel: this.options.tableSourceLabel,
        onFilter: this.options.onFilter,
        currentFilter: this.options.currentFilter,
        onMapBrush: this.options.onMapBrush,
        onRemove: (target) => this.removeCard(target),
        onDuplicate: (target) => this.duplicateCard(target),
        onExport: (target) => {
          const size = EXPORT_SIZES[this.exportSizeIndex] ?? EXPORT_SIZES[DEFAULT_EXPORT_SIZE];
          target.exportPng(size.width, size.height);
        },
      },
      preset ?? presetFor(this.columns, used, kinds, this.rowCount),
    );
    this.cards.push(card);
    this.grid.append(section);
    card.setColumns(this.columns);
    card.setSources(this.sources);
    card.setFiltered(this.facets, this.histograms);
    card.setRowCount(this.rowCount);
    if (card.getConfig().source !== "") card.refreshView();
    this.syncEmpty();
    return card;
  }

  /** Sources every card can bind to: the filtered table plus each saved view. */
  setSources(sources: { id: string; name: string }[]): void {
    this.sources = sources;
    for (const card of this.cards) card.setSources(sources);
  }

  /** "Chart this" from the Views lens: a card bound to the view's result. */
  addViewChart(view: ViewDef): void {
    this.addCard({ kind: "bar", source: view.id, title: view.name });
  }

  removeCard(card: ChartCard): void {
    const index = this.cards.indexOf(card);
    if (index < 0) return;
    this.cards.splice(index, 1);
    card.dispose();
    card.root.remove();
    this.syncEmpty();
  }

  duplicateCard(card: ChartCard): void {
    this.addCard(card.getConfig());
  }

  setColumns(columns: ColumnMeta[]): void {
    this.columns = columns;
    this.syncRail();
    if (!this.initialised) {
      this.initialised = true;
      if (columns.length > 0 && this.cards.length === 0) {
        this.addCard();
        return;
      }
    }
    for (const card of this.cards) card.setColumns(columns);
  }

  /** Snapshots every card with its columns stored by name. */
  captureConfigs(): NamedChartCardConfig[] {
    return this.cards.map((card) => configToNames(card.getConfig(), this.columns));
  }

  /**
   * Rebuilds the grid from saved configs (already remapped to indexes). Unlike
   * setColumns this never adds a default card, so a grid the user emptied
   * stays empty.
   */
  restore(configs: readonly Partial<ChartCardConfig>[], columns: ColumnMeta[]): void {
    this.columns = columns;
    this.initialised = true;
    this.syncRail();
    for (const config of configs) this.addCard(config);
  }

  setFiltered(
    facets: Record<number, number[]>,
    histograms: Record<number, number[]>,
  ): void {
    this.facets = facets;
    this.histograms = histograms;
    for (const card of this.cards) card.setFiltered(facets, histograms);
  }

  setRowCount(count: number): void {
    this.rowCount = count;
    for (const card of this.cards) card.setRowCount(count);
  }

  refresh(): void {
    for (const card of this.cards) card.refresh();
  }

  /** Cheap re-entry: repaint without re-requesting any worker payloads. */
  repaint(): void {
    for (const card of this.cards) card.repaint();
  }

  dispose(): void {
    for (const card of this.cards) card.dispose();
    this.cards = [];
  }

  private syncLayout(): void {
    this.grid.dataset.cols = String(this.layoutCols);
    try {
      localStorage.setItem(LAYOUT_KEY, String(this.layoutCols));
    } catch {
      // Persisting the layout is best-effort.
    }
  }

  private syncEmpty(): void {
    const isEmpty = this.cards.length === 0;
    this.empty.classList.toggle("hidden", !isEmpty);
    this.grid.classList.toggle("hidden", isEmpty);
  }
}

import type { ChartBinOptions } from "../data/chart-bins.js";
import type { TimeGrain, ViewDef } from "../data/aggregate.js";
import type { ColumnFilter } from "../search/query-engine.js";
import type { ColumnSuggestion } from "../data/suggestions.js";
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
  PivotMessage,
} from "../worker/protocol.js";
import {
  ChartCard,
  type ChartCardConfig,
  type ChartTableFilter,
  type MapBrushSelection,
  type SeriesRequestInput,
} from "./chart-card.js";
import {
  CHART_KIND_ICONS,
  GALLERY_KINDS,
  fitChartKind,
  openChartGallery,
  type KindFit,
} from "./chart-gallery.js";
import { openChartSetupDialog } from "./chart-setup.js";
import { nextFinerGrain, suggestedChartConfig } from "./chart-builder.js";
import { chartSpecToConfig } from "./chart-spec.js";
import { openConfirm } from "./dialog.js";
import {
  CHART_KIND_LABELS,
  DEFAULT_EXPORT_SIZE,
  EXPORT_SIZES,
  type ChartCardKind,
  isCategoryType,
  isGroupable,
  withChartGroups,
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
    chartFilter?: { column: number; code: number };
    respectFilters?: boolean;
  }): Promise<BoxStatsMessage>;
  requestCrosstab(input: {
    xColumn: number;
    yColumn: number;
    topX: number;
    topY: number;
    groupOther: boolean;
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
  /** Pivot result for a pivot-heatmap card. */
  requestViewPivot?(source: string): Promise<PivotMessage | null>;
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
  /** Applied when a card lands in the grid (status feedback in the app). */
  onCardAdded?(label: string): void;
  /** Applied when an existing card is edited or reset. */
  onCardEdited?(message: string): void;
  /** Applies a filter from a click on a chart region (bars, bins, cells). */
  onFilter?(column: number, filter: ColumnFilter | null, preview?: boolean): void;
  /** Reads the app's current filter for a column, so clicks can toggle. */
  currentFilter?(column: number): ColumnFilter | null;
  /** Apply visible table filters without leaving the chart lens. */
  onFilterTable?(filters: readonly ChartTableFilter[], label: string): void;
  /** Apply filters and switch to the table. */
  onShowRows?(filters: readonly ChartTableFilter[], label: string): void;
  /** Convert placeholder tokens through the existing null-policy path. */
  onConvertToken?(column: number, tokens: string[]): void;
  /** Apply an existing suggestion through the shared fix path. */
  onSuggestion?(column: number, suggestion: ColumnSuggestion): void;
  /** Map card rectangle brush: filter both coordinate columns to the area. */
  onMapBrush?(selection: MapBrushSelection): void;
}

const LAYOUT_KEY = "turbofuzz.charts.columns";
const DEFAULT_LAYOUT = 2;

/** A card config with column references stored by name, for transform safety. */
export interface NamedChartCardConfig
  extends Omit<
    ChartCardConfig,
    | "column"
    | "x"
    | "y"
    | "colorColumn"
    | "sizeColumn"
    | "groupColumn"
    | "filterColumn"
    | "correlationColumns"
  > {
  column: string | null;
  x: string | null;
  y: string | null;
  colorColumn: string | null;
  sizeColumn: string | null;
  groupColumn: string | null;
  filterColumn: string | null;
  correlationColumns: string[];
  /** Required columns that no longer exist in the table. */
  missingColumns?: string[];
}

export type RestoredChartConfig = Partial<ChartCardConfig> & {
  missingColumns?: string[];
  /** Original named config, retained for orphaned entries. */
  namedConfig?: NamedChartCardConfig;
};

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
    filterColumn: nameOf(config.filterColumn ?? -1),
    correlationColumns: config.correlationColumns
      .map((index) => columns[index]?.name)
      .filter((name): name is string => name !== undefined),
  };
}

function missingRequiredColumns(
  named: NamedChartCardConfig,
  indexOfName: ReadonlyMap<string, number>,
): string[] {
  const missing: string[] = [];
  const require = (name: string | null): void => {
    if (name !== null && !indexOfName.has(name)) missing.push(name);
  };
  if (isPairKind(named.kind)) {
    require(named.x);
    require(named.y);
  } else if (named.kind === "correlation") {
    const remaining = named.correlationColumns.filter((name) => indexOfName.has(name));
    if (remaining.length < 2) {
      const gone = named.correlationColumns.filter((name) => !indexOfName.has(name));
      if (gone.length > 0) missing.push(...gone);
    }
  } else {
    require(named.column);
  }
  return missing;
}

/**
 * Maps saved card configs onto new column indexes by name. Cards whose
 * required columns are gone become orphaned entries instead of disappearing;
 * a correlation card survives while at least two of its columns remain.
 */
export function remapChartConfigs(
  configs: readonly NamedChartCardConfig[],
  columns: readonly ColumnMeta[],
): {
  /** Successfully mapped configs only, retained for compatibility. */
  configs: Partial<ChartCardConfig>[];
  /** Successfully mapped configs by name. */
  kept: NamedChartCardConfig[];
  /** Configs that could not be mapped and need a rebind. */
  orphaned: NamedChartCardConfig[];
  /** All configs in original order, including orphaned entries. */
  entries: RestoredChartConfig[];
  /** All configs by name in original order, including orphaned entries. */
  named: NamedChartCardConfig[];
  /** Number of orphaned configs. */
  removed: number;
} {
  const indexOfName = new Map<string, number>();
  columns.forEach((meta, index) => indexOfName.set(meta.name, index));
  const out: Partial<ChartCardConfig>[] = [];
  const kept: NamedChartCardConfig[] = [];
  const orphaned: NamedChartCardConfig[] = [];
  const entries: RestoredChartConfig[] = [];
  const namedOut: NamedChartCardConfig[] = [];

  for (const named of configs) {
    const column = named.column === null ? -1 : indexOfName.get(named.column);
    const x = named.x === null ? -1 : indexOfName.get(named.x);
    const y = named.y === null ? -1 : indexOfName.get(named.y);
    const correlationColumns = named.correlationColumns
      .map((name) => indexOfName.get(name))
      .filter((index): index is number => index !== undefined);
    const missingColumns = missingRequiredColumns(named, indexOfName);
    if (missingColumns.length > 0) {
      const orphan = { ...named, missingColumns };
      orphaned.push(orphan);
      namedOut.push(orphan);
      entries.push({
        ...named,
        column: column ?? -1,
        x: x ?? -1,
        y: y ?? -1,
        colorColumn:
          named.colorColumn === null ? -1 : (indexOfName.get(named.colorColumn) ?? -1),
        sizeColumn:
          named.sizeColumn === null ? -1 : (indexOfName.get(named.sizeColumn) ?? -1),
        groupColumn:
          named.groupColumn === null ? -1 : (indexOfName.get(named.groupColumn) ?? -1),
        filterColumn:
          named.filterColumn === null ? -1 : (indexOfName.get(named.filterColumn) ?? -1),
        filterCode: named.filterCode,
        correlationColumns,
        missingColumns,
        namedConfig: orphan,
      });
      continue;
    }
    const clean = { ...named, missingColumns: undefined };
    kept.push(clean);
    namedOut.push(clean);
    const mapped = {
      ...clean,
      column: column ?? -1,
      x: x ?? -1,
      y: y ?? -1,
      colorColumn:
        clean.colorColumn === null ? -1 : (indexOfName.get(clean.colorColumn) ?? -1),
      sizeColumn: clean.sizeColumn === null ? -1 : (indexOfName.get(clean.sizeColumn) ?? -1),
      groupColumn:
        clean.groupColumn === null ? -1 : (indexOfName.get(clean.groupColumn) ?? -1),
      filterColumn:
        clean.filterColumn === null ? -1 : (indexOfName.get(clean.filterColumn) ?? -1),
      filterCode: clean.filterCode,
      correlationColumns,
    };
    out.push(mapped);
    entries.push(mapped);
  }
  return {
    configs: out,
    kept,
    orphaned,
    entries,
    named: namedOut,
    removed: orphaned.length,
  };
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
    const categories = indexesWhere(columns, (meta) => isGroupable(meta)).sort(
      (a, b) => Number(isCategoryType(columns[b].type)) - Number(isCategoryType(columns[a].type)),
    );
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

type ChartEntry =
  | { type: "card"; card: ChartCard }
  | { type: "orphan"; root: HTMLElement; named: NamedChartCardConfig };

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
  private entries: ChartEntry[] = [];
  private columns: ColumnMeta[] = [];
  private sources: { id: string; name: string; kind?: "pivot" | "view" }[] = [];
  private facets: Record<number, number[]> = {};
  private histograms: Record<number, number[]> = {};
  private rowCount = 0;
  private totalRowCount = 0;
  private exportSizeIndex = DEFAULT_EXPORT_SIZE;
  private layoutCols = readLayout();
  /** True while the add-chart setup dialog is open (guards double adds). */
  private setupOpen = false;
  /** True once a dataset's columns have been seen; a cleared grid stays clear. */


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
      tile.setAttribute("aria-disabled", fit.ok ? "false" : "true");
      tile.title = fit.ok
        ? `Add a ${CHART_KIND_LABELS[kind].toLowerCase()} chart`
        : `${CHART_KIND_LABELS[kind]} — ${fit.reason}`;
      if (!fit.ok) {
        const reason = el("span", {
          class: "sr-only",
          id: `chart-rail-reason-${kind}`,
        }, [fit.reason]);
        tile.append(reason);
        tile.setAttribute("aria-describedby", reason.id);
      }
      tile.addEventListener("click", () => {
        if (!fit.ok) return;
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

  private cards(): ChartCard[] {
    return this.entries
      .filter((entry): entry is { type: "card"; card: ChartCard } => entry.type === "card")
      .map((entry) => entry.card);
  }

  addCard(preset?: Partial<ChartCardConfig>, before?: HTMLElement | null): ChartCard {
    const used = new Set<number>();
    const kinds = new Set<ChartCardKind>();
    for (const existing of this.cards()) {
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
        requestViewPivot: this.options.requestViewPivot,
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
        onEdit: (target) => void this.editCard(target),
        onResetSuggested: (target) => this.resetCard(target),
        onFilterTable: this.options.onFilterTable,
        onShowRows: this.options.onShowRows,
        onDrill: (target, filters, label) =>
          void this.drillCard(target, filters, label),
        onBreakDown: (target) => void this.breakDownCard(target),
        onCompare: (target) => this.compareCard(target),
        onConvertToken: this.options.onConvertToken,
        onSuggestion: this.options.onSuggestion,
        onExport: (target) => {
          const size = EXPORT_SIZES[this.exportSizeIndex] ?? EXPORT_SIZES[DEFAULT_EXPORT_SIZE];
          target.exportPng(size.width, size.height);
        },
      },
      preset ?? presetFor(this.columns, used, kinds, this.rowCount),
    );
    const entry: ChartEntry = { type: "card", card };
    const beforeIndex =
      before === undefined || before === null
        ? -1
        : this.entries.findIndex((candidate) =>
            candidate.type === "orphan"
              ? candidate.root === before
              : candidate.card.root === before,
          );
    if (beforeIndex >= 0 && before !== undefined && before !== null) {
      this.entries.splice(beforeIndex, 0, entry);
      this.grid.insertBefore(section, before);
    } else {
      this.entries.push(entry);
      this.grid.append(section);
    }
    card.setColumns(this.columns);
    card.setSources(this.sources);
    card.setFiltered(this.facets, this.histograms);
    card.setRowCount(this.rowCount);
    card.setTotalRowCount(this.totalRowCount);
    if (card.getConfig().source !== "") card.refreshView();
    this.syncEmpty();
    return card;
  }

  /** Sources every card can bind to: the filtered table plus each saved view. */
  setSources(sources: { id: string; name: string; kind?: "pivot" | "view" }[]): void {
    this.sources = sources;
    for (const card of this.cards()) card.setSources(sources);
  }

  /** Refetch every view-bound card after filters or underlying data change. */
  refreshBoundViews(): void {
    for (const card of this.cards()) {
      if (card.getConfig().source !== "") card.refreshView();
    }
  }

  /** "Chart this" from the Views lens: a card bound to the view's result. */
  addViewChart(view: ViewDef): void {
    this.addCard({ kind: "bar", source: view.id, title: view.name });
  }

  /** Create a pivot-matrix heatmap bound to a pivot view. */
  addPivotHeatmap(view: ViewDef): void {
    this.addCard({ kind: "pivotHeatmap", source: view.id, title: view.name });
  }

  removeCard(card: ChartCard): void {
    const index = this.entries.findIndex(
      (entry) => entry.type === "card" && entry.card === card,
    );
    if (index < 0) return;
    this.entries.splice(index, 1);
    card.dispose();
    card.root.remove();
    this.syncEmpty();
  }

  duplicateCard(card: ChartCard): void {
    const compiled = chartSpecToConfig(card.getSpec(), this.columns);
    this.addCard(compiled.config ?? card.getConfig());
  }

  /** Shared setup dialog in edit mode; Cancel is a true no-op. */
  private async editCard(card: ChartCard): Promise<void> {
    if (this.setupOpen) return;
    this.setupOpen = true;
    const config = card.getConfig();
    try {
      const next = await openChartSetupDialog(config.kind, this.columns, config, {
        mode: "edit",
      });
      if (next === null) return;
      card.applyConfig(next);
      this.options.onCardEdited?.("Chart updated");
    } finally {
      this.setupOpen = false;
    }
  }

  /** Rebuild the kind-specific fields while keeping the card's source/frame. */
  /** Drill an aggregate to the next finer time grain; otherwise break it down. */
  private async drillCard(
    card: ChartCard,
    _filters: readonly ChartTableFilter[],
    _label: string,
  ): Promise<void> {
    const config = card.getConfig();
    const grain = nextFinerGrain(config.valueGrain);
    if (
      grain !== null &&
      (config.valueColumn ?? -1) >= 0 &&
      (config.kind === "line" || config.kind === "bar" || config.kind === "barplot")
    ) {
      this.addCard({
        ...config,
        valueGrain: grain,
        title: config.title === "" ? "" : `${config.title} (${grain})`,
        suggested: "",
      });
      this.options.onCardAdded?.(`${CHART_KIND_LABELS[config.kind]} drill`);
      return;
    }
    await this.breakDownCard(card);
  }

  /** Reuse the add-chart builder to create a breakdown without hidden state. */
  private async breakDownCard(card: ChartCard): Promise<void> {
    if (this.setupOpen) return;
    this.setupOpen = true;
    const config = card.getConfig();
    const numericMeasure =
      config.valueColumn !== undefined && config.valueColumn >= 0
        ? { valueColumn: config.valueColumn, valueAgg: config.valueAgg ?? "mean" }
        : {};
    const kind: ChartCardKind = config.valueColumn !== undefined && config.valueColumn >= 0
      ? "barplot"
      : "bar";
    try {
      const next = await openChartSetupDialog(kind, this.columns, {
        kind,
        source: config.source,
        respectFilters: config.respectFilters,
        ...numericMeasure,
      });
      if (next === null) return;
      this.addCard(next);
      this.options.onCardAdded?.(CHART_KIND_LABELS[kind]);
    } finally {
      this.setupOpen = false;
    }
  }

  /** Explicit duplicate for side-by-side comparison; both charts stay editable. */
  private compareCard(card: ChartCard): void {
    const config =
      chartSpecToConfig(card.getSpec(), this.columns).config ?? card.getConfig();
    this.addCard({
      ...config,
      title: config.title === "" ? "Comparison" : `${config.title} (comparison)`,
      suggested: "",
    });
    this.options.onCardAdded?.(CHART_KIND_LABELS[config.kind]);
  }
  private resetCard(card: ChartCard): void {
    const next = suggestedChartConfig(card.getConfig(), this.columns, this.rowCount);
    if (next === null) {
      this.options.onCardEdited?.("No suggested configuration fits this chart type");
      return;
    }
    card.applyConfig(next);
    this.options.onCardEdited?.("Chart reset to suggested settings");
  }

  setColumns(columns: ColumnMeta[]): void {
    this.columns = withChartGroups(columns);
    this.syncRail();
    for (const card of this.cards()) card.setColumns(this.columns);
    this.syncEmpty();
  }

  /** Snapshots every entry with its columns stored by name. */
  captureConfigs(): NamedChartCardConfig[] {
    return this.entries.map((entry) =>
      entry.type === "orphan" ? entry.named : configToNames(entry.card.getConfig(), this.columns),
    );
  }

  /**
   * Rebuilds the grid from saved configs (already remapped to indexes). Unlike
   * setColumns this never adds a default card, so a grid the user emptied
   * stays empty. Entries with unresolved columns render as orphaned cards.
   */
  restore(configs: readonly RestoredChartConfig[], columns: ColumnMeta[]): void {
    this.columns = withChartGroups(columns);
    this.syncRail();
    for (const config of configs) {
      if ((config.missingColumns?.length ?? 0) > 0) {
        this.addOrphan(config.namedConfig ?? (config as unknown as NamedChartCardConfig));
      } else {
        this.addCard(config);
      }
    }
    this.syncEmpty();
  }

  private addOrphan(named: NamedChartCardConfig): void {
    const missing = named.missingColumns ?? [];
    const section = el("section", { class: "chart-card chart-card-orphan" });
    const names =
      missing.length === 1
        ? `Column “${missing[0]}” is`
        : `Columns ${missing.map((name) => `“${name}”`).join(", ")} are`;
    const body = el("div", { class: "chart-card-orphan-body" }, [
      el("div", { class: "chart-card-orphan-title" }, ["Chart needs a column"]),
      el("p", {}, [`${names} no longer in this table.`]),
      el("p", { class: "chart-card-orphan-hint" }, [
        "Rebind it to another column or remove it. The card stays here until you choose.",
      ]),
    ]);
    const actions = el("div", { class: "chart-card-orphan-actions" });
    const rebind = el("button", { class: "primary small", type: "button" }, ["Rebind"]) as HTMLButtonElement;
    rebind.addEventListener("click", () => void this.rebindOrphan(section, named));
    const remove = el("button", { class: "ghost small", type: "button" }, ["Remove"]) as HTMLButtonElement;
    remove.addEventListener("click", () => void this.removeOrphan(section));
    actions.append(rebind, remove);
    body.append(actions);
    section.append(body);
    this.entries.push({ type: "orphan", root: section, named });
    this.grid.append(section);
  }

  private async rebindOrphan(root: HTMLElement, named: NamedChartCardConfig): Promise<void> {
    if (this.setupOpen) return;
    this.setupOpen = true;
    const indexByName = new Map(this.columns.map((meta, index) => [meta.name, index]));
    const index = (name: string | null): number =>
      name === null ? -1 : (indexByName.get(name) ?? -1);
    const preset: Partial<ChartCardConfig> = {
      kind: named.kind,
      source: named.source,
      title: named.title,
      column: index(named.column),
      x: index(named.x),
      y: index(named.y),
      colorColumn: index(named.colorColumn),
      sizeColumn: index(named.sizeColumn),
      groupColumn: index(named.groupColumn),
      correlationColumns: named.correlationColumns
        .map((name) => indexByName.get(name))
        .filter((value): value is number => value !== undefined),
    };
    try {
      const config = await openChartSetupDialog(named.kind, this.columns, preset);
      if (config === null) return;
      const next = root.nextSibling as HTMLElement | null;
      const entryIndex = this.entries.findIndex(
        (entry) => entry.type === "orphan" && entry.root === root,
      );
      if (entryIndex < 0) return;
      this.entries.splice(entryIndex, 1);
      root.remove();
      const card = this.addCard(config, next);
      card.root.classList.add("chart-card-new");
      window.setTimeout(() => card.root.classList.remove("chart-card-new"), 1500);
      this.options.onCardAdded?.(CHART_KIND_LABELS[card.getConfig().kind]);
    } finally {
      this.setupOpen = false;
    }
  }

  private async removeOrphan(root: HTMLElement): Promise<void> {
    const confirmed = await openConfirm({
      title: "Remove this chart?",
      body: "The chart could not find its column. Removing it cannot be undone.",
      confirmLabel: "Remove chart",
      danger: true,
    });
    if (!confirmed) return;
    const index = this.entries.findIndex(
      (entry) => entry.type === "orphan" && entry.root === root,
    );
    if (index < 0) return;
    this.entries.splice(index, 1);
    root.remove();
    this.syncEmpty();
  }

  setFiltered(
    facets: Record<number, number[]>,
    histograms: Record<number, number[]>,
  ): void {
    this.facets = facets;
    this.histograms = histograms;
    for (const card of this.cards()) card.setFiltered(facets, histograms);
  }

  setRowCount(count: number): void {
    this.rowCount = count;
    for (const card of this.cards()) card.setRowCount(count);
  }

  setTotalRowCount(count: number): void {
    this.totalRowCount = count;
    for (const card of this.cards()) card.setTotalRowCount(count);
  }

  refresh(): void {
    for (const card of this.cards()) card.refresh();
  }

  /** Cheap re-entry: repaint without re-requesting any worker payloads. */
  repaint(): void {
    for (const card of this.cards()) card.repaint();
  }

  dispose(): void {
    for (const card of this.cards()) card.dispose();
    this.entries = [];
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
    const isEmpty = this.entries.length === 0;
    this.empty.classList.toggle("hidden", !isEmpty);
    this.grid.classList.toggle("hidden", isEmpty);
    if (!isEmpty) return;
    this.empty.replaceChildren();
    if (this.columns.length === 0) {
      this.empty.append(
        el("p", {}, ["No charts yet — load data to see chart types that fit its columns."]),
      );
      return;
    }
    this.empty.append(
      el("div", { class: "charts-empty-title" }, [
        "No charts yet — pick a type from the rail or use + Add chart",
      ]),
    );
  }
}

import type { ChartBinOptions, ChartBins } from "../data/chart-bins.js";
import type { SeriesGrid, SeriesMode, SeriesPoints } from "../data/chart-series.js";
import type { BoxStatsResult, CrossTabResult } from "../data/chart-stats.js";
import { contourLevels, marchingSquares, smoothGrid, smoothSeries } from "../data/kde.js";
import { TYPE_LABELS } from "../types.js";
import type {
  BoxStatsMessage,
  ChartBinsMessage,
  ChartSeriesMessage,
  ColumnMeta,
  CorrelationMessage,
  CrosstabMessage,
} from "../worker/protocol.js";
import {
  axisKindFor,
  categorySeries,
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
  isNumericType,
  isPairKind,
  niceTicks,
  parseChartNumber,
  rampColor,
  safeFileName,
  suggestedBinRange,
} from "./chart-utils.js";
import { el } from "./dom.js";

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
  onRemove(card: ChartCard): void;
  onDuplicate(card: ChartCard): void;
  onExport(card: ChartCard): void;
}

export interface ChartCardConfig {
  kind: ChartCardKind;
  column: number;
  x: number;
  y: number;
  colorColumn: number;
  sizeColumn: number;
  mode: SeriesMode;
  densityStyle: DensityStyle;
  kde: boolean;
  color: string;
  multiColor: boolean;
  topN: number;
  groupOther: boolean;
  binOptions: ChartBinOptions | null;
  binClipped: boolean;
  title: string;
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
const HEX = /^#?[0-9a-f]{6}$/i;

function cssVar(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value === "" ? fallback : value;
}

function defaultConfig(): ChartCardConfig {
  return {
    kind: "histogram",
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
    topN: 5,
    groupOther: true,
    binOptions: null,
    binClipped: false,
    title: "",
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
  private statsMs = 0;

  private readonly kindSelect: HTMLSelectElement;
  private readonly primarySelect: HTMLSelectElement;
  private readonly xSelect: HTMLSelectElement;
  private readonly ySelect: HTMLSelectElement;
  private readonly colorSelect: HTMLSelectElement;
  private readonly sizeSelect: HTMLSelectElement;
  private readonly modeSelect: HTMLSelectElement;
  private readonly densityStyleSelect: HTMLSelectElement;
  private readonly kdeInput: HTMLInputElement;
  private readonly correlationSelect: HTMLSelectElement;
  private readonly primaryWrap: HTMLElement;
  private readonly xWrap: HTMLElement;
  private readonly yWrap: HTMLElement;
  private readonly colorWrap: HTMLElement;
  private readonly sizeWrap: HTMLElement;
  private readonly modeWrap: HTMLElement;
  private readonly densityStyleWrap: HTMLElement;
  private readonly xTagLabel: HTMLElement;
  private readonly yTagLabel: HTMLElement;
  private readonly colorGroup: HTMLElement;
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

  private readonly onResize = (): void => this.render();

  constructor(
    root: HTMLElement,
    private readonly options: ChartCardOptions,
    preset?: Partial<ChartCardConfig>,
  ) {
    this.root = root;
    this.root.classList.add("chart-card");
    this.config = { ...defaultConfig(), ...preset };

    const head = el("div", { class: "chart-card-head" });
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
    this.primaryWrap = this.primarySelect;

    this.xSelect = this.buildSelect("chart-picker", "X column");
    this.xSelect.addEventListener("change", () => {
      this.config.x = Number(this.xSelect.value);
      this.generation++;
      this.refreshSeries();
      this.refreshBox();
      this.refreshCrosstab();
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

    const duplicate = el(
      "button",
      { class: "ghost small", type: "button", title: "Duplicate this chart" },
      ["Duplicate"],
    );
    duplicate.addEventListener("click", () => this.options.onDuplicate(this));
    const png = el(
      "button",
      { class: "ghost small", type: "button", title: "Download this chart as a PNG" },
      ["PNG"],
    );
    png.addEventListener("click", () => this.options.onExport(this));
    const remove = el(
      "button",
      { class: "ghost small danger", type: "button", title: "Remove this chart" },
      ["×"],
    );
    remove.addEventListener("click", () => this.options.onRemove(this));

    head.append(
      this.kindSelect,
      this.primaryWrap,
      this.xWrap,
      this.yWrap,
      this.colorWrap,
      this.sizeWrap,
      this.modeWrap,
      this.densityStyleWrap,
      el("span", { class: "grow" }),
      duplicate,
      png,
      remove,
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
    this.barSettings = el("div", { class: "chart-settings" }, [topField, otherField, multiField]);

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
        this.hexInput.value = color;
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
    this.hexInput.value = this.config.color;
    const applyHex = (): void => {
      const value = this.hexInput.value.trim();
      if (!HEX.test(value)) {
        this.hexInput.value = this.config.color;
        return;
      }
      this.config.color = value.startsWith("#") ? value.toLowerCase() : `#${value.toLowerCase()}`;
      this.hexInput.value = this.config.color;
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

    this.titleInput = el("input", {
      class: "text-input chart-title",
      type: "text",
      placeholder: "Chart title (optional)",
      spellcheck: "false",
      "aria-label": "Chart title",
    }) as HTMLInputElement;
    this.titleInput.addEventListener("input", () => {
      this.config.title = this.titleInput.value;
      this.render();
    });
    const lookRow = el("div", { class: "chart-card-look" }, [this.colorGroup, this.titleInput]);

    const canvasWrap = el("div", { class: "chart-canvas-wrap" });
    this.canvas = el("canvas", { class: "chart-canvas" }) as HTMLCanvasElement;
    canvasWrap.append(this.canvas);
    this.noteEl = el("div", { class: "chart-note" });

    this.root.append(
      head,
      this.histogramSettings,
      this.barSettings,
      this.correlationSettings,
      lookRow,
      canvasWrap,
      this.noteEl,
    );

    this.syncSwatches();
    this.syncOptions();
    this.renderControls();
    this.render();
    window.addEventListener("resize", this.onResize);
    window.addEventListener("themechange", this.onResize);
  }

  dispose(): void {
    this.disposed = true;
    this.generation++;
    window.removeEventListener("resize", this.onResize);
    window.removeEventListener("themechange", this.onResize);
  }

  setColumns(columns: ColumnMeta[]): void {
    this.columns = columns;
    this.generation++;
    this.pickerSignature = "";
    this.syncOptions();
    this.syncPlaceholder();
    this.renderControls();
    this.refreshBins();
    this.refreshSeries();
    this.refreshBox();
    this.refreshCrosstab();
    this.refreshCorrelation();
    this.render();
  }

  setFiltered(
    facets: Record<number, number[]>,
    histograms: Record<number, number[]>,
  ): void {
    this.facets = facets;
    this.histograms = histograms;
    this.generation++;
    this.refreshBins();
    this.refreshSeries();
    this.refreshBox();
    this.refreshCrosstab();
    this.refreshCorrelation();
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
    this.refreshBox();
    this.refreshCrosstab();
    this.refreshCorrelation();
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
    return out.filter((index) => index >= 0);
  }

  exportPng(width: number, height: number): void {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (ctx === null) return;
    this.drawChart(ctx, width, height);
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
        return isCategoryType(meta.type);
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
    return this.allowedIndexes((meta) => isNumericType(meta.type)).slice(0, 8);
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
    this.refreshBox();
    this.refreshCrosstab();
    this.refreshCorrelation();
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
    this.render();
  }

  private applyColumnDefaults(): void {
    const meta = this.meta(this.config.column);
    this.binResult = null;
    if (meta === undefined) {
      this.config.binOptions = null;
      return;
    }
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
    this.modeSelect.value = this.config.mode;
    this.densityStyleSelect.value = this.config.densityStyle;

    const numeric = this.allowedIndexes((meta) => isNumericType(meta.type));
    this.config.correlationColumns = this.config.correlationColumns.filter((index) =>
      numeric.includes(index),
    );
    this.correlationSelect.replaceChildren();
    numeric.forEach((index) => {
      const meta = this.columns[index];
      const option = this.option(String(index), `${meta.name} (${TYPE_LABELS[meta.type]})`);
      option.selected = this.config.correlationColumns.includes(index);
      this.correlationSelect.append(option);
    });
  }

  private option(value: string, label: string): HTMLOptionElement {
    return el("option", { value }, [label]) as HTMLOptionElement;
  }

  private renderControls(): void {
    const kind = this.config.kind;
    const pair = isPairKind(kind);
    this.primaryWrap.classList.toggle("hidden", pair || kind === "correlation");
    this.xWrap.classList.toggle("hidden", !pair);
    this.yWrap.classList.toggle("hidden", !pair);
    const seriesKind = kind === "scatter" || kind === "density";
    this.colorWrap.classList.toggle("hidden", !seriesKind);
    this.sizeWrap.classList.toggle("hidden", !seriesKind);
    this.modeWrap.classList.toggle("hidden", kind !== "scatter");
    this.densityStyleWrap.classList.toggle("hidden", !seriesKind);
    this.colorGroup.classList.toggle("hidden", kind === "correlation");
    this.histogramSettings.classList.toggle("hidden", kind !== "histogram");
    this.barSettings.classList.toggle(
      "hidden",
      kind !== "bar" && kind !== "box" && kind !== "heatmap",
    );
    this.correlationSettings.classList.toggle("hidden", kind !== "correlation");
    this.topLabel.textContent =
      kind === "bar" ? "Top bars" : kind === "box" ? "Top groups" : "Top per axis";
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
  }

  private syncSwatches(): void {
    for (const swatch of this.swatches) {
      const active = swatch.title.toLowerCase() === this.config.color.toLowerCase();
      swatch.classList.toggle("active", active);
    }
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
    if (isPairKind(this.config.kind)) {
      return defaultChartTitle(this.options.datasetName(), this.pairLabel("vs"));
    }
    if (this.config.kind === "correlation") {
      return defaultChartTitle(this.options.datasetName(), "Correlation");
    }
    return defaultChartTitle(this.options.datasetName(), this.meta(this.config.column)?.name ?? "");
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

  private render(): void {
    const wrap = this.canvas.parentElement;
    let cssWidth = 640;
    if (wrap !== null) {
      const style = getComputedStyle(wrap);
      const padding =
        (Number.parseFloat(style.paddingLeft) || 0) + (Number.parseFloat(style.paddingRight) || 0);
      cssWidth = wrap.clientWidth - padding;
    }
    cssWidth = Math.max(300, Math.round(cssWidth));
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
  }

  private frame(ctx: CanvasRenderingContext2D, width: number, height: number): Frame {
    const ui = Math.max(0.7, Math.min(2.6, height / 540));
    const left = 56 * ui;
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
    if (this.config.kind === "scatter" || this.config.kind === "density") {
      const x = this.meta(this.config.x)?.name ?? "X";
      const y = this.meta(this.config.y)?.name ?? "Y";
      return `${x} vs ${y} · ${rows}`;
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

  private drawChart(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    ctx.clearRect(0, 0, width, height);
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    const frame = this.frame(ctx, width, height);

    if (this.columns.length === 0) {
      this.noteEl.textContent = "Load data to see charts.";
      return;
    }

    const title = this.config.title.trim() === "" ? this.defaultTitle() : this.config.title.trim();
    this.font(ctx, frame.ui, 15, "600");
    ctx.fillStyle = frame.text;
    ctx.fillText(this.fit(ctx, title, width - frame.left - frame.right), frame.left, 22 * frame.ui);
    this.font(ctx, frame.ui, 11);
    ctx.fillStyle = frame.dim;
    ctx.fillText(this.fit(ctx, this.subtitle(), width - frame.left - frame.right), frame.left, 40 * frame.ui);

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
      case "heatmap":
        this.drawHeatmap(ctx, frame);
        break;
      case "correlation":
        this.drawCorrelation(ctx, frame);
        break;
      default:
        this.drawSeries(ctx, frame, this.config.kind);
        break;
    }
  }

  private drawSeries(
    ctx: CanvasRenderingContext2D,
    frame: Frame,
    kind: "histogram" | "line",
  ): void {
    const meta = this.meta(this.config.column);
    if (meta === undefined) {
      this.noteEl.textContent = "Pick a column to chart.";
      return;
    }
    const automatic = meta.histogram;
    const custom = kind === "histogram" ? this.binResult : null;
    const bins =
      custom !== null ? custom.bins : (this.histograms[this.config.column] ?? automatic?.bins ?? []);
    if (bins.length === 0 || automatic === null) {
      this.noteEl.textContent = "This column has no histogram data yet.";
      return;
    }
    const ui = frame.ui;
    const hasOverflow = custom !== null && custom.overflow > 0;
    const overflowCount = custom?.overflow ?? 0;
    const maxCount = Math.max(1, ...bins, overflowCount);
    const slots = bins.length + (hasOverflow ? 1 : 0);
    const slotW = frame.plotW / slots;
    const barW = Math.max(1, slotW - 1);

    const yTicks = niceTicks(0, maxCount, 4);
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

    if (kind === "histogram") {
      for (let i = 0; i < bins.length; i++) {
        const h = (bins[i] / maxCount) * frame.plotH;
        if (h <= 0) continue;
        ctx.globalAlpha = 0.85;
        ctx.fillStyle = this.config.color;
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
      ctx.strokeStyle = this.config.color;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.lineTo(frame.left + frame.plotW, frame.top + frame.plotH);
      ctx.lineTo(frame.left, frame.top + frame.plotH);
      ctx.closePath();
      ctx.globalAlpha = 0.18;
      ctx.fillStyle = this.config.color;
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    const min = this.config.binOptions?.min ?? automatic.min;
    const max = this.config.binOptions?.max ?? automatic.max;

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
      ctx.fillStyle = this.config.color;
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

  private drawBars(ctx: CanvasRenderingContext2D, frame: Frame): void {
    const meta = this.meta(this.config.column);
    if (meta === undefined) {
      this.noteEl.textContent = "Pick a column to chart.";
      return;
    }
    const bars = categorySeries(meta, this.facets[this.config.column], this.config.topN, this.config.groupOther);
    if (bars.length === 0) {
      this.noteEl.textContent = "This column has no category data yet.";
      return;
    }
    const ui = frame.ui;
    const maxCount = Math.max(1, ...bars.map((bar) => bar.count));
    const slotW = frame.plotW / bars.length;
    const barW = Math.max(4, slotW - Math.min(18 * ui, slotW * 0.25));

    const yTicks = niceTicks(0, maxCount, 4);
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
            ? CHART_COLORS[index % CHART_COLORS.length]
            : this.config.color;
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
      this.noteEl.textContent =
        this.columns.length === 0
          ? "Load data to see charts."
          : "Scatter and density need two numeric or date columns — pick X and Y above.";
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
    const yTicks = niceTicks(yMin, yMax, 4);
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
      const buckets = new Uint8Array(n);
      for (let i = 0; i < n; i++) buckets[i] = result.colorCodes[i] % CHART_COLORS.length;
      return { buckets, colors: [...CHART_COLORS] };
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
      const colors = Array.from({ length: 16 }, (_, index) => rampColor(index / 15));
      colors.push(this.config.color);
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
      this.noteEl.textContent = "No matching X/Y value pairs in the current rows.";
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
      ctx.fillStyle = this.config.color;
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
      this.noteEl.textContent = "No matching X/Y value pairs in the current rows.";
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
    const [r, g, b] = hexToRgb(this.config.color);
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
      frame.top + 14 * frame.ui,
    );
    ctx.textAlign = "left";
  }

  private drawBox(ctx: CanvasRenderingContext2D, frame: Frame): void {
    const result = this.boxResult;
    if (result === null || result.groups.length === 0) {
      this.noteEl.textContent =
        this.columns.length === 0
          ? "Load data to see charts."
          : "Box plots need a numeric Value column and a category Groups column — pick them above.";
      return;
    }
    const ui = frame.ui;
    const groups = result.groups;
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

    const ticks = niceTicks(yMin, yMax, 5);
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
      ctx.fillText(formatTick(value, "histogram"), frame.left - 6 * ui, y + 3 * ui);
    }
    ctx.textAlign = "left";
    ctx.beginPath();
    ctx.moveTo(frame.left, frame.top + frame.plotH + 0.5);
    ctx.lineTo(frame.left + frame.plotW, frame.top + frame.plotH + 0.5);
    ctx.stroke();

    const slot = frame.plotW / groups.length;
    const boxW = Math.min(slot * 0.55, 54 * ui);
    const cap = Math.max(3 * ui, boxW * 0.25);
    groups.forEach((group, index) => {
      const cx = frame.left + (index + 0.5) * slot;
      const yQ1 = yOf(group.q1);
      const yQ3 = yOf(group.q3);
      const top = Math.min(yQ1, yQ3);
      const height = Math.max(1.5, Math.abs(yQ1 - yQ3));

      ctx.globalAlpha = group.other ? 0.2 : 0.32;
      ctx.fillStyle = this.config.color;
      ctx.fillRect(cx - boxW / 2, top, boxW, height);
      ctx.globalAlpha = group.other ? 0.5 : 0.9;
      ctx.strokeStyle = this.config.color;
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
      ctx.fillStyle = this.config.color;
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
    ctx.textAlign = "left";

    let outliers = 0;
    for (const group of groups) outliers += group.outliers.length;
    const notes = [
      `${groups.length} groups`,
      `${result.total.toLocaleString()} values`,
      `${outliers.toLocaleString()} outliers`,
    ];
    if (result.missing > 0) notes.push(`${result.missing.toLocaleString()} missing values`);
    if (this.statsMs > 0) notes.push(`${Math.round(this.statsMs)} ms`);
    this.noteEl.textContent = notes.join(" · ");
  }

  private drawHeatmap(ctx: CanvasRenderingContext2D, frame: Frame): void {
    const result = this.crossResult;
    if (result === null || result.xLabels.length === 0 || result.yLabels.length === 0) {
      this.noteEl.textContent =
        this.columns.length === 0
          ? "Load data to see charts."
          : "Heatmaps need two category columns — pick them above.";
      return;
    }
    const ui = frame.ui;
    const xCount = result.xLabels.length;
    const yCount = result.yLabels.length;
    const cellW = frame.plotW / xCount;
    const cellH = frame.plotH / yCount;
    let max = 0;
    for (const count of result.counts) if (count > max) max = count;
    const [r, g, b] = hexToRgb(this.config.color);
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
      this.noteEl.textContent =
        this.columns.length === 0
          ? "Load data to see charts."
          : "Correlation needs at least two numeric columns — select them above.";
      return;
    }
    const ui = frame.ui;
    const n = result.labels.length;
    const size = Math.min(frame.plotW / n, frame.plotH / n);
    const gridW = size * n;
    const gridH = size * n;
    const left = frame.left + (frame.plotW - gridW) / 2;
    const top = frame.top + (frame.plotH - gridH) / 2;
    const zeroColor = cssVar("--border-subtle", "#eaeef2");
    const showText = size >= 30 * ui;
    let minCount = Infinity;

    this.font(ctx, ui, showText ? 10 : 9);
    for (let row = 0; row < n; row++) {
      for (let column = 0; column < n; column++) {
        const index = row * n + column;
        const r = result.values[index];
        const cell = correlationCell(r, zeroColor);
        ctx.fillStyle = cell.bg;
        ctx.fillRect(left + column * size, top + row * size, size, size);
        if (showText) {
          ctx.fillStyle = cell.fg;
          ctx.textAlign = "center";
          const text = Number.isFinite(r) ? r.toFixed(2) : "—";
          ctx.fillText(text, left + (column + 0.5) * size, top + (row + 0.5) * size + 3.5 * ui);
        }
        if (index !== row * n + row) {
          const count = result.counts[index];
          if (count > 0 && count < minCount) minCount = count;
        }
      }
    }
    ctx.textAlign = "center";
    result.labels.forEach((label, column) => {
      ctx.fillStyle = frame.dim;
      ctx.fillText(
        this.fit(ctx, label, Math.max(8, size - 2 * ui)),
        left + (column + 0.5) * size,
        top + gridH + 14 * ui,
      );
    });
    ctx.textAlign = "right";
    result.labels.forEach((label, row) => {
      ctx.fillStyle = frame.dim;
      ctx.fillText(
        this.fit(ctx, label, Math.max(8, left - frame.left - 6 * ui)),
        left - 4 * ui,
        top + (row + 0.5) * size + 3.5 * ui,
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

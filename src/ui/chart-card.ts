import type { ChartBinOptions, ChartBins } from "../data/chart-bins.js";
import type { SeriesGrid, SeriesMode, SeriesPoints } from "../data/chart-series.js";
import { TYPE_LABELS } from "../types.js";
import type { ChartSeriesMessage, ColumnMeta } from "../worker/protocol.js";
import {
  axisKindFor,
  categorySeries,
  CHART_COLORS,
  CHART_KIND_LABELS,
  type ChartCardKind,
  defaultChartTitle,
  formatChartNumber,
  formatTick,
  hexToRgb,
  isCategoryType,
  isNumericType,
  niceTicks,
  parseChartNumber,
  rampColor,
  safeFileName,
  suggestedBinRange,
} from "./chart-utils.js";
import { el } from "./dom.js";

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
  requestBins(column: number, options: ChartBinOptions): Promise<ChartBins>;
  requestSeries(input: SeriesRequestInput): Promise<ChartSeriesMessage>;
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
  color: string;
  multiColor: boolean;
  topN: number;
  groupOther: boolean;
  binOptions: ChartBinOptions | null;
  binClipped: boolean;
  title: string;
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
    color: CHART_COLORS[0],
    multiColor: true,
    topN: 5,
    groupOther: true,
    binOptions: null,
    binClipped: false,
    title: "",
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
  private seriesResult: SeriesPoints | SeriesGrid | null = null;
  private seriesLabels: string[] | null = null;
  private seriesMs = 0;

  private readonly kindSelect: HTMLSelectElement;
  private readonly primarySelect: HTMLSelectElement;
  private readonly xSelect: HTMLSelectElement;
  private readonly ySelect: HTMLSelectElement;
  private readonly colorSelect: HTMLSelectElement;
  private readonly sizeSelect: HTMLSelectElement;
  private readonly modeSelect: HTMLSelectElement;
  private readonly primaryWrap: HTMLElement;
  private readonly xWrap: HTMLElement;
  private readonly yWrap: HTMLElement;
  private readonly colorWrap: HTMLElement;
  private readonly sizeWrap: HTMLElement;
  private readonly modeWrap: HTMLElement;
  private readonly histogramSettings: HTMLElement;
  private readonly barSettings: HTMLElement;
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
      this.render();
    });
    this.xWrap = this.tagged("X", this.xSelect);

    this.ySelect = this.buildSelect("chart-picker", "Y column");
    this.ySelect.addEventListener("change", () => {
      this.config.y = Number(this.ySelect.value);
      this.generation++;
      this.refreshSeries();
      this.render();
    });
    this.yWrap = this.tagged("Y", this.ySelect);

    this.colorSelect = this.buildSelect("chart-picker chart-picker-small", "Colour column");
    this.colorSelect.addEventListener("change", () => {
      this.config.colorColumn = Number(this.colorSelect.value);
      this.generation++;
      this.refreshSeries();
      this.render();
    });
    this.colorWrap = this.tagged("Colour", this.colorSelect);

    this.sizeSelect = this.buildSelect("chart-picker chart-picker-small", "Size column");
    this.sizeSelect.addEventListener("change", () => {
      this.config.sizeColumn = Number(this.sizeSelect.value);
      this.generation++;
      this.refreshSeries();
      this.render();
    });
    this.sizeWrap = this.tagged("Size", this.sizeSelect);

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
    this.modeWrap = this.tagged("Render", this.modeSelect);

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
    this.histogramSettings = el("div", { class: "chart-settings" }, [
      field("Start", this.minInput),
      field("End", this.maxInput),
      field("Bins", this.binsInput),
      overflowField,
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
      this.render();
    });
    this.otherInput = el("input", { type: "checkbox" }) as HTMLInputElement;
    this.otherInput.checked = this.config.groupOther;
    const otherField = el("label", { class: "control check clean-check chart-check" });
    otherField.append(this.otherInput, "Group rest as Other");
    this.otherInput.addEventListener("change", () => {
      this.config.groupOther = this.otherInput.checked;
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
    this.barSettings = el("div", { class: "chart-settings" }, [
      field("Top bars", this.topInput),
      otherField,
      multiField,
    ]);

    const colorGroup = el("div", { class: "chart-colors" });
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
      colorGroup.append(swatch);
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
    colorGroup.append(this.hexInput);

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
    const lookRow = el("div", { class: "chart-card-look" }, [colorGroup, this.titleInput]);

    const canvasWrap = el("div", { class: "chart-canvas-wrap" });
    this.canvas = el("canvas", { class: "chart-canvas" }) as HTMLCanvasElement;
    canvasWrap.append(this.canvas);
    this.noteEl = el("div", { class: "chart-note" });

    this.root.append(head, this.histogramSettings, this.barSettings, lookRow, canvasWrap, this.noteEl);

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
    this.render();
  }

  getConfig(): ChartCardConfig {
    return { ...this.config, binOptions: this.config.binOptions === null ? null : { ...this.config.binOptions } };
  }

  /** Column indexes this card currently charts, used to pick fresh defaults. */
  usedColumns(): number[] {
    const out = [this.config.column];
    if (this.config.kind === "scatter" || this.config.kind === "density") {
      out.push(this.config.x, this.config.y);
    }
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

  private tagged(tag: string, select: HTMLSelectElement): HTMLElement {
    const wrap = el("label", { class: "chart-tag" });
    wrap.append(el("span", { class: "chart-tag-label" }, [tag]), select);
    return wrap;
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

  private allowedIndexes(allow: (meta: ColumnMeta) => boolean): number[] {
    const out: number[] = [];
    this.columns.forEach((meta, index) => {
      if (allow(meta)) out.push(index);
    });
    return out;
  }

  private setKind(kind: ChartCardKind): void {
    if (kind === this.config.kind) return;
    this.config.kind = kind;
    const axis = this.allowedIndexes((meta) => this.allowsAxis(meta));
    if (kind === "scatter" || kind === "density") {
      if (!axis.includes(this.config.x)) this.config.x = axis[0] ?? -1;
      if (!axis.includes(this.config.y) || this.config.y === this.config.x) {
        this.config.y = axis.find((index) => index !== this.config.x) ?? this.config.x;
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

    const axis = this.allowedIndexes((meta) => this.allowsAxis(meta));
    if (!axis.includes(this.config.x)) this.config.x = axis[0] ?? -1;
    if (!axis.includes(this.config.y) || this.config.y < 0) {
      this.config.y = axis.find((index) => index !== this.config.x) ?? this.config.x;
    }
    for (const [select, selected] of [
      [this.xSelect, this.config.x],
      [this.ySelect, this.config.y],
    ] as const) {
      select.replaceChildren();
      axis.forEach((index) => {
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
  }

  private option(value: string, label: string): HTMLOptionElement {
    return el("option", { value }, [label]) as HTMLOptionElement;
  }

  private renderControls(): void {
    const kind = this.config.kind;
    const scatterLike = kind === "scatter" || kind === "density";
    this.primaryWrap.classList.toggle("hidden", scatterLike);
    for (const wrap of [this.xWrap, this.yWrap, this.colorWrap, this.sizeWrap]) {
      wrap.classList.toggle("hidden", !scatterLike);
    }
    this.modeWrap.classList.toggle("hidden", kind !== "scatter");
    this.histogramSettings.classList.toggle("hidden", kind !== "histogram");
    this.barSettings.classList.toggle("hidden", kind !== "bar");

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

  private defaultTitle(): string {
    if (this.config.kind === "scatter" || this.config.kind === "density") {
      const x = this.meta(this.config.x)?.name ?? "";
      const y = this.meta(this.config.y)?.name ?? "";
      const label = x === "" || y === "" ? "Scatter" : `${x} vs ${y}`;
      return defaultChartTitle(this.options.datasetName(), label);
    }
    return defaultChartTitle(this.options.datasetName(), this.meta(this.config.column)?.name ?? "");
  }

  private chartName(): string {
    if (this.config.kind === "scatter" || this.config.kind === "density") {
      const x = this.meta(this.config.x)?.name ?? "x";
      const y = this.meta(this.config.y)?.name ?? "y";
      return `${x}-vs-${y}`;
    }
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
    if (this.config.kind === "scatter" || this.config.kind === "density") {
      const x = this.meta(this.config.x)?.name ?? "X";
      const y = this.meta(this.config.y)?.name ?? "Y";
      return `${x} vs ${y} · ${this.rowCount.toLocaleString()} rows shown`;
    }
    const meta = this.meta(this.config.column);
    if (meta === undefined) return `${this.rowCount.toLocaleString()} rows shown`;
    return `${TYPE_LABELS[meta.type]} · ${this.rowCount.toLocaleString()} rows shown · ${meta.stats.distinct.toLocaleString()} distinct`;
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

    ctx.strokeStyle = frame.border;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(frame.left, frame.top + frame.plotH + 0.5);
    ctx.lineTo(frame.left + frame.plotW, frame.top + frame.plotH + 0.5);
    ctx.stroke();
    const halfY = frame.top + frame.plotH / 2;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(frame.left, halfY + 0.5);
    ctx.lineTo(frame.left + frame.plotW, halfY + 0.5);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = frame.dim;
    this.font(ctx, ui, 10);
    ctx.textAlign = "right";
    ctx.fillText(maxCount.toLocaleString(), frame.left - 6 * ui, frame.top + 8 * ui);
    ctx.fillText(Math.round(maxCount / 2).toLocaleString(), frame.left - 6 * ui, halfY + 3 * ui);
    ctx.fillText("0", frame.left - 6 * ui, frame.top + frame.plotH + 3 * ui);
    ctx.textAlign = "left";

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

    ctx.fillStyle = frame.dim;
    this.font(ctx, ui, 10);
    const min = this.config.binOptions?.min ?? automatic.min;
    const max = this.config.binOptions?.max ?? automatic.max;
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

    ctx.strokeStyle = frame.border;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(frame.left, frame.top + frame.plotH + 0.5);
    ctx.lineTo(frame.left + frame.plotW, frame.top + frame.plotH + 0.5);
    ctx.stroke();
    const halfY = frame.top + frame.plotH / 2;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(frame.left, halfY + 0.5);
    ctx.lineTo(frame.left + frame.plotW, halfY + 0.5);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = frame.dim;
    this.font(ctx, ui, 10);
    ctx.textAlign = "right";
    ctx.fillText(maxCount.toLocaleString(), frame.left - 6 * ui, frame.top + 8 * ui);
    ctx.fillText(Math.round(maxCount / 2).toLocaleString(), frame.left - 6 * ui, halfY + 3 * ui);
    ctx.fillText("0", frame.left - 6 * ui, frame.top + frame.plotH + 3 * ui);
    ctx.textAlign = "left";

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
        const offset = ((result.rows - 1 - cy) * result.cols + cx) * 4;
        if (count === 0) continue;
        const t = count / result.max;
        image.data[offset] = r;
        image.data[offset + 1] = g;
        image.data[offset + 2] = b;
        image.data[offset + 3] = Math.round((0.12 + 0.88 * Math.sqrt(t)) * 255);
      }
    }
    offCtx.putImageData(image, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(off, frame.left, frame.top, frame.plotW, frame.plotH);

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

    const notes = [
      `${result.total.toLocaleString()} rows`,
      `${result.cols}×${result.rows} density grid`,
      `peak ${result.max.toLocaleString()}`,
    ];
    if (result.outside > 0) notes.push(`${result.outside.toLocaleString()} outside p1–p99`);
    if (this.seriesMs > 0) notes.push(`${Math.round(this.seriesMs)} ms`);
    this.noteEl.textContent = notes.join(" · ");
  }
}

import type { ChartBinOptions, ChartBins } from "../data/chart-bins.js";
import { toDateInputValue } from "../parse/dates.js";
import { TYPE_LABELS } from "../types.js";
import type { ColumnMeta } from "../worker/protocol.js";
import { el } from "./dom.js";

export type ChartKind = "histogram" | "line" | "bar" | null;

/** Chart type implied by the column's type (null = not chartable). */
export function chartKindFor(type: ColumnMeta["type"]): ChartKind {
  switch (type) {
    case "integer":
    case "number":
      return "histogram";
    case "date":
      return "line";
    case "category":
    case "boolean":
      return "bar";
    default:
      return null;
  }
}

export interface CategoryBar {
  label: string;
  count: number;
  /** Share of all non-empty category values, in percent. */
  pct: number;
  other?: boolean;
}

/**
 * Category series for the bar chart: the top N values by count, with the rest
 * aggregated into an "Other" bar when requested. Counts use filtered facet
 * counts when present, else the static category counts.
 */
export function categorySeries(
  meta: ColumnMeta,
  facetCounts: number[] | undefined,
  topN: number,
  groupOther: boolean,
): CategoryBar[] {
  if (meta.categories === null) return [];
  const counts = facetCounts ?? meta.categories.counts;
  const all = meta.categories.labels.map((label, index) => ({
    label,
    count: counts[index] ?? meta.categories?.counts[index] ?? 0,
  }));
  const total = all.reduce((sum, entry) => sum + entry.count, 0);
  all.sort((a, b) => b.count - a.count);
  const take = Math.max(1, Math.floor(topN));
  const top: CategoryBar[] = all.slice(0, take).map((entry) => ({
    label: entry.label,
    count: entry.count,
    pct: total > 0 ? (entry.count / total) * 100 : 0,
  }));
  if (groupOther && all.length > top.length) {
    const count = all.slice(top.length).reduce((sum, entry) => sum + entry.count, 0);
    top.push({
      label: "Other",
      count,
      pct: total > 0 ? (count / total) * 100 : 0,
      other: true,
    });
  }
  return top;
}

export const CHART_COLORS: readonly string[] = [
  "#2563eb",
  "#0ea5e9",
  "#10b981",
  "#84cc16",
  "#eab308",
  "#f97316",
  "#ef4444",
  "#ec4899",
  "#8b5cf6",
  "#64748b",
];

/** Fixed logical drawing area; every export size scales from this 16:9 canvas. */
const CHART_W = 960;
const CHART_H = 540;
const PAD_LEFT = 56;
const PAD_RIGHT = 18;
const PAD_TOP = 58;
const PAD_BOTTOM = 40;
const DEFAULT_BIN_COUNT = 32;
const HEX = /^#?[0-9a-f]{6}$/i;

export const EXPORT_SIZES: readonly { label: string; width: number; height: number }[] = [
  { label: "1280 × 720", width: 1280, height: 720 },
  { label: "1920 × 1080", width: 1920, height: 1080 },
  { label: "2560 × 1440", width: 2560, height: 1440 },
];
const DEFAULT_EXPORT_SIZE = 1;

/** Default chart title: data source plus column, editable by the user. */
export function defaultChartTitle(datasetName: string, columnName: string): string {
  const base = datasetName.replace(/\.[^.]+$/, "").trim();
  const source = base === "" ? "Data" : base;
  return columnName === "" ? source : `${source} — ${columnName}`;
}

/** Displays a bin bound with thousands separators, e.g. 19818400000. */
export function formatChartNumber(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

/** Parses a bin bound, tolerating spaces, underscores and thousands commas. */
export function parseChartNumber(text: string): number | null {
  const cleaned = text.replace(/[,\s_]/g, "");
  if (cleaned === "") return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

export interface SuggestedRange {
  min: number;
  max: number;
  overflow: boolean;
  /** True when the upper bound was clipped to p95 because of extreme outliers. */
  clipped: boolean;
}

/**
 * Sensible default bin range: the full data range, but when a few extreme
 * values dwarf the rest (max > 2× p95) the End is set to p95 and the "> Max"
 * overflow bar is switched on so nothing is hidden.
 */
export function suggestedBinRange(meta: ColumnMeta): SuggestedRange {
  const histogram = meta.histogram;
  let min = meta.stats.min ?? histogram?.min ?? 0;
  let max = meta.stats.max ?? histogram?.max ?? 1;
  if (!(max > min)) {
    min -= 1;
    max += 1;
  }
  const p95 = histogram?.p95 ?? max;
  if (p95 > min && max > p95 * 2) {
    return { min, max: p95, overflow: true, clipped: true };
  }
  return { min, max, overflow: false, clipped: false };
}

function cssVar(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value === "" ? fallback : value;
}

function formatTick(value: number, kind: ChartKind): string {
  if (kind === "line") return toDateInputValue(value);
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  if (abs > 0 && abs < 1) return value.toFixed(2);
  return value.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

function safeFileName(name: string): string {
  return (
    name
      .replace(/\.[^.]+$/, "")
      .replace(/[^a-zA-Z0-9-_]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase() || "chart"
  );
}

/** Truncates text with an ellipsis so it fits the given width. */
function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let cut = text;
  while (cut.length > 2 && ctx.measureText(`${cut}…`).width > maxWidth) cut = cut.slice(0, -1);
  return `${cut}…`;
}

/** Bar with rounded top corners (falls back to a plain rect). */
function fillTopRounded(
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

export interface ChartPanelOptions {
  datasetName: () => string;
  requestBins: (column: number, options: ChartBinOptions) => Promise<ChartBins>;
}

/**
 * Chart tab inside View: histogram (numeric, custom bins), time series (date)
 * or category bars (top N + Other) rendered on a canvas from the same
 * facet/histogram payloads the filters receive. Drawing happens in fixed
 * 960×540 logical coordinates, so PNG export can render at any pixel size
 * without changing the layout.
 */
export class ChartPanel {
  private readonly picker: HTMLSelectElement;
  private readonly controls: HTMLElement;
  private readonly sizeSelect: HTMLSelectElement;
  private readonly titleInput: HTMLInputElement;
  private readonly numericControls: HTMLElement;
  private readonly barControls: HTMLElement;
  private readonly minInput: HTMLInputElement;
  private readonly maxInput: HTMLInputElement;
  private readonly binsInput: HTMLInputElement;
  private readonly overflowInput: HTMLInputElement;
  private readonly topInput: HTMLInputElement;
  private readonly otherInput: HTMLInputElement;
  private readonly multiInput: HTMLInputElement;
  private readonly swatches: HTMLButtonElement[] = [];
  private readonly hexInput: HTMLInputElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly note: HTMLElement;

  private columns: ColumnMeta[] = [];
  private pickerSignature = "";
  private selected = -1;
  private facets: Record<number, number[]> = {};
  private histograms: Record<number, number[]> = {};
  private rowCount = 0;

  private color = CHART_COLORS[0];
  private multiColor = true;
  private topN = 5;
  private groupOther = true;
  private title = "";
  private binOptions: ChartBinOptions | null = null;
  private binResult: ChartBins | null = null;
  private binClipped = false;
  private binGeneration = 0;
  private exportSizeIndex = DEFAULT_EXPORT_SIZE;

  private readonly onResize = (): void => this.render();

  constructor(
    private readonly root: HTMLElement,
    private readonly options: ChartPanelOptions,
  ) {
    this.root.classList.add("chart-host");
    this.picker = el("select", {
      class: "chart-picker",
      "aria-label": "Chart column",
    }) as HTMLSelectElement;
    this.picker.addEventListener("change", () => {
      this.selected = Number(this.picker.value);
      this.applyColumnDefaults();
      this.renderControls();
      this.refreshBins();
      this.render();
    });

    this.sizeSelect = el("select", {
      class: "chart-size",
      "aria-label": "PNG export size",
      title: "Pixel size of the exported PNG",
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

    const png = el(
      "button",
      { class: "ghost small", type: "button", title: "Download this chart as a PNG" },
      ["Export PNG"],
    );
    png.addEventListener("click", () => this.exportPng());

    this.controls = el("div", { class: "chart-controls" }, [
      this.picker,
      el("span", { class: "grow" }),
      this.sizeSelect,
      png,
    ]);

    // Histogram range controls (comma-formatted text inputs).
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
    this.numericControls = el("div", { class: "chart-settings" }, [
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
    this.overflowInput.addEventListener("change", () => this.commitBinOptions());

    // Category bar controls.
    this.topInput = el("input", {
      class: "chart-number",
      type: "number",
      min: "1",
      max: "50",
      step: "1",
      value: String(this.topN),
      title: "How many bars before the rest is grouped as Other",
      spellcheck: "false",
      "aria-label": "Number of category bars",
    }) as HTMLInputElement;
    this.topInput.addEventListener("change", () => {
      const value = Math.floor(Number(this.topInput.value));
      this.topN = Number.isFinite(value) ? Math.max(1, Math.min(50, value)) : 5;
      this.topInput.value = String(this.topN);
      this.render();
    });
    this.otherInput = el("input", { type: "checkbox" }) as HTMLInputElement;
    this.otherInput.checked = this.groupOther;
    const otherField = el("label", { class: "control check clean-check chart-check" });
    otherField.append(this.otherInput, "Group rest as Other");
    this.otherInput.addEventListener("change", () => {
      this.groupOther = this.otherInput.checked;
      this.render();
    });
    this.multiInput = el("input", { type: "checkbox" }) as HTMLInputElement;
    this.multiInput.checked = this.multiColor;
    const multiField = el("label", { class: "control check clean-check chart-check" });
    multiField.title = "Give every bar its own colour from the palette";
    multiField.append(this.multiInput, "Colour each bar");
    this.multiInput.addEventListener("change", () => {
      this.multiColor = this.multiInput.checked;
      this.render();
    });
    this.barControls = el("div", { class: "chart-settings" }, [
      field("Top bars", this.topInput),
      otherField,
      multiField,
    ]);

    // Colour picker: 10 presets plus a hex field; the title lives here too.
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
        this.color = color;
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
    this.hexInput.value = this.color;
    const applyHex = (): void => {
      const value = this.hexInput.value.trim();
      if (!HEX.test(value)) {
        this.hexInput.value = this.color;
        return;
      }
      this.color = value.startsWith("#") ? value.toLowerCase() : `#${value.toLowerCase()}`;
      this.hexInput.value = this.color;
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
      this.title = this.titleInput.value;
      this.render();
    });

    const canvasWrap = el("div", { class: "chart-canvas-wrap" });
    this.canvas = el("canvas", { class: "chart-canvas" }) as HTMLCanvasElement;
    canvasWrap.append(this.canvas);
    this.note = el("div", { class: "chart-note" });
    this.root.append(
      this.controls,
      this.numericControls,
      this.barControls,
      colorGroup,
      this.titleInput,
      canvasWrap,
      this.note,
    );

    this.syncSwatches();
    this.renderControls();
    window.addEventListener("resize", this.onResize);
    window.addEventListener("themechange", this.onResize);
  }

  dispose(): void {
    window.removeEventListener("resize", this.onResize);
    window.removeEventListener("themechange", this.onResize);
  }

  setColumns(columns: ColumnMeta[]): void {
    this.columns = columns;
    this.binOptions = null;
    this.syncPicker();
    this.syncTitle();
    this.refreshBins();
    this.render();
  }

  setFiltered(
    facets: Record<number, number[]>,
    histograms: Record<number, number[]>,
  ): void {
    this.facets = facets;
    this.histograms = histograms;
    this.syncPicker();
    this.refreshBins();
    this.render();
  }

  setRowCount(count: number): void {
    this.rowCount = count;
    this.render();
  }

  refresh(): void {
    this.refreshBins();
    this.render();
  }

  private syncPicker(): void {
    const signature = this.columns
      .map((meta, index) => `${index}:${meta.type}:${meta.name}`)
      .join("|");
    if (signature === this.pickerSignature) return;
    this.pickerSignature = signature;

    const previous = this.selected >= 0 ? this.columns[this.selected] : undefined;
    this.picker.replaceChildren();
    this.columns.forEach((meta, index) => {
      if (chartKindFor(meta.type) === null) return;
      this.picker.append(
        el("option", { value: String(index) }, [
          `${meta.name} (${TYPE_LABELS[meta.type]})`,
        ]) as HTMLOptionElement,
      );
    });

    let restored = previous === undefined ? -1 : this.columns.indexOf(previous);
    if (restored < 0 || chartKindFor(this.columns[restored]?.type ?? "string") === null) {
      restored = this.columns.findIndex((meta) => chartKindFor(meta.type) !== null);
    }
    this.selected = restored;
    if (restored >= 0) this.picker.value = String(restored);
    this.applyColumnDefaults();
    this.renderControls();
    this.syncTitle();
  }

  /** Resets bin settings to the column's suggested range (p95-aware). */
  private applyColumnDefaults(): void {
    const meta = this.columns[this.selected];
    if (meta === undefined) return;
    const suggested = suggestedBinRange(meta);
    this.binOptions = {
      min: suggested.min,
      max: suggested.max,
      binCount: DEFAULT_BIN_COUNT,
      overflow: suggested.overflow,
    };
    this.binClipped = suggested.clipped;
    this.binResult = null;
  }

  private resetBinRange(): void {
    const meta = this.columns[this.selected];
    if (meta === undefined) return;
    const histogram = meta.histogram;
    let min = meta.stats.min ?? histogram?.min ?? 0;
    let max = meta.stats.max ?? histogram?.max ?? 1;
    if (!(max > min)) {
      min -= 1;
      max += 1;
    }
    this.binOptions = { min, max, binCount: DEFAULT_BIN_COUNT, overflow: false };
    this.binClipped = false;
    this.renderControls();
    this.refreshBins();
    this.render();
  }

  private syncTitle(): void {
    this.title = this.defaultTitleFor();
    this.titleInput.value = this.title;
  }

  private defaultTitleFor(): string {
    const meta = this.columns[this.selected];
    return defaultChartTitle(this.options.datasetName(), meta?.name ?? "");
  }

  private commitBinOptions(): void {
    const min = parseChartNumber(this.minInput.value);
    const max = parseChartNumber(this.maxInput.value);
    const bins = Number(this.binsInput.value);
    if (min === null || max === null || !Number.isFinite(bins)) {
      this.renderControls();
      return;
    }
    this.binOptions = {
      min,
      max,
      binCount: Math.max(1, Math.min(256, Math.floor(bins))),
      overflow: this.overflowInput.checked,
    };
    this.binClipped = false;
    this.renderControls();
    this.refreshBins();
    this.render();
  }

  private refreshBins(): void {
    const meta = this.columns[this.selected];
    if (meta === undefined || this.binOptions === null) {
      this.binResult = null;
      return;
    }
    if (meta.type !== "integer" && meta.type !== "number") {
      this.binResult = null;
      return;
    }
    const generation = ++this.binGeneration;
    const column = this.selected;
    const options = this.binOptions;
    void this.options
      .requestBins(column, options)
      .then((bins) => {
        if (generation !== this.binGeneration || this.selected !== column) return;
        this.binResult = bins;
        this.render();
      })
      .catch(() => {
        // Keep the automatic histogram as the fallback.
      });
  }

  private syncSwatches(): void {
    for (const swatch of this.swatches) {
      const active = swatch.title.toLowerCase() === this.color.toLowerCase();
      swatch.classList.toggle("active", active);
    }
  }

  private renderControls(): void {
    const meta = this.columns[this.selected];
    const kind = meta === undefined ? null : chartKindFor(meta.type);
    this.numericControls.classList.toggle("hidden", kind !== "histogram");
    this.barControls.classList.toggle("hidden", kind !== "bar");
    if (kind === "histogram") {
      const histogram = meta?.histogram;
      const dataMin = meta?.stats.min ?? histogram?.min ?? 0;
      const dataMax = meta?.stats.max ?? histogram?.max ?? 1;
      if (this.binOptions !== null) {
        this.minInput.value = formatChartNumber(this.binOptions.min);
        this.maxInput.value = formatChartNumber(this.binOptions.max);
        this.binsInput.value = String(this.binOptions.binCount);
        this.overflowInput.checked = this.binOptions.overflow;
      }
      const p95Text =
        histogram !== undefined &&
        histogram !== null &&
        histogram.p95 > dataMin &&
        histogram.p95 < dataMax
          ? `; p95 ${formatChartNumber(histogram.p95)}`
          : "";
      this.minInput.title = `First bin starts here — data range ${formatChartNumber(dataMin)} – ${formatChartNumber(dataMax)}`;
      this.maxInput.title = `Last bin ends here — data range ${formatChartNumber(dataMin)} – ${formatChartNumber(dataMax)}${p95Text}`;
      this.maxInput.classList.toggle("clipped", this.binClipped);
      this.maxInput.title = this.binClipped
        ? `${this.maxInput.title}; clipped to p95 because of extreme outliers — Full range restores the maximum`
        : this.maxInput.title;
    }
  }

  private exportPng(): void {
    const meta = this.columns[this.selected];
    const kind = meta === undefined ? null : chartKindFor(meta.type);
    if (meta === undefined || kind === null) return;
    const size = EXPORT_SIZES[this.exportSizeIndex] ?? EXPORT_SIZES[DEFAULT_EXPORT_SIZE];
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext("2d");
    if (ctx === null) return;
    ctx.scale(size.width / CHART_W, size.height / CHART_H);
    this.drawInto(ctx, meta, kind);
    if (typeof canvas.toBlob !== "function") return;
    const name = `${safeFileName(this.options.datasetName())}-${safeFileName(
      meta.name,
    )}-${size.width}x${size.height}.png`;
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

  private render(): void {
    const meta = this.columns[this.selected];
    const kind = meta === undefined ? null : chartKindFor(meta.type);
    if (meta === undefined || kind === null) {
      this.note.textContent =
        this.columns.length === 0
          ? "Load data to see charts."
          : "No chartable column — charts exist for numeric, date and category columns.";
      this.clearCanvas();
      return;
    }

    const cssWidth = Math.max(320, this.canvas.parentElement?.clientWidth ?? 640);
    const cssHeight = (cssWidth * CHART_H) / CHART_W;
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(cssWidth * dpr);
    this.canvas.height = Math.round(cssHeight * dpr);
    this.canvas.style.width = `${cssWidth}px`;
    this.canvas.style.height = `${cssHeight}px`;

    const ctx = this.canvas.getContext("2d");
    if (ctx === null) {
      this.note.textContent = "Canvas rendering is not available in this browser.";
      return;
    }
    const sx = (cssWidth * dpr) / CHART_W;
    const sy = (cssHeight * dpr) / CHART_H;
    ctx.setTransform(sx, 0, 0, sy, 0, 0);
    ctx.clearRect(0, 0, CHART_W, CHART_H);
    this.drawInto(ctx, meta, kind);
  }

  /** Draws the whole chart in logical 960×540 coordinates. */
  private drawInto(
    ctx: CanvasRenderingContext2D,
    meta: ColumnMeta,
    kind: Exclude<ChartKind, null>,
  ): void {
    const text = cssVar("--text", "#1f2328");
    const dim = cssVar("--text-dim", "#59636e");
    const border = cssVar("--border", "#d8dee4");

    const title = this.title.trim() === "" ? this.defaultTitleFor() : this.title.trim();
    ctx.font = "600 15px system-ui, sans-serif";
    ctx.fillStyle = text;
    ctx.fillText(fitText(ctx, title, CHART_W - PAD_LEFT - PAD_RIGHT), PAD_LEFT, 22);
    ctx.font = "11px system-ui, sans-serif";
    ctx.fillStyle = dim;
    ctx.fillText(
      `${TYPE_LABELS[meta.type]} · ${this.rowCount.toLocaleString()} rows shown · ${meta.stats.distinct.toLocaleString()} distinct`,
      PAD_LEFT,
      40,
    );

    const plotW = CHART_W - PAD_LEFT - PAD_RIGHT;
    const plotH = CHART_H - PAD_TOP - PAD_BOTTOM;
    if (kind === "bar") this.drawBars(ctx, meta, plotW, plotH, text, dim, border);
    else this.drawSeries(ctx, meta, kind, plotW, plotH, dim, border);
  }

  private clearCanvas(): void {
    const ctx = this.canvas.getContext("2d");
    if (ctx === null) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  private drawSeries(
    ctx: CanvasRenderingContext2D,
    meta: ColumnMeta,
    kind: "histogram" | "line",
    plotW: number,
    plotH: number,
    dim: string,
    border: string,
  ): void {
    const automatic = meta.histogram;
    const custom = kind === "histogram" ? this.binResult : null;
    const bins =
      custom !== null ? custom.bins : (this.histograms[this.selected] ?? automatic?.bins ?? []);
    if (bins.length === 0 || automatic === null) {
      this.note.textContent = "This column has no histogram data yet.";
      return;
    }
    const hasOverflow = custom !== null && custom.overflow > 0;
    const overflowCount = custom?.overflow ?? 0;
    const maxCount = Math.max(1, ...bins, overflowCount);
    const slots = bins.length + (hasOverflow ? 1 : 0);
    const slotW = plotW / slots;
    const barW = Math.max(1, slotW - 1);

    // Baseline, midline and y ticks.
    ctx.strokeStyle = border;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(PAD_LEFT, PAD_TOP + plotH + 0.5);
    ctx.lineTo(PAD_LEFT + plotW, PAD_TOP + plotH + 0.5);
    ctx.stroke();
    const halfY = PAD_TOP + plotH / 2;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(PAD_LEFT, halfY + 0.5);
    ctx.lineTo(PAD_LEFT + plotW, halfY + 0.5);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = dim;
    ctx.font = "10px system-ui, sans-serif";
    ctx.textAlign = "right";
    ctx.fillText(maxCount.toLocaleString(), PAD_LEFT - 6, PAD_TOP + 8);
    ctx.fillText(Math.round(maxCount / 2).toLocaleString(), PAD_LEFT - 6, halfY + 3);
    ctx.fillText("0", PAD_LEFT - 6, PAD_TOP + plotH + 3);
    ctx.textAlign = "left";

    if (kind === "histogram") {
      for (let i = 0; i < bins.length; i++) {
        const h = (bins[i] / maxCount) * plotH;
        if (h <= 0) continue;
        ctx.globalAlpha = 0.85;
        ctx.fillStyle = this.color;
        fillTopRounded(ctx, PAD_LEFT + i * slotW, PAD_TOP + plotH - h, barW, h, 3);
      }
      if (hasOverflow) {
        const h = (overflowCount / maxCount) * plotH;
        const x = PAD_LEFT + bins.length * slotW + 3;
        ctx.globalAlpha = 0.55;
        fillTopRounded(ctx, x, PAD_TOP + plotH - h, Math.max(1, slotW - 4), h, 3);
      }
      ctx.globalAlpha = 1;
    } else {
      ctx.beginPath();
      for (let i = 0; i < bins.length; i++) {
        const x = PAD_LEFT + (i + 0.5) * slotW;
        const y = PAD_TOP + plotH - (bins[i] / maxCount) * plotH;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = this.color;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.lineTo(PAD_LEFT + plotW, PAD_TOP + plotH);
      ctx.lineTo(PAD_LEFT, PAD_TOP + plotH);
      ctx.closePath();
      ctx.globalAlpha = 0.18;
      ctx.fillStyle = this.color;
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // X axis labels.
    ctx.fillStyle = dim;
    const min = this.binOptions?.min ?? automatic.min;
    const max = this.binOptions?.max ?? automatic.max;
    const mid = (min + max) / 2;
    ctx.fillText(formatTick(min, kind), PAD_LEFT, PAD_TOP + plotH + 16);
    const midLabel = formatTick(mid, kind);
    ctx.fillText(midLabel, PAD_LEFT + plotW / 2 - ctx.measureText(midLabel).width / 2, PAD_TOP + plotH + 16);
    const maxLabel = formatTick(max, kind);
    ctx.fillText(maxLabel, PAD_LEFT + plotW - 4 - ctx.measureText(maxLabel).width, PAD_TOP + plotH + 16);
    if (hasOverflow) {
      const overflowLabel = `> ${formatTick(max, kind)}`;
      ctx.fillText(
        overflowLabel,
        PAD_LEFT + plotW - ctx.measureText(overflowLabel).width,
        PAD_TOP + plotH + 30,
      );
    }

    const notes: string[] = [];
    if (custom !== null) {
      notes.push(`${custom.bins.length} bins`);
      if (this.binClipped) notes.push("End clipped to p95 — Full range shows everything");
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
    this.note.textContent = notes.join(" · ");
  }

  private drawBars(
    ctx: CanvasRenderingContext2D,
    meta: ColumnMeta,
    plotW: number,
    plotH: number,
    text: string,
    dim: string,
    border: string,
  ): void {
    const bars = categorySeries(meta, this.facets[this.selected], this.topN, this.groupOther);
    if (bars.length === 0) {
      this.note.textContent = "This column has no category data yet.";
      return;
    }

    const maxCount = Math.max(1, ...bars.map((bar) => bar.count));
    const slotW = plotW / bars.length;
    const barW = Math.max(4, slotW - Math.min(18, slotW * 0.25));

    ctx.strokeStyle = border;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(PAD_LEFT, PAD_TOP + plotH + 0.5);
    ctx.lineTo(PAD_LEFT + plotW, PAD_TOP + plotH + 0.5);
    ctx.stroke();
    const halfY = PAD_TOP + plotH / 2;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(PAD_LEFT, halfY + 0.5);
    ctx.lineTo(PAD_LEFT + plotW, halfY + 0.5);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = dim;
    ctx.font = "10px system-ui, sans-serif";
    ctx.textAlign = "right";
    ctx.fillText(maxCount.toLocaleString(), PAD_LEFT - 6, PAD_TOP + 8);
    ctx.fillText(Math.round(maxCount / 2).toLocaleString(), PAD_LEFT - 6, halfY + 3);
    ctx.fillText("0", PAD_LEFT - 6, PAD_TOP + plotH + 3);
    ctx.textAlign = "left";

    ctx.font = "10px system-ui, sans-serif";
    bars.forEach((bar, index) => {
      const x = PAD_LEFT + index * slotW + (slotW - barW) / 2;
      const h = (bar.count / maxCount) * plotH;
      ctx.fillStyle =
        bar.other === true
          ? dim
          : this.multiColor
            ? CHART_COLORS[index % CHART_COLORS.length]
            : this.color;
      ctx.globalAlpha = bar.other === true ? 0.5 : 0.9;
      fillTopRounded(ctx, x, PAD_TOP + plotH - h, barW, h, 4);
      ctx.globalAlpha = 1;

      // Count + percent above each bar, wrapped onto two short lines.
      ctx.textAlign = "center";
      ctx.fillStyle = text;
      ctx.font = "10px system-ui, sans-serif";
      const countLabel = bar.count.toLocaleString();
      const pctLabel = `${bar.pct.toFixed(1)}%`;
      const cx = x + barW / 2;
      const topY = Math.max(PAD_TOP + 8, PAD_TOP + plotH - h - 14);
      ctx.fillText(countLabel, cx, topY);
      ctx.fillStyle = dim;
      ctx.fillText(pctLabel, cx, topY + 11);

      // Truncated label under the bar.
      const maxLabelW = Math.max(10, slotW - 6);
      const fullLabel = bar.label === "" ? "(blank)" : bar.label;
      let label = fullLabel;
      while (label.length > 2 && ctx.measureText(label).width > maxLabelW) {
        label = label.slice(0, -2);
      }
      if (label !== fullLabel) label = `${label}…`;
      ctx.fillStyle = dim;
      ctx.fillText(label, cx, PAD_TOP + plotH + 16);

      if (bar.other === true) {
        ctx.fillText("rest", cx, PAD_TOP + plotH + 28);
      }
    });
    ctx.textAlign = "left";

    const shown = bars.reduce((sum, bar) => sum + bar.count, 0);
    this.note.textContent = `${bars.length} bars covering ${shown.toLocaleString()} values · top ${Math.min(
      this.topN,
      bars.length,
    )}${this.groupOther && bars.some((bar) => bar.other === true) ? " + Other" : ""}`;
  }
}

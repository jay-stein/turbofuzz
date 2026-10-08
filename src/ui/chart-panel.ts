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

const PAD_LEFT = 46;
const PAD_RIGHT = 14;
const PAD_TOP = 56;
const PAD_BOTTOM = 36;
/** Standard 16:9 chart area, clamped so it stays usable in small windows. */
const ASPECT = 9 / 16;
const HEIGHT_MIN = 300;
const HEIGHT_MAX = 640;
const DEFAULT_BIN_COUNT = 32;
const HEX = /^#?[0-9a-f]{6}$/i;

/** Default chart title: data source plus column, editable by the user. */
export function defaultChartTitle(datasetName: string, columnName: string): string {
  const base = datasetName.replace(/\.[^.]+$/, "").trim();
  const source = base === "" ? "Data" : base;
  return columnName === "" ? source : `${source} — ${columnName}`;
}

export interface ChartPanelOptions {
  datasetName: () => string;
  requestBins: (column: number, options: ChartBinOptions) => Promise<ChartBins>;
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

/**
 * Chart tab inside View: histogram (numeric, custom bins), time series (date)
 * or category bars (top N + Other) rendered on a canvas from the same
 * facet/histogram payloads the filters receive. Canvas-only so PNG export is
 * just toBlob.
 */
export class ChartPanel {
  private readonly picker: HTMLSelectElement;
  private readonly controls: HTMLElement;
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
  private binGeneration = 0;

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

    const png = el(
      "button",
      { class: "ghost small", type: "button", title: "Download this chart as a PNG" },
      ["Export PNG"],
    );
    png.addEventListener("click", () => this.exportPng());

    this.titleInput = el("input", {
      class: "text-input chart-title",
      type: "text",
      placeholder: "Chart title",
      spellcheck: "false",
      "aria-label": "Chart title",
    }) as HTMLInputElement;
    this.titleInput.addEventListener("input", () => {
      this.title = this.titleInput.value;
      this.render();
    });

    this.controls = el("div", { class: "chart-controls" }, [this.titleInput, this.picker, png]);

    // Histogram range controls.
    const field = (label: string, input: HTMLElement): HTMLElement => {
      const wrap = el("label", { class: "chart-field" });
      wrap.append(el("span", { class: "chart-field-label" }, [label]), input);
      return wrap;
    };
    const numberInput = (title: string, step: string): HTMLInputElement =>
      el("input", {
        class: "chart-number",
        type: "number",
        step,
        title,
        spellcheck: "false",
      }) as HTMLInputElement;
    this.minInput = numberInput("First bin starts here", "any");
    this.maxInput = numberInput("Last bin ends here", "any");
    this.binsInput = numberInput("Number of bins (1–256)", "1");
    this.binsInput.min = "1";
    this.binsInput.max = "256";
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

    // Colour picker: 10 presets plus a hex field.
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

    const canvasWrap = el("div", { class: "chart-canvas-wrap" });
    this.canvas = el("canvas", { class: "chart-canvas" }) as HTMLCanvasElement;
    canvasWrap.append(this.canvas);
    this.note = el("div", { class: "chart-note" });
    this.root.append(
      this.controls,
      this.numericControls,
      this.barControls,
      colorGroup,
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
  }

  /** Resets bin settings to the column's full data range. */
  private applyColumnDefaults(): void {
    const meta = this.columns[this.selected];
    if (meta === undefined) return;
    this.binOptions = this.fullRangeOptions(meta);
    this.binResult = null;
    this.syncTitle();
  }

  private fullRangeOptions(meta: ColumnMeta): ChartBinOptions {
    const histogram = meta.histogram;
    let min = meta.stats.min ?? histogram?.min ?? 0;
    let max = meta.stats.max ?? histogram?.max ?? 1;
    if (!(max > min)) {
      // Constant (or unknown) range: pad so there is a real bin to draw.
      min -= 1;
      max += 1;
    }
    return { min, max, binCount: DEFAULT_BIN_COUNT, overflow: false };
  }

  private resetBinRange(): void {
    const meta = this.columns[this.selected];
    if (meta === undefined) return;
    this.binOptions = this.fullRangeOptions(meta);
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
    const min = Number(this.minInput.value);
    const max = Number(this.maxInput.value);
    const bins = Number(this.binsInput.value);
    if (!Number.isFinite(min) || !Number.isFinite(max) || !Number.isFinite(bins)) return;
    this.binOptions = {
      min,
      max,
      binCount: Math.max(1, Math.min(256, Math.floor(bins))),
      overflow: this.overflowInput.checked,
    };
    this.binsInput.value = String(this.binOptions.binCount);
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
        this.minInput.value = String(this.binOptions.min);
        this.maxInput.value = String(this.binOptions.max);
        this.binsInput.value = String(this.binOptions.binCount);
        this.overflowInput.checked = this.binOptions.overflow;
      }
      this.minInput.title = `First bin starts here (data range ${formatTick(dataMin, kind)})`;
      this.maxInput.title = `Last bin ends here (data range ${formatTick(dataMax, kind)})`;
    }
  }

  private exportPng(): void {
    if (typeof this.canvas.toBlob !== "function") return;
    const meta = this.columns[this.selected];
    const name = `${safeFileName(this.options.datasetName())}-${safeFileName(
      meta?.name ?? "chart",
    )}.png`;
    this.canvas.toBlob((blob) => {
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

    const width = Math.max(320, this.canvas.parentElement?.clientWidth ?? 640);
    const height = Math.round(
      Math.min(HEIGHT_MAX, Math.max(HEIGHT_MIN, width * ASPECT)),
    );
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;

    const ctx = this.canvas.getContext("2d");
    if (ctx === null) {
      this.note.textContent = "Canvas rendering is not available in this browser.";
      return;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const text = cssVar("--text", "#1f2328");
    const dim = cssVar("--text-dim", "#59636e");
    const border = cssVar("--border", "#d8dee4");

    const title = this.title.trim() === "" ? this.defaultTitleFor() : this.title.trim();
    ctx.font = "600 15px system-ui, sans-serif";
    ctx.fillStyle = text;
    ctx.fillText(fitText(ctx, title, width - PAD_LEFT - PAD_RIGHT), PAD_LEFT, 22);
    ctx.font = "11px system-ui, sans-serif";
    ctx.fillStyle = dim;
    ctx.fillText(
      `${TYPE_LABELS[meta.type]} · ${this.rowCount.toLocaleString()} rows shown · ${meta.stats.distinct.toLocaleString()} distinct`,
      PAD_LEFT,
      40,
    );

    const plotW = width - PAD_LEFT - PAD_RIGHT;
    const plotH = height - PAD_TOP - PAD_BOTTOM;
    if (kind === "bar") this.drawBars(meta, plotW, plotH, text, dim, border);
    else this.drawSeries(meta, kind, plotW, plotH, text, dim, border);
  }

  private clearCanvas(): void {
    const ctx = this.canvas.getContext("2d");
    if (ctx === null) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  private drawSeries(
    meta: ColumnMeta,
    kind: "histogram" | "line",
    plotW: number,
    plotH: number,
    text: string,
    dim: string,
    border: string,
  ): void {
    const automatic = meta.histogram;
    const custom = kind === "histogram" ? this.binResult : null;
    const bins = custom !== null ? custom.bins : (this.histograms[this.selected] ?? automatic?.bins ?? []);
    if (bins.length === 0 || automatic === null) {
      this.note.textContent = "This column has no histogram data yet.";
      return;
    }
    const ctx = this.canvas.getContext("2d");
    if (ctx === null) return;
    const hasOverflow = custom !== null && custom.overflow > 0;
    const overflowCount = custom?.overflow ?? 0;
    const maxCount = Math.max(1, ...bins, overflowCount);
    const slots = bins.length + (hasOverflow ? 1 : 0);
    const slotW = plotW / slots;
    const barW = Math.max(1, slotW - (kind === "histogram" ? 1 : 0));

    // Baseline + y ticks
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
        const x = PAD_LEFT + bins.length * slotW + 2;
        ctx.globalAlpha = 0.55;
        fillTopRounded(ctx, x, PAD_TOP + plotH - h, slotW - 3, h, 3);
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

    // X axis labels
    ctx.fillStyle = dim;
    const min = this.binOptions?.min ?? automatic.min;
    const max = this.binOptions?.max ?? automatic.max;
    const mid = (min + max) / 2;
    ctx.fillText(formatTick(min, kind), PAD_LEFT, PAD_TOP + plotH + 14);
    const midLabel = formatTick(mid, kind);
    ctx.fillText(midLabel, PAD_LEFT + plotW / 2 - ctx.measureText(midLabel).width / 2, PAD_TOP + plotH + 14);
    const maxLabel = formatTick(max, kind);
    ctx.fillText(maxLabel, PAD_LEFT + plotW - 4 - ctx.measureText(maxLabel).width, PAD_TOP + plotH + 14);
    if (hasOverflow) {
      const overflowLabel = `> ${formatTick(max, kind)}`;
      ctx.fillText(
        overflowLabel,
        PAD_LEFT + plotW - ctx.measureText(overflowLabel).width,
        PAD_TOP + plotH + 28,
      );
    }

    const notes: string[] = [];
    if (custom !== null) {
      notes.push(`${custom.bins.length} bins`);
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
    void text;
  }

  private drawBars(
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
    const ctx = this.canvas.getContext("2d");
    if (ctx === null) return;

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
        bar.other === true ? cssVar("--text-dim", "#59636e") : this.multiColor ? CHART_COLORS[index % CHART_COLORS.length] : this.color;
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
      let label = bar.label === "" ? "(blank)" : bar.label;
      while (label.length > 2 && ctx.measureText(label).width > maxLabelW) {
        label = label.slice(0, -2);
      }
      if (label !== (bar.label === "" ? "(blank)" : bar.label)) label = `${label}…`;
      ctx.fillStyle = dim;
      ctx.fillText(label, cx, PAD_TOP + plotH + 14);

      if (bar.other === true) {
        ctx.fillStyle = dim;
        ctx.fillText("rest", cx, PAD_TOP + plotH + 26);
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

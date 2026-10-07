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

/** Category bars use filtered facet counts when present, else static counts. */
export function categoryBars(
  meta: ColumnMeta,
  facetCounts: number[] | undefined,
): { label: string; count: number }[] {
  if (meta.categories === null) return [];
  const counts = facetCounts ?? meta.categories.counts;
  return meta.categories.labels
    .map((label, index) => ({ label, count: counts[index] ?? meta.categories?.counts[index] ?? 0 }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 12);
}

const PAD_LEFT = 46;
const PAD_RIGHT = 14;
const PAD_TOP = 30;
const PAD_BOTTOM = 28;
const MAX_BAR_LABELS = 12;

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
  return name
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-zA-Z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase() || "chart";
}

/**
 * Chart tab inside View: renders the selected column as a histogram (numeric),
 * time series (date) or category bars from the same facet/histogram payloads
 * the filters already receive. Canvas-only (no chart library) so PNG export is
 * just `toBlob`.
 */
export class ChartPanel {
  private readonly controls: HTMLElement;
  private readonly picker: HTMLSelectElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly note: HTMLElement;

  private columns: ColumnMeta[] = [];
  private pickerSignature = "";
  private selected = -1;
  private facets: Record<number, number[]> = {};
  private histograms: Record<number, number[]> = {};
  private rowCount = 0;
  private readonly onResize = (): void => this.render();

  constructor(
    private readonly root: HTMLElement,
    private readonly datasetName: () => string,
  ) {
    this.root.classList.add("chart-host");
    this.picker = el("select", {
      class: "chart-picker",
      "aria-label": "Chart column",
    }) as HTMLSelectElement;
    this.picker.addEventListener("change", () => {
      this.selected = Number(this.picker.value);
      this.render();
    });

    const png = el("button", { class: "ghost small", type: "button", title: "Download this chart as a PNG" }, [
      "Export PNG",
    ]);
    png.addEventListener("click", () => this.exportPng());

    this.controls = el("div", { class: "chart-controls" }, [this.picker, el("span", { class: "grow" }), png]);
    this.canvas = el("canvas", { class: "chart-canvas" }) as HTMLCanvasElement;
    const wrap = el("div", { class: "chart-canvas-wrap" }, [this.canvas]);
    this.note = el("div", { class: "chart-note" });
    this.root.append(this.controls, wrap, this.note);

    window.addEventListener("resize", this.onResize);
  }

  dispose(): void {
    window.removeEventListener("resize", this.onResize);
  }

  setColumns(columns: ColumnMeta[]): void {
    this.columns = columns;
    this.syncPicker();
    this.render();
  }

  setFiltered(
    facets: Record<number, number[]>,
    histograms: Record<number, number[]>,
  ): void {
    this.facets = facets;
    this.histograms = histograms;
    this.syncPicker();
    this.render();
  }

  setRowCount(count: number): void {
    this.rowCount = count;
    this.render();
  }

  refresh(): void {
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
      const option = el("option", { value: String(index) }, [
        `${meta.name} (${TYPE_LABELS[meta.type]})`,
      ]) as HTMLOptionElement;
      this.picker.append(option);
    });

    let restored = previous === undefined ? -1 : this.columns.indexOf(previous);
    if (restored < 0 || chartKindFor(this.columns[restored]?.type ?? "string") === null) {
      restored = this.columns.findIndex((meta) => chartKindFor(meta.type) !== null);
    }
    this.selected = restored;
    if (restored >= 0) this.picker.value = String(restored);
  }

  private exportPng(): void {
    if (typeof this.canvas.toBlob !== "function") return;
    const meta = this.columns[this.selected];
    const name = `${safeFileName(this.datasetName())}-${safeFileName(meta?.name ?? "chart")}.png`;
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
    const height = Math.round(Math.min(360, Math.max(220, width * 0.45)));
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
    const accent = cssVar("--accent", "#2563eb");

    ctx.font = "600 13px system-ui, sans-serif";
    ctx.fillStyle = text;
    ctx.fillText(`${meta.name} · ${TYPE_LABELS[meta.type]}`, PAD_LEFT, 18);
    ctx.font = "11px system-ui, sans-serif";
    ctx.fillStyle = dim;
    ctx.fillText(
      `${this.rowCount.toLocaleString()} rows shown`,
      PAD_LEFT + ctx.measureText(`${meta.name} · ${TYPE_LABELS[meta.type]}`).width + 24,
      18,
    );

    const plotW = width - PAD_LEFT - PAD_RIGHT;
    const plotH = height - PAD_TOP - PAD_BOTTOM;
    if (kind === "bar") this.drawBars(meta, plotW, plotH, accent, text, dim, border);
    else this.drawSeries(meta, kind, plotW, plotH, accent, text, dim, border);
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
    accent: string,
    text: string,
    dim: string,
    border: string,
  ): void {
    const histogram = meta.histogram;
    if (histogram === null || histogram.bins.length === 0) {
      this.note.textContent = "This column has no histogram data yet.";
      return;
    }
    const bins = this.histograms[this.selected] ?? histogram.bins;
    const maxCount = Math.max(1, ...bins);
    const ctx = this.canvas.getContext("2d");
    if (ctx === null) return;

    // Baseline
    ctx.strokeStyle = border;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(PAD_LEFT, PAD_TOP + plotH + 0.5);
    ctx.lineTo(PAD_LEFT + plotW, PAD_TOP + plotH + 0.5);
    ctx.stroke();

    // Y ticks (0 and max)
    ctx.fillStyle = dim;
    ctx.font = "10px system-ui, sans-serif";
    ctx.textAlign = "right";
    ctx.fillText(maxCount.toLocaleString(), PAD_LEFT - 6, PAD_TOP + 8);
    ctx.fillText("0", PAD_LEFT - 6, PAD_TOP + plotH + 3);
    ctx.textAlign = "left";

    if (kind === "histogram") {
      const barW = plotW / bins.length;
      ctx.fillStyle = accent;
      for (let i = 0; i < bins.length; i++) {
        const h = (bins[i] / maxCount) * plotH;
        if (h <= 0) continue;
        ctx.globalAlpha = 0.85;
        ctx.fillRect(PAD_LEFT + i * barW, PAD_TOP + plotH - h, Math.max(1, barW - 1), h);
      }
      ctx.globalAlpha = 1;
    } else {
      ctx.beginPath();
      for (let i = 0; i < bins.length; i++) {
        const x = PAD_LEFT + (i + 0.5) * (plotW / bins.length);
        const y = PAD_TOP + plotH - (bins[i] / maxCount) * plotH;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = accent;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.lineTo(PAD_LEFT + plotW, PAD_TOP + plotH);
      ctx.lineTo(PAD_LEFT, PAD_TOP + plotH);
      ctx.closePath();
      ctx.globalAlpha = 0.18;
      ctx.fillStyle = accent;
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // X axis labels
    ctx.fillStyle = dim;
    ctx.font = "10px system-ui, sans-serif";
    const mid = (histogram.min + histogram.max) / 2;
    ctx.fillText(formatTick(histogram.min, kind), PAD_LEFT, PAD_TOP + plotH + 14);
    const midLabel = formatTick(mid, kind);
    ctx.fillText(midLabel, PAD_LEFT + plotW / 2 - ctx.measureText(midLabel).width / 2, PAD_TOP + plotH + 14);
    const maxLabel = formatTick(histogram.max, kind);
    ctx.fillText(maxLabel, PAD_LEFT + plotW - ctx.measureText(maxLabel).width, PAD_TOP + plotH + 14);

    const notes: string[] = [];
    if (histogram.symlog) notes.push("signed-log scale (heavy tail)");
    const outside = histogram.below + histogram.above;
    if (outside > 0) notes.push(`${outside.toLocaleString()} values beyond the p1–p99 chart range`);
    this.note.textContent = notes.join(" · ");
    void text;
  }

  private drawBars(
    meta: ColumnMeta,
    plotW: number,
    plotH: number,
    accent: string,
    text: string,
    dim: string,
    border: string,
  ): void {
    const bars = categoryBars(meta, this.facets[this.selected]);
    if (bars.length === 0) {
      this.note.textContent = "This column has no category data yet.";
      return;
    }
    const ctx = this.canvas.getContext("2d");
    if (ctx === null) return;

    const maxCount = Math.max(1, ...bars.map((bar) => bar.count));
    const rowH = plotH / bars.length;
    const labelW = Math.min(plotW * 0.42, 200);
    const barsW = plotW - labelW;

    ctx.font = "11px system-ui, sans-serif";
    bars.forEach((bar, index) => {
      const y = PAD_TOP + index * rowH;
      const h = Math.max(6, rowH - 4);
      ctx.fillStyle = accent;
      ctx.globalAlpha = 0.85;
      ctx.fillRect(PAD_LEFT + labelW, y + 2, (bar.count / maxCount) * barsW, h);
      ctx.globalAlpha = 1;

      ctx.fillStyle = text;
      const label = bar.label === "" ? "(blank)" : bar.label;
      let shown = label;
      while (shown.length > 2 && ctx.measureText(shown).width > labelW - 12) {
        shown = shown.slice(0, -2);
      }
      ctx.fillText(shown === label ? label : `${shown}…`, PAD_LEFT, y + h / 2 + 4);

      ctx.fillStyle = dim;
      const count = bar.count.toLocaleString();
      ctx.fillText(count, PAD_LEFT + labelW + (bar.count / maxCount) * barsW + 6, y + h / 2 + 4);
    });

    void border;
    this.note.textContent = `Top ${Math.min(bars.length, MAX_BAR_LABELS)}${
      meta.stats.distinct > bars.length ? ` of ${meta.stats.distinct.toLocaleString()}` : ""
    } categories by count`;
  }
}

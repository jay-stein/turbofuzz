import type { MissingnessMessage } from "../worker/protocol.js";
import { hexToRgb } from "./chart-utils.js";
import { clear, el } from "./dom.js";

/** Matrix height grows with the number of row blocks, capped like a figure. */
const MATRIX_MIN_HEIGHT = 96;
const MATRIX_MAX_HEIGHT = 320;
const BUCKET_HEIGHT = 1.4;
const LABEL_HEIGHT = 14;
const SPARK_GAP = 8;
const MIN_SPARK_BARS = 26;
const MISSING_RGB: readonly [number, number, number] = [63, 70, 80];
const MISSING_RGB_CSS = `rgb(${MISSING_RGB[0]}, ${MISSING_RGB[1]}, ${MISSING_RGB[2]})`;

function cssVar(name: string, fallback: string): string {
  if (typeof getComputedStyle !== "function") return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value === "" ? fallback : value;
}

function fit(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let cut = text;
  while (cut.length > 2 && ctx.measureText(`${cut}…`).width > maxWidth) cut = cut.slice(0, -1);
  return `${cut}…`;
}

export interface NullityProfile {
  /** Missing share per row block, 0–1. */
  ratios: Float64Array;
  /** Columns with at least one missing value per row block. */
  affected: Uint16Array;
  /** Block with the most missing values. */
  maxBucket: number;
  maxRatio: number;
  /** Block with the fewest missing values. */
  minBucket: number;
  minRatio: number;
}

/** Number of rows covered by one sparkline row block (mirrors the worker). */
export function blockRows(totalRows: number, buckets: number, bucket: number): number {
  const start = Math.floor((bucket * totalRows) / buckets);
  const end = Math.max(start + 1, Math.floor(((bucket + 1) * totalRows) / buckets));
  return end - start;
}

/** Row-wise nullity from the binned grid — the sparkline's shape. */
export function nullityProfile(
  cells: ArrayLike<number>,
  buckets: number,
  columns: number,
  totalRows: number,
): NullityProfile {
  const ratios = new Float64Array(buckets);
  const affected = new Uint16Array(buckets);
  let maxBucket = 0;
  let maxRatio = -1;
  let minBucket = 0;
  let minRatio = 2;
  for (let bucket = 0; bucket < buckets; bucket++) {
    let sum = 0;
    let count = 0;
    for (let column = 0; column < columns; column++) {
      const value = cells[bucket * columns + column] ?? 0;
      sum += value;
      if (value > 0) count++;
    }
    affected[bucket] = count;
    const cellsInBlock = blockRows(totalRows, buckets, bucket) * columns;
    const ratio = cellsInBlock === 0 ? 0 : Math.min(1, sum / cellsInBlock);
    ratios[bucket] = ratio;
    if (ratio > maxRatio) {
      maxRatio = ratio;
      maxBucket = bucket;
    }
    if (ratio < minRatio) {
      minRatio = ratio;
      minBucket = bucket;
    }
  }
  return { ratios, affected, maxBucket, minRatio: Math.max(0, minRatio), minBucket, maxRatio };
}

/**
 * Hover text for one row block of the sparkline, e.g.
 * "Rows 2,101–2,125 · 12 missing cells of 300 · 96.0% available". Every number
 * comes from the hovered rows: exact missing cells, the block's cell count and
 * its cell-level availability.
 */
export function bucketTooltip(
  cells: ArrayLike<number>,
  columns: number,
  buckets: number,
  totalRows: number,
  bucket: number,
): string {
  let missingCells = 0;
  for (let column = 0; column < columns; column++) {
    missingCells += cells[bucket * columns + column] ?? 0;
  }
  const start = Math.floor((bucket * totalRows) / buckets);
  const end = Math.max(start + 1, Math.floor(((bucket + 1) * totalRows) / buckets));
  const rows =
    start + 1 === end
      ? `Row ${(start + 1).toLocaleString()}`
      : `Rows ${(start + 1).toLocaleString()}–${end.toLocaleString()}`;
  const totalCells = (end - start) * columns;
  const available = totalCells === 0 ? 100 : (1 - missingCells / totalCells) * 100;
  const availableText = available >= 99.95 ? "100%" : `${available.toFixed(1)}%`;
  return `${rows} · ${missingCells.toLocaleString()} missing ${
    missingCells === 1 ? "cell" : "cells"
  } of ${totalCells.toLocaleString()} · ${availableText} available`;
}

/**
 * Missingno-style map: the whole table as a nullity matrix (blue where data
 * is present, darker where a run of rows has missing values) with a
 * completeness sparkline in the right gutter so the rows with the most and
 * least nullity stand out at a glance.
 */
export class MissingnessChart {
  private readonly root: HTMLElement;
  private readonly wrap: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly caption: HTMLElement;
  private readonly summary: HTMLElement;
  private readonly bars: HTMLElement;
  private readonly mapToggle: HTMLButtonElement;
  private readonly tooltip: HTMLElement;
  private message: MissingnessMessage | null = null;
  private profile: NullityProfile | null = null;
  private geometry: { matrixW: number; matrixHeight: number } | null = null;
  private hoverBucket: number | null = null;
  private observer: ResizeObserver | null = null;
  private queued = false;
  private disposed = false;
  /** A near-complete dataset starts collapsed to one line plus ranked bars. */
  private collapsible = false;
  private expanded = true;

  constructor(root: HTMLElement) {
    this.root = root;
    root.classList.add("overview-section", "missingness-section");
    const head = el("div", { class: "overview-heading-row" });
    head.append(el("h2", { class: "overview-heading" }, ["Missing values"]));
    this.mapToggle = el(
      "button",
      { class: "ghost small", type: "button" },
      ["Show map"],
    ) as HTMLButtonElement;
    this.mapToggle.classList.add("hidden");
    this.mapToggle.addEventListener("click", () => {
      this.expanded = !this.expanded;
      this.syncCollapsed();
      this.schedule();
    });
    head.append(this.mapToggle);
    this.summary = el("div", { class: "missingness-summary" });
    this.bars = el("div", { class: "missingness-bars hidden" });
    const wrap = el("div", { class: "missingness-wrap" });
    this.wrap = wrap;
    this.canvas = el("canvas", {
      class: "missingness-canvas",
      role: "img",
      "aria-label": "Missing values map",
    }) as HTMLCanvasElement;
    this.tooltip = el("div", {
      class: "missingness-tooltip hidden",
      role: "tooltip",
    });
    this.canvas.addEventListener("pointermove", (event) =>
      this.onPointerMove(event as PointerEvent),
    );
    this.canvas.addEventListener("pointerleave", () => this.clearHover());
    wrap.append(this.canvas, this.tooltip);
    this.caption = el("div", { class: "missingness-caption" }, [""]);
    root.append(head, this.summary, this.bars, wrap, this.caption);
    if (typeof ResizeObserver !== "undefined") {
      this.observer = new ResizeObserver(() => this.schedule());
      this.observer.observe(wrap);
    }
  }

  setData(message: MissingnessMessage): void {
    this.message = message;
    const profile = nullityProfile(
      message.cells,
      message.buckets,
      message.columns,
      message.totalRows,
    );
    this.profile = profile;
    this.hoverBucket = null;
    this.tooltip.classList.add("hidden");
    const affected = this.affectedColumns(message);

    let totalMissing = 0;
    const columnTotals = new Float64Array(message.columns);
    for (let bucket = 0; bucket < message.buckets; bucket++) {
      for (let column = 0; column < message.columns; column++) {
        const value = message.cells[bucket * message.columns + column] ?? 0;
        columnTotals[column] += value;
        totalMissing += value;
      }
    }
    const totalCells = message.columns * message.totalRows;
    const complete = totalCells === 0 ? 1 : 1 - totalMissing / totalCells;
    // When the data is essentially complete the full matrix is a wall of one
    // colour; one line plus the few ranked bars carries the same information.
    this.collapsible = affected > 0 && complete >= 0.99;
    this.expanded = !this.collapsible;
    this.renderSummary(complete, totalMissing, affected, columnTotals);

    const parts = [
      `${message.columns.toLocaleString()} columns × ${message.totalRows.toLocaleString()} rows`,
    ];
    if (message.buckets < message.totalRows) {
      const perBlock = Math.max(1, Math.round(message.totalRows / message.buckets));
      parts.push(`≈ ${perBlock.toLocaleString()} rows per block`);
    }
    parts.push("blue = data · grey = missing");
    if (affected > 0) {
      parts.push(
        `${affected.toLocaleString()} ${affected === 1 ? "column" : "columns"} affected`,
      );
    }
    this.caption.textContent = parts.join(" · ");
    const worst =
      profile.maxRatio > 0
        ? `; worst run of rows is ${Math.round(profile.maxRatio * 100)}% missing`
        : "";
    this.canvas.setAttribute(
      "aria-label",
      `Missing values map of ${message.columns} columns and ${message.totalRows} rows` +
        (affected === 0
          ? "; no missing values"
          : affected === 1
            ? `; 1 column has missing values${worst}`
            : `; ${affected} columns have missing values${worst}`),
    );
    this.syncCollapsed();
    this.schedule();
  }

  /** One-line completeness plus the ranked bars shown in the collapsed state. */
  private renderSummary(
    complete: number,
    totalMissing: number,
    affected: number,
    columnTotals: Float64Array,
  ): void {
    const message = this.message;
    if (message === null) return;
    const pct = complete >= 0.99995 ? "100%" : `${(complete * 100).toFixed(1)}%`;
    this.summary.textContent =
      affected === 0
        ? "100% complete · no missing cells"
        : `${pct} complete · ${totalMissing.toLocaleString()} missing ${
            totalMissing === 1 ? "cell" : "cells"
          } in ${affected.toLocaleString()} of ${message.columns.toLocaleString()} columns`;

    clear(this.bars);
    if (!this.collapsible) return;
    const ranked = message.columnNames
      .map((name, index) => ({
        name: name ?? `Column ${index + 1}`,
        count: columnTotals[index] ?? 0,
      }))
      .filter((entry) => entry.count > 0)
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);
    const max = ranked[0]?.count ?? 1;
    for (const entry of ranked) {
      const row = el("div", { class: "missingness-bar-row" });
      row.title = `${entry.name}: ${entry.count.toLocaleString()} missing ${
        entry.count === 1 ? "cell" : "cells"
      }`;
      const track = el("span", { class: "missingness-bar" });
      const fill = el("span", { class: "missingness-bar-fill" });
      fill.style.width = `${Math.max(2, (entry.count / max) * 100)}%`;
      track.append(fill);
      row.append(
        el("span", { class: "missingness-bar-name", title: entry.name }, [entry.name]),
        track,
        el("span", { class: "missingness-bar-count" }, [entry.count.toLocaleString()]),
      );
      this.bars.append(row);
    }
    if (ranked.length < message.columnNames.length) {
      this.bars.append(
        el("div", { class: "missingness-bar-more" }, [
          `${(message.columnNames.length - ranked.length).toLocaleString()} other columns are complete`,
        ]),
      );
    }
  }

  private syncCollapsed(): void {
    const showMap = !this.collapsible || this.expanded;
    this.wrap.classList.toggle("hidden", !showMap);
    this.caption.classList.toggle("hidden", !showMap);
    this.bars.classList.toggle("hidden", !(this.collapsible && !this.expanded));
    this.mapToggle.classList.toggle("hidden", !this.collapsible);
    this.mapToggle.textContent = this.expanded ? "Hide map" : "Show map";
    if (!showMap) this.clearHover();
  }

  dispose(): void {
    this.disposed = true;
    this.observer?.disconnect();
    this.observer = null;
    this.root.remove();
  }

  private affectedColumns(message: MissingnessMessage): number {
    let affected = 0;
    for (let column = 0; column < message.columns; column++) {
      for (let bucket = 0; bucket < message.buckets; bucket++) {
        if (message.cells[bucket * message.columns + column] > 0) {
          affected++;
          break;
        }
      }
    }
    return affected;
  }

  private schedule(): void {
    if (this.queued || this.disposed) return;
    this.queued = true;
    const run = (): void => {
      this.queued = false;
      if (!this.disposed) this.render();
    };
    if (typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(run);
    } else {
      window.setTimeout(run, 16);
    }
  }

  private render(): void {
    const message = this.message;
    if (message === null || message.columns === 0 || message.totalRows === 0) return;
    const wrap = this.canvas.parentElement;
    const wrapWidth = wrap?.clientWidth ?? 0;
    // Skip while the Overview is hidden (display:none) so off-screen draws
    // cannot affect anything else.
    if (wrap === null || wrapWidth <= 0) return;
    const width = Math.max(1, Math.round(wrapWidth));
    const gutter = Math.round(Math.min(96, Math.max(56, width * 0.12)));
    const matrixW = Math.max(40, width - gutter);
    const buckets = message.buckets;
    const matrixHeight = Math.min(
      MATRIX_MAX_HEIGHT,
      Math.max(MATRIX_MIN_HEIGHT, Math.round(buckets * BUCKET_HEIGHT)),
    );
    const showLabels = message.columns <= 32 && matrixW / message.columns >= 26;
    const height = matrixHeight + (showLabels ? LABEL_HEIGHT : 0);
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    const ctx = this.canvas.getContext("2d");
    if (ctx === null) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.geometry = { matrixW, matrixHeight };

    const data = hexToRgb(cssVar("--accent", "#2563eb"));
    const cellW = matrixW / message.columns;
    const cellH = matrixHeight / buckets;

    for (let bucket = 0; bucket < buckets; bucket++) {
      const y = bucket * cellH;
      const rowsInBucket = Math.max(1, blockRows(message.totalRows, buckets, bucket));
      for (let column = 0; column < message.columns; column++) {
        const ratio = Math.min(
          1,
          (message.cells[bucket * message.columns + column] ?? 0) / rowsInBucket,
        );
        const channel = (index: number): number =>
          Math.round(data[index] + (MISSING_RGB[index] - data[index]) * ratio);
        ctx.fillStyle = `rgb(${channel(0)}, ${channel(1)}, ${channel(2)})`;
        ctx.fillRect(column * cellW, y, cellW + 0.5, cellH + 0.5);
      }
    }

    // Thin separators keep the column bands readable, like missingno's lines.
    if (cellW >= 6) {
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = cssVar("--panel", "#ffffff");
      for (let column = 1; column < message.columns; column++) {
        ctx.fillRect(column * cellW, 0, 1, matrixHeight);
      }
      ctx.globalAlpha = 1;
    }

    this.drawSparkline(ctx, message, matrixW, gutter, matrixHeight);

    if (!showLabels) return;
    ctx.font = "10px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillStyle = cssVar("--text-dim", "#62707f");
    message.columnNames.forEach((name, column) => {
      ctx.fillText(
        fit(ctx, name, Math.max(8, cellW - 4)),
        (column + 0.5) * cellW,
        matrixHeight + 11,
      );
    });
    ctx.textAlign = "left";
  }

  /**
   * Sparkline: the per-block nullity profile drawn as a line chart in the
   * right gutter, with one filled accent marker on the worst run of rows and
   * a ringed marker wherever the pointer is. No axis text — the tooltip,
   * caption and aria label carry the numbers.
   */
  private drawSparkline(
    ctx: CanvasRenderingContext2D,
    message: MissingnessMessage,
    matrixW: number,
    gutter: number,
    matrixHeight: number,
  ): void {
    const profile =
      this.profile ??
      nullityProfile(message.cells, message.buckets, message.columns, message.totalRows);
    if (profile.maxRatio <= 0) return;
    const barsX = matrixW + SPARK_GAP;
    const barsW = Math.max(MIN_SPARK_BARS, gutter - SPARK_GAP * 2);
    const cellH = matrixHeight / message.buckets;
    const span = profile.maxRatio - profile.minRatio;
    const xOf = (ratio: number): number =>
      barsX + barsW * (span > 0 ? (ratio - profile.minRatio) / span : 0);
    const yOf = (bucket: number): number => bucket * cellH + cellH / 2;

    ctx.beginPath();
    for (let bucket = 0; bucket < message.buckets; bucket++) {
      const x = xOf(profile.ratios[bucket]);
      const y = yOf(bucket);
      if (bucket === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = MISSING_RGB_CSS;
    ctx.globalAlpha = 0.75;
    ctx.lineWidth = 1.2;
    ctx.lineJoin = "round";
    ctx.stroke();
    ctx.globalAlpha = 1;

    // One filled marker: the row block with the most missing values.
    ctx.fillStyle = cssVar("--accent", "#2563eb");
    ctx.beginPath();
    ctx.arc(xOf(profile.maxRatio), yOf(profile.maxBucket), Math.max(2.6, cellH * 0.9), 0, Math.PI * 2);
    ctx.fill();

    // Hover marker: a ringed dot at the block under the pointer.
    if (this.hoverBucket !== null && this.hoverBucket < message.buckets) {
      ctx.beginPath();
      ctx.arc(
        xOf(profile.ratios[this.hoverBucket]),
        yOf(this.hoverBucket),
        Math.max(3.2, cellH * 1.2),
        0,
        Math.PI * 2,
      );
      ctx.fillStyle = cssVar("--accent", "#2563eb");
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = cssVar("--panel", "#ffffff");
      ctx.stroke();
    }
  }

  /** Row-block hover in the sparkline gutter: tooltip plus a ringed marker. */
  private onPointerMove(event: PointerEvent): void {
    const message = this.message;
    const geometry = this.geometry;
    if (message === null || geometry === null) return;
    const rect = this.canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    if (
      x < geometry.matrixW ||
      y < 0 ||
      y > geometry.matrixHeight ||
      message.buckets === 0
    ) {
      this.clearHover();
      return;
    }
    const bucket = Math.max(
      0,
      Math.min(message.buckets - 1, Math.floor((y / geometry.matrixHeight) * message.buckets)),
    );
    this.tooltip.textContent = bucketTooltip(
      message.cells,
      message.columns,
      message.buckets,
      message.totalRows,
      bucket,
    );
    this.tooltip.classList.remove("hidden");
    this.positionTooltip(event);
    if (this.hoverBucket !== bucket) {
      this.hoverBucket = bucket;
      this.schedule();
    }
  }

  private clearHover(): void {
    if (this.hoverBucket === null && this.tooltip.classList.contains("hidden")) return;
    this.hoverBucket = null;
    this.tooltip.classList.add("hidden");
    this.schedule();
  }

  private positionTooltip(event: PointerEvent): void {
    const wrap = this.canvas.parentElement;
    if (wrap === null) return;
    const rect = wrap.getBoundingClientRect();
    const width = this.tooltip.offsetWidth;
    const left = Math.min(
      Math.max(4, event.clientX - rect.left + 12),
      Math.max(4, wrap.clientWidth - width - 4),
    );
    const top = Math.max(4, event.clientY - rect.top + 14);
    this.tooltip.style.left = `${left}px`;
    this.tooltip.style.top = `${top}px`;
  }
}

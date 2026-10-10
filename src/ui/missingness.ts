import type { MissingnessMessage } from "../worker/protocol.js";
import { hexToRgb } from "./chart-utils.js";
import { el } from "./dom.js";

const MATRIX_HEIGHT = 96;
const LABEL_HEIGHT = 14;
const MISSING_RGB: readonly [number, number, number] = [63, 70, 80];

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

/**
 * Missingno-style map: the whole table zoomed out, one block per run of rows,
 * blue where data is present and darker where the run has missing values.
 * Deliberately small and quiet — it sits on the Overview between the health
 * tiles and the next steps.
 */
export class MissingnessChart {
  private readonly canvas: HTMLCanvasElement;
  private readonly caption: HTMLElement;
  private message: MissingnessMessage | null = null;
  private observer: ResizeObserver | null = null;
  private queued = false;
  private disposed = false;

  constructor(private readonly root: HTMLElement) {
    root.classList.add("overview-section", "missingness-section");
    root.append(el("h2", { class: "overview-heading" }, ["Missing values"]));
    const wrap = el("div", { class: "missingness-wrap" });
    this.canvas = el("canvas", {
      class: "missingness-canvas",
      role: "img",
      "aria-label": "Missing values map",
    }) as HTMLCanvasElement;
    wrap.append(this.canvas);
    this.caption = el("div", { class: "missingness-caption" }, [""]);
    root.append(wrap, this.caption);
    if (typeof ResizeObserver !== "undefined") {
      this.observer = new ResizeObserver(() => this.schedule());
      this.observer.observe(wrap);
    }
  }

  setData(message: MissingnessMessage): void {
    this.message = message;
    const affected = this.affectedColumns(message);
    const parts = [
      `${message.columns.toLocaleString()} columns × ${message.totalRows.toLocaleString()} rows`,
      "blue = data · grey = missing",
    ];
    if (affected > 0) {
      parts.push(
        `${affected.toLocaleString()} ${affected === 1 ? "column" : "columns"} affected`,
      );
    }
    this.caption.textContent = parts.join(" · ");
    this.canvas.setAttribute(
      "aria-label",
      `Missing values map of ${message.columns} columns and ${message.totalRows} rows` +
        (affected === 0
          ? "; no missing values"
          : affected === 1
            ? "; 1 column has missing values"
            : `; ${affected} columns have missing values`),
    );
    this.schedule();
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
    const width = Math.max(1, Math.round(wrap?.clientWidth ?? 640));
    const showLabels = message.columns <= 32 && width / message.columns >= 26;
    const height = MATRIX_HEIGHT + (showLabels ? LABEL_HEIGHT : 0);
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    const ctx = this.canvas.getContext("2d");
    if (ctx === null) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const data = hexToRgb(cssVar("--accent", "#2563eb"));
    const cellW = width / message.columns;
    const cellH = MATRIX_HEIGHT / message.buckets;
    for (let bucket = 0; bucket < message.buckets; bucket++) {
      const y = bucket * cellH;
      for (let column = 0; column < message.columns; column++) {
        const ratio = (message.cells[bucket * message.columns + column] ?? 0) / 255;
        const channel = (index: number): number =>
          Math.round(data[index] + (MISSING_RGB[index] - data[index]) * ratio);
        ctx.fillStyle = `rgb(${channel(0)}, ${channel(1)}, ${channel(2)})`;
        ctx.fillRect(column * cellW, y, cellW + 0.5, cellH + 0.5);
      }
    }

    if (!showLabels) return;
    ctx.font = "10px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillStyle = cssVar("--text-dim", "#62707f");
    message.columnNames.forEach((name, column) => {
      ctx.fillText(
        fit(ctx, name, Math.max(8, cellW - 4)),
        (column + 0.5) * cellW,
        MATRIX_HEIGHT + 11,
      );
    });
    ctx.textAlign = "left";
  }
}

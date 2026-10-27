import type { AggregateMessage } from "../worker/protocol.js";
import type { HitAction, HitRegion } from "./chart-card.js";
import {
  dotAxis,
  dotPlotRows,
  foldGroups,
  panelGrid,
  roundLabel,
  shareRows,
  slopeLines,
  spreadLabels,
  splitMatrix,
  waterfallSteps,
} from "./chart-extra.js";
import { formatChartNumber, niceTicks } from "./chart-utils.js";

/** The slice of the card's frame these renderers need. */
export interface PlotFrame {
  ui: number;
  left: number;
  top: number;
  plotW: number;
  plotH: number;
  text: string;
  dim: string;
  border: string;
}

/** What the card lends the renderers: its fonts, palette and filter actions. */
export interface Painter {
  font(ctx: CanvasRenderingContext2D, ui: number, size: number, weight?: string): void;
  fit(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string;
  groupColor(index: number): string;
  primaryColor(): string;
  /** Click actions that filter the table to one value of the chart's column. */
  actionsFor(label: string): HitAction[];
}

export interface Drawn {
  hits: HitRegion[];
  note: string;
}

const UP = "#15803d";
const DOWN = "#b42318";

const signed = (value: number): string => `${value > 0 ? "+" : value < 0 ? "−" : ""}${formatChartNumber(Math.abs(value))}`;
const percent = (share: number): string => `${Math.round(share * 100)}%`;

function gridX(ctx: CanvasRenderingContext2D, frame: PlotFrame, p: Painter, x0: number, w: number, min: number, max: number, format: (v: number) => string): void {
  const ticks = niceTicks(min, max, 4).filter((v) => v >= min - 1e-9 && v <= max + 1e-9);
  ctx.strokeStyle = frame.border;
  ctx.fillStyle = frame.dim;
  ctx.lineWidth = 1;
  p.font(ctx, frame.ui, 10);
  ctx.textAlign = "center";
  for (const value of ticks) {
    const x = x0 + ((value - min) / (max - min || 1)) * w;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(x + 0.5, frame.top);
    ctx.lineTo(x + 0.5, frame.top + frame.plotH);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillText(format(value), x, frame.top + frame.plotH + 14 * frame.ui);
  }
  ctx.textAlign = "left";
}

function legend(ctx: CanvasRenderingContext2D, frame: PlotFrame, p: Painter, labels: readonly string[]): void {
  let x = frame.left;
  let shown = 0;
  p.font(ctx, frame.ui, 10);
  for (let i = 0; i < labels.length; i++) {
    const width = ctx.measureText(labels[i]).width + 26 * frame.ui;
    if (x + width > frame.left + frame.plotW) break;
    ctx.fillStyle = p.groupColor(i);
    ctx.fillRect(x, frame.top - 14 * frame.ui, 8 * frame.ui, 8 * frame.ui);
    ctx.fillStyle = frame.dim;
    ctx.fillText(labels[i], x + 12 * frame.ui, frame.top - 6 * frame.ui);
    x += width;
    shown++;
  }
  if (shown < labels.length) {
    ctx.fillStyle = frame.dim;
    ctx.fillText(`+${labels.length - shown} more`, x, frame.top - 6 * frame.ui);
  }
}

/* ----------------------------------------------------------------- dot plot */

/** Dots on a horizontal axis, largest first. A dot needs no zero baseline. */
export function drawDotPlot(ctx: CanvasRenderingContext2D, frame: PlotFrame, p: Painter, result: AggregateMessage, values: ArrayLike<number>): Drawn {
  const ui = frame.ui;
  const measure = result.measureNames[0] ?? "value";
  const cap = Math.max(5, Math.min(30, Math.floor(frame.plotH / (16 * ui))));
  const rows = dotPlotRows(result.labels, values, result.groupCount, cap);
  p.font(ctx, ui, 10);
  const labelW = Math.min(frame.plotW * 0.32, Math.max(40 * ui, ...rows.map((r) => ctx.measureText(r.label || "(blank)").width + 12 * ui)));
  const x0 = frame.left + labelW;
  const w = frame.plotW - labelW - 24 * ui;
  const axis = dotAxis(rows.map((r) => r.value));
  gridX(ctx, frame, p, x0, w, axis.min, axis.max, formatChartNumber);
  const rowH = frame.plotH / Math.max(1, rows.length);
  const radius = Math.max(3 * ui, Math.min(6 * ui, rowH * 0.28));
  const hits: HitRegion[] = [];
  rows.forEach((row, i) => {
    const cy = frame.top + (i + 0.5) * rowH;
    const cx = x0 + ((row.value - axis.min) / (axis.max - axis.min || 1)) * w;
    ctx.strokeStyle = frame.border;
    ctx.beginPath();
    ctx.moveTo(x0, cy + 0.5);
    ctx.lineTo(x0 + w, cy + 0.5);
    ctx.stroke();
    ctx.fillStyle = p.primaryColor();
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = frame.text;
    p.font(ctx, ui, 10);
    ctx.textAlign = "right";
    ctx.fillText(p.fit(ctx, row.label || "(blank)", labelW - 8 * ui), x0 - 8 * ui, cy + 3 * ui);
    ctx.textAlign = "left";
    ctx.fillStyle = frame.dim;
    const text = formatChartNumber(roundLabel(row.value));
    const fitsRight = cx + radius + 4 * ui + ctx.measureText(text).width < frame.left + frame.plotW;
    ctx.fillText(text, fitsRight ? cx + radius + 4 * ui : cx - radius - 4 * ui - ctx.measureText(text).width, cy + 3 * ui);
    hits.push({
      x: frame.left,
      y: frame.top + i * rowH,
      w: frame.plotW,
      h: rowH,
      lines: [row.label || "(blank)", `${measure}: ${formatChartNumber(row.value)}`],
      actions: p.actionsFor(row.label),
    });
  });
  ctx.fillStyle = frame.dim;
  p.font(ctx, ui, 10);
  ctx.fillText(measure, frame.left, frame.top - 6 * ui);
  const shown = rows.length;
  const total = result.groupCount;
  const base = axis.fromZero ? "" : ` · axis starts at ${formatChartNumber(roundLabel(axis.min))}, not zero`;
  return { hits, note: `${shown}${total > shown ? ` of ${total}` : ""} groups · ${measure}, largest first${base}` };
}

/* ---------------------------------------------------------- 100% stacked bar */

/** Horizontal bars where every row sums to 100%: the share of each segment. */
export function drawStacked100(ctx: CanvasRenderingContext2D, frame: PlotFrame, p: Painter, result: AggregateMessage, values: ArrayLike<number>, segmentLimit: number): Drawn {
  const ui = frame.ui;
  const measure = result.measureNames[0] ?? "value";
  const matrix = foldGroups(splitMatrix(result.dimensions[0] ?? [], result.dimensions[1] ?? [], values, result.groupCount), segmentLimit);
  const all = shareRows(matrix).sort((a, b) => b.total - a.total);
  const cap = Math.max(4, Math.min(24, Math.floor(frame.plotH / (18 * ui))));
  const rows = all.slice(0, cap);
  p.font(ctx, ui, 10);
  const labelW = Math.min(frame.plotW * 0.3, Math.max(40 * ui, ...rows.map((r) => ctx.measureText(r.label || "(blank)").width + 12 * ui)));
  const x0 = frame.left + labelW;
  const w = frame.plotW - labelW;
  gridX(ctx, frame, p, x0, w, 0, 1, percent);
  const rowH = frame.plotH / Math.max(1, rows.length);
  const barH = Math.max(3, rowH * 0.7);
  const hits: HitRegion[] = [];
  rows.forEach((row, i) => {
    const y = frame.top + i * rowH + (rowH - barH) / 2;
    let x = x0;
    ctx.fillStyle = frame.text;
    p.font(ctx, ui, 10);
    ctx.textAlign = "right";
    ctx.fillText(p.fit(ctx, row.label || "(blank)", labelW - 8 * ui), x0 - 8 * ui, y + barH / 2 + 3 * ui);
    ctx.textAlign = "left";
    row.shares.forEach((share, g) => {
      if (share <= 0) return;
      const segW = share * w;
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = p.groupColor(g);
      ctx.fillRect(x, y, Math.max(0.5, segW - 1), barH);
      ctx.globalAlpha = 1;
      if (segW > 34 * ui) {
        ctx.fillStyle = "#ffffff";
        p.font(ctx, ui, 10);
        ctx.fillText(percent(share), x + 4 * ui, y + barH / 2 + 3 * ui);
      }
      x += segW;
    });
    hits.push({
      x: frame.left,
      y: frame.top + i * rowH,
      w: frame.plotW,
      h: rowH,
      lines: [
        row.label || "(blank)",
        ...row.shares.map((share, g) => `${matrix.groups[g]}: ${percent(share)}`).filter((_, g) => row.shares[g] > 0),
      ],
      actions: p.actionsFor(row.label),
    });
  });
  legend(ctx, frame, p, matrix.groups);
  const more = all.length > rows.length ? ` · ${rows.length} of ${all.length} rows, largest first` : "";
  return { hits, note: `Share of ${measure} by ${result.dimensionNames[1] ?? "group"} within each ${result.dimensionNames[0] ?? "row"}${more}` };
}

/* ----------------------------------------------------------- small multiples */

/** One small line chart per group, each on its own scale. */
export function drawSmallMultiples(ctx: CanvasRenderingContext2D, frame: PlotFrame, p: Painter, result: AggregateMessage, values: ArrayLike<number>, panelLimit: number): Drawn {
  const ui = frame.ui;
  const measure = result.measureNames[0] ?? "value";
  const matrix = splitMatrix(result.dimensions[0] ?? [], result.dimensions[1] ?? [], values, result.groupCount);
  const shownCount = Math.max(1, Math.min(panelLimit, matrix.groups.length));
  const { cells } = panelGrid(shownCount, frame.plotW, frame.plotH, 12 * ui);
  const hits: HitRegion[] = [];
  const buckets = matrix.buckets.length;
  for (let g = 0; g < shownCount; g++) {
    const cell = cells[g];
    const series = matrix.values[g];
    const x = frame.left + cell.x;
    const y = frame.top + cell.y;
    const titleH = 14 * ui;
    const footH = cell.h > 70 * ui ? 12 * ui : 0;
    const plotY = y + titleH;
    const plotH = Math.max(8, cell.h - titleH - footH);
    const finite = [...series].filter((v) => Number.isFinite(v));
    const lo = Math.min(0, ...finite);
    const hi = Math.max(...finite, lo + 1);
    ctx.strokeStyle = frame.border;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, plotY + plotH + 0.5);
    ctx.lineTo(x + cell.w, plotY + plotH + 0.5);
    ctx.stroke();
    ctx.fillStyle = frame.text;
    p.font(ctx, ui, 10, "600");
    ctx.fillText(p.fit(ctx, matrix.groups[g], cell.w * 0.6), x, y + 10 * ui);
    const px = (b: number): number => x + (buckets <= 1 ? cell.w / 2 : (b / (buckets - 1)) * cell.w);
    const py = (v: number): number => plotY + plotH - ((v - lo) / (hi - lo || 1)) * plotH;
    ctx.strokeStyle = p.groupColor(g);
    ctx.lineWidth = 2;
    ctx.beginPath();
    let started = false;
    let lastFinite = -1;
    for (let b = 0; b < buckets; b++) {
      const v = series[b];
      if (!Number.isFinite(v)) {
        started = false;
        continue;
      }
      lastFinite = b;
      if (started) ctx.lineTo(px(b), py(v));
      else ctx.moveTo(px(b), py(v));
      started = true;
    }
    ctx.stroke();
    if (lastFinite >= 0) {
      ctx.fillStyle = p.groupColor(g);
      ctx.beginPath();
      ctx.arc(px(lastFinite), py(series[lastFinite]), 2.5 * ui, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = frame.dim;
      p.font(ctx, ui, 10);
      ctx.textAlign = "right";
      ctx.fillText(formatChartNumber(series[lastFinite]), x + cell.w, y + 10 * ui);
      ctx.textAlign = "left";
    }
    if (footH > 0) {
      ctx.fillStyle = frame.dim;
      p.font(ctx, ui, 9);
      ctx.fillText(p.fit(ctx, matrix.buckets[0] ?? "", cell.w / 2), x, y + cell.h - 1);
      ctx.textAlign = "right";
      ctx.fillText(p.fit(ctx, matrix.buckets[buckets - 1] ?? "", cell.w / 2), x + cell.w, y + cell.h - 1);
      ctx.textAlign = "left";
    }
    hits.push({
      x,
      y,
      w: cell.w,
      h: cell.h,
      lines: [
        matrix.groups[g],
        `${measure}: ${lastFinite >= 0 ? formatChartNumber(series[lastFinite]) : "—"} (latest)`,
        finite.length > 0 ? `range ${formatChartNumber(Math.min(...finite))} to ${formatChartNumber(Math.max(...finite))}` : "no data",
      ],
      actions: [],
    });
  }
  const more = matrix.groups.length > shownCount ? ` · ${shownCount} of ${matrix.groups.length} panels, largest first` : "";
  return { hits, note: `${measure} by ${result.dimensionNames[1] ?? "group"} over ${result.dimensionNames[0] ?? "time"} · each panel has its own scale${more}` };
}

/* ---------------------------------------------------------------- slopegraph */

/** Two moments, one line per group: who rose, who fell, and by how much. */
export function drawSlopegraph(ctx: CanvasRenderingContext2D, frame: PlotFrame, p: Painter, result: AggregateMessage, values: ArrayLike<number>, lineLimit: number): Drawn {
  const ui = frame.ui;
  const measure = result.measureNames[0] ?? "value";
  const matrix = splitMatrix(result.dimensions[0] ?? [], result.dimensions[1] ?? [], values, result.groupCount);
  // Edge periods flagged incomplete would make a misleading "before" or "after".
  const incomplete = new Set<string>();
  result.partials?.forEach((partial, i) => {
    if (partial) incomplete.add(result.dimensions[0]?.[i] ?? "");
  });
  const slope = slopeLines(matrix, incomplete);
  if (slope.lines.length === 0) return { hits: [], note: "A slopegraph needs at least two points to compare, and each line needs both." };
  const lines = slope.lines.slice(0, Math.max(2, lineLimit));
  const all = lines.flatMap((l) => [l.from, l.to]);
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  const pad = (hi - lo || Math.abs(hi) || 1) * 0.06;
  const top = frame.top + 14 * ui;
  const bottom = frame.top + frame.plotH;
  const yOf = (v: number): number => bottom - ((v - (lo - pad)) / (hi - lo + 2 * pad || 1)) * (bottom - top);
  const xl = frame.left + frame.plotW * 0.34;
  const xr = frame.left + frame.plotW * 0.66;
  ctx.strokeStyle = frame.border;
  ctx.lineWidth = 1;
  for (const x of [xl, xr]) {
    ctx.beginPath();
    ctx.moveTo(x + 0.5, top - 4 * ui);
    ctx.lineTo(x + 0.5, bottom);
    ctx.stroke();
  }
  p.font(ctx, ui, 11, "600");
  ctx.fillStyle = frame.text;
  ctx.textAlign = "center";
  ctx.fillText(p.fit(ctx, slope.from, frame.plotW * 0.3), xl, frame.top + 4 * ui);
  ctx.fillText(p.fit(ctx, slope.to, frame.plotW * 0.3), xr, frame.top + 4 * ui);
  ctx.textAlign = "left";
  const gap = 12 * ui;
  const leftY = spreadLabels(lines.map((l) => yOf(l.from)), gap, top, bottom);
  const rightY = spreadLabels(lines.map((l) => yOf(l.to)), gap, top, bottom);
  const hits: HitRegion[] = [];
  lines.forEach((line, i) => {
    const colour = p.groupColor(i);
    ctx.strokeStyle = colour;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(xl, yOf(line.from));
    ctx.lineTo(xr, yOf(line.to));
    ctx.stroke();
    ctx.fillStyle = colour;
    for (const [x, v] of [[xl, line.from], [xr, line.to]] as const) {
      ctx.beginPath();
      ctx.arc(x, yOf(v), 3 * ui, 0, Math.PI * 2);
      ctx.fill();
    }
    p.font(ctx, ui, 10);
    ctx.fillStyle = frame.text;
    ctx.textAlign = "right";
    ctx.fillText(p.fit(ctx, `${line.label}  ${formatChartNumber(roundLabel(line.from))}`, xl - frame.left - 10 * ui), xl - 8 * ui, leftY[i] + 3 * ui);
    ctx.textAlign = "left";
    ctx.fillText(p.fit(ctx, `${formatChartNumber(roundLabel(line.to))}  ${line.label}`, frame.left + frame.plotW - xr - 10 * ui), xr + 8 * ui, rightY[i] + 3 * ui);
    const change = line.to - line.from;
    const relative = line.from !== 0 ? ` (${change >= 0 ? "+" : "−"}${Math.abs(Math.round((change / Math.abs(line.from)) * 100))}%)` : "";
    const tip = [line.label, `${slope.from}: ${formatChartNumber(roundLabel(line.from))}`, `${slope.to}: ${formatChartNumber(roundLabel(line.to))}`, `change: ${signed(change)}${relative}`];
    hits.push({ x: frame.left, y: leftY[i] - gap / 2, w: xl - frame.left, h: gap, lines: tip, actions: [] });
    hits.push({ x: xr, y: rightY[i] - gap / 2, w: frame.left + frame.plotW - xr, h: gap, lines: tip, actions: [] });
  });
  ctx.fillStyle = frame.dim;
  p.font(ctx, ui, 10);
  ctx.fillText(measure, frame.left, frame.top - 6 * ui);
  const parts = [`${measure} by ${result.dimensionNames[1] ?? "group"}`, slope.periods > 2 ? `${slope.from} vs ${slope.to} (${slope.periods} periods, ends chosen where lines have data)` : `${slope.from} vs ${slope.to}`];
  if (slope.lines.length > lines.length) parts.push(`${lines.length} of ${slope.lines.length} lines`);
  if (slope.skipped > 0) parts.push(`${slope.skipped} left out (missing an end)`);
  return { hits, note: parts.join(" · ") };
}

/* ------------------------------------------------------------------ waterfall */

/** A running total: each step floats from where the last one ended. */
export function drawWaterfall(ctx: CanvasRenderingContext2D, frame: PlotFrame, p: Painter, result: AggregateMessage, values: ArrayLike<number>, stepLimit: number): Drawn {
  const ui = frame.ui;
  const measure = result.measureNames[0] ?? "value";
  const count = Math.min(result.groupCount, Math.max(2, stepLimit));
  const steps = waterfallSteps(result.labels, values, count);
  const levels = steps.flatMap((s) => [s.start, s.end]);
  const lo = Math.min(0, ...levels);
  const hi = Math.max(0, ...levels);
  const span = hi - lo || 1;
  const yOf = (v: number): number => frame.top + frame.plotH - ((v - lo) / span) * frame.plotH;
  const ticks = niceTicks(lo, hi, 4).filter((v) => v >= lo - 1e-9 && v <= hi + 1e-9);
  ctx.strokeStyle = frame.border;
  ctx.fillStyle = frame.dim;
  ctx.lineWidth = 1;
  p.font(ctx, ui, 10);
  ctx.textAlign = "right";
  for (const value of ticks) {
    const y = yOf(value);
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(frame.left, y + 0.5);
    ctx.lineTo(frame.left + frame.plotW, y + 0.5);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillText(formatChartNumber(value), frame.left - 6 * ui, y + 3 * ui);
  }
  ctx.textAlign = "left";
  const zeroY = yOf(0);
  ctx.strokeStyle = frame.dim;
  ctx.beginPath();
  ctx.moveTo(frame.left, zeroY + 0.5);
  ctx.lineTo(frame.left + frame.plotW, zeroY + 0.5);
  ctx.stroke();
  const slot = frame.plotW / steps.length;
  const barW = Math.max(2, slot * 0.7);
  const hits: HitRegion[] = [];
  let lastEnd = 0;
  steps.forEach((step, i) => {
    const x = frame.left + i * slot + (slot - barW) / 2;
    const y0 = yOf(step.start);
    const y1 = yOf(step.end);
    const top = Math.min(y0, y1);
    const height = Math.max(1, Math.abs(y1 - y0));
    if (i > 0) {
      ctx.strokeStyle = frame.dim;
      ctx.setLineDash([2, 3]);
      ctx.beginPath();
      ctx.moveTo(x - (slot - barW), yOf(lastEnd) + 0.5);
      ctx.lineTo(x, yOf(lastEnd) + 0.5);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = step.total ? p.primaryColor() : step.delta >= 0 ? UP : DOWN;
    ctx.fillRect(x, top, barW, height);
    ctx.globalAlpha = 1;
    ctx.fillStyle = frame.dim;
    p.font(ctx, ui, 10);
    ctx.textAlign = "center";
    const text = step.total ? formatChartNumber(step.end) : signed(step.delta);
    if (slot > ctx.measureText(text).width + 2 * ui) {
      const above = step.total || step.delta >= 0;
      ctx.fillText(text, x + barW / 2, above ? top - 3 * ui : top + height + 11 * ui);
    }
    ctx.textAlign = "left";
    lastEnd = step.end;
    hits.push({
      x: frame.left + i * slot,
      y: frame.top,
      w: slot,
      h: frame.plotH,
      lines: step.total
        ? ["Total", `${measure}: ${formatChartNumber(step.end)}`]
        : [step.label || "(blank)", `change: ${signed(step.delta)}`, `running total: ${formatChartNumber(step.end)}`],
      actions: step.total ? [] : p.actionsFor(step.label),
    });
  });
  ctx.fillStyle = frame.dim;
  ctx.textAlign = "center";
  p.font(ctx, ui, 10);
  const every = Math.max(1, Math.ceil(steps.length / 8));
  for (let i = 0; i < steps.length; i += every) {
    ctx.fillText(p.fit(ctx, steps[i].label || "(blank)", Math.max(16, slot * every - 4 * ui)), frame.left + (i + 0.5) * slot, frame.top + frame.plotH + 14 * ui);
  }
  ctx.textAlign = "left";
  ctx.fillText(measure, frame.left, frame.top - 6 * ui);
  const more = result.groupCount > count ? ` · first ${count} of ${result.groupCount} steps` : "";
  return { hits, note: `${measure}: each step adds to the running total (green up, red down)${more}` };
}

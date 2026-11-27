/**
 * Line charts of any ordered x, the way seaborn's lineplot draws them. A Line over dates keeps its
 * time-series path (periods, gaps, calendar ticks); with numbers or categories on x it comes here:
 * the rows at each x are summarised (the average by default, or the Value's statistic) with a band
 * round the line (a 95% confidence interval at first; standard error, standard deviation or the
 * middle 95% of the rows instead), one line per Group by value, and dots at the points when they
 * are few enough to read.
 */
import type { ChartCard } from "./chart-card.js";
import type { Frame } from "./chart-card-types.js";
import type { HitRegion } from "./chart-hit-regions.js";
import type { ColumnMeta } from "../worker/protocol.js";
import { ROW_ORDER, type RelLineBand, type RelLineStat } from "../data/rel-line.js";
import { INTERVAL_KINDS } from "../data/error-bars.js";
import { formatChartNumber, formatCompact, isGroupable, isNumericType, plainMeasureName } from "./chart-utils.js";
import { axisTicks } from "./chart-axes.js";
import { markColor } from "./chart-mark-colors.js";
import { refAxisRange, setRefAxis } from "./chart-ref-lines.js";

/** Lines drawn at most; more Group by values are counted in the note. */
const MAX_HUES = 8;
/** Up to this many points per line get a dot unless the person says otherwise. */
const AUTO_MARKERS = 30;

/** The x axis name of a Line in row order. */
export const ROW_ORDER_NAME = "Row";

/** A Line whose x is numbers, categories or row order (not dates) is drawn here. */
export function relLineOn(card: ChartCard): boolean {
  if (card.config.kind !== "line" || card.config.source !== "") return false;
  if (card.config.column === ROW_ORDER) return true;
  const meta = card.meta(card.config.column);
  return meta !== undefined && !card.isDateLike(meta) && (isNumericType(meta.type) || isGroupable(meta));
}

/** A column a Line can run along: dates as before, and now numbers and categories too. */
export function lineAxisAllowed(card: ChartCard, meta: ColumnMeta | undefined): boolean {
  if (meta === undefined) return false;
  return card.isDateLike(meta) || isNumericType(meta.type) || isGroupable(meta);
}

function stat(card: ChartCard): RelLineStat {
  if ((card.config.valueColumn ?? -1) < 0) return "count";
  const agg = card.config.valueAgg ?? "mean";
  return agg === "median" || agg === "sum" || agg === "min" || agg === "max" || agg === "count" ? agg : "mean";
}

/** The band asked for: on at first (seaborn draws one), the Error bars choice otherwise; bootstrap uses the formula. */
export function relBand(card: ChartCard): RelLineBand {
  // In row order each point is one row: there is nothing to put a band round.
  if (card.config.errorBars === false || (card.config.valueColumn ?? -1) < 0 || card.config.column === ROW_ORDER) return "none";
  const kind = card.config.errorBarKind ?? "ci";
  return kind === "bootstrap" ? "ci" : kind;
}

export function refreshRelLine(card: ChartCard): void {
  const request = card.options.requestRelLine;
  const generation = ++card.relLineGeneration;
  if (!relLineOn(card) || request === undefined) {
    card.relLineResult = null;
    return;
  }
  void request({
    xColumn: card.config.column,
    yColumn: card.config.valueColumn ?? -1,
    hueColumn: card.config.groupColumn ?? -1,
    stat: stat(card),
    band: relBand(card),
    maxHues: MAX_HUES,
    ...card.chartScope(),
  })
    .then((message) => {
      if (generation !== card.relLineGeneration || card.disposed) return;
      card.relLineResult = message;
      // "Dots" follows how many points there are until the person sets it.
      card.syncErrorBarControls();
      card.render();
    })
    .catch(() => {
      // Keep the last line.
    });
}

/** Axis names: x is the column, y the statistic of the Value (or Rows). */
export function relLineAxisLabels(card: ChartCard): { x: string | null; y: string | null } {
  const rowOrder = card.config.column === ROW_ORDER;
  const x = rowOrder ? ROW_ORDER_NAME : (card.meta(card.config.column)?.name ?? null);
  const value = card.meta(card.config.valueColumn ?? -1)?.name;
  // One row per point: the value itself, not "Average of".
  const y = value === undefined ? "Rows" : rowOrder && card.relLineResult?.binned !== true ? value : plainMeasureName(`${stat(card)}(${value})`);
  return { x, y };
}

/** The line's numbers for the data drawer: one row per point and group, with its band and rows. */
export function relLineRows(card: ChartCard): string[][] {
  const result = card.relLineResult;
  if (result === null) return [];
  const { x, y } = relLineAxisLabels(card);
  const grouped = result.series.length > 1 || result.series[0]?.label !== "";
  const head = [x ?? "x", ...(grouped ? [card.meta(card.config.groupColumn)?.name ?? "group"] : []), y ?? "value", "low", "high", "rows"];
  const text = (value: number): string => (Number.isFinite(value) ? String(value) : "");
  const rows: string[][] = [head];
  for (const series of result.series) {
    for (let i = 0; i < result.xs.length; i++) {
      if (series.n[i] === 0) continue;
      const at = result.xLabels === null ? String(result.xs[i]) : (result.xLabels[i] ?? "");
      rows.push([at, ...(grouped ? [series.label] : []), text(series.center[i]!), text(series.low[i]!), text(series.high[i]!), String(series.n[i])]);
    }
  }
  return rows;
}

export function relLineMarkers(card: ChartCard): boolean {
  const result = card.relLineResult;
  return card.config.lineMarkers ?? (result !== null && (result.xLabels !== null || result.xs.length <= AUTO_MARKERS));
}

export function drawRelLine(card: ChartCard, ctx: CanvasRenderingContext2D, frame: Frame): void {
  const result = card.relLineResult;
  const ui = frame.ui;
  if (result === null) {
    card.drawPlotMessage(ctx, frame, "Working out the line…");
    return;
  }
  if (result.rows === 0 || result.xs.length === 0) {
    const message = "No rows with both an x and a value to draw.";
    card.noteEl.textContent = message;
    card.drawPlotMessage(ctx, frame, message);
    return;
  }
  const categorical = result.xLabels !== null;
  const n = result.xs.length;
  const shown = result.series
    .map((series, index) => ({ series, base: card.groupColor(index) }))
    .filter(({ series }) => series.label === "" || !card.hiddenSplit.has(series.label));

  // y spans the lines and their bands; it need not start at zero.
  let lo = Infinity;
  let hi = -Infinity;
  for (const { series } of shown) {
    for (let i = 0; i < n; i++) {
      for (const value of [series.center[i]!, series.low[i]!, series.high[i]!]) {
        if (!Number.isFinite(value)) continue;
        if (value < lo) lo = value;
        if (value > hi) hi = value;
      }
    }
  }
  if (!Number.isFinite(lo)) {
    lo = 0;
    hi = 1;
  }
  if (hi === lo) {
    lo -= 1;
    hi += 1;
  }
  const pad = (hi - lo) * 0.06;
  ({ min: lo, max: hi } = refAxisRange(card, "y", lo - pad, hi + pad));
  const yTicks = axisTicks(card, "y", lo, hi, 5);
  lo = Math.min(lo, yTicks[0] ?? lo);
  hi = Math.max(hi, yTicks[yTicks.length - 1] ?? hi);
  const yAt = (value: number): number => frame.top + frame.plotH - ((value - lo) / (hi - lo)) * frame.plotH;
  // The value axis as drawn, so a reference line lands on it.
  setRefAxis(card, frame, lo, hi, shown.flatMap(({ series }) => Array.from(series.center).filter(Number.isFinite)));

  // x: by value for numbers, evenly for categories.
  const xMin = categorical ? -0.5 : result.xs[0]!;
  const xMax = categorical ? n - 0.5 : result.xs[n - 1]!;
  const xSpan = xMax - xMin || 1;
  const xPad = categorical ? 0 : xSpan * 0.02;
  const xAt = (value: number): number => frame.left + ((value - xMin + xPad) / (xSpan + 2 * xPad)) * frame.plotW;

  // Grid and ticks.
  ctx.strokeStyle = frame.border;
  ctx.lineWidth = 1;
  ctx.fillStyle = frame.dim;
  card.font(ctx, ui, 10);
  ctx.textAlign = "right";
  for (const value of yTicks) {
    const y = yAt(value);
    if (y < frame.top - 1 || y > frame.top + frame.plotH + 1) continue;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(frame.left, y + 0.5);
    ctx.lineTo(frame.left + frame.plotW, y + 0.5);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillText(formatCompact(value), frame.left - 6 * ui, y + 3 * ui);
  }
  ctx.beginPath();
  ctx.moveTo(frame.left, frame.top + frame.plotH + 0.5);
  ctx.lineTo(frame.left + frame.plotW, frame.top + frame.plotH + 0.5);
  ctx.stroke();
  ctx.textAlign = "center";
  const base = frame.top + frame.plotH + 14 * ui;
  if (categorical) {
    const labels = result.xLabels ?? [];
    const step = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(frame.plotW / (64 * ui)))));
    for (let i = 0; i < n; i += step) ctx.fillText(card.fit(ctx, labels[i] === "" ? "(blank)" : (labels[i] ?? ""), 60 * ui * step), xAt(i), base);
  } else {
    const ticks = axisTicks(card, "x", xMin, xMax, Math.max(2, Math.floor(frame.plotW / (80 * ui))));
    for (const value of ticks) if (value >= xMin - xPad && value <= xMax + xPad) ctx.fillText(formatCompact(value), xAt(value), base);
  }
  ctx.textAlign = "left";

  // Bands under the lines, then the lines, then the dots.
  const markers = relLineMarkers(card);
  const colors = shown.map(({ series, base: color }) => markColor(card, color, null, series.label === "" ? null : series.label));
  shown.forEach(({ series }, s) => {
    const color = colors[s]!;
    const x = (i: number): number => xAt(categorical ? i : result.xs[i]!);
    // Like seaborn, a group's line and band join its own points: an x it has no rows at is passed over.
    // A point with too few rows for an interval is pinned at the line, so the band narrows to it there.
    const points: number[] = [];
    for (let i = 0; i < n; i++) if (Number.isFinite(series.center[i]!)) points.push(i);
    if (!points.some((i) => Number.isFinite(series.low[i]!))) return;
    const top = (i: number): number => yAt(Number.isFinite(series.high[i]!) ? series.high[i]! : series.center[i]!);
    const bottom = (i: number): number => yAt(Number.isFinite(series.low[i]!) ? series.low[i]! : series.center[i]!);
    ctx.beginPath();
    points.forEach((i, k) => (k === 0 ? ctx.moveTo(x(i), top(i)) : ctx.lineTo(x(i), top(i))));
    for (let k = points.length - 1; k >= 0; k--) ctx.lineTo(x(points[k]!), bottom(points[k]!));
    ctx.closePath();
    ctx.globalAlpha = 0.2;
    ctx.fillStyle = color;
    ctx.fill();
    ctx.globalAlpha = 1;
  });
  shown.forEach(({ series }, s) => {
    const color = colors[s]!;
    const x = (i: number): number => xAt(categorical ? i : result.xs[i]!);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.lineJoin = "round";
    ctx.beginPath();
    let open = false;
    for (let i = 0; i < n; i++) {
      const value = series.center[i]!;
      if (!Number.isFinite(value)) continue;
      if (open) ctx.lineTo(x(i), yAt(value));
      else ctx.moveTo(x(i), yAt(value));
      open = true;
    }
    ctx.stroke();
    if (markers) {
      ctx.fillStyle = color;
      for (let i = 0; i < n; i++) {
        const value = series.center[i]!;
        if (!Number.isFinite(value)) continue;
        ctx.beginPath();
        ctx.arc(x(i), yAt(value), 3 * ui, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  });

  // Hover: one strip per x, naming every line's value there.
  const rowOrder = card.config.column === ROW_ORDER;
  const xName = rowOrder ? ROW_ORDER_NAME : (card.meta(card.config.column)?.name ?? "x");
  const regions: HitRegion[] = [];
  for (let i = 0; i < n; i++) {
    const center = xAt(categorical ? i : result.xs[i]!);
    const prev = i === 0 ? frame.left : (xAt(categorical ? i - 1 : result.xs[i - 1]!) + center) / 2;
    const next = i === n - 1 ? frame.left + frame.plotW : (xAt(categorical ? i + 1 : result.xs[i + 1]!) + center) / 2;
    const where = categorical ? (result.xLabels?.[i] ?? "") : formatChartNumber(result.xs[i]!);
    const lines = [`${xName}${result.binned ? " ≈ " : " = "}${where}`];
    shown.forEach(({ series }) => {
      const value = series.center[i]!;
      if (!Number.isFinite(value)) return;
      const band = Number.isFinite(series.low[i]!) ? ` (${formatChartNumber(series.low[i]!)} to ${formatChartNumber(series.high[i]!)})` : "";
      lines.push(`${series.label === "" ? "" : `${series.label}: `}${formatChartNumber(value)}${band} · ${series.n[i]!.toLocaleString()} ${series.n[i] === 1 ? "row" : "rows"}`);
    });
    if (lines.length > 1) regions.push({ x: prev, y: frame.top, w: Math.max(1, next - prev), h: frame.plotH, lines, actions: [] });
  }
  card.hitRegions.push(...regions);

  // Legend, and a note that says how the line was made.
  card.splitLegend = result.series.length > 1 || result.series[0]?.label !== "" ? result.series.map((series, index) => ({ label: series.label, color: markColor(card, card.groupColor(index), null, series.label) })) : null;
  const notes: string[] = [];
  const statName = relLineAxisLabels(card).y ?? "Rows";
  notes.push(
    rowOrder
      ? result.binned
        ? `${statName} in row order, each point the average of a run of rows (${n} runs)`
        : `${statName} in row order, one point per row`
      : `${statName} at each ${xName}${result.binned ? ` (gathered into ${n} bands of ${xName})` : ""}`,
  );
  const band = relBand(card);
  if (result.bandBlock !== null) notes.push(`no band: ${result.bandBlock}`);
  else if (band !== "none") notes.push(`band: ${INTERVAL_KINDS.find((entry) => entry.id === band)?.label ?? band}`);
  if (result.narrowed > 0) notes.push(`at ${result.narrowed} ${result.narrowed === 1 ? "point" : "points"} with few rows the band is kept within those rows' range`);
  if (result.hiddenHues > 0) notes.push(`${result.series.length} largest groups shown, ${result.hiddenHues} more not drawn`);
  notes.push(`${result.rows.toLocaleString()} rows · ${Math.round(result.ms)} ms`);
  card.noteEl.textContent = notes.join(" · ");
  card.brushSpace = null;
}

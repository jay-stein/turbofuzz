/**
 * Charts of points and cells: scatter, density, bubble, heatmaps, the correlation grid, colour scales and the pivot heatmap.
 *
 * Moved out of chart-card.ts: each function takes the card it works on, and the card keeps a
 * one-line method of the same name that calls it.
 */
import { cssVar } from "./chart-card-parts.js";
import { correlationHitRegions, heatmapHitRegions } from "./chart-hit-regions.js";
import type { SeriesGrid, SeriesPoints } from "../data/chart-series.js";
import { contourLevels, marchingSquares, smoothGrid } from "../data/kde.js";
import { robustRange } from "../data/dot-size.js";
import { DEFAULT_PALETTE, isRampPalette } from "../data/palettes.js";
import { colorForFraction, colorFraction, colorRamp, describeColorDomain, resolveColorDomain } from "./color-scale.js";
import type { ColumnMeta } from "../worker/protocol.js";
import { axisKindFor, correlationCell, formatChartNumber, formatCompact, formatTick, darkerColor, hexToRgb, isGroupable, isNumericType, niceTicks, rampColor } from "./chart-utils.js";
import { el } from "./dom.js";
import type { ChartCard } from "./chart-card.js";
import type { BubbleLayer, Frame } from "./chart-card-types.js";
import { refAxisRange } from "./chart-ref-lines.js";
import { panelGrid } from "./chart-extra.js";
import { BORDER_DARKER, BORDER_ALPHA, addMarkerPath, leastSquares, cropDensityGrid } from "./chart-card-types.js";

export function refreshCrosstab(card: ChartCard): void {
  if (card.config.kind !== "heatmap") {
    card.crossResult = null;
    return;
  }
  const x = card.meta(card.config.x);
  const y = card.meta(card.config.y);
  if (
    x === undefined ||
    y === undefined ||
    !isGroupable(x) ||
    !isGroupable(y)
  ) {
    card.crossResult = null;
    return;
  }
  const generation = ++card.generation;
  void card.options
    .requestCrosstab({
      xColumn: card.config.x,
      yColumn: card.config.y,
      topX: card.config.topN,
      topY: card.config.topN,
      groupOther: card.config.groupOther,
      ...card.chartScope(),
    })
    .then((message) => {
      if (generation !== card.generation || card.disposed) return;
      card.crossResult = message.result;
      card.statsMs = message.ms;
      card.render();
    })
    .catch(() => {
      // Keep the last payload as the fallback.
    });
}

/** Row counts per x/y grid cell for the bubble chart. */
export function refreshBubble(card: ChartCard): void {
  if (card.config.kind !== "bubble" || card.options.requestGridCounts === undefined) {
    card.bubbleResult = null;
    return;
  }
  const x = card.meta(card.config.x);
  const y = card.meta(card.config.y);
  if (
    x === undefined ||
    y === undefined ||
    !isNumericType(x.type) ||
    !isNumericType(y.type)
  ) {
    card.bubbleResult = null;
    return;
  }
  const generation = ++card.generation;
  void card.options
    .requestGridCounts(
      card.config.x,
      card.config.y,
      card.config.bubbleBins ?? 40,
      card.bubbleMeasure(),
      card.bubbleGroupColumn(),
      card.chartScope(),
    )
    .then((message) => {
      if (generation !== card.generation || card.disposed) return;
      card.bubbleResult = message.result;
      card.statsMs = message.ms;
      card.render();
    })
    .catch(() => {
      // Keep the last payload as the fallback.
    });
}

export function refreshCorrelation(card: ChartCard): void {
  if (card.config.kind !== "correlation") {
    card.correlationResult = null;
    return;
  }
  const columns = card.config.correlationColumns.filter((index) => {
    const meta = card.meta(index);
    return meta !== undefined && isNumericType(meta.type);
  });
  if (columns.length < 2) {
    card.correlationResult = null;
    return;
  }
  const generation = ++card.generation;
  void card.options
    .requestCorrelation(columns, card.chartScope())
    .then((message) => {
      if (generation !== card.generation || card.disposed) return;
      card.correlationResult = {
        labels: message.labels,
        values: message.result.values,
        counts: message.result.counts,
      };
      card.statsMs = message.ms;
      card.render();
    })
    .catch(() => {
      // Keep the last payload as the fallback.
    });
}

/** Bubble chart: rows per x/y grid cell, sized by count or a measure. */
export function drawBubble(card: ChartCard, ctx: CanvasRenderingContext2D, frame: Frame): void {
  const animated = card.animationResult?.bubble;
  if (animated !== undefined && card.animationResult !== null) {
    const frames = card.animationResult.frames;
    const index = Math.min(Math.max(0, card.animationFrame), Math.max(0, frames.length - 1));
    const cellCount = animated.bins * animated.bins;
    const groupCount = animated.groups === null ? 1 : animated.groups.length;
    const frameBase = index * groupCount * cellCount;
    const layers: BubbleLayer[] = [];
    for (let group = 0; group < groupCount; group++) {
      const meta = animated.groups?.[group];
      const code = meta?.code ?? 0;
      if (animated.groups !== null && card.hiddenGroups.has(code)) continue;
      const base = frameBase + group * cellCount;
      layers.push({
        label: meta?.label ?? "",
        code,
        counts: animated.grids.subarray(base, base + cellCount),
        values:
          animated.values === null
            ? null
            : animated.values.slice(base, base + cellCount),
        color: animated.groups === null ? card.primaryColor() : card.groupColor(group),
      });
    }
    card.drawBubbleGrid(ctx, frame, {
      xMin: animated.xMin,
      xMax: animated.xMax,
      yMin: animated.yMin,
      yMax: animated.yMax,
      bins: animated.bins,
      layers,
      maxCount: card.animationResult.maxCount,
      valueMax: animated.valueMax,
      total: card.animationResult.total,
      caption: frames[index]?.label ?? "",
      groupCount,
    });
    return;
  }
  const result = card.bubbleResult;
  if (result === null) {
    const message =
      card.columns.length === 0
        ? "Load data to see charts."
        : "Bubble needs two numeric columns — pick X and Y above.";
    card.noteEl.textContent = message;
    card.drawPlotMessage(ctx, frame, message);
    return;
  }
  const layers: BubbleLayer[] = [];
  if (result.groups === null) {
    layers.push({
      label: "",
      code: 0,
      counts: result.counts,
      values: result.values,
      color: card.primaryColor(),
    });
  } else {
    result.groups.forEach((group, index) => {
      if (card.hiddenGroups.has(group.code)) return;
      layers.push({
        label: group.label,
        code: group.code,
        counts: group.counts,
        values: group.values,
        color: card.groupColor(index),
      });
    });
  }
  const view = card.plotView ?? {
    xMin: result.xMin,
    xMax: result.xMax,
    yMin: result.yMin,
    yMax: result.yMax,
  };
  card.drawBubbleGrid(ctx, frame, {
    xMin: view.xMin,
    xMax: view.xMax,
    yMin: view.yMin,
    yMax: view.yMax,
    bins: result.bins,
    layers,
    maxCount: result.maxCount,
    valueMax: result.valueMax,
    total: result.total,
    caption: "",
    groupCount: result.groups === null ? 1 : result.groups.length,
  });
}

/** Radius fraction for one cell value under the configured scale. */
export function bubbleFraction(card: ChartCard, value: number, max: number): number {
  if (!(max > 0) || !Number.isFinite(value) || value <= 0) return 0;
  const t = Math.min(1, value / max);
  switch (card.config.bubbleScale ?? "area") {
    case "radius":
      return t;
    case "log":
      return Math.log1p(value) / Math.log1p(max);
    default:
      return Math.sqrt(t);
  }
}

export function drawBubbleGrid(card: ChartCard, ctx: CanvasRenderingContext2D, frame: Frame, input: {
      xMin: number;
      xMax: number;
      yMin: number;
      yMax: number;
      bins: number;
      layers: BubbleLayer[];
      maxCount: number;
      valueMax: number;
      total: number;
      caption: string;
      groupCount: number;
    }): void {
  const ui = frame.ui;
  const { xMin, xMax, yMin, yMax, bins } = input;
  card.brushSpace = {
    left: frame.left,
    top: frame.top,
    plotW: frame.plotW,
    plotH: frame.plotH,
    xColumn: card.config.x,
    xMin,
    xMax,
    xFraction: 1,
    yColumn: card.config.y,
    yMin,
    yMax,
  };
  const scaleName = card.config.bubbleScale ?? "area";

  const xTicks = niceTicks(xMin, xMax, 4);
  const yTicks = niceTicks(yMin, yMax, 4).filter(
    (value, index, all) =>
      index === 0 || formatChartNumber(value) !== formatChartNumber(all[index - 1]),
  );
  ctx.lineWidth = 1;
  ctx.fillStyle = frame.dim;
  card.font(ctx, ui, 10);
  ctx.textAlign = "right";
  for (const value of yTicks) {
    const y =
      frame.top + frame.plotH - ((value - yMin) / Math.max(1e-12, yMax - yMin)) * frame.plotH;
    ctx.strokeStyle = frame.border;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(frame.left, y + 0.5);
    ctx.lineTo(frame.left + frame.plotW, y + 0.5);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillText(formatCompact(value), frame.left - 6 * ui, y + 3 * ui);
  }
  ctx.textAlign = "center";
  for (const value of xTicks) {
    const x = frame.left + ((value - xMin) / Math.max(1e-12, xMax - xMin)) * frame.plotW;
    ctx.fillText(formatChartNumber(value), x, frame.top + frame.plotH + 14 * ui);
  }
  ctx.textAlign = "left";

  const grouped = input.layers.length > 1 || input.layers[0]?.label !== "";
  let cells = 0;
  let frameRows = 0;
  for (const layer of input.layers) {
    const sizeValues = layer.values;
    const sizeMax =
      sizeValues === null ? Math.max(1, input.maxCount) : Math.max(1e-12, input.valueMax);
    for (let by = 0; by < bins; by++) {
      for (let bx = 0; bx < bins; bx++) {
        const cell = by * bins + bx;
        const count = layer.counts[cell] ?? 0;
        if (count === 0) continue;
        const value = sizeValues === null ? count : (sizeValues[cell] ?? Number.NaN);
        if (!Number.isFinite(value) || value <= 0) continue;
        cells++;
        frameRows += count;
        const x = frame.left + ((bx + 0.5) / bins) * frame.plotW;
        const y = frame.top + frame.plotH - ((by + 0.5) / bins) * frame.plotH;
        const fraction = card.bubbleFraction(value, sizeMax);
        const radius = (1.5 + 13 * fraction) * ui;
        ctx.globalAlpha = 0.24 + 0.5 * fraction;
        ctx.fillStyle = layer.color;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 0.9;
        ctx.strokeStyle = darkerColor(layer.color);
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
  }
  if (input.caption !== "") {
    card.font(ctx, ui, 12, "600");
    ctx.fillStyle = frame.text;
    ctx.fillText(
      input.caption,
      frame.left + frame.plotW - ctx.measureText(input.caption).width,
      frame.top - 8 * ui,
    );
  }
  const xName = card.meta(card.config.x)?.name ?? "x";
  const yName = card.meta(card.config.y)?.name ?? "y";
  const caption = input.caption === "" ? "" : `${input.caption} · `;
  const scaleNote =
    scaleName === "area" ? "" : scaleName === "log" ? " (log scale)" : " (radius scale)";
  const groupName = card.meta(card.config.groupColumn)?.name;
  const groupNote =
    grouped && groupName !== undefined
      ? ` · ${input.layers.length} of ${input.groupCount} groups by ${groupName}`
      : "";
  card.noteEl.textContent = `${caption}${frameRows.toLocaleString()} rows in ${cells.toLocaleString()} cells · ${xName} × ${yName} · size: ${card.bubbleSizeLabel()}${scaleNote}${groupNote}`;
}

export function drawScatterLike(card: ChartCard, ctx: CanvasRenderingContext2D, frame: Frame): void {
  if (card.config.kind === "density" && card.animationResult?.bubble !== undefined) {
    card.drawAnimatedDensity(ctx, frame);
    return;
  }
  const result = card.seriesResult;
  const xMeta = card.meta(card.config.x);
  const yMeta = card.meta(card.config.y);
  if (result === null || xMeta === undefined || yMeta === undefined) {
    const message =
      card.columns.length === 0
        ? "Load data to see charts."
        : "Scatter and density need two numeric or date columns — pick X and Y above.";
    card.noteEl.textContent = message;
    card.drawPlotMessage(ctx, frame, message);
    return;
  }
  if (result.mode === "density")
    card.drawDensity(ctx, frame, result, xMeta, yMeta, card.plotView);
  else if (card.config.kind === "scatter" && result.facetCodes !== undefined && result.facetCodes !== null && card.facetLabels !== null)
    drawPanels(card, ctx, frame, card.plotView === null ? withRefLines(card, result) : { ...result, ...card.plotView }, result.facetCodes, card.facetLabels, xMeta, yMeta);
  else
    card.drawPoints(
      ctx,
      frame,
      card.plotView === null ? withRefLines(card, result) : { ...result, ...card.plotView },
      xMeta,
      yMeta,
    );
}

/** At most this many panels; more values than that are named in the note instead. */
const PANEL_LIMIT = 24;

/**
 * Small multiples: one scatter per value of the panel column, in a near-square grid, every panel on the same
 * axes so they compare at a glance. Each has its name, its own fit line and r; the note covers them all.
 */
function drawPanels(card: ChartCard, ctx: CanvasRenderingContext2D, frame: Frame, result: SeriesPoints, codes: Uint16Array, labels: readonly string[], xMeta: ColumnMeta, yMeta: ColumnMeta): void {
  const counts = new Map<number, number>();
  for (let i = 0; i < result.shown; i++) if (codes[i] !== 0xffff) counts.set(codes[i]!, (counts.get(codes[i]!) ?? 0) + 1);
  const panels = [...counts.keys()].sort((a, b) => a - b).slice(0, PANEL_LIMIT);
  if (panels.length === 0) {
    card.drawPoints(ctx, frame, result, xMeta, yMeta);
    return;
  }
  const ui = frame.ui;
  // The grid uses the whole chart's tick margins for its outer edge; each panel keeps room for its own.
  const tickW = 34 * ui;
  const tickH = 22 * ui;
  // Two lines over each panel: its name, then its r and equation.
  const titleH = 34 * ui;
  // The first row's two heading lines start where the chart's one would have: never above the canvas.
  const lift = 22 * ui;
  const area = { x: frame.left - tickW, y: frame.top - lift, w: frame.plotW + tickW, h: frame.plotH + lift + tickH };
  const grid = panelGrid(panels.length, area.w, area.h, 10 * ui);
  const panelName = card.meta(card.config.facetColumn ?? -1)?.name ?? "panel";
  panels.forEach((code, index) => {
    const cell = grid.cells[index]!;
    const sub: Frame = {
      ...frame,
      left: area.x + cell.x + tickW,
      top: area.y + cell.y + titleH,
      plotW: Math.max(10, cell.w - tickW - 6 * ui),
      plotH: Math.max(10, cell.h - titleH - tickH),
    };
    const keep: number[] = [];
    for (let i = 0; i < result.shown; i++) if (codes[i] === code) keep.push(i);
    const pick = (values: Float64Array | null): Float64Array | null => (values === null ? null : Float64Array.from(keep, (i) => values[i]!));
    const colorCodes = result.colorCodes;
    const part: SeriesPoints = { ...result, x: pick(result.x)!, y: pick(result.y)!, colorValues: pick(result.colorValues), colorCodes: colorCodes === null ? null : Uint16Array.from(keep, (i) => colorCodes[i]!), size: pick(result.size), facetCodes: null, shown: keep.length };
    const label = labels[code] ?? "";
    drawPoints(card, ctx, sub, part, xMeta, yMeta, { title: `${panelName} ${label === "" ? "(empty)" : label} · ${keep.length.toLocaleString()} ${keep.length === 1 ? "row" : "rows"}` });
  });
  const notes = [`${result.shown.toLocaleString()} points in ${panels.length} panels by ${panelName}, on shared axes`];
  if (counts.size > panels.length) notes.push(`first ${panels.length} of ${counts.size} values shown`);
  if (result.sampled) notes.push(`sampled from ${result.total.toLocaleString()}`);
  if (result.outside > 0) notes.push(`${result.outside.toLocaleString()} outside p1–p99`);
  if (card.seriesMs > 0) notes.push(`${Math.round(card.seriesMs)} ms`);
  card.noteEl.textContent = notes.join(" · ");
  // A Shift+drag box would land in one panel's coordinates and filter the wrong values: no brushing here.
  card.brushSpace = null;
}

/** Pearson r of the first n pairs (NaN when undefined). */
function pearson(x: ArrayLike<number>, y: ArrayLike<number>, n: number): number {
  let sx = 0, sy = 0;
  for (let i = 0; i < n; i++) { sx += x[i]!; sy += y[i]!; }
  const mx = sx / n, my = sy / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i]! - mx, dy = y[i]! - my;
    sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
  }
  return n < 2 || sxx === 0 || syy === 0 ? Number.NaN : sxy / Math.sqrt(sxx * syy);
}

/** Points keep their data range unless a reference line lies beyond it; then the axes widen to show the line. */
function withRefLines(card: ChartCard, result: SeriesPoints): SeriesPoints {
  if ((card.config.refLines ?? []).length === 0) return result;
  const x = refAxisRange(card, "x", result.xMin, result.xMax);
  const y = refAxisRange(card, "y", result.yMin, result.yMax);
  return x.min === result.xMin && x.max === result.xMax && y.min === result.yMin && y.max === result.yMax
    ? result
    : { ...result, xMin: x.min, xMax: x.max, yMin: y.min, yMax: y.max };
}

export function pointSizes(card: ChartCard, result: SeriesPoints, ui: number): Float64Array | null {
  if (result.size === null || (result.places !== true && card.config.sizeColumn < 0)) return null;
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
    sizes[i] = result.places === true ? (3 + 11 * Math.sqrt(t)) * ui : (1.6 + 3.4 * Math.sqrt(t)) * ui;
  }
  return sizes;
}

export function colorBuckets(card: ChartCard, result: SeriesPoints): {
    buckets: Uint8Array;
    colors: string[];
    domain?: ReturnType<typeof resolveColorDomain>;
  } | null {
  const n = result.shown;
  if (result.colorCodes !== null) {
    const colors = card.paletteColors(12);
    const buckets = new Uint8Array(n);
    for (let i = 0; i < n; i++) buckets[i] = result.colorCodes[i] % colors.length;
    return { buckets, colors };
  }
  if (result.colorValues !== null && card.config.colorColumn >= 0) {
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < n; i++) {
      const value = result.colorValues[i];
      if (!Number.isFinite(value)) continue;
      if (value < min) min = value;
      if (value > max) max = value;
    }
    if (min === Infinity) return null;
    // Places are averages over few rows or many, so their tails are wild: the scale spans the middle of them,
    // the same scale for every frame while stepping through time.
    const robust = result.places !== true ? null : (card.placeFrame() === null ? robustRange(result.colorValues, n) : (card.animationResult?.places?.colorRange ?? null));
    const domain = resolveColorDomain({
      autoMin: robust?.min ?? min,
      autoMax: robust?.max ?? max,
      min: card.config.colorMin,
      max: card.config.colorMax,
      center: card.config.colorCenter,
    });
    const buckets = new Uint8Array(n).fill(16);
    const paletteName = card.rampPaletteName();
    const ramp = isRampPalette(paletteName) ? card.rampStopsFor(paletteName) : null;
    const colors = colorRamp(ramp, 16, rampColor);
    colors.push(card.primaryColor());
    // Only positive values have a logarithm: a range reaching zero or below stays linear.
    const logColor = card.config.kind === "map" && card.config.mapColorScale === "log" && domain.min > 0 && domain.max > domain.min;
    const logFraction = (value: number): number =>
      Math.max(0, Math.min(1, Math.log(Math.max(value, domain.min) / domain.min) / Math.log(domain.max / domain.min)));
    for (let i = 0; i < n; i++) {
      const value = result.colorValues[i];
      if (!Number.isFinite(value)) continue;
      buckets[i] = Math.round((logColor ? logFraction(value) : colorFraction(value, domain)) * 15);
    }
    return { buckets, colors, domain };
  }
  return null;
}

/** One compact gradient legend used by every numeric colour path. */
export function drawColorBar(card: ChartCard, ctx: CanvasRenderingContext2D, frame: Frame, colors: readonly string[], domain: ReturnType<typeof resolveColorDomain>, aboveBottom?: number): void {
  const ui = frame.ui;
  const barW = Math.min(150 * ui, frame.plotW * 0.42);
  const barH = 6 * ui;
  const barX = frame.left + frame.plotW - barW - 10 * ui;
  const barY = aboveBottom === undefined ? frame.top + 10 * ui : frame.top + frame.plotH - aboveBottom - barH - 12 * ui;
  ctx.fillStyle = aboveBottom === undefined ? frame.text : card.plateColor();
  ctx.globalAlpha = aboveBottom === undefined ? 0.1 : 0.9;
  ctx.fillRect(barX - 5 * ui, barY - 12 * ui, barW + 10 * ui, barH + 19 * ui);
  ctx.globalAlpha = 1;
  const gradient = ctx.createLinearGradient(barX, 0, barX + barW, 0);
  colors.forEach((color, index) =>
    gradient.addColorStop(index / Math.max(1, colors.length - 1), color),
  );
  ctx.fillStyle = gradient;
  ctx.fillRect(barX, barY, barW, barH);
  ctx.strokeStyle = frame.dim;
  ctx.globalAlpha = 0.5;
  ctx.strokeRect(barX + 0.5, barY + 0.5, barW, barH);
  ctx.globalAlpha = 1;
  ctx.fillStyle = frame.dim;
  card.font(ctx, ui, 9);
  const minLabel = formatTick(domain.min, null);
  const maxLabel = formatTick(domain.max, null);
  ctx.fillText(minLabel, barX, barY - 3 * ui);
  ctx.fillText(maxLabel, barX + barW - ctx.measureText(maxLabel).width, barY - 3 * ui);
  if (domain.centered) {
    const centerLabel = formatTick((domain.min + domain.max) / 2, null);
    ctx.fillText(
      centerLabel,
      barX + barW / 2 - ctx.measureText(centerLabel).width / 2,
      barY - 3 * ui,
    );
  }
}

export function colorNote(card: ChartCard, result: SeriesPoints): string | null {
  const meta = card.meta(card.config.colorColumn);
  if (meta === undefined || card.config.colorColumn < 0) return null;
  if (result.colorCodes !== null) {
    const count = card.seriesLabels?.length ?? 0;
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
      const domain = resolveColorDomain({
        autoMin: min,
        autoMax: max,
        min: card.config.colorMin,
        max: card.config.colorMax,
        center: card.config.colorCenter,
      });
      return `colour: ${meta.name} (${describeColorDomain(domain, (value) =>
        formatTick(value, null),
      )})`;
    }
  }
  return null;
}

/** A point's value as its axis reads it: a date as a date, a number in full. */
function pointValueText(meta: ColumnMeta, value: number): string {
  const kind = axisKindFor(meta.type);
  return kind === "line" || kind === "datetime" || kind === "time" || kind === "duration" ? formatTick(value, kind) : formatChartNumber(value);
}

/**
 * Hover for each drawn point: its colour group, X and Y, and its colour and size values.
 * The interactive web page export carries the same.
 */
function pointHitRegions(card: ChartCard, frame: Frame, result: SeriesPoints, xMeta: ColumnMeta, yMeta: ColumnMeta, sizes: ArrayLike<number> | null, radius: number, panel: { title: string } | null): void {
  const xScale = frame.plotW / (result.xMax - result.xMin);
  const yScale = frame.plotH / (result.yMax - result.yMin);
  const colorMeta = card.config.colorColumn >= 0 ? card.meta(card.config.colorColumn) : undefined;
  const labels = colorMeta?.categories?.labels;
  const sizeMeta = card.config.sizeColumn >= 0 ? card.meta(card.config.sizeColumn) : undefined;
  // Many points: one hover per 4px cell, the point drawn on top there, saying how many share it.
  // That bounds the hover list by the plot's area, not the row count.
  const crowded = result.shown > 5000;
  const cell = 4;
  const cols = Math.ceil(frame.plotW / cell) + 1;
  const topOf = new Map<number, number>();
  const countOf = new Map<number, number>();
  const order: number[] = [];
  for (let i = 0; i < result.shown; i++) {
    const x = frame.left + (result.x[i]! - result.xMin) * xScale;
    const y = frame.top + frame.plotH - (result.y[i]! - result.yMin) * yScale;
    if (!(x >= frame.left && x <= frame.left + frame.plotW && y >= frame.top && y <= frame.top + frame.plotH)) continue;
    if (!crowded) {
      order.push(i);
      continue;
    }
    const key = Math.floor((y - frame.top) / cell) * cols + Math.floor((x - frame.left) / cell);
    topOf.set(key, i);
    countOf.set(key, (countOf.get(key) ?? 0) + 1);
  }
  const shared = new Map<number, number>();
  if (crowded) {
    for (const [key, i] of topOf) {
      order.push(i);
      shared.set(i, countOf.get(key) ?? 1);
    }
    order.sort((a, b) => a - b);
  }
  for (const i of order) {
    const x = frame.left + (result.x[i]! - result.xMin) * xScale;
    const y = frame.top + frame.plotH - (result.y[i]! - result.yMin) * yScale;
    // A little larger than the dot, so a small one can still be found.
    const r = Math.max(4, Math.max(0.5, sizes === null ? radius : sizes[i]!) + 2);
    const code = result.colorCodes?.[i];
    const group = code !== undefined ? labels?.[code] : undefined;
    const lines = [group ?? panel?.title ?? "Point", `${xMeta.name}: ${pointValueText(xMeta, result.x[i]!)}`, `${yMeta.name}: ${pointValueText(yMeta, result.y[i]!)}`];
    if (code === undefined && colorMeta !== undefined && result.colorValues !== null && Number.isFinite(result.colorValues[i])) {
      lines.push(`${colorMeta.name}: ${formatChartNumber(result.colorValues[i]!)}`);
    }
    if (sizeMeta !== undefined && result.size !== null && Number.isFinite(result.size[i])) lines.push(`${sizeMeta.name}: ${formatChartNumber(result.size[i]!)}`);
    // Labelled, so the web page export offers it as one hover line to keep, hide or rename.
    const here = shared.get(i) ?? 1;
    if (here > 1) lines.push(`Points here: ${here.toLocaleString()}`);
    card.hitRegions.push({ x: x - r, y: y - r, w: 2 * r, h: 2 * r, contains: (px, py) => (px - x) ** 2 + (py - y) ** 2 <= r * r, lines, actions: [] });
  }
}

export function drawPoints(card: ChartCard, ctx: CanvasRenderingContext2D, frame: Frame, result: SeriesPoints, xMeta: ColumnMeta, yMeta: ColumnMeta, panel: { title: string } | null = null): void {
  if (panel !== null) {
    // One small multiple: its name above it, its own fit and r, and none of the whole chart's notes.
    card.font(ctx, frame.ui, 11, "700");
    ctx.fillStyle = frame.text;
    ctx.textAlign = "left";
    // The title has its own line; the panel's r and equation go on the line under it.
    ctx.fillText(card.fit(ctx, panel.title, frame.plotW), frame.left, frame.top - 20 * frame.ui);
  }
  if (result.shown === 0) {
    if (panel !== null) return;
    const message = "No matching X/Y value pairs in the current rows.";
    card.noteEl.textContent = message;
    card.drawPlotMessage(ctx, frame, message);
    return;
  }
  card.drawAxes(
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
  const sizes = card.pointSizes(result, frame.ui);
  const buckets = card.colorBuckets(result);
  const radius = (card.config.dotMinRadius ?? 2.2) * frame.ui;
  const alpha = card.config.dotOpacity ?? 0.55;
  const shape = card.config.markerShape ?? "circle";
  // Up to 5,000 points each gets an outline; past that they are filled in one batch per colour, still the chosen shape.
  const detailed = result.shown <= 5000;
  ctx.lineWidth = Math.max(0.9, 1 * frame.ui);

  const drawAt = (index: number): void => {
    const r = Math.max(0.5, sizes === null ? radius : sizes[index]);
    const x = frame.left + (result.x[index] - result.xMin) * xScale;
    const y = frame.top + frame.plotH - (result.y[index] - result.yMin) * yScale;
    if (detailed) {
      ctx.beginPath();
      addMarkerPath(ctx, shape, x, y, r);
      ctx.globalAlpha = alpha;
      ctx.fill();
      ctx.globalAlpha = BORDER_ALPHA;
      ctx.stroke();
    } else {
      addMarkerPath(ctx, shape, x, y, r);
    }
  };

  // Zoom/pan can move points past the plot: clip the marks, not the axes.
  ctx.save();
  ctx.beginPath();
  ctx.rect(frame.left, frame.top, frame.plotW, frame.plotH);
  ctx.clip();
  ctx.globalAlpha = alpha;
  if (buckets === null) {
    ctx.fillStyle = card.primaryColor();
    ctx.strokeStyle = darkerColor(card.primaryColor(), BORDER_DARKER);
    if (!detailed) ctx.beginPath();
    for (let i = 0; i < result.shown; i++) drawAt(i);
    if (!detailed) {
      ctx.globalAlpha = alpha;
      ctx.fill();
      ctx.globalAlpha = BORDER_ALPHA;
      ctx.stroke();
    }
  } else {
    for (let bucket = 0; bucket < buckets.colors.length; bucket++) {
      ctx.fillStyle = buckets.colors[bucket];
      ctx.strokeStyle = darkerColor(buckets.colors[bucket]!, BORDER_DARKER);
      if (!detailed) ctx.beginPath();
      for (let i = 0; i < result.shown; i++) {
        if (buckets.buckets[i] === bucket) drawAt(i);
      }
      if (!detailed) {
        ctx.globalAlpha = alpha;
        ctx.fill();
        ctx.globalAlpha = BORDER_ALPHA;
        ctx.stroke();
      }
    }
  }
  ctx.globalAlpha = 1;
  pointHitRegions(card, frame, result, xMeta, yMeta, sizes, radius, panel);
  const fit = card.config.fitLine ?? true ? leastSquares(result.x, result.y, result.shown) : null;
  if (fit !== null) {
    // The dashed line of best fit, across the whole plot.
    const y0 = frame.top + frame.plotH - (fit.intercept + fit.slope * result.xMin - result.yMin) * yScale;
    const y1 = frame.top + frame.plotH - (fit.intercept + fit.slope * result.xMax - result.yMin) * yScale;
    ctx.save();
    ctx.setLineDash([7 * frame.ui, 5 * frame.ui]);
    ctx.lineWidth = Math.max(1.5, 1.8 * frame.ui);
    ctx.strokeStyle = frame.text;
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.moveTo(frame.left, y0);
    ctx.lineTo(frame.left + frame.plotW, y1);
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();

  if (panel !== null) {
    card.drawCorrelationNote(ctx, frame, fit, pearson(result.x, result.y, result.shown), true);
    return;
  }
  card.drawCorrelationNote(ctx, frame, fit);
  if (buckets?.domain !== undefined) {
    card.drawColorBar(ctx, frame, buckets.colors, buckets.domain);
  }

  const notes: string[] = [`${result.shown.toLocaleString()} points`];
  if (result.sampled) notes.push(`sampled from ${result.total.toLocaleString()}`);
  if (result.outside > 0) notes.push(`${result.outside.toLocaleString()} outside p1–p99`);
  const colorText = card.colorNote(result);
  if (colorText !== null) notes.push(colorText);
  const sizeMeta = card.meta(card.config.sizeColumn);
  if (sizes !== null && sizeMeta !== undefined) notes.push(`size: ${sizeMeta.name}`);
  notes.push("Ctrl+scroll to zoom · drag to pan · double-click resets");
  if (card.seriesMs > 0) notes.push(`${Math.round(card.seriesMs)} ms`);
  card.noteEl.textContent = notes.join(" · ");
  // Too many points to draw one by one: offer the fancier view instead of choosing it for the person.
  if (result.sampled && card.config.kind === "scatter") {
    const nudge = el("button", { class: "link small chart-density-nudge", type: "button", title: "Count every row in a grid and colour it by how many fall in each cell" }, ["Show all of them as a density map"]);
    nudge.addEventListener("click", () => {
      card.config.mode = "density";
      card.modeSelect.value = "density";
      card.generation++;
      card.renderControls();
      card.refreshSeries();
      card.render();
    });
    card.noteEl.append(" ", nudge);
  }
}

export function drawDensity(card: ChartCard, ctx: CanvasRenderingContext2D, frame: Frame, result: SeriesGrid, xMeta: ColumnMeta, yMeta: ColumnMeta, viewport: { xMin: number; xMax: number; yMin: number; yMax: number } | null = null): void {
  if (viewport !== null) result = cropDensityGrid(result, viewport);
  if (result.max === 0) {
    const message = "No matching X/Y value pairs in the current rows.";
    card.noteEl.textContent = message;
    card.drawPlotMessage(ctx, frame, message);
    return;
  }
  const style = card.config.densityStyle;
  let smooth: Float64Array | null = null;
  let smoothMax = 0;
  if (style !== "heat") {
    smooth = smoothGrid(result.counts, result.cols, result.rows, 1.6);
    for (const value of smooth) if (value > smoothMax) smoothMax = value;
  }

  if (style === "heat" || style === "both") {
    ctx.save();
    ctx.beginPath();
    ctx.rect(frame.left, frame.top, frame.plotW, frame.plotH);
    ctx.clip();
    card.paintDensityHeat(ctx, frame, result, style === "both" ? 0.45 : 1);
    ctx.restore();
  }
  if (smooth !== null && smoothMax > 0) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(frame.left, frame.top, frame.plotW, frame.plotH);
    ctx.clip();
    // "contours" is the filled style (its saved name); the line styles carry their values on the lines.
    if (style === "contours") card.paintDensityBands(ctx, frame, result, smooth, smoothMax);
    card.paintContourLines(ctx, frame, result, smooth, smoothMax, style !== "contours");
    ctx.restore();
  }

  card.drawAxes(
    ctx,
    frame,
    result.xMin,
    result.xMax,
    result.yMin,
    result.yMax,
    axisKindFor(xMeta.type) ?? "histogram",
    axisKindFor(yMeta.type) ?? "histogram",
  );
  card.drawCorrelationNote(ctx, frame);

  const notes = [
    `${result.total.toLocaleString()} rows`,
    `${result.cols}×${result.rows} density grid`,
    `peak ${result.max.toLocaleString()}`,
  ];
  notes.push(
    style === "heat" ? "heat" : style === "contours" ? "5 filled contour levels" : `${style === "both" ? "heat + " : ""}contour lines labelled in rows per grid cell (smoothed)`,
  );
  if (result.outside > 0) notes.push(`${result.outside.toLocaleString()} outside p1–p99`);
  notes.push("Ctrl+scroll to zoom · drag to pan · double-click resets");
  if (card.seriesMs > 0) notes.push(`${Math.round(card.seriesMs)} ms`);
  card.noteEl.textContent = notes.join(" · ");
}

export function paintDensityHeat(card: ChartCard, ctx: CanvasRenderingContext2D, frame: Frame, result: SeriesGrid, alphaScale: number): void {
  const [r, g, b] = hexToRgb(card.primaryColor());
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

/**
 * One colour per contour level, low to high, from the card's colour map (Format → Colour map, Reverse
 * included), the same rule heatmaps follow: a ramp is sampled along its length, and a set of distinct
 * colours (which has no low-to-high order) keeps the default ramp.
 */
function contourColors(card: ChartCard, count: number): string[] {
  const name = card.config.palette ?? DEFAULT_PALETTE;
  const stops = isRampPalette(name) ? card.rampStopsFor(name) : null;
  return Array.from({ length: count }, (_, index) => colorForFraction((index + 1) / count, stops, rampColor));
}

/**
 * Filled contour bands, painted per pixel. Each pixel reads the smoothed density by
 * bilinear interpolation between the four nearest grid samples (the rule the contour lines use, so fills
 * and outlines meet exactly), and a pixel on a band edge blends the two bands by how much of it lies on
 * each side, so edges are smooth instead of stepping along the grid's cells.
 */
/** A reusable offscreen surface per chart card for the filled bands. */
const bandSurfaces = new WeakMap<ChartCard, { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D; image: ImageData; dirty: [number, number, number, number] | null }>();

export function paintDensityBands(card: ChartCard, ctx: CanvasRenderingContext2D, frame: Frame, result: SeriesGrid, smooth: Float64Array, smoothMax: number): void {
  const levels = contourLevels(smoothMax, 5);
  const { cols, rows } = result;
  if (levels.length === 0 || cols < 2 || rows < 2) return;
  // Band 0 is below the lowest level: clear. Band k (1..n) takes the level's colour.
  const rgba = [[0, 0, 0, 0], ...contourColors(card, levels.length).map((c) => [...hexToRgb(c), 205])];
  // Painted at layout pixels, not the screen's denser ones: edges are already blended, so scaling up keeps them
  // smooth, and a high-DPI screen costs no more than a normal one.
  const scale = 1;
  const width = Math.max(1, Math.round(frame.plotW * scale));
  const height = Math.max(1, Math.round(frame.plotH * scale));
  // One reusable surface per card: allocating a screen-sized image on every redraw costs more than drawing it.
  let surface = bandSurfaces.get(card);
  if (surface === undefined || surface.image.width !== width || surface.image.height !== height) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (context === null) return;
    surface = { canvas, context, image: context.createImageData(width, height), dirty: null };
    bandSurfaces.set(card, surface);
  }
  const { canvas: off, context: offCtx, image } = surface;
  const data = image.data;
  const words = new Uint32Array(data.buffer);
  // Only the area the last drawing touched needs clearing; this drawing records its own.
  if (surface.dirty !== null) {
    const [x0, y0, x1, y1] = surface.dirty;
    for (let py = y0; py < y1; py++) words.fill(0, py * width + x0, py * width + x1);
  }
  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;
  const bandOf = (value: number): number => {
    let band = 0;
    while (band < levels.length && value >= levels[band]) band++;
    return band;
  };
  // Little-endian RGBA words, for filling whole runs of pixels at once.
  const word = rgba.map(([r, g, b, a]) => ((a << 24) | (b << 16) | (g << 8) | r) >>> 0);
  // Which grid cell each pixel column and row reads (bilinear between samples), and where in it.
  const pxCell = new Int32Array(width);
  const pxFrac = new Float64Array(width);
  for (let px = 0; px < width; px++) {
    const gx = Math.min(cols - 1, Math.max(0, ((px + 0.5) / width) * cols));
    pxCell[px] = Math.min(cols - 2, Math.floor(gx));
    pxFrac[px] = gx - pxCell[px];
  }
  const pyCell = new Int32Array(height);
  const pyFrac = new Float64Array(height);
  for (let py = 0; py < height; py++) {
    const gy = Math.min(rows - 1, Math.max(0, (1 - (py + 0.5) / height) * rows));
    pyCell[py] = Math.min(rows - 2, Math.floor(gy));
    pyFrac[py] = gy - pyCell[py];
  }
  // Each cell's pixel span: columns run left to right, rows bottom to top (screen y grows downwards).
  const xFrom = new Int32Array(cols - 1).fill(-1);
  const xTo = new Int32Array(cols - 1);
  for (let px = 0; px < width; px++) {
    const x = pxCell[px];
    if (xFrom[x] < 0) xFrom[x] = px;
    xTo[x] = px + 1;
  }
  const yFrom = new Int32Array(rows - 1).fill(-1);
  const yTo = new Int32Array(rows - 1);
  for (let py = 0; py < height; py++) {
    const y = pyCell[py];
    if (yFrom[y] < 0) yFrom[y] = py;
    yTo[y] = py + 1;
  }
  // Grid units per device pixel, for turning the density's slope into a distance in pixels.
  const kx = cols / width;
  const ky = rows / height;
  for (let y0 = 0; y0 < rows - 1; y0++) {
    if (yFrom[y0] < 0) continue;
    for (let x0 = 0; x0 < cols - 1; x0++) {
      if (xFrom[x0] < 0) continue;
      const i = y0 * cols + x0;
      const a = smooth[i];
      const b = smooth[i + 1];
      const d = smooth[i + cols];
      const c = smooth[i + cols + 1];
      // A bilinear value never leaves its corners' range: a cell inside one band is filled flat (most are
      // empty), and only cells a level passes through get the per-pixel edge work.
      const lowBand = bandOf(Math.min(a, b, c, d));
      const highBand = bandOf(Math.max(a, b, c, d));
      if (highBand === 0) continue;
      minX = Math.min(minX, xFrom[x0]);
      maxX = Math.max(maxX, xTo[x0]);
      minY = Math.min(minY, yFrom[y0]);
      maxY = Math.max(maxY, yTo[y0]);
      if (lowBand === highBand) {
        for (let py = yFrom[y0]; py < yTo[y0]; py++) words.fill(word[lowBand], py * width + xFrom[x0], py * width + xTo[x0]);
        continue;
      }
      for (let py = yFrom[y0]; py < yTo[y0]; py++) {
        const fy = pyFrac[py];
        for (let px = xFrom[x0]; px < xTo[x0]; px++) {
          const fx = pxFrac[px];
          const value = (a * (1 - fx) + b * fx) * (1 - fy) + (d * (1 - fx) + c * fx) * fy;
          const band = bandOf(value);
          // How far the pixel is from the nearest band edge, in pixels: within half a pixel, blend the neighbour in.
          const slope = Math.hypot(((b - a) * (1 - fy) + (c - d) * fy) * kx, ((d - a) * (1 - fx) + (c - b) * fx) * ky);
          let other = band;
          let mix = 0;
          if (slope > 1e-12) {
            const below = band > 0 ? (value - levels[band - 1]) / slope : Infinity;
            const above = band < levels.length ? (levels[band] - value) / slope : Infinity;
            if (below < above && below < 0.5) { other = band - 1; mix = 0.5 - below; }
            else if (above < 0.5) { other = band + 1; mix = 0.5 - above; }
          }
          const own = rgba[band];
          const next = rgba[other];
          const alphaOwn = own[3] * (1 - mix);
          const alphaNext = next[3] * mix;
          const alpha = alphaOwn + alphaNext;
          if (alpha <= 0) continue;
          const offset = (py * width + px) * 4;
          data[offset] = (own[0] * alphaOwn + next[0] * alphaNext) / alpha;
          data[offset + 1] = (own[1] * alphaOwn + next[1] * alphaNext) / alpha;
          data[offset + 2] = (own[2] * alphaOwn + next[2] * alphaNext) / alpha;
          data[offset + 3] = alpha;
        }
      }
    }
  }
  surface.dirty = maxX > minX ? [minX, minY, maxX, maxY] : null;
  if (surface.dirty === null) return;
  // Upload and draw just the touched area.
  const w = maxX - minX;
  const h = maxY - minY;
  offCtx.putImageData(image, 0, 0, minX, minY, w, h);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(off, minX, minY, w, h, frame.left + minX / scale, frame.top + minY / scale, w / scale, h / scale);
}

export function paintContourLines(card: ChartCard, ctx: CanvasRenderingContext2D, frame: Frame, result: SeriesGrid, smooth: Float64Array, smoothMax: number, labelled = false): void {
  const levels = contourLevels(smoothMax, 5);
  const placed: Box[] = [];
  const colors = contourColors(card, levels.length);
  levels.forEach((level, index) => {
    const segments = marchingSquares(smooth, result.cols, result.rows, level);
    if (segments.length === 0) return;
    const color = colors[index] ?? rampColor((index + 1) / levels.length);
    const px = new Float64Array(segments.length);
    for (let i = 0; i < segments.length; i += 2) {
      px[i] = frame.left + (segments[i] / result.cols) * frame.plotW;
      px[i + 1] = frame.top + (1 - segments[i + 1] / result.rows) * frame.plotH;
    }
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.85;
    ctx.lineWidth = labelled ? 1.4 : 1.2;
    ctx.beginPath();
    for (let i = 0; i < px.length; i += 4) {
      ctx.moveTo(px[i], px[i + 1]);
      ctx.lineTo(px[i + 2], px[i + 3]);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
    if (labelled) labelContour(card, ctx, frame, px, contourValue(level), color, placed);
  });
  ctx.globalAlpha = 1;
}

interface Box { x0: number; y0: number; x1: number; y1: number }

/** A contour level as a label: rows per grid cell, smoothed, to two significant figures. */
export function contourValue(level: number): string {
  if (level >= 1000) return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(level);
  if (level >= 10) return String(Math.round(level));
  return String(Number(level.toPrecision(2)));
}

/**
 * Writes a level's value on its line, as on a topographic map: the text follows the line and sits in a gap
 * cut out of it. Up to two places per line, spread along it, away from the plot's edges and from other labels.
 */
function labelContour(card: ChartCard, ctx: CanvasRenderingContext2D, frame: Frame, px: Float64Array, text: string, color: string, placed: Box[]): void {
  const edge = 14 * frame.ui;
  const spots: { x: number; y: number; angle: number }[] = [];
  for (let i = 0; i < px.length; i += 4) {
    const x = (px[i] + px[i + 2]) / 2;
    const y = (px[i + 1] + px[i + 3]) / 2;
    if (x < frame.left + edge || x > frame.left + frame.plotW - edge || y < frame.top + edge || y > frame.top + frame.plotH - edge) continue;
    let angle = Math.atan2(px[i + 3] - px[i + 1], px[i + 2] - px[i]);
    if (angle > Math.PI / 2) angle -= Math.PI;
    if (angle < -Math.PI / 2) angle += Math.PI;
    // Steep spots read badly; flatter ones look like a map's labels.
    if (Math.abs(angle) > Math.PI / 3) continue;
    spots.push({ x, y, angle });
  }
  if (spots.length === 0) return;
  spots.sort((a, b) => a.x - b.x);
  card.font(ctx, frame.ui, 10, "600");
  const w = ctx.measureText(text).width + 6 * frame.ui;
  const h = 13 * frame.ui;
  let drawn = 0;
  for (const at of [0.3, 0.75, 0.5, 0.1, 0.9]) {
    if (drawn === 2) break;
    const spot = spots[Math.min(spots.length - 1, Math.floor(at * spots.length))];
    const half = Math.max(w, h) / 2 + 2 * frame.ui;
    const box = { x0: spot.x - half, y0: spot.y - half, x1: spot.x + half, y1: spot.y + half };
    if (placed.some((b) => box.x0 < b.x1 && box.x1 > b.x0 && box.y0 < b.y1 && box.y1 > b.y0)) continue;
    placed.push(box);
    drawn++;
    ctx.save();
    ctx.translate(spot.x, spot.y);
    ctx.rotate(spot.angle);
    ctx.fillStyle = card.plateColor();
    ctx.globalAlpha = 0.9;
    ctx.fillRect(-w / 2, -h / 2, w, h);
    ctx.globalAlpha = 1;
    ctx.fillStyle = color;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, 0, 0.5 * frame.ui);
    ctx.restore();
  }
}

/** `panel`: a small multiple, where the note has its own line under the panel's title. */
export function drawCorrelationNote(card: ChartCard, ctx: CanvasRenderingContext2D, frame: Frame, fit: { slope: number; intercept: number; r2: number } | null = null, r: number = card.seriesCorrelation, panel = false): void {
  if (!Number.isFinite(r)) return;
  card.font(ctx, frame.ui, panel ? 10 : 11, panel ? "" : "600");
  ctx.fillStyle = frame.dim;
  ctx.textAlign = panel ? "left" : "right";
  // R² and the equation are the line's: they appear only with it, and each can be switched off on its own.
  // A small panel's line is tighter: one space round the dots, "0.13x" for "0.13 × x".
  const dot = panel ? " · " : "  ·  ";
  const r2 = fit !== null && (card.config.fitR2 ?? true) ? `${dot}R² = ${(r ** 2).toFixed(2)}` : "";
  const base = `r = ${r.toFixed(2)}${r2}`;
  // Longest first: the equation in column names, then in y and x, then r and R², then r alone.
  const options: string[] = [];
  if (fit !== null && (card.config.fitEquation ?? true)) {
    options.push(`${base}${dot}${fitEquation(fit.slope, fit.intercept, card.meta(card.config.y)?.name ?? "y", card.meta(card.config.x)?.name ?? "x")}`);
    const short = fitEquation(fit.slope, fit.intercept, "y", "x");
    options.push(`${base}${dot}${panel ? short.replace(" × x", "x") : short}`);
  }
  options.push(base, `r = ${r.toFixed(2)}`);
  const room = panel ? frame.plotW : frame.plotW * 0.92;
  const text = options.find((option) => ctx.measureText(option).width <= room);
  if (text !== undefined) ctx.fillText(text, panel ? frame.left : frame.left + frame.plotW - 6 * frame.ui, frame.top - (panel ? 7 : 8) * frame.ui);
  ctx.textAlign = "left";
}

/** A fit line's equation in the chart's own words: "Total = 2.1 × Speed + 230". Three significant figures. */
export function fitEquation(slope: number, intercept: number, yName: string, xName: string): string {
  const figure = (value: number): string => {
    const abs = Math.abs(value);
    if (abs >= 1000) return Math.round(abs).toLocaleString("en-US");
    if (abs === 0) return "0";
    return String(Number(abs.toPrecision(3)));
  };
  const slopeText = `${slope < 0 ? "−" : ""}${figure(slope)} × ${xName}`;
  if (!Number.isFinite(intercept) || Math.abs(intercept) < 1e-12) return `${yName} = ${slopeText}`;
  return `${yName} = ${slopeText} ${intercept < 0 ? "−" : "+"} ${figure(intercept)}`;
}

export function pivotHeatmapData(card: ChartCard): {
    rowLabels: string[];
    colLabels: string[];
    values: Float64Array;
    measureName: string;
    rowName: string;
    colName: string;
    rowLevel: number;
    colLevel: number;
    truncated: boolean;
  } | null {
  const pivot = card.pivotResult;
  if (pivot === null || pivot.measures.length === 0) return null;
  const rowLevel =
    pivot.rowNames.length === 0
      ? -1
      : Math.max(
          0,
          Math.min(
            pivot.rowNames.length - 1,
            card.config.pivotRowLevel ?? pivot.rowNames.length - 1,
          ),
        );
  const colLevel =
    pivot.colNames.length === 0
      ? -1
      : Math.max(
          0,
          Math.min(
            pivot.colNames.length - 1,
            card.config.pivotColLevel ?? pivot.colNames.length - 1,
          ),
        );
  const measureIndex = Math.max(
    0,
    Math.min(
      pivot.measures.length - 1,
      card.config.pivotMeasure ?? 0,
    ),
  );
  const measure = pivot.measures[measureIndex]!;
  const rowFor = (parts: string[]): string =>
    rowLevel < 0 ? "All" : parts[rowLevel] || "All";
  const colFor = (parts: string[]): string =>
    colLevel < 0 ? "All" : parts[colLevel] || "All";
  const rowSet = new Set<string>();
  const colSet = new Set<string>();
  pivot.rowLabels.forEach((parts) => rowSet.add(rowFor(parts)));
  pivot.colLabels.forEach((parts) => colSet.add(colFor(parts)));
  const allRows = [...rowSet];
  const allCols = [...colSet];
  const rowLimit = 80;
  const colLimit = 60;
  const rowLabels = allRows.slice(0, rowLimit);
  const colLabels = allCols.slice(0, colLimit);
  const rowIndex = new Map(rowLabels.map((label, index) => [label, index]));
  const colIndex = new Map(colLabels.map((label, index) => [label, index]));
  const values = new Float64Array(rowLabels.length * colLabels.length).fill(
    Number.NaN,
  );
  for (let row = 0; row < pivot.rowLabels.length; row++) {
    const r = rowIndex.get(rowFor(pivot.rowLabels[row] ?? []));
    if (r === undefined) continue;
    for (let col = 0; col < pivot.colLabels.length; col++) {
      const c = colIndex.get(colFor(pivot.colLabels[col] ?? []));
      if (c === undefined) continue;
      const value = measure.values[row * pivot.colLabels.length + col];
      if (!Number.isFinite(value)) continue;
      const at = r * colLabels.length + c;
      values[at] = Number.isFinite(values[at])
        ? (values[at] as number) + value
        : value;
    }
  }
  return {
    rowLabels,
    colLabels,
    values,
    measureName: measure.name,
    rowName: pivot.rowNames[rowLevel] ?? "All",
    colName: pivot.colNames[colLevel] ?? "All",
    rowLevel,
    colLevel,
    truncated: rowLabels.length < allRows.length || colLabels.length < allCols.length,
  };
}

export function drawPivotHeatmap(card: ChartCard, ctx: CanvasRenderingContext2D, frame: Frame): void {
  if (card.config.source === "" || !card.isPivotSource()) {
    const message = "Choose a pivot view source in the Source menu.";
    card.noteEl.textContent = message;
    card.drawPlotMessage(ctx, frame, message);
    return;
  }
  const data = card.pivotHeatmapData();
  if (
    data === null ||
    data.rowLabels.length === 0 ||
    data.colLabels.length === 0
  ) {
    const message = "The pivot has no rows or columns to draw.";
    card.noteEl.textContent = message;
    card.drawPlotMessage(ctx, frame, message);
    return;
  }
  const { rowLabels, colLabels, values } = data;
  const rowCount = rowLabels.length;
  const colCount = colLabels.length;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    if (!Number.isFinite(value)) continue;
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    const message = "The selected pivot measure has no finite values.";
    card.noteEl.textContent = message;
    card.drawPlotMessage(ctx, frame, message);
    return;
  }
  const domain = resolveColorDomain({
    autoMin: min,
    autoMax: max,
    min: card.config.colorMin,
    max: card.config.colorMax,
    center: card.config.colorCenter,
  });
  const cellW = frame.plotW / colCount;
  const cellH = frame.plotH / rowCount;
  const showText = cellW >= 30 * frame.ui && cellH >= 16 * frame.ui;
  const rampName = card.config.palette ?? DEFAULT_PALETTE;
  const rampStops = isRampPalette(rampName) ? card.rampStopsFor(rampName) : null;
  const colorFor = (t: number): string => colorForFraction(t, rampStops, rampColor);
  const legendColors = colorRamp(rampStops, 16, rampColor);
  card.font(ctx, frame.ui, 9);
  for (let row = 0; row < rowCount; row++) {
    for (let col = 0; col < colCount; col++) {
      const value = values[row * colCount + col] ?? Number.NaN;
      const x = frame.left + col * cellW;
      const y = frame.top + row * cellH;
      if (!Number.isFinite(value)) {
        ctx.fillStyle = frame.border;
        ctx.globalAlpha = 0.3;
        ctx.fillRect(x + 0.5, y + 0.5, Math.max(1, cellW - 1), Math.max(1, cellH - 1));
        ctx.globalAlpha = 1;
        continue;
      }
      const t = colorFraction(value, domain);
      ctx.fillStyle = colorFor(t);
      ctx.fillRect(x + 0.5, y + 0.5, Math.max(1, cellW - 1), Math.max(1, cellH - 1));
      if (showText) {
        ctx.fillStyle = t > 0.55 ? "#ffffff" : frame.text;
        ctx.textAlign = "center";
        ctx.fillText(
          formatChartNumber(value),
          x + cellW / 2,
          y + cellH / 2 + 3.5 * frame.ui,
        );
      }
    }
  }
  card.drawColorBar(ctx, frame, legendColors, domain);
  ctx.textAlign = "center";
  colLabels.forEach((label, col) => {
    ctx.fillStyle = frame.dim;
    ctx.fillText(
      card.fit(ctx, label, Math.max(8, cellW - 4 * frame.ui)),
      frame.left + (col + 0.5) * cellW,
      frame.top + frame.plotH + 14 * frame.ui,
    );
  });
  ctx.textAlign = "right";
  rowLabels.forEach((label, row) => {
    ctx.fillStyle = frame.dim;
    ctx.fillText(
      card.fit(ctx, label, Math.max(8, frame.left - frame.labelPad - 8 * frame.ui)),
      frame.left - frame.labelPad - 4 * frame.ui,
      frame.top + (row + 0.5) * cellH + 3.5 * frame.ui,
    );
  });
  ctx.textAlign = "left";
  const notes = [
    `${data.measureName} by ${data.rowName} x ${data.colName}`,
    `${rowCount}x${colCount} cells`,
  ];
  if (data.truncated) notes.push("large pivot truncated for display");
  if (Number.isFinite(card.pivotResult?.ms ?? Number.NaN)) {
    notes.push(`${Math.round(card.pivotResult?.ms ?? 0)} ms`);
  }
  card.noteEl.textContent = notes.join(" - ");
}

export function drawHeatmap(card: ChartCard, ctx: CanvasRenderingContext2D, frame: Frame): void {
  const result = card.crossResult;
  if (result === null || result.xLabels.length === 0 || result.yLabels.length === 0) {
    const message =
      card.columns.length === 0
        ? "Load data to see charts."
        : "Heatmaps need two category columns — pick them above.";
    card.noteEl.textContent = message;
    card.drawPlotMessage(ctx, frame, message);
    return;
  }
  const ui = frame.ui;
  const xMeta = card.meta(card.config.x);
  const yMeta = card.meta(card.config.y);
  const totalX = result.xLabels.length;
  const totalY = result.yLabels.length;
  const state = card.heatWindow ?? {
    xStart: 0,
    xCount: totalX,
    yStart: 0,
    yCount: totalY,
  };
  const xStart = Math.max(0, Math.min(totalX - 1, state.xStart));
  const yStart = Math.max(0, Math.min(totalY - 1, state.yStart));
  const xCount = Math.max(1, Math.min(state.xCount, totalX - xStart));
  const yCount = Math.max(1, Math.min(state.yCount, totalY - yStart));
  const xLabels = result.xLabels.slice(xStart, xStart + xCount);
  const yLabels = result.yLabels.slice(yStart, yStart + yCount);
  const counts = new Uint32Array(xCount * yCount);
  for (let y = 0; y < yCount; y++) {
    for (let x = 0; x < xCount; x++) {
      counts[y * xCount + x] =
        result.counts[(yStart + y) * totalX + (xStart + x)] ?? 0;
    }
  }
  const codeOf = (meta: ColumnMeta | undefined, label: string): number =>
    meta?.categories?.labels.indexOf(label) ?? -1;
  card.hitRegions = heatmapHitRegions(
    { left: frame.left, top: frame.top, plotW: frame.plotW, plotH: frame.plotH },
    {
      xLabels,
      yLabels,
      counts,
      total: result.total,
      xColumn: card.config.x,
      yColumn: card.config.y,
      codeOfX: (label) => codeOf(xMeta, label),
      codeOfY: (label) => codeOf(yMeta, label),
    },
  );
  const cellW = frame.plotW / xCount;
  const cellH = frame.plotH / yCount;
  let max = 0;
  for (const count of counts) if (count > max) max = count;
  const [r, g, b] = hexToRgb(card.primaryColor());
  const showText = cellW >= 26 * ui && cellH >= 15 * ui;

  card.font(ctx, ui, 10);
  for (let y = 0; y < yCount; y++) {
    for (let x = 0; x < xCount; x++) {
      const count = counts[y * xCount + x] ?? 0;
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
  xLabels.forEach((label, x) => {
    ctx.fillText(
      card.fit(ctx, label, Math.max(8, cellW - 4 * ui)),
      frame.left + (x + 0.5) * cellW,
      frame.top + frame.plotH + 16 * ui,
    );
  });
  ctx.textAlign = "right";
  yLabels.forEach((label, y) => {
    ctx.fillText(
      card.fit(ctx, label, Math.max(8, frame.left - frame.labelPad - 8 * ui)),
      frame.left - frame.labelPad - 4 * ui,
      frame.top + (y + 0.5) * cellH + 3.5 * ui,
    );
  });
  ctx.textAlign = "left";

  const notes = [
    `${xCount}×${yCount} cells`,
    `${result.total.toLocaleString()} rows`,
    `peak ${max.toLocaleString()}`,
  ];
  if (xLabels.includes("Other") || yLabels.includes("Other")) {
    notes.push("rest grouped as Other");
  }
  if (card.statsMs > 0) notes.push(`${Math.round(card.statsMs)} ms`);
  card.noteEl.textContent = notes.join(" · ");
}

export function drawCorrelation(card: ChartCard, ctx: CanvasRenderingContext2D, frame: Frame): void {
  const result = card.correlationResult;
  if (result === null || result.labels.length < 2) {
    let message: string;
    if (card.columns.length === 0) {
      message = "Load data to see charts.";
    } else {
      const numeric = card.columns.filter((meta) => isNumericType(meta.type)).length;
      message = `Correlation needs at least two numeric columns; this file has ${numeric}.`;
    }
    card.noteEl.textContent = message;
    card.drawPlotMessage(ctx, frame, message);
    return;
  }
  const ui = frame.ui;
  const total = result.labels.length;
  const state = card.corrWindow ?? { start: 0, count: total };
  const start = Math.max(0, Math.min(total - 2, state.start));
  const n = Math.max(2, Math.min(state.count, total - start));
  const labels = result.labels.slice(start, start + n);
  const values = new Float64Array(n * n);
  const counts = new Uint32Array(n * n);
  for (let row = 0; row < n; row++) {
    for (let column = 0; column < n; column++) {
      const source = (start + row) * total + (start + column);
      values[row * n + column] = result.values[source] ?? Number.NaN;
      counts[row * n + column] = result.counts[source] ?? 0;
    }
  }
  card.hitRegions = correlationHitRegions(
    { left: frame.left, top: frame.top, plotW: frame.plotW, plotH: frame.plotH },
    { labels, values, counts },
  );
  // Lower triangle only: r is the same both ways round and a column with itself is 1, so a full square would show every pair
  // twice. Row i is column i + 1 against the columns before it.
  const slots = n - 1;
  const sizeX = frame.plotW / slots;
  const sizeY = frame.plotH / slots;
  const gridH = frame.plotH;
  const left = frame.left;
  const top = frame.top;
  const zeroColor = cssVar("--border-subtle", "#eaeef2");
  const showText = Math.min(sizeX, sizeY) >= 30 * ui;
  let minCount = Infinity;

  card.font(ctx, ui, showText ? 10 : 9);
  ctx.strokeStyle = frame.border;
  ctx.lineWidth = 1;
  for (let row = 0; row < slots; row++) {
    for (let column = 0; column <= row; column++) {
      const index = (row + 1) * n + column;
      const r = values[index];
      const cell = correlationCell(r, zeroColor);
      ctx.fillStyle = cell.bg;
      ctx.fillRect(left + column * sizeX, top + row * sizeY, sizeX, sizeY);
      ctx.strokeRect(left + column * sizeX + 0.5, top + row * sizeY + 0.5, sizeX - 1, sizeY - 1);
      if (showText) {
        ctx.fillStyle = cell.fg;
        ctx.textAlign = "center";
        const text = Number.isFinite(r) ? r.toFixed(2) : "—";
        ctx.fillText(text, left + (column + 0.5) * sizeX, top + (row + 0.5) * sizeY + 3.5 * ui);
      }
      const count = counts[index];
      if (count > 0 && count < minCount) minCount = count;
    }
  }
  const corrDomain = resolveColorDomain({ autoMin: -1, autoMax: 1, center: 0 });
  const corrStops = ["#ef4444", zeroColor, "#2563eb"];
  card.drawColorBar(
    ctx,
    frame,
    colorRamp(corrStops, 16, rampColor),
    corrDomain,
  );
  const labelWidth = Math.max(24, sizeX - 2 * ui);
  const abbreviate = (label: string): string => {
    if (ctx.measureText(label).width <= labelWidth) return label;
    const words = label.split(/[\s_]+/).filter((word) => word !== "");
    if (words.length >= 2) {
      const candidate = `${words[0]} ${words[words.length - 1]}`;
      if (ctx.measureText(candidate).width <= labelWidth) return candidate;
    }
    return card.fit(ctx, label, labelWidth);
  };
  ctx.textAlign = "center";
  labels.slice(0, slots).forEach((label, column) => {
    ctx.fillStyle = frame.dim;
    ctx.fillText(abbreviate(label), left + (column + 0.5) * sizeX, top + gridH + 14 * ui);
  });
  ctx.textAlign = "right";
  labels.slice(1).forEach((label, row) => {
    ctx.fillStyle = frame.dim;
    ctx.fillText(
      card.fit(ctx, label, Math.max(8, left - frame.left - 6 * ui)),
      left - 4 * ui,
      top + (row + 0.5) * sizeY + 3.5 * ui,
    );
  });
  ctx.textAlign = "left";

  const notes = [`${n} columns, each pair once`];
  if (Number.isFinite(minCount)) notes.push(`${minCount.toLocaleString()} min pairwise observations`);
  if (card.statsMs > 0) notes.push(`${Math.round(card.statsMs)} ms`);
  card.noteEl.textContent = notes.join(" · ");
}

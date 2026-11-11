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
import type { BubbleLayer, Frame } from "./chart-card.js";
import { BORDER_DARKER, BORDER_ALPHA, addMarkerPath, leastSquares, cropDensityGrid } from "./chart-card.js";

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
  else
    card.drawPoints(
      ctx,
      frame,
      card.plotView === null ? result : { ...result, ...card.plotView },
      xMeta,
      yMeta,
    );
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

export function drawPoints(card: ChartCard, ctx: CanvasRenderingContext2D, frame: Frame, result: SeriesPoints, xMeta: ColumnMeta, yMeta: ColumnMeta): void {
  if (result.shown === 0) {
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

  if (style !== "contours") {
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
    if (style === "contours") card.paintDensityBands(ctx, frame, result, smooth, smoothMax);
    card.paintContourLines(ctx, frame, result, smooth, smoothMax);
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
    style === "heat" ? "heat" : style === "contours" ? "5 contour levels" : "heat + contour lines",
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

export function paintDensityBands(card: ChartCard, ctx: CanvasRenderingContext2D, frame: Frame, result: SeriesGrid, smooth: Float64Array, smoothMax: number): void {
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

export function paintContourLines(card: ChartCard, ctx: CanvasRenderingContext2D, frame: Frame, result: SeriesGrid, smooth: Float64Array, smoothMax: number): void {
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

export function drawCorrelationNote(card: ChartCard, ctx: CanvasRenderingContext2D, frame: Frame, fit: { slope: number; intercept: number; r2: number } | null = null): void {
  if (!Number.isFinite(card.seriesCorrelation)) return;
  card.font(ctx, frame.ui, 11, "600");
  ctx.fillStyle = frame.dim;
  ctx.textAlign = "right";
  // R² is the line's: it appears only with the line, and can be switched off on its own. Every row, like r.
  const r2 = fit !== null && (card.config.fitR2 ?? true) ? `  ·  R² = ${(card.seriesCorrelation ** 2).toFixed(2)}` : "";
  ctx.fillText(
    `r = ${card.seriesCorrelation.toFixed(2)}${r2}`,
    frame.left + frame.plotW - 6 * frame.ui,
    frame.top - 8 * frame.ui,
  );
  ctx.textAlign = "left";
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

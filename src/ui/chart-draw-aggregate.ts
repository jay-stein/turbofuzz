/**
 * Drawing a chart of grouped numbers: bars and lines from the worker's aggregate, split into series, with the legend.
 *
 * Moved out of chart-card.ts: each function takes the card it works on, and the card keeps a
 * one-line method of the same name that calls it.
 */
import { type HitAction, groupedSeriesHitRegions, seriesHitRegions } from "./chart-hit-regions.js";
import { measuresToSeries } from "../data/pivot-chart.js";
import { smoothSeries } from "../data/kde.js";
import { TYPE_LABELS } from "../types.js";
import type { AggregateMessage } from "../worker/protocol.js";
import { axisKindFor, type AxisFormat, formatChartNumber, formatCompact, calendarTicks, fillTimeAxis, formatCount, formatTick, isGroupable, isNumericType, niceTicks, plainMeasureName } from "./chart-utils.js";
import { el } from "./dom.js";
import type { ChartCard } from "./chart-card.js";
import type { Frame } from "./chart-card-types.js";
import { RANKED_BARS_ABOVE, SPLIT_AXIS_LIMIT, GROUP_LINE_LIMIT, KDE_SIGMA_BINS } from "./chart-card-types.js";

/** Wrapped message drawn inside the empty plot area. */
export function drawPlotMessage(card: ChartCard, ctx: CanvasRenderingContext2D, frame: Frame, message: string): void {
  card.plotMessageDrawn = true;
  card.font(ctx, frame.ui, 12);
  ctx.fillStyle = frame.dim;
  ctx.textAlign = "center";
  const maxWidth = Math.max(40, frame.plotW - 24 * frame.ui);
  const lines: string[] = [];
  let line = "";
  for (const word of message.split(" ")) {
    const candidate = line === "" ? word : `${line} ${word}`;
    if (line !== "" && ctx.measureText(candidate).width > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line !== "") lines.push(line);
  const lineHeight = 16 * frame.ui;
  const startY = frame.top + frame.plotH / 2 - ((lines.length - 1) * lineHeight) / 2;
  lines.forEach((text, index) => {
    ctx.fillText(
      text,
      frame.left + frame.plotW / 2,
      startY + index * lineHeight + 4 * frame.ui,
    );
  });
  ctx.textAlign = "left";
}

/** Honest reason a series-style card has nothing to plot. */
export function emptySeriesMessage(card: ChartCard, kind: "histogram" | "line" | "bar"): string {
  if (kind === "line" && !card.columns.some((meta) => card.isDateLike(meta))) {
    return "No date or datetime column in this file.";
  }
  const chartable = card.columns.some(
    (meta) =>
      isNumericType(meta.type) ||
      meta.type === "date" ||
      meta.type === "datetime" ||
      meta.type === "time" ||
      meta.type === "duration" ||
      isGroupable(meta),
  );
  if (!chartable) {
    return "This file has no numeric, temporal or category columns. Change a column's type in the filter list.";
  }
  return "Pick a column to chart.";
}

export function subtitle(card: ChartCard): string {
  if (card.config.kind === "pivotHeatmap") {
    const data = card.pivotHeatmapData();
    if (data === null) return "Pivot view - waiting for the first result";
    return `${data.measureName} - ${data.rowName} x ${data.colName} - ${data.rowLabels.length}x${data.colLabels.length} cells`;
  }
  if (card.config.kind === "kpi" && card.usesValueAggregate()) {
    const result = card.aggregateResult();
    const measure = result?.measureNames[0] ?? "measure";
    if (result === null || result.dimensionNames.length === 0) {
      return `${measure} · all filtered rows`;
    }
    return `${measure} over ${result.dimensionNames[0]} · ${result.groupCount.toLocaleString()} buckets`;
  }
  const rows = `${card.rowCount.toLocaleString()} rows shown`;
  if (card.config.kind === "map") {
    const lon = card.meta(card.config.x)?.name ?? "longitude";
    const lat = card.meta(card.config.y)?.name ?? "latitude";
    return `${lat} × ${lon} · ${rows}`;
  }
  if (card.usesAggregate()) {
    const result = card.aggregateResult();
    if (result === null) return "Aggregate · waiting for the first result";
    const two = result.dimensions.length >= 2;
    if (result.dimensionIsTime[0] === true && card.config.source === "") {
      const periods = result.groupCount;
      const step = card.resolvedGrain();
      const every = card.everyFor(step);
      const unit = every > 1 ? `${every}-${step} period` : step;
      return `${plainMeasureName(result.measureNames[0] ?? "measure")}${
        two ? ` by ${result.dimensionNames[1] ?? "group"}` : ""
      } per ${card.stepNoun()} · ${two ? `${periods.toLocaleString()} values` : `${periods.toLocaleString()} ${periods === 1 ? unit : `${unit}s`}`}`;
    }
    return `${plainMeasureName(result.measureNames[0] ?? "measure")} by ${result.dimensionNames[0] ?? "group"}${
      two ? ` and ${result.dimensionNames[1] ?? "group"}` : ""
    } · ${result.groupCount.toLocaleString()} ${two ? "values" : "groups"}`;
  }
  if (card.config.kind === "scatter" || card.config.kind === "density") {
    const x = card.meta(card.config.x)?.name ?? "X";
    const y = card.meta(card.config.y)?.name ?? "Y";
    const series = card.seriesResult;
    // Not "30,021 rows shown" over a plot of a sample of them.
    const sample = series !== null && series.mode === "points" && series.sampled ? `${series.shown.toLocaleString()} points sampled from ${series.total.toLocaleString()}` : rows;
    return `${x} vs ${y} · ${sample}`;
  }
  if (card.config.kind === "box") {
    const value = card.meta(card.config.x)?.name ?? "Value";
    const group = card.meta(card.config.y)?.name ?? "groups";
    return `${value} by ${group} · ${rows}`;
  }
  if (card.config.kind === "heatmap") {
    const x = card.meta(card.config.x)?.name ?? "X";
    const y = card.meta(card.config.y)?.name ?? "Y";
    return `${x} × ${y} · ${rows}`;
  }
  if (card.config.kind === "correlation") {
    return `Pearson r · ${rows}`;
  }
  const meta = card.meta(card.config.column);
  if (meta === undefined) return rows;
  return `${TYPE_LABELS[meta.type]} · ${rows} · ${meta.stats.distinct.toLocaleString()} distinct`;
}

export function drawChart(card: ChartCard, ctx: CanvasRenderingContext2D, width: number, height: number, forExport = false): void {
  ctx.clearRect(0, 0, width, height);
  card.splitLegend = null;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  card.hitRegions = [];
  card.plotMessageDrawn = false;
  const ui = card.textScale(height, forExport);
  const labels = card.axisLabels();
  card.plotHasHeadline = card.options.docked === true && !forExport;
  const hasXTitle =
    (labels.x ?? "") !== "" || (card.config.xTitle?.trim() ?? "") !== "";
  const hasYTitle =
    (labels.y ?? "") !== "" ||
    (card.config.yTitle?.trim() ?? "") !== "" ||
    (card.config.yUnit?.trim() ?? "") !== "";
  const frame = card.frame(
    ctx,
    width,
    height,
    forExport,
    card.widestYLabel(ctx, ui),
    hasYTitle,
    hasXTitle,
  );
  card.lastFrame = frame;

  if (card.columns.length === 0) {
    card.noteEl.textContent = "Load data to see charts.";
    card.drawPlotMessage(ctx, frame, "Load data to see charts.");
    return;
  }

  // The card heading above the plot already says what this aggregate is, so a
  // generic "Aggregate" title is not drawn a second time.
  const ownTitle = card.config.title.trim();
  const genericAggregate =
    ownTitle === "" && card.options.docked !== true && card.usesAggregate() && card.config.kind !== "pivotHeatmap" && card.config.kind !== "kpi";
  if (card.plotHasHeadline) {
    // One line above the plot says what this is; a title typed by the person is shown on it too.
    if (ownTitle !== "" && card.options.titleOutside !== true) {
      card.font(ctx, frame.ui, 13, "600");
      ctx.fillStyle = frame.text;
      ctx.fillText(card.fit(ctx, ownTitle, width - frame.left - frame.right), frame.left, 14 * frame.ui);
    }
  } else if (!genericAggregate) {
    const title = ownTitle === "" ? card.defaultTitle() : ownTitle;
    card.font(ctx, frame.ui, 15, "600");
    ctx.fillStyle = frame.text;
    ctx.fillText(card.fit(ctx, title, width - frame.left - frame.right), frame.left, 22 * frame.ui);
  }
  if (!card.plotHasHeadline) {
    card.font(ctx, frame.ui, genericAggregate ? 12 : 11);
    ctx.fillStyle = frame.dim;
    ctx.fillText(
      card.fit(ctx, card.subtitle(), width - frame.left - frame.right),
      frame.left,
      (genericAggregate ? 24 : 40) * frame.ui,
    );
  }

  if (card.config.kind === "pivotHeatmap") {
    card.drawPivotHeatmap(ctx, frame);
    return;
  }

  if (card.usesAggregate()) {
    card.drawViewAggregate(ctx, frame);
    card.appendErrorBarNote(card.aggregateResult());
    return;
  }

  switch (card.config.kind) {
    case "bar":
      card.drawBars(ctx, frame);
      break;
    case "scatter":
    case "density":
      card.drawScatterLike(ctx, frame);
      break;
    case "box":
      card.drawBox(ctx, frame);
      break;
    case "treemap":
      card.drawTreemap(ctx, frame);
      break;
    case "terms":
      card.drawTerms(ctx, frame);
      break;
    case "heatmap":
      card.drawHeatmap(ctx, frame);
      break;
    case "bubble":
      card.drawBubble(ctx, frame);
      break;
    case "correlation":
      card.drawCorrelation(ctx, frame);
      break;
    case "map":
      card.drawMap(ctx, frame);
      break;
    case "kpi":
    case "barplot":
    case "dotplot":
    case "stacked100":
    case "smallmultiples":
    case "slopegraph":
    case "waterfall": {
      const message = "Pick a numeric measure in the card settings.";
      card.noteEl.textContent = message;
      card.drawPlotMessage(ctx, frame, message);
      break;
    }
    default:
      card.drawSeries(ctx, frame, card.config.kind);
      break;
  }

  if (!card.plotMessageDrawn) {
    card.drawAxisTitles(ctx, frame, labels.x, labels.y);
  }

  if (card.config.suggested !== "") {
    const existing = card.noteEl.textContent ?? "";
    card.noteEl.textContent =
      existing === ""
        ? `Suggested: ${card.config.suggested}`
        : `${existing} · Suggested: ${card.config.suggested}`;
  }
}

/**
 * Split-by series: a line/bar card whose aggregate carries a second (group)
 * dimension draws one colored series per group value. The top 8 groups by
 * absolute total are drawn; a legend names them and the note counts the rest.
 */
export function drawSplitAggregate(card: ChartCard, ctx: CanvasRenderingContext2D, frame: Frame, result: AggregateMessage, values: Float64Array): void {
  const n = result.groupCount;
  const bucketLabels = result.dimensions[0] ?? [];
  const groupLabels = result.dimensions[1] ?? [];
  const bucketIndex = new Map<string, number>();
  let buckets: string[] = [];
  for (let i = 0; i < n; i++) {
    const label = bucketLabels[i] ?? "";
    if (!bucketIndex.has(label)) {
      bucketIndex.set(label, buckets.length);
      buckets.push(label);
    }
  }
  // A pivot can have hundreds of rows, and a group of bars for each is unreadable: a chart of
  // one shows the biggest (they arrive largest first) and says how many it left out.
  const axisTotal = buckets.length;
  if (card.config.source !== "" && result.dimensionIsTime[0] !== true && buckets.length > SPLIT_AXIS_LIMIT) {
    buckets = buckets.slice(0, SPLIT_AXIS_LIMIT);
    for (const label of [...bucketIndex.keys()]) if ((bucketIndex.get(label) ?? 0) >= SPLIT_AXIS_LIMIT) bucketIndex.delete(label);
  }
  // A time axis keeps empty periods in place (series show a gap there) rather
  // than letting the neighbouring periods close up.
  let bucketTimes: number[] | null = null;
  const groupTimesRaw = result.dimensionTimes[0];
  if (result.dimensionIsTime[0] === true && groupTimesRaw !== undefined && groupTimesRaw.length === n) {
    const labelByTime = new Map<number, string>();
    for (let i = 0; i < n; i++) {
      const time = groupTimesRaw[i];
      if (Number.isFinite(time) && !labelByTime.has(time)) labelByTime.set(time, bucketLabels[i] ?? "");
    }
    const axis = fillTimeAxis([...labelByTime.keys()], card.resolvedGrain(), 20_000, card.everyFor(card.resolvedGrain()));
    if (axis.length > 0) {
      bucketTimes = axis;
      buckets = axis.map((time) => labelByTime.get(time) ?? `${new Date(time).toISOString().slice(0, 10)} (no data)`);
      bucketIndex.clear();
      buckets.forEach((label, index) => bucketIndex.set(label, index));
    }
  }
  interface SplitSeries {
    label: string;
    color: string;
    total: number;
    values: Float64Array;
    /** Where it first appeared: for a pivot chart, the pivot's own column order. */
    first: number;
  }
  const byGroup = new Map<string, SplitSeries>();
  for (let i = 0; i < n; i++) {
    const label = groupLabels[i] ?? "(missing)";
    let entry = byGroup.get(label);
    if (entry === undefined) {
      entry = {
        label,
        color: card.groupColor(byGroup.size),
        total: 0,
        values: new Float64Array(buckets.length).fill(Number.NaN),
        first: byGroup.size,
      };
      byGroup.set(label, entry);
    }
    const value = values[i] ?? Number.NaN;
    const bucket = bucketIndex.get(bucketLabels[i] ?? "");
    if (Number.isFinite(value) && bucket !== undefined) {
      entry.values[bucket] = value;
      entry.total += Math.abs(value);
    }
  }
  const all = [...byGroup.values()].sort((a, b) => b.total - a.total);
  const seriesLimit = Math.max(1, Math.min(12, card.config.topN));
  let shown = all.slice(0, seriesLimit);
  // The largest are kept, but a pivot's series read in the pivot's order: years in year order.
  if (card.config.source !== "") shown.sort((a, b) => a.first - b.first);
  if (card.config.groupOther && all.length > seriesLimit) {
    const other: SplitSeries = {
      label: "Other",
      color: card.groupColor(shown.length),
      total: 0,
      values: new Float64Array(buckets.length).fill(Number.NaN),
      first: byGroup.size,
    };
    for (const series of all.slice(seriesLimit)) {
      other.total += series.total;
      for (let bucket = 0; bucket < buckets.length; bucket++) {
        const value = series.values[bucket] ?? Number.NaN;
        if (!Number.isFinite(value)) continue;
        other.values[bucket] = Number.isFinite(other.values[bucket])
          ? (other.values[bucket] as number) + value
          : value;
      }
    }
    shown = [...shown, other];
  }
  card.splitLegend = shown.map((series) => ({ label: series.label, color: series.color }));
  shown = shown.filter((series) => !card.hiddenSplit.has(series.label));
  if (shown.length === 0) {
    const message = card.hiddenSplit.size > 0 ? "Every series is hidden. Click a name in the legend to show it." : "The aggregate has no groups to draw yet.";
    card.noteEl.textContent = message;
    card.drawPlotMessage(ctx, frame, message);
    return;
  }
  // Periods a series has no rows for follow the chart's Missing periods rule, as on an unsplit
  // line: a total really is zero there, a running total stays where it was, anything else is a gap.
  if (bucketTimes !== null && card.config.source === "") {
    const calc = card.config.valueCalc;
    const policy = calc === "cumulative" ? "carry" : calc !== undefined ? "gap" : card.fillPolicy();
    if (policy !== "gap") {
      for (const series of shown) {
        let last = Number.NaN;
        let seen = false;
        for (let b = 0; b < series.values.length; b++) {
          const value = series.values[b] ?? Number.NaN;
          if (Number.isFinite(value)) {
            last = value;
            seen = true;
          } else if (policy === "zero") series.values[b] = 0;
          else if (seen) series.values[b] = last;
        }
      }
    }
  }
  const ui = frame.ui;
  const stacked =
    (card.config.kind === "barplot" || card.config.source !== "") && (card.config.barLayout ?? "group") === "stack";
  let max = 0;
  if (stacked) {
    for (let bucket = 0; bucket < buckets.length; bucket++) {
      let total = 0;
      for (const series of shown) {
        const value = series.values[bucket] ?? Number.NaN;
        if (Number.isFinite(value) && value > 0) total += value;
      }
      if (total > max) max = total;
    }
  } else {
    for (const series of shown) {
      for (const value of series.values) {
        if (Number.isFinite(value)) max = Math.max(max, value);
      }
    }
  }
  const top = Math.max(1, max);

  // Shared y grid and baseline (same shape as the single-series bars).
  const yTicks = niceTicks(0, top, 4).filter(
    (value, index, list) =>
      index === 0 || formatChartNumber(value) !== formatChartNumber(list[index - 1]),
  );
  ctx.strokeStyle = frame.border;
  ctx.lineWidth = 1;
  ctx.fillStyle = frame.dim;
  card.font(ctx, ui, 10);
  ctx.textAlign = "right";
  for (const value of yTicks) {
    const y = frame.top + frame.plotH - (value / top) * frame.plotH;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(frame.left, y + 0.5);
    ctx.lineTo(frame.left + frame.plotW, y + 0.5);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillText(formatCompact(value), frame.left - 6 * ui, y + 3 * ui);
  }
  ctx.textAlign = "left";
  ctx.beginPath();
  ctx.moveTo(frame.left, frame.top + frame.plotH + 0.5);
  ctx.lineTo(frame.left + frame.plotW, frame.top + frame.plotH + 0.5);
  ctx.stroke();

  const slot = frame.plotW / Math.max(1, buckets.length);
  const lineCard = result.dimensionIsTime[0] === true;
  if (lineCard) {
    for (const series of shown) {
      ctx.strokeStyle = series.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      let started = false;
      // A period with a gap on both sides has no line to belong to: it is drawn as a dot,
      // so a series of scattered periods is never an empty chart.
      const lone: [number, number][] = [];
      for (let b = 0; b < buckets.length; b++) {
        const value = series.values[b] ?? Number.NaN;
        if (!Number.isFinite(value)) {
          started = false;
          continue;
        }
        const x = frame.left + (b + 0.5) * slot;
        const y = frame.top + frame.plotH - (value / top) * frame.plotH;
        if (!started) {
          ctx.moveTo(x, y);
          started = true;
          if (!Number.isFinite(series.values[b + 1] ?? Number.NaN)) lone.push([x, y]);
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
      ctx.fillStyle = series.color;
      for (const [x, y] of lone) {
        ctx.beginPath();
        ctx.arc(x, y, 1.75 * ui, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  } else if (stacked) {
    for (let b = 0; b < buckets.length; b++) {
      let base = 0;
      for (const series of shown) {
        const value = series.values[b] ?? Number.NaN;
        if (!Number.isFinite(value) || value <= 0) continue;
        const height = (value / top) * frame.plotH;
        ctx.fillStyle = series.color;
        ctx.globalAlpha = 0.85;
        card.fillTopRounded(
          ctx,
          frame.left + b * slot + slot * 0.1,
          frame.top + frame.plotH - base - height,
          Math.max(1, slot * 0.8),
          height,
          2 * ui,
        );
        base += height;
      }
      ctx.globalAlpha = 1;
    }
  } else {
    const barW = Math.max(1, (slot * 0.8) / shown.length);
    shown.forEach((series, s) => {
      ctx.fillStyle = series.color;
      ctx.globalAlpha = 0.85;
      for (let b = 0; b < buckets.length; b++) {
        const value = series.values[b] ?? Number.NaN;
        if (!Number.isFinite(value) || value <= 0) continue;
        const height = (value / top) * frame.plotH;
        card.fillTopRounded(
          ctx,
          frame.left + b * slot + slot * 0.1 + s * barW,
          frame.top + frame.plotH - height,
          Math.max(1, barW - 1),
          height,
          2 * ui,
        );
      }
      ctx.globalAlpha = 1;
    });
  }

  ctx.fillStyle = frame.dim;
  card.font(ctx, ui, 10);
  ctx.textAlign = "center";
  if (bucketTimes !== null) {
    const room = Math.max(3, Math.floor(frame.plotW / (70 * ui)));
    for (const tick of calendarTicks(bucketTimes, room)) {
      ctx.fillText(tick.label, frame.left + (tick.index + 0.5) * slot, frame.top + frame.plotH + 14 * ui);
    }
  } else {
    const step = Math.max(1, Math.ceil(buckets.length / 8));
    for (let b = 0; b < buckets.length; b += step) {
      ctx.fillText(
        card.fit(ctx, buckets[b] ?? "", Math.max(16, slot * step - 4 * ui)),
        frame.left + (b + 0.5) * slot,
        frame.top + frame.plotH + 14 * ui,
      );
    }
  }
  ctx.textAlign = "left";
  if (bucketTimes !== null && lineCard && card.config.source === "") {
    card.brushSpace = card.timeSlotBrush(bucketTimes, card.config.column, frame);
  }
  // The legend is the clickable one under the chart (same colours, toggles series).

  const measure = result.measureNames[0] ?? "measure";
  ctx.fillStyle = frame.dim;
  ctx.fillText(
    `${plainMeasureName(measure)} · ${shown.length}${all.length > shown.length ? ` of ${all.length}` : ""} series`,
    frame.left,
    frame.top + frame.plotH + 30 * ui,
  );
  card.noteEl.textContent = `${plainMeasureName(measure)} by ${
    result.dimensionNames[1] ?? "group"
  } · ${shown.length} of ${all.length} series shown${stacked ? " (stacked)" : ""} · ${
    axisTotal > buckets.length && bucketTimes === null
      ? `the ${buckets.length} largest of ${axisTotal.toLocaleString()} ${result.dimensionNames[0] ?? "groups"}`
      : `${result.dimensionNames[0] ?? "group"} advances left to right`
  }`;
}

/**
 * Many categories: horizontal bars, every name readable, the first Top N in the chart's order.
 * A total can gather the rest into Other; an average cannot, so the note counts what is left out.
 */
export function drawRankedBars(card: ChartCard, ctx: CanvasRenderingContext2D, frame: Frame, result: AggregateMessage, values: Float64Array): void {
  const ui = frame.ui;
  const n = result.groupCount;
  const limit = Math.min(n, Math.max(1, card.config.topN));
  const measure = plainMeasureName(result.measureNames[0] ?? "value");
  const agg = card.config.valueAgg ?? "mean";
  const additive = (card.config.valueColumn ?? -1) < 0 || agg === "sum" || agg === "count";
  let rest = 0;
  for (let i = limit; i < n; i++) if (Number.isFinite(values[i])) rest += values[i]!;
  const withOther = additive && card.config.groupOther && limit < n;
  const rows: { label: string; value: number; index: number }[] = [];
  for (let i = 0; i < limit; i++) rows.push({ label: result.labels[i] === "" ? "(blank)" : (result.labels[i] ?? ""), value: values[i] ?? Number.NaN, index: i });
  if (withOther) rows.push({ label: `Other (${(n - limit).toLocaleString()})`, value: rest, index: -1 });
  let top = 0;
  for (const row of rows) if (Number.isFinite(row.value)) top = Math.max(top, Math.abs(row.value));
  for (const row of rows) if (row.index >= 0) top = Math.max(top, card.errorBarAt(result, row.index)?.high ?? 0);
  top = Math.max(top, 1e-12);
  card.font(ctx, ui, 11);
  let widest = 0;
  for (const row of rows) widest = Math.max(widest, ctx.measureText(row.label).width);
  const labelW = Math.min(frame.plotW * 0.34, widest + 8 * ui);
  const left = Math.max(frame.left, labelW + 10 * ui);
  const valueW = 62 * ui;
  const barsW = Math.max(10, frame.left + frame.plotW - left - valueW);
  const slot = frame.plotH / rows.length;
  const barH = Math.max(3, Math.min(slot * 0.72, 30 * ui));
  const dimensionColumn = card.config.source === "" ? card.config.column : -1;
  const codes = card.meta(dimensionColumn)?.categories?.labels ?? [];
  card.hitRegions = [];
  rows.forEach((row, k) => {
    const y = frame.top + k * slot;
    const width = Number.isFinite(row.value) ? (Math.abs(row.value) / top) * barsW : 0;
    ctx.fillStyle = row.index < 0 ? frame.dim : card.primaryColor();
    ctx.globalAlpha = row.index < 0 ? 0.5 : 0.85;
    ctx.fillRect(left, y + (slot - barH) / 2, width, barH);
    ctx.globalAlpha = 1;
    const middle = y + slot / 2 + 4 * ui;
    card.font(ctx, ui, 11);
    ctx.textAlign = "right";
    ctx.fillStyle = frame.text;
    ctx.fillText(card.fit(ctx, row.label, labelW), left - 6 * ui, middle);
    ctx.textAlign = "left";
    ctx.fillStyle = frame.dim;
    const bar = row.index < 0 ? null : card.errorBarAt(result, row.index);
    const barEnd = bar === null ? 0 : (Math.max(0, bar.high) / top) * barsW;
    ctx.fillText(Number.isFinite(row.value) ? formatCompact(row.value) : "—", left + Math.max(width, barEnd) + 5 * ui, middle);
    if (bar !== null) {
      const mid = y + slot / 2;
      card.drawWhisker(ctx, frame, left + (Math.max(0, bar.low) / top) * barsW, mid, left + barEnd, mid);
    }
    const code = row.index < 0 ? -1 : codes.indexOf(result.labels[row.index] ?? "");
    card.hitRegions.push({
      x: 0,
      y,
      w: frame.left + frame.plotW,
      h: slot,
      lines: [row.label, `${measure}: ${Number.isFinite(row.value) ? formatChartNumber(row.value) : "—"}`, ...(row.index < 0 ? [] : card.errorBarLine(result, row.index))],
      actions: code >= 0 ? [{ kind: "values", column: dimensionColumn, code }] : [],
    });
  });
  ctx.textAlign = "left";
  const ordered = (card.config.chartSort ?? "none") === "none" || card.config.chartSort === "valueDesc";
  const leftOut = withOther ? "" : limit < n ? ` · ${(n - limit).toLocaleString()} more not shown (raise Top bars in the chart settings)` : "";
  card.noteEl.textContent = `${ordered ? "Top" : "First"} ${limit.toLocaleString()} of ${n.toLocaleString()} ${result.dimensionNames[0] ?? "groups"}${leftOut}`;
}

export function drawViewAggregate(card: ChartCard, ctx: CanvasRenderingContext2D, frame: Frame): void {
  const result = card.aggregateResult();
  if (result === null || result.groupCount === 0) {
    const message = "The aggregate has no groups to draw yet.";
    card.noteEl.textContent = message;
    card.drawPlotMessage(ctx, frame, message);
    return;
  }
  const values = result.measures[0];
  if (values === undefined) {
    const message = "The aggregate has no measures.";
    card.noteEl.textContent = message;
    card.drawPlotMessage(ctx, frame, message);
    return;
  }
  if (card.config.source === "" && card.drawExtraKind(ctx, frame, result, values)) return;
  if (card.config.source === "" && result.dimensions.length === 1 && result.measures.length > 1 && card.extraValues().length > 0) {
    const columns = [card.config.valueColumn ?? -1, ...card.extraValues()];
    const long = measuresToSeries(result, columns.map((column) => card.meta(column)?.name ?? "value"));
    card.drawSplitAggregate(ctx, frame, long, long.measures[0] ?? new Float64Array(0));
    return;
  }
  if (result.dimensions.length >= 2) {
    card.drawSplitAggregate(ctx, frame, result, values);
    return;
  }
  if (card.config.kind === "kpi" && card.config.source === "") {
    card.drawKpi(ctx, frame, result, values);
    return;
  }
  if (result.dimensionIsTime[0] !== true && result.groupCount > RANKED_BARS_ABOVE) {
    card.drawRankedBars(ctx, frame, result, values);
    return;
  }
  const ui = frame.ui;
  const n = result.groupCount;
  let max = 0;
  for (const value of values) {
    if (Number.isFinite(value)) max = Math.max(max, value);
  }
  for (let i = 0; i < n; i++) max = Math.max(max, card.errorBarAt(result, i)?.high ?? 0);
  // Room above the tallest bar for its value label, clear of any whisker.
  const labelled = result.dimensionIsTime[0] !== true && n <= RANKED_BARS_ABOVE && card.options.docked === true;
  const top = Math.max(1, labelled ? max * 1.1 : max);

  const yTicks = niceTicks(0, top, 4).filter((value, index, all) => index === 0 || formatChartNumber(value) !== formatChartNumber(all[index - 1]));
  ctx.strokeStyle = frame.border;
  ctx.lineWidth = 1;
  ctx.fillStyle = frame.dim;
  card.font(ctx, ui, 10);
  ctx.textAlign = "right";
  for (const value of yTicks) {
    const y = frame.top + frame.plotH - (value / top) * frame.plotH;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(frame.left, y + 0.5);
    ctx.lineTo(frame.left + frame.plotW, y + 0.5);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillText(formatCompact(value), frame.left - 6 * ui, y + 3 * ui);
  }
  ctx.textAlign = "left";
  ctx.beginPath();
  ctx.moveTo(frame.left, frame.top + frame.plotH + 0.5);
  ctx.lineTo(frame.left + frame.plotW, frame.top + frame.plotH + 0.5);
  ctx.stroke();

  const slot = frame.plotW / Math.max(1, n);
  const isTime = result.dimensionIsTime[0] === true;
  ctx.strokeStyle = card.primaryColor();
  ctx.fillStyle = card.primaryColor();
  let gapPeriods = 0;
  if (isTime) {
    // A missing period (NaN) breaks the line; it is never drawn as a zero.
    const base = frame.top + frame.plotH;
    let segment: { x: number; y: number }[] = [];
    const flush = (): void => {
      if (segment.length === 0) return;
      ctx.beginPath();
      segment.forEach((point, k) => (k === 0 ? ctx.moveTo(point.x, point.y) : ctx.lineTo(point.x, point.y)));
      ctx.lineWidth = 2;
      ctx.stroke();
      if (segment.length === 1) {
        ctx.beginPath();
        ctx.arc(segment[0]!.x, segment[0]!.y, 2.5 * ui, 0, Math.PI * 2);
        ctx.fill();
      } else if (card.errorBarResult === null) {
        ctx.lineTo(segment[segment.length - 1]!.x, base);
        ctx.lineTo(segment[0]!.x, base);
        ctx.closePath();
        ctx.globalAlpha = 0.18;
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      segment = [];
    };
    // The band first, under the line; it replaces the usual area fill, which would read as part of it.
    if (card.errorBarResult !== null) {
      const clamp = (value: number): number => Math.max(frame.top, Math.min(base, base - (value / top) * frame.plotH));
      let band: { x: number; low: number; high: number }[] = [];
      const paint = (): void => {
        if (band.length === 1) {
          card.drawWhisker(ctx, frame, band[0]!.x, band[0]!.low, band[0]!.x, band[0]!.high);
        } else if (band.length > 1) {
          ctx.beginPath();
          band.forEach((point, k) => (k === 0 ? ctx.moveTo(point.x, point.high) : ctx.lineTo(point.x, point.high)));
          for (let k = band.length - 1; k >= 0; k--) ctx.lineTo(band[k]!.x, band[k]!.low);
          ctx.closePath();
          ctx.globalAlpha = 0.25;
          ctx.fillStyle = card.primaryColor();
          ctx.fill();
          ctx.globalAlpha = 1;
        }
        band = [];
      };
      for (let i = 0; i < n; i++) {
        const bar = card.errorBarAt(result, i);
        if (bar === null) {
          paint();
          continue;
        }
        band.push({ x: frame.left + (i + 0.5) * slot, low: clamp(bar.low), high: clamp(bar.high) });
      }
      paint();
      ctx.fillStyle = card.primaryColor();
      ctx.strokeStyle = card.primaryColor();
    }
    // An incomplete edge period (the data starts or stops inside it) is drawn
    // as a hollow point joined by a dashed line, with no area under it: at full
    // strength a half month reads as a collapse in the business.
    const partials = result.partials ?? null;
    const dashed = (from: { x: number; y: number }, to: { x: number; y: number }): void => {
      ctx.save();
      ctx.setLineDash([5 * ui, 4 * ui]);
      ctx.globalAlpha = 0.7;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
      ctx.restore();
    };
    let afterPartial: { x: number; y: number } | null = null;
    for (let i = 0; i < n; i++) {
      const value = values[i];
      if (!Number.isFinite(value)) {
        gapPeriods++;
        // Shade the empty period so the gap is visible, not just absent.
        ctx.save();
        ctx.globalAlpha = 0.07;
        ctx.fillStyle = frame.dim;
        ctx.fillRect(frame.left + i * slot, frame.top, slot, frame.plotH);
        ctx.restore();
        flush();
        afterPartial = null;
        continue;
      }
      const point = { x: frame.left + (i + 0.5) * slot, y: base - (value / top) * frame.plotH };
      if (partials?.[i] === true) {
        const previous = segment[segment.length - 1];
        flush();
        if (previous !== undefined) dashed(previous, point);
        ctx.save();
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(point.x, point.y, 3.5 * ui, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
        afterPartial = point;
        continue;
      }
      if (afterPartial !== null) {
        dashed(afterPartial, point);
        afterPartial = null;
      }
      segment.push(point);
    }
    flush();
  } else {
    // A few bars get air between them and their value on top; many stay a solid profile.
    const roomy = n <= RANKED_BARS_ABOVE && card.options.docked === true;
    const barW = roomy ? Math.max(1, slot * 0.8) : Math.max(1, slot - 1);
    const inset = roomy ? (slot - barW) / 2 : 0;
    for (let i = 0; i < n; i++) {
      const height = ((values[i] || 0) / top) * frame.plotH;
      if (height <= 0) continue;
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = card.primaryColor();
      card.fillTopRounded(ctx, frame.left + i * slot + inset, frame.top + frame.plotH - height, barW, height, 3 * ui);
      ctx.globalAlpha = 1;
      const bar = card.errorBarAt(result, i);
      const base = frame.top + frame.plotH;
      const barTop = bar === null ? base - height : base - (Math.max(0, bar.high) / top) * frame.plotH;
      if (bar !== null) {
        const x = frame.left + (i + 0.5) * slot;
        card.drawWhisker(ctx, frame, x, base - (Math.max(0, bar.low) / top) * frame.plotH, x, barTop);
      }
      if (roomy) {
        card.font(ctx, ui, 10);
        ctx.textAlign = "center";
        ctx.fillStyle = frame.text;
        ctx.fillText(formatCompact(values[i] ?? 0), frame.left + (i + 0.5) * slot, Math.max(frame.top + 10 * ui, Math.min(base - height, barTop) - 4 * ui));
        ctx.textAlign = "left";
      }
    }
    ctx.globalAlpha = 1;
  }

  // Incomplete edge periods are hatched so the truncated period is visible.
  const partials = result.partials ?? null;
  let partialCount = 0;
  if (partials !== null) {
    partials.forEach((partial, i) => {
      if (partial) {
        partialCount++;
        const x = frame.left + i * slot;
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, frame.top, slot, frame.plotH);
        ctx.clip();
        ctx.strokeStyle = frame.dim;
        ctx.globalAlpha = 0.4;
        ctx.lineWidth = 1;
        const step = 8 * ui;
        for (let offset = -frame.plotH; offset < slot + frame.plotH; offset += step) {
          ctx.beginPath();
          ctx.moveTo(x + offset, frame.top + frame.plotH);
          ctx.lineTo(x + offset + frame.plotH, frame.top);
          ctx.stroke();
        }
        ctx.restore();
      }
    });
  }

  ctx.fillStyle = frame.dim;
  card.font(ctx, ui, 10);
  ctx.textAlign = "center";
  const axisTimes = result.dimensionTimes[0];
  if (isTime && axisTimes !== undefined && axisTimes.length === n) {
    // Calendar boundaries (quarters, months, weeks), not arbitrary bucket labels.
    const room = Math.max(3, Math.floor(frame.plotW / (70 * ui)));
    for (const tick of calendarTicks(Array.from(axisTimes), room)) {
      ctx.fillText(tick.label, frame.left + (tick.index + 0.5) * slot, frame.top + frame.plotH + 14 * ui);
    }
  } else {
    const step = Math.max(1, Math.ceil(n / 8));
    for (let i = 0; i < n; i += step) {
      const label = result.labels[i] ?? "";
      ctx.fillText(
        card.fit(ctx, label, Math.max(16, slot * step - 4 * ui)),
        frame.left + (i + 0.5) * slot,
        frame.top + frame.plotH + 14 * ui,
      );
    }
  }
  ctx.textAlign = "left";
  const measure = plainMeasureName(result.measureNames[0] ?? "value");
  ctx.fillText(measure, frame.left, frame.top - 6 * ui);
  if (gapPeriods > 0) {
    ctx.textAlign = "right";
    ctx.fillText(
      `${gapPeriods} ${gapPeriods === 1 ? "period has" : "periods have"} no data`,
      frame.left + frame.plotW,
      frame.top - 6 * ui,
    );
    ctx.textAlign = "left";
  }

  // One hoverable slot per group: a tooltip, and the value/period it stands
  // for so a right-click can leave it out (click filters the table, as for
  // count bars). Bound views have no table column to act on.
  const dimensionColumn = card.config.source === "" ? card.config.column : -1;
  const dimensionMeta = card.meta(dimensionColumn);
  const categoryLabels = dimensionMeta?.categories?.labels ?? [];
  const times = result.dimensionTimes[0];
  card.hitRegions = [];
  for (let i = 0; i < n; i++) {
    const label = result.labels[i] ?? "";
    const value = values[i];
    const actions: HitAction[] = [];
    if (dimensionMeta !== undefined && card.config.kind !== "histogram") {
      if (isTime && times !== undefined && Number.isFinite(times[i])) {
        const lo = times[i] as number;
        const next = times[i + 1];
        const previous = times[i - 1];
        const hi =
          next !== undefined && Number.isFinite(next)
            ? next - 1
            : previous !== undefined && Number.isFinite(previous)
              ? lo + (lo - previous) - 1
              : lo;
        actions.push({ kind: "range", column: dimensionColumn, min: lo, max: hi });
      } else if (!isTime) {
        const code = categoryLabels.indexOf(label);
        if (code >= 0) actions.push({ kind: "values", column: dimensionColumn, code });
      }
    }
    card.hitRegions.push({
      x: frame.left + i * slot,
      y: frame.top,
      w: slot,
      h: frame.plotH,
      lines: [
        label === "" ? "(blank)" : label,
        `${measure}: ${value !== undefined && Number.isFinite(value) ? formatChartNumber(value) : "—"}`,
        ...card.errorBarLine(result, i),
      ],
      actions,
    });
  }

  if (isTime && times !== undefined && times.length === n && card.config.source === "") {
    card.brushSpace = card.timeSlotBrush(Array.from(times), dimensionColumn, frame);
  }
  const valueAgg = card.config.valueAgg ?? "mean";
  if (
    card.config.source === "" &&
    dimensionColumn >= 0 &&
    (card.config.valueCalc ?? "") === "" &&
    (valueAgg === "sum" || valueAgg === "mean" || valueAgg === "min" || valueAgg === "max" || valueAgg === "count") &&
    (card.config.valueColumn ?? -1) >= 0
  ) {
    card.valueScale = {
      yMax: top,
      top: frame.top,
      plotH: frame.plotH,
      mode: isTime ? "line" : "bars",
      inset: 0,
      barW: Math.max(1, slot - 1),
      regionColumn: dimensionColumn,
      measure: { column: card.config.valueColumn as number, agg: valueAgg },
      scoped: true,
    };
  }

  const ms = result.ms < 1 ? "<1" : String(Math.round(result.ms));
  const partialNote =
    partialCount > 0
      ? ` · ${partialCount} incomplete ${partialCount === 1 ? "period" : "periods"} (hatched)`
      : "";
  card.noteEl.textContent = `${n.toLocaleString()} groups · ${plainMeasureName(measure)} by ${
    result.dimensionNames[0] ?? "group"
  } · ${ms} ms${partialNote}`;
}

export function drawSeries(card: ChartCard, ctx: CanvasRenderingContext2D, frame: Frame, kind: "histogram" | "line"): void {
  const meta = card.meta(card.config.column);
  if (meta === undefined) {
    const message = card.emptySeriesMessage(kind);
    card.noteEl.textContent = message;
    card.drawPlotMessage(ctx, frame, message);
    return;
  }
  if (kind === "line" && card.groupResult !== null) {
    card.drawGroupedLines(ctx, frame);
    return;
  }
  if (kind === "histogram" && card.groupResult !== null) {
    card.drawGroupedHistogram(ctx, frame);
    return;
  }
  if (kind === "histogram" && card.animationResult?.hist !== undefined) {
    card.drawAnimatedHistogram(ctx, frame);
    return;
  }
  const automatic = meta.histogram;
  const custom = kind === "histogram" ? card.binResult : card.lineBinResult;
  const liveBins = card.histograms[card.config.column] ?? automatic?.bins ?? [];
  const bins =
    custom !== null
      ? custom.bins
      : automatic === null
        ? liveBins
        : card.withoutExcludedBins(liveBins, automatic.min, automatic.max);
  if (bins.length === 0 || automatic === null) {
    const message = "This column has no histogram data yet.";
    card.noteEl.textContent = message;
    card.drawPlotMessage(ctx, frame, message);
    return;
  }
  const ui = frame.ui;
  const hasOverflow = custom !== null && custom.overflow > 0;
  const overflowCount = custom?.overflow ?? 0;
  const maxCount = Math.max(1, ...bins, overflowCount);
  const slots = bins.length + (hasOverflow ? 1 : 0);
  const slotW = frame.plotW / slots;
  const barW = Math.max(1, slotW - 1);
  const min =
    card.lineBinRange?.min ??
    card.chartXZoom?.min ??
    card.config.binOptions?.min ??
    automatic.min;
  const max =
    card.lineBinRange?.max ??
    card.chartXZoom?.max ??
    card.config.binOptions?.max ??
    automatic.max;
  card.brushSpace = {
    left: frame.left,
    top: frame.top,
    plotW: frame.plotW,
    plotH: frame.plotH,
    xColumn: card.config.column,
    xMin: min,
    xMax: max,
    xFraction: bins.length / slots,
  };
  card.valueScale = {
    yMax: maxCount,
    top: frame.top,
    plotH: frame.plotH,
    mode: kind === "line" ? "line" : "bars",
    inset: 0,
    barW,
    regionColumn: card.config.column,
    measure: null,
    scoped: true,
  };
  card.hitRegions = seriesHitRegions(
    { left: frame.left, top: frame.top, plotW: frame.plotW, plotH: frame.plotH },
    {
      column: card.config.column,
      bins,
      overflow: hasOverflow ? overflowCount : 0,
      min,
      max,
      dateAxis: kind === "line",
      axisFormat: axisKindFor(meta.type) ?? undefined,
    },
  );

  card.drawCountAxis(ctx, frame, maxCount);

  if (kind === "line") {
    // Say what one point on the line counts: "Rows per day" and not just ticks.
    const unit = card.lineUnitLabel(min, max, bins.length);
    const tzNote = meta.timeZoneAware === true ? " · source offsets shown in UTC" : "";
    ctx.fillStyle = frame.dim;
    card.font(ctx, ui, 10);
    ctx.textAlign = "left";
    ctx.fillText(`${unit}${tzNote}`, frame.left, frame.top - 6 * ui);
  }

  if (kind === "histogram") {
    for (let i = 0; i < bins.length; i++) {
      const h = (bins[i] / maxCount) * frame.plotH;
      if (h <= 0) continue;
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = card.primaryColor();
      card.fillTopRounded(ctx, frame.left + i * slotW, frame.top + frame.plotH - h, barW, h, 3 * ui);
    }
    if (hasOverflow) {
      const h = (overflowCount / maxCount) * frame.plotH;
      const x = frame.left + bins.length * slotW + 3 * ui;
      ctx.globalAlpha = 0.55;
      card.fillTopRounded(ctx, x, frame.top + frame.plotH - h, Math.max(1, slotW - 4 * ui), h, 3 * ui);
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
    ctx.strokeStyle = card.primaryColor();
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.lineTo(frame.left + frame.plotW, frame.top + frame.plotH);
    ctx.lineTo(frame.left, frame.top + frame.plotH);
    ctx.closePath();
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = card.primaryColor();
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  if (kind === "histogram" && card.config.kde && bins.length >= 4) {
    const smooth = smoothSeries(bins, KDE_SIGMA_BINS);
    ctx.beginPath();
    for (let i = 0; i < smooth.length; i++) {
      const x = frame.left + (i + 0.5) * slotW;
      const y = frame.top + frame.plotH - (smooth[i] / maxCount) * frame.plotH;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = frame.text;
    ctx.globalAlpha = 0.7;
    ctx.lineWidth = 1.8;
    ctx.stroke();
    ctx.lineTo(frame.left + frame.plotW, frame.top + frame.plotH);
    ctx.lineTo(frame.left, frame.top + frame.plotH);
    ctx.closePath();
    ctx.globalAlpha = 0.08;
    ctx.fillStyle = card.primaryColor();
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  if (
    kind === "histogram" &&
    custom !== null &&
    card.binMedian !== null &&
    max > min &&
    !automatic.symlog
  ) {
    const ratio = (card.binMedian - min) / (max - min);
    if (ratio >= 0 && ratio <= 1) {
      const x = frame.left + ratio * frame.plotW;
      ctx.strokeStyle = frame.text;
      ctx.globalAlpha = 0.7;
      ctx.setLineDash([5, 3]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, frame.top);
      ctx.lineTo(x, frame.top + frame.plotH);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      const label = `median ${formatChartNumber(card.binMedian)}`;
      card.font(ctx, ui, 10);
      const width = ctx.measureText(label).width;
      ctx.fillStyle = frame.text;
      const labelX =
        x + 4 * ui + width > frame.left + frame.plotW ? x - 4 * ui - width : x + 4 * ui;
      ctx.fillText(label, labelX, frame.top + 12 * ui);
    }
  }

  ctx.fillStyle = frame.dim;
  card.font(ctx, ui, 10);
  const tickKind: "histogram" | AxisFormat =
    axisKindFor(meta.type) ?? (kind === "line" ? "line" : "histogram");
  const tickSpan = max - min;
  const mid = (min + max) / 2;
  const calendarAxis = kind === "line" && (meta.type === "date" || meta.type === "datetime") && tickSpan > 0;
  if (calendarAxis) {
    // Ticks on calendar boundaries across the whole range, not just three raw dates.
    const dayMs = 86_400_000;
    const stepMs = tickSpan / dayMs > 2000 ? 7 * dayMs : tickSpan / dayMs > 3 ? dayMs : 3_600_000;
    const times: number[] = [];
    for (let t = Math.ceil(min / stepMs) * stepMs; t <= max && times.length < 6000; t += stepMs) times.push(t);
    const room = Math.max(3, Math.floor(frame.plotW / (74 * ui)));
    ctx.textAlign = "center";
    for (const tick of calendarTicks(times, room)) {
      const x = frame.left + ((times[tick.index]! - min) / tickSpan) * frame.plotW;
      const half = ctx.measureText(tick.label).width / 2;
      ctx.fillText(tick.label, Math.min(frame.left + frame.plotW - half, Math.max(frame.left + half, x)), frame.top + frame.plotH + 16 * ui);
    }
    ctx.textAlign = "left";
  }
  const minLabel = formatTick(min, tickKind, tickSpan);
  if (!calendarAxis) ctx.fillText(minLabel, frame.left, frame.top + frame.plotH + 16 * ui);
  // On narrow cards the midpoint label collides with the edge labels.
  if (!calendarAxis && frame.plotW >= 220 * (ui / 1.25)) {
    const midLabel = formatTick(mid, tickKind, tickSpan);
    ctx.fillText(
      midLabel,
      frame.left + frame.plotW / 2 - ctx.measureText(midLabel).width / 2,
      frame.top + frame.plotH + 16 * ui,
    );
  }
  const maxLabel = formatTick(max, tickKind, tickSpan);
  if (!calendarAxis) {
    ctx.fillText(
      maxLabel,
      frame.left + frame.plotW - 4 * ui - ctx.measureText(maxLabel).width,
      frame.top + frame.plotH + 16 * ui,
    );
  }
  if (hasOverflow) {
    const overflowLabel = `> ${formatTick(max, tickKind, tickSpan)}`;
    ctx.fillText(
      overflowLabel,
      frame.left + frame.plotW - ctx.measureText(overflowLabel).width,
      frame.top + frame.plotH + 30 * ui,
    );
  }

  const notes: string[] = [];
  if (custom !== null) {
    notes.push(`${custom.bins.length} bins`);
    if (card.config.binClipped) notes.push("End clipped to p95 — Full range shows everything");
    if (custom.below > 0) notes.push(`${custom.below.toLocaleString()} below start`);
    if (custom.overflow > 0) notes.push(`${custom.overflow.toLocaleString()} in “> Max”`);
    if (custom.above > 0) notes.push(`${custom.above.toLocaleString()} above end`);
  } else if (automatic.symlog) {
    notes.push("signed-log scale (heavy tail)");
  }
  if (custom === null) {
    const outside = automatic.below + automatic.above;
    if (outside > 0) notes.push(`${outside.toLocaleString()} values beyond the p1-p99 chart range`);
  }
  notes.push("Ctrl+scroll to zoom · drag to pan · double-click resets");
  card.noteEl.textContent = notes.join(" · ");
}

/** Shared count-axis grid and baseline for histogram and line kinds. */
export function drawCountAxis(card: ChartCard, ctx: CanvasRenderingContext2D, frame: Frame, maxCount: number): void {
  const ui = frame.ui;
  const yTicks = niceTicks(0, maxCount, 4).filter((value, index, all) => index === 0 || formatCount(value) !== formatCount(all[index - 1]));
  ctx.strokeStyle = frame.border;
  ctx.lineWidth = 1;
  ctx.fillStyle = frame.dim;
  card.font(ctx, ui, 10);
  ctx.textAlign = "right";
  for (const value of yTicks) {
    const y = frame.top + frame.plotH - (value / maxCount) * frame.plotH;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(frame.left, y + 0.5);
    ctx.lineTo(frame.left + frame.plotW, y + 0.5);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillText(formatCount(value), frame.left - 6 * ui, y + 3 * ui);
  }
  ctx.textAlign = "left";
  ctx.beginPath();
  ctx.moveTo(frame.left, frame.top + frame.plotH + 0.5);
  ctx.lineTo(frame.left + frame.plotW, frame.top + frame.plotH + 0.5);
  ctx.stroke();
}

/** "Rows per day" for the time-series Y axis, from the bin's date span. */
export function lineUnitLabel(card: ChartCard, min: number, max: number, bins: number): string {
  if (!(max > min) || bins <= 0) return "Rows";
  const per = (max - min) / bins;
  const units: readonly (readonly [number, string])[] = [
    [365.25 * 86_400_000, "year"],
    [30.44 * 86_400_000, "month"],
    [7 * 86_400_000, "week"],
    [86_400_000, "day"],
    [3_600_000, "hour"],
    [60_000, "minute"],
    [1000, "second"],
  ];
  for (const [span, name] of units) {
    if (per >= span * 0.9) {
      const count = Math.round((per / span) * 10) / 10;
      return `Rows per ${count === 1 ? name : `${count} ${name}s`}`;
    }
  }
  return "Rows";
}

/**
 * Time series split by a category: one line per visible group over the same
 * automatic date range, a clickable legend and per-group tooltip counts.
 */
/**
 * Overlaid histograms for a grouped histogram: one outline per category,
 * drawn as the share of that group's rows per bin so curves compare shapes
 * even when the groups have very different sizes.
 */
export function drawGroupedHistogram(card: ChartCard, ctx: CanvasRenderingContext2D, frame: Frame): void {
  const result = card.groupResult;
  const meta = card.meta(card.config.column);
  if (result === null || meta === undefined || meta.histogram === null) {
    const message = "This column has no histogram data yet.";
    card.noteEl.textContent = message;
    card.drawPlotMessage(ctx, frame, message);
    return;
  }
  const automatic = meta.histogram;
  const min = card.config.binOptions?.min ?? automatic.min;
  const max = card.config.binOptions?.max ?? automatic.max;
  const bins = Math.max(1, result.bins > 0 ? result.bins : automatic.bins.length);
  const ui = frame.ui;

  const groups = result.labels
    .map((label, index) => ({
      label,
      code: result.codes[index] ?? index,
      index,
      counts: result.groups[index] ?? [],
      total: result.totals[index] ?? 0,
    }))
    .filter((entry) => !card.hiddenGroups.has(entry.code) && entry.total > 0);
  if (groups.length === 0) {
    const message = "Every group is hidden in the legend.";
    card.noteEl.textContent = message;
    card.drawPlotMessage(ctx, frame, message);
    return;
  }

  const shares = groups.map((group) =>
    Array.from(group.counts, (count) => {
      const share = count / group.total;
      return Number.isFinite(share) ? share : 0;
    }),
  );
  // Smooth the outlines when bins are numerous so overlaid curves read as
  // curves rather than spikes.
  const smooth = bins >= 8 ? shares.map((share) => smoothSeries(share, 1.2)) : shares;
  let maxShare = 0.0001;
  for (const share of smooth) {
    for (const value of share) {
      if (value > maxShare) maxShare = value;
    }
  }

  // Y axis in percent of the group (share), not counts.
  const yTicks = niceTicks(0, maxShare, 4).filter((value, index, all) => index === 0 || `${Math.round(value * 100)}%` !== `${Math.round(all[index - 1] * 100)}%`);
  ctx.strokeStyle = frame.border;
  ctx.lineWidth = 1;
  ctx.fillStyle = frame.dim;
  card.font(ctx, ui, 10);
  ctx.textAlign = "right";
  for (const value of yTicks) {
    const y = frame.top + frame.plotH - (value / maxShare) * frame.plotH;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(frame.left, y + 0.5);
    ctx.lineTo(frame.left + frame.plotW, y + 0.5);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillText(`${Math.round(value * 100)}%`, frame.left - 6 * ui, y + 3 * ui);
  }
  ctx.textAlign = "left";
  ctx.beginPath();
  ctx.moveTo(frame.left, frame.top + frame.plotH + 0.5);
  ctx.lineTo(frame.left + frame.plotW, frame.top + frame.plotH + 0.5);
  ctx.stroke();

  const slot = frame.plotW / bins;
  groups.forEach((group, groupIndex) => {
    const share = smooth[groupIndex] ?? [];
    const color = card.groupColor(group.index);
    ctx.beginPath();
    share.forEach((value, bin) => {
      const x = frame.left + (bin + 0.5) * slot;
      const y = frame.top + frame.plotH - (value / maxShare) * frame.plotH;
      if (bin === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.8;
    ctx.stroke();
    ctx.lineTo(frame.left + frame.plotW, frame.top + frame.plotH);
    ctx.lineTo(frame.left, frame.top + frame.plotH);
    ctx.closePath();
    ctx.globalAlpha = 0.12;
    ctx.fillStyle = color;
    ctx.fill();
    ctx.globalAlpha = 1;
  });

  ctx.fillStyle = frame.dim;
  card.font(ctx, ui, 10);
  ctx.fillText("share of each group per bin", frame.left, frame.top - 6 * ui);
  const histTickKind: "histogram" | AxisFormat = axisKindFor(meta.type) ?? "histogram";
  const histTickSpan = max - min;
  const mid = (min + max) / 2;
  ctx.fillText(formatTick(min, histTickKind, histTickSpan), frame.left, frame.top + frame.plotH + 16 * ui);
  const midLabel = formatTick(mid, histTickKind, histTickSpan);
  ctx.fillText(
    midLabel,
    frame.left + frame.plotW / 2 - ctx.measureText(midLabel).width / 2,
    frame.top + frame.plotH + 16 * ui,
  );
  const maxLabel = formatTick(max, histTickKind, histTickSpan);
  ctx.fillText(
    maxLabel,
    frame.left + frame.plotW - 4 * ui - ctx.measureText(maxLabel).width,
    frame.top + frame.plotH + 16 * ui,
  );

  const groupName = card.meta(card.config.groupColumn)?.name ?? "group";
  card.noteEl.textContent = `${groups.length} curves by ${groupName} · share of each group per bin · ${result.total.toLocaleString()} rows`;
}

export function drawGroupedLines(card: ChartCard, ctx: CanvasRenderingContext2D, frame: Frame): void {
  const result = card.groupResult;
  const histogram = card.meta(card.config.column)?.histogram ?? null;
  if (result === null || histogram === null || result.bins === 0) {
    const message = "This column has no histogram data yet.";
    card.noteEl.textContent = message;
    card.drawPlotMessage(ctx, frame, message);
    return;
  }
  const binCount = result.bins;
  const min = histogram.min;
  const max = histogram.max;
  const ui = frame.ui;
  const slotW = frame.plotW / binCount;
  const visible = result.groups
    .map((bins, index) => ({ bins, index }))
    .filter((entry) => !card.hiddenGroups.has(result.codes[entry.index]));
  let maxCount = 1;
  for (const entry of visible) {
    for (const value of entry.bins) if (value > maxCount) maxCount = value;
  }

  card.drawCountAxis(ctx, frame, maxCount);

  for (const entry of visible) {
    ctx.beginPath();
    for (let i = 0; i < binCount; i++) {
      const x = frame.left + (i + 0.5) * slotW;
      const y = frame.top + frame.plotH - (entry.bins[i] / maxCount) * frame.plotH;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = card.groupColor(entry.index);
    ctx.lineWidth = Math.max(1.5, 1.6 * ui);
    ctx.globalAlpha = 0.9;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  ctx.fillStyle = frame.dim;
  card.font(ctx, ui, 10);
  const lineTickKind: "histogram" | AxisFormat =
    axisKindFor(card.meta(card.config.column)?.type ?? "date") ?? "line";
  const lineTickSpan = max - min;
  const mid = (min + max) / 2;
  ctx.fillText(formatTick(min, lineTickKind, lineTickSpan), frame.left, frame.top + frame.plotH + 16 * ui);
  const midLabel = formatTick(mid, lineTickKind, lineTickSpan);
  ctx.fillText(
    midLabel,
    frame.left + frame.plotW / 2 - ctx.measureText(midLabel).width / 2,
    frame.top + frame.plotH + 16 * ui,
  );
  const maxLabel = formatTick(max, lineTickKind, lineTickSpan);
  ctx.fillText(
    maxLabel,
    frame.left + frame.plotW - 4 * ui - ctx.measureText(maxLabel).width,
    frame.top + frame.plotH + 16 * ui,
  );

  card.hitRegions = groupedSeriesHitRegions(
    { left: frame.left, top: frame.top, plotW: frame.plotW, plotH: frame.plotH },
    {
      column: card.config.column,
      groups: visible.map((entry) => ({
        label: result.labels[entry.index],
        bins: entry.bins,
      })),
      min,
      max,
      axisFormat: axisKindFor(card.meta(card.config.column)?.type ?? "date") ?? "line",
    },
  );

  const groupName = card.meta(card.config.groupColumn)?.name ?? "group";
  const total = result.groups.length;
  const notes = [
    card.hiddenGroups.size === 0
      ? `${total} lines by ${groupName}`
      : `${visible.length} of ${total} lines by ${groupName}`,
  ];
  if (result.otherIndex >= 0) notes.push(`top ${GROUP_LINE_LIMIT} + Other`);
  notes.push(`${result.total.toLocaleString()} rows`);
  if (result.ms > 0) notes.push(`${Math.round(result.ms)} ms`);
  card.noteEl.textContent = notes.join(" · ");
}

/** Clickable legend under grouped time series; entries toggle line visibility. */
export function syncLegend(card: ChartCard): void {
  const result = card.groupResult;
  const bubbleGroups =
    card.config.kind === "bubble"
      ? (card.bubbleResult?.groups ?? card.animationResult?.bubble?.groups ?? null)
      : null;
  const entries =
    bubbleGroups !== null
      ? bubbleGroups.map((group) => ({ label: group.label, code: group.code }))
      : (card.config.kind === "line" || card.config.kind === "histogram") && result !== null
        ? result.labels.map((label, index) => ({
            label,
            code: result.codes[index] ?? index,
          }))
        : null;
  if (card.splitLegend !== null && card.usesAggregate()) {
    card.legendEl.classList.remove("hidden");
    card.legendEl.replaceChildren();
    for (const { label, color } of card.splitLegend) {
      const off = card.hiddenSplit.has(label);
      const item = el(
        "button",
        { class: "chart-legend-item", type: "button", "aria-pressed": off ? "false" : "true", title: off ? `Show ${label}` : `Hide ${label}` },
        [label],
      ) as HTMLButtonElement;
      const swatch = el("span", { class: "chart-legend-swatch" });
      swatch.style.background = color;
      item.prepend(swatch);
      item.classList.toggle("off", off);
      item.addEventListener("click", () => {
        if (card.hiddenSplit.has(label)) card.hiddenSplit.delete(label);
        else card.hiddenSplit.add(label);
        card.render();
      });
      card.legendEl.append(item);
    }
    return;
  }
  card.legendEl.classList.toggle("hidden", entries === null);
  card.legendEl.replaceChildren();
  if (entries === null) return;
  entries.forEach(({ label, code }, index) => {
    const off = card.hiddenGroups.has(code);
    const item = el(
      "button",
      {
        class: "chart-legend-item",
        type: "button",
        "aria-pressed": off ? "false" : "true",
        title: off ? `Show ${label}` : `Hide ${label}`,
      },
      [label],
    ) as HTMLButtonElement;
    const swatch = el("span", { class: "chart-legend-swatch" });
    swatch.style.background = card.groupColor(index);
    item.prepend(swatch);
    item.classList.toggle("off", off);
    item.addEventListener("click", () => {
      if (card.hiddenGroups.has(code)) card.hiddenGroups.delete(code);
      else card.hiddenGroups.add(code);
      card.render();
    });
    item.addEventListener("contextmenu", (event) => {
      const groupColumn = card.config.groupColumn;
      if (groupColumn < 0) return;
      event.preventDefault();
      card.openExclusionMenu(
        [{ kind: "values", column: groupColumn, code: card.legendCodeToGroupCode(code) }],
        { x: event.clientX, y: event.clientY },
      );
    });
    card.legendEl.append(item);
  });
}

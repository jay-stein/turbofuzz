/**
 * Charts of categories: bars, box plots, treemap, word terms, the KPI tile, axes and axis titles, and reference lines.
 *
 * Moved out of chart-card.ts: each function takes the card it works on, and the card keeps a
 * one-line method of the same name that calls it.
 */
import type { ChartBinOptions } from "../data/chart-bins.js";
import { cssVar } from "./chart-card-parts.js";
import { barHitRegions, boxHitRegions } from "./chart-hit-regions.js";
import type { SeriesMode } from "../data/chart-series.js";
import { squarifyLayout } from "../data/treemap.js";
import type { Aggregate, MeasureSpec, ViewDef } from "../data/aggregate.js";
import { isNumericLikeType } from "../types.js";
import { drawDotPlot, drawSlopegraph, drawSmallMultiples, drawStacked100, drawWaterfall, type Painter } from "./chart-extra-draw.js";
import type { AggregateMessage } from "../worker/protocol.js";
import { axisKindFor, type AxisFormat, type CategoryBar, CHART_KIND_LABELS, formatChartNumber, formatCount, formatTick, darkerColor, isGroupable, isNumericType, niceTicks, plainMeasureName, GROUP_REQUIRED_KINDS } from "./chart-utils.js";
import { el } from "./dom.js";
import type { ChartCard } from "./chart-card.js";
import type { RefLine, Frame } from "./chart-card-types.js";
import { BORDER_DARKER, BORDER_ALPHA, addMarkerPath, DEFAULT_BIN_COUNT, POINT_LIMIT, GROUP_LINE_LIMIT } from "./chart-card-types.js";

/** Every category bar sorted by count; the bar window pans across this. */
export function allCategoryBars(card: ChartCard): CategoryBar[] {
  const meta = card.meta(card.config.column);
  const categories = meta?.categories ?? null;
  if (meta === undefined || categories === null) return [];
  const counts = card.facets[card.config.column] ?? categories.counts;
  // Live count bars come straight from the table facets, so excluded values
  // are simply left out and the shares are recomputed from what remains.
  const gone = card.excludedLabels(card.config.column);
  const total = categories.labels.reduce(
    (sum, label, index) => (gone.has(label) ? sum : sum + (counts[index] ?? 0)),
    0,
  );
  return categories.labels
    .map((label, index) => {
      const count = counts[index] ?? categories.counts[index] ?? 0;
      return {
        label,
        count,
        pct: total > 0 ? (count / total) * 100 : 0,
      };
    })
    .filter((bar) => !gone.has(bar.label))
    .sort((a, b) => b.count - a.count);
}

export function refreshSeries(card: ChartCard): void {
  if (
    card.config.kind !== "scatter" &&
    card.config.kind !== "density" &&
    card.config.kind !== "map"
  ) {
    card.seriesResult = null;
    return;
  }
  const x = card.meta(card.config.x);
  const y = card.meta(card.config.y);
  const map = card.config.kind === "map";
  if (
    x === undefined ||
    y === undefined ||
    (map ? !isNumericType(x.type) || !isNumericType(y.type) : !card.allowsAxis(x) || !card.allowsAxis(y))
  ) {
    card.seriesResult = null;
    return;
  }
  const generation = ++card.generation;
  const mode: SeriesMode =
    card.config.kind === "density" ? "density" : map ? "points" : card.config.mode === "auto" ? "points" : card.config.mode;
  const places = map && card.config.mapMode === "places" ? { agg: card.config.bubbleAgg ?? "count", colorAgg: card.config.mapColorAgg ?? "mean", ...(card.mapLabelColumn() >= 0 ? { labelColumn: card.mapLabelColumn() } : {}) } : undefined;
  void card.options
    .requestSeries({
      ...(places ? { places } : {}),
      xColumn: card.config.x,
      yColumn: card.config.y,
      colorColumn: card.config.colorColumn,
      sizeColumn: card.config.sizeColumn,
      mode,
      limit: POINT_LIMIT,
      clip: !map,
      ...card.chartScope(),
    })
    .then((message) => {
      if (generation !== card.generation || card.disposed) return;
      card.seriesResult = message.result;
      card.seriesLabels = message.colorLabels;
      card.placeLabels = message.placeLabels ?? null;
      card.seriesMs = message.ms;
      card.seriesCorrelation = message.correlation;
      card.render();
    })
    .catch(() => {
      // Keep the last payload as the fallback.
    });
}

/**
 * Treemap data: always one aggregation over the group column. The measure is
 * count(*) unless a numeric column is chosen; a row-count measure rides along
 * so every tile tooltip can show the rows behind its area.
 */
export function refreshTreemap(card: ChartCard): void {
  if (card.config.kind !== "treemap") {
    card.treemapResult = null;
    return;
  }
  const meta = card.meta(card.config.column);
  if (meta === undefined || !card.allowsPrimary(meta)) {
    card.treemapResult = null;
    return;
  }
  const measureColumn = card.config.valueColumn ?? -1;
  const requestedAgg = card.config.valueAgg ?? "sum";
  const agg: Aggregate = [
    "count",
    "distinct",
    "sum",
    "mean",
    "median",
    "min",
    "max",
  ].includes(requestedAgg)
    ? (requestedAgg as Aggregate)
    : "sum";
  const measure: MeasureSpec =
    measureColumn >= 0
      ? { column: measureColumn, agg }
      : { column: null, agg: "count" };
  const generation = ++card.generation;
  const view: ViewDef = {
    id: "chart-treemap",
    name: "Treemap",
    dimensions: [{ column: card.config.column, by: "value" }],
    measures: [measure, { column: null, agg: "count" }],
    fill: "none",
    sort: { key: "m0", dir: "desc" },
    limit: 5000,
    respectFilters: card.config.respectFilters !== false,
    filterColumn: card.config.filterColumn ?? -1,
    filterCode: card.config.filterCode ?? -1,
    ...(card.excludes().length > 0 ? { exclude: card.excludes() } : {}),
  };
  void card.options
    .requestAggregate(view)
    .then((message) => {
      if (generation !== card.generation || card.disposed) return;
      card.treemapResult = {
        labels: message.labels,
        values: [...(message.measures[0] ?? new Float64Array(0))],
        rows: [...(message.measures[1] ?? new Float64Array(0))],
        totalGroups: message.totalGroups,
        truncated: message.truncated,
      };
      card.render();
    })
    .catch(() => {
      // Keep the last payload as the fallback.
    });
}

export function drawTreemap(card: ChartCard, ctx: CanvasRenderingContext2D, frame: Frame): void {
  const meta = card.meta(card.config.column);
  if (meta === undefined || !card.allowsPrimary(meta)) {
    const message = "Treemaps need a category or text column — pick one above.";
    card.noteEl.textContent = message;
    card.drawPlotMessage(ctx, frame, message);
    return;
  }
  if (card.animationResult?.bar !== undefined) {
    card.drawAnimatedTreemap(ctx, frame);
    return;
  }

  const measureColumn = card.config.valueColumn ?? -1;
  const measureMeta = card.meta(measureColumn);
  const measured = measureColumn >= 0 && measureMeta !== undefined;
  const measureLabel = measured
    ? `${
        card.aggPhrase()
      } of ${measureMeta.name}`
    : "Count of rows";
  const result = card.treemapResult;
  if (result === null) {
    const message = "Grouping the rows…";
    card.noteEl.textContent = message;
    card.drawPlotMessage(ctx, frame, message);
    return;
  }
  const entries = result.labels
    .map((label, index) => ({
      label,
      value: result.values[index] ?? 0,
      rows: result.rows[index] ?? 0,
      code: meta.categories?.labels.indexOf(label) ?? -1,
    }))
    .filter((entry) => entry.value > 0);
  if (entries.length === 0) {
    const message = "No values to plot for this column.";
    card.noteEl.textContent = message;
    card.drawPlotMessage(ctx, frame, message);
    return;
  }

  entries.sort((a, b) => b.value - a.value);
  const cap = Math.max(6, card.config.topN);
  const state =
    card.itemWindow ?? { start: 0, count: Math.min(entries.length, cap) };
  const windowed = card.itemWindow !== null;
  const windowStart = Math.max(0, Math.min(entries.length - 1, state.start));
  const windowCount = Math.max(
    1,
    Math.min(state.count, entries.length - windowStart),
  );
  const shown = windowed
    ? entries.slice(windowStart, windowStart + windowCount)
    : entries.slice(0, cap);
  if (!windowed) {
    const rest = entries.slice(cap);
    if (rest.length > 0) {
      const value = rest.reduce((sum, entry) => sum + entry.value, 0);
      const rows = rest.reduce((sum, entry) => sum + entry.rows, 0);
      shown.push({ label: `Other (${rest.length})`, value, rows, code: -1 });
    }
  }
  const total = shown.reduce((sum, entry) => sum + entry.value, 0);
  const rects = squarifyLayout(
    shown.map((entry) => entry.value),
    frame.left,
    frame.top,
    frame.plotW,
    frame.plotH,
  );
  const ui = frame.ui;

  card.hitRegions = rects.map((rect, index) => {
    const entry = shown[index] ?? { label: "", value: 0, rows: 0, code: -1 };
    const share = total > 0 ? (entry.value / total) * 100 : 0;
    return {
      x: rect.x,
      y: rect.y,
      w: rect.w,
      h: rect.h,
      lines: [
        entry.label === "" ? "(blank)" : entry.label,
        measured
          ? `${measureLabel} · ${formatChartNumber(entry.value)} · ${share.toFixed(
              1,
            )}% of total · ${formatCount(entry.rows)} rows`
          : `${formatCount(entry.value)} rows · ${share.toFixed(1)}% of total`,
      ],
      actions:
        entry.code >= 0
          ? [{ kind: "values" as const, column: card.config.column, code: entry.code }]
          : meta.type === "string"
            ? [{ kind: "text" as const, column: card.config.column, query: entry.label }]
            : [],
    };
  });

  rects.forEach((rect, index) => {
    const entry = shown[index];
    if (entry === undefined || rect.w <= 0 || rect.h <= 0) return;
    ctx.globalAlpha = 0.85;
    if (card.config.multiColor) {
      ctx.fillStyle = card.paletteColor(index);
    } else {
      ctx.fillStyle = card.primaryColor();
      ctx.globalAlpha = Math.max(0.35, 0.9 - index * 0.06);
    }
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = cssVar("--panel", "#ffffff");
    ctx.lineWidth = 1.5;
    ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.w - 1, rect.h - 1);

    if (rect.w < 42 * ui || rect.h < 18 * ui) return;
    ctx.textAlign = "left";
    ctx.fillStyle = "#ffffff";
    card.font(ctx, ui, 11, "600");
    ctx.fillText(
      card.fit(ctx, entry.label === "" ? "(blank)" : entry.label, rect.w - 10 * ui),
      rect.x + 5 * ui,
      rect.y + 14 * ui,
    );
    if (rect.h >= 32 * ui) {
      const share = total > 0 ? (entry.value / total) * 100 : 0;
      card.font(ctx, ui, 10);
      ctx.globalAlpha = 0.85;
      ctx.fillText(
        card.fit(
          ctx,
          measured
            ? `${formatChartNumber(entry.value)} · ${share.toFixed(1)}%`
            : `${formatCount(entry.value)} · ${share.toFixed(1)}%`,
          rect.w - 10 * ui,
        ),
        rect.x + 5 * ui,
        rect.y + 27 * ui,
      );
      ctx.globalAlpha = 1;
    }
  });
  ctx.textAlign = "left";

  const notes = [`${shown.length} tiles`, measureLabel];
  notes.push(
    measured
      ? `${formatChartNumber(total)} total`
      : `${formatCount(total)} rows`,
  );
  if (windowed) {
    notes.push(`${shown.length} of ${entries.length} tiles shown`);
  } else {
    const restCount = Math.max(0, entries.length - Math.min(entries.length, cap));
    if (restCount > 0) notes.push(`${restCount} rest as Other`);
  }
  if (result.truncated) {
    notes.push(
      `top ${entries.length.toLocaleString()} of ${result.totalGroups.toLocaleString()} groups — narrow the group column for full coverage`,
    );
  } else if (meta.type === "string" && meta.stats.distinct > cap) {
    notes.push("high-cardinality text · top tiles + Other");
  }
  if (card.statsMs > 0) notes.push(`${Math.round(card.statsMs)} ms`);
  card.noteEl.textContent = notes.join(" · ");
}

/**
 * Top-terms data: token frequencies with stopword filtering and the share of
 * shaped values (email/URL/phone/number/date) for the selected text column.
 */
export function refreshText(card: ChartCard): void {
  if (card.config.kind !== "terms") {
    card.textResult = null;
    return;
  }
  const meta = card.meta(card.config.column);
  if (meta === undefined || meta.type !== "string") {
    card.textResult = null;
    return;
  }
  const generation = ++card.generation;
  const column = card.config.column;
  void card.options
    .requestTextProfile(column)
    .then((message) => {
      if (generation !== card.generation || card.disposed) return;
      card.textResult = message;
      card.render();
    })
    .catch(() => {
      // Keep the last payload as the fallback.
    });
}

/** Horizontal bars of the most frequent terms; clicking filters by term. */
export function drawTerms(card: ChartCard, ctx: CanvasRenderingContext2D, frame: Frame): void {
  const meta = card.meta(card.config.column);
  if (meta === undefined || meta.type !== "string") {
    const message = "Top terms need a text column — pick one above.";
    card.noteEl.textContent = message;
    card.drawPlotMessage(ctx, frame, message);
    return;
  }
  const result = card.textResult;
  if (result === null) {
    const message = "Reading the text…";
    card.noteEl.textContent = message;
    card.drawPlotMessage(ctx, frame, message);
    return;
  }
  const profile = result.profile;
  const goneTerms = card.excludedTerms(card.config.column);
  const baseTerms = profile.topTerms
    .filter((entry) => !goneTerms.has(entry.term.toLowerCase()))
    .slice(0, Math.max(8, card.config.topN));
  const state =
    card.itemWindow ?? { start: 0, count: Math.min(baseTerms.length, Math.max(8, card.config.topN)) };
  const start = Math.max(0, Math.min(baseTerms.length - 1, state.start));
  const terms = baseTerms.slice(
    start,
    start + Math.max(1, Math.min(state.count, baseTerms.length - start)),
  );
  if (terms.length === 0) {
    const message =
      "No terms found — the column may be mostly numbers, single letters or stopwords.";
    card.noteEl.textContent = message;
    card.drawPlotMessage(ctx, frame, message);
    return;
  }
  const ui = frame.ui;
  const max = terms[0]?.count ?? 1;
  const rowH = Math.min(30 * ui, frame.plotH / terms.length);
  const labelW = Math.min(150 * ui, frame.plotW * 0.4);
  const barTrackW = Math.max(20 * ui, frame.plotW - labelW - 56 * ui);

  card.hitRegions = terms.map((entry, index) => ({
    x: frame.left,
    y: frame.top + index * rowH,
    w: frame.plotW,
    h: rowH,
    lines: [
      `“${entry.term}”`,
      `${formatCount(entry.count)} tokens · ${(
        profile.totalTokens > 0 ? (entry.count / profile.totalTokens) * 100 : 0
      ).toFixed(1)}%`,
      "click to filter rows containing this term",
    ],
    actions: [{ kind: "text" as const, column: card.config.column, query: entry.term }],
  }));

  terms.forEach((entry, index) => {
    const y = frame.top + index * rowH;
    ctx.textAlign = "left";
    ctx.fillStyle = frame.text;
    card.font(ctx, ui, 11, "600");
    ctx.fillText(
      card.fit(ctx, entry.term, labelW - 6 * ui),
      frame.left,
      y + rowH * 0.68,
    );
    const width = Math.max(2, (entry.count / max) * barTrackW);
    ctx.fillStyle = card.primaryColor();
    ctx.globalAlpha = Math.max(0.25, 0.85 - index * 0.05);
    ctx.fillRect(frame.left + labelW, y + rowH * 0.24, width, rowH * 0.5);
    ctx.globalAlpha = 1;
    const share = profile.totalTokens > 0 ? (entry.count / profile.totalTokens) * 100 : 0;
    ctx.fillStyle = frame.dim;
    card.font(ctx, ui, 10);
    ctx.fillText(
      `${formatCount(entry.count)} · ${share.toFixed(1)}%`,
      frame.left + labelW + width + 6 * ui,
      y + rowH * 0.68,
    );
  });
  ctx.textAlign = "left";

  const notes = [
    `${terms.length} terms`,
    `${formatCount(profile.totalTokens)} tokens`,
    `${formatCount(profile.distinctTerms)} distinct`,
  ];
  if (result.ms > 0) notes.push(`${Math.round(result.ms)} ms`);
  card.noteEl.textContent = notes.join(" · ");
}

export function refreshBox(card: ChartCard): void {
  if (card.config.kind !== "box") {
    card.boxResult = null;
    return;
  }
  const value = card.meta(card.config.x);
  const category = card.meta(card.config.y);
  if (
    value === undefined ||
    category === undefined ||
    !isNumericType(value.type) ||
    !isGroupable(category)
  ) {
    card.boxResult = null;
    return;
  }
  const generation = ++card.generation;
  void card.options
    .requestBoxStats({
      valueColumn: card.config.x,
      categoryColumn: card.config.y,
      topN: card.config.topN,
      groupOther: card.config.groupOther,
      ...card.chartScope(),
    })
    .then((message) => {
      if (generation !== card.generation || card.disposed) return;
      card.boxResult = message.result;
      card.statsMs = message.ms;
      card.render();
    })
    .catch(() => {
      // Keep the last payload as the fallback.
    });
}

/**
 * Bins per category for a grouped time series. Uses the column's automatic
 * range so the grouped and ungrouped axes line up.
 */
export function refreshGroupedBins(card: ChartCard): void {
  const groupedKind = card.config.kind === "line" || card.config.kind === "histogram";
  if (!groupedKind || card.config.groupColumn < 0) {
    card.groupResult = null;
    return;
  }
  const request = card.options.requestGroupedBins;
  if (request === undefined) {
    card.groupResult = null;
    return;
  }
  const meta = card.meta(card.config.column);
  const groupMeta = card.meta(card.config.groupColumn);
  const numericAxis = meta !== undefined && isNumericLikeType(meta.type);
  if (
    meta === undefined ||
    !numericAxis ||
    meta.histogram === null ||
    groupMeta === undefined ||
    !isGroupable(groupMeta)
  ) {
    card.groupResult = null;
    return;
  }
  const histogram = meta.histogram;
  const options: ChartBinOptions = {
    min: histogram.min,
    max: histogram.max,
    binCount: histogram.bins.length === 0 ? DEFAULT_BIN_COUNT : histogram.bins.length,
    overflow: false,
  };
  const generation = ++card.generation;
  const column = card.config.column;
  const groupColumn = card.config.groupColumn;
  void request({ column, groupColumn, options, topN: GROUP_LINE_LIMIT, ...card.excludeScope() })
    .then((message) => {
      if (generation !== card.generation || card.disposed) return;
      card.groupResult = message;
      card.render();
    })
    .catch(() => {
      // Keep the automatic single line as the fallback.
    });
}

/** Widest expected Y tick label for the current kind, for the left margin. */
export function widestYLabel(card: ChartCard, ctx: CanvasRenderingContext2D, ui: number): string {
  card.font(ctx, ui, 10);
  const widest = (labels: readonly string[]): string => {
    let best = "";
    let bestWidth = -1;
    for (const label of labels) {
      const width = ctx.measureText(label).width;
      if (width > bestWidth) {
        bestWidth = width;
        best = label;
      }
    }
    return best;
  };
  switch (card.config.kind) {
    case "scatter":
    case "density": {
      const result = card.seriesResult;
      const yMin = result === null ? 0 : result.yMin;
      const yMax = result === null ? 1 : result.yMax;
      const meta = card.meta(card.config.y);
      const axisKind = meta === undefined ? null : axisKindFor(meta.type);
      return widest(
        niceTicks(yMin, yMax, 4).map((value) => formatTick(value, axisKind, yMax - yMin)),
      );
    }
    case "box": {
      let max = 1;
      for (const group of card.boxResult?.groups ?? []) {
        if (group.max > max) max = group.max;
      }
      return widest(niceTicks(0, max, 5).map((value) => formatTick(value, "histogram")));
    }
    case "correlation": {
      const labels = card.correlationResult?.labels ?? [];
      return widest(labels);
    }
    case "histogram":
      // Grouped histograms label the Y axis in percent of the group.
      return card.groupResult === null ? formatCount(card.rowCount) : "100%";
    case "line":
    case "bar":
      // The Y axis is a count axis on these kinds.
      return formatCount(card.rowCount);
    default:
      // Heatmap fits its labels to the margin already.
      return "";
  }
}

export function fillTopRounded(card: ChartCard, ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, radius: number): void {
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
 * KPI card: the latest value large, the change vs the previous period in
 * green/red, and a faint sparkline of the series behind it. Without a date
 * column the series has one row and the card is the grand total.
 */
export function drawKpi(card: ChartCard, ctx: CanvasRenderingContext2D, frame: Frame, result: AggregateMessage, values: Float64Array): void {
  const ui = frame.ui;
  const n = result.groupCount;
  const latest = values[n - 1] ?? Number.NaN;
  const measure = result.measureNames[0] ?? "value";
  const overTime = result.dimensionNames.length > 0;
  if (!Number.isFinite(latest)) {
    const message = "No value to show for this measure.";
    card.noteEl.textContent = message;
    card.drawPlotMessage(ctx, frame, message);
    return;
  }
  const full = latest.toLocaleString(undefined, { maximumFractionDigits: 2 });

  // Sparkline: the whole series, faint, across the plot width.
  if (overTime && n >= 2) {
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (const value of values) {
      if (!Number.isFinite(value)) continue;
      min = Math.min(min, value);
      max = Math.max(max, value);
    }
    if (Number.isFinite(min) && max > min) {
      ctx.strokeStyle = card.primaryColor();
      ctx.globalAlpha = 0.3;
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const x = frame.left + ((i + 0.5) / n) * frame.plotW;
        const y =
          frame.top + frame.plotH * (1 - ((values[i] ?? min) - min) / (max - min));
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  // The big number (compacted like value axes: 1.5M, 50k, 12.5).
  const big = formatTick(latest, null);
  const bigSize = Math.min(40, (frame.plotH * 0.45) / ui);
  ctx.fillStyle = frame.text;
  card.font(ctx, ui, bigSize, "700");
  ctx.fillText(card.fit(ctx, big, frame.plotW), frame.left, frame.top + frame.plotH * 0.45);

  // Change vs the previous bucket, in green (up) / red (down).
  const previous = n >= 2 ? (values[n - 2] ?? Number.NaN) : Number.NaN;
  let deltaNote = "";
  if (overTime && Number.isFinite(previous)) {
    const delta = latest - previous;
    const pct = previous !== 0 ? (delta / previous) * 100 : null;
    const flat = delta === 0;
    const arrow = flat ? "→" : delta > 0 ? "↑" : "↓";
    const pctText = pct === null ? "" : ` (${delta > 0 ? "+" : ""}${pct.toFixed(1)}%)`;
    const text = `${arrow} ${formatTick(Math.abs(delta), null)}${pctText} vs previous ${
      result.dimensionNames[0] ?? "period"
    }`;
    ctx.fillStyle = flat ? frame.dim : delta > 0 ? "#10b981" : "#ef4444";
    card.font(ctx, ui, 13, "600");
    ctx.fillText(card.fit(ctx, text, frame.plotW), frame.left, frame.top + frame.plotH * 0.26 + bigSize * ui * 0.2 + 18 * ui);
    deltaNote = ` · ${text}`;
  }

  ctx.fillStyle = frame.dim;
  card.font(ctx, ui, 12);
  const caption = overTime
    ? `${result.labels[n - 1] ?? ""} · ${measure}`
    : `${measure} · all filtered rows`;
  ctx.fillText(card.fit(ctx, caption, frame.plotW), frame.left, frame.top + frame.plotH * 0.88);
  card.noteEl.textContent = `${measure} = ${full}${deltaNote}`;
}

/**
 * A card that draws an aggregate result (a bound view, or the card's own
 * value-over-time aggregate) renders it as a line when the first dimension
 * is a time bucket, bars otherwise.
 */
/**
 * The dot plot, 100% stacked bar, small multiples, slopegraph and waterfall
 * draw from the same aggregate as the other measure charts; their layouts
 * live in chart-extra-draw. Returns false for every other kind.
 */
export function drawExtraKind(card: ChartCard, ctx: CanvasRenderingContext2D, frame: Frame, result: AggregateMessage, values: Float64Array): boolean {
  const kind = card.config.kind;
  if (
    kind !== "dotplot" &&
    kind !== "stacked100" &&
    kind !== "smallmultiples" &&
    kind !== "slopegraph" &&
    kind !== "waterfall"
  ) {
    return false;
  }
  if (GROUP_REQUIRED_KINDS.includes(kind) && result.dimensions.length < 2) {
    const message = `Pick a Group by column in the card settings: a ${CHART_KIND_LABELS[kind].toLowerCase()} compares groups.`;
    card.noteEl.textContent = message;
    card.drawPlotMessage(ctx, frame, message);
    return true;
  }
  const column = card.config.column;
  const meta = card.meta(column);
  const labels = meta?.categories?.labels ?? [];
  const painter: Painter = {
    font: (c, ui, size, weight) => card.font(c, ui, size, weight),
    fit: (c, text, maxWidth) => card.fit(c, text, maxWidth),
    groupColor: (index) => card.groupColor(index),
    primaryColor: () => card.primaryColor(),
    actionsFor: (label) => {
      const code = labels.indexOf(label);
      return meta !== undefined && code >= 0 ? [{ kind: "values", column, code }] : [];
    },
  };
  const limit = Math.max(2, Math.min(12, card.config.topN));
  const drawn =
    kind === "dotplot"
      ? drawDotPlot(ctx, frame, painter, result, values)
      : kind === "stacked100"
        ? drawStacked100(ctx, frame, painter, result, values, Math.min(8, limit))
        : kind === "smallmultiples"
          ? drawSmallMultiples(ctx, frame, painter, result, values, limit)
          : kind === "slopegraph"
            ? drawSlopegraph(ctx, frame, painter, result, values, Math.max(limit, 8))
            : drawWaterfall(ctx, frame, painter, result, values, 30);
  card.hitRegions = drawn.hits;
  card.noteEl.textContent = drawn.note;
  return true;
}

/** The reference lines' rows in the sidebar, rebuilt only when the chart's columns or the lines themselves change. */
export function syncRefLines(card: ChartCard): void {
  const lines = card.config.refLines ?? [];
  const key = JSON.stringify([card.config.kind, card.config.x, card.config.y, card.config.column, card.config.valueColumn, lines.map((line) => [line.axis, line.source])]);
  const supported = card.config.kind !== "map" && (card.hasValueAxis() || card.config.kind === "histogram");
  card.refSection.parentElement?.classList.toggle("hidden", !supported);
  if (!supported || key === card.refKey) return;
  card.refKey = key;
  card.refRows.replaceChildren();
  lines.forEach((line, index) => {
    const axisSelect = el("select", { class: "chart-picker chart-picker-small", "aria-label": "Line direction" }) as HTMLSelectElement;
    const options: [string, string][] = [];
    if (card.hasValueAxis()) options.push(["y", "Horizontal"]);
    if (card.config.kind !== "bar" && card.config.kind !== "barplot") options.push(["x", "Vertical"]);
    for (const [value, label] of options) axisSelect.append(el("option", { value }, [label]) as HTMLOptionElement);
    axisSelect.value = line.axis;
    const sourceSelect = el("select", { class: "chart-picker chart-picker-small", "aria-label": "Where the line sits" }) as HTMLSelectElement;
    const column = card.refAxisColumn(line.axis);
    const name = card.meta(column)?.name ?? "";
    sourceSelect.append(el("option", { value: "value" }, ["At a value"]) as HTMLOptionElement);
    if (column >= 0) {
      sourceSelect.append(el("option", { value: "mean" }, [`Mean of ${name}`]) as HTMLOptionElement);
    }
    sourceSelect.value = column >= 0 || line.source === "value" ? line.source : "value";
    const isDate = card.meta(column)?.type === "date" || card.meta(column)?.type === "datetime";
    const input = el("input", {
      class: "chart-number chart-ref-value",
      type: "text",
      inputmode: "decimal",
      placeholder: isDate ? "e.g. 2021-03-01" : "e.g. 10.8",
      "aria-label": "Value of the line",
      spellcheck: "false",
    }) as HTMLInputElement;
    if (line.value !== undefined) input.value = isDate ? new Date(line.value).toISOString().slice(0, 10) : String(line.value);
    input.classList.toggle("hidden", line.source !== "value");
    const remove = el("button", { class: "icon-btn", type: "button", title: "Remove this line", "aria-label": "Remove this line" }, ["×"]) as HTMLButtonElement;
    const update = (patch: Partial<RefLine>): void => {
      const next = [...(card.config.refLines ?? [])];
      next[index] = { ...next[index]!, ...patch };
      card.config.refLines = next;
    };
    axisSelect.addEventListener("change", () => {
      update({ axis: axisSelect.value as "x" | "y", source: "value" });
      card.refKey = "";
      card.syncRefLines();
      card.render();
    });
    sourceSelect.addEventListener("change", () => {
      update({ source: sourceSelect.value as RefLine["source"] });
      card.refKey = "";
      card.syncRefLines();
      card.render();
    });
    input.addEventListener("input", () => {
      const text = input.value.trim().replace(/,/g, "");
      const value = isDate ? Date.parse(text.length === 10 ? `${text}T00:00:00Z` : text) : text === "" ? Number.NaN : Number(text);
      const next = [...(card.config.refLines ?? [])];
      next[index] = { ...next[index]!, value: Number.isFinite(value) ? value : undefined };
      card.config.refLines = next;
      card.render();
    });
    remove.addEventListener("click", () => {
      card.config.refLines = (card.config.refLines ?? []).filter((_, i) => i !== index);
      card.refKey = "";
      card.syncRefLines();
      card.render();
    });
    card.refRows.append(el("div", { class: "chart-ref-row" }, [axisSelect, sourceSelect, input, remove]));
  });
}

/** Draws the reference lines over the plot, on whichever numeric axes this chart recorded. */
export function drawReferenceLines(card: ChartCard, ctx: CanvasRenderingContext2D): void {
  const lines = card.config.refLines ?? [];
  if (lines.length === 0) return;
  const space = card.brushSpace;
  const scale = card.valueScale;
  const isDateAxis = (axis: "x" | "y"): boolean => {
    const type = card.meta(card.refAxisColumn(axis))?.type;
    return type === "date" || type === "datetime";
  };
  const ink = getComputedStyle(card.canvas).color || "#444";
  ctx.save();
  ctx.setLineDash([6, 4]);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = ink;
  ctx.fillStyle = ink;
  ctx.font = "600 11px system-ui, sans-serif";
  for (const line of lines) {
    const value = card.refValue(line);
    if (value === null) continue;
    const label = `${line.source === "value" ? "" : `${line.source} `}${isDateAxis(line.axis) ? new Date(value).toISOString().slice(0, 10) : formatChartNumber(value)}`;
    if (line.axis === "y") {
      let y: number | null = null;
      let left = 0;
      let width = 0;
      if (space !== null && space.yMin !== undefined && space.yMax !== undefined && space.yMax > space.yMin) {
        y = space.top + space.plotH - ((value - space.yMin) / (space.yMax - space.yMin)) * space.plotH;
        ({ left, plotW: width } = space);
        if (value < space.yMin || value > space.yMax) y = null;
      } else if (scale !== null && scale.yMax > 0 && space !== null) {
        y = scale.top + scale.plotH - (value / scale.yMax) * scale.plotH;
        ({ left, plotW: width } = space);
        if (value < 0 || value > scale.yMax) y = null;
      } else if (scale !== null && scale.yMax > 0 && card.hitRegions.length > 0) {
        const first = card.hitRegions[0]!;
        const last = card.hitRegions[card.hitRegions.length - 1]!;
        y = scale.top + scale.plotH - (value / scale.yMax) * scale.plotH;
        left = Math.min(first.x, last.x) - 4;
        width = Math.max(first.x + first.w, last.x + last.w) - left + 4;
        if (value < 0 || value > scale.yMax) y = null;
      }
      if (y === null) continue;
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(left + width, y);
      ctx.stroke();
      ctx.textAlign = "right";
      ctx.fillText(label, left + width - 4, y - 4);
    } else if (space !== null && space.xMax > space.xMin && value >= space.xMin && value <= space.xMax) {
      const x = space.left + ((value - space.xMin) / (space.xMax - space.xMin)) * space.plotW * space.xFraction;
      ctx.beginPath();
      ctx.moveTo(x, space.top);
      ctx.lineTo(x, space.top + space.plotH);
      ctx.stroke();
      ctx.textAlign = x > space.left + space.plotW * 0.8 ? "right" : "left";
      ctx.fillText(label, x + (ctx.textAlign === "right" ? -4 : 4), space.top + 12);
    }
  }
  ctx.restore();
}

/**
 * Column names for the axes of the current chart, or null where a title
 * would be noise (treemaps label their tiles, correlation its cells).
 */
export function axisLabels(card: ChartCard): { x: string | null; y: string | null } {
  const name = (index: number): string | null =>
    index >= 0 ? (card.meta(index)?.name ?? null) : null;
  if (card.config.kind === "barplot") {
    const measure = name(card.config.valueColumn ?? -1);
    return {
      x: name(card.config.column),
      y: measure === null ? null : plainMeasureName(`${card.config.valueAgg ?? "mean"}(${measure})`),
    };
  }
  // Aggregate cards (bound views and own value lines) draw from the
  // aggregate; their own column picks do not describe those axes.
  if (card.usesAggregate()) return { x: null, y: null };
  switch (card.config.kind) {
    case "histogram":
      // Grouped histograms draw each group's share per bin, not raw counts.
      return {
        x: name(card.config.column),
        y: card.groupResult === null ? "Rows" : "% of group",
      };
    case "line":
    case "bar":
      return { x: name(card.config.column), y: "Rows" };
    case "scatter":
    case "density":
    case "bubble":
      return { x: name(card.config.x), y: name(card.config.y) };
    case "box":
      // Values run up the Y axis (config.x); each group slot along the
      // X axis already carries its own label, so it needs no title.
      return { x: null, y: name(card.config.x) };
    case "heatmap":
      return { x: name(card.config.x), y: name(card.config.y) };
    default:
      return { x: null, y: null };
  }
}

/** Axis titles: X centred under the plot, Y rotated beside its ticks. */
export function drawAxisTitles(card: ChartCard, ctx: CanvasRenderingContext2D, frame: Frame, xLabel: string | null, yLabel: string | null): void {
  const ui = frame.ui;
  const xOverride = card.config.xTitle?.trim() ?? "";
  const yOverride = card.config.yTitle?.trim() ?? "";
  const unit = card.config.yUnit?.trim() ?? "";
  const xText = xOverride !== "" ? xOverride : (xLabel ?? "");
  let yText = yOverride !== "" ? yOverride : (yLabel ?? "");
  if (unit !== "") yText = yText === "" ? `(${unit})` : `${yText} (${unit})`;

  card.font(ctx, ui, 10.5, "600");
  ctx.fillStyle = frame.dim;
  if (xText !== "") {
    ctx.textAlign = "center";
    const cx = frame.left + frame.plotW / 2;
    const cy = frame.top + frame.plotH + frame.bottom - 9 * ui;
    const fitted = card.fit(ctx, xText, frame.plotW);
    ctx.fillText(fitted, cx, cy);
    if (fitted !== xText) {
      // Truncated titles keep their full text in a hover tooltip.
      const width = ctx.measureText(fitted).width;
      card.hitRegions.push({
        x: cx - width / 2,
        y: cy - 10 * ui,
        w: width,
        h: 13 * ui,
        lines: [xText],
        actions: [],
      });
    }
  }
  if (yText !== "") {
    const tx = frame.left - 6 * ui - frame.tickW - 9 * ui;
    const cy = frame.top + frame.plotH / 2;
    ctx.save();
    ctx.translate(tx, cy);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = "center";
    const fitted = card.fit(ctx, yText, frame.plotH);
    ctx.fillText(fitted, 0, 0);
    ctx.restore();
    if (fitted !== yText) {
      const width = ctx.measureText(fitted).width;
      card.hitRegions.push({
        x: tx - 7 * ui,
        y: cy - width / 2,
        w: 14 * ui,
        h: width,
        lines: [yText],
        actions: [],
      });
    }
  }
  ctx.textAlign = "left";
}

export function drawBars(card: ChartCard, ctx: CanvasRenderingContext2D, frame: Frame): void {
  if (card.animationResult?.bar !== undefined) {
    card.drawAnimatedBars(ctx, frame);
    return;
  }
  const meta = card.meta(card.config.column);
  if (meta === undefined) {
    const message = card.emptySeriesMessage("bar");
    card.noteEl.textContent = message;
    card.drawPlotMessage(ctx, frame, message);
    return;
  }
  const all = card.allCategoryBars();
  if (all.length === 0) {
    const message = "This column has no category data yet.";
    card.noteEl.textContent = message;
    card.drawPlotMessage(ctx, frame, message);
    return;
  }
  const windowState = card.barWindow ?? {
    start: 0,
    count: Math.max(1, card.config.topN),
  };
  const windowEnd = Math.min(
    all.length,
    windowState.start + Math.max(1, windowState.count),
  );
  const bars: CategoryBar[] = all.slice(windowState.start, windowEnd).map((bar) => ({ ...bar }));
  const totalAll = all.reduce((sum, bar) => sum + bar.count, 0);
  if (card.barWindow === null && card.config.groupOther && windowEnd < all.length) {
    const count = all.slice(windowEnd).reduce((sum, bar) => sum + bar.count, 0);
    bars.push({
      label: "Other",
      count,
      pct: totalAll > 0 ? (count / totalAll) * 100 : 0,
      other: true,
    });
  }
  const ui = frame.ui;
  // Headroom above the tallest bar, so its count and share sit on the page, not on the bar.
  const maxCount = Math.max(1, ...bars.map((bar) => bar.count)) * 1.12;
  const slotW = frame.plotW / bars.length;
  const barW = Math.max(4, slotW - Math.min(18 * ui, slotW * 0.25));
  const labels = meta.categories?.labels ?? [];
  const codes = bars.map((bar) =>
    bar.other === true ? -1 : labels.indexOf(bar.label),
  );
  card.valueScale = {
    yMax: maxCount,
    top: frame.top,
    plotH: frame.plotH,
    mode: "bars",
    inset: (slotW - barW) / 2,
    barW,
    regionColumn: card.config.column,
    measure: null,
    // Count bars come from the table facets, not this card's own scope.
    scoped: false,
  };
  card.hitRegions = barHitRegions(
    { left: frame.left, top: frame.top, plotW: frame.plotW, plotH: frame.plotH },
    bars,
    codes,
    card.config.column,
  );

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

  card.font(ctx, ui, 10);
  bars.forEach((bar, index) => {
    const x = frame.left + index * slotW + (slotW - barW) / 2;
    const h = (bar.count / maxCount) * frame.plotH;
    ctx.fillStyle =
      bar.other === true
        ? frame.dim
        : card.config.multiColor
          ? card.paletteColor(index)
          : card.primaryColor();
    ctx.globalAlpha = bar.other === true ? 0.5 : 0.9;
    card.fillTopRounded(ctx, x, frame.top + frame.plotH - h, barW, h, 4 * ui);
    ctx.globalAlpha = 1;

    ctx.textAlign = "center";
    ctx.fillStyle = frame.text;
    const countLabel = bar.count.toLocaleString();
    const pctLabel = `${bar.pct.toFixed(1)}%`;
    const cx = x + barW / 2;
    const topY = Math.max(frame.top + 8 * ui, frame.top + frame.plotH - h - 14 * ui);
    ctx.fillText(countLabel, cx, topY);
    ctx.fillStyle = frame.dim;
    ctx.fillText(pctLabel, cx, topY + 11 * ui);

    const maxLabelW = Math.max(10, slotW - 6 * ui);
    const fullLabel = bar.label === "" ? "(blank)" : bar.label;
    let label = fullLabel;
    while (label.length > 2 && ctx.measureText(label).width > maxLabelW) {
      label = label.slice(0, -2);
    }
    if (label !== fullLabel) label = `${label}…`;
    ctx.fillStyle = frame.dim;
    ctx.fillText(label, cx, frame.top + frame.plotH + 16 * ui);
    if (bar.other === true) {
      ctx.fillText("rest", cx, frame.top + frame.plotH + 28 * ui);
    }
  });
  ctx.textAlign = "left";

  const shown = bars.reduce((sum, bar) => sum + bar.count, 0);
  const windowNote =
    card.barWindow === null
      ? ""
      : ` · showing ${windowState.start + 1}–${windowEnd} of ${all.length}`;
  card.noteEl.textContent = `${bars.length} bars covering ${shown.toLocaleString()} values — top ${Math.min(
    card.config.topN,
    bars.length,
  )}${card.config.groupOther && bars.some((bar) => bar.other === true) ? " + Other" : ""}${windowNote} · Ctrl+scroll to zoom · drag to pan · double-click resets`;
}

export function drawAxes(card: ChartCard, ctx: CanvasRenderingContext2D, frame: Frame, xMin: number, xMax: number, yMin: number, yMax: number, xKind: "histogram" | AxisFormat, yKind: "histogram" | AxisFormat): void {
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
  const ui = frame.ui;
  // Tick density follows the actual plot width so narrow cards stay legible.
  const xTarget = Math.max(2, Math.min(6, Math.floor(frame.plotW / (90 * ui))));
  const xTicks = niceTicks(xMin, xMax, xTarget);
  const yTicks = niceTicks(yMin, yMax, 4).filter((value, index, all) => index === 0 || formatChartNumber(value) !== formatChartNumber(all[index - 1]));
  const xSpan = xMax - xMin;
  const ySpan = yMax - yMin;
  ctx.strokeStyle = frame.border;
  ctx.lineWidth = 1;
  ctx.fillStyle = frame.dim;
  card.font(ctx, ui, 10);
  ctx.textAlign = "right";
  for (const value of yTicks) {
    const y = frame.top + frame.plotH - ((value - yMin) / (yMax - yMin)) * frame.plotH;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(frame.left, y + 0.5);
    ctx.lineTo(frame.left + frame.plotW, y + 0.5);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillText(formatTick(value, yKind, ySpan), frame.left - 6 * ui, y + 3 * ui);
  }
  ctx.textAlign = "center";
  for (const value of xTicks) {
    const x = frame.left + ((value - xMin) / (xMax - xMin)) * frame.plotW;
    ctx.fillText(formatTick(value, xKind, xSpan), x, frame.top + frame.plotH + 16 * ui);
  }
  ctx.textAlign = "left";
  ctx.beginPath();
  ctx.moveTo(frame.left, frame.top + frame.plotH + 0.5);
  ctx.lineTo(frame.left + frame.plotW, frame.top + frame.plotH + 0.5);
  ctx.stroke();

  // Zero reference lines when either domain crosses zero.
  ctx.save();
  ctx.strokeStyle = frame.dim;
  ctx.globalAlpha = 0.55;
  ctx.setLineDash([2, 3]);
  if (yMin < 0 && yMax > 0) {
    const zeroY = frame.top + frame.plotH - ((0 - yMin) / (yMax - yMin)) * frame.plotH;
    ctx.beginPath();
    ctx.moveTo(frame.left, zeroY + 0.5);
    ctx.lineTo(frame.left + frame.plotW, zeroY + 0.5);
    ctx.stroke();
  }
  if (xMin < 0 && xMax > 0) {
    const zeroX = frame.left + ((0 - xMin) / (xMax - xMin)) * frame.plotW;
    ctx.beginPath();
    ctx.moveTo(zeroX + 0.5, frame.top);
    ctx.lineTo(zeroX + 0.5, frame.top + frame.plotH);
    ctx.stroke();
  }
  ctx.restore();
}

export function drawBox(card: ChartCard, ctx: CanvasRenderingContext2D, frame: Frame): void {
  const result = card.boxResult;
  if (result === null || result.groups.length === 0) {
    const message =
      card.columns.length === 0
        ? "Load data to see charts."
        : "Box plots need a numeric Value column and a category Groups column — pick them above.";
    card.noteEl.textContent = message;
    card.drawPlotMessage(ctx, frame, message);
    return;
  }
  const ui = frame.ui;
  const state = card.boxWindow ?? { start: 0, count: result.groups.length };
  const start = Math.max(
    0,
    Math.min(result.groups.length - 1, state.start),
  );
  const groups = result.groups.slice(
    start,
    start + Math.max(1, Math.min(state.count, result.groups.length - start)),
  );
  // Categories whose value column is entirely missing do not appear in the
  // stats; give each one a slot so it is visible as "no values" instead of
  // silently vanishing from the chart.
  const groupMeta = card.meta(card.config.y);
  const present = new Set(groups.map((group) => group.label));
  const leftOut = card.excludedLabels(card.config.y);
  const emptyLabels = (groupMeta?.categories?.labels ?? [])
    .filter((label) => label !== "Other" && !present.has(label) && !leftOut.has(label))
    .slice(0, 3);
  const slotCount = groups.length + emptyLabels.length;
  card.hitRegions = boxHitRegions(
    { left: frame.left, top: frame.top, plotW: frame.plotW, plotH: frame.plotH },
    groups,
    slotCount,
  );
  // A box stands for one category value: right-click can leave it out.
  const boxLabels = groupMeta?.categories?.labels ?? [];
  card.hitRegions.forEach((region, index) => {
    const code = boxLabels.indexOf(groups[index]?.label ?? "");
    if (code >= 0 && groups[index]?.label !== "Other") {
      region.contextActions = [{ kind: "values", column: card.config.y, code }];
    }
  });
  let yMin = Infinity;
  let yMax = -Infinity;
  for (const group of groups) {
    if (group.min < yMin) yMin = group.min;
    if (group.max > yMax) yMax = group.max;
  }
  if (!(yMax > yMin)) {
    yMin -= 1;
    yMax += 1;
  }
  if (card.boxY !== null) {
    yMin = card.boxY.min;
    yMax = card.boxY.max;
  }
  const yOf = (value: number): number =>
    frame.top + frame.plotH - ((value - yMin) / (yMax - yMin)) * frame.plotH;

  // Compact "2k" ticks make no sense for a narrow integer range (birth
  // years): keep plain integers there and compact only wide ranges.
  const valueMeta = card.meta(card.config.x);
  const ticks = niceTicks(yMin, yMax, 5);
  const plainIntegerTicks =
    valueMeta?.type === "integer" && yMax - yMin <= 100_000;
  const tickLabel = (value: number): string =>
    plainIntegerTicks ? formatCount(value) : formatTick(value, "histogram");
  ctx.strokeStyle = frame.border;
  ctx.lineWidth = 1;
  ctx.fillStyle = frame.dim;
  card.font(ctx, ui, 10);
  ctx.textAlign = "right";
  for (const value of ticks) {
    const y = yOf(value);
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(frame.left, y + 0.5);
    ctx.lineTo(frame.left + frame.plotW, y + 0.5);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillText(tickLabel(value), frame.left - 6 * ui, y + 3 * ui);
  }
  ctx.textAlign = "left";
  ctx.beginPath();
  ctx.moveTo(frame.left, frame.top + frame.plotH + 0.5);
  ctx.lineTo(frame.left + frame.plotW, frame.top + frame.plotH + 0.5);
  ctx.stroke();

  const slot = frame.plotW / Math.max(1, slotCount);
  const boxW = Math.min(slot * 0.55, 54 * ui);
  const cap = Math.max(3 * ui, boxW * 0.25);
  groups.forEach((group, index) => {
    const cx = frame.left + (index + 0.5) * slot;
    const yQ1 = yOf(group.q1);
    const yQ3 = yOf(group.q3);
    const top = Math.min(yQ1, yQ3);
    const height = Math.max(1.5, Math.abs(yQ1 - yQ3));

    ctx.globalAlpha = group.other ? 0.2 : 0.32;
    ctx.fillStyle = card.primaryColor();
    ctx.fillRect(cx - boxW / 2, top, boxW, height);
    ctx.globalAlpha = group.other ? 0.5 : 0.9;
    ctx.strokeStyle = card.primaryColor();
    ctx.lineWidth = 1.5;
    ctx.strokeRect(cx - boxW / 2, top, boxW, height);

    const yMedian = yOf(group.median);
    ctx.beginPath();
    ctx.moveTo(cx - boxW / 2, yMedian);
    ctx.lineTo(cx + boxW / 2, yMedian);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(cx, top);
    ctx.lineTo(cx, yOf(group.whiskerHigh));
    ctx.moveTo(cx, top + height);
    ctx.lineTo(cx, yOf(group.whiskerLow));
    ctx.stroke();
    for (const value of [group.whiskerHigh, group.whiskerLow]) {
      const y = yOf(value);
      ctx.beginPath();
      ctx.moveTo(cx - cap, y);
      ctx.lineTo(cx + cap, y);
      ctx.stroke();
    }

    ctx.globalAlpha = 0.65;
    ctx.fillStyle = card.primaryColor();
    const r = 1.6 * ui;
    ctx.beginPath();
    for (const value of group.outliers) addMarkerPath(ctx, "circle", cx, yOf(value), r);
    ctx.fill();
    ctx.strokeStyle = darkerColor(card.primaryColor(), BORDER_DARKER);
    ctx.globalAlpha = BORDER_ALPHA;
    ctx.lineWidth = Math.max(0.9, ui);
    ctx.stroke();
    ctx.globalAlpha = 1;

    ctx.textAlign = "center";
    ctx.fillStyle = frame.text;
    card.font(ctx, ui, 9.5, "600");
    const medianLabel = formatChartNumber(group.median);
    const medianY = Math.max(frame.top + 9 * ui, top - 4 * ui);
    ctx.fillText(card.fit(ctx, medianLabel, Math.max(10, slot - 4 * ui)), cx, medianY);

    ctx.fillStyle = frame.dim;
    card.font(ctx, ui, 10);
    const maxWidth = Math.max(10, slot - 6 * ui);
    const label = group.label === "" ? "(blank)" : group.label;
    ctx.fillText(card.fit(ctx, label, maxWidth), cx, frame.top + frame.plotH + 16 * ui);
    card.font(ctx, ui, 9);
    ctx.fillText(formatCount(group.count), cx, frame.top + frame.plotH + 27 * ui);
    if (group.other) ctx.fillText("rest", cx, frame.top + frame.plotH + 38 * ui);
  });

  if (emptyLabels.length > 0) {
    const midY = frame.top + frame.plotH / 2;
    emptyLabels.forEach((label, index) => {
      const cx = frame.left + (groups.length + index + 0.5) * slot;
      ctx.strokeStyle = frame.dim;
      ctx.globalAlpha = 0.6;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(cx - cap, midY);
      ctx.lineTo(cx + cap, midY);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      ctx.textAlign = "center";
      ctx.fillStyle = frame.dim;
      card.font(ctx, ui, 9);
      ctx.fillText(
        card.fit(ctx, "no values", Math.max(10, slot - 4 * ui)),
        cx,
        midY - 8 * ui,
      );
      card.font(ctx, ui, 10);
      ctx.fillText(
        card.fit(ctx, label === "" ? "(blank)" : label, Math.max(10, slot - 6 * ui)),
        cx,
        frame.top + frame.plotH + 16 * ui,
      );
    });
  }
  ctx.textAlign = "left";

  let outliers = 0;
  for (const group of groups) outliers += group.outliers.length;
  const notes = [
    `${groups.length} ${groups.length === 1 ? "group" : "groups"}`,
    `${result.total.toLocaleString()} values`,
    `${outliers.toLocaleString()} outliers`,
  ];
  if (emptyLabels.length > 0) {
    notes.push(
      `${emptyLabels.length} ${emptyLabels.length === 1 ? "group has" : "groups have"} no values`,
    );
  }
  if (result.missing > 0) notes.push(`${result.missing.toLocaleString()} missing values`);
  if (card.statsMs > 0) notes.push(`${Math.round(card.statsMs)} ms`);
  card.noteEl.textContent = notes.join(" · ");
}

/**
 * Working a chart with the pointer: hover and tooltips, clicks, the wheel, brushing and zooming, slices, selection and leaving shapes out.
 *
 * Moved out of chart-card.ts: each function takes the card it works on, and the card keeps a
 * one-line method of the same name that calls it.
 */
import { cssVar } from "./chart-card-parts.js";
import { type HitAction, type HitRegion, actionsOverlap, hitTest, tableFiltersForHitActions } from "./chart-hit-regions.js";
import type { SliceRegion } from "../worker/protocol.js";
import { addExclusion, describeRange, exclusionChips, removeChip, type ChartExclusion } from "../data/chart-exclusions.js";
import { barKindFor, COMMON_KINDS, fitChartKind, kindIcon, MORE_GROUPS } from "./chart-gallery.js";
import { CHART_KIND_LABELS, describeStep, zoomPlotBounds } from "./chart-utils.js";
import { clear, el } from "./dom.js";
import { openMenu, type MenuItem } from "./menu.js";
import type { ChartCard } from "./chart-card.js";
import type { ValueScale, BrushRange, BrushSpace, Frame } from "./chart-card-types.js";
import { addMarkerPath, POINT_LIMIT } from "./chart-card-types.js";

/** Every chart type as a picture, grouped by the question it answers; ones the data cannot draw say why. */
export function openKindPicker(card: ChartCard): void {
  const anchor = card.kindButton;
  if (anchor === null) return;
  // Bar is one choice: the chart keeps the bar kind it has, or takes the one these columns can make.
  const current = card.config.kind;
  const barKind = current === "bar" || current === "barplot" ? current : barKindFor(card.columns, card.rowCount);
  const common = { question: "Most used", kinds: COMMON_KINDS.map((kind) => (kind === "barplot" ? barKind : kind)) };
  const groups = [common, ...MORE_GROUPS].map((group) =>
    el("div", { class: "chart-kind-group" }, [
      el("div", { class: "chart-kind-question" }, [group.question]),
      el("div", { class: "chart-kind-options" }, group.kinds.map((kind) => {
        const fit = fitChartKind(kind, card.columns, card.rowCount);
        const option = el(
          "button",
          {
            class: `chart-kind-option${kind === card.config.kind ? " active" : ""}`,
            type: "button",
            title: fit.ok ? `${CHART_KIND_LABELS[kind]}: ${group.question.replace(/\?$/, "").toLowerCase()}` : `${CHART_KIND_LABELS[kind]}: ${fit.reason}`,
            ...(fit.ok || kind === card.config.kind ? {} : { disabled: "disabled" }),
          },
          [kindIcon(kind), el("span", {}, [CHART_KIND_LABELS[kind]])],
        );
        option.addEventListener("click", () => {
          close();
          card.noteBeforeChange();
          card.setKind(kind);
          card.kindSelect.value = kind;
          card.noteAfterChange();
          anchor.focus();
        });
        return option;
      })),
    ]),
  );
  const pop = el("div", { class: "chart-kind-pop", role: "dialog", "aria-label": "Chart type" }, groups);
  const close = (): void => {
    pop.remove();
    document.removeEventListener("pointerdown", outside, true);
    document.removeEventListener("keydown", onKey, true);
  };
  const outside = (event: Event): void => {
    if (!pop.contains(event.target as Node)) close();
  };
  const onKey = (event: KeyboardEvent): void => {
    if (event.key !== "Escape") return;
    event.stopPropagation();
    close();
    anchor.focus();
  };
  document.addEventListener("pointerdown", outside, true);
  document.addEventListener("keydown", onKey, true);
  document.body.append(pop);
  const rect = anchor.getBoundingClientRect();
  pop.style.top = `${Math.max(8, Math.min(rect.top, window.innerHeight - pop.offsetHeight - 8))}px`;
  pop.style.right = `${Math.max(8, window.innerWidth - rect.right)}px`;
  pop.querySelector<HTMLElement>(".chart-kind-option.active, .chart-kind-option:not([disabled])")?.focus();
}

/** The bar, bin or cell the person clicked: marked on the plot, with what can be done with it. */
export function selectRegion(card: ChartCard, region: HitRegion): void {
  const same = card.selectedRegion?.lines[0] === region.lines[0];
  card.clearSelection();
  card.hideTooltip();
  if (same) {
    card.render();
    return;
  }
  card.selectedRegion = region;
  const bar = card.selectionBar;
  if (bar !== null) {
    const name = region.lines[0] ?? "Selection";
    const filter = el("button", { class: "primary small", type: "button", title: `Filter every page to ${name}` }, ["Filter to this"]);
    filter.addEventListener("click", () => {
      const actions = region.actions;
      card.clearSelection();
      for (const action of actions) card.applyHitAction(action);
    });
    const rows = tableFiltersForHitActions(region.actions);
    const show = el("button", { class: "ghost small", type: "button", title: `Open the Table on the rows behind ${name}` }, ["Show rows"]);
    show.addEventListener("click", () => {
      card.clearSelection();
      card.render();
      card.options.onShowRows?.(rows, name);
    });
    const dismiss = el("button", { class: "icon-btn", type: "button", title: "Clear the selection", "aria-label": "Clear the selection" }, ["×"]);
    dismiss.addEventListener("click", () => {
      card.clearSelection();
      card.render();
    });
    bar.replaceChildren(el("span", { class: "chart-selection-name", title: name }, [name]), filter, ...(card.options.onShowRows === undefined || rows.length === 0 ? [] : [show]), dismiss);
    bar.classList.remove("hidden");
  }
  card.render();
}

/** Marks the selected region; if the chart no longer has it (the data changed), the selection ends. */
export function drawSelection(card: ChartCard, ctx: CanvasRenderingContext2D): void {
  const selected = card.selectedRegion;
  if (selected === null) return;
  const region = card.hitRegions.find((candidate) => candidate.lines[0] === selected.lines[0]);
  if (region === undefined) {
    card.clearSelection();
    return;
  }
  ctx.save();
  ctx.fillStyle = card.primaryColor();
  ctx.globalAlpha = 0.14;
  ctx.fillRect(region.x, region.y, region.w, region.h);
  ctx.globalAlpha = 1;
  ctx.strokeStyle = cssVar("--accent", "#2563eb");
  ctx.lineWidth = 2;
  ctx.strokeRect(region.x + 1, region.y + 1, Math.max(0, region.w - 2), Math.max(0, region.h - 2));
  ctx.restore();
}

/** Coalesces pointer moves into one tooltip update per animation frame. */
export function queuePointer(card: ChartCard, event: PointerEvent): void {
  const rect = card.canvas.getBoundingClientRect();
  if (card.brushDrag !== null) {
    card.dragMoved = true;
    card.brushDrag = {
      ...card.brushDrag,
      x1: event.clientX - rect.left,
      y1: event.clientY - rect.top,
    };
    card.hideTooltip();
    card.render();
    return;
  }
  if (card.config.kind === "map" && card.mapDrag !== null && card.lastFrame !== null) {
    const frame = card.lastFrame;
    const dx = (event.clientX - rect.left - card.mapDrag.x) / frame.plotW;
    const dy = (event.clientY - rect.top - card.mapDrag.y) / frame.plotH;
    card.dragMoved = true;
    card.mapDrag = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    const view = card.mapViewShown();
    const lonSpan = view.lonMax - view.lonMin;
    const latSpan = view.latMax - view.latMin;
    const lonMin = Math.min(
      180 - lonSpan,
      Math.max(-180, view.lonMin - dx * lonSpan),
    );
    const latMin = Math.min(
      90 - latSpan,
      Math.max(-90, view.latMin + dy * latSpan),
    );
    card.mapView = { lonMin, lonMax: lonMin + lonSpan, latMin, latMax: latMin + latSpan };
    card.render();
    return;
  }
  if (card.config.kind === "map" && card.mapBrushStart !== null) {
    card.dragMoved = true;
    card.mapBrush = {
      x0: card.mapBrushStart.x,
      y0: card.mapBrushStart.y,
      x1: event.clientX - rect.left,
      y1: event.clientY - rect.top,
    };
    card.render();
    return;
  }
  const dragResult =
    card.config.kind === "bubble" ? card.bubbleResult : card.seriesResult;
  if (
    (card.config.kind === "scatter" ||
      card.config.kind === "density" ||
      card.config.kind === "bubble") &&
    card.plotDrag !== null &&
    dragResult !== null &&
    card.lastFrame !== null
  ) {
    const frame = card.lastFrame;
    const result = dragResult;
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const dx = (x - card.plotDrag.x) / frame.plotW;
    const dy = (y - card.plotDrag.y) / frame.plotH;
    card.dragMoved = true;
    card.plotDrag = { x, y };
    const view =
      card.plotView ?? {
        xMin: result.xMin,
        xMax: result.xMax,
        yMin: result.yMin,
        yMax: result.yMax,
      };
    const spanX = view.xMax - view.xMin;
    const spanY = view.yMax - view.yMin;
    card.plotView = {
      xMin: view.xMin - dx * spanX,
      xMax: view.xMax - dx * spanX,
      yMin: view.yMin + dy * spanY,
      yMax: view.yMax + dy * spanY,
    };
    card.render();
    return;
  }
  if (
    (card.config.kind === "line" || card.config.kind === "histogram") &&
    card.plotDrag !== null &&
    card.lastFrame !== null
  ) {
    const frame = card.lastFrame;
    const base = card.xZoomBase();
    const current = card.chartXZoom;
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    if (base === null || current === null) {
      card.plotDrag = { x, y };
      return;
    }
    const dx = (x - card.plotDrag.x) / frame.plotW;
    card.dragMoved = true;
    card.plotDrag = { x, y };
    const span = current.max - current.min;
    const min = Math.min(
      base.max - span,
      Math.max(base.min, current.min - dx * span),
    );
    card.chartXZoom = { min, max: min + span };
    card.refreshBins();
    card.render();
    return;
  }
  if (card.config.kind === "bar" && card.plotDrag !== null) {
    const frame = card.lastFrame;
    if (frame === null) return;
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const total = card.allCategoryBars().length;
    const state = card.barWindow ?? {
      start: 0,
      count: Math.max(1, card.config.topN),
    };
    const slot = frame.plotW / Math.max(1, state.count);
    const steps = Math.round((x - card.plotDrag.x) / Math.max(1, slot));
    if (steps !== 0 && total > 0) {
      card.dragMoved = true;
      card.plotDrag = { x, y };
      const start = Math.min(
        Math.max(0, total - state.count),
        Math.max(0, state.start - steps),
      );
      card.barWindow = { start, count: state.count };
      card.render();
    }
    return;
  }
  if (
    (card.config.kind === "treemap" || card.config.kind === "terms") &&
    card.plotDrag !== null
  ) {
    const frame = card.lastFrame;
    if (frame === null) return;
    const total =
      card.config.kind === "treemap"
        ? (card.treemapResult?.labels.length ??
          card.meta(card.config.column)?.categories?.labels.length ??
          0)
        : (card.textResult?.profile.topTerms.length ?? 0);
    if (total === 0) return;
    const base =
      card.config.kind === "treemap"
        ? Math.max(6, card.config.topN)
        : Math.max(8, card.config.topN);
    const state = card.itemWindow ?? { start: 0, count: Math.min(total, base) };
    const slot = frame.plotW / Math.max(1, state.count - 1);
    const steps = Math.round((event.clientX - rect.left - card.plotDrag.x) / Math.max(1, slot));
    if (steps !== 0) {
      card.dragMoved = true;
      card.plotDrag = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      };
      card.itemWindow =
        state.count >= total
          ? null
          : {
              count: state.count,
              start: Math.min(
                Math.max(0, total - state.count),
                Math.max(0, state.start - steps),
              ),
            };
      card.render();
    }
    return;
  }
  if (card.config.kind === "correlation" && card.plotDrag !== null) {
    const result = card.correlationResult;
    const frame = card.lastFrame;
    if (result === null || frame === null) return;
    const total = result.labels.length;
    const state = card.corrWindow ?? { start: 0, count: total };
    const slot = frame.plotW / Math.max(1, state.count);
    const steps = Math.round((event.clientX - rect.left - card.plotDrag.x) / Math.max(1, slot));
    if (steps !== 0) {
      card.dragMoved = true;
      card.plotDrag = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      };
      card.corrWindow =
        state.count >= total
          ? null
          : {
              count: state.count,
              start: Math.min(
                Math.max(0, total - state.count),
                Math.max(0, state.start - steps),
              ),
            };
      card.render();
    }
    return;
  }
  if (card.config.kind === "box" && card.plotDrag !== null) {
    const result = card.boxResult;
    const frame = card.lastFrame;
    if (result === null || frame === null || result.groups.length === 0) return;
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const total = result.groups.length;
    const state = card.boxWindow ?? { start: 0, count: total };
    const slot = frame.plotW / Math.max(1, state.count);
    const steps = Math.round((x - card.plotDrag.x) / Math.max(1, slot));
    let yMin = Infinity;
    let yMax = -Infinity;
    for (const group of result.groups) {
      if (group.min < yMin) yMin = group.min;
      if (group.max > yMax) yMax = group.max;
    }
    const spanY = yMax - yMin;
    const dy = spanY > 0 ? ((y - card.plotDrag.y) / frame.plotH) * spanY : 0;
    const base = card.boxY ?? { min: yMin, max: yMax };
    const nextY = {
      min: Math.max(yMin, base.min + dy),
      max: Math.min(yMax, base.max + dy),
    };
    if (steps !== 0 || dy !== 0) {
      card.dragMoved = true;
      card.plotDrag = { x, y };
      card.boxWindow =
        state.count >= total
          ? null
          : {
              count: state.count,
              start: Math.min(
                Math.max(0, total - state.count),
                Math.max(0, state.start - steps),
              ),
            };
      card.boxY =
        nextY.max - nextY.min > 0 && (nextY.min > yMin || nextY.max < yMax)
          ? nextY
          : null;
      card.render();
    }
    return;
  }
  if (card.config.kind === "heatmap" && card.plotDrag !== null) {
    const result = card.crossResult;
    const frame = card.lastFrame;
    if (result === null || frame === null) return;
    const totalX = result.xLabels.length;
    const totalY = result.yLabels.length;
    const state = card.heatWindow ?? {
      xStart: 0,
      xCount: totalX,
      yStart: 0,
      yCount: totalY,
    };
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const cellW = frame.plotW / Math.max(1, state.xCount);
    const cellH = frame.plotH / Math.max(1, state.yCount);
    const stepsX = Math.round((x - card.plotDrag.x) / Math.max(1, cellW));
    const stepsY = Math.round((y - card.plotDrag.y) / Math.max(1, cellH));
    if ((stepsX !== 0 || stepsY !== 0) && totalX > 0 && totalY > 0) {
      card.dragMoved = true;
      card.plotDrag = { x, y };
      card.heatWindow = {
        xStart: Math.min(
          Math.max(0, totalX - state.xCount),
          Math.max(0, state.xStart - stepsX),
        ),
        xCount: state.xCount,
        yStart: Math.min(
          Math.max(0, totalY - state.yCount),
          Math.max(0, state.yStart - stepsY),
        ),
        yCount: state.yCount,
      };
      card.render();
    }
    return;
  }
  card.pointerAt = {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
    clientX: event.clientX,
    clientY: event.clientY,
  };
  if (card.pointerFrame !== null) return;
  const run = (): void => {
    card.pointerFrame = null;
    if (!card.disposed) card.showTooltipAtPointer();
  };
  if (typeof window.requestAnimationFrame === "function") {
    card.pointerFrame = window.requestAnimationFrame(run);
  } else {
    card.pointerFrame = window.setTimeout(run, 16);
  }
}

export function showTooltipAtPointer(card: ChartCard): void {
  const at = card.pointerAt;
  if (at === null) return;
  const region = hitTest(card.hitRegions, at.x, at.y);
  if (region === null) {
    card.hideTooltip();
    return;
  }
  card.lastActionRegion = region;
  card.emitHighlight(region.actions, region.lines[0] ?? "");
  clear(card.tooltipEl);
  const title = el("div", { class: "chart-tooltip-title" }, [region.lines[0] ?? "Value"]);
  card.tooltipEl.append(title);
  for (const line of region.lines.slice(1)) {
    card.tooltipEl.append(el("div", { class: "chart-tooltip-row" }, [line]));
  }
  const details: string[] = [];
  const valueMeta = card.meta(card.config.valueColumn ?? -1);
  if (valueMeta !== undefined) {
    details.push(
      `${card.aggPhrase()} of ${valueMeta.name}`,
    );
  }
  if (card.config.valueGrain !== undefined && card.config.valueGrain !== "auto") {
    details.push(`Bucket: ${describeStep(card.config.valueGrain, card.everyFor(card.config.valueGrain))}`);
  }
  if (card.config.binOptions !== null && card.config.kind === "histogram") {
    details.push(`Bins: ${card.config.binOptions.binCount}`);
  }
  if (card.config.groupColumn >= 0) {
    details.push(`Grouped by ${card.meta(card.config.groupColumn)?.name ?? "group"}`);
  }
  details.push(card.scopeEl.textContent ?? "");
  if (card.canExclude() && (region.actions.length > 0 || (region.contextActions?.length ?? 0) > 0)) {
    details.push("Right-click to leave this out of this chart");
  }
  card.tooltipEl.append(
    el(
      "div",
      { class: "chart-tooltip-detail" },
      details.filter((line) => line.trim() !== "").map((line) => el("div", {}, [line])),
    ),
  );
  card.tooltipEl.classList.remove("hidden");
  const cardRect = card.root.getBoundingClientRect();
  const left = Math.max(
    4,
    Math.min(at.clientX - cardRect.left + 14, Math.max(4, cardRect.width - 160)),
  );
  const top = Math.max(4, at.clientY - cardRect.top + 16);
  card.tooltipEl.style.left = `${left}px`;
  card.tooltipEl.style.top = `${top}px`;
  card.canvas.classList.toggle("chart-clickable", region.actions.length > 0);
}

/** Tells the panel which slice the pointer is over (null when it leaves a mark). */
export function emitHighlight(card: ChartCard, actions: readonly HitAction[] | null, label = ""): void {
  const usable = actions !== null && actions.length > 0 ? actions : null;
  const key = usable === null ? "" : JSON.stringify(usable);
  if (key === card.emittedKey) return;
  card.emittedKey = key;
  card.options.onHighlight?.(card, usable, label);
}

/**
 * Another card's hovered slice. Marks here over the same column are outlined; marks
 * over a different column are redrawn with the slice's share of each (a hovered
 * region in a bar chart shows its share of every week, bin and category here).
 */
export function setLinkedHighlight(card: ChartCard, actions: readonly HitAction[] | null, label = ""): void {
  if (JSON.stringify(actions) === JSON.stringify(card.linked)) return;
  card.linked = actions;
  card.linkedLabel = label;
  card.cancelSliceFetch();
  if (actions !== null) card.scheduleSliceFetch(actions);
  const matches =
    actions !== null && card.hitRegions.some((region) => actionsOverlap(actions, region.actions));
  if (actions === null) {
    card.sliceValues = null;
    card.slicePoints = null;
  }
  // Nothing to draw before or after: skip the repaint entirely.
  if (!matches && !card.linkedShown) return;
  card.scheduleRender(true);
}

export function cancelSliceFetch(card: ChartCard): void {
  card.sliceGeneration++;
  if (card.sliceTimer !== null) {
    window.clearTimeout(card.sliceTimer);
    card.sliceTimer = null;
  }
}

/** The marks as slices of their column, or null when they are not (all-or-nothing per chart). */
export function sliceRegions(card: ChartCard): SliceRegion[] | null {
  const scale = card.valueScale;
  if (scale === null || card.hitRegions.length === 0) return null;
  const regions: SliceRegion[] = card.hitRegions.map((region) => {
    const only = region.actions.length === 1 ? region.actions[0]! : null;
    if (only === null || only.column !== scale.regionColumn) return null;
    if (only.kind === "values") return { kind: "values", code: only.code };
    if (only.kind === "range") return { kind: "range", min: only.min, max: only.max };
    return null;
  });
  return regions.some((region) => region !== null) ? regions : null;
}

/** The hovered slice as "keep only these rows" entries, or null when a value cannot be named. */
export function sliceEntries(card: ChartCard, actions: readonly HitAction[]): ChartExclusion[] | null {
  const entries: ChartExclusion[] = [];
  for (const action of actions) {
    if (action.kind === "values") {
      const label = card.meta(action.column)?.categories?.labels[action.code];
      if (label === undefined) return null;
      entries.push({ kind: "values", column: action.column, labels: [label] });
    } else if (action.kind === "range") {
      entries.push({ kind: "range", column: action.column, min: action.min, max: action.max });
    } else {
      entries.push({ kind: "text", column: action.column, query: action.query });
    }
  }
  return entries;
}

/** After a short pause on a mark, asks the worker for the slice's share of each mark here. */
export function scheduleSliceFetch(card: ChartCard, actions: readonly HitAction[]): void {
  if (card.config.kind === "scatter") {
    card.scheduleSlicePoints(actions);
    return;
  }
  const request = card.options.requestSliceBreakdown;
  const scale = card.valueScale;
  if (request === undefined || scale === null) return;
  // Same column: the outline already says it.
  if (actions.some((action) => action.column === scale.regionColumn)) return;
  const regions = card.sliceRegions();
  const slice = card.sliceEntries(actions);
  if (regions === null || slice === null) return;
  const generation = card.sliceGeneration;
  card.sliceTimer = window.setTimeout(() => {
    card.sliceTimer = null;
    request({
      slice,
      column: scale.regionColumn,
      regions,
      ...(scale.measure === null ? {} : { measure: scale.measure }),
      ...(scale.scoped ? card.chartScope() : {}),
    })
      .then((message) => {
        if (card.disposed || generation !== card.sliceGeneration || card.linked === null) return;
        card.sliceValues = message.values;
        card.scheduleRender(true);
      })
      .catch(() => {
        // A failed highlight is only a missing overlay.
      });
  }, 70);
}

/**
 * Scatter: asks for the points of the hovered slice. It is the card's own sample
 * request with the slice kept (an inverted exclusion), unclipped so the points
 * land on the axes the plot already has.
 */
export function scheduleSlicePoints(card: ChartCard, actions: readonly HitAction[]): void {
  const request = card.options.requestSeries;
  const slice = card.sliceEntries(actions);
  if (card.seriesResult?.mode !== "points" || slice === null) return;
  const scope = card.chartScope();
  const generation = card.sliceGeneration;
  card.sliceTimer = window.setTimeout(() => {
    card.sliceTimer = null;
    request({
      xColumn: card.config.x,
      yColumn: card.config.y,
      colorColumn: -1,
      sizeColumn: -1,
      mode: "points",
      limit: POINT_LIMIT,
      clip: false,
      ...scope,
      chartExclude: [...(scope.chartExclude ?? []), ...slice.map((entry) => ({ ...entry, invert: true }))],
    })
      .then((message) => {
        if (card.disposed || generation !== card.sliceGeneration || card.linked === null) return;
        if (message.result.mode !== "points") return;
        card.slicePoints = message.result;
        card.scheduleRender(true);
      })
      .catch(() => {
        // A failed highlight is only a missing overlay.
      });
  }, 70);
}

/** The slice's own points over the scatter, in the highlight colour; returns how many were drawn. */
export function drawSlicePoints(card: ChartCard, ctx: CanvasRenderingContext2D, space: BrushSpace): number {
  const points = card.slicePoints;
  const yMin = space.yMin ?? 0;
  const yMax = space.yMax ?? 0;
  if (points === null || space.xMax <= space.xMin || yMax <= yMin) return 0;
  const accent = "#e8590c";
  const xScale = space.plotW / (space.xMax - space.xMin);
  const yScale = space.plotH / (yMax - yMin);
  const radius = points.shown <= 5000 ? 2.8 : 2.2;
  let drawn = 0;
  ctx.save();
  ctx.beginPath();
  ctx.rect(space.left, space.top, space.plotW, space.plotH);
  ctx.clip();
  ctx.fillStyle = accent;
  ctx.globalAlpha = 0.9;
  ctx.beginPath();
  for (let i = 0; i < points.shown; i++) {
    const x = space.left + (points.x[i]! - space.xMin) * xScale;
    const y = space.top + space.plotH - (points.y[i]! - yMin) * yScale;
    if (x < space.left || x > space.left + space.plotW || y < space.top || y > space.top + space.plotH) continue;
    addMarkerPath(ctx, card.config.markerShape ?? "circle", x, y, radius);
    drawn++;
  }
  ctx.fill();
  ctx.restore();
  if (drawn > 0 && card.linkedLabel !== "") {
    ctx.save();
    ctx.fillStyle = accent;
    ctx.font = "600 11px system-ui, sans-serif";
    ctx.textAlign = "right";
    ctx.fillText(`Highlighted: ${card.linkedLabel}`, space.left + space.plotW, Math.max(10, space.top - 4));
    ctx.restore();
  }
  return drawn;
}

/** Draws the linked slice: outlines on the same column, the slice's share on others. */
export function drawLinkedOverlay(card: ChartCard, ctx: CanvasRenderingContext2D): void {
  const actions = card.linked;
  let shown = 0;
  if (actions !== null) {
    ctx.save();
    ctx.fillStyle = card.primaryColor();
    ctx.strokeStyle = card.primaryColor();
    ctx.lineWidth = 2;
    for (const region of card.hitRegions) {
      if (!actionsOverlap(actions, region.actions)) continue;
      const w = Math.max(3, region.w);
      ctx.globalAlpha = 0.16;
      ctx.fillRect(region.x, region.y, w, region.h);
      ctx.globalAlpha = 0.95;
      ctx.strokeRect(region.x + 1, region.y + 1, Math.max(1, w - 2), Math.max(1, region.h - 2));
      shown++;
    }
    ctx.restore();
  }
  const values = card.sliceValues;
  const scale = card.valueScale;
  let sliced = 0;
  if (actions !== null && values !== null && scale !== null && values.length === card.hitRegions.length) {
    sliced = card.drawSliceShare(ctx, scale, values);
  }
  if (actions !== null && card.slicePoints !== null && card.brushSpace !== null && card.config.kind === "scatter") {
    sliced = card.drawSlicePoints(ctx, card.brushSpace);
  }
  card.linkedShown = shown > 0 || sliced > 0;
  card.canvas.dataset.linked = String(shown);
  card.canvas.dataset.slice = String(sliced);
}

/** The hovered slice's value on every mark, in the highlight colour; returns how many marks have one. */
export function drawSliceShare(card: ChartCard, ctx: CanvasRenderingContext2D, scale: ValueScale, values: Float64Array): number {
  const accent = "#e8590c";
  const bottom = scale.top + scale.plotH;
  const heightOf = (value: number): number =>
    Math.max(0, Math.min(1, value / Math.max(1e-12, scale.yMax))) * scale.plotH;
  let drawn = 0;
  ctx.save();
  ctx.fillStyle = accent;
  ctx.strokeStyle = accent;
  if (scale.mode === "bars") {
    ctx.globalAlpha = 0.95;
    card.hitRegions.forEach((region, index) => {
      const value = values[index] as number;
      if (!Number.isFinite(value) || value <= 0) return;
      const h = Math.max(2, heightOf(value));
      ctx.fillRect(region.x + scale.inset, bottom - h, Math.max(1, scale.barW), h);
      drawn++;
    });
  } else {
    ctx.lineWidth = 2.5;
    ctx.globalAlpha = 0.95;
    let open = false;
    ctx.beginPath();
    card.hitRegions.forEach((region, index) => {
      const value = values[index] as number;
      if (!Number.isFinite(value)) {
        open = false;
        return;
      }
      const x = region.x + region.w / 2;
      const y = bottom - heightOf(value);
      if (open) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
      open = true;
      drawn++;
    });
    ctx.stroke();
    if (drawn > 0 && drawn <= 60) {
      card.hitRegions.forEach((region, index) => {
        const value = values[index] as number;
        if (!Number.isFinite(value)) return;
        ctx.beginPath();
        ctx.arc(region.x + region.w / 2, bottom - heightOf(value), 2.5, 0, Math.PI * 2);
        ctx.fill();
      });
    }
  }
  if (drawn > 0 && card.linkedLabel !== "") {
    ctx.globalAlpha = 1;
    ctx.font = "600 11px system-ui, sans-serif";
    // Right-aligned so it never sits on the chart's own axis label at the left.
    ctx.textAlign = "right";
    const last = card.hitRegions[card.hitRegions.length - 1];
    ctx.fillText(
      `Highlighted: ${card.linkedLabel}`,
      last === undefined ? 0 : last.x + last.w,
      Math.max(10, scale.top - 4),
    );
  }
  ctx.restore();
  return drawn;
}

export function handleCanvasClick(card: ChartCard, event: MouseEvent): void {
  if (card.dragMoved) {
    card.dragMoved = false;
    return;
  }
  const rect = card.canvas.getBoundingClientRect();
  if (card.config.kind === "map" && card.mapClusters.length > 0 && card.mapPicker === null) {
    const cx = event.clientX - rect.left, cy = event.clientY - rect.top;
    const hit = card.mapClusters.find((c) => (cx - c.x) ** 2 + (cy - c.y) ** 2 <= c.r * c.r);
    if (hit !== undefined) {
      // Zoom to the box of the markers it holds, with some air round it; markers at one spot zoom in a fixed step.
      const lonSpan = Math.max(hit.lonMax - hit.lonMin, 0.02), latSpan = Math.max(hit.latMax - hit.latMin, 0.02);
      const lonMid = (hit.lonMin + hit.lonMax) / 2, latMid = (hit.latMin + hit.latMax) / 2;
      const view = card.mapViewShown(), aspect = (view.lonMax - view.lonMin) / (view.latMax - view.latMin);
      let w = lonSpan * 1.6, h = latSpan * 1.6;
      if (w / h < aspect) w = h * aspect; else h = w / aspect;
      card.mapView = { lonMin: lonMid - w / 2, lonMax: lonMid + w / 2, latMin: latMid - h / 2, latMax: latMid + h / 2 };
      card.render();
      return;
    }
  }
  if (card.config.kind === "map" && card.mapPicker !== null && card.lastFrame !== null) {
    const frame = card.lastFrame;
    const view = card.mapViewShown();
    const fx = (event.clientX - rect.left - frame.left) / frame.plotW;
    const fy = (event.clientY - rect.top - frame.top) / frame.plotH;
    if (fx >= 0 && fx <= 1 && fy >= 0 && fy <= 1) {
      card.mapPicker(view.lonMin + fx * (view.lonMax - view.lonMin), view.latMax - fy * (view.latMax - view.latMin));
    }
    return;
  }
  const region = hitTest(
    card.hitRegions,
    event.clientX - rect.left,
    event.clientY - rect.top,
  );
  if (card.options.docked === true) {
    // A click marks; filtering every page is a second, named step.
    if (region === null || region.actions.length === 0) {
      if (card.selectedRegion !== null) {
        card.clearSelection();
        card.render();
      }
      return;
    }
    card.lastActionRegion = region;
    card.selectRegion(region);
    return;
  }
  if (region === null) return;
  card.lastActionRegion = region;
  for (const action of region.actions) card.applyHitAction(action);
}

/**
 * Shift+drag release: converts the pixel rectangle into data ranges on the
 * plotted columns and hands them to the table filters. Drags under 6 px are
 * ignored; one-axis charts (line, histogram) use the horizontal extent only.
 */
export function finishBrush(card: ChartCard, drag: { x0: number; y0: number; x1: number; y1: number }): void {
  const space = card.brushSpace;
  card.render();
  if (space === null || card.options.onBrush === undefined) return;
  const clamp = (value: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, value));
  const left = space.left;
  const right = space.left + space.plotW;
  const top = space.top;
  const bottom = space.top + space.plotH;
  const px0 = clamp(Math.min(drag.x0, drag.x1), left, right);
  const px1 = clamp(Math.max(drag.x0, drag.x1), left, right);
  const py0 = clamp(Math.min(drag.y0, drag.y1), top, bottom);
  const py1 = clamp(Math.max(drag.y0, drag.y1), top, bottom);
  const twoAxes = space.yColumn !== undefined && space.yMin !== undefined && space.yMax !== undefined;
  if (px1 - px0 < 6 || (twoAxes && py1 - py0 < 6)) return;
  if (space.slots !== undefined) {
    const slotW = space.plotW / Math.max(1, space.slots.count);
    const last = space.slots.count - 1;
    const first = clamp(Math.floor((px0 - left) / slotW), 0, last);
    const end = clamp(Math.floor((px1 - left) / slotW), first, last);
    const range = space.slots.range(first, end);
    if (range !== null) card.options.onBrush([{ column: space.xColumn, ...range }]);
    return;
  }
  const xSpan = space.xMax - space.xMin;
  const xWidth = Math.max(1e-9, space.plotW * space.xFraction);
  const toX = (x: number): number => space.xMin + clamp((x - left) / xWidth, 0, 1) * xSpan;
  const ranges: BrushRange[] = [card.roundedRange(space.xColumn, toX(px0), toX(px1))];
  if (twoAxes) {
    const yMin = space.yMin as number;
    const yMax = space.yMax as number;
    const toY = (y: number): number => yMax - ((y - top) / space.plotH) * (yMax - yMin);
    ranges.push(card.roundedRange(space.yColumn as number, toY(py1), toY(py0)));
  }
  card.options.onBrush(ranges);
}

/**
 * Brush geometry for an aggregated time axis: slot i covers [times[i], the next
 * period) so a selection of slots a..b is the dates from the start of a to the
 * end of b. The last period is as long as the one before it.
 */
export function timeSlotBrush(card: ChartCard, times: readonly number[], column: number, frame: Frame): BrushSpace | null {
  if (times.length === 0 || column < 0) return null;
  const end = (i: number): number => {
    const next = times[i + 1];
    if (next !== undefined && Number.isFinite(next)) return next - 1;
    const here = times[i] as number;
    const previous = times[i - 1];
    return previous !== undefined && Number.isFinite(previous) ? here + (here - previous) - 1 : here;
  };
  return {
    left: frame.left,
    top: frame.top,
    plotW: frame.plotW,
    plotH: frame.plotH,
    xColumn: column,
    xMin: 0,
    xMax: 1,
    xFraction: 1,
    slots: {
      count: times.length,
      range: (first, last) => {
        const min = times[first];
        if (min === undefined || !Number.isFinite(min) || !Number.isFinite(times[last])) return null;
        return { min, max: end(last) };
      },
    },
  };
}

/** The live Shift+drag selection: a rectangle, or a full-height band on one-axis charts. */
export function drawBrushOverlay(card: ChartCard, ctx: CanvasRenderingContext2D): void {
  const space = card.brushSpace;
  if (card.brushDrag === null || space === null) return;
  const clampX = (x: number): number => Math.max(space.left, Math.min(space.left + space.plotW, x));
  const clampY = (y: number): number => Math.max(space.top, Math.min(space.top + space.plotH, y));
  const x = Math.min(clampX(card.brushDrag.x0), clampX(card.brushDrag.x1));
  const w = Math.abs(clampX(card.brushDrag.x1) - clampX(card.brushDrag.x0));
  const oneAxis = space.yColumn === undefined;
  const y = oneAxis ? space.top : Math.min(clampY(card.brushDrag.y0), clampY(card.brushDrag.y1));
  const h = oneAxis ? space.plotH : Math.abs(clampY(card.brushDrag.y1) - clampY(card.brushDrag.y0));
  ctx.save();
  ctx.fillStyle = card.primaryColor();
  ctx.globalAlpha = 0.15;
  ctx.fillRect(x, y, w, h);
  ctx.globalAlpha = 0.9;
  ctx.strokeStyle = card.primaryColor();
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w, h);
  ctx.restore();
}

/** Wheel zoom on the map, anchored at the pointer; clamped to the world. */
export function onWheel(card: ChartCard, event: WheelEvent): void {
  const kind = card.config.kind;
  // The wheel scrolls the page unless the person asks to zoom: a chart fills the screen, and
  // trapping the wheel there hides whatever is below it. A map keeps plain wheel zoom, as maps do.
  if (kind !== "map" && !event.ctrlKey && !event.metaKey) return;
  if (
    (kind !== "map" &&
      kind !== "scatter" &&
      kind !== "density" &&
      kind !== "bubble" &&
      kind !== "line" &&
      kind !== "histogram" &&
      kind !== "bar" &&
      kind !== "heatmap" &&
      kind !== "box" &&
      kind !== "correlation" &&
      kind !== "treemap" &&
      kind !== "terms") ||
    card.lastFrame === null
  ) {
    return;
  }
  const frame = card.lastFrame;
  const rect = card.canvas.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  if (
    x < frame.left ||
    x > frame.left + frame.plotW ||
    y < frame.top ||
    y > frame.top + frame.plotH
  ) {
    return;
  }
  const tx = (x - frame.left) / frame.plotW;
  const ty = 1 - (y - frame.top) / frame.plotH;
  const factor = event.deltaY < 0 ? 0.8 : 1.25;
  if (kind === "line" || kind === "histogram") {
    const base = card.xZoomBase();
    if (base === null) return;
    const current = card.chartXZoom ?? base;
    const minSpan = Math.max(1e-9, (base.max - base.min) / 1000);
    const zoomed = zoomPlotBounds(
      { xMin: current.min, xMax: current.max, yMin: 0, yMax: 1 },
      { x: tx, y: 0.5 },
      factor,
      minSpan,
    );
    const min = Math.max(base.min, zoomed.xMin);
    const max = Math.min(base.max, zoomed.xMax);
    if (!(max > min)) return;
    event.preventDefault();
    card.chartXZoom = { min, max };
    card.refreshBins();
    card.render();
    return;
  }
  if (kind === "bar") {
    const total = card.allCategoryBars().length;
    if (total === 0) return;
    event.preventDefault();
    const current = card.barWindow ?? {
      start: 0,
      count: Math.max(1, card.config.topN),
    };
    const count = Math.min(total, Math.max(3, Math.round(current.count * factor)));
    const center = current.start + current.count / 2;
    const start = Math.min(
      Math.max(0, total - count),
      Math.max(0, Math.round(center - count / 2)),
    );
    card.barWindow = { start, count };
    card.render();
    return;
  }
  if (kind === "treemap" || kind === "terms") {
    const total =
      kind === "treemap"
        ? (card.treemapResult?.labels.length ??
          card.meta(card.config.column)?.categories?.labels.length ??
          0)
        : (card.textResult?.profile.topTerms.length ?? 0);
    if (total === 0) return;
    event.preventDefault();
    const base = kind === "treemap" ? Math.max(6, card.config.topN) : Math.max(8, card.config.topN);
    const current = card.itemWindow ?? { start: 0, count: Math.min(total, base) };
    const count = Math.min(total, Math.max(2, Math.round(current.count * factor)));
    const center = current.start + current.count / 2;
    const start = Math.min(
      Math.max(0, total - count),
      Math.max(0, Math.round(center - count / 2)),
    );
    card.itemWindow = count >= total ? null : { start, count };
    card.render();
    return;
  }
  if (kind === "correlation") {
    const result = card.correlationResult;
    if (result === null || result.labels.length < 2) return;
    event.preventDefault();
    const total = result.labels.length;
    const current = card.corrWindow ?? { start: 0, count: total };
    const count = Math.min(total, Math.max(2, Math.round(current.count * factor)));
    const center = current.start + current.count / 2;
    const start = Math.min(
      Math.max(0, total - count),
      Math.max(0, Math.round(center - count / 2)),
    );
    card.corrWindow = count >= total ? null : { start, count };
    card.render();
    return;
  }
  if (kind === "box") {
    const result = card.boxResult;
    if (result === null || result.groups.length === 0) return;
    event.preventDefault();
    const total = result.groups.length;
    const current = card.boxWindow ?? { start: 0, count: total };
    const count = Math.min(total, Math.max(1, Math.round(current.count * factor)));
    const center = current.start + current.count / 2;
    const start = Math.min(
      Math.max(0, total - count),
      Math.max(0, Math.round(center - count / 2)),
    );
    let yMin = Infinity;
    let yMax = -Infinity;
    for (const group of result.groups) {
      if (group.min < yMin) yMin = group.min;
      if (group.max > yMax) yMax = group.max;
    }
    if (!(yMax > yMin)) {
      yMin -= 1;
      yMax += 1;
    }
    const base = card.boxY ?? { min: yMin, max: yMax };
    const zoomed = zoomPlotBounds(
      { xMin: 0, xMax: 1, yMin: base.min, yMax: base.max },
      { x: 0.5, y: ty },
      factor,
      Math.max(1e-9, (yMax - yMin) / 1000),
    );
    card.boxWindow = count >= total ? null : { start, count };
    card.boxY = {
      min: Math.max(yMin, zoomed.yMin),
      max: Math.min(yMax, zoomed.yMax),
    };
    card.render();
    return;
  }
  if (kind === "heatmap") {
    const result = card.crossResult;
    if (result === null) return;
    const totalX = result.xLabels.length;
    const totalY = result.yLabels.length;
    if (totalX === 0 || totalY === 0) return;
    event.preventDefault();
    const current = card.heatWindow ?? {
      xStart: 0,
      xCount: totalX,
      yStart: 0,
      yCount: totalY,
    };
    const nextX = Math.max(1, Math.min(totalX, Math.round(current.xCount * factor)));
    const nextY = Math.max(1, Math.min(totalY, Math.round(current.yCount * factor)));
    const anchorX = current.xStart + tx * current.xCount;
    const anchorY = current.yStart + (1 - ty) * current.yCount;
    const xStart = Math.max(
      0,
      Math.min(totalX - nextX, Math.round(anchorX - tx * nextX)),
    );
    const yStart = Math.max(
      0,
      Math.min(totalY - nextY, Math.round(anchorY - (1 - ty) * nextY)),
    );
    card.heatWindow =
      nextX >= totalX && nextY >= totalY
        ? null
        : { xStart, xCount: nextX, yStart, yCount: nextY };
    card.render();
    return;
  }
  if (kind === "map") {
    event.preventDefault();
    card.zoomMap(factor, tx, ty);
    return;
  }
  const result = kind === "bubble" ? card.bubbleResult : card.seriesResult;
  if (result === null) return;
  event.preventDefault();
  const base =
    card.plotView ?? {
      xMin: result.xMin,
      xMax: result.xMax,
      yMin: result.yMin,
      yMax: result.yMax,
    };
  const minSpan = Math.max(
    1e-12,
    Math.min(base.xMax - base.xMin, base.yMax - base.yMin) / 2000,
  );
  const zoomed = zoomPlotBounds(base, { x: tx, y: ty }, factor, minSpan);
  const clamped = {
    xMin: Math.max(result.xMin, zoomed.xMin),
    xMax: Math.min(result.xMax, zoomed.xMax),
    yMin: Math.max(result.yMin, zoomed.yMin),
    yMax: Math.min(result.yMax, zoomed.yMax),
  };
  card.plotView =
    clamped.xMax - clamped.xMin > 0 && clamped.yMax - clamped.yMin > 0
      ? clamped
      : null;
  card.render();
}

/** Zeroes histogram bins whose centre lies inside a range excluded on this column. */
export function withoutExcludedBins(card: ChartCard, bins: number[], min: number, max: number): number[] {
  const ranges = card.excludes().filter(
    (entry): entry is Extract<ChartExclusion, { kind: "range" }> =>
      entry.kind === "range" && entry.column === card.config.column,
  );
  if (ranges.length === 0 || bins.length === 0 || !(max > min)) return bins;
  const width = (max - min) / bins.length;
  return bins.map((count, index) => {
    const centre = min + (index + 0.5) * width;
    const inside = ranges.some(
      (range) =>
        (range.min === null || centre >= range.min) && (range.max === null || centre <= range.max),
    );
    return inside ? 0 : count;
  });
}

/** The row of "Left out: Spain ×" chips above the chart. */
export function syncExclusions(card: ChartCard): void {
  const list = card.excludes();
  clear(card.exclusionBar);
  card.exclusionBar.classList.toggle("hidden", list.length === 0);
  if (list.length === 0) return;
  card.exclusionBar.append(el("span", { class: "chart-exclusions-label" }, ["Left out:"]));
  const chips = exclusionChips(
    list,
    (column) => card.meta(column)?.name ?? "column",
    (column) => card.boundFormatter(column),
  );
  for (const chip of chips) {
    const button = el(
      "button",
      {
        class: "chart-exclusion-chip",
        type: "button",
        title: `Put back: ${chip.text}`,
        "aria-label": `Put back ${chip.text}`,
      },
      [chip.text, el("span", { class: "chart-exclusion-x", "aria-hidden": "true" }, [" ×"])],
    ) as HTMLButtonElement;
    button.addEventListener("click", () => card.setExcludes(removeChip(card.excludes(), chip)));
    card.exclusionBar.append(button);
  }
  if (chips.length > 1) {
    const clearAll = el("button", { class: "ghost small", type: "button" }, ["Put all back"]);
    clearAll.addEventListener("click", () => card.setExcludes([]));
    card.exclusionBar.append(clearAll);
  }
}

export function handleCanvasContextMenu(card: ChartCard, event: MouseEvent): void {
  const rect = card.canvas.getBoundingClientRect();
  const region = hitTest(
    card.hitRegions,
    event.clientX - rect.left,
    event.clientY - rect.top,
  );
  const actions =
    region === null
      ? []
      : region.actions.length > 0
        ? region.actions
        : (region.contextActions ?? []);
  const point = actions.length === 0 ? card.dataPointAt(event.clientX, event.clientY) : null;
  const hasExclusions = card.excludes().length > 0;
  if (actions.length === 0 && point === null && !hasExclusions) return;
  event.preventDefault();
  card.openExclusionMenu(actions, { x: event.clientX, y: event.clientY }, point);
}

/**
 * Data coordinates under the pointer for the plots that draw raw points or
 * cells (scatter, density, bubble), so a right-click can trim everything
 * beyond that point on either axis.
 */
export function dataPointAt(card: ChartCard, clientX: number, clientY: number): { x: number; y: number } | null {
  const kind = card.config.kind;
  if (kind !== "scatter" && kind !== "density" && kind !== "bubble") return null;
  const result = kind === "bubble" ? card.bubbleResult : card.seriesResult;
  const frame = card.lastFrame;
  if (result === null || frame === null || !(frame.plotW > 0) || !(frame.plotH > 0)) return null;
  const rect = card.canvas.getBoundingClientRect();
  const px = clientX - rect.left;
  const py = clientY - rect.top;
  if (px < frame.left || px > frame.left + frame.plotW) return null;
  if (py < frame.top || py > frame.top + frame.plotH) return null;
  const view = card.plotView ?? {
    xMin: result.xMin,
    xMax: result.xMax,
    yMin: result.yMin,
    yMax: result.yMax,
  };
  if (![view.xMin, view.xMax, view.yMin, view.yMax].every(Number.isFinite)) return null;
  return {
    x: view.xMin + ((px - frame.left) / frame.plotW) * (view.xMax - view.xMin),
    y: view.yMax - ((py - frame.top) / frame.plotH) * (view.yMax - view.yMin),
  };
}

/**
 * Right-click menu built from what the clicked shape stands for: a category
 * value, a numeric range or a text term. Every entry is chart-local unless
 * it says "table"; exclusions never touch the table or other cards.
 */
export function openExclusionMenu(card: ChartCard, actions: readonly HitAction[], at: { x: number; y: number }, point: { x: number; y: number } | null = null): void {
  const items: MenuItem[] = [];
  if (point !== null && card.canExclude()) {
    const axes: { column: number; value: number; name: string }[] = [
      { column: card.config.x, value: point.x, name: card.meta(card.config.x)?.name ?? "X" },
      { column: card.config.y, value: point.y, name: card.meta(card.config.y)?.name ?? "Y" },
    ];
    for (const axis of axes) {
      if (axis.column < 0 || !Number.isFinite(axis.value)) continue;
      const rounded = Number(axis.value.toPrecision(4));
      const text = rounded.toLocaleString("en-US", { maximumFractionDigits: 6 });
      items.push(
        {
          label: `Leave out rows where ${axis.name} is above ${text}`,
          title: "Trim everything beyond this point on this axis, in this chart only",
          action: () =>
            card.setExcludes(
              addExclusion(card.excludes(), {
                kind: "range",
                column: axis.column,
                min: rounded,
                max: null,
              }),
            ),
        },
        {
          label: `Leave out rows where ${axis.name} is below ${text}`,
          title: "Trim everything beyond this point on this axis, in this chart only",
          action: () =>
            card.setExcludes(
              addExclusion(card.excludes(), {
                kind: "range",
                column: axis.column,
                min: null,
                max: rounded,
              }),
            ),
        },
      );
    }
  }
  const multiple = actions.length > 1;
  if (card.canExclude()) {
    for (const action of actions) {
      const column = card.meta(action.column);
      const where = multiple && column !== undefined ? ` (${column.name})` : "";
      if (action.kind === "values") {
        const label = column?.categories?.labels[action.code];
        if (label === undefined) continue;
        const shown = label === "" ? "(empty)" : label;
        items.push({
          label: `Leave out “${shown}”${where}`,
          title: "Remove these rows from this chart only; click the chip to put them back",
          action: () =>
            card.setExcludes(
              addExclusion(card.excludes(), { kind: "values", column: action.column, labels: [label] }),
            ),
        });
        items.push({
          label: `Show only “${shown}”${where}`,
          title: "Keep just these rows in this chart",
          action: () => {
            card.config.filterColumn = action.column;
            card.config.filterCode = action.code;
            card.setFiltered(card.facets, card.histograms);
            card.syncChartFilterControls();
          },
        });
      } else if (action.kind === "range") {
        const text = describeRange(action.min, action.max, card.boundFormatter(action.column));
        const name = column?.name ?? "values";
        items.push({
          label: `Leave out ${name} ${text}`,
          title: "Remove values in this range from this chart only",
          action: () =>
            card.setExcludes(
              addExclusion(card.excludes(), {
                kind: "range",
                column: action.column,
                min: action.min,
                max: action.max,
              }),
            ),
        });
      } else {
        items.push({
          label: `Leave out rows containing “${action.query}”${where}`,
          title: "Remove matching rows from this chart only",
          action: () =>
            card.setExcludes(
              addExclusion(card.excludes(), {
                kind: "text",
                column: action.column,
                query: action.query,
              }),
            ),
        });
      }
    }
  }
  // The click behaviour, spelled out, for anyone who wanted the table instead.
  if (actions.length > 0 && card.options.onFilter !== undefined) {
    const first = actions[0]!;
    const described =
      first.kind === "values"
        ? `“${card.meta(first.column)?.categories?.labels[first.code] ?? "value"}”`
        : first.kind === "range"
          ? describeRange(first.min, first.max, card.boundFormatter(first.column))
          : `“${first.query}”`;
    items.push({
      label: `Filter the table to ${described}`,
      title: "Same as clicking it: an ordinary table filter you can clear in the filter list",
      action: () => {
        for (const action of actions) card.applyHitAction(action);
      },
    });
    if (first.kind === "values") {
      items.push({
        label: `Leave ${described} out of the table too`,
        title: "A table filter that keeps every other value",
        action: () => card.excludeFromTable(first.column, first.code),
      });
    }
  }
  if (card.excludes().length > 0) {
    items.push({
      label: `Put back everything left out (${exclusionChips(card.excludes(), () => "").length})`,
      action: () => card.setExcludes([]),
    });
  }
  if (items.length === 0) return;
  openMenu(card.canvas, items, "context-menu", at);
}

/** Table filter keeping every value of a column except one. */
export function excludeFromTable(card: ChartCard, column: number, code: number): void {
  const onFilter = card.options.onFilter;
  const total = card.meta(column)?.categories?.labels.length ?? 0;
  if (onFilter === undefined || total === 0) return;
  const current = card.options.currentFilter?.(column) ?? null;
  const base =
    current?.kind === "values" ? current.selected : Array.from({ length: total }, (_, i) => i);
  const selected = base.filter((value) => value !== code);
  if (selected.length === 0) return;
  onFilter(column, { kind: "values", selected });
}

export function applyHitAction(card: ChartCard, action: HitAction): void {
  const onFilter = card.options.onFilter;
  if (onFilter === undefined) return;
  const current = card.options.currentFilter?.(action.column) ?? null;
  if (action.kind === "text") {
    const same =
      current?.kind === "text" &&
      current.mode === "contains" &&
      current.query === action.query;
    onFilter(
      action.column,
      same ? null : { kind: "text", mode: "contains", query: action.query },
    );
    return;
  }
  if (action.kind === "range") {
    const same =
      current?.kind === "range" &&
      current.min === action.min &&
      current.max === action.max;
    if (same) onFilter(action.column, null);
    else onFilter(action.column, { kind: "range", min: action.min, max: action.max });
    return;
  }
  const total = card.meta(action.column)?.categories?.labels.length ?? 0;
  let selected: number[];
  if (current?.kind === "values") {
    selected = current.selected.filter((code) => code !== action.code);
    if (selected.length === current.selected.length) selected.push(action.code);
  } else {
    selected = [action.code];
  }
  if (selected.length === 0 || (total > 0 && selected.length === total)) {
    onFilter(action.column, null);
  } else {
    onFilter(action.column, { kind: "values", selected });
  }
}

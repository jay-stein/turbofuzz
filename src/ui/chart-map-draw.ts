/**
 * The map chart: drawing the basemap, dots, clusters and legend, brushing and zooming, and the web page export.
 *
 * Moved out of chart-card.ts: each function takes the card it works on, and the card keeps a
 * one-line method of the same name that calls it.
 */
import { cssVar } from "./chart-card-parts.js";
import { basemapCaches, DETAIL_LON_SPAN, loadBasemap } from "./chart-basemap.js";
import type { SeriesPoints } from "../data/chart-series.js";
import { num, summarise } from "../data/chart-extract.js";
import { dataRange, robustRange, dotRadii } from "../data/dot-size.js";
import { DEFAULT_PALETTE, isRampPalette } from "../data/palettes.js";
import { colorFraction, colorRamp, resolveColorDomain } from "./color-scale.js";
import { DEFAULT_MAP_MODE, formatChartNumber, formatCompact, darkerColor, hexToRgb, isNumericType, mapBrushBounds, rampColor, safeFileName } from "./chart-utils.js";
import { el } from "./dom.js";
import { type MapRegionsOptions } from "./map-regions.js";
import { fitViewToPlot } from "../data/regions.js";
import { buildMapHtml, downloadHtml, roundRing, type MapHtmlLegend, type MapHtmlPayload } from "./map-html-export.js";
import type { ChartCard } from "./chart-card.js";
import type { MapViewport, MapBrushSelection, Frame, RegionRequests } from "./chart-card.js";
import { fitMapView, BORDER_DARKER, BORDER_ALPHA, addMarkerPath, MAP_COLOR_AGG_NAMES } from "./chart-card.js";

export function mapExtract(card: ChartCard, facts: [string, string][], table: (name: string, rows: string[][]) => void): void {
  const colorMeta = card.meta(card.config.colorColumn);
  const agg = card.config.mapColorAgg ?? "mean";
  const places = (card.config.mapMode ?? DEFAULT_MAP_MODE) === "places";
  const colorName = colorMeta === undefined ? "colour" : places ? `${MAP_COLOR_AGG_NAMES[agg]}_${colorMeta.name}` : colorMeta.name;
  const sizeName = card.config.sizeColumn >= 0 ? `${card.config.bubbleAgg ?? "count"}_${card.meta(card.config.sizeColumn)?.name ?? "size"}` : "";
  const anim = card.animationResult?.places;
  const frames = card.animationResult?.frames ?? [];
  const lonName = card.meta(card.config.x)?.name ?? "longitude";
  const latName = card.meta(card.config.y)?.name ?? "latitude";
  if (anim !== undefined && card.placeFrame() !== null) {
    facts.push(["Places", `${anim.shown.toLocaleString()} of ${anim.totalPlaces.toLocaleString()}${anim.shown < anim.totalPlaces ? " (the busiest)" : ""}, over ${frames.length.toLocaleString()} periods`]);
    if (anim.colorRange !== null) facts.push(["Colour scale", `${formatChartNumber(card.config.colorMin ?? anim.colorRange.min)} to ${formatChartNumber(card.config.colorMax ?? anim.colorRange.max)}, the same in every period; the automatic range is the middle 90% of place values`]);
    if (anim.sizeRange !== null) facts.push(["Size scale", `${num(card.config.dotValueMin ?? anim.sizeRange.min)} to ${num(card.config.dotValueMax ?? anim.sizeRange.max)}`]);
    const perFrame: string[][] = [["period", "places", "rows", ...(anim.color === null ? [] : [`${colorName}_overall`, `lowest_place`, `highest_place`])]];
    const nameColumn = card.meta(card.mapLabelColumn())?.name;
    const every: string[][] = [["period", ...(anim.labels === undefined || nameColumn === undefined ? [] : [nameColumn]), lonName, latName, "rows", ...(sizeName === "" ? [] : [sizeName]), ...(anim.color === null ? [] : [colorName])]];
    frames.forEach((frame, index) => {
      const offset = index * anim.shown;
      let rows = 0;
      let active = 0;
      let weighted = 0;
      let weight = 0;
      const values: number[] = [];
      for (let place = 0; place < anim.shown; place++) {
        const count = anim.counts[offset + place]!;
        if (count === 0) continue;
        rows += count;
        active++;
        const color = anim.color?.[offset + place] ?? Number.NaN;
        if (Number.isFinite(color)) {
          values.push(color);
          weighted += color * count;
          weight += count;
        }
        every.push([
          frame.label,
          ...(anim.labels === undefined || nameColumn === undefined ? [] : [anim.labels[place] ?? ""]),
          num(anim.x[place]),
          num(anim.y[place]),
          String(count),
          ...(sizeName === "" ? [] : [num(anim.size[offset + place])]),
          ...(anim.color === null ? [] : [num(color)]),
        ]);
      }
      const stats = summarise(values);
      // An average of places weighted by their rows is the plain average of the rows; other roll-ups add or spread.
      const overall = agg === "mean" ? (weight > 0 ? weighted / weight : Number.NaN) : agg === "sum" ? (stats?.sum ?? Number.NaN) : agg === "min" ? (stats?.min ?? Number.NaN) : (stats?.max ?? Number.NaN);
      perFrame.push([
        frame.label,
        String(active),
        String(rows),
        ...(anim.color === null ? [] : [num(overall), num(stats?.min), num(stats?.max)]),
      ]);
    });
    table("Each period", perFrame);
    table("Every place in every period", every);
    return;
  }
  const result = card.seriesResult;
  if (result === null || result.mode !== "points") return;
  facts.push([places ? "Places" : "Points", `${result.shown.toLocaleString()} from ${result.total.toLocaleString()} rows${result.sampled ? (places ? " (the busiest)" : " (a sample)") : ""}`]);
  if (result.colorValues !== null && result.places === true) {
    const range = robustRange(result.colorValues, result.shown);
    if (range !== null) facts.push(["Colour scale", `${formatChartNumber(card.config.colorMin ?? range.min)} to ${formatChartNumber(card.config.colorMax ?? range.max)}; the automatic range is the middle 90% of place values`]);
  }
  const nameColumn = result.places === true && card.placeLabels !== null ? card.meta(card.mapLabelColumn())?.name : undefined;
  const rows: string[][] = [[...(nameColumn === undefined ? [] : [nameColumn]), lonName, latName, ...(result.counts ? ["rows"] : []), ...(result.size === null ? [] : [sizeName || "size"]), ...(colorMeta === undefined ? [] : [colorName])]];
  for (let index = 0; index < result.shown; index++) {
    rows.push([
      ...(nameColumn === undefined ? [] : [card.placeLabels?.[index] ?? ""]),
      num(result.x[index]),
      num(result.y[index]),
      ...(result.counts ? [String(result.counts[index] ?? 0)] : []),
      ...(result.size === null ? [] : [num(result.size[index])]),
      ...(colorMeta === undefined
        ? []
        : [result.colorValues !== null ? num(result.colorValues[index]) : result.colorCodes !== null ? (card.seriesLabels?.[result.colorCodes[index] ?? -1] ?? "") : ""]),
    ]);
  }
  table(places ? "Places" : "Points", rows);
}

/** The Map page's regions, told about the card through these. */
export function regionOptions(card: ChartCard, requests: RegionRequests): MapRegionsOptions {
  return {
    ...requests,
    columns: () => card.columns,
    coordinates: () => {
      const x = card.meta(card.config.x);
      const y = card.meta(card.config.y);
      return x !== undefined && y !== undefined && isNumericType(x.type) && isNumericType(y.type) && card.config.x !== card.config.y ? { x: card.config.x, y: card.config.y } : null;
    },
    scope: () => card.chartScope(),
    onLoaded: () => {
      card.config.mapMode = "regions";
      card.onMapModeChange?.("regions");
      card.mapView = null;
      card.stopAnimation();
      card.animationResult = null;
      card.renderControls();
      card.render();
    },
    onCleared: () => {
      card.mapView = null;
      card.renderControls();
      card.refreshSeries();
      card.render();
    },
    onChange: () => {
      card.syncRegionAxes();
      card.render();
    },
    onFrames: (frames, rows) => {
      if (!card.regionsOn()) return;
      card.stopAnimation();
      card.animationFrame = 0;
      card.animationResult = frames === null ? null : { frames: frames.labels.map((label, index) => ({ label, time: frames.times[index] ?? 0 })), maxCount: 0, total: rows, missing: 0 };
      card.syncAnimationBar();
    },
  };
}

/** What the map shows: markers (one dot per place or per row), a heat grid, or regions. */
export function setMapMode(card: ChartCard, mode: "points" | "heat" | "places" | "regions"): void {
  card.config.mapMode = mode;
  if (mode === "places" || mode === "points") card.mapModeSelect.value = card.mapModeChoice();
  card.gridField.classList.toggle("hidden", mode !== "heat");
  // A place holds many rows: a number can be averaged across them, a category cannot.
  const colorMeta = card.meta(card.config.colorColumn);
  if (card.config.mapMode === "places" && colorMeta !== undefined && !isNumericType(colorMeta.type)) card.config.colorColumn = -1;
  card.generation++;
  card.refreshSeries();
  card.refreshMapGrid();
  card.refreshAnimation();
  card.syncSourceControls();
  card.renderControls();
  card.render();
  if (mode === "regions" || mode === "heat") card.setSettingsOpen(true);
  card.onMapModeChange?.(mode);
}

/** Regions matched by name need no coordinates, so their columns would only confuse. */
export function syncRegionAxes(card: ChartCard): void {
  card.syncFieldVisibility();
  // A choropleth has its own value and colours: the general chart settings would only mislead.
  const regions = card.regionsOn();
  card.bubbleAggField.classList.toggle("hidden", regions);
  card.sourceWrap.classList.toggle("map-hide-for-regions", regions);
  for (const child of card.settingsBody.children) {
    if (child !== card.chartFilterRow) child.classList.toggle("map-hide-for-regions", regions);
  }
  if (regions) card.chartFilterRow.classList.remove("hidden");
  card.settingsBody.closest(".chart-side-settings")?.querySelector(".chart-side-title")?.replaceChildren(regions ? "Which rows count" : "Colour, filter and format");
  // Sections left with nothing showing would be only their dividing lines.
  if (card.sidebarShown) {
    for (const section of card.sidebar.querySelectorAll<HTMLElement>(":scope > .chart-side-section")) {
      section.classList.remove("map-hide-for-regions");
      if (regions && section.offsetHeight > 0 && [...section.children].every((child) => (child as HTMLElement).offsetHeight === 0)) section.classList.add("map-hide-for-regions");
    }
  }
  card.onRegionsChange?.(card.regionsOn());
}

/**
 * Map heat grid: counts (or an aggregate of a numeric measure) per cell over
 * the filtered coordinate rows, computed worker-side so every row counts.
 */
export function refreshMapGrid(card: ChartCard): void {
  if (
    card.config.kind !== "map" ||
    card.config.mapMode !== "heat" ||
    card.options.requestGridCounts === undefined
  ) {
    card.mapGrid = null;
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
    card.mapGrid = null;
    return;
  }
  const generation = ++card.generation;
  void card.options
    .requestGridCounts(
      card.config.x,
      card.config.y,
      card.config.bubbleBins ?? 40,
      card.bubbleMeasure(),
      undefined,
      card.chartScope(),
    )
    .then((message) => {
      if (generation !== card.generation || card.disposed) return;
      card.mapGrid = message.result;
      card.render();
    })
    .catch(() => {
      // Keep the last payload as the fallback.
    });
}

/** The dots of the current frame, in the shape the map draws; null when the map is not stepping through time. */
export function placeFrame(card: ChartCard): SeriesPoints | null {
  const result = card.animationResult;
  const anim = result?.places;
  if (result === null || anim === undefined || !card.animatesPlaces() || result.frames.length === 0) return null;
  const frame = Math.min(Math.max(0, card.animationFrame), result.frames.length - 1);
  const offset = frame * anim.shown;
  const keep: number[] = [];
  let total = 0;
  for (let place = 0; place < anim.shown; place++) {
    const count = anim.counts[offset + place]!;
    if (count === 0) continue;
    keep.push(place);
    total += count;
  }
  const pick = (values: ArrayLike<number>, base: number): Float64Array => Float64Array.from(keep, (place) => values[base + place]!);
  card.framePlaces = keep;
  return {
    mode: "points",
    x: pick(anim.x, 0),
    y: pick(anim.y, 0),
    colorValues: anim.color === null ? null : pick(anim.color, offset),
    colorCodes: null,
    size: pick(anim.size, offset),
    counts: pick(anim.counts, offset),
    places: true,
    shown: keep.length,
    total,
    outside: 0,
    xMin: 0,
    xMax: 1,
    yMin: 0,
    yMax: 1,
    sampled: anim.shown < anim.totalPlaces,
  };
}

/** Map cards: the rectangle brush starts on pointerdown. */
export function beginMapBrush(card: ChartCard, event: PointerEvent): void {
  const kind = card.config.kind;
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
  const rect = card.canvas.getBoundingClientRect();
  const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
  const frame = card.lastFrame;
  if (
    point.x < frame.left ||
    point.x > frame.left + frame.plotW ||
    point.y < frame.top ||
    point.y > frame.top + frame.plotH
  ) {
    return;
  }
  if (kind !== "map" && event.shiftKey && card.brushSpace !== null) {
    card.dragMoved = false;
    card.brushDrag = { x0: point.x, y0: point.y, x1: point.x, y1: point.y };
    try {
      card.canvas.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture is best-effort.
    }
    return;
  }
  if (kind !== "map") {
    // Scatter/density: drag pans the viewport.
    card.dragMoved = false;
    card.plotDrag = point;
    try {
      card.canvas.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture is best-effort.
    }
    return;
  }
  if (!event.shiftKey) {
    // Plain drag pans the viewport; Shift+drag is the rectangle filter.
    card.dragMoved = false;
    card.mapDrag = point;
    try {
      card.canvas.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture is best-effort.
    }
    return;
  }
  card.mapBrushStart = point;
  card.dragMoved = false;
  card.mapBrush = { x0: point.x, y0: point.y, x1: point.x, y1: point.y };
  try {
    card.canvas.setPointerCapture(event.pointerId);
  } catch {
    // Pointer capture is best-effort.
  }
}

/**
 * Map brush release: converts the rectangle to lon/lat bounds and filters
 * both coordinate columns. Rects smaller than 6 px are treated as clicks.
 */
export function endMapBrush(card: ChartCard, event: PointerEvent): void {
  if (card.brushDrag !== null) {
    const rect = card.canvas.getBoundingClientRect();
    const drag = { ...card.brushDrag, x1: event.clientX - rect.left, y1: event.clientY - rect.top };
    card.brushDrag = null;
    card.finishBrush(drag);
    return;
  }
  if (card.config.kind !== "map") {
    card.plotDrag = null;
    return;
  }
  card.mapDrag = null;
  if (card.mapBrushStart === null) return;
  const rect = card.canvas.getBoundingClientRect();
  const end = { x: event.clientX - rect.left, y: event.clientY - rect.top };
  const frame = card.lastFrame;
  card.mapBrushStart = null;
  const brush = card.mapBrush;
  card.mapBrush = null;
  if (frame === null || brush === null) return;
  const drag = {
    x0: Math.min(brush.x0, end.x),
    y0: Math.min(brush.y0, end.y),
    x1: Math.max(brush.x0, end.x),
    y1: Math.max(brush.y0, end.y),
  };
  const clampX = (value: number): number =>
    Math.max(frame.left, Math.min(frame.left + frame.plotW, value));
  const clampY = (value: number): number =>
    Math.max(frame.top, Math.min(frame.top + frame.plotH, value));
  if (
    clampX(drag.x1) - clampX(drag.x0) < 6 ||
    clampY(drag.y1) - clampY(drag.y0) < 6
  ) {
    card.render();
    return;
  }
  const view = card.mapViewShown();
  const bounds = mapBrushBounds(
    {
      left: frame.left,
      top: frame.top,
      plotW: frame.plotW,
      plotH: frame.plotH,
      lonMin: view.lonMin,
      lonMax: view.lonMax,
      latMin: view.latMin,
      latMax: view.latMax,
    },
    drag,
  );
  const selection: MapBrushSelection = {
    lonColumn: card.config.x,
    lonMin: bounds.lonMin,
    lonMax: bounds.lonMax,
    latColumn: card.config.y,
    latMin: bounds.latMin,
    latMax: bounds.latMax,
  };
  card.render();
  card.options.onMapBrush?.(selection);
}

/** Zoom the map around a normalized anchor (0.5, 0.5 = the centre). */
export function zoomMap(card: ChartCard, factor: number, tx = 0.5, ty = 0.5): void {
  if (card.config.kind !== "map") return;
  const view = card.mapViewShown();
  const lon = view.lonMin + tx * (view.lonMax - view.lonMin);
  const lat = view.latMin + ty * (view.latMax - view.latMin);
  const scale = Math.max(factor, 0.002 / Math.min(view.lonMax - view.lonMin, view.latMax - view.latMin));
  const lonSpan = Math.min(360, (view.lonMax - view.lonMin) * scale);
  const latSpan = Math.min(180, (view.latMax - view.latMin) * scale);
  const lonMin = Math.min(180 - lonSpan, Math.max(-180, lon - tx * lonSpan));
  const latMin = Math.min(90 - latSpan, Math.max(-90, lat - ty * latSpan));
  card.mapView = { lonMin, lonMax: lonMin + lonSpan, latMin, latMax: latMin + latSpan };
  card.render();
}

/** The map as one web page that needs nothing else, with zoom, pan, hover and any time slider. */
export function exportMapHtml(card: ChartCard): boolean {
  const payload = card.mapHtmlPayload();
  if (payload === null) {
    card.noteEl.textContent = "This map has nothing to export yet.";
    return false;
  }
  const name = `${safeFileName(card.config.title.trim() !== "" ? card.config.title.trim() : `${card.options.datasetName()}-map`)}.html`;
  const ok = downloadHtml(name, buildMapHtml(payload));
  if (ok) card.noteEl.textContent = `Saved ${name}: open it in any browser, no internet needed`;
  return ok;
}

export function mapHtmlPayload(card: ChartCard): MapHtmlPayload | null {
  const view = card.mapViewShown();
  const lonPad = view.lonMax - view.lonMin;
  const latPad = view.latMax - view.latMin;
  // The coast near the view, at the detail the map is showing, and the whole world's only when it is zoomed out.
  const base = lonPad <= DETAIL_LON_SPAN && card.detailBasemap !== null ? card.detailBasemap : card.basemap;
  const land = (base?.land ?? [])
    .filter((ring) => {
      let inside = false;
      for (let i = 0; i < ring.length && !inside; i += 2) {
        inside = ring[i]! >= view.lonMin - lonPad * 3 && ring[i]! <= view.lonMax + lonPad * 3 && ring[i + 1]! >= view.latMin - latPad * 3 && ring[i + 1]! <= view.latMax + latPad * 3;
      }
      return inside;
    })
    .map((ring) => roundRing(ring, 3));
  const markers = card.mapMarkers.map((marker) => ({ lon: marker.lon, lat: marker.lat, label: marker.label, size: marker.size ?? 7 }));
  const shared = {
    title: card.config.title.trim() !== "" ? card.config.title.trim() : card.options.datasetName() === "" ? "Map" : card.options.datasetName(),
    view,
    land,
    ...(markers.length === 0 ? {} : { markers }),
    credit: `Made with TurboFuzz on ${new Date().toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })}`,
  };
  if (card.regionsOn()) {
    const data = card.regions?.exportData();
    if (data === null || data === undefined) return null;
    return { ...shared, subtitle: data.legend.title, frames: data.frames, regions: data.regions, legend: data.legend };
  }
  const saved = card.animationFrame;
  const stepping = card.animationResult?.places !== undefined && card.placeFrame() !== null;
  const labels = stepping ? (card.animationResult?.frames ?? []).map((frame) => frame.label) : [""];
  const colours: string[] = [];
  const indexOf = new Map<string, number>();
  const frames: NonNullable<MapHtmlPayload["dots"]>["frames"] = [];
  let legend: MapHtmlLegend | null = null;
  const colorMeta = card.meta(card.config.colorColumn);
  labels.forEach((_, frameIndex) => {
    if (stepping) card.animationFrame = frameIndex;
    const result = card.placeFrame() ?? card.seriesResult;
    if (result === null || result.mode !== "points") return;
    const sizes = card.mapRadii(result, 1);
    const buckets = card.colorBuckets(result);
    const out = { x: [] as number[], y: [] as number[], r: [] as number[], c: [] as number[], tips: [] as string[][] };
    for (let i = 0; i < result.shown; i++) {
      const lon = result.x[i]!;
      const lat = result.y[i]!;
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
      const colour = buckets === null ? card.primaryColor() : (buckets.colors[buckets.buckets[i]!] ?? card.primaryColor());
      let at = indexOf.get(colour);
      if (at === undefined) {
        at = colours.length;
        colours.push(colour);
        indexOf.set(colour, at);
      }
      out.x.push(Math.round(lon * 1e5) / 1e5);
      out.y.push(Math.round(lat * 1e5) / 1e5);
      out.r.push(Math.round((sizes === null ? (card.config.dotMinRadius ?? 2.2) : sizes[i]!) * 10) / 10);
      out.c.push(at);
      out.tips.push(card.mapDotLines(result, i, lon, lat));
    }
    frames.push(out);
    if (legend === null && buckets?.domain !== undefined && colorMeta !== undefined) {
      const agg = result.places === true ? `${MAP_COLOR_AGG_NAMES[card.config.mapColorAgg ?? "mean"]} ` : "";
      legend = { title: `Colour: ${agg}${colorMeta.name}`, ramp: { stops: buckets.colors.slice(0, 16), low: formatCompact(buckets.domain.min), high: formatCompact(buckets.domain.max) } };
    }
  });
  if (stepping) card.animationFrame = saved;
  if (frames.length === 0) return null;
  const last = frames[frames.length - 1]!;
  if (legend === null && last.r.length > 0 && card.dotsAreSized()) legend = { title: "Dots" };
  const sizeRange = card.seriesResult?.mode === "points" && card.seriesResult.size !== null ? dataRange(card.seriesResult.size, card.seriesResult.shown) : null;
  const fixed = stepping ? (card.animationResult?.places?.sizeRange ?? null) : null;
  const span = fixed ?? sizeRange;
  if (legend !== null && span !== null && card.dotsAreSized()) {
    (legend as MapHtmlLegend).sizes = { title: card.meta(card.config.sizeColumn)?.name ?? "rows", low: formatCompact(span.min), high: formatCompact(span.max) };
  }
  const lead = card.summaryEl.textContent?.trim() ?? "";
  return { ...shared, subtitle: colorMeta === undefined ? lead : `Coloured by ${colorMeta.name}`, frames: labels, dots: { frames, colours, opacity: card.config.dotOpacity ?? 0.6 }, legend };
}

/** What the map shows: the view asked for, in the shape of the plot, so places keep their proportions. */
export function mapViewShown(card: ChartCard): MapViewport {
  const view = card.mapView ?? card.mapViewOrAuto();
  const frame = card.lastFrame;
  return frame === null ? view : fitViewToPlot(view, frame.plotW, frame.plotH);
}

/** Auto viewport: custom regions, then heat grid, then point percentiles. */
export function mapViewOrAuto(card: ChartCard): MapViewport {
  const base = card.dataViewOrNull();
  const markers = card.markerBox();
  if (markers === null) return base ?? { lonMin: -180, lonMax: 180, latMin: -90, latMax: 90 };
  if (base === null) return card.frameBox(markers);
  // Markers inside what is plotted change nothing; one outside widens the view to take it in, so none is ever off screen.
  const inside = markers.lonMin >= base.lonMin && markers.lonMax <= base.lonMax && markers.latMin >= base.latMin && markers.latMax <= base.latMax;
  if (inside) return base;
  return card.frameBox({
    lonMin: Math.min(base.lonMin, markers.lonMin), lonMax: Math.max(base.lonMax, markers.lonMax),
    latMin: Math.min(base.latMin, markers.latMin), latMax: Math.max(base.latMax, markers.latMax),
  });
}

/** The view for what is plotted alone (regions, heat grid, or the middle 98% of the points). */
export function dataViewOrNull(card: ChartCard): MapViewport | null {
  if (card.regionsOn() && card.regions?.bounds != null) return { ...card.regions.bounds };
  if (card.mapGrid !== null) {
    return {
      lonMin: card.mapGrid.xMin,
      lonMax: card.mapGrid.xMax,
      latMin: card.mapGrid.yMin,
      latMax: card.mapGrid.yMax,
    };
  }
  if (card.seriesResult !== null && card.seriesResult.mode === "points") {
    const fitted = fitMapView(card.seriesResult.x, card.seriesResult.y);
    if (fitted !== null) return fitted;
  }
  return null;
}

export function resetMapZoom(card: ChartCard): void {
  let changed = false;
  let binsChanged = false;
  if (card.config.kind === "map" && card.mapView !== null) {
    card.mapView = null;
    changed = true;
  }
  if (
    (card.config.kind === "scatter" ||
      card.config.kind === "density" ||
      card.config.kind === "bubble") &&
    card.plotView !== null
  ) {
    card.plotView = null;
    changed = true;
  }
  if (
    (card.config.kind === "line" || card.config.kind === "histogram") &&
    card.chartXZoom !== null
  ) {
    card.chartXZoom = null;
    binsChanged = true;
  }
  if (card.config.kind === "bar" && card.barWindow !== null) {
    card.barWindow = null;
    changed = true;
  }
  if (card.config.kind === "heatmap" && card.heatWindow !== null) {
    card.heatWindow = null;
    changed = true;
  }
  if (card.config.kind === "box" && (card.boxWindow !== null || card.boxY !== null)) {
    card.boxWindow = null;
    card.boxY = null;
    changed = true;
  }
  if (card.config.kind === "correlation" && card.corrWindow !== null) {
    card.corrWindow = null;
    changed = true;
  }
  if (
    (card.config.kind === "treemap" || card.config.kind === "terms") &&
    card.itemWindow !== null
  ) {
    card.itemWindow = null;
    changed = true;
  }
  if (binsChanged) card.refreshBins();
  if (changed || binsChanged) card.render();
}

/** Back to the automatic view, which covers what is plotted and the page's own markers. */
export function fitMapAll(card: ChartCard): void {
  if (card.config.kind !== "map") return;
  card.mapView = null;
  card.render();
}

/** A box around the page's own markers: room each side, a few degrees at least, in the plot's own shape. */
export function markerBox(card: ChartCard): MapViewport | null {
  if (card.mapMarkers.length === 0) return null;
  let lonMin = Infinity, lonMax = -Infinity, latMin = Infinity, latMax = -Infinity;
  for (const m of card.mapMarkers) {
    lonMin = Math.min(lonMin, m.lon); lonMax = Math.max(lonMax, m.lon);
    latMin = Math.min(latMin, m.lat); latMax = Math.max(latMax, m.lat);
  }
  return { lonMin, lonMax, latMin, latMax };
}

/** The viewport that frames `box` with 25% room each side, at least a few degrees across, undistorted. */
export function frameBox(card: ChartCard, box: MapViewport): MapViewport {
  const aspect = card.lastFrame !== null && card.lastFrame.plotH > 0 ? card.lastFrame.plotW / card.lastFrame.plotH : 2;
  let lonSpan = Math.max(6, (box.lonMax - box.lonMin) * 1.5);
  let latSpan = Math.max(3, (box.latMax - box.latMin) * 1.5);
  if (lonSpan / latSpan < aspect) lonSpan = latSpan * aspect;
  else latSpan = lonSpan / aspect;
  lonSpan = Math.min(360, lonSpan);
  latSpan = Math.min(170, latSpan);
  const left = Math.min(180 - lonSpan, Math.max(-180, (box.lonMin + box.lonMax) / 2 - lonSpan / 2));
  const bottom = Math.min(85 - latSpan, Math.max(-85, (box.latMin + box.latMax) / 2 - latSpan / 2));
  return { lonMin: left, lonMax: left + lonSpan, latMin: bottom, latMax: bottom + latSpan };
}

export function drawMap(card: ChartCard, ctx: CanvasRenderingContext2D, frame: Frame): void {
  card.mapLegend = null;
  card.drawMapLayers(ctx, frame);
  (card.mapLegend as (() => void) | null)?.();
  card.mapLegend = null;
}

export function drawMapLayers(card: ChartCard, ctx: CanvasRenderingContext2D, frame: Frame): void {
  card.drawMapBody(ctx, frame);
  if (card.basemap === null) return;
  const view = card.mapViewShown();
  const x0 = frame.left, y0 = frame.top, w = frame.plotW, h = frame.plotH;
  if (card.mapOverlay !== null) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, y0, w, h);
    ctx.clip();
    card.mapOverlay(ctx, view, { x: x0, y: y0, w, h, ui: frame.ui });
    ctx.restore();
  }
  if (card.mapMarkers.length === 0) return;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x0, y0, w, h);
  ctx.clip();
  ctx.font = `600 ${11 * frame.ui}px system-ui, sans-serif`;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  for (const marker of card.mapMarkers) {
    const r = (marker.size ?? 7) * frame.ui;
    const x = x0 + ((marker.lon - view.lonMin) / (view.lonMax - view.lonMin)) * w;
    const y = y0 + ((view.latMax - marker.lat) / (view.latMax - view.latMin)) * h;
    if (x < x0 - r || x > x0 + w + r || y < y0 - r || y > y0 + h + r) continue;
    ctx.save();
    marker.draw(ctx, x, y, r);
    ctx.restore();
    if (marker.label !== "") {
      // A halo in the panel colour keeps the label readable over any picture, in either theme.
      ctx.lineWidth = 3;
      ctx.lineJoin = "round";
      ctx.strokeStyle = cssVar("--panel", "#ffffff");
      ctx.strokeText(marker.label, x + r + 3, y);
      ctx.fillStyle = cssVar("--text", "#1c2430");
      ctx.fillText(marker.label, x + r + 3, y);
    }
    card.hitRegions.push({
      x: x - r,
      y: y - r,
      w: 2 * r,
      h: 2 * r,
      lines: [marker.label || "Marker", `${marker.lat.toFixed(4)}, ${marker.lon.toFixed(4)}`],
      actions: [],
    });
  }
  ctx.restore();
}

/**
 * Many markers, few pixels: the markers that fall in the same patch of screen become one numbered circle, sized by how many it
 * holds, and a lone marker stays a marker. Zooming in, or clicking a circle, splits them. Done in screen space, so it follows the
 * zoom with no setting to tune.
 */
export function drawMapClusters(card: ChartCard, ctx: CanvasRenderingContext2D, result: SeriesPoints, view: MapViewport, px: (lon: number) => number, py: (lat: number) => number, ui: number, drawAt: (index: number) => void, dotAlpha: number): void {
  const cell = 46 * ui;
  const cells = new Map<number, { n: number; sx: number; sy: number; first: number; lonMin: number; lonMax: number; latMin: number; latMax: number }>();
  for (let i = 0; i < result.shown; i++) {
    const lon = result.x[i] ?? Number.NaN, lat = result.y[i] ?? Number.NaN;
    if (!Number.isFinite(lon) || !Number.isFinite(lat) || lon < view.lonMin || lon > view.lonMax || lat < view.latMin || lat > view.latMax) continue;
    const x = px(lon), y = py(lat), key = Math.floor(y / cell) * 100_000 + Math.floor(x / cell);
    const c = cells.get(key);
    if (c === undefined) cells.set(key, { n: 1, sx: x, sy: y, first: i, lonMin: lon, lonMax: lon, latMin: lat, latMax: lat });
    else {
      c.n++; c.sx += x; c.sy += y;
      if (lon < c.lonMin) c.lonMin = lon; if (lon > c.lonMax) c.lonMax = lon;
      if (lat < c.latMin) c.latMin = lat; if (lat > c.latMax) c.latMax = lat;
    }
  }
  const colour = card.primaryColor();
  ctx.lineWidth = Math.max(0.75, 0.8 * ui);
  let clusters = 0, loose = 0;
  for (const c of cells.values()) {
    if (c.n === 1) {
      // A marker on its own is drawn as it always is.
      ctx.fillStyle = colour;
      ctx.strokeStyle = darkerColor(colour, BORDER_DARKER);
      drawAt(c.first);
      loose++;
      continue;
    }
    const x = c.sx / c.n, y = c.sy / c.n;
    const r = Math.min(30 * ui, (10 + 4.2 * Math.log2(c.n)) * ui);
    ctx.beginPath();
    ctx.arc(x, y, r + 3 * ui, 0, Math.PI * 2);
    ctx.fillStyle = colour;
    ctx.globalAlpha = 0.28;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.globalAlpha = Math.max(0.8, dotAlpha);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.lineWidth = 1.5 * ui;
    ctx.strokeStyle = "#ffffff";
    ctx.stroke();
    ctx.fillStyle = "#ffffff";
    ctx.font = `600 ${Math.max(10, Math.min(15, r * 0.8)) * ui}px ${getComputedStyle(card.canvas).fontFamily || "sans-serif"}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(c.n >= 10_000 ? `${Math.round(c.n / 1000)}k` : c.n >= 1000 ? `${(c.n / 1000).toFixed(1)}k` : String(c.n), x, y + 0.5);
    ctx.textAlign = "start";
    ctx.textBaseline = "alphabetic";
    ctx.lineWidth = Math.max(0.75, 0.8 * ui);
    card.mapClusters.push({ x, y, r: r + 3 * ui, lonMin: c.lonMin, lonMax: c.lonMax, latMin: c.latMin, latMax: c.latMax });
    card.hitRegions.push({ x: x - r, y: y - r, w: r * 2, h: r * 2, contains: (hx, hy) => (hx - x) ** 2 + (hy - y) ** 2 <= r * r, lines: [`${c.n.toLocaleString()} markers here`, "Click to zoom in"], actions: [] });
    clusters++;
  }
  ctx.globalAlpha = 1;
  card.clusterNote = `${clusters.toLocaleString()} cluster${clusters === 1 ? "" : "s"} and ${loose.toLocaleString()} single marker${loose === 1 ? "" : "s"} in view · click a cluster to zoom in`;
}

export function drawMapBody(card: ChartCard, ctx: CanvasRenderingContext2D, frame: Frame): void {
  if (card.basemap === null) {
    const cached = basemapCaches.get("110m");
    if (cached !== undefined) card.basemap = cached;
  }
  if (card.basemap === null) {
    const message = "Loading the offline basemap…";
    card.noteEl.textContent = message;
    card.drawPlotMessage(ctx, frame, message);
    void loadBasemap().then((map) => {
      card.basemap = map;
      if (!card.disposed) card.render();
    });
    return;
  }
  const x0 = frame.left;
  const y0 = frame.top;
  const w = frame.plotW;
  const h = frame.plotH;
  const view =
    card.mapViewShown();
  const lonSpan = view.lonMax - view.lonMin;
  const latSpan = view.latMax - view.latMin;

  // Regional views get the 50m basemap; the 110m version keeps painting
  // until the detail module is decoded, so zooming never blocks the map.
  let map = card.basemap;
  let detailNote = "";
  if (lonSpan <= DETAIL_LON_SPAN) {
    if (card.detailBasemap !== null) {
      map = card.detailBasemap;
      detailNote = "50m detail";
    } else if (!card.detailBasemapRequested && !card.detailBasemapFailed) {
      card.detailBasemapRequested = true;
      card.detailBasemapLoading = true;
      detailNote = "loading map detail…";
      void loadBasemap("50m")
        .then((detail) => {
          card.detailBasemap = detail;
          card.detailBasemapLoading = false;
          if (!card.disposed) card.render();
        })
        .catch(() => {
          card.detailBasemapFailed = true;
          card.detailBasemapLoading = false;
        });
    } else if (card.detailBasemapLoading) {
      detailNote = "loading map detail…";
    }
  }
  const px = (lon: number): number => x0 + ((lon - view.lonMin) / lonSpan) * w;
  const py = (lat: number): number => y0 + ((view.latMax - lat) / latSpan) * h;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x0, y0, w, h);
  ctx.clip();

  // Water is a light blue (a deep blue-grey in the dark theme); over a loaded picture it stays a faint tint.
  const rootStyle = getComputedStyle(document.documentElement);
  const [pr, pg, pb] = hexToRgb(rootStyle.getPropertyValue("--panel").trim() || "#ffffff");
  const darkTheme = pr + pg + pb < 384;
  const waterColor = darkTheme ? "#16222e" : "#cfe5f4";
  const landColor = darkTheme ? "#3a3626" : "#f0e2b6";
  const coastColor = darkTheme ? "#6f6747" : "#b3a36e";
  ctx.fillStyle = waterColor;
  ctx.fillRect(x0, y0, w, h);

  // Graticule: 30° at world scale, finer as the viewport zooms in.
  const gridStep = lonSpan > 180 ? 30 : lonSpan > 60 ? 10 : lonSpan > 20 ? 5 : 1;
  ctx.strokeStyle = frame.border;
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.4;
  ctx.beginPath();
  for (
    let lon = Math.ceil(view.lonMin / gridStep) * gridStep;
    lon <= view.lonMax;
    lon += gridStep
  ) {
    ctx.moveTo(px(lon), y0);
    ctx.lineTo(px(lon), y0 + h);
  }
  for (
    let lat = Math.ceil(view.latMin / gridStep) * gridStep;
    lat <= view.latMax;
    lat += gridStep
  ) {
    ctx.moveTo(x0, py(lat));
    ctx.lineTo(x0 + w, py(lat));
  }
  ctx.stroke();
  ctx.globalAlpha = 1;

  {
    // Land polygons: one fill path, then one stroke path for the coast.
    const trace = (rings: readonly ArrayLike<number>[]): void => {
      ctx.beginPath();
      for (const ring of rings) {
        let wrap = 0;
        for (let i = 0; i < ring.length; i += 2) {
          const lon = ring[i] ?? 0;
          if (i > 0) {
            const step = lon - (ring[i - 2] ?? 0);
            if (step > 180) wrap -= 360;
            else if (step < -180) wrap += 360;
          }
          const x = px(lon + wrap);
          const y = py(ring[i + 1] ?? 0);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
      }
    };
    trace(map.land);
    ctx.fillStyle = landColor;
    ctx.globalAlpha = 1;
    ctx.fill();
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = coastColor;
    ctx.lineWidth = 0.75;
    ctx.stroke();
    ctx.globalAlpha = 1;

    // Country borders add detail without turning the map into a wireframe.
    trace(map.countries.flatMap((country) => country.rings));
    ctx.strokeStyle = coastColor;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 0.6;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  const ui = frame.ui;
  const regions = card.regions;
  if (regions !== null && regions.ready) {
    const period = card.regionsOn() && card.animationResult !== null ? Math.min(card.animationFrame, card.animationResult.frames.length - 1) : 0;
    const hits = regions.draw(ctx, frame, view, { outline: !card.regionsOn(), frame: period });
    if (card.regionsOn()) card.hitRegions.push(...hits);
  }
  if (card.regionsOn()) {
    ctx.restore();
    const label = card.animationResult?.frames[Math.min(card.animationFrame, card.animationResult.frames.length - 1)]?.label;
    if (label !== undefined) {
      card.font(ctx, ui, 13, "600");
      const width = ctx.measureText(label).width;
      ctx.fillStyle = card.plateColor();
      ctx.globalAlpha = 0.9;
      ctx.fillRect(frame.left + 8 * ui, frame.top + 8 * ui, width + 12 * ui, 22 * ui);
      ctx.globalAlpha = 1;
      ctx.fillStyle = frame.text;
      ctx.fillText(label, frame.left + 14 * ui, frame.top + 24 * ui);
    }
    if (regions?.ready === true) card.mapLegend = () => regions.drawLegend(ctx, frame, card.plateColor(), (size, weight) => card.font(ctx, ui, size, weight));
    card.noteEl.textContent = `${regions?.note(card.animationResult === null ? 0 : card.animationFrame) ?? "Regions need a boundary file."}${detailNote === "" ? "" : ` · ${detailNote}`} · scroll to zoom · drag to pan · double-click resets`;
    return;
  }
  if (card.config.mapMode === "heat") {
    const grid = card.mapGrid;
    if (grid === null) {
      card.noteEl.textContent = "Computing the heat grid…";
      return;
    }
    const values = grid.values;
    const dataMax = Math.max(1, values === null ? grid.maxCount : grid.valueMax);
    const domain = resolveColorDomain({
      autoMin: 0,
      autoMax: dataMax,
      min: card.config.colorMin,
      max: card.config.colorMax,
      center: card.config.colorCenter,
    });
    const rampName = card.config.palette ?? DEFAULT_PALETTE;
    const ramp = isRampPalette(rampName) ? card.rampStopsFor(rampName) : null;
    const colors = colorRamp(ramp, 32, rampColor);
    const cellLon = (grid.xMax - grid.xMin) / grid.bins;
    const cellLat = (grid.yMax - grid.yMin) / grid.bins;
    const degrees = (d: number): string => (d >= 10 ? d.toFixed(0) : d >= 1 ? d.toFixed(1) : d.toFixed(2));
    card.gridHint.textContent = `each cell ≈ ${degrees(cellLon)}° × ${degrees(cellLat)}°`;
    for (let cy = 0; cy < grid.bins; cy++) {
      for (let cx = 0; cx < grid.bins; cx++) {
        const index = cy * grid.bins + cx;
        const value =
          values === null ? (grid.counts[index] ?? 0) : (values[index] ?? Number.NaN);
        if (!Number.isFinite(value) || value <= 0) continue;
        const lon0 = grid.xMin + cx * cellLon;
        const latTop = grid.yMax - cy * cellLat;
        const lat0 = latTop - cellLat;
        if (lon0 + cellLon < view.lonMin || lon0 > view.lonMax) continue;
        if (lat0 + cellLat < view.latMin || lat0 > view.latMax) continue;
        const t = colorFraction(value, domain);
        ctx.fillStyle =
          colors[Math.min(colors.length - 1, Math.floor(t * colors.length))] ??
          card.primaryColor();
        ctx.globalAlpha = 0.82;
        ctx.fillRect(
          px(lon0),
          py(latTop),
          Math.max(1, (cellLon / lonSpan) * w) + 0.5,
          Math.max(1, (cellLat / latSpan) * h) + 0.5,
        );
      }
    }
    ctx.globalAlpha = 1;
    card.mapLegend = () => card.drawColorBar(ctx, frame, colors, domain, 6 * ui);
    const measureMeta = card.meta(card.config.sizeColumn);
    const agg = card.config.bubbleAgg ?? "count";
    const measure =
      values === null || card.config.sizeColumn < 0 || measureMeta === undefined
        ? "rows per cell"
        : `${agg}(${measureMeta.name}) per cell`;
    card.noteEl.textContent = `heat: ${measure} · ${grid.bins}×${grid.bins} grid · ${grid.total.toLocaleString()} rows${
      detailNote === "" ? "" : ` · ${detailNote}`
    } · scroll to zoom · drag to pan · double-click resets`;
    return;
  }
  const result = card.placeFrame() ?? card.seriesResult;
  if (result === null) {
    card.noteEl.textContent = "Pick numeric longitude and latitude columns.";
    return;
  }
  if (result.mode === "density") {
    // Density never applies (map requests points), but keep a sane fallback.
    const spanX = result.xMax - result.xMin;
    const spanY = result.yMax - result.yMin;
    ctx.fillStyle = card.primaryColor();
    for (let cy = 0; cy < result.rows; cy++) {
      for (let cx = 0; cx < result.cols; cx++) {
        const count = result.counts[cy * result.cols + cx] ?? 0;
        if (count === 0) continue;
        const lon = result.xMin + ((cx + 0.5) / result.cols) * spanX;
        const lat = result.yMin + ((cy + 0.5) / result.rows) * spanY;
        if (lon < -180 || lon > 180 || lat < -90 || lat > 90) continue;
        ctx.globalAlpha = 0.25 + 0.6 * (count / Math.max(1, result.max));
        ctx.fillRect(px(lon) - 2 * ui, py(lat) - 2 * ui, 4 * ui, 4 * ui);
      }
    }
    ctx.globalAlpha = 1;
    card.noteEl.textContent = `${result.total.toLocaleString()} points · ${result.outside.toLocaleString()} outside the world bounds${
      detailNote === "" ? "" : ` · ${detailNote}`
    } · drag a rectangle to filter to an area`;
    return;
  }
  // Points: sized and coloured by the chosen columns, batched by colour.
  const sizes = card.mapRadii(result, ui);
  const buckets = card.colorBuckets(result);
  const baseRadius = (card.config.dotMinRadius ?? 2.2) * ui;
  const dotAlpha = card.config.dotOpacity ?? 0.6;
  const markerShape = card.config.markerShape ?? "circle";
  const drawAt = (index: number): void => {
    const lon = result.x[index] ?? Number.NaN;
    const lat = result.y[index] ?? Number.NaN;
    if (
      !Number.isFinite(lon) ||
      !Number.isFinite(lat) ||
      lon < view.lonMin ||
      lon > view.lonMax ||
      lat < view.latMin ||
      lat > view.latMax
    ) {
      return;
    }
    const r = sizes === null ? baseRadius : (sizes[index] ?? baseRadius);
    if (result.shown <= 5000) {
      const reach = Math.max(r, 5 * ui);
      card.hitRegions.push({ x: px(lon) - reach, y: py(lat) - reach, w: reach * 2, h: reach * 2, lines: card.mapDotLines(result, index, lon, lat), actions: [] });
      ctx.beginPath();
      addMarkerPath(ctx, markerShape, px(lon), py(lat), Math.max(0.5, r));
      ctx.globalAlpha = dotAlpha;
      ctx.fill();
      ctx.globalAlpha = BORDER_ALPHA;
      ctx.stroke();
    } else {
      addMarkerPath(ctx, markerShape, px(lon), py(lat), Math.max(0.5, r));
    }
  };
  card.mapClusters = [];
  const clustered = card.config.mapCluster === true && result.places !== true && result.shown >= 30;
  if (clustered) {
    card.drawMapClusters(ctx, result, view, px, py, ui, drawAt, dotAlpha);
  } else {
  const batched = result.shown > 5000;
  ctx.lineWidth = Math.max(0.75, 0.8 * ui);
  if (buckets === null) {
    ctx.fillStyle = card.primaryColor();
    ctx.strokeStyle = darkerColor(card.primaryColor(), BORDER_DARKER);
    ctx.globalAlpha = dotAlpha;
    if (batched) ctx.beginPath();
    for (let i = 0; i < result.shown; i++) drawAt(i);
    if (batched) {
      ctx.fill();
      ctx.globalAlpha = BORDER_ALPHA;
      ctx.stroke();
    }
  } else {
    for (let bucket = 0; bucket < buckets.colors.length; bucket++) {
      ctx.fillStyle = buckets.colors[bucket] ?? card.primaryColor();
      ctx.strokeStyle = darkerColor(buckets.colors[bucket] ?? card.primaryColor(), BORDER_DARKER);
      ctx.globalAlpha = dotAlpha;
      if (batched) ctx.beginPath();
      for (let i = 0; i < result.shown; i++) {
        if (buckets.buckets[i] === bucket) drawAt(i);
      }
      if (batched) {
        ctx.fill();
        ctx.globalAlpha = BORDER_ALPHA;
        ctx.stroke();
      }
    }
  }
  }
  ctx.globalAlpha = 1;

  // Live brush rectangle.
  if (card.mapBrush !== null) {
    const rx = Math.min(card.mapBrush.x0, card.mapBrush.x1);
    const ry = Math.min(card.mapBrush.y0, card.mapBrush.y1);
    const rw = Math.abs(card.mapBrush.x1 - card.mapBrush.x0);
    const rh = Math.abs(card.mapBrush.y1 - card.mapBrush.y0);
    ctx.fillStyle = card.primaryColor();
    ctx.globalAlpha = 0.15;
    ctx.fillRect(rx, ry, rw, rh);
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = card.primaryColor();
    ctx.lineWidth = 1;
    ctx.strokeRect(rx + 0.5, ry + 0.5, rw, rh);
    ctx.globalAlpha = 1;
  }
  ctx.restore();
  card.mapLegend = () => {
    const legendHeight = card.drawMapSizeLegend(ctx, frame, result);
    if (buckets?.domain !== undefined) card.drawColorBar(ctx, frame, buckets.colors, buckets.domain, legendHeight + 6 * ui);
  };

  const sampled = result.sampled ? " (sampled)" : "";
  const colorText = card.colorNote(result);
  const sizeMeta = card.meta(card.config.sizeColumn);
  const extras = [
    colorText === null ? "" : `${colorText}`,
    sizeMeta === undefined || sizes === null ? "" : `size: ${sizeMeta.name}`,
  ]
    .filter((part) => part !== "")
    .join(" · ");
  card.noteEl.textContent = `${result.shown.toLocaleString()} of ${result.total.toLocaleString()} points${sampled}${
    extras === "" ? "" : ` · ${extras}`
  }${detailNote === "" ? "" : ` · ${detailNote}`} — scroll to zoom · drag to pan · shift-drag to filter · double-click resets`;
  if (clustered) card.noteEl.textContent += ` · ${card.clusterNote}`;
  // Many rows on few spots (trips between stations): one dot per place says more than a stack of dots.
  if (result.places !== true && result.shown >= 50) {
    const spots = new Set<string>();
    for (let i = 0; i < result.shown; i++) spots.add(`${Math.round((result.x[i] ?? 0) * 1e5)}|${Math.round((result.y[i] ?? 0) * 1e5)}`);
    if (spots.size * 2 <= result.shown) {
      const nudge = el("button", { class: "link small chart-density-nudge", type: "button", title: "Group the rows that sit at the same place into one dot, sized by how many rows it holds" }, [`${result.shown.toLocaleString()} rows sit on ${spots.size.toLocaleString()} places: show one dot per place`]);
      nudge.addEventListener("click", () => {
        card.config.mapMode = "places";
        card.mapModeSelect.value = "places";
        card.generation++;
        card.refreshSeries();
        card.render();
      });
      card.noteEl.append(" ", nudge);
    }
  }
  if (result.places === true) {
    const top = result.counts ? Math.max(...Array.from(result.counts.subarray(0, Math.min(result.shown, 2000)))) : 0;
    const colorMeta = card.meta(card.config.colorColumn);
    const colorPart = result.colorValues === null || colorMeta === undefined ? "" : ` · colour = ${MAP_COLOR_AGG_NAMES[card.config.mapColorAgg ?? "mean"]} ${colorMeta.name}${card.config.colorMin == null || card.config.colorMax == null ? " (the scale spans the middle 90% of values)" : ""}${card.config.mapColorScale === "log" ? ", logarithmic" : ""}`;
    const stepping = card.animationResult?.places !== undefined && card.placeFrame() !== null;
    const time = stepping ? (card.animationResult?.frames[Math.min(card.animationFrame, card.animationResult.frames.length - 1)]?.label ?? "") : "";
    card.noteEl.textContent = `${time === "" ? "" : `${time} · `}${result.shown.toLocaleString()} places from ${result.total.toLocaleString()} rows${result.sampled ? " (the busiest shown)" : ""}${top > 0 ? ` · the busiest holds ${top.toLocaleString()}` : ""} · dot size = ${card.config.sizeColumn >= 0 ? `${card.config.bubbleAgg ?? "count"} of ${card.meta(card.config.sizeColumn)?.name ?? "the size column"}` : "rows"}${colorPart} · scroll to zoom · drag to pan · double-click resets`;
    if (time !== "") {
      card.font(ctx, ui, 13, "600");
      const width = ctx.measureText(time).width;
      ctx.fillStyle = frame.text;
      ctx.globalAlpha = 0.1;
      ctx.fillRect(frame.left + 8 * ui, frame.top + 8 * ui, width + 12 * ui, 22 * ui);
      ctx.globalAlpha = 1;
      ctx.fillStyle = frame.text;
      ctx.fillText(time, frame.left + 14 * ui, frame.top + 24 * ui);
    }
  }
}

export function syncDotControls(card: ChartCard, mapKind: boolean, scatterKind = false): void {
  const heat = card.config.mapMode === "heat" || card.config.mapMode === "regions";
  card.dotSettings.classList.toggle("hidden", (!mapKind && !scatterKind) || (mapKind && heat));
  card.fitWrap.classList.toggle("hidden", !scatterKind);
  card.dotShapeSelect.value = card.config.markerShape ?? "circle";
  if (scatterKind) {
    // A scatter: one shape, size and opacity for every dot. The size is only the person's to set when no column sizes the dots.
    const sized = card.config.sizeColumn >= 0;
    card.dotMaxWrap.classList.add("hidden");
    card.dotValuesWrap.classList.add("hidden");
    card.dotScaleWrap.classList.add("hidden");
    card.mapColorAggWrap.classList.add("hidden");
    card.mapColorScaleWrap.classList.add("hidden");
    card.mapLabelWrap.classList.add("hidden");
    card.dotMinLabel.textContent = "Dot radius";
    card.dotMinInput.disabled = sized;
    card.dotMinInput.title = sized ? "The dots are sized by the Size column" : "Radius in pixels of every dot";
    if (document.activeElement !== card.dotMinInput) card.dotMinInput.value = String(card.config.dotMinRadius ?? 2.2);
    const opacity = Math.round((card.config.dotOpacity ?? 0.55) * 100);
    card.dotOpacityInput.value = String(opacity);
    card.dotOpacityOut.textContent = `${opacity}%`;
    card.fitLineInput.checked = card.config.fitLine ?? true;
    card.fitR2Input.checked = card.config.fitR2 ?? true;
    card.fitR2Input.disabled = !card.fitLineInput.checked;
    return;
  }
  card.dotMinInput.disabled = false;
  if (!mapKind || heat) return;
  const sized = card.dotsAreSized();
  const defaults = card.dotDefaults();
  card.dotMaxWrap.classList.toggle("hidden", !sized);
  card.dotValuesWrap.classList.toggle("hidden", !sized);
  card.dotScaleWrap.classList.toggle("hidden", !sized);
  card.dotMinLabel.textContent = sized ? "Radius" : "Dot radius";
  const set = (input: HTMLInputElement, value: number | null | undefined): void => {
    if (document.activeElement !== input) input.value = value === null || value === undefined ? "" : String(value);
  };
  set(card.dotMinInput, card.config.dotMinRadius ?? defaults.min);
  set(card.dotMaxInput, card.config.dotMaxRadius ?? defaults.max);
  set(card.dotValueMinInput, card.config.dotValueMin);
  set(card.dotValueMaxInput, card.config.dotValueMax);
  card.dotScaleSelect.value = card.config.dotScale ?? "linear";
  const opacity = Math.round((card.config.dotOpacity ?? 0.6) * 100);
  card.dotOpacityInput.value = String(opacity);
  card.dotOpacityOut.textContent = `${opacity}%`;
  // A place holds many rows: a number combines into one colour, a category does not.
  const places = (card.config.mapMode ?? DEFAULT_MAP_MODE) === "places";
  for (const option of card.colorSelect.options) {
    const meta = card.meta(Number(option.value));
    option.disabled = places && meta !== undefined && !isNumericType(meta.type);
  }
  card.colorWrap.title = places ? "A number combines into one colour for each place; a category needs One dot per row" : "";
  card.mapColorAggSelect.value = card.config.mapColorAgg ?? "mean";
  card.mapColorAggWrap.classList.toggle("hidden", !places || card.config.colorColumn < 0);
  const numericColour = isNumericType(card.meta(card.config.colorColumn)?.type ?? "string");
  card.mapColorScaleWrap.classList.toggle("hidden", !numericColour);
  card.mapColorScaleSelect.value = card.config.mapColorScale ?? "linear";
  card.mapLabelWrap.classList.toggle("hidden", !places);
  const named = card.mapLabelColumn();
  card.mapLabelSelect.replaceChildren(card.option("-1", "None"));
  card.columns.forEach((meta, index) => {
    if (!isNumericType(meta.type)) card.mapLabelSelect.append(card.option(String(index), meta.name));
  });
  card.mapLabelSelect.value = String(named);
}

/**
 * The column naming a place: the one chosen, else a name-like text column, preferring one that shares a word with the
 * coordinates, so "start station latitude" is named by "start station name" and not "end station name".
 */
export function mapLabelColumn(card: ChartCard): number {
  const chosen = card.config.mapLabelColumn;
  if (chosen !== undefined) return chosen >= 0 && chosen < card.columns.length ? chosen : -1;
  const words = new Set((card.meta(card.config.y)?.name ?? "").toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 2 && !/^lat/.test(word)));
  let best = -1;
  let bestScore = 0;
  card.columns.forEach((meta, index) => {
    if (isNumericType(meta.type) || !/name|station|city|place|site|location|address|store|branch|suburb|town|venue/i.test(meta.name)) return;
    const shared = meta.name.toLowerCase().split(/[^a-z0-9]+/).filter((word) => words.has(word)).length;
    const score = 1 + shared * 2 + (/name/i.test(meta.name) ? 1 : 0);
    if (score > bestScore) {
      best = index;
      bestScore = score;
    }
  });
  return best;
}

/** One hoverable dot: what it is called and what it holds. */
export function mapDotLines(card: ChartCard, result: SeriesPoints, index: number, lon: number, lat: number): string[] {
  const stepping = card.animationResult?.places !== undefined && result.places === true && card.framePlaces !== null && card.animationResult.places.shown >= result.shown && card.placeFrameActive();
  const placeIndex = stepping ? (card.framePlaces?.[index] ?? index) : index;
  const name = stepping ? card.animationResult?.places?.labels?.[placeIndex] : card.placeLabels?.[placeIndex];
  const lines = [name !== undefined && name !== "" ? name : `${lat.toFixed(5)}, ${lon.toFixed(5)}`];
  if (stepping) lines.push(card.animationResult?.frames[Math.min(card.animationFrame, card.animationResult.frames.length - 1)]?.label ?? "");
  const rows = result.counts?.[index];
  if (rows !== undefined) lines.push(`Rows: ${rows.toLocaleString()}`);
  const sizeMeta = card.meta(card.config.sizeColumn);
  if (sizeMeta !== undefined && result.size !== null) lines.push(`${sizeMeta.name}: ${formatChartNumber(result.size[index]!)}`);
  const colorMeta = card.meta(card.config.colorColumn);
  if (colorMeta !== undefined) {
    const colorValue = result.colorValues?.[index];
    const code = result.colorCodes?.[index];
    const agg = result.places === true ? `${MAP_COLOR_AGG_NAMES[card.config.mapColorAgg ?? "mean"]} ` : "";
    if (colorValue !== undefined) lines.push(`${agg}${colorMeta.name}: ${formatChartNumber(colorValue)}`);
    else if (code !== undefined) lines.push(`${colorMeta.name}: ${card.seriesLabels?.[code] ?? ""}`);
  }
  return lines;
}

/** What the two sizes of dot mean, in the corner of the map. Returns how much height it took. */
export function drawMapSizeLegend(card: ChartCard, ctx: CanvasRenderingContext2D, frame: Frame, result: SeriesPoints): number {
  if (result.size === null || !card.dotsAreSized()) return 0;
  const fixed = card.placeFrameActive() ? (card.animationResult?.places?.sizeRange ?? null) : null;
  const range = fixed ?? dataRange(result.size, result.shown);
  if (range === null) return 0;
  const ui = frame.ui;
  const defaults = card.dotDefaults();
  const small = Math.max(0.5, card.config.dotMinRadius ?? defaults.min) * ui;
  const large = Math.max(small / ui, card.config.dotMaxRadius ?? defaults.max) * ui;
  const low = formatCompact(card.config.dotValueMin ?? range.min);
  const high = formatCompact(card.config.dotValueMax ?? range.max);
  const sizeMeta = card.meta(card.config.sizeColumn);
  const title = sizeMeta === undefined ? "Rows" : sizeMeta.name;
  card.font(ctx, ui, 9);
  const inner = Math.max(ctx.measureText(title).width, small * 2 + large * 2 + ctx.measureText(low).width + ctx.measureText(high).width + 22 * ui);
  const boxW = inner + 12 * ui;
  const boxH = Math.max(large * 2, 12 * ui) + 26 * ui;
  const x = frame.left + frame.plotW - boxW - 6 * ui;
  const y = frame.top + frame.plotH - boxH - 6 * ui;
  ctx.fillStyle = card.plateColor();
  ctx.globalAlpha = 0.9;
  ctx.fillRect(x, y, boxW, boxH);
  ctx.globalAlpha = 1;
  ctx.fillStyle = frame.dim;
  ctx.fillText(card.fit(ctx, title, inner), x + 6 * ui, y + 12 * ui);
  const cy = y + 18 * ui + Math.max(large, 6 * ui);
  const color = card.primaryColor();
  const dot = (cx: number, r: number): void => {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.6;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = darkerColor(color);
    ctx.lineWidth = 1;
    ctx.stroke();
  };
  let at = x + 6 * ui;
  dot(at + small, small);
  at += small * 2 + 3 * ui;
  ctx.fillStyle = frame.dim;
  ctx.fillText(low, at, cy + 3 * ui);
  at += ctx.measureText(low).width + 8 * ui;
  dot(at + large, large);
  at += large * 2 + 3 * ui;
  ctx.fillStyle = frame.dim;
  ctx.fillText(high, at, cy + 3 * ui);
  return boxH + 6 * ui;
}

/** Radii for the map's dots from the Dots row; null when every dot is one size. */
export function mapRadii(card: ChartCard, result: SeriesPoints, ui: number): Float64Array | null {
  if (result.size === null || !card.dotsAreSized()) return null;
  const defaults = card.dotDefaults();
  // While stepping through time one size means one value in every frame.
  const fixed = card.placeFrame() === null ? null : (card.animationResult?.places?.sizeRange ?? null);
  const range = fixed ?? dataRange(result.size, result.shown);
  if (range !== null) {
    card.dotValueMinInput.placeholder = `auto: ${formatChartNumber(range.min)}`;
    card.dotValueMaxInput.placeholder = `auto: ${formatChartNumber(range.max)}`;
  }
  return dotRadii(
    result.size,
    result.shown,
    {
      minRadius: card.config.dotMinRadius ?? defaults.min,
      maxRadius: card.config.dotMaxRadius ?? defaults.max,
      valueMin: card.config.dotValueMin ?? fixed?.min ?? null,
      valueMax: card.config.dotValueMax ?? fixed?.max ?? null,
      scale: card.config.dotScale ?? "linear",
    },
    ui,
  );
}

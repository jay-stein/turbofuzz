/**
 * Small multiples for any chart, the way seaborn's FacetGrid does it: one panel per value of a
 * category column, each the same chart restricted to that value, on shared axes so the panels
 * compare at a glance.
 *
 * Each panel is a hidden copy of the card with its chart filter set to one value. The copy
 * fetches its own data through the card's ordinary requests and is drawn into one cell of the
 * card's canvas. A scatter in points mode keeps its own faster path (chart-draw-points.ts), where
 * one request returns every panel's points at once.
 */
import type { ChartCard } from "./chart-card.js";
import type { ChartCardKind } from "./chart-utils.js";
import { allCategoryBars } from "./chart-draw-bars.js";
import { isGroupable } from "./chart-utils.js";
import { panelGrid } from "./chart-extra.js";
import type { Frame } from "./chart-card-types.js";
import type { HitRegion } from "./chart-hit-regions.js";

/** Chart types that split into panels by drawing a filtered copy per value. */
const PANEL_KINDS: readonly ChartCardKind[] = ["bar", "barplot", "histogram", "line", "box", "density", "scatter", "dotplot", "stacked100"];

/** Each panel is its own set of requests: more values than this are named in the note instead. */
export const PANEL_LIMIT = 12;

interface PanelSet {
  signature: string;
  facets: Record<number, number[]> | null;
  children: ChartCard[];
  codes: number[];
  /** Total values with rows, of which `codes` are the first PANEL_LIMIT. */
  valueCount: number;
  /** Set while the copies are being refreshed, so their repaint requests are not each a frame. */
  syncing: boolean;
  /** The column list the copies were built with; a new one (an edit, a reload) rebuilds them. */
  columnsRef: ChartCard["columns"];
}

const sets = new WeakMap<ChartCard, PanelSet>();

/** True when the card is split into panels by the generic path (not the scatter's own one). */
export function panelsOn(card: ChartCard): boolean {
  if (card.panelUi !== null || card.config.source !== "") return false;
  const facet = card.config.facetColumn ?? -1;
  if (facet < 0 || !PANEL_KINDS.includes(card.config.kind)) return false;
  if (card.config.kind === "scatter" && card.config.mode !== "density") return false;
  const meta = card.meta(facet);
  return meta !== undefined && isGroupable(meta);
}

/** Whether this kind of chart can be split into panels at all (for showing the setting). */
export function panelsSupported(card: ChartCard): boolean {
  return card.config.source === "" && PANEL_KINDS.includes(card.config.kind);
}

/** Count bars read live table facets; a panel has to ask for its own counts. */
function countBars(card: ChartCard): boolean {
  return (card.config.kind === "bar" || card.config.kind === "barplot") && (card.config.valueColumn ?? -1) < 0;
}

export function disposePanels(card: ChartCard): void {
  const set = sets.get(card);
  if (set === undefined) return;
  for (const child of set.children) child.dispose();
  sets.delete(card);
}

/** The values that get a panel: those with rows under the table's filters, in the column's own order. */
function panelCodes(card: ChartCard, facet: number): { codes: number[]; valueCount: number } {
  const meta = card.meta(facet);
  const labels = meta?.categories?.labels ?? [];
  const counts = card.facets[facet] ?? meta?.categories?.counts ?? [];
  const codes: number[] = [];
  for (let code = 0; code < labels.length; code++) if ((counts[code] ?? 0) > 0) codes.push(code);
  return { codes: codes.slice(0, PANEL_LIMIT), valueCount: codes.length };
}

function ensurePanels(card: ChartCard): PanelSet {
  const facet = card.config.facetColumn ?? -1;
  const { codes, valueCount } = panelCodes(card, facet);
  const config = card.getConfig();
  const signature = JSON.stringify({ ...config, title: "", span: undefined, codes, columns: card.columns.length });
  let set = sets.get(card);
  if (set !== undefined && set.signature === signature && set.columnsRef === card.columns) {
    if (set.facets !== card.facets) refreshPanels(card, set);
    return set;
  }
  disposePanels(card);
  const Card = card.constructor as new (root: HTMLElement, options: ChartCard["options"], preset: Partial<ChartCard["config"]>) => ChartCard;
  const automatic = card.meta(card.config.column)?.histogram ?? null;
  const fresh: PanelSet = { signature, facets: null, children: [], codes, valueCount, syncing: true, columnsRef: card.columns };
  sets.set(card, fresh);
  for (const code of codes) {
    const child = new Card(
      document.createElement("div"),
      {
        ...card.options,
        docked: false,
        sectionedSettings: false,
        onTitleChange: undefined,
        onHighlight: undefined,
        panelHost: () => {
          if (!fresh.syncing) card.scheduleRender(true);
        },
      },
      {
        ...config,
        title: "",
        facetColumn: -1,
        filterColumn: facet,
        filterCode: code,
        // A Bar with no value is a count of rows: the panel draws it as one.
        ...(countBars(card) ? { kind: "bar" as const } : {}),
        // The automatic histogram is the whole table's: a panel bins its own rows over the same range.
        ...(config.kind === "histogram" && config.binOptions === null && automatic !== null
          ? { binOptions: { min: automatic.min, max: automatic.max, binCount: automatic.bins.length, overflow: false } }
          : {}),
      },
    );
    child.panelUi = 1;
    // Only the column list: filling the copy's (never shown) settings controls would cost a few ms a panel.
    child.columns = card.columns;
    fresh.children.push(child);
  }
  fresh.syncing = false;
  refreshPanels(card, fresh);
  return fresh;
}

/** New table results: every panel fetches its own again. */
function refreshPanels(card: ChartCard, set: PanelSet): void {
  set.facets = card.facets;
  set.syncing = true;
  const column = card.config.column;
  for (const child of set.children) {
    child.panelShared = null;
    const facets = countBars(card) ? { ...card.facets, [column]: child.facets[column] ?? [] } : card.facets;
    child.setFiltered(facets, card.histograms);
  }
  set.syncing = false;
  if (countBars(card)) requestPanelCounts(card, set);
}

/** One request for every panel's category counts (rows by bar value and panel value). */
function requestPanelCounts(card: ChartCard, set: PanelSet): void {
  const facet = card.config.facetColumn ?? -1;
  const column = card.config.column;
  const labels = card.meta(column)?.categories?.labels ?? [];
  const panelLabels = card.meta(facet)?.categories?.labels ?? [];
  const facets = set.facets;
  void card.options
    .requestAggregate({
      id: "card-panels",
      name: "panels",
      dimensions: [
        { column, by: "value" },
        { column: facet, by: "value" },
      ],
      measures: [{ column: null, agg: "count" }],
      fill: "none",
      sort: { key: "m0", dir: "desc" },
      limit: 50000,
      respectFilters: card.config.respectFilters !== false,
      ...(card.excludes().length > 0 ? { exclude: card.excludes() } : {}),
    })
    .then((message) => {
      if (sets.get(card) !== set || set.facets !== facets || card.disposed) return;
      const index = new Map(labels.map((label, i) => [label, i]));
      const byPanel = new Map<string, number[]>();
      const values = message.measures[0];
      for (let i = 0; i < message.groupCount; i++) {
        const at = index.get(message.dimensions[0]?.[i] ?? "");
        if (at === undefined) continue;
        const panel = message.dimensions[1]?.[i] ?? "";
        let counts = byPanel.get(panel);
        if (counts === undefined) byPanel.set(panel, (counts = new Array<number>(labels.length).fill(0)));
        counts[at] = values?.[i] ?? 0;
      }
      set.children.forEach((child, i) => {
        const counts = byPanel.get(panelLabels[set.codes[i]!] ?? "") ?? new Array<number>(labels.length).fill(0);
        child.facets = { ...child.facets, [column]: counts };
      });
      card.scheduleRender(true);
    })
    .catch(() => {
      // The panels keep their last counts.
    });
}

/** Bars keep the whole chart's order in every panel, so the same bar sits in the same place. */
function sharedOrder(card: ChartCard): Map<string, number> | null {
  const labels = countBars(card)
    ? allCategoryBars(card).map((bar) => bar.label)
    : (() => {
        const result = card.aggregateResult();
        return result !== null && result.dimensions.length === 1 && result.dimensionIsTime[0] !== true ? result.labels : null;
      })();
  return labels === null ? null : new Map(labels.map((label, i) => [label, i]));
}

/**
 * Draws the panels into the area under the card's title. Each copy draws itself at a small
 * text scale; a second pass puts them on one value axis once every panel's own top is known.
 */
export function drawPanelGrid(card: ChartCard, ctx: CanvasRenderingContext2D, frame: Frame, width: number, height: number, top: number): void {
  const set = ensurePanels(card);
  const facet = card.config.facetColumn ?? -1;
  const panelName = card.meta(facet)?.name ?? "panel";
  const labels = card.meta(facet)?.categories?.labels ?? [];
  const counts = card.facets[facet] ?? card.meta(facet)?.categories?.counts ?? [];
  const ui = frame.ui;
  if (set.children.length === 0) {
    card.drawPlotMessage(ctx, frame, `No ${panelName} values have rows to split into panels.`);
    return;
  }
  const axisRoom = 16 * ui;
  const area = { x: axisRoom, y: top, w: width - axisRoom - 4 * ui, h: height - top - axisRoom };
  const grid = panelGrid(set.children.length, area.w, area.h, 12 * ui);
  const panelUi = Math.max(0.72, Math.min(1, Math.min(grid.cells[0]!.w / 420, grid.cells[0]!.h / 260)));
  const shareY = card.config.kind !== "density" && !(card.config.kind === "scatter" && card.config.mode === "density");
  // The card's own result can land after the panels were built: read its order on every draw.
  const order = sharedOrder(card);
  const paint = (): void => {
    card.hitRegions = [];
    set.children.forEach((child, i) => {
      child.panelOrder = order;
      const cell = grid.cells[i]!;
      const code = set.codes[i]!;
      const label = labels[code] ?? "";
      const rows = counts[code] ?? 0;
      child.panelUi = panelUi;
      child.panelTitle = `${panelName} ${label === "" ? "(empty)" : label} · ${rows.toLocaleString()} ${rows === 1 ? "row" : "rows"}`;
      ctx.save();
      ctx.translate(area.x + cell.x, area.y + cell.y);
      ctx.beginPath();
      ctx.rect(0, 0, cell.w, cell.h);
      ctx.clip();
      child.drawChart(ctx, cell.w, cell.h, false);
      ctx.restore();
      for (const region of child.hitRegions) card.hitRegions.push(shifted(region, area.x + cell.x, area.y + cell.y, child.panelTitle, facet, code));
    });
  };
  paint();
  // The Axes settings offer what the panels' axes are.
  card.axisXKind = set.children[0]?.axisXKind ?? null;
  card.axisYUsed = set.children.some((child) => child.axisYUsed);
  card.axisXGrain = set.children[0]?.axisXGrain ?? null;
  card.axisXTickNote = set.children.find((child) => child.axisXTickNote !== "")?.axisXTickNote ?? "";
  if (shareY) {
    let highest = 0;
    let lo = Infinity;
    let hi = -Infinity;
    for (const child of set.children) {
      highest = Math.max(highest, child.panelNatural.top ?? 0);
      lo = Math.min(lo, child.panelNatural.lo ?? Infinity);
      hi = Math.max(hi, child.panelNatural.hi ?? -Infinity);
    }
    const shared = { ...(highest > 0 ? { top: highest } : {}), ...(lo < hi ? { lo, hi } : {}) };
    const same = set.children.every((child) => child.panelShared !== null && child.panelShared.top === shared.top && child.panelShared.lo === shared.lo && child.panelShared.hi === shared.hi);
    if (!same) {
      for (const child of set.children) child.panelShared = shared;
      ctx.clearRect(area.x - 1, area.y - 1, area.w + 2, area.h + 2);
      paint();
    }
  }
  // The axis names once for the whole grid, not once per panel.
  const names = card.axisLabels();
  card.font(ctx, ui, 11);
  ctx.fillStyle = frame.dim;
  if ((names.x ?? "") !== "") {
    ctx.textAlign = "center";
    ctx.fillText(card.fit(ctx, names.x ?? "", area.w), area.x + area.w / 2, height - 3 * ui);
    ctx.textAlign = "left";
  }
  if ((names.y ?? "") !== "") {
    ctx.save();
    ctx.translate(11 * ui, area.y + area.h / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = "center";
    ctx.fillText(card.fit(ctx, names.y ?? "", area.h), 0, 0);
    ctx.restore();
  }
  const notes = [`${set.children.length} panels by ${panelName}${shareY ? ", on one value axis" : ", each on its own scale"}`];
  if (set.valueCount > set.children.length) notes.push(`first ${set.children.length} of ${set.valueCount} values shown`);
  if ((card.config.filterColumn ?? -1) >= 0) notes.push("the chart filter is set aside while split into panels");
  card.noteEl.textContent = notes.join(" · ");
  // A brush would land in one panel's coordinates: no Shift+drag while split.
  card.brushSpace = null;
}

/** A panel's mark in the card's coordinates, naming its panel and narrowing a click to it. */
function shifted(region: HitRegion, dx: number, dy: number, title: string, facet: number, code: number): HitRegion {
  const contains = region.contains;
  return {
    ...region,
    x: region.x + dx,
    y: region.y + dy,
    ...(contains === undefined ? {} : { contains: (x: number, y: number) => contains(x - dx, y - dy) }),
    lines: [title, ...region.lines],
    actions: region.actions.length === 0 ? [] : [...region.actions, { kind: "values", column: facet, code }],
  };
}

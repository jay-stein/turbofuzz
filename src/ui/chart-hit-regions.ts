/**
 * Where a chart can be clicked or hovered: the regions the plot hands the tooltip, the selection bar
 * and the filter actions. Pure geometry, no drawing, so it lives apart from the card.
 */

/** Plot-area rectangle in canvas CSS pixels, shared by hit-region builders. */

import type { BoxGroupStats } from "../data/chart-stats.js";
import type { ChartTableFilter } from "./chart-card-types.js";
import { formatChartNumber, formatCount, formatTick, type AxisFormat, type CategoryBar } from "./chart-utils.js";
export interface PlotGeometry {
  left: number;
  top: number;
  plotW: number;
  plotH: number;
}

/** A click on a region toggles a category value, sets a range or text filter. */
export type HitAction =
  | { kind: "values"; column: number; code: number }
  | { kind: "range"; column: number; min: number | null; max: number | null }
  | { kind: "text"; column: number; query: string };


export interface HitRegion {
  x: number;
  y: number;
  w: number;
  h: number;
  /** For a shape that does not fill its box: whether the point is really on it. */
  contains?: (x: number, y: number) => boolean;
  /** Tooltip lines, drawn in order. */
  lines: string[];
  /** Empty when the region is hover-only. */
  actions: HitAction[];
  /**
   * What right-clicking the region can act on, for shapes whose left click does
   * nothing (box plots). Used only when `actions` is empty.
   */
  contextActions?: HitAction[];
}


/**
 * True when the two sets of click actions touch the same slice of a column: the
 * same category, or date/number ranges that share more than an edge. Used to
 * light up, in one card, what the pointer is over in another.
 */
export function actionsOverlap(
  highlight: readonly HitAction[],
  actions: readonly HitAction[],
): boolean {
  for (const h of highlight) {
    for (const a of actions) {
      if (h.column !== a.column) continue;
      if (h.kind === "values" && a.kind === "values") {
        if (h.code === a.code) return true;
        continue;
      }
      if (h.kind !== "range" || a.kind !== "range") continue;
      const hMin = h.min ?? Number.NEGATIVE_INFINITY;
      const hMax = h.max ?? Number.POSITIVE_INFINITY;
      const aMin = a.min ?? Number.NEGATIVE_INFINITY;
      const aMax = a.max ?? Number.POSITIVE_INFINITY;
      const low = Math.max(hMin, aMin);
      const high = Math.min(hMax, aMax);
      if (low > high) continue;
      // Neighbouring bins that merely share an edge are not the same slice,
      // unless one of them is a single value.
      if (low < high || hMin === hMax || aMin === aMax) return true;
    }
  }
  return false;
}

/** Topmost region containing the point, or null. Regions are drawn in order. */
export function hitTest(
  regions: readonly HitRegion[],
  x: number,
  y: number,
): HitRegion | null {
  for (let index = regions.length - 1; index >= 0; index--) {
    const region = regions[index];
    if (
      x >= region.x &&
      x <= region.x + region.w &&
      y >= region.y &&
      y <= region.y + region.h &&
      (region.contains === undefined || region.contains(x, y))
    ) {
      return region;
    }
  }
  return null;
}

/** Convert a chart selection into ordinary table filters. */
export function tableFiltersForHitActions(
  actions: readonly HitAction[],
): ChartTableFilter[] {
  const filters: ChartTableFilter[] = [];
  for (const action of actions) {
    if (action.kind === "values") {
      filters.push({ column: action.column, filter: { kind: "values", selected: [action.code] } });
    } else if (action.kind === "range") {
      filters.push({
        column: action.column,
        filter: { kind: "range", min: action.min, max: action.max },
      });
    } else {
      filters.push({
        column: action.column,
        filter: { kind: "text", mode: "contains", query: action.query },
      });
    }
  }
  return filters;
}
export interface SeriesHitInput {
  column: number;
  bins: readonly number[];
  /** Count drawn in the extra "> max" slot (0 = no overflow slot). */
  overflow: number;
  min: number;
  max: number;
  dateAxis: boolean;
  /** Exact temporal tick format when the axis column type is known. */
  axisFormat?: AxisFormat;
}

/** One hoverable slot per histogram bin (and the overflow bar). */
export function seriesHitRegions(geom: PlotGeometry, input: SeriesHitInput): HitRegion[] {
  const { bins, overflow, min, max, column, dateAxis } = input;
  const slots = bins.length + (overflow > 0 ? 1 : 0);
  if (slots === 0) return [];
  const slotW = geom.plotW / slots;
  const step = bins.length === 0 ? 0 : (max - min) / bins.length;
  const format = (value: number): string =>
    formatTick(
      value,
      input.axisFormat ?? (dateAxis ? "line" : "histogram"),
      input.max - input.min,
    );
  const regions: HitRegion[] = [];
  for (let index = 0; index < bins.length; index++) {
    const lo = min + index * step;
    const hi = index === bins.length - 1 ? max : min + (index + 1) * step;
    regions.push({
      x: geom.left + index * slotW,
      y: geom.top,
      w: slotW,
      h: geom.plotH,
      lines: [`${format(lo)} – ${format(hi)}`, `${formatCount(bins[index])} rows`],
      actions: [{ kind: "range", column, min: lo, max: hi }],
    });
  }
  if (overflow > 0) {
    regions.push({
      x: geom.left + bins.length * slotW,
      y: geom.top,
      w: slotW,
      h: geom.plotH,
      lines: [`> ${format(max)}`, `${formatCount(overflow)} rows`],
      actions: [{ kind: "range", column, min: max, max: null }],
    });
  }
  return regions;
}

export interface GroupedSeriesHitInput {
  column: number;
  /** Visible series, in draw order, each with its per-bin counts. */
  groups: { label: string; bins: readonly number[] }[];
  min: number;
  max: number;
  axisFormat?: AxisFormat;
}

/**
 * Time-series slots for a grouped line chart: the tooltip lists the date range
 * and each visible group's count; clicking filters the date range as before.
 */
export function groupedSeriesHitRegions(
  geom: PlotGeometry,
  input: GroupedSeriesHitInput,
): HitRegion[] {
  const binCount = input.groups[0]?.bins.length ?? 0;
  if (binCount === 0 || input.groups.length === 0) return [];
  const slotW = geom.plotW / binCount;
  const step = (input.max - input.min) / binCount;
  const format = (value: number): string =>
    formatTick(value, input.axisFormat ?? "line", input.max - input.min);
  const regions: HitRegion[] = [];
  for (let index = 0; index < binCount; index++) {
    const lo = input.min + index * step;
    const hi = index === binCount - 1 ? input.max : input.min + (index + 1) * step;
    const lines = [`${format(lo)} – ${format(hi)}`];
    for (const group of input.groups) {
      const count = group.bins[index] ?? 0;
      if (count > 0) lines.push(`${group.label}: ${formatCount(count)}`);
    }
    regions.push({
      x: geom.left + index * slotW,
      y: geom.top,
      w: slotW,
      h: geom.plotH,
      lines,
      actions: [{ kind: "range", column: input.column, min: lo, max: hi }],
    });
  }
  return regions;
}

/** One hoverable slot per bar; "Other" bars are hover-only. */
export function barHitRegions(
  geom: PlotGeometry,
  bars: readonly CategoryBar[],
  codes: readonly number[],
  column: number,
): HitRegion[] {
  if (bars.length === 0) return [];
  const slotW = geom.plotW / bars.length;
  return bars.map((bar, index) => {
    const code = codes[index] ?? -1;
    return {
      x: geom.left + index * slotW,
      y: geom.top,
      w: slotW,
      h: geom.plotH,
      lines: [
        bar.label === "" ? "(blank)" : bar.label,
        `${formatCount(bar.count)} rows · ${bar.pct.toFixed(1)}%`,
      ],
      actions: bar.other === true || code < 0 ? [] : [{ kind: "values", column, code }],
    };
  });
}

export interface HeatmapHitInput {
  xLabels: readonly string[];
  yLabels: readonly string[];
  counts: ArrayLike<number>;
  total: number;
  xColumn: number;
  yColumn: number;
  /** Category code for a label, or -1 when it is the grouped "Other" bucket. */
  codeOfX: (label: string) => number;
  codeOfY: (label: string) => number;
}

/** One hoverable cell per heatmap cell; both categories toggle on click. */
export function heatmapHitRegions(geom: PlotGeometry, input: HeatmapHitInput): HitRegion[] {
  const xCount = input.xLabels.length;
  const yCount = input.yLabels.length;
  if (xCount === 0 || yCount === 0) return [];
  const cellW = geom.plotW / xCount;
  const cellH = geom.plotH / yCount;
  const regions: HitRegion[] = [];
  for (let row = 0; row < yCount; row++) {
    for (let column = 0; column < xCount; column++) {
      const count = input.counts[row * xCount + column] ?? 0;
      const pct = input.total > 0 ? (count / input.total) * 100 : 0;
      const xLabel = input.xLabels[column];
      const yLabel = input.yLabels[row];
      const actions: HitAction[] = [];
      const xCode = input.codeOfX(xLabel);
      const yCode = input.codeOfY(yLabel);
      if (xCode >= 0) actions.push({ kind: "values", column: input.xColumn, code: xCode });
      if (yCode >= 0) actions.push({ kind: "values", column: input.yColumn, code: yCode });
      regions.push({
        x: geom.left + column * cellW,
        y: geom.top + row * cellH,
        w: cellW,
        h: cellH,
        lines: [`${xLabel} × ${yLabel}`, `${formatCount(count)} rows · ${pct.toFixed(1)}%`],
        actions,
      });
    }
  }
  return regions;
}

/** Five-number summaries; hover-only. */
export function boxHitRegions(
  geom: PlotGeometry,
  groups: readonly BoxGroupStats[],
  slotCount = groups.length,
): HitRegion[] {
  if (groups.length === 0 || slotCount <= 0) return [];
  const slot = geom.plotW / slotCount;
  return groups.map((group, index) => ({
    x: geom.left + index * slot,
    y: geom.top,
    w: slot,
    h: geom.plotH,
    lines: [
      group.label === "" ? "(blank)" : group.label,
      `min ${formatChartNumber(group.min)}`,
      `q1 ${formatChartNumber(group.q1)}`,
      `median ${formatChartNumber(group.median)}`,
      `q3 ${formatChartNumber(group.q3)}`,
      `max ${formatChartNumber(group.max)}`,
      `${formatCount(group.count)} values`,
    ],
    actions: [],
  }));
}

export interface CorrelationHitInput {
  labels: readonly string[];
  values: ArrayLike<number>;
  counts: ArrayLike<number>;
}

/**
 * One hoverable cell per correlation pair; hover-only. A correlation is the same both ways round and a column with itself is
 * always 1, so only the lower triangle is drawn: n columns make an (n - 1) by (n - 1) staircase, row i holding column i + 1
 * against each column before it.
 */
export function correlationHitRegions(
  geom: PlotGeometry,
  input: CorrelationHitInput,
): HitRegion[] {
  const n = input.labels.length;
  if (n < 2) return [];
  const m = n - 1;
  const sizeX = geom.plotW / m;
  const sizeY = geom.plotH / m;
  const regions: HitRegion[] = [];
  for (let row = 0; row < m; row++) {
    for (let column = 0; column <= row; column++) {
      const index = (row + 1) * n + column;
      const r = input.values[index];
      regions.push({
        x: geom.left + column * sizeX,
        y: geom.top + row * sizeY,
        w: sizeX,
        h: sizeY,
        lines: [
          `${input.labels[row + 1]} × ${input.labels[column]}`,
          Number.isFinite(r) ? `r = ${r.toFixed(2)}` : "r = —",
          `n = ${formatCount(input.counts[index] ?? 0)}`,
        ],
        actions: [],
      });
    }
  }
  return regions;
}

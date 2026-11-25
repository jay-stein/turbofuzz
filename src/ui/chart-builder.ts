import type { TimeGrain } from "../data/aggregate.js";
import type { ColumnMeta } from "../worker/protocol.js";
import { DEFAULT_PALETTE } from "../data/palettes.js";
import type { ChartCardConfig } from "./chart-card-types.js";
import { fitChartKind } from "./chart-gallery.js";
import { aggFor } from "./chart-names.js";
import { profile, type RecProfile } from "./chart-recommender.js";
import { CHART_COLORS, DEFAULT_MAP_MODE, toRecColumn, type ChartCardKind } from "./chart-utils.js";

/** Fresh defaults for every chart entry point: add, edit, duplicate, reset. */
export function defaultChartConfig(): ChartCardConfig {
  return {
    kind: "histogram",
    source: "",
    column: -1,
    x: -1,
    y: -1,
    colorColumn: -1,
    sizeColumn: -1,
    mode: "points",
    densityStyle: "both",
    kde: true,
    color: CHART_COLORS[0],
    multiColor: true,
    palette: DEFAULT_PALETTE,
    paletteCustom: "",
    paletteReversed: false,
    colorMin: null,
    colorMax: null,
    colorCenter: null,
    topN: 10,
    groupOther: true,
    barLayout: "group",
    binOptions: null,
    binClipped: false,
    title: "",
    groupColumn: -1,
    bubbleBins: 40,
    bubbleAgg: "count",
    bubbleScale: "area",
    mapMode: DEFAULT_MAP_MODE,
    span: "auto",
    animationTimeColumn: -1,
    animationGrain: "day",
    animationSpeed: 1,
    suggested: "",
    correlationColumns: [],
    filterColumn: -1,
    filterCode: -1,
    respectFilters: true,
  };
}

/** Merge a partial preset onto the one shared default config. */
export function chartConfigWithDefaults(
  preset: Partial<ChartCardConfig> = {},
): ChartCardConfig {
  const config = { ...defaultChartConfig(), ...preset };
  // Older treemap configs stored their sum-only measure in sizeColumn; the
  // treemap now uses the shared valueColumn/valueAgg measure model.
  if (
    config.kind === "treemap" &&
    config.valueColumn === undefined &&
    config.sizeColumn >= 0
  ) {
    config.valueColumn = config.sizeColumn;
    config.valueAgg = "sum";
    config.sizeColumn = -1;
  }
  return config;
}

/**
 * Suggested reset for an existing card. The chart kind and user-owned frame
 * (source, title, width, table-filter scope) survive; kind-specific fields are
 * rebuilt from the same fit policy used by the gallery.
 */
export function suggestedChartConfig(
  config: ChartCardConfig,
  columns: readonly ColumnMeta[],
  rowCount: number,
): ChartCardConfig | null {
  const fit = fitChartKind(config.kind, columns, rowCount);
  if (!fit.ok) return null;
  return chartConfigWithDefaults({
    ...fit.preset,
    kind: config.kind,
    source: config.source,
    title: config.title,
    span: config.span,
    respectFilters: config.respectFilters,
    suggested: "",
  });
}

/** The next finer grain used by the drill action. */
export function nextFinerGrain(grain: TimeGrain | "auto" | undefined): TimeGrain | null {
  const order: TimeGrain[] = [
    "second",
    "minute",
    "hour",
    "day",
    "week",
    "month",
    "quarter",
    "year",
  ];
  if (grain === undefined || grain === "auto") return "day";
  const index = order.indexOf(grain);
  return index > 0 ? order[index - 1] : null;
}
export type ValueAgg = NonNullable<ChartCardConfig["valueAgg"]>;

/** One field the user put on the builder shelf. */
export interface BuilderPick {
  index: number;
  /** Aggregation chip for a measure; defaults to the name-based choice. */
  agg?: ValueAgg;
}

/** Recommender chart ids that map to one of the card's own kinds. */
const RECOMMENDED_KIND: Record<string, ChartCardKind> = {
  timeseries: "line",
  countplot: "bar",
  topterms: "terms",
  boxplot: "box",
  histogram: "histogram",
  barplot: "barplot",
  treemap: "treemap",
  heatmap: "heatmap",
  scatter: "scatter",
  density: "density",
  bubble: "bubble",
  correlation: "correlation",
  kpi: "kpi",
  map: "map",
  dotplot: "dotplot",
  stacked100: "stacked100",
  smallmultiples: "smallmultiples",
  slopegraph: "slopegraph",
  waterfall: "waterfall",
};

export function kindForRecommended(chart: string): ChartCardKind | null {
  return RECOMMENDED_KIND[chart] ?? null;
}

/**
 * Fill a chart kind's slots from the shelf, by role. The same builder serves
 * a recommended tile and an explicit type choice; slots the shelf leaves empty
 * fall back to the gallery's own fit. Null when the data cannot support the kind.
 */
export function configForChart(
  kind: ChartCardKind,
  picks: readonly BuilderPick[],
  columns: readonly ColumnMeta[],
  rowCount: number,
  options: { strict?: boolean } = {},
): Partial<ChartCardConfig> | null {
  const fit = fitChartKind(kind, columns, rowCount);
  if (!fit.ok) return null;
  type Entry = { pick: BuilderPick; p: RecProfile };
  const entries: Entry[] = picks.map((pick) => ({
    pick,
    p: profile(toRecColumn(columns[pick.index], pick.index, rowCount), rowCount),
  }));
  const usable = entries.filter((e) => e.p.role !== "id");
  const times = usable.filter((e) => e.p.role === "time");
  const cats = usable.filter((e) => e.p.role.startsWith("cat") && e.p.canMeasure !== true);
  const lowNumbers = usable.filter((e) => e.p.canMeasure === true);
  const measures = [...usable.filter((e) => e.p.role === "measure"), ...lowNumbers];
  const catsAll = [...cats, ...lowNumbers];
  const texts = usable.filter((e) => e.p.role === "text");
  const agg = (e: Entry): ValueAgg => e.pick.agg ?? aggFor(columns[e.pick.index].name);
  const set: Partial<ChartCardConfig> = {};
  const [m0, m1, m2] = measures;
  const [c0, c1] = catsAll;
  const [t0] = times;
  switch (kind) {
    case "histogram":
      if (m0) set.column = m0.pick.index;
      // A category splits the values into one histogram per group.
      if (cats[0]) set.groupColumn = cats[0].pick.index;
      break;
    case "line":
      if (!t0) {
        // No date: a seaborn-style line of a value over an ordered x, a number or a category.
        const x = c0 ?? m1 ?? m0;
        const y = [m0, m1].find((entry) => entry !== undefined && entry !== x);
        if (x) set.column = x.pick.index;
        if (y) Object.assign(set, { valueColumn: y.pick.index, valueAgg: agg(y) });
        const hue = catsAll.find((entry) => entry !== x && entry !== y);
        if (hue) set.groupColumn = hue.pick.index;
        break;
      }
      set.column = t0.pick.index;
      if (m0) Object.assign(set, { valueColumn: m0.pick.index, valueAgg: agg(m0) });
      if (cats[0]) set.groupColumn = cats[0].pick.index;
      // Several measures and no category: one line each.
      else if (m0 && measures.length > 1) set.extraValueColumns = measures.slice(1, 6).map((entry) => entry.pick.index);
      break;
    case "bar":
      if (c0) set.column = c0.pick.index;
      if (c1) set.groupColumn = c1.pick.index;
      break;
    case "barplot": {
      // Bars over a date (by month, by weekday) split by a category, or a category split by another.
      const across = t0 ?? c0;
      const split = t0 ? c0 : c1;
      if (across) set.column = across.pick.index;
      const value = measures.find((entry) => entry !== across && entry !== split);
      if (value) Object.assign(set, { valueColumn: value.pick.index, valueAgg: agg(value) });
      // Fields picked and none of them a number: the bars count rows, never average a column nobody picked.
      else if (picks.length > 0) set.valueColumn = -1;
      if (split && split !== value) set.groupColumn = split.pick.index;
      // Several measures and no split: one bar each.
      else if (value) {
        const more = measures.filter((entry) => entry !== value && entry !== across);
        if (more.length > 0) set.extraValueColumns = more.slice(0, 5).map((entry) => entry.pick.index);
      }
      break;
    }
    case "treemap":
      if (c0) set.column = c0.pick.index;
      if (m0 && m0 !== c0) Object.assign(set, { valueColumn: m0.pick.index, valueAgg: agg(m0) });
      break;
    case "box":
      if (m0) set.x = m0.pick.index;
      if (c0 && c0 !== m0) set.y = c0.pick.index;
      break;
    case "heatmap":
      if (c0) set.x = c0.pick.index;
      if (c1) set.y = c1.pick.index;
      break;
    case "scatter":
    case "density":
    case "bubble":
      if (m0) set.x = m0.pick.index;
      if (m1) set.y = m1.pick.index;
      // One number picked: Y borrows another number, never a date nobody picked.
      else if (m0) {
        const numberAt = (strict: boolean) =>
          columns.findIndex((meta, index) => {
            const p = profile(toRecColumn(meta, index, rowCount), rowCount);
            return index !== m0.pick.index && (p.role === "measure" || (!strict && p.canMeasure === true));
          });
        const borrowed = numberAt(true) >= 0 ? numberAt(true) : numberAt(false);
        if (borrowed >= 0) set.y = borrowed;
        else {
          // No other number: the picked one over a date, time across and values up.
          const when = columns.findIndex((meta, index) => profile(toRecColumn(meta, index, rowCount), rowCount).role === "time");
          if (when >= 0) Object.assign(set, { x: when, y: m0.pick.index });
        }
      }
      if (kind === "bubble" && m2) set.sizeColumn = m2.pick.index;
      // A category colours the points.
      if (kind !== "density" && (cats[0] ?? t0)) set.colorColumn = (cats[0] ?? t0)!.pick.index;
      else {
        if (kind === "scatter" && m2) set.sizeColumn = m2.pick.index;
        // Nothing picked colours the points: one colour, not a column nobody picked.
        if (picks.length > 0) set.colorColumn = -1;
      }
      break;
    case "correlation":
      if (measures.length >= 2) set.correlationColumns = measures.map((e) => e.pick.index);
      break;
    case "kpi":
      if (m0) Object.assign(set, { column: m0.pick.index, valueColumn: m0.pick.index, valueAgg: agg(m0) });
      break;
    case "dotplot":
    case "waterfall": {
      const steps = kind === "waterfall" ? (c0 ?? t0) : c0;
      if (steps) set.column = steps.pick.index;
      if (m0 && m0 !== steps) Object.assign(set, { valueColumn: m0.pick.index, valueAgg: agg(m0) });
      break;
    }
    case "stacked100":
      if (c0) set.column = c0.pick.index;
      if (c1) set.groupColumn = c1.pick.index;
      if (m0 && m0 !== c0 && m0 !== c1) Object.assign(set, { valueColumn: m0.pick.index, valueAgg: agg(m0) });
      break;
    case "smallmultiples":
      if (t0) set.column = t0.pick.index;
      if (cats[0] ?? c0) set.groupColumn = (cats[0] ?? c0).pick.index;
      if (m0) Object.assign(set, { valueColumn: m0.pick.index, valueAgg: agg(m0) });
      break;
    case "slopegraph": {
      // The point column is a date when there is one; otherwise the first category.
      const point = t0 ?? c0;
      const lines = catsAll.find((e) => e !== point);
      if (point) set.column = point.pick.index;
      if (lines) set.groupColumn = lines.pick.index;
      if (m0 && m0 !== point && m0 !== lines) Object.assign(set, { valueColumn: m0.pick.index, valueAgg: agg(m0) });
      break;
    }
    case "terms":
      if (texts[0]) set.column = texts[0].pick.index;
      break;
    default:
      break;
  }
  // A recommended tile must come from the shelf alone; a type chosen by hand may
  // fall back to the gallery's default columns for any slot the shelf leaves empty.
  // Fields were picked and none of them has a place on this type: say so, rather than draw other
  // columns the analyst never picked (the picks would seem to vanish).
  const placed = new Set<number>(
    [set.column, set.x, set.y, set.valueColumn, set.groupColumn, set.colorColumn, set.sizeColumn, ...(set.correlationColumns ?? []), ...(set.extraValueColumns ?? [])].filter(
      (index): index is number => index !== undefined && index >= 0,
    ),
  );
  if (picks.length > 0 && !picks.some((pick) => placed.has(pick.index))) return null;
  // A text field picked to lay the bars out by (5,000 customers: too many to group) and nothing
  // picked that can: say so, rather than lay them out by a category nobody picked.
  const laidOut = kind === "bar" || kind === "barplot" || kind === "treemap" || kind === "dotplot" || kind === "waterfall" || kind === "stacked100";
  if (laidOut && set.column === undefined && texts.length > 0) return null;
  if (options.strict === true && (kind === "stacked100" || kind === "dotplot" || kind === "waterfall" || kind === "smallmultiples" || kind === "slopegraph")) {
    if (set.valueColumn === undefined || set.column === undefined) return null;
    if ((kind === "stacked100" || kind === "smallmultiples" || kind === "slopegraph") && set.groupColumn === undefined) return null;
  }
  return { ...fit.preset, ...set, kind };
}

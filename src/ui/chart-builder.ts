import type { TimeGrain } from "../data/aggregate.js";
import type { ColumnMeta } from "../worker/protocol.js";
import { DEFAULT_PALETTE } from "../data/palettes.js";
import type { ChartCardConfig } from "./chart-card.js";
import { fitChartKind } from "./chart-gallery.js";
import { aggFor } from "./chart-names.js";
import { profile, type RecProfile } from "./chart-recommender.js";
import { CHART_COLORS, toRecColumn, type ChartCardKind } from "./chart-utils.js";

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
    mode: "auto",
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
    mapMode: "points",
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
      break;
    case "line":
      if (t0) set.column = t0.pick.index;
      if (m0) Object.assign(set, { valueColumn: m0.pick.index, valueAgg: agg(m0) });
      if (cats[0]) set.groupColumn = cats[0].pick.index;
      break;
    case "bar":
      if (c0) set.column = c0.pick.index;
      break;
    case "barplot":
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
      if (kind === "bubble" && m2) set.sizeColumn = m2.pick.index;
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
  if (options.strict === true && (kind === "stacked100" || kind === "dotplot" || kind === "waterfall" || kind === "smallmultiples" || kind === "slopegraph")) {
    if (set.valueColumn === undefined || set.column === undefined) return null;
    if ((kind === "stacked100" || kind === "smallmultiples" || kind === "slopegraph") && set.groupColumn === undefined) return null;
  }
  return { ...fit.preset, ...set, kind };
}

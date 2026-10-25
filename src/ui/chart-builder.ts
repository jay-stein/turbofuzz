import type { TimeGrain } from "../data/aggregate.js";
import type { ColumnMeta } from "../worker/protocol.js";
import { DEFAULT_PALETTE } from "../data/palettes.js";
import type { ChartCardConfig } from "./chart-card.js";
import { fitChartKind } from "./chart-gallery.js";
import { CHART_COLORS } from "./chart-utils.js";

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
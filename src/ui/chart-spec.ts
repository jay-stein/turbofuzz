import type { ColumnMeta } from "../worker/protocol.js";
import type { ChartCardConfig } from "./chart-card.js";

/** Versioned, serialisable description of a chart card. */
export interface ChartSpec {
  version: 1;
  kind: ChartCardConfig["kind"];
  title: string;
  source: { kind: "table" | "view"; id: string; name: string };
  fields: {
    x: string | null;
    y: string | null;
    column: string | null;
    value: string | null;
    group: string | null;
    color: string | null;
    size: string | null;
    correlation: string[];
  };
  aggregation: {
    measure: string | null;
    agg: string | null;
    calculation: string | null;
    timeGrain: string | null;
  };
  filters: {
    chart: { column: string; value: string } | null;
    respectTableFilters: boolean;
  };
  presentation: {
    palette: string;
    paletteReversed: boolean;
    colorMin: number | null;
    colorMax: number | null;
    topN: number;
    groupOther: boolean;
    barLayout: "group" | "stack";
    span: "auto" | "full";
  };
}

/**
 * Converts a live card config into the declarative spec used by exports and
 * future code generation. Column references are stored by name so the spec
 * survives reordering, renames and reloads.
 */
export function chartSpecFromConfig(
  config: ChartCardConfig,
  columns: readonly ColumnMeta[],
  sourceName = "Table",
): ChartSpec {
  const nameOf = (index: number | undefined): string | null =>
    index !== undefined && index >= 0 && index < columns.length
      ? columns[index].name
      : null;
  const filterMeta =
    config.filterColumn !== undefined &&
    config.filterColumn >= 0 &&
    config.filterColumn < columns.length
      ? columns[config.filterColumn]
      : undefined;
  const filterValue =
    filterMeta !== undefined && config.filterCode !== undefined && config.filterCode >= 0
      ? filterMeta.categories?.labels[config.filterCode]
      : undefined;
  return {
    version: 1,
    kind: config.kind,
    title: config.title,
    source:
      config.source === ""
        ? { kind: "table", id: "", name: sourceName }
        : { kind: "view", id: config.source, name: sourceName },
    fields: {
      x: nameOf(config.x),
      y: nameOf(config.y),
      column: nameOf(config.column),
      value: nameOf(config.valueColumn),
      group: nameOf(config.groupColumn),
      color: nameOf(config.colorColumn),
      size: nameOf(config.sizeColumn),
      correlation: config.correlationColumns
        .map((index) => nameOf(index))
        .filter((name): name is string => name !== null),
    },
    aggregation: {
      measure: nameOf(config.valueColumn),
      agg: config.valueAgg ?? null,
      calculation: config.valueCalc ?? null,
      timeGrain: config.valueGrain ?? null,
    },
    filters: {
      chart:
        filterMeta !== undefined && filterValue !== undefined
          ? { column: filterMeta.name, value: filterValue }
          : null,
      respectTableFilters: config.respectFilters !== false,
    },
    presentation: {
      palette: config.palette ?? "",
      paletteReversed: config.paletteReversed === true,
      colorMin: config.colorMin ?? null,
      colorMax: config.colorMax ?? null,
      topN: config.topN,
      groupOther: config.groupOther,
      barLayout: config.barLayout ?? "group",
      span: config.span ?? "auto",
    },
  };
}

export function chartSpecJson(spec: ChartSpec): string {
  return JSON.stringify(spec, null, 2);
}

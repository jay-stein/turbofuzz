import type { ChartBinOptions } from "../data/chart-bins.js";
import type { TimeGrain } from "../data/aggregate.js";
import type { ColumnMeta } from "../worker/protocol.js";
import type { ChartCardConfig } from "./chart-card.js";
import { defaultChartConfig } from "./chart-builder.js";
import {
  CHART_KIND_LABELS,
  isGroupable,
  isNumericType,
  type ChartCardKind,
} from "./chart-utils.js";

/** Versioned, serialisable description of a chart card. */
export interface ChartSpec {
  version: 2;
  kind: ChartCardKind;
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
    filter: string | null;
    animationTime: string | null;
    correlation: string[];
  };
  aggregation: {
    measure: string | null;
    agg: ChartCardConfig["valueAgg"] | null;
    calculation: ChartCardConfig["valueCalc"] | null;
    timeGrain: TimeGrain | "auto" | null;
  };
  filter: {
    column: string | null;
    code: number | null;
    value: string | null;
    respectTableFilters: boolean;
  };
  binning: ChartBinOptions | null;
  presentation: {
    mode: ChartCardConfig["mode"];
    densityStyle: ChartCardConfig["densityStyle"];
    kde: boolean;
    color: string;
    colorCustom: boolean;
    multiColor: boolean;
    palette: string;
    paletteCustom: string;
    paletteReversed: boolean;
    colorMin: number | null;
    colorMax: number | null;
    colorCenter: number | null;
    topN: number;
    groupOther: boolean;
    barLayout: "group" | "stack";
    binClipped: boolean;
    xTitle: string;
    yTitle: string;
    yUnit: string;
    bubbleBins: number;
    bubbleAgg: NonNullable<ChartCardConfig["bubbleAgg"]>;
    bubbleScale: NonNullable<ChartCardConfig["bubbleScale"]>;
    mapMode: NonNullable<ChartCardConfig["mapMode"]>;
    span: "auto" | "full";
    animationGrain: TimeGrain;
    animationSpeed: number;
    suggested: string;
    chartSort: NonNullable<ChartCardConfig["chartSort"]>;
    pivotRowLevel?: number;
    pivotColLevel?: number;
    pivotMeasure?: number;
  };
}

export interface CompiledChartSpec {
  config: ChartCardConfig | null;
  issues: string[];
}

function nameOf(index: number | undefined, columns: readonly ColumnMeta[]): string | null {
  return index !== undefined && index >= 0 && index < columns.length
    ? columns[index].name
    : null;
}

function indexOf(name: string | null, columns: readonly ColumnMeta[]): {
  index: number;
  issue: string | null;
} {
  if (name === null) return { index: -1, issue: null };
  const index = columns.findIndex((column) => column.name === name);
  return index < 0
    ? { index: -1, issue: `Column "${name}" is not in this dataset.` }
    : { index, issue: null };
}

function copyBins(bins: ChartBinOptions | null): ChartBinOptions | null {
  return bins === null ? null : { ...bins };
}

/**
 * Converts a live card config into the declarative spec used by exports,
 * duplication, imports and code generation. Every supported config field is
 * represented; column references are stored by name.
 */
export function chartSpecFromConfig(
  config: ChartCardConfig,
  columns: readonly ColumnMeta[],
  sourceName = "Table",
): ChartSpec {
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
    version: 2,
    kind: config.kind,
    title: config.title,
    source:
      config.source === ""
        ? { kind: "table", id: "", name: sourceName }
        : { kind: "view", id: config.source, name: sourceName },
    fields: {
      x: nameOf(config.x, columns),
      y: nameOf(config.y, columns),
      column: nameOf(config.column, columns),
      value: nameOf(config.valueColumn, columns),
      group: nameOf(config.groupColumn, columns),
      color: nameOf(config.colorColumn, columns),
      size: nameOf(config.sizeColumn, columns),
      filter: filterMeta?.name ?? null,
      animationTime: nameOf(config.animationTimeColumn, columns),
      correlation: config.correlationColumns
        .map((index) => nameOf(index, columns))
        .filter((name): name is string => name !== null),
    },
    aggregation: {
      measure: nameOf(config.valueColumn, columns),
      agg: config.valueAgg ?? null,
      calculation: config.valueCalc ?? null,
      timeGrain: config.valueGrain ?? null,
    },
    filter: {
      column: filterMeta?.name ?? null,
      code: config.filterCode !== undefined && config.filterCode >= 0 ? config.filterCode : null,
      value: filterValue ?? null,
      respectTableFilters: config.respectFilters !== false,
    },
    binning: copyBins(config.binOptions),
    presentation: {
      mode: config.mode,
      densityStyle: config.densityStyle,
      kde: config.kde,
      color: config.color,
      colorCustom: config.colorCustom === true,
      multiColor: config.multiColor,
      palette: config.palette ?? "",
      paletteCustom: config.paletteCustom ?? "",
      paletteReversed: config.paletteReversed === true,
      colorMin: config.colorMin ?? null,
      colorMax: config.colorMax ?? null,
      colorCenter: config.colorCenter ?? null,
      topN: config.topN,
      groupOther: config.groupOther,
      barLayout: config.barLayout ?? "group",
      binClipped: config.binClipped,
      xTitle: config.xTitle ?? "",
      yTitle: config.yTitle ?? "",
      yUnit: config.yUnit ?? "",
      bubbleBins: config.bubbleBins ?? 40,
      bubbleAgg: config.bubbleAgg ?? "count",
      bubbleScale: config.bubbleScale ?? "area",
      mapMode: config.mapMode ?? "points",
      span: config.span ?? "auto",
      animationGrain: config.animationGrain ?? "day",
      animationSpeed: config.animationSpeed ?? 1,
      suggested: config.suggested,
      chartSort: config.chartSort ?? "none",
      pivotRowLevel: config.pivotRowLevel,
      pivotColLevel: config.pivotColLevel,
      pivotMeasure: config.pivotMeasure,
    },
  };
}

/**
 * Compiles a spec back to the runtime config. Invalid fields collect issues;
 * callers must not apply a config when `issues` is non-empty.
 */
export function chartSpecToConfig(
  spec: ChartSpec,
  columns: readonly ColumnMeta[],
): CompiledChartSpec {
  const issues: string[] = [];
  const config = defaultChartConfig();
  config.kind = spec.kind;
  config.title = spec.title;
  config.source = spec.source.id;
  const field = (name: string | null): number => {
    const result = indexOf(name, columns);
    if (result.issue !== null) issues.push(result.issue);
    return result.index;
  };
  config.column = field(spec.fields.column);
  config.x = field(spec.fields.x);
  config.y = field(spec.fields.y);
  config.valueColumn = field(spec.fields.value);
  config.groupColumn = field(spec.fields.group);
  config.colorColumn = field(spec.fields.color);
  config.sizeColumn = field(spec.fields.size);
  config.animationTimeColumn = field(spec.fields.animationTime);
  config.filterColumn = field(spec.fields.filter);
  config.correlationColumns = spec.fields.correlation.map(field).filter((index) => index >= 0);
  config.filterCode =
    spec.filter.code !== null
      ? spec.filter.code
      : spec.filter.value !== null && config.filterColumn >= 0
        ? (columns[config.filterColumn]?.categories?.labels.indexOf(spec.filter.value) ?? -1)
        : -1;
  if (config.filterColumn < 0) config.filterCode = -1;
  config.respectFilters = spec.filter.respectTableFilters;
  config.valueAgg = spec.aggregation.agg ?? undefined;
  config.valueCalc = spec.aggregation.calculation ?? undefined;
  config.valueGrain = spec.aggregation.timeGrain ?? undefined;
  config.binOptions = copyBins(spec.binning);
  config.mode = spec.presentation.mode;
  config.densityStyle = spec.presentation.densityStyle;
  config.kde = spec.presentation.kde;
  config.color = spec.presentation.color;
  if (spec.presentation.colorCustom) config.colorCustom = true;
  config.multiColor = spec.presentation.multiColor;
  config.palette = spec.presentation.palette;
  config.paletteCustom = spec.presentation.paletteCustom;
  config.paletteReversed = spec.presentation.paletteReversed;
  config.colorMin = spec.presentation.colorMin;
  config.colorMax = spec.presentation.colorMax;
  config.colorCenter = spec.presentation.colorCenter;
  config.topN = spec.presentation.topN;
  config.groupOther = spec.presentation.groupOther;
  config.barLayout = spec.presentation.barLayout;
  config.binClipped = spec.presentation.binClipped;
  config.xTitle = spec.presentation.xTitle;
  config.yTitle = spec.presentation.yTitle;
  config.yUnit = spec.presentation.yUnit;
  config.bubbleBins = spec.presentation.bubbleBins;
  config.bubbleAgg = spec.presentation.bubbleAgg;
  config.bubbleScale = spec.presentation.bubbleScale;
  config.mapMode = spec.presentation.mapMode;
  config.span = spec.presentation.span;
  config.animationGrain = spec.presentation.animationGrain;
  config.animationSpeed = spec.presentation.animationSpeed;
  config.suggested = spec.presentation.suggested;
  config.chartSort = spec.presentation.chartSort;
  if (spec.presentation.pivotRowLevel !== undefined) {
    config.pivotRowLevel = spec.presentation.pivotRowLevel;
  }
  if (spec.presentation.pivotColLevel !== undefined) {
    config.pivotColLevel = spec.presentation.pivotColLevel;
  }
  if (spec.presentation.pivotMeasure !== undefined) {
    config.pivotMeasure = spec.presentation.pivotMeasure;
  }
  validateCompiledSpec(spec, config, columns, issues);
  return { config: issues.length === 0 ? config : null, issues };
}

function validateCompiledSpec(
  spec: ChartSpec,
  config: ChartCardConfig,
  columns: readonly ColumnMeta[],
  issues: string[],
): void {
  if (!(spec.kind in CHART_KIND_LABELS)) issues.push(`Unknown chart kind "${spec.kind}".`);
  if (spec.source.kind !== "table" && spec.source.kind !== "view") {
    issues.push("Source must be table or view.");
  }
  const numeric = (name: string | null, label: string): void => {
    const result = indexOf(name, columns);
    if (result.issue !== null) issues.push(result.issue);
    else if (result.index >= 0 && !isNumericType(columns[result.index].type)) {
      issues.push(`${label} must be numeric.`);
    }
  };
  const category = (name: string | null, label: string): void => {
    const result = indexOf(name, columns);
    if (result.issue !== null) issues.push(result.issue);
    else if (result.index >= 0 && !isGroupable(columns[result.index])) {
      issues.push(`${label} must be a category column.`);
    }
  };
  switch (spec.kind) {
    case "barplot":
    case "dotplot":
      category(spec.fields.column, "Category");
      numeric(spec.fields.value, "Measure");
      break;
    case "waterfall":
      if (spec.fields.column === null) issues.push("A waterfall needs a column for its steps.");
      numeric(spec.fields.value, "Measure");
      break;
    case "stacked100":
      category(spec.fields.column, "Rows");
      category(spec.fields.group, "Segments");
      numeric(spec.fields.value, "Measure");
      break;
    case "smallmultiples":
    case "slopegraph":
      if (spec.fields.column === null) issues.push("This chart needs a primary column.");
      category(spec.fields.group, spec.kind === "slopegraph" ? "Lines" : "Panels");
      numeric(spec.fields.value, "Measure");
      break;
    case "bar":
    case "treemap":
    case "terms":
    case "line":
      if (spec.fields.column === null) issues.push("This chart needs a primary column.");
      break;
    case "histogram":
      numeric(spec.fields.column, "Values");
      break;
    case "kpi":
      numeric(spec.fields.value, "Measure");
      break;
    case "heatmap":
      category(spec.fields.x, "Rows");
      category(spec.fields.y, "Columns");
      break;
    case "box":
      numeric(spec.fields.x, "Values");
      category(spec.fields.y, "Group");
      break;
    case "correlation":
      if (spec.fields.correlation.length < 2) {
        issues.push("Correlation needs at least two columns.");
      }
      for (const name of spec.fields.correlation) numeric(name, "Correlation column");
      break;
    case "scatter":
    case "density":
    case "bubble":
    case "map":
      if (spec.fields.x === null || spec.fields.y === null) {
        issues.push("This chart needs X and Y columns.");
      }
      break;
    default:
      break;
  }
  if (config.binOptions !== null) {
    if (!(config.binOptions.max > config.binOptions.min)) {
      issues.push("Bin maximum must be greater than the minimum.");
    }
    if (config.binOptions.binCount < 1 || config.binOptions.binCount > 256) {
      issues.push("Bin count must be between 1 and 256.");
    }
  }
  const filterColumn = config.filterColumn ?? -1;
  const filterCode = config.filterCode ?? -1;
  if (filterColumn >= 0 && filterCode >= 0) {
    const count = columns[filterColumn]?.categories?.labels.length ?? 0;
    if (filterCode >= count) issues.push("Chart filter value is not in this column.");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateSpecShape(raw: Record<string, unknown>): string[] {
  const issues: string[] = [];
  const fields = raw.fields as Record<string, unknown>;
  for (const key of [
    "x",
    "y",
    "column",
    "value",
    "group",
    "color",
    "size",
    "filter",
    "animationTime",
  ]) {
    const value = fields[key];
    if (value !== null && typeof value !== "string") {
      issues.push(`fields.${key} must be a column name or null.`);
    }
  }
  if (
    !Array.isArray(fields.correlation) ||
    fields.correlation.some((name) => typeof name !== "string")
  ) {
    issues.push("fields.correlation must be an array of column names.");
  }
  const filter = raw.filter as Record<string, unknown>;
  if (filter.column !== null && typeof filter.column !== "string") {
    issues.push("filter.column must be a column name or null.");
  }
  if (filter.value !== null && typeof filter.value !== "string") {
    issues.push("filter.value must be a string or null.");
  }
  if (filter.code !== null && typeof filter.code !== "number") {
    issues.push("filter.code must be a number or null.");
  }
  if (typeof filter.respectTableFilters !== "boolean") {
    issues.push("filter.respectTableFilters must be true or false.");
  }
  const source = raw.source as Record<string, unknown>;
  if (source.kind !== "table" && source.kind !== "view") {
    issues.push("source.kind must be table or view.");
  }
  if (typeof source.id !== "string" || typeof source.name !== "string") {
    issues.push("source.id and source.name must be strings.");
  }
  const presentation = raw.presentation as Record<string, unknown>;
  if (typeof presentation.topN !== "number" || !Number.isFinite(presentation.topN)) {
    issues.push("presentation.topN must be a number.");
  }
  if (presentation.span !== "auto" && presentation.span !== "full") {
    issues.push("presentation.span must be auto or full.");
  }
  if (presentation.barLayout !== "group" && presentation.barLayout !== "stack") {
    issues.push("presentation.barLayout must be group or stack.");
  }
  if (typeof presentation.palette !== "string") {
    issues.push("presentation.palette must be a string.");
  }
  if (raw.binning !== null && !isRecord(raw.binning)) {
    issues.push("binning must be an object or null.");
  }
  return issues;
}

/** Parse and validate an imported spec without applying anything. */
export function parseChartSpec(
  text: string,
  columns: readonly ColumnMeta[],
): CompiledChartSpec & { spec: ChartSpec | null } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { config: null, spec: null, issues: ["The file is not valid JSON."] };
  }
  if (!isRecord(raw)) {
    return { config: null, spec: null, issues: ["The spec must be a JSON object."] };
  }
  if (raw.version !== 2) {
    return {
      config: null,
      spec: null,
      issues: [`Unsupported spec version ${String(raw.version)}; expected version 2.`],
    };
  }
  if (
    typeof raw.kind !== "string" ||
    typeof raw.title !== "string" ||
    !isRecord(raw.fields) ||
    !isRecord(raw.filter) ||
    !isRecord(raw.aggregation) ||
    !isRecord(raw.presentation) ||
    !isRecord(raw.source)
  ) {
    return {
      config: null,
      spec: null,
      issues: ["The spec is missing required fields (kind, title, fields, filter, aggregation, presentation, source)."],
    };
  }
  const shapeIssues = validateSpecShape(raw);
  if (shapeIssues.length > 0) {
    return { config: null, spec: null, issues: shapeIssues };
  }
  const spec = raw as unknown as ChartSpec;
  const compiled = chartSpecToConfig(spec, columns);
  return { ...compiled, spec: compiled.config === null ? null : spec };
}

export function chartSpecJson(spec: ChartSpec): string {
  return JSON.stringify(spec, null, 2);
}

export interface ChartSpecSupport {
  pandas: { supported: boolean; warnings: string[] };
  polars: { supported: boolean; warnings: string[] };
}

export interface GeneratedChartCode {
  code: string;
  warnings: string[];
}

const PANDAS_GRAIN: Record<string, string> = {
  hour: "h",
  day: "D",
  week: "W",
  month: "ME",
  quarter: "QE",
  year: "YE",
};

const POLARS_GRAIN: Record<string, string> = {
  hour: "1h",
  day: "1d",
  week: "1w",
  month: "1mo",
  quarter: "1q",
  year: "1y",
};

const quote = (value: string): string => JSON.stringify(value);

function pandasAgg(spec: ChartSpec): { call: string; alias: string } {
  const measure = spec.fields.value;
  const agg = spec.aggregation.agg ?? "sum";
  if (measure === null) return { call: "size()", alias: "count" };
  if (agg === "count") return { call: `${quote(measure)}.count()`, alias: "count" };
  if (agg === "distinct") return { call: `${quote(measure)}.nunique()`, alias: "distinct" };
  const supported = ["sum", "mean", "median", "min", "max"];
  const method = supported.includes(agg) ? agg : "mean";
  return { call: `${quote(measure)}.${method}()`, alias: method };
}

function pandasCalc(spec: ChartSpec): string[] {
  const calc = spec.aggregation.calculation;
  if (calc === null) return [];
  switch (calc) {
    case "rolling7":
      return [".rolling(7).mean()"];
    case "cumulative":
      return [".cumsum()"];
    case "diff":
      return [".diff()"];
    case "pctChange":
      return [".pct_change()"];
    case "pctTotal":
      return [".pipe(lambda s: s / s.sum() * 100)"];
    case "rank":
      return [".rank(ascending=False)"];
    default:
      return [];
  }
}

function specWarnings(spec: ChartSpec): string[] {
  const warnings: string[] = [];
  if (spec.filter.respectTableFilters) {
    warnings.push("This spec does not contain the table's active filters; apply them before running.");
  }
  if (spec.presentation.chartSort !== "none") {
    warnings.push("Chart sorting is not emitted; the code keeps the aggregation's default order.");
  }
  if (spec.presentation.groupOther) {
    warnings.push("The Other bucket is not generated; code returns only the top N rows.");
  }
  if (spec.binning !== null) {
    warnings.push("Custom bin edges are not emitted for this chart.");
  }
  if (spec.aggregation.calculation === "pctRows" || spec.aggregation.calculation === "yoy") {
    warnings.push(`The ${spec.aggregation.calculation} calculation is not emitted by this generator.`);
  }
  if (spec.fields.group !== null || spec.fields.color !== null || spec.fields.size !== null) {
    warnings.push("Group/colour/size encodings are not emitted; only the primary aggregation is generated.");
  }
  return warnings;
}
/** Idiomatic pandas for the supported ChartSpec subset. */
export function chartSpecToPandas(spec: ChartSpec): GeneratedChartCode {
  const warnings: string[] = [...specWarnings(spec)];
  const measure = spec.fields.value;
  const agg = spec.aggregation.agg ?? "mean";
  const topN = spec.presentation.topN;
  const lines = [
    "import pandas as pd",
    "",
    "# Replace this with your real source (CSV, Excel, parquet, ...).",
    'df = pd.read_csv("data.csv")',
    "",
  ];
  if (spec.filter.column !== null && !spec.filter.respectTableFilters) {
    warnings.push("Table filters are ignored by this spec; only the chart filter is shown.");
  }
  if (spec.filter.column !== null && spec.filter.value !== null) {
    lines.push(
      `df = df[df[${quote(spec.filter.column)}] == ${quote(spec.filter.value)}]`,
      "",
    );
  }
  const category = spec.fields.column;
  const finish = (code: string): GeneratedChartCode => ({
    code: `${lines.join("\n")}${code.trim()}\n`,
    warnings,
  });
  if ((spec.kind === "barplot" || spec.kind === "dotplot") && category !== null) {
    const aggregate = pandasAgg(spec);
    lines.push(
      "result = (",
      `    df.groupby(${quote(category)}, dropna=False)`,
      `    .agg(value=(${quote(measure ?? category)}, ${aggregate.call}))`,
      "    .sort_values(\"value\", ascending=False)",
      `    .head(${topN})`,
      "    .reset_index()",
      ")",
    );
    const calc = pandasCalc(spec);
    if (calc.length > 0) {
      lines.push("result[\"value\"] = result[\"value\"]" + calc.join(""));
    }
    return finish(
      `${lines.join("\n")}\n# result.plot.bar(x=${quote(category)}, y="value")\nprint(result)\n`,
    );
  }
  if (spec.kind === "bar" && spec.fields.column !== null) {
    lines.push(
      "result = (",
      `    df.groupby(${quote(spec.fields.column)}, dropna=False).size()`,
      "    .sort_values(ascending=False)",
      `    .head(${topN})`,
      "    .reset_index(name=\"count\")",
      ")",
      "print(result)",
    );
    return finish(lines.join("\n"));
  }
  if (spec.kind === "line" && spec.fields.column !== null) {
    const grain = PANDAS_GRAIN[spec.aggregation.timeGrain ?? "month"] ?? "ME";
    const method =
      agg === "count"
        ? "count"
        : agg === "distinct"
          ? "nunique"
          : ["sum", "mean", "median", "min", "max"].includes(agg)
            ? agg
            : "mean";
    lines.push(
      `df[${quote(spec.fields.column)}] = pd.to_datetime(df[${quote(spec.fields.column)}])`,
    );
    if (measure === null) {
      lines.push(
        `series = df.set_index(${quote(spec.fields.column)}).resample(${quote(grain)}).size()`,
      );
    } else {
      lines.push(
        `series = df.set_index(${quote(spec.fields.column)})[${quote(measure)}].resample(${quote(grain)}).${method}()`,
      );
    }
    const calc = pandasCalc(spec);
    if (calc.length > 0) lines.push(`series = series${calc.join("")}`);
    lines.push("print(series)");
    return finish(lines.join("\n"));
  }
  if (spec.kind === "kpi" && measure !== null) {
    lines.push(
      `value = df[${quote(measure)}].${agg === "count" ? "count" : agg === "distinct" ? "nunique" : ["sum", "mean", "median", "min", "max"].includes(agg) ? agg : "mean"}()`,
      "print(value)",
    );
    return finish(lines.join("\n"));
  }
  if (spec.kind === "correlation") {
    lines.push(
      `numeric = df[${JSON.stringify(spec.fields.correlation)}]`,
      "print(numeric.corr())",
    );
    return finish(lines.join("\n"));
  }
  if (spec.kind === "heatmap" && spec.fields.x !== null && spec.fields.y !== null) {
    lines.push(
      `print(pd.crosstab(df[${quote(spec.fields.x)}], df[${quote(spec.fields.y)}]))`,
    );
    return finish(lines.join("\n"));
  }
  if (spec.kind === "scatter" || spec.kind === "density" || spec.kind === "bubble") {
    if (spec.fields.x === null || spec.fields.y === null) {
      warnings.push("Scatter-like charts need both X and Y fields.");
    } else {
      lines.push(
        `points = df[[${quote(spec.fields.x)}, ${quote(spec.fields.y)}]].dropna()`,
        "print(points.describe())",
      );
      return finish(lines.join("\n"));
    }
  }
  warnings.push(`No pandas generator for the ${spec.kind} chart yet.`);
  return { code: "", warnings };
}

/** Idiomatic Polars for the supported ChartSpec subset. */
export function chartSpecToPolars(spec: ChartSpec): GeneratedChartCode {
  const warnings: string[] = [...specWarnings(spec)];
  const measure = spec.fields.value;
  const agg = spec.aggregation.agg ?? "mean";
  const topN = spec.presentation.topN;
  const aggregate =
    measure === null
      ? "pl.len()"
      : agg === "count"
        ? `pl.col(${quote(measure)}).count()`
        : agg === "distinct"
          ? `pl.col(${quote(measure)}).n_unique()`
          : `pl.col(${quote(measure)}).${["sum", "mean", "median", "min", "max"].includes(agg) ? agg : "mean"}()`;
  const lines = [
    "import polars as pl",
    "",
    "# Replace this with your real source (CSV, Excel, parquet, ...).",
    'df = pl.read_csv("data.csv")',
    "",
  ];
  if (spec.filter.column !== null && spec.filter.value !== null) {
    lines.push(
      `df = df.filter(pl.col(${quote(spec.filter.column)}) == ${quote(spec.filter.value)})`,
      "",
    );
  }
  const category = spec.fields.column;
  const finish = (body: string): GeneratedChartCode => ({
    code: `${lines.join("\n")}${body.trim()}\n`,
    warnings,
  });
  if ((spec.kind === "barplot" || spec.kind === "dotplot") && category !== null) {
    lines.push(
      "result = (",
      `    df.group_by(${quote(category)})`,
      `    .agg(${aggregate}.alias("value"))`,
      '    .sort("value", descending=True)',
      `    .head(${topN})`,
      ")",
      "print(result)",
    );
    return finish(lines.join("\n"));
  }
  if (spec.kind === "bar" && spec.fields.column !== null) {
    lines.push(
      "result = (",
      `    df.group_by(${quote(spec.fields.column)})`,
      '    .agg(pl.len().alias("count"))',
      '    .sort("count", descending=True)',
      `    .head(${topN})`,
      ")",
      "print(result)",
    );
    return finish(lines.join("\n"));
  }
  if (spec.kind === "line" && spec.fields.column !== null) {
    const grain = POLARS_GRAIN[spec.aggregation.timeGrain ?? "month"] ?? "1mo";
    lines.push(
      `df = df.with_columns(pl.col(${quote(spec.fields.column)}).str.to_datetime())`,
      "result = (",
      `    df.group_by_dynamic(${quote(spec.fields.column)}, every=${quote(grain)})`,
      `    .agg(${aggregate}.alias("value"))`,
      ")",
      "print(result)",
    );
    return finish(lines.join("\n"));
  }
  if (spec.kind === "kpi" && measure !== null) {
    lines.push(`print(df.select(${aggregate}).item())`);
    return finish(lines.join("\n"));
  }
  if (spec.kind === "correlation") {
    lines.push(
      `print(df.select(${JSON.stringify(spec.fields.correlation)}).corr())`,
    );
    return finish(lines.join("\n"));
  }
  if (spec.kind === "heatmap" && spec.fields.x !== null && spec.fields.y !== null) {
    lines.push(
      "print(",
      `    df.group_by([${quote(spec.fields.x)}, ${quote(spec.fields.y)}])`,
      "    .agg(pl.len().alias(\"count\"))",
      ")",
    );
    return finish(lines.join("\n"));
  }
  if (spec.kind === "scatter" || spec.kind === "density" || spec.kind === "bubble") {
    if (spec.fields.x === null || spec.fields.y === null) {
      warnings.push("Scatter-like charts need both X and Y fields.");
    } else {
      lines.push(
        `print(df.select(${quote(spec.fields.x)}, ${quote(spec.fields.y)}).drop_nulls())`,
      );
      return finish(lines.join("\n"));
    }
  }
  warnings.push(`No Polars generator for the ${spec.kind} chart yet.`);
  return { code: "", warnings };
}

/** Explicit support report for generated code. */
export function chartSpecSupport(spec: ChartSpec): ChartSpecSupport {
  const pandas = chartSpecToPandas(spec);
  const polars = chartSpecToPolars(spec);
  return {
    pandas: { supported: pandas.code !== "", warnings: pandas.warnings },
    polars: { supported: polars.code !== "", warnings: polars.warnings },
  };
}
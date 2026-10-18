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

/** Idiomatic pandas for the supported ChartSpec subset. */
export function chartSpecToPandas(spec: ChartSpec): GeneratedChartCode {
  const warnings: string[] = [];
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
  if (spec.filters.chart !== null && !spec.filters.respectTableFilters) {
    warnings.push("Table filters are ignored by this spec; only the chart filter is shown.");
  }
  if (spec.filters.chart !== null) {
    lines.push(
      `df = df[df[${quote(spec.filters.chart.column)}] == ${quote(spec.filters.chart.value)}]`,
      "",
    );
  }
  const category = spec.fields.column;
  const finish = (code: string): GeneratedChartCode => ({
    code: `${lines.join("\n")}${code.trim()}\n`,
    warnings,
  });
  if (spec.kind === "barplot" && category !== null) {
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
  const warnings: string[] = [];
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
  if (spec.filters.chart !== null) {
    lines.push(
      `df = df.filter(pl.col(${quote(spec.filters.chart.column)}) == ${quote(spec.filters.chart.value)})`,
      "",
    );
  }
  const category = spec.fields.column;
  const finish = (body: string): GeneratedChartCode => ({
    code: `${lines.join("\n")}${body.trim()}\n`,
    warnings,
  });
  if (spec.kind === "barplot" && category !== null) {
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

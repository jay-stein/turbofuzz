import { test } from "node:test";
import assert from "node:assert/strict";
import type { ColumnMeta } from "../src/worker/protocol.js";
import type { ChartCardConfig } from "../src/ui/chart-card.js";
import {
  chartSpecFromConfig,
  chartSpecJson,
  chartSpecToPandas,
  chartSpecToPolars,
} from "../src/ui/chart-spec.js";

function meta(name: string, overrides: Partial<ColumnMeta> = {}): ColumnMeta {
  return {
    name,
    type: "number",
    numberLocale: "dot",
    dateOrder: "dmy",
    stats: {
      nulls: 0,
      distinct: 10,
      samples: [],
      topValues: [],
      min: 0,
      max: 10,
      mean: 5,
      stddev: 1,
      minLength: null,
      maxLength: null,
      avgLength: null,
    },
    anomalyCounts: { values: 0, lengths: 0 },
    similarGroups: 0,
    categories: null,
    histogram: null,
    valueFence: null,
    lengthFence: null,
    nullPolicy: { extra: [], keep: [] },
    nullTokens: [],
    suggestions: [],
    ...overrides,
  };
}

function config(overrides: Partial<ChartCardConfig> = {}): ChartCardConfig {
  return {
    kind: "barplot",
    source: "",
    column: 1,
    x: -1,
    y: -1,
    colorColumn: -1,
    sizeColumn: -1,
    mode: "auto",
    densityStyle: "both",
    kde: true,
    color: "#2563eb",
    multiColor: true,
    palette: "Set1",
    paletteCustom: "",
    paletteReversed: false,
    colorMin: null,
    colorMax: null,
    topN: 10,
    groupOther: true,
    binOptions: null,
    binClipped: false,
    title: "Revenue",
    groupColumn: -1,
    suggested: "",
    correlationColumns: [],
    valueColumn: 2,
    valueAgg: "sum",
    valueCalc: "cumulative",
    filterColumn: 1,
    filterCode: 0,
    respectFilters: false,
    ...overrides,
  };
}

test("the chart spec stores fields by name and includes filters and calculations", () => {
  const columns = [
    meta("amount"),
    meta("city", {
      type: "category",
      categories: { labels: ["Perth", "Sydney"], counts: [3, 2] },
    }),
    meta("revenue"),
  ];
  const spec = chartSpecFromConfig(config(), columns);
  assert.equal(spec.version, 1);
  assert.equal(spec.kind, "barplot");
  assert.equal(spec.fields.column, "city");
  assert.equal(spec.fields.value, "revenue");
  assert.deepEqual(spec.aggregation, {
    measure: "revenue",
    agg: "sum",
    calculation: "cumulative",
    timeGrain: null,
  });
  assert.deepEqual(spec.filters, {
    chart: { column: "city", value: "Perth" },
    respectTableFilters: false,
  });
  const parsed = JSON.parse(chartSpecJson(spec)) as { title: string; version: number };
  assert.equal(parsed.version, 1);
  assert.equal(parsed.title, "Revenue");
});

test("generated pandas and Polars code rebuilds the chart aggregation", () => {
  const spec = chartSpecFromConfig(config({ respectFilters: true }), [
    meta("amount"),
    meta("city", {
      type: "category",
      categories: { labels: ["Perth", "Sydney"], counts: [3, 2] },
    }),
    meta("revenue"),
  ]);
  const pandas = chartSpecToPandas(spec);
  assert.match(pandas.code, /groupby\("city"/);
  assert.match(pandas.code, /\.sum\(\)/);
  assert.match(pandas.code, /\.head\(10\)/);
  assert.deepEqual(pandas.warnings, []);

  const polars = chartSpecToPolars(spec);
  assert.match(polars.code, /group_by\("city"\)/);
  assert.match(polars.code, /\.sum\(\)/);
  assert.match(polars.code, /\.head\(10\)/);

  const unsupported = chartSpecToPandas({ ...spec, kind: "treemap" });
  assert.equal(unsupported.code, "");
  assert.match(unsupported.warnings[0] ?? "", /No pandas generator/);
});

test("time charts generate resample/group_by_dynamic code", () => {
  const spec = chartSpecFromConfig(
    config({
      kind: "line",
      column: 1,
      valueColumn: 2,
      valueGrain: "month",
      valueCalc: undefined,
      filterColumn: -1,
      filterCode: -1,
    }),
    [
      meta("amount"),
      meta("when", { type: "date" }),
      meta("revenue"),
    ],
  );
  assert.match(chartSpecToPandas(spec).code, /resample\("ME"\)/);
  assert.match(chartSpecToPolars(spec).code, /group_by_dynamic\("when", every="1mo"\)/);
});
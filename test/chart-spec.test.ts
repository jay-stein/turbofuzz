import { test } from "node:test";
import assert from "node:assert/strict";
import type { ColumnMeta } from "../src/worker/protocol.js";
import type { ChartCardConfig } from "../src/ui/chart-card.js";
import { defaultChartConfig } from "../src/ui/chart-builder.js";
import {
  chartSpecFromConfig,
  chartSpecJson,
  chartSpecSupport,
  chartSpecToConfig,
  chartSpecToPandas,
  chartSpecToPolars,
  parseChartSpec,
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
    ...defaultChartConfig(),
    kind: "barplot",
    title: "Revenue",
    column: 1,
    valueColumn: 2,
    valueAgg: "sum",
    valueCalc: "cumulative",
    filterColumn: 1,
    filterCode: 0,
    respectFilters: false,
    ...overrides,
  };
}

const columns = [
  meta("amount"),
  meta("city", {
    type: "category",
    categories: { labels: ["Perth", "Sydney"], counts: [3, 2] },
  }),
  meta("revenue"),
];

test("the v2 chart spec stores every field and filter by name", () => {
  const spec = chartSpecFromConfig(
    config({ colorCenter: 0, colorMin: -5, colorMax: 5, barLayout: "stack" }),
    columns,
  );
  assert.equal(spec.version, 2);
  assert.equal(spec.kind, "barplot");
  assert.equal(spec.fields.column, "city");
  assert.equal(spec.fields.value, "revenue");
  assert.equal(spec.fields.filter, "city");
  assert.deepEqual(spec.aggregation, {
    measure: "revenue",
    agg: "sum",
    calculation: "cumulative",
    timeGrain: null,
  });
  assert.deepEqual(spec.filter, {
    column: "city",
    code: 0,
    value: "Perth",
    respectTableFilters: false,
  });
  assert.equal(spec.presentation.colorCenter, 0);
  assert.equal(spec.presentation.barLayout, "stack");
  const parsed = JSON.parse(chartSpecJson(spec)) as { title: string; version: number };
  assert.equal(parsed.version, 2);
  assert.equal(parsed.title, "Revenue");
});

test("spec compile is lossless for supported config fields", () => {
  const original = config({
    kind: "barplot",
    colorCenter: 0,
    colorMin: -2,
    colorMax: 8,
    barLayout: "stack",
    valueGrain: "month",
    chartSort: "valueDesc",
    topN: 7,
    xTitle: "Month",
    yTitle: "Revenue",
    yUnit: "AUD",
    animationTimeColumn: 1,
    animationGrain: "week",
    animationSpeed: 2,
  });
  const spec = chartSpecFromConfig(original, columns);
  const compiled = chartSpecToConfig(spec, columns);
  assert.deepEqual(compiled.issues, []);
  assert.deepEqual(compiled.config, original);
});

test("invalid imports explain every problem and never compile", () => {
  const bad = { ...chartSpecFromConfig(config(), columns), kind: "unknown" };
  const parsed = parseChartSpec(JSON.stringify(bad), columns);
  assert.equal(parsed.config, null);
  assert.ok(parsed.issues.some((issue) => /Unknown chart kind/.test(issue)));

  const missing = chartSpecFromConfig(config(), columns);
  missing.fields.value = "not-a-column";
  const stale = parseChartSpec(JSON.stringify(missing), columns);
  assert.equal(stale.config, null);
  assert.ok(stale.issues.some((issue) => /not in this dataset/.test(issue)));

  const old = parseChartSpec(JSON.stringify({ version: 1 }), columns);
  assert.equal(old.config, null);
  assert.match(old.issues[0] ?? "", /Unsupported spec version 1/);
});

test("generated pandas and Polars code rebuilds the chart aggregation", () => {
  const spec = chartSpecFromConfig(config({ respectFilters: true }), columns);
  const pandas = chartSpecToPandas(spec);
  assert.match(pandas.code, /groupby\("city"/);
  assert.match(pandas.code, /\.sum\(\)/);
  assert.match(pandas.code, /\.head\(10\)/);
  assert.ok(pandas.warnings.some((warning) => /table's active filters/.test(warning)));

  const polars = chartSpecToPolars(spec);
  assert.match(polars.code, /group_by\("city"\)/);
  assert.match(polars.code, /\.sum\(\)/);
  assert.match(polars.code, /\.head\(10\)/);

  const unsupported = chartSpecToPandas({ ...spec, kind: "treemap" });
  assert.equal(unsupported.code, "");
  assert.ok(unsupported.warnings.some((warning) => /No pandas generator/.test(warning)));
});

test("the support report lists generated warnings explicitly", () => {
  const spec = chartSpecFromConfig(
    config({ chartSort: "valueDesc", groupOther: true, respectFilters: true }),
    columns,
  );
  const report = chartSpecSupport(spec);
  assert.equal(report.pandas.supported, true);
  assert.equal(report.polars.supported, true);
  assert.ok(report.pandas.warnings.some((warning) => /sorting/i.test(warning)));
  assert.ok(report.pandas.warnings.some((warning) => /Other bucket/i.test(warning)));
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
    [meta("amount"), meta("when", { type: "date" }), meta("revenue")],
  );
  assert.match(chartSpecToPandas(spec).code, /resample\("ME"\)/);
  assert.match(chartSpecToPolars(spec).code, /group_by_dynamic\("when", every="1mo"\)/);
});
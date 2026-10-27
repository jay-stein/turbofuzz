import { test } from "node:test";
import assert from "node:assert/strict";
import { fitChartKind } from "../src/ui/chart-gallery.js";
import {
  chartConfigWithDefaults,
  configForChart,
  kindForRecommended,
  defaultChartConfig,
  nextFinerGrain,
  suggestedChartConfig,
} from "../src/ui/chart-builder.js";
import type { ColumnMeta } from "../src/worker/protocol.js";

function meta(name: string, type: ColumnMeta["type"]): ColumnMeta {
  return {
    name,
    type,
    numberLocale: "dot",
    dateOrder: "dmy",
    stats: {
      nulls: 0,
      distinct: 5,
      samples: [],
      topValues: [],
      min: type === "number" ? 0 : null,
      max: type === "number" ? 10 : null,
      mean: null,
      stddev: null,
      minLength: null,
      maxLength: null,
      avgLength: null,
    },
    anomalyCounts: { values: 0, lengths: 0 },
    similarGroups: 0,
    categories:
      type === "category"
        ? { labels: ["a", "b"], counts: [3, 2] }
        : null,
    histogram: null,
    valueFence: null,
    lengthFence: null,
    nullPolicy: { extra: [], keep: [] },
    nullTokens: [],
    suggestions: [],
  };
}

test("all chart entry points start from one default config", () => {
  const defaults = defaultChartConfig();
  assert.equal(defaults.kind, "histogram");
  assert.equal(defaults.topN, 10);
  assert.equal(defaults.colorCenter, null);
  assert.deepEqual(chartConfigWithDefaults({ kind: "bar" }), {
    ...defaults,
    kind: "bar",
  });
});

test("reset to suggested preserves the card frame and uses the fit policy", () => {
  const columns = [meta("city", "category"), meta("score", "number")];
  const current = chartConfigWithDefaults({
    kind: "bar",
    column: 0,
    title: "Cities",
    source: "view-1",
    span: "full",
    respectFilters: false,
    colorMin: 1,
    colorMax: 9,
  });
  const reset = suggestedChartConfig(current, columns, 10);
  assert.ok(reset !== null);
  assert.equal(reset.kind, "bar");
  assert.equal(reset.column, 0);
  assert.equal(reset.title, "Cities");
  assert.equal(reset.source, "view-1");
  assert.equal(reset.span, "full");
  assert.equal(reset.respectFilters, false);
  assert.equal(reset.colorMin, null);
});

test("gallery fit and reset agree on the chosen fields", () => {
  const columns = [meta("city", "category"), meta("score", "number")];
  const fit = fitChartKind("bar", columns, 10);
  assert.equal(fit.ok, true);
  const reset = suggestedChartConfig(
    chartConfigWithDefaults({ kind: "bar", column: -1 }),
    columns,
    10,
  );
  assert.equal(reset?.column, fit.preset.column);
});

test("drill walks from year to second and never goes finer than second", () => {
  assert.equal(nextFinerGrain("year"), "quarter");
  assert.equal(nextFinerGrain("day"), "hour");
  assert.equal(nextFinerGrain("auto"), "day");
  assert.equal(nextFinerGrain("second"), null);
});
function sized(name: string, type: ColumnMeta["type"], distinct: number, grouped = false): ColumnMeta {
  const base = meta(name, type);
  const categories = grouped ? { labels: ["a", "b"], counts: [3, 2] } : null;
  return { ...base, stats: { ...base.stats, distinct }, categories };
}

const shop = [
  sized("order_date", "date", 300),
  sized("region", "category", 4, true),
  sized("revenue", "number", 700),
  sized("margin_pct", "number", 500),
];

test("configForChart fills slots from the shelf by role", () => {
  const line = configForChart("line", [{ index: 0 }, { index: 2 }, { index: 1 }], shop, 1000);
  assert.deepEqual(
    { kind: line?.kind, column: line?.column, value: line?.valueColumn, agg: line?.valueAgg, group: line?.groupColumn },
    { kind: "line", column: 0, value: 2, agg: "sum", group: 1 },
  );
  const bars = configForChart("barplot", [{ index: 1 }, { index: 3 }], shop, 1000);
  assert.equal(bars?.valueAgg, "mean", "a rate-like measure defaults to Average");
  const chip = configForChart("barplot", [{ index: 1 }, { index: 2, agg: "max" }], shop, 1000);
  assert.equal(chip?.valueAgg, "max", "the aggregation chip wins");
  assert.deepEqual(configForChart("scatter", [{ index: 2 }, { index: 3 }], shop, 1000)?.x, 2);
});

test("configForChart falls back to the fit for empty slots and refuses unfit kinds", () => {
  const bare = configForChart("barplot", [], shop, 1000);
  assert.equal(bare?.column, 1, "no shelf: the gallery's default columns");
  assert.equal(configForChart("map", [], shop, 1000), null, "no coordinates: no map");
  assert.equal(kindForRecommended("timeseries"), "line");
  assert.equal(kindForRecommended("smallmultiples"), "smallmultiples");
  assert.equal(kindForRecommended("pie"), null, "there is no pie chart");
});

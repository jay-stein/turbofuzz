import { test } from "node:test";
import assert from "node:assert/strict";
import { binValues } from "../src/data/chart-bins.js";
import {
  categorySeries,
  chartKindFor,
  correlationCell,
  defaultCardKind,
  defaultChartTitle,
  formatChartNumber,
  formatCount,
  formatTick,
  niceTicks,
  parseChartNumber,
  pickDefaultCard,
  rampColor,
  suggestCharts,
  suggestedBinRange,
} from "../src/ui/chart-utils.js";
import type { ColumnMeta } from "../src/worker/protocol.js";
import {
  configToNames,
  remapChartConfigs,
  type NamedChartCardConfig,
} from "../src/ui/chart-panel.js";
import type { ChartCardConfig } from "../src/ui/chart-card.js";

function meta(overrides: Partial<ColumnMeta> = {}): ColumnMeta {
  return {
    name: "col",
    type: "string",
    numberLocale: "dot",
    dateOrder: "dmy",
    stats: {
      nulls: 0,
      distinct: 3,
      samples: [],
      topValues: [],
      min: null,
      max: null,
      mean: null,
      stddev: null,
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

test("chart kind follows the column type", () => {
  assert.equal(chartKindFor("number"), "histogram");
  assert.equal(chartKindFor("integer"), "histogram");
  assert.equal(chartKindFor("date"), "line");
  assert.equal(chartKindFor("category"), "bar");
  assert.equal(chartKindFor("boolean"), "bar");
  assert.equal(chartKindFor("string"), null);
  assert.equal(chartKindFor("identifier"), null);
});

test("defaultCardKind prefers numeric, then dates, then categories", () => {
  assert.equal(defaultCardKind([meta({ type: "string" })]), "histogram");
  assert.equal(defaultCardKind([meta({ type: "date" })]), "line");
  assert.equal(defaultCardKind([meta({ type: "category" })]), "bar");
  assert.equal(
    defaultCardKind([meta({ type: "string" }), meta({ type: "number" }), meta({ type: "date" })]),
    "histogram",
  );
});

function typed(
  name: string,
  type: ColumnMeta["type"],
  distinct: number,
  extra: Partial<ColumnMeta> = {},
): ColumnMeta {
  return meta({ name, type, stats: { ...meta().stats, distinct }, ...extra });
}

test("pickDefaultCard follows the sales file's date and categories", () => {
  const sales = [
    typed("order_id", "string", 6015),
    typed("order_date", "date", 400),
    typed("region", "category", 6),
    typed("product", "category", 6),
    typed("category", "category", 3),
    typed("quantity", "category", 12),
    typed("unit_price", "number", 6),
    typed("discount_pct", "integer", 4),
    typed("revenue", "number", 4200),
    typed("customer_email", "string", 1800),
    typed("shipped", "boolean", 2),
    typed("notes", "category", 6),
  ];
  const pick = pickDefaultCard(sales, 6015);
  assert.equal(pick.kind, "line");
  assert.equal(pick.column, 1);
  assert.equal(pick.reason, "rows over time by order_date");

  const ideas = suggestCharts(sales, 6015);
  assert.equal(ideas.length, 3);
  assert.equal(ideas[0].label, "Rows over time");
  assert.deepEqual(ideas[0].preset, { kind: "line", column: 1 });
  assert.match(ideas[1].label, /^Rows by /);
  assert.match(ideas[2].label, /^Distribution of revenue$/);
});

test("pickDefaultCard falls back through category, numeric and nothing", () => {
  const noDate = [
    typed("name", "string", 120),
    typed("region", "category", 6),
    typed("amount", "number", 500),
  ];
  const category = pickDefaultCard(noDate, 6015);
  assert.deepEqual(
    { kind: category.kind, column: category.column },
    { kind: "bar", column: 1 },
  );

  const numericOnly = [typed("name", "string", 120), typed("amount", "number", 500)];
  assert.equal(pickDefaultCard(numericOnly, 6015).kind, "histogram");
  assert.equal(pickDefaultCard(numericOnly, 6015).column, 1);

  const textOnly = [typed("name", "string", 120), typed("email", "string", 480)];
  const pick = pickDefaultCard(textOnly, 480);
  assert.equal(pick.column, -1);
  assert.equal(pick.reason, "");
});

test("pickDefaultCard skips the row id in an ID-first file", () => {
  const big = [
    typed("id", "integer", 300_000, { stats: { ...meta().stats, distinct: 300_000, nulls: 0 } }),
    typed("ts", "date", 299_000),
    typed("region", "category", 6, {
      categories: { labels: ["a", "b"], counts: [1, 1] },
    }),
    typed("amount", "number", 299_000),
  ];
  const pick = pickDefaultCard(big, 300_000);
  assert.equal(pick.kind, "line");
  assert.equal(pick.column, 1, "the unique id is not charted");

  const noDate = [big[0], big[3]];
  const numeric = pickDefaultCard(noDate, 300_000);
  assert.equal(numeric.kind, "histogram");
  assert.equal(numeric.column, 1);
});

test("pickDefaultCard handles a one-row file", () => {
  const oneRow = [
    typed("a", "integer", 1),
    typed("b", "number", 1),
    typed("c", "category", 1),
  ];
  const pick = pickDefaultCard(oneRow, 1);
  assert.equal(pick.kind, "histogram");
  assert.equal(pick.column, 0);
});

test("nice ticks cover the range with round steps", () => {
  assert.deepEqual(niceTicks(0, 100, 5), [0, 20, 40, 60, 80, 100]);
  assert.deepEqual(niceTicks(3, 97, 4), [20, 40, 60, 80]);
  const ticks = niceTicks(-12, 12, 6);
  assert.ok(ticks.length >= 4);
  assert.ok(ticks[0] >= -12 && ticks[ticks.length - 1] <= 12);
  assert.deepEqual(niceTicks(5, 5), [5]);
});

test("colour ramp interpolates between stops", () => {
  assert.equal(rampColor(0), "rgb(37, 99, 235)");
  assert.equal(rampColor(1), "rgb(239, 68, 68)");
  assert.match(rampColor(0.5), /^rgb\(\d+, \d+, \d+\)$/);
  assert.equal(rampColor(-5), "rgb(37, 99, 235)");
});

test("axis labels drop insignificant digits", () => {
  assert.equal(formatTick(50_000, "histogram"), "50k");
  assert.equal(formatTick(12_800, "histogram"), "12.8k");
  assert.equal(formatTick(1_500_000, "histogram"), "1.5M");
  // Year-window integers read as labels: bare 4-digit years, never 1.9k/2k.
  assert.equal(formatTick(1970, "histogram"), "1970");
  assert.equal(formatTick(2_010, "histogram"), "2010");
  assert.equal(formatTick(1_900, "histogram"), "1900");
  assert.equal(formatCount(50_000), "50,000");
  assert.equal(formatCount(48780), "48,780");
});

test("correlation cells diverge around the neutral colour", () => {
  const neutral = correlationCell(0, "#eaeef2");
  assert.equal(neutral.bg, "rgb(234, 238, 242)");
  const positive = correlationCell(1, "#eaeef2");
  assert.match(positive.bg, /^rgb\(/);
  assert.equal(positive.fg, "#ffffff");
  const negative = correlationCell(-1, "#eaeef2");
  assert.notEqual(negative.bg, positive.bg);
  const undefinedCell = correlationCell(Number.NaN, "#eaeef2");
  assert.match(undefinedCell.bg, /^rgb\(/);
});

test("binValues splits the range and aggregates overflow", () => {
  const values = Float64Array.from([-5, 0, 10, 20, 30, 100]);
  const ids = Uint32Array.from([0, 1, 2, 3, 4, 5]);
  const withOverflow = binValues(values, ids, {
    min: 0,
    max: 40,
    binCount: 4,
    overflow: true,
  });
  assert.deepEqual(withOverflow.bins, [1, 1, 1, 1]);
  assert.equal(withOverflow.below, 1);
  assert.equal(withOverflow.overflow, 1);
  assert.equal(withOverflow.above, 0);
  assert.equal(withOverflow.total, 6);

  const withoutOverflow = binValues(values, ids, {
    min: 0,
    max: 40,
    binCount: 4,
    overflow: false,
  });
  assert.equal(withoutOverflow.overflow, 0);
  assert.equal(withoutOverflow.above, 1);
});

test("binValues respects the row subset (current filters)", () => {
  const values = Float64Array.from([1, 2, 3, 4]);
  const ids = Uint32Array.from([1, 3]);
  const out = binValues(values, ids, { min: 1, max: 4, binCount: 3, overflow: false });
  assert.equal(out.total, 2);
  assert.deepEqual(out.bins, [0, 1, 1]);
});

test("chart titles name the column, not the file", () => {
  assert.equal(defaultChartTitle("Amount"), "Amount");
  assert.equal(defaultChartTitle("Score"), "Score");
  assert.equal(defaultChartTitle(""), "Data");
});

test("bin bounds round-trip through comma-formatted inputs", () => {
  const formatted = formatChartNumber(19818400000);
  assert.ok(formatted.includes(","), `expected thousands separators in ${formatted}`);
  assert.equal(parseChartNumber(formatted), 19818400000);
  assert.equal(parseChartNumber(" 1 234.5 "), 1234.5);
  assert.equal(parseChartNumber(""), null);
  assert.equal(parseChartNumber("abc"), null);
});

test("suggested bin range clips extreme tails to p95 with overflow on", () => {
  const histogram = {
    bins: [1],
    min: 0,
    max: 100,
    symlog: false,
    below: 0,
    above: 0,
    p05: 5,
    p95: 5000,
  };
  const clipped = suggestedBinRange(
    meta({
      type: "number",
      stats: { ...meta().stats, min: 0, max: 19_818_400_000 },
      histogram,
    }),
  );
  assert.equal(clipped.max, 5000);
  assert.equal(clipped.overflow, true);
  assert.equal(clipped.clipped, true);

  const normal = suggestedBinRange(
    meta({
      type: "number",
      stats: { ...meta().stats, min: 0, max: 100 },
      histogram,
    }),
  );
  assert.equal(normal.max, 100);
  assert.equal(normal.overflow, false);
  assert.equal(normal.clipped, false);
});

test("constant columns get a padded bin range", () => {
  const range = suggestedBinRange(
    meta({ type: "number", stats: { ...meta().stats, min: 5, max: 5 }, histogram: null }),
  );
  assert.deepEqual(range, { min: 4, max: 6, overflow: false, clipped: false });
});

test("category series takes the top N and aggregates the rest as Other", () => {
  const labels = Array.from({ length: 8 }, (_, index) => `v${index}`);
  const counts = labels.map((_, index) => 80 - index * 10);
  const column = meta({ type: "category", categories: { labels, counts } });

  const series = categorySeries(column, undefined, 3, true);
  assert.equal(series.length, 4);
  assert.equal(series[0].label, "v0");
  assert.equal(series[0].count, 80);
  assert.equal(series[3].label, "Other");
  assert.equal(series[3].other, true);
  assert.equal(series[3].count, 50 + 40 + 30 + 20 + 10);
  const total = counts.reduce((sum, count) => sum + count, 0);
  assert.ok(Math.abs(series[3].pct - (150 / total) * 100) < 1e-9);

  const withoutOther = categorySeries(column, undefined, 3, false);
  assert.equal(withoutOther.length, 3);
  assert.ok(!withoutOther.some((bar) => bar.other === true));
});

test("category series uses filtered facet counts", () => {
  const labels = ["a", "b", "c"];
  const counts = [10, 20, 5];
  const column = meta({ type: "category", categories: { labels, counts } });

  const filtered = categorySeries(column, [0, 60, 0], 5, true);
  assert.equal(filtered[0].label, "b");
  assert.equal(filtered[0].count, 60);
  assert.ok(Math.abs(filtered[0].pct - 100) < 1e-9);
});

function fullConfig(overrides: Partial<ChartCardConfig> = {}): ChartCardConfig {
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
    color: "#2563eb",
    multiColor: true,
    topN: 5,
    groupOther: true,
    binOptions: null,
    binClipped: false,
    title: "",
    groupColumn: -1,
    suggested: "",
    correlationColumns: [],
    ...overrides,
  };
}

function named(overrides: Partial<NamedChartCardConfig> = {}): NamedChartCardConfig {
  return {
    ...fullConfig(),
    column: null,
    x: null,
    y: null,
    colorColumn: null,
    sizeColumn: null,
    groupColumn: null,
    correlationColumns: [],
    ...overrides,
  };
}

const byName = (names: string[]): ColumnMeta[] =>
  names.map((name) => meta({ name, type: "number" }));

test("configToNames stores column references by name", () => {
  const columns = [
    meta({ name: "a", type: "number" }),
    meta({ name: "b", type: "number" }),
    meta({ name: "c", type: "category" }),
  ];
  const config = fullConfig({
    column: 1,
    x: 0,
    y: 2,
    colorColumn: 0,
    sizeColumn: 1,
    correlationColumns: [0, 1],
  });
  const namedConfig = configToNames(config, columns);
  assert.equal(namedConfig.column, "b");
  assert.equal(namedConfig.x, "a");
  assert.equal(namedConfig.y, "c");
  assert.equal(namedConfig.colorColumn, "a");
  assert.equal(namedConfig.sizeColumn, "b");
  assert.deepEqual(namedConfig.correlationColumns, ["a", "b"]);
});

test("remapChartConfigs follows reorder, delete and rename", () => {
  const cards = [
    named({ column: "amount", title: "A" }),
    named({ kind: "scatter", x: "amount", y: "when", title: "B" }),
    named({ kind: "correlation", correlationColumns: ["a", "b", "c"], title: "C" }),
  ];

  const reordered = remapChartConfigs(cards, byName(["when", "amount", "c", "b", "a"]));
  assert.equal(reordered.removed, 0);
  assert.equal(reordered.kept.length, 3);
  assert.deepEqual(
    reordered.configs.map((config) => config.column),
    [1, -1, -1],
  );
  assert.equal(reordered.configs[1].x, 1);
  assert.equal(reordered.configs[1].y, 0);
  assert.deepEqual(reordered.configs[2].correlationColumns, [4, 3, 2]);

    const deleted = remapChartConfigs(cards, byName(["amount", "c", "b"]));
    assert.equal(deleted.removed, 1, "the scatter loses its Y column");
    assert.deepEqual(deleted.kept.map((config) => config.title), ["A", "C"]);
    assert.equal(deleted.entries.length, 3, "the deleted card remains as an orphan");
    assert.deepEqual(deleted.orphaned[0]?.missingColumns, ["when"]);
    assert.equal(deleted.entries[1]?.missingColumns?.[0], "when");

    const restored = remapChartConfigs(deleted.named, byName(["amount", "c", "b", "when"]));
    assert.equal(restored.removed, 0, "restoring the column revives the card");
    assert.equal(restored.entries[1]?.missingColumns, undefined);

  const renamed = remapChartConfigs(
    cards,
    byName(["amount_v2", "when", "a", "b", "c"]),
  );
  assert.equal(renamed.removed, 2, "renamed columns are treated as deleted");
  assert.deepEqual(renamed.kept.map((config) => config.title), ["C"]);
});

test("remapChartConfigs drops a correlation with fewer than two columns left", () => {
  const thin = remapChartConfigs(
    [named({ kind: "correlation", correlationColumns: ["a", "b"] })],
    byName(["a"]),
  );
  assert.equal(thin.removed, 1);
  assert.equal(thin.configs.length, 0);
});

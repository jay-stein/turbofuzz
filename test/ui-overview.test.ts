import { test } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import type { DatasetStats } from "../src/data/stats.js";
import { Overview, chartStep, healthTiles, pickNextSteps } from "../src/ui/overview.js";
import type { ColumnMeta, LoadedMessage } from "../src/worker/protocol.js";

function setupDom(): Window {
  const window = new Window();
  const globals = globalThis as Record<string, unknown>;
  globals.window = window;
  globals.document = window.document;
  globals.HTMLElement = window.HTMLElement;
  globals.getComputedStyle = window.getComputedStyle.bind(window);
  globals.localStorage = window.localStorage;
  return window;
}

function meta(overrides: Partial<ColumnMeta> = {}): ColumnMeta {
  return {
    name: "col",
    type: "string",
    numberLocale: "dot",
    dateOrder: "dmy",
    stats: {
      nulls: 0,
      distinct: 5,
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

function stats(overrides: Partial<DatasetStats> = {}): DatasetStats {
  return {
    duplicateRows: 0,
    duplicateGroups: 0,
    rowsInDuplicateGroups: 0,
    emptyRows: 0,
    rowsWithNulls: 0,
    totalNullCells: 0,
    totalCells: 100,
    valueAnomalyRows: 0,
    lengthAnomalyRows: 0,
    computeMs: 1,
    ...overrides,
  };
}

test("next steps rank firing rules by rows affected and end with the chart", () => {
  const columns = [
    meta({ name: "region", type: "category", stats: { ...meta().stats, nulls: 2 } }),
    meta({ name: "amount", type: "number", stats: { ...meta().stats, nulls: 0 } }),
  ];
  const steps = pickNextSteps(
    columns,
    stats({ rowsWithNulls: 30, duplicateRows: 12 }),
    100,
  );
  assert.deepEqual(
    steps.map((step) => step.id),
    ["empties", "duplicates", "chart"],
  );
  assert.equal(steps[0].text, "1 column has empty cells");
  assert.equal(steps[1].text, "12 duplicate rows");
  assert.equal(steps[2].action.kind, "chart");
  assert.equal(steps[2].action.column, 0);
  assert.equal(steps[2].text, "Chart rows by region");
});

test("next steps show only the top two rules when more than three fire", () => {
  const columns = [
    meta({
      name: "notes",
      type: "string",
      stats: { ...meta().stats, nulls: 4 },
      suggestions: [{ kind: "toNumber" } as never],
    }),
    meta({
      name: "sku",
      type: "category",
      stats: { ...meta().stats, distinct: 1 },
      similarGroups: 2,
    }),
  ];
  const steps = pickNextSteps(
    columns,
    stats({ rowsWithNulls: 50, duplicateRows: 20 }),
    100,
  );
  assert.equal(steps.length, 3);
  assert.deepEqual(
    steps.map((step) => step.id),
    ["empties", "duplicates", "chart"],
  );
});

test("next steps fire one-click fixes, near duplicates and constants", () => {
  const columns = [
    meta({ name: "a", suggestions: [{ kind: "toDate" } as never] }),
    meta({ name: "b", similarGroups: 3 }),
    meta({ name: "c", type: "integer", stats: { ...meta().stats, distinct: 1 } }),
  ];
  const steps = pickNextSteps(columns, stats(), 10);
  const ids = steps.map((step) => step.id);
  assert.ok(ids.includes("fixes"));
  assert.ok(ids.includes("nearDuplicates"));
  assert.ok(ids.includes("constant"));
  const fixes = steps.find((step) => step.id === "fixes");
  assert.equal(fixes?.text, "1 column has one-click fixes");
  const constants = steps.find((step) => step.id === "constant");
  assert.equal(constants?.text, "1 column holds a single value");
});

test("a clean dataset only suggests a chart", () => {
  const columns = [meta({ name: "amount", type: "number" })];
  const steps = pickNextSteps(columns, stats(), 100);
  assert.equal(steps.length, 1);
  assert.equal(steps[0].id, "chart");
  assert.equal(steps[0].text, "Distribution of amount");
});

test("chart slot prefers dates, then categories, then numerics", () => {
  assert.equal(
    chartStep([meta({ name: "when", type: "date" }), meta({ name: "n", type: "number" })]).text,
    "Chart when over time",
  );
  assert.equal(
    chartStep([meta({ name: "who", type: "category" }), meta({ name: "n", type: "number" })]).text,
    "Chart rows by who",
  );
  assert.equal(chartStep([meta({ name: "n", type: "number" })]).text, "Distribution of n");
  assert.equal(chartStep([meta({ name: "s", type: "string" })]).text, "Chart the data");
});

test("health tiles report completeness and warn above zero", () => {
  const tiles = healthTiles(
    [meta({ stats: { ...meta().stats, nulls: 5 } }), meta()],
    stats({ totalNullCells: 15, totalCells: 150, duplicateRows: 3, valueAnomalyRows: 7 }),
  );
  assert.equal(tiles.length, 4);
  assert.equal(tiles[0].id, "complete");
  assert.equal(tiles[0].value, "90.0%");
  assert.equal(tiles[0].warn, true);
  assert.equal(tiles[1].value, "3");
  assert.equal(tiles[2].value, "1 of 2");
  assert.equal(tiles[3].value, "7");
  assert.equal(tiles.every((tile) => typeof tile.label === "string"), true);
});

test("overview renders dataset line, tiles, next steps and every column", () => {
  const window = setupDom();
  const host = document.createElement("div");
  const overview = new Overview(host, {
    onOpenTable: () => {},
    onOpenChart: () => {},
    onFilterColumn: () => {},
    onCleanColumn: () => {},
    onOpenCleanNulls: () => {},
    onDedupe: () => {},
    onOpenMerge: () => {},
    onReviewColumn: () => {},
    onOpenStats: () => {},
  });

  const columns = Array.from({ length: 12 }, (_, index) =>
    meta({ name: `col_${index}`, type: index % 2 === 0 ? "number" : "category" }),
  );
  const loaded = {
    type: "loaded",
    name: "sales_demo.csv",
    rowCount: 6015,
    columnCount: 12,
    columns,
    stats: stats({ totalCells: 12 * 6015, duplicateRows: 15 }),
    encoding: null,
    ingestMs: 293,
  } as unknown as LoadedMessage;

  overview.render(loaded);

  assert.match(host.querySelector(".overview-facts")?.textContent ?? "", /6,015 rows × 12 columns/);
  assert.equal(host.querySelectorAll(".health-tile").length, 4);
  assert.ok(host.querySelectorAll(".next-step-card").length >= 1);
  assert.equal(host.querySelectorAll(".overview-column-grid .stat-card").length, 12);
  assert.ok(host.querySelector(".overview-actions .primary") !== null);

  const checkbox = host.querySelector<HTMLInputElement>(".overview-actions input[type=checkbox]");
  assert.ok(checkbox !== null);
  checkbox.checked = true;
  checkbox.dispatchEvent(new window.Event("change") as unknown as Event);
  assert.equal(window.localStorage.getItem("turbofuzz.view.default"), "table");
  checkbox.checked = false;
  checkbox.dispatchEvent(new window.Event("change") as unknown as Event);
  assert.equal(window.localStorage.getItem("turbofuzz.view.default"), null);

  overview.updateColumn(0, meta({ name: "renamed", type: "number" }));
  assert.match(
    host.querySelector('.overview-column-grid .stat-card[data-column="0"]')?.textContent ?? "",
    /renamed/,
  );
});

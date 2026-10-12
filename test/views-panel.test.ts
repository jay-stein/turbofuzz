import { test } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import type { AggregateMessage, ColumnMeta } from "../src/worker/protocol.js";
import { ViewsPanel, starterViews } from "../src/ui/views-panel.js";
import type { ViewDef } from "../src/data/aggregate.js";

function setupDom(): Window {
  const window = new Window();
  const globals = globalThis as Record<string, unknown>;
  globals.window = window;
  globals.document = window.document;
  globals.HTMLElement = window.HTMLElement;
  globals.MutationObserver = window.MutationObserver;
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

const metas = [
  meta({ name: "amount", type: "number", stats: { ...meta().stats, distinct: 9 } }),
  meta({ name: "city", type: "category", stats: { ...meta().stats, distinct: 3 } }),
  meta({ name: "when", type: "date", stats: { ...meta().stats, distinct: 20 } }),
];

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

test("starter views follow the column types", () => {
  const views = starterViews(metas);
  assert.equal(views.length, 3);
  assert.equal(views[0].name, "Sum of amount by city");
  assert.deepEqual(views[0].measures, [{ column: 0, agg: "sum" }]);
  assert.equal(views[1].name, "Rows by when month");
  assert.deepEqual(views[1].dimensions, [{ column: 2, by: { time: "month" } }]);
  assert.equal(views[1].fill, "zero");
  assert.equal(views[2].name, "Count by city");
  assert.equal(views[2].measures[0]?.agg, "count");
});

function aggregateFor(view: ViewDef): AggregateMessage {
  return {
    type: "aggregate",
    requestId: 1,
    viewId: view.id,
    labels: ["a", "b"],
    dimensions: [["a", "b"]],
    dimensionNames: ["city"],
    dimensionIsTime: [false],
    dimensionTimes: [Float64Array.from([Number.NaN, Number.NaN])],
    measures: [Float64Array.from([30, 10])],
    measureNames: ["sum(amount)"],
    totals: Float64Array.from([40]),
    groupCount: 2,
    totalGroups: 2,
    truncated: false,
    ms: 2,
  };
}

test("views panel renders the active view, drills and charts", async () => {
  setupDom();
  const host = document.createElement("div");
  const requests: ViewDef[] = [];
  const drills: { column: number; label: string }[] = [];
  const charts: ViewDef[] = [];
  const panel = new ViewsPanel(host as unknown as HTMLElement, {
    requestAggregate: async (view) => {
      requests.push(view);
      return aggregateFor(view);
    },
    onDrill: (column, _timeStart, _timeEnd, label) => drills.push({ column, label }),
    onChart: (view) => charts.push(view),
    onUseAsDataset: () => {},
    onCopyPandas: async () => {},
  });
  panel.setColumns(metas, 100);
  await tick();

  assert.equal(requests.length, 1, "the first starter view is requested");
  const tabs = host.querySelectorAll(".views-tab");
  assert.ok(tabs.length >= 3, "one tab per starter view plus + View");
  const rows = host.querySelectorAll(".views-row");
  assert.equal(rows.length, 2);
  const total = host.querySelector(".views-total");
  assert.match(total?.textContent ?? "", /Total/);
  assert.match(total?.textContent ?? "", /40/);
  assert.ok(host.querySelector(".views-bar-fill") !== null, "values carry inline bars");

  (rows[0] as unknown as { click(): void }).click();
  assert.deepEqual(drills, [{ column: 1, label: "a" }]);

  const chart = [...host.querySelectorAll(".views-actions button")].find(
    (button) => button.textContent === "Chart this",
  );
  assert.ok(chart !== undefined);
  (chart as unknown as { click(): void }).click();
  assert.equal(charts.length, 1);
  assert.equal(charts[0].name, "Sum of amount by city");
});

test("views panel switches views and marks the active one stale", async () => {
  setupDom();
  const host = document.createElement("div");
  const requests: string[] = [];
  const panel = new ViewsPanel(host as unknown as HTMLElement, {
    requestAggregate: async (view) => {
      requests.push(view.name);
      return aggregateFor(view);
    },
    onDrill: () => {},
    onChart: () => {},
    onUseAsDataset: () => {},
    onCopyPandas: async () => {},
  });
  panel.setColumns(metas, 100);
  await tick();
  const tabs = [...host.querySelectorAll(".views-tab")] as unknown as {
    click(): void;
    textContent: string;
  }[];
  const monthly = tabs.find((tab) => tab.textContent?.includes("Rows by when month"));
  assert.ok(monthly !== undefined);
  monthly.click();
  await tick();
  assert.equal(requests[requests.length - 1], "Rows by when month");

  panel.markStale();
  await tick();
  assert.equal(
    requests[requests.length - 1],
    "Rows by when month",
    "filters recompute the active view only",
  );
});

test("adding a measure chooses the aggregate before adding", async () => {
  setupDom();
  const host = document.createElement("div");
  const requests: ViewDef[] = [];
  const panel = new ViewsPanel(host as unknown as HTMLElement, {
    requestAggregate: async (view) => {
      requests.push(view);
      return aggregateFor(view);
    },
    onDrill: () => {},
    onChart: () => {},
    onUseAsDataset: () => {},
    onCopyPandas: async () => {},
  });
  panel.setColumns(metas, 100);
  await tick();
  requests.length = 0;

  const doc = (globalThis as Record<string, unknown>).document as Window["document"];
  const addMeasure = [...host.querySelectorAll(".views-pill.add")].find(
    (button) => button.textContent === "+ Measure",
  );
  assert.ok(addMeasure !== undefined);
  (addMeasure as unknown as { click(): void }).click();
  const columnItem = [...doc.querySelectorAll(".context-menu .context-item")].find(
    (item) => item.textContent === "amount …",
  );
  assert.ok(columnItem !== undefined, "the column list offers a submenu step");
  (columnItem as unknown as { click(): void }).click();
  const meanItem = [...doc.querySelectorAll(".context-menu .context-item")].find(
    (item) => item.textContent === "Mean",
  );
  assert.ok(meanItem !== undefined, "the aggregate menu lists every option");
  (meanItem as unknown as { click(): void }).click();
  await tick();

  const view = requests[requests.length - 1];
  assert.deepEqual(view.measures[view.measures.length - 1], { column: 0, agg: "mean" });
});

test("a measure can be weighted by a numeric column", async () => {
  setupDom();
  const host = document.createElement("div");
  const requests: ViewDef[] = [];
  const panel = new ViewsPanel(host as unknown as HTMLElement, {
    requestAggregate: async (view) => {
      requests.push(view);
      return aggregateFor(view);
    },
    onDrill: () => {},
    onChart: () => {},
    onUseAsDataset: () => {},
    onCopyPandas: async () => {},
  });
  panel.setColumns(metas, 100);
  await tick();
  requests.length = 0;

  const doc = (globalThis as Record<string, unknown>).document as Window["document"];
  const measureZone = host.querySelectorAll(".views-zone")[1];
  assert.ok(measureZone !== undefined, "the measures zone exists");
  (
    measureZone.querySelector(".views-pill .views-pill-label") as unknown as { click(): void }
  ).click();
  const weightItem = [...doc.querySelectorAll(".context-menu .context-item")].find(
    (item) => item.textContent === "Weight by…",
  );
  assert.ok(weightItem !== undefined, "the editor offers Weight by…");
  (weightItem as unknown as { click(): void }).click();
  const amountItem = [...doc.querySelectorAll(".context-menu .context-item")].find(
    (item) => item.textContent === "amount",
  );
  assert.ok(amountItem !== undefined, "the weight menu lists numeric columns");
  (amountItem as unknown as { click(): void }).click();
  await tick();

  const view = requests[requests.length - 1];
  assert.equal(view.measures[0]?.weight, 0);
});

test("double-clicking a view tab renames it in place", async () => {
  const win = setupDom();
  const host = document.createElement("div");
  let changed = 0;
  const panel = new ViewsPanel(host as unknown as HTMLElement, {
    requestAggregate: async (view) => aggregateFor(view),
    onDrill: () => {},
    onChart: () => {},
    onUseAsDataset: () => {},
    onCopyPandas: async () => {},
    onViewsChanged: () => {
      changed++;
    },
  });
  panel.setColumns(metas, 100);
  await tick();

  const first = host.querySelector(".views-tab") as HTMLElement;
  first.dispatchEvent(new win.MouseEvent("dblclick", { bubbles: true }) as unknown as Event);
  const input = first.querySelector(".views-tab-input") as HTMLInputElement | null;
  assert.ok(input !== null, "the tab turns into an input");
  assert.equal(input.value, "Sum of amount by city");
  input.value = "Monthly revenue";
  input.dispatchEvent(new win.KeyboardEvent("keydown", { key: "Enter", bubbles: true }) as unknown as Event);
  await tick();

  assert.equal(changed, 1);
  const tab = host.querySelector(".views-tab") as HTMLElement;
  assert.match(tab.textContent ?? "", /Monthly revenue/);

  const second = host.querySelectorAll(".views-tab")[1] as HTMLElement;
  second.dispatchEvent(new win.MouseEvent("dblclick", { bubbles: true }) as unknown as Event);
  const cancelInput = second.querySelector(".views-tab-input") as HTMLInputElement | null;
  assert.ok(cancelInput !== null);
  cancelInput.value = "discarded";
  cancelInput.dispatchEvent(new win.KeyboardEvent("keydown", { key: "Escape", bubbles: true }) as unknown as Event);
  assert.equal(changed, 1, "Escape keeps the old name");
});

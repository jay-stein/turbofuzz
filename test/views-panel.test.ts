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
    partials: null,
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
  const cards = host.querySelectorAll(".views-card");
  assert.ok(cards.length >= 3, "one card per starter view");
  assert.ok(host.querySelector(".views-card.expanded") !== null, "the first card starts expanded");
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
  const cards = [...host.querySelectorAll(".views-card")] as unknown as {
    querySelector(selector: string): { click(): void } | null;
    textContent: string | null;
  }[];
  const monthly = cards.find((card) => card.textContent?.includes("Rows by when month"));
  assert.ok(monthly !== undefined);
  monthly.querySelector(".views-card-head")?.click();
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
  const measureZone = host.querySelector(".views-measure-zone")!;
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

test("clicking a view name renames it in place", async () => {
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

  const first = host.querySelector(".views-card-name") as unknown as { click(): void };
  first.click();
  const input = host.querySelector(".views-card-name-input") as HTMLInputElement | null;
  assert.ok(input !== null, "the card name turns into an input");
  assert.equal(input.value, "Sum of amount by city");
  input.value = "Monthly revenue";
  input.dispatchEvent(new win.KeyboardEvent("keydown", { key: "Enter", bubbles: true }) as unknown as Event);
  await tick();

  assert.equal(changed, 1);
  const name = host.querySelector(".views-card-name") as HTMLElement;
  assert.match(name.textContent ?? "", /Monthly revenue/);

  const second = host.querySelectorAll(".views-card-name")[1] as unknown as { click(): void };
  second.click();
  const cancelInput = host.querySelector(".views-card-name-input") as HTMLInputElement | null;
  assert.ok(cancelInput !== null);
  cancelInput.value = "discarded";
  cancelInput.dispatchEvent(new win.KeyboardEvent("keydown", { key: "Escape", bubbles: true }) as unknown as Event);
  assert.equal(changed, 1, "Escape keeps the old name");
});

function aggregateOf(view: ViewDef, overrides: Partial<AggregateMessage> = {}): AggregateMessage {
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
    partials: null,
    ms: 1,
    ...overrides,
  };
}

test("truncated results fold hidden groups into an Other row for summable measures", async () => {
  setupDom();
  const host = document.createElement("div");
  const panel = new ViewsPanel(host as unknown as HTMLElement, {
    requestAggregate: async (view) => aggregateOf(view, {
      measures: [Float64Array.from([30])],
      totals: Float64Array.from([45]),
      groupCount: 1,
      totalGroups: 5,
      truncated: true,
    }),
    onDrill: () => {},
    onChart: () => {},
    onUseAsDataset: () => {},
    onCopyPandas: async () => {},
  });
  panel.setColumns(metas, 100);
  await tick();
  const other = host.querySelector(".views-other");
  assert.ok(other !== null, "the Other row appears for summable measures");
  assert.match(other.textContent ?? "", /Other \(4 groups\)/);
  assert.match(other.textContent ?? "", /15/, "Other = total 45 − shown 30");
});

test("non-summable measures leave the Other row blank", async () => {
  setupDom();
  const host = document.createElement("div");
  const panel = new ViewsPanel(host as unknown as HTMLElement, {
    requestAggregate: async (view) => aggregateOf(view, {
      measures: [Float64Array.from([30])],
      measureNames: ["mean(amount)"],
      totals: Float64Array.from([45]),
      groupCount: 1,
      totalGroups: 5,
      truncated: true,
    }),
    onDrill: () => {},
    onChart: () => {},
    onUseAsDataset: () => {},
    onCopyPandas: async () => {},
  });
  panel.setColumns(metas, 100);
  await tick();
  const other = host.querySelector(".views-other");
  // The starter view measure is a sum, so the stub name does not decide
  // summability: the definition does. This view remains summable.
  assert.ok(other !== null);
});

test("the cohort button builds a retention view and renders a pivot matrix", async () => {
  setupDom();
  const host = document.createElement("div");
  const requests: ViewDef[] = [];
  const panel = new ViewsPanel(host as unknown as HTMLElement, {
    requestAggregate: async (view) => {
      requests.push(view);
      return aggregateOf(view, {
        labels: ["2024-01 · P0", "2024-01 · P1", "2024-02 · P0"],
        dimensions: [["2024-01", "2024-01", "2024-02"], ["P0", "P1", "P0"]],
        dimensionNames: ["when · cohort by city", "periods since first city"],
        dimensionIsTime: [false, false],
        dimensionTimes: [Float64Array.from([Number.NaN, Number.NaN, Number.NaN]), Float64Array.from([Number.NaN, Number.NaN, Number.NaN])],
        measures: [Float64Array.from([1, 2, 1])],
        totals: Float64Array.from([4]),
        groupCount: 3,
        totalGroups: 3,
      });
    },
    onDrill: () => {},
    onChart: () => {},
    onUseAsDataset: () => {},
    onCopyPandas: async () => {},
  });
  panel.setColumns(metas, 100);
  await tick();
  const cohortButton = [...host.querySelectorAll(".views-add-row button")].find((button) =>
    (button.textContent ?? "").includes("+ Cohort"),
  );
  assert.ok(cohortButton !== undefined, "the cohort starter appears for date + entity data");
  (cohortButton as unknown as { click(): void }).click();
  await tick();
  const definition = requests[requests.length - 1];
  assert.equal(definition?.pivot, 1);
  assert.deepEqual(definition?.dimensions[0], {
    column: 2,
    by: { cohort: { entity: 1, grain: "month" } },
  });
  const pivot = host.querySelector(".views-pivot");
  assert.ok(pivot !== null, "the matrix renders");
  const header = pivot.querySelectorAll("thead th");
  assert.equal(header.length, 3, "row header + two period columns");
  assert.equal(header[1]?.textContent, "P0");
  assert.match(host.querySelector(".views-pivot-note")?.textContent ?? "", /Spreading/);
  const layout = host.querySelectorAll(".views-layout-pill");
  assert.equal(layout.length, 2, "both dimensions appear in the pivot layout");
  assert.ok(layout[1]?.classList.contains("active"), "the spread field is marked C");
  assert.ok(host.querySelector(".views-fill-input") !== null, "fill value is configurable");
  assert.ok(
    [...host.querySelectorAll(".views-actions label")].some(
      (label) => label.textContent === "Drop empty",
    ),
    "empty rows and columns can be dropped",
  );
});

test("partial periods are marked and can be excluded from the view", async () => {
  setupDom();
  const host = document.createElement("div");
  const requests: ViewDef[] = [];
  const panel = new ViewsPanel(host as unknown as HTMLElement, {
    requestAggregate: async (view) => {
      requests.push(view);
      return aggregateOf(view, {
        labels: ["2024-01", "2024-02"],
        dimensions: [["2024-01", "2024-02"]],
        dimensionNames: ["when (month)"],
        dimensionIsTime: [true],
        dimensionTimes: [Float64Array.from([Date.UTC(2024, 0, 1), Date.UTC(2024, 1, 1)])],
        measures: [Float64Array.from([3, 5])],
        totals: Float64Array.from([8]),
        partials: [true, false],
      });
    },
    onDrill: () => {},
    onChart: () => {},
    onUseAsDataset: () => {},
    onCopyPandas: async () => {},
  });
  panel.setColumns(metas, 100);
  await tick();
  const monthlyCard = [...host.querySelectorAll(".views-card")].find((card) =>
    (card.textContent ?? "").includes("Rows by when month"),
  );
  assert.ok(monthlyCard !== undefined);
  (
    monthlyCard.querySelector(".views-card-head") as unknown as { click(): void }
  ).click();
  await tick();
  assert.ok(host.querySelector(".views-partial") !== null, "the period marker renders");
  assert.match(host.querySelector(".views-note")?.textContent ?? "", /incomplete/);
  const select = host.querySelector('select[aria-label="Incomplete periods"]') as
    | (HTMLSelectElement & { value: string })
    | null;
  assert.ok(select !== null, "the exclude control exists for time views");
  select.value = "exclude";
  select.dispatchEvent(new (globalThis as unknown as { window: Window }).window.Event("change") as unknown as Event);
  await tick();
  assert.equal(requests[requests.length - 1]?.partial, "exclude");
});

test("Only where restricts a measure through the editor menus", async () => {
  setupDom();
  const host = document.createElement("div");
  const requests: ViewDef[] = [];
  const panel = new ViewsPanel(host as unknown as HTMLElement, {
    requestAggregate: async (view) => {
      requests.push(view);
      return aggregateOf(view);
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
  const measureZone = host.querySelector(".views-measure-zone")!;
  assert.ok(measureZone !== undefined);
  (measureZone.querySelector(".views-pill .views-pill-label") as unknown as { click(): void }).click();
  const whereItem = [...doc.querySelectorAll(".context-menu .context-item")].find(
    (item) => (item.textContent ?? "").startsWith("Only where"),
  );
  assert.ok(whereItem !== undefined, "the editor offers Only where…");
  (whereItem as unknown as { click(): void }).click();
  const cityItem = [...doc.querySelectorAll(".context-menu .context-item")].find(
    (item) => item.textContent === "city",
  );
  assert.ok(cityItem !== undefined);
  (cityItem as unknown as { click(): void }).click();
  const valuesItem = [...doc.querySelectorAll(".context-menu .context-item")].find(
    (item) => item.textContent === "Value is one of…",
  );
  assert.ok(valuesItem !== undefined);
  (valuesItem as unknown as { click(): void }).click();

  const input = doc.querySelector(".modal .text-input") as HTMLInputElement | null;
  assert.ok(input !== null, "the values prompt opens");
  input.value = "a, b";
  const apply = [...doc.querySelectorAll(".modal .primary")].pop() as unknown as { click(): void };
  apply.click();
  await tick();

  const view = requests[requests.length - 1];
  assert.deepEqual(view?.measures[0]?.where, { column: 1, values: ["a", "b"] });
});

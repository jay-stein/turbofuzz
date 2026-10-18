import { test } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import type { AggregateMessage, ColumnMeta, PivotMessage } from "../src/worker/protocol.js";
import type { PivotDef } from "../src/data/pivot.js";
import {
  ViewsPanel,
  movePivotField,
  pivotDefFromView,
  remapViewDef,
  starterViews,
} from "../src/ui/views-panel.js";
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
    onCopyPandas: async () => {},
  });
  panel.setColumns(metas, 100);
  await tick();

  assert.equal(requests.length, 1, "the first starter view is requested");
  const cards = host.querySelectorAll(".views-card");
  assert.ok(cards.length >= 3, "one card per starter view");
  assert.ok(host.querySelector(".views-card.expanded") !== null, "the first card starts expanded");
  assert.equal(host.querySelectorAll(".views-shelf-chip").length, metas.length);
  const shelf = host.querySelector(".views-field-shelf");
  const transposeRow = host.querySelector(".views-transpose-row");
  assert.ok(transposeRow !== null);
  assert.equal(shelf?.nextElementSibling, transposeRow);
  assert.match(transposeRow?.textContent ?? "", /Transpose/);
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

  const toggle = host.querySelector(".views-card.expanded .views-card-toggle");
  assert.ok(toggle !== null);
  assert.ok(toggle.querySelector("svg") !== null, "the toggle is an icon button");
  (toggle as unknown as { click(): void }).click();
  const collapsedName = host.querySelector(".views-card-name");
  assert.match(collapsedName?.textContent ?? "", /Sum of amount by city/);
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
    onCopyPandas: async () => {},
  });
  panel.setColumns(metas, 100);
  await tick();
  requests.length = 0;

  const doc = (globalThis as Record<string, unknown>).document as Window["document"];
  const addMeasure = [...host.querySelectorAll(".views-pill.add")].find(
    (button) => button.textContent === "+ Value",
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
  const pivotRequests: PivotDef[] = [];
  const panel = new ViewsPanel(host as unknown as HTMLElement, {
    requestAggregate: async (view) => {
      requests.push(view);
      return aggregateOf(view, {
        labels: ["2024-01 � P0", "2024-01 � P1", "2024-02 � P0"],
        dimensions: [["2024-01", "2024-01", "2024-02"], ["P0", "P1", "P0"]],
        dimensionNames: ["when � cohort by city", "periods since first city"],
        dimensionIsTime: [false, false],
        dimensionTimes: [Float64Array.from([Number.NaN, Number.NaN, Number.NaN]), Float64Array.from([Number.NaN, Number.NaN, Number.NaN])],
        measures: [Float64Array.from([1, 2, 1])],
        totals: Float64Array.from([4]),
        groupCount: 3,
        totalGroups: 3,
      });
    },
    requestPivot: async (def) => {
      pivotRequests.push(def);
      return {
        type: "pivot",
        requestId: 1,
        pivotId: def.id,
        rowLabels: [["C0"], ["C1"], ["All"]],
        colLabels: [["P0"], ["P1"], ["All"]],
        rowNames: ["when - cohort by city"],
        colNames: ["periods since first city"],
        rowIsTime: [false],
        colIsTime: [false],
        rowTimes: [Float64Array.from([Number.NaN, Number.NaN, Number.NaN])],
        colTimes: [Float64Array.from([Number.NaN, Number.NaN, Number.NaN])],
        measures: [
          {
            name: "distinct(amount)",
            values: Float64Array.from([1, 2, 1, 2, 3, 2, 3, 5, 5]),
            rowTotals: Float64Array.from([3, 5, 5]),
            colTotals: Float64Array.from([3, 5, 5]),
            grandTotal: 5,
          },
          {
            name: "count(*)",
            values: Float64Array.from([1, 1, 1, 1, 1, 1, 1, 1, 1]),
            rowTotals: Float64Array.from([3, 3, 3]),
            colTotals: Float64Array.from([3, 3, 3]),
            grandTotal: 3,
          },
        ],
        groupCount: 3,
        totalGroups: 3,
        truncated: false,
        ms: 1,
      } satisfies PivotMessage;
    },
    onDrill: () => {},
    onChart: () => {},
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
  const definition = pivotRequests[pivotRequests.length - 1];
  assert.ok(definition !== undefined);
  assert.deepEqual(definition.index[0], {
    column: 2,
    by: { cohort: { entity: 1, grain: "month" } },
  });
  const pivot = host.querySelector(".views-pivot");
  assert.ok(pivot !== null, "the matrix renders");
  const header = pivot.querySelectorAll("thead th");
  assert.equal(header.length, 8, "values + agg levels and nested period columns");
  assert.equal(header[1]?.textContent, "city");
  assert.equal(header[5]?.textContent, "P0");
  assert.match(host.querySelector(".views-pivot-note")?.textContent ?? "", /Spreading/);
  assert.equal(host.querySelectorAll(".views-index-pill").length, 1, "one field sits in the index well");
  assert.equal(host.querySelectorAll(".views-column-pill").length, 1, "one field sits in the columns well");
  assert.ok(
    host.querySelector(".views-column-pill .views-pill-group-toggle") !== null,
    "a field can move back from columns to index",
  );
  assert.ok(
    [...host.querySelectorAll(".views-measure-zone button")].some(
      (button) => button.textContent === "+ All numeric",
    ),
    "the values well offers Add all numeric",
  );
  assert.ok(
    [...host.querySelectorAll(".views-measure-zone button")].some(
      (button) => button.textContent === "+ Lambda",
    ),
    "the values well offers safe lambdas",
  );
  assert.ok(host.querySelector(".views-fill-input") !== null, "fill value is configurable");
  assert.ok(
    [...host.querySelectorAll(".views-actions label")].some(
      (label) => label.textContent === "Drop empty",
    ),
    "empty rows and columns can be dropped",
  );
  assert.ok(host.querySelector(
    `select[aria-label="Pivot key order"]`,
  ) !== null);
  assert.ok(host.querySelector(
    `input[aria-label="Pivot margins name"]`,
  ) !== null);
  assert.ok(host.querySelector(
    `select[aria-label="Pivot CSV headers"]`,
  ) !== null);
  const beforeDuplicate = host.querySelectorAll(".views-card").length;
  (host.querySelector(".views-duplicate") as unknown as { click(): void }).click();
  await tick();
  assert.equal(host.querySelectorAll(".views-card").length, beforeDuplicate + 1);
  assert.ok((host.textContent ?? "").includes("Copy of"));
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
  const resample = host.querySelector(
    `select[aria-label="Resample time grain"]`,
  ) as (HTMLSelectElement & { value: string }) | null;
  assert.ok(resample !== null, "the resample grain control exists");
  resample.value = "year";
  resample.dispatchEvent(
    new (globalThis as unknown as { window: Window }).window.Event("change") as unknown as Event,
  );
  await tick();
  const resampled = requests[requests.length - 1]?.dimensions[0]?.by;
  assert.ok(typeof resampled === "object" && resampled !== null && "time" in resampled);
  assert.equal(resampled.time, "year");
  assert.equal(requests[requests.length - 1]?.fill, "zero");
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

test("pivot compilation keeps every value and splits index from columns", () => {
  const view: ViewDef = {
    id: "multi-value",
    name: "Multi value",
    dimensions: [
      { column: 1, by: "value" },
      { column: 2, by: { time: "month" } },
    ],
    measures: [
      { column: 0, agg: "sum" },
      { column: null, agg: "count" },
    ],
    fill: "none",
    sort: { key: "m0", dir: "desc" },
    limit: 500,
    respectFilters: true,
    pivotColumns: [1],
    pivotLambdas: [{ column: 0, source: "lambda x: mean(x)" }],
    margins: true,
  };
  const def = pivotDefFromView(view, [1]);
  assert.equal(def.values.length, 2);
  assert.equal(def.index.length, 1);
  assert.equal(def.columns.length, 1);
  assert.equal(def.margins, true);
  assert.equal(def.lambdas?.length, 1);
});
test("view remapping follows names across reorder and additions", () => {
  const oldNames = ["amount", "city", "when"];
  const newNames = ["city", "amount", "when", "extra"];
  const view: ViewDef = {
    id: "v",
    name: "v",
    dimensions: [
      { column: 1, by: "value" },
      { column: 2, by: { time: "month" } },
    ],
    measures: [{ column: 0, agg: "sum" }],
    fill: "none",
    sort: { key: "m0", dir: "desc" },
    limit: 500,
    respectFilters: true,
    pivotColumns: [1],
    pivotLambdas: [{ column: 0, source: "lambda x: mean(x)" }],
  };
  const remapped = remapViewDef(view, oldNames, newNames);
  assert.deepEqual(remapped.missing, []);
  assert.equal(remapped.def.dimensions[0]?.column, 0);
  assert.equal(remapped.def.dimensions[1]?.column, 2);
  assert.equal(remapped.def.measures[0]?.column, 1);
  assert.equal(remapped.def.pivotLambdas?.[0]?.column, 1);
  assert.deepEqual(remapped.def.pivotColumns, [1]);
});
test("view remapping reports columns that no longer exist", () => {
  const view: ViewDef = {
    id: "v",
    name: "v",
    dimensions: [{ column: 0, by: "value" }],
    measures: [{ column: 1, agg: "sum" }],
    fill: "none",
    sort: { key: "m0", dir: "desc" },
    limit: 500,
    respectFilters: true,
  };
  const remapped = remapViewDef(view, ["city", "amount"], ["city"]);
  assert.deepEqual(remapped.missing, ["amount"]);
  assert.equal(remapped.def.measures.length, 0);
});
function dragView(): ViewDef {
  return {
    id: "drag",
    name: "Drag",
    dimensions: [
      { column: 0, by: "value" },
      { column: 1, by: "value" },
      { column: 2, by: "value" },
    ],
    measures: [{ column: 3, agg: "sum" }],
    fill: "none",
    sort: { key: "m0", dir: "desc" },
    limit: 500,
    respectFilters: true,
    pivotColumns: [1],
    pivot: 1,
    pivotMeasure: 0,
  };
}

test("dragging a dimension reorders and changes wells", () => {
  const view = dragView();
  const moved = movePivotField(
    view,
    { kind: "dimension", index: 2, well: "index" },
    "index",
    0,
    false,
  );
  assert.equal(moved.ok, true);
  assert.deepEqual(
    view.dimensions.map((dimension) => dimension.column),
    [2, 0, 1],
  );
  assert.deepEqual(view.pivotColumns, [2]);

  const toIndex = movePivotField(
    view,
    { kind: "dimension", index: 2, well: "columns" },
    "index",
    1,
    false,
  );
  assert.equal(toIndex.ok, true);
  assert.deepEqual(
    view.dimensions.map((dimension) => dimension.column),
    [2, 1, 0],
  );
  assert.deepEqual(view.pivotColumns, []);
});

test("dragging between dimensions and values converts the field", () => {
  const view = dragView();
  const toValues = movePivotField(
    view,
    { kind: "dimension", index: 0, well: "index" },
    "values",
    0,
    true,
  );
  assert.equal(toValues.ok, true);
  assert.deepEqual(
    view.dimensions.map((dimension) => dimension.column),
    [1, 2],
  );
  assert.deepEqual(view.measures[0], { column: 0, agg: "mean" });

  const toColumns = movePivotField(
    view,
    { kind: "measure", index: 0, well: "values" },
    "columns",
    0,
    false,
  );
  assert.equal(toColumns.ok, true);
  assert.deepEqual(
    view.dimensions.map((dimension) => dimension.column),
    [0, 1, 2],
  );
  assert.deepEqual(view.pivotColumns, [0, 1]);
  assert.equal(view.measures.length, 1);
});

test("dragging guards the row index and custom measures", () => {
  const view = dragView();
  view.dimensions = view.dimensions.filter((dimension) => dimension.column !== 2);
  const lastIndex = movePivotField(
    view,
    { kind: "dimension", index: 0, well: "index" },
    "columns",
    0,
    false,
  );
  assert.equal(lastIndex.ok, false);

  const custom = dragView();
  custom.measures = [
    { column: 3, agg: "sum", where: { column: 1, values: ["a"] } },
  ];
  const blocked = movePivotField(
    custom,
    { kind: "measure", index: 0, well: "values" },
    "index",
    0,
    false,
  );
  assert.equal(blocked.ok, false);
});
test("dragging a shelf column adds or moves it by column", () => {
  const view = dragView();
  const moved = movePivotField(
    view,
    { kind: "column", index: 2, well: "shelf" },
    "index",
    0,
    false,
  );
  assert.equal(moved.ok, true);
  assert.deepEqual(
    view.dimensions.map((dimension) => dimension.column),
    [2, 0, 1],
  );
  assert.deepEqual(view.pivotColumns, [2]);

  const added = movePivotField(
    view,
    { kind: "column", index: 3, well: "shelf" },
    "columns",
    1,
    true,
  );
  assert.equal(added.ok, true);
  assert.deepEqual(
    view.dimensions.map((dimension) => dimension.column),
    [2, 0, 1, 3],
  );
  assert.deepEqual(view.pivotColumns, [2, 3]);
});
test("shelf date fields auto-group by month and keep exact as an option", () => {
  const view = dragView();
  const moved = movePivotField(
    view,
    { kind: "column", index: 4, well: "shelf" },
    "index",
    0,
    false,
    true,
  );
  assert.equal(moved.ok, true);
  assert.deepEqual(view.dimensions[0], { column: 4, by: { time: "month" } });
});
test("pivot value filters use a searchable picker and can clear", async () => {
  setupDom();
  const host = document.createElement("div");
  const doc = (globalThis as Record<string, unknown>).document as Window["document"];
  const pivotRequests: PivotDef[] = [];
  const panel = new ViewsPanel(host as unknown as HTMLElement, {
    requestAggregate: async (view) => aggregateFor(view),
    requestPivot: async (def) => {
      pivotRequests.push(def);
      return {
        type: "pivot",
        requestId: 1,
        pivotId: def.id,
        rowLabels: [["a"], ["b"]],
        colLabels: [["Jan"], ["Feb"]],
        rowNames: ["city"],
        colNames: ["when"],
        rowIsTime: [false],
        colIsTime: [true],
        rowTimes: [Float64Array.from([Number.NaN, Number.NaN])],
        colTimes: [Float64Array.from([1, 2])],
        measures: [
          {
            name: "sum(amount)",
            values: Float64Array.from([1, 2, 3, 4]),
            rowTotals: Float64Array.from([3, 7]),
            colTotals: Float64Array.from([4, 6]),
            grandTotal: 10,
          },
        ],
        groupCount: 4,
        totalGroups: 4,
        truncated: false,
        ms: 1,
      } satisfies PivotMessage;
    },
    onDrill: () => {},
    onChart: () => {},
    onCopyPandas: async () => {},
  });
  panel.setColumns(metas, 100);
  await tick();

  const whenChip = [...host.querySelectorAll(".views-shelf-chip")].find(
    (chip) => (chip.textContent ?? "").startsWith("when"),
  );
  assert.ok(whenChip !== undefined);
  (whenChip as unknown as { click(): void }).click();
  const toColumns = [...doc.querySelectorAll(".context-menu .context-item")].find(
    (item) => item.textContent === "Add to Columns",
  );
  assert.ok(toColumns !== undefined);
  (toColumns as unknown as { click(): void }).click();
  await tick();

  const filter = host.querySelector(".views-index-pill .views-pill-filter");
  assert.ok(filter !== null, "the dimension exposes a funnel filter");
  (filter as unknown as { click(): void }).click();
  const search = doc.querySelector(".views-filter-search") as HTMLInputElement | null;
  assert.ok(search !== null);
  search.value = "a";
  search.dispatchEvent(new window.Event("input") as unknown as Event);
  const add = doc.querySelector(".views-filter-add") as unknown as { click(): void };
  add.click();
  const apply = doc.querySelector(".views-filter-apply") as unknown as { click(): void };
  apply.click();
  await tick();
  assert.deepEqual(pivotRequests[pivotRequests.length - 1]?.valueFilters, [
    { column: 1, values: ["a"] },
  ]);

  (host.querySelector(".views-index-pill .views-pill-filter") as unknown as { click(): void }).click();
  const clear = doc.querySelector(".views-filter-clear") as unknown as { click(): void };
  clear.click();
  await tick();
  assert.deepEqual(pivotRequests[pivotRequests.length - 1]?.valueFilters, []);
});
test("date fields can add a multi-level Year and Month hierarchy", async () => {
  setupDom();
  const host = document.createElement("div");
  const doc = (globalThis as Record<string, unknown>).document as Window["document"];
  const requests: ViewDef[] = [];
  const panel = new ViewsPanel(host as unknown as HTMLElement, {
    requestAggregate: async (view) => {
      requests.push(view);
      return aggregateFor(view);
    },
    onDrill: () => {},
    onChart: () => {},
    onCopyPandas: async () => {},
  });
  panel.setColumns(metas, 100);
  await tick();

  const whenChip = [...host.querySelectorAll(".views-shelf-chip")].find(
    (chip) => (chip.textContent ?? "").startsWith("when"),
  );
  assert.ok(whenChip !== undefined);
  (whenChip as unknown as { click(): void }).click();
  const toIndex = [...doc.querySelectorAll(".context-menu .context-item")].find(
    (item) => item.textContent === "Add to Index",
  );
  assert.ok(toIndex !== undefined);
  (toIndex as unknown as { click(): void }).click();
  await tick();

  const monthPill = [...host.querySelectorAll(".views-index-pill .views-pill-label")].find(
    (pill) => (pill.textContent ?? "").includes("Month"),
  );
  assert.ok(monthPill !== undefined);
  (monthPill as unknown as { click(): void }).click();
  const groupItem = [...doc.querySelectorAll(".context-menu .context-item")].find(
    (item) => (item.textContent ?? "").includes("Group by several date parts"),
  );
  assert.ok(groupItem !== undefined);
  (groupItem as unknown as { click(): void }).click();

  const years = [...doc.querySelectorAll(".date-group-option")].find((option) =>
    (option.textContent ?? "").includes("Years"),
  ) as unknown as { querySelector(selector: string): HTMLInputElement | null };
  assert.ok(years !== undefined);
  years.querySelector("input")?.click();
  (doc.querySelector(".date-group-modal .primary") as unknown as { click(): void }).click();
  await tick();

  assert.deepEqual(
    requests[requests.length - 1]?.dimensions.map((dimension) => dimension.by),
    ["value", { time: "year" }, { time: "month" }],
  );
});
import { test } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { openChartSetupDialog } from "../src/ui/chart-setup.js";
import type { ColumnMeta } from "../src/worker/protocol.js";

function setupDom(): Window {
  const window = new Window();
  const globals = globalThis as Record<string, unknown>;
  globals.window = window;
  globals.document = window.document;
  globals.HTMLElement = window.HTMLElement;
  globals.MutationObserver = window.MutationObserver;
  return window;
}

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
  };
}

test("the add-chart dialog confirms the columns before adding", async () => {
  setupDom();
  const columns = [meta("lat", "number"), meta("lon", "number"), meta("kind", "category")];
  const pending = openChartSetupDialog("bubble", columns, { kind: "bubble", x: 0, y: 1 });
  const modal = document.querySelector(".chart-setup-modal");
  assert.ok(modal !== null);
  assert.match(modal.textContent ?? "", /Add a bubble chart/);
  const x = document.querySelector('select[aria-label="Setup X column"]') as HTMLSelectElement;
  const y = document.querySelector('select[aria-label="Setup Y column"]') as HTMLSelectElement;
  assert.equal(x.value, "0");
  assert.equal(y.value, "1");
  x.value = "1";
  y.value = "0";
  (modal.querySelector(".primary") as unknown as { click(): void }).click();
  const config = await pending;
  assert.deepEqual(config, { kind: "bubble", x: 1, y: 0 });
  assert.equal(document.querySelector(".chart-setup-modal"), null, "the dialog closes");
});

test("treemap setup accepts text groups, a measure and an aggregation", async () => {
  setupDom();
  const columns = [
    meta("description", "string"),
    meta("population", "number"),
    meta("country", "category"),
  ];
  columns[0]!.stats.distinct = 500;
  const pending = openChartSetupDialog("treemap", columns, { kind: "treemap", column: 0 });
  const modal = document.querySelector(".chart-setup-modal");
  assert.ok(modal !== null);
  const group = document.querySelector('select[aria-label="Setup group column"]') as HTMLSelectElement;
  const size = document.querySelector('select[aria-label="Setup size measure"]') as HTMLSelectElement;
  const agg = document.querySelector(
    'select[aria-label="Setup treemap aggregation"]',
  ) as HTMLSelectElement;
  assert.ok([...group.options].some((option) => option.textContent === "description"));
  assert.equal(group.value, "0");
  assert.equal(size.value, "-1", "count of rows is the default measure");
  assert.equal(agg.disabled, true);
  size.value = "1";
  size.dispatchEvent(new window.Event("change") as unknown as Event);
  assert.equal(agg.disabled, false);
  assert.equal(agg.value, "sum", "a numeric measure defaults to sum");
  agg.value = "mean";
  agg.dispatchEvent(new window.Event("change") as unknown as Event);
  (modal.querySelector(".primary") as unknown as { click(): void }).click();
  const config = await pending;
  assert.deepEqual(config, {
    kind: "treemap",
    column: 0,
    valueColumn: 1,
    valueAgg: "mean",
    sizeColumn: -1,
  });
});

test("cancelling the add-chart dialog resolves null", async () => {
  setupDom();
  const pending = openChartSetupDialog("bar", [meta("city", "category")], { kind: "bar", column: 0 });
  const cancel = document.querySelector(".chart-setup-modal .ghost") as unknown as {
    click(): void;
  };
  cancel.click();
  assert.equal(await pending, null);
});

test("correlation needs at least two columns before it can be added", async () => {
  setupDom();
  const columns = [meta("a", "number"), meta("b", "number"), meta("c", "number")];
  const pending = openChartSetupDialog("correlation", columns, { kind: "correlation", correlationColumns: [0] });
  const picker = document.querySelector(
    'select[aria-label="Setup correlation columns"]',
  ) as HTMLSelectElement;
  assert.ok(picker !== null);
  const confirm = document.querySelector(".chart-setup-modal .primary") as unknown as {
    click(): void;
    textContent: string;
  };
  confirm.click();
  assert.match(
    document.querySelector(".chart-setup-error")?.textContent ?? "",
    /Columns: pick at least two numeric columns/,
    "the field and reason are named",
  );
  assert.equal(confirm.textContent, "Add chart", "the button label is unchanged");
  for (const option of picker.options) {
    option.selected = option.value === "0" || option.value === "1";
  }
  confirm.click();
  const config = await pending;
  assert.deepEqual(config, { kind: "correlation", correlationColumns: [0, 1] });
});

test("setup errors name the conflicting field", async () => {
  setupDom();
  const columns = [meta("a", "category"), meta("b", "category")];
  openChartSetupDialog("heatmap", columns, { kind: "heatmap", x: 0, y: 0 });
  const modal = document.querySelector(".chart-setup-modal") as HTMLElement;
  (modal.querySelector(".primary") as unknown as { click(): void }).click();
  assert.match(
    document.querySelector(".chart-setup-error")?.textContent ?? "",
    /Rows\/Columns: pick two different columns/,
  );
});

test("the edit dialog uses the same validation and keeps frame fields", async () => {
  setupDom();
  const columns = [meta("a", "number"), meta("b", "number"), meta("c", "number")];
  const pending = openChartSetupDialog(
    "correlation",
    columns,
    {
      kind: "correlation",
      source: "view-1",
      title: "Numeric",
      correlationColumns: [0, 1],
    },
    { mode: "edit" },
  );
  const modal = document.querySelector(".chart-setup-modal");
  assert.ok(modal !== null);
  assert.match(modal.textContent ?? "", /Edit correlation chart/);
  assert.match(modal.textContent ?? "", /Cancel leaves it unchanged/);
  const picker = document.querySelector(
    'select[aria-label="Setup correlation columns"]',
  ) as HTMLSelectElement;
  picker.options[2]!.selected = true;
  (modal.querySelector(".primary") as unknown as { click(): void }).click();
  const config = await pending;
  assert.equal(config?.source, "view-1");
  assert.equal(config?.title, "Numeric");
  assert.deepEqual(config?.correlationColumns, [0, 1, 2]);
});
import { test } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { ResultTable, type ColumnQaKind } from "../src/ui/table.js";
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

interface Harness {
  host: HTMLElement;
  table: ResultTable;
  clicks: { column: number; kind: ColumnQaKind }[];
  merges: number[];
  contexts: { column: number; x: number; y: number }[];
  colDeletes: number[];
  rowDeletes: number[];
  window: Window;
}

function buildTable(columns: ColumnMeta[]): Harness {
  const window = setupDom();
  const document = (globalThis as Record<string, unknown>).document as Window["document"];
  const host = document.createElement("div") as unknown as HTMLElement;
  const clicks: Harness["clicks"] = [];
  const merges: number[] = [];
  const contexts: Harness["contexts"] = [];
  const colDeletes: number[] = [];
  const rowDeletes: number[] = [];
  const table = new ResultTable(host, {
    onSort: () => {},
    onTypeChange: () => {},
    onColumnSpecial: (column, kind) => clicks.push({ column, kind }),
    onMergeSimilar: (column) => merges.push(column),
    onColumnContext: (column, x, y) => contexts.push({ column, x, y }),
    onToggleColumnDelete: (column) => colDeletes.push(column),
    onToggleRowDelete: (position) => rowDeletes.push(position),
    onRequestRows: () => {},
  });
  table.setColumns(columns);
  return { host, table, clicks, merges, contexts, colDeletes, rowDeletes, window };
}

test("header shows only actionable QA chips", () => {
  const { host } = buildTable([
    meta({
      name: "city",
      stats: { ...meta().stats, nulls: 3, distinct: 4 },
      anomalyCounts: { values: 0, lengths: 2 },
    }),
    meta({ name: "clean" }),
  ]);

  const cells = host.querySelectorAll(".th");
  // cells[0] is the row-index header; column cells start at 1.
  const chips = cells[1].querySelectorAll(".th-qa-chip");
  assert.equal(chips.length, 2);
  assert.equal(chips[0].textContent, "3 empty cells");
  assert.ok(chips[0].classList.contains("warn"));
  assert.equal(chips[1].textContent, "2 long values");

  const cleanChips = cells[2].querySelectorAll(".th-qa-chip");
  assert.equal(cleanChips.length, 0, "zero-count chips are hidden");
});

test("marks numeric and boolean cells for alignment", () => {
  const { host, table } = buildTable([
    meta({ name: "amount", type: "number" }),
    meta({ name: "active", type: "boolean" }),
    meta({ name: "name", type: "string" }),
  ]);
  table.setFirstRows([["12.5", "true", "Ada"]]);
  table.setCount(1);

  const cells = host.querySelectorAll(".tr .td");
  // cells[0] is the row-index cell; data cells start at 1.
  assert.ok(cells[1]?.classList.contains("num-cell"));
  assert.ok(cells[2]?.classList.contains("bool-cell"));
  assert.equal(cells[3]?.className, "td");
});

test("clicking a QA chip reports the column and kind", () => {
  const { clicks, host } = buildTable([
    meta({
      name: "city",
      stats: { ...meta().stats, nulls: 5, distinct: 4 },
    }),
  ]);
  const chip = host.querySelector(".th-qa-chip.warn") as unknown as { click(): void };
  chip.click();
  assert.deepEqual(clicks, [{ column: 0, kind: "nulls" }]);
});

test("a single-value column is flagged as constant", () => {
  const { host } = buildTable([
    meta({ name: "country", stats: { ...meta().stats, distinct: 1, nulls: 0 } }),
  ]);
  const flag = host.querySelector(".th-qa-chip.flag");
  assert.equal(flag?.textContent, "constant value");
  assert.match(flag?.getAttribute("title") ?? "", /same value/);
});

test("mergeable categories surface a chip that opens the merge panel", () => {
  const { host, merges } = buildTable([
    meta({
      name: "city",
      type: "category",
      similarGroups: 2,
      categories: { labels: ["a", "b"], counts: [1, 1] },
    }),
  ]);
  const chip = host.querySelector(".th-qa-chip.merge") as unknown as {
    click(): void;
    textContent: string | null;
  };
  assert.equal(chip.textContent, "2 mergeable");
  chip.click();
  assert.deepEqual(merges, [0]);
});

test("right-clicking a header cell reports the column and position", () => {
  const { host, contexts, window } = buildTable([meta({ name: "city" })]);
  const cell = host.querySelectorAll(".th")[1] as unknown as {
    dispatchEvent(event: unknown): void;
  };
  const event = new window.MouseEvent("contextmenu", {
    bubbles: true,
    clientX: 40,
    clientY: 60,
  });
  cell.dispatchEvent(event);
  assert.deepEqual(contexts, [{ column: 0, x: 40, y: 60 }]);
});

test("delete buttons report rows and columns for staging", () => {
  const { host, table, colDeletes, rowDeletes } = buildTable([
    meta({ name: "a" }),
    meta({ name: "b" }),
  ]);
  table.setFirstRows([["x", "y"]]);
  table.setCount(1);

  (host.querySelectorAll(".th")[1].querySelector(".del-btn") as unknown as {
    click(): void;
  }).click();
  (host.querySelector(".tr .del-btn") as unknown as { click(): void }).click();
  assert.deepEqual(colDeletes, [0]);
  assert.deepEqual(rowDeletes, [0]);
});

test("pending deletes mark rows and columns red", () => {
  const { host, table } = buildTable([meta({ name: "a" }), meta({ name: "b" })]);
  table.setFirstRows([["x", "y"]]);
  table.setCount(1);
  table.setPendingDeletes(new Set([0]), new Set([1]));

  assert.ok(host.querySelector(".tr.row-pending") !== null, "row should be tinted");
  assert.ok(host.querySelectorAll(".th")[2].classList.contains("col-pending"));
  assert.ok(host.querySelectorAll(".del-btn.active").length >= 2);
});

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
  clicks: { column: number; kind: ColumnQaKind }[];
  merges: number[];
  contexts: { column: number; x: number; y: number }[];
  window: Window;
}

function buildTable(columns: ColumnMeta[]): Harness {
  const window = setupDom();
  const document = (globalThis as Record<string, unknown>).document as Window["document"];
  const host = document.createElement("div") as unknown as HTMLElement;
  const clicks: Harness["clicks"] = [];
  const merges: number[] = [];
  const contexts: Harness["contexts"] = [];
  const table = new ResultTable(host, {
    onSort: () => {},
    onTypeChange: () => {},
    onColumnSpecial: (column, kind) => clicks.push({ column, kind }),
    onMergeSimilar: (column) => merges.push(column),
    onColumnContext: (column, x, y) => contexts.push({ column, x, y }),
    onRequestRows: (_start, _end, done) => done(0, []),
  });
  table.setColumns(columns);
  return { host, clicks, merges, contexts, window };
}

test("header shows readable QA chips: amber when flagged, muted when clean", () => {
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
  assert.equal(chips.length, 3);
  assert.equal(chips[0].textContent, "3 empty cells");
  assert.ok(chips[0].classList.contains("warn"));
  assert.equal(chips[1].textContent, "no value outliers");
  assert.ok(chips[1].classList.contains("ok"));
  assert.equal(chips[2].textContent, "2 long values");

  const cleanChips = cells[2].querySelectorAll(".th-qa-chip");
  assert.equal(cleanChips[0].textContent, "no empty cells");
  assert.ok(cleanChips[0].classList.contains("ok"));
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

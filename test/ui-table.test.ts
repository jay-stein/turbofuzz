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

function buildTable(columns: ColumnMeta[]): {
  table: ResultTable;
  clicks: { column: number; kind: ColumnQaKind }[];
  host: HTMLElement;
} {
  const window = setupDom();
  const document = (globalThis as Record<string, unknown>).document as Window["document"];
  const host = document.createElement("div") as unknown as HTMLElement;
  const clicks: { column: number; kind: ColumnQaKind }[] = [];
  const table = new ResultTable(host, {
    onSort: () => {},
    onTypeChange: () => {},
    onColumnSpecial: (column, kind) => clicks.push({ column, kind }),
    onRequestRows: (_start, _end, done) => done(0, []),
  });
  table.setColumns(columns);
  return { table, clicks, host };
}

test("header shows amber QA chips for flagged columns and muted ones when clean", () => {
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
  const city = cells[1];
  const chips = city.querySelectorAll(".th-qa-chip");
  assert.equal(chips.length, 3);
  assert.match(chips[0].textContent ?? "", /∅ 3/);
  assert.ok(chips[0].classList.contains("warn"));
  assert.ok(!chips[1].classList.contains("warn"));
  assert.match(chips[2].textContent ?? "", /… 2/);

  const clean = cells[2];
  const cleanChips = clean.querySelectorAll(".th-qa-chip");
  assert.ok(cleanChips[0].classList.contains("ok"));
});

test("clicking a QA chip reports the column and kind", () => {
  const { clicks, host } = buildTable([
    meta({
      name: "city",
      stats: { ...meta().stats, nulls: 5, distinct: 4 },
    }),
  ]);
  const chip = host.querySelector(".th-qa-chip.warn") as unknown as {
    click(): void;
  };
  chip.click();
  assert.deepEqual(clicks, [{ column: 0, kind: "nulls" }]);
});

test("a single-value column is flagged as constant", () => {
  const { host } = buildTable([
    meta({ name: "country", stats: { ...meta().stats, distinct: 1, nulls: 0 } }),
  ]);
  const flag = host.querySelector(".th-qa-chip.flag");
  assert.equal(flag?.textContent, "1 value");
  assert.match(flag?.getAttribute("title") ?? "", /same value/);
});

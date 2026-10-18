import { test } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import type { ColumnSuggestion } from "../src/data/suggestions.js";
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
  fixes: { column: number; suggestion: ColumnSuggestion }[];
  converts: { column: number; tokens: string[] }[];
  inspects: number[];
  quick: { column: number; query: string }[];
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
  const fixes: Harness["fixes"] = [];
  const converts: Harness["converts"] = [];
  const inspects: number[] = [];
  const quick: Harness["quick"] = [];
  const table = new ResultTable(host, {
    onSort: () => {},
    onColumnInspect: (column) => inspects.push(column),
    onTypeChange: () => {},
    onQuickFilter: (column, query) => quick.push({ column, query }),
    onColumnSpecial: (column, kind) => clicks.push({ column, kind }),
    onMergeSimilar: (column) => merges.push(column),
    onColumnContext: (column, x, y) => contexts.push({ column, x, y }),
    onToggleColumnDelete: (column) => colDeletes.push(column),
    onToggleRowDelete: (position) => rowDeletes.push(position),
    onSuggestion: (column, suggestion) => fixes.push({ column, suggestion }),
    onConvertToken: (column, tokens) => converts.push({ column, tokens }),
    onRequestRows: () => {},
  });
  table.setColumns(columns);
  return {
    host,
    table,
    clicks,
    merges,
    contexts,
    colDeletes,
    rowDeletes,
    fixes,
    converts,
    inspects,
    quick,
    window,
  };
}

test("header shows only actionable QA chips", () => {
  const { host, clicks } = buildTable([
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
  assert.equal(chips.length, 1);
  assert.equal(chips[0].textContent, "2 issues");
  assert.ok(chips[0].classList.contains("warn"));

  (chips[0] as unknown as { click(): void }).click();
  const document = (globalThis as Record<string, unknown>).document as Window["document"];
  const items = [...document.querySelectorAll(".context-menu .context-item")];
  assert.deepEqual(
    items.map((item) => item.textContent),
    ["3 empty cells", "2 long values"],
  );
  (items[1] as unknown as { click(): void }).click();
  assert.deepEqual(clicks, [{ column: 0, kind: "lengthAnomalies" }]);

  const cleanChips = cells[2].querySelectorAll(".th-qa-chip");
  assert.equal(cleanChips.length, 0, "zero-count chips are hidden");
});

test("header shows one-click fix chips for column suggestions", () => {
  const { host, fixes } = buildTable([
    meta({
      name: "Amount",
      type: "number",
      suggestions: [
        { kind: "mixedNumber", locale: "dot", count: 55, ratio: 0.03, sampled: 1951 },
        { kind: "sentinel", value: "-999", count: 38, ratio: 0.02, sampled: 1951 },
      ],
    }),
  ]);

  const cells = host.querySelectorAll(".th");
  const chips = cells[1].querySelectorAll(".th-qa-chip.fix");
  assert.equal(chips.length, 2);
  assert.equal(chips[0].textContent, "Fix: repair 55 mixed decimals");
  assert.equal(chips[1].textContent, "Fix: treat “-999” as missing");

  (chips[0] as unknown as { click(): void }).click();
  assert.equal(fixes.length, 1);
  assert.equal(fixes[0].column, 0);
  assert.equal(fixes[0].suggestion.kind, "mixedNumber");
});

test("marks numeric and boolean cells for alignment", () => {  const { host, table } = buildTable([
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
  assert.equal(chip.textContent, "2 similar pairs");
  chip.click();
  const document = (globalThis as Record<string, unknown>).document as Window["document"];
  const action = [...document.querySelectorAll(".context-menu .context-item")].find(
    (button) => button.textContent === "Merge values…",
  ) as unknown as { click(): void } | undefined;
  assert.ok(action !== undefined, "the popover offers the Merge panel");
  action.click();
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

test("placeholder null tokens keep a bold red cell marker", () => {
  const { host, table } = buildTable([meta({ name: "amount" })]);
  table.setFirstRows([["NA"], [""], ["12"]]);
  table.setCount(3);

  const rows = host.querySelectorAll(".tr");
  const cellOf = (index: number): HTMLElement =>
    rows[index].querySelectorAll(".td")[1] as unknown as HTMLElement;
  const tokenCell = cellOf(0);
  const blankCell = cellOf(1);
  const valueCell = cellOf(2);

  assert.ok(tokenCell.classList.contains("null-cell"));
  assert.ok(tokenCell.classList.contains("null-token-cell"));
  assert.match(tokenCell.getAttribute("title") ?? "", /read as a missing value/);
  assert.ok(blankCell.classList.contains("null-cell"));
  assert.equal(blankCell.classList.contains("null-token-cell"), false);
  assert.equal(valueCell.classList.contains("null-cell"), false);
});

test("placeholder tokens get a header chip that blanks them in one column", () => {
  const { host, converts } = buildTable([
    meta({
      name: "amount",
      stats: { ...meta().stats, nulls: 12 },
      nullTokens: [
        { label: "NA", count: 7 },
        { label: "TBD", count: 2 },
        { label: "", count: 3 },
      ],
    }),
  ]);
  const chip = host.querySelector(".th-qa-chip.token") as unknown as {
    textContent: string;
    title: string;
    click(): void;
  };
  assert.equal(chip.textContent, "9 placeholders");
  assert.match(chip.title, /12 cells in “amount” are missing/);
  assert.match(chip.title, /3 blank \+ 9 placeholder text/);
  assert.match(chip.title, /blank the placeholder text “NA”, “TBD”/);
  assert.doesNotMatch(chip.title, /“”/);
  assert.equal(
    host.querySelectorAll(".th-qa-chip.warn").length,
    0,
    "the generic empty-cell chip is replaced",
  );
  chip.click();
  assert.deepEqual(converts, [{ column: 0, tokens: ["NA", "TBD"] }]);
});

test("columns with only blank cells get no placeholder chip", () => {
  const { host } = buildTable([
    meta({ name: "clean", nullTokens: [{ label: "", count: 4 }] }),
  ]);
  assert.equal(host.querySelector(".th-qa-chip.token"), null);
});

test("changed cells carry a marker and the show-changes toggle", () => {
  const { host, table } = buildTable([meta({ name: "a" }), meta({ name: "b" })]);
  table.setFirstRows([["x", "y"]], undefined, undefined, Uint8Array.from([1, 0]));
  table.setCount(1);
  const cells = host.querySelectorAll(".tr .td");
  // cells[0] is the row-index cell; data cells start at 1.
  assert.ok(cells[1]?.classList.contains("changed-cell"));
  assert.equal(cells[2]?.classList.contains("changed-cell"), false);
  table.setShowChanges(true);
  assert.ok(host.querySelector(".table-scroller")?.classList.contains("show-changes"));
  table.setShowChanges(false);
  assert.equal(host.querySelector(".table-scroller")?.classList.contains("show-changes"), false);
});

test("clicking a column name opens the inspector", () => {
  const { host, inspects } = buildTable([meta({ name: "city" })]);
  const label = host
    .querySelectorAll(".th")[1]
    .querySelector(".th-label") as unknown as { click(): void };
  label.click();
  assert.deepEqual(inspects, [0]);
});

test("per-column display format renders fixed decimals without touching raw data", () => {
  const { host, table } = buildTable([meta({ name: "amount", type: "number" })]);
  table.setFormats(new Map([[0, 2]]));
  table.setFirstRows([["40.7262807"]]);
  table.setCount(1);
  const cell = host.querySelectorAll(".tr .td")[1];
  assert.equal(cell?.textContent, "40.73");
});

test("thousands-separator display groups digits without touching raw data", () => {
  const { host, table } = buildTable([meta({ name: "amount", type: "number" })]);
  table.setGrouping([0]);
  table.setFirstRows([["1234567.89"]]);
  table.setCount(1);
  const cell = host.querySelectorAll(".tr .td")[1];
  assert.equal(cell?.textContent, "1,234,567.89");

  // Switching grouping off returns to the untouched raw value.
  table.setGrouping([]);
  table.setFirstRows([["1234567.89"]]);
  const plain = host.querySelectorAll(".tr .td")[1];
  assert.equal(plain?.textContent, "1234567.89");
});

test("integer columns ignore decimal display formats", () => {
  const { host, table } = buildTable([meta({ name: "count", type: "integer" })]);
  table.setFormats(new Map([[0, 1]]));
  table.setGrouping([0]);
  table.setFirstRows([["1234567"]]);
  table.setCount(1);
  assert.equal(
    host.querySelectorAll(".tr .td")[1]?.textContent,
    "1,234,567",
    "grouping applies but integers never show forced decimals",
  );
  table.setGrouping([]);
  table.setFirstRows([["1234567"]]);
  assert.equal(host.querySelectorAll(".tr .td")[1]?.textContent, "1234567");
});

test("integers drop float tails and dates display in one standard shape", () => {
  const { host, table } = buildTable([
    meta({ name: "car", type: "integer" }),
    meta({ name: "when", type: "date", dateOrder: "dmy" }),
    meta({ name: "seen", type: "datetime", dateOrder: "dmy" }),
  ]);
  table.setFirstRows([["1.0", "3/12/2016", "2013-08-15 00:18:08+00"]]);
  table.setCount(1);
  const cells = host.querySelectorAll(".tr .td");
  assert.equal(cells[1]?.textContent, "1", "the float tail is not shown for integers");
  assert.equal(cells[1]?.getAttribute("title"), "1.0", "the raw value stays on hover");
  assert.equal(cells[2]?.textContent, "2016-12-03");
  assert.equal(cells[3]?.textContent, "2013-08-15 00:18");
});

test("display settings repaint rows already on screen", () => {
  const { host, table } = buildTable([meta({ name: "amount", type: "number" })]);
  table.setFirstRows([["1234567.89"]]);
  table.setCount(1);
  assert.equal(host.querySelectorAll(".tr .td")[1]?.textContent, "1234567.89");

  table.setGrouping([0]);
  assert.equal(
    host.querySelectorAll(".tr .td")[1]?.textContent,
    "1,234,567.89",
    "enabling separators repaints without a scroll",
  );

  table.setGrouping([]);
  table.setFormats(new Map([[0, 2]]));
  assert.equal(host.querySelectorAll(".tr .td")[1]?.textContent, "1,234,567.89");

  table.setFormats(new Map());
  assert.equal(
    host.querySelectorAll(".tr .td")[1]?.textContent,
    "1234567.89",
    "clearing the format restores the raw value",
  );
});

test("a header text input applies a debounced contains filter", async () => {
  const { host, quick, window } = buildTable([meta({ name: "region" })]);
  const input = host.querySelector(".th-filter-input") as unknown as HTMLInputElement;
  assert.ok(input);
  input.value = "nor";
  input.dispatchEvent(new window.Event("input") as unknown as Event);
  await new Promise((resolve) => setTimeout(resolve, 180));
  assert.deepEqual(quick, [{ column: 0, query: "nor" }]);
  assert.ok(host.querySelector(".th-filter")?.classList.contains("active"));
});
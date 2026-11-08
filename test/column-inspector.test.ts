import { test } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { openColumnInspector } from "../src/ui/column-inspector.js";
import { columnActionSections, type ColumnActionContext } from "../src/ui/column-actions.js";
import { openActionMenu } from "../src/ui/action-menu.js";
import type { ColumnMeta } from "../src/worker/protocol.js";

function setupDom(): Window {
  const window = new Window();
  const globals = globalThis as Record<string, unknown>;
  globals.window = window;
  globals.document = window.document;
  globals.HTMLElement = window.HTMLElement;
  globals.HTMLButtonElement = window.HTMLButtonElement;
  globals.HTMLInputElement = window.HTMLInputElement;
  globals.MutationObserver = window.MutationObserver;
  return window;
}

const doc = (): Window["document"] => (globalThis as Record<string, unknown>).document as Window["document"];

function meta(overrides: Partial<ColumnMeta> = {}): ColumnMeta {
  return {
    name: "amount",
    type: "number",
    numberLocale: "dot",
    dateOrder: "dmy",
    stats: {
      nulls: 3,
      distinct: 20,
      samples: [],
      topValues: [],
      min: 1,
      max: 100,
      mean: 40,
      stddev: 10,
      minLength: null,
      maxLength: null,
      avgLength: null,
    },
    anomalyCounts: { values: 4, lengths: 0 },
    similarGroups: 0,
    categories: null,
    histogram: null,
    valueFence: null,
    lengthFence: null,
    nullPolicy: { extra: [], keep: [] },
    nullTokens: [],
    suggestions: [
      { kind: "sentinel", value: "-999", count: 12, ratio: 0.02, sampled: 500 },
    ],
    ...overrides,
  };
}

function context(calls: string[], overrides: Partial<ColumnActionContext> = {}): ColumnActionContext {
  const column = overrides.meta ?? meta();
  return {
    meta: column,
    column: 0,
    columns: [column],
    sort: 0,
    frozen: false,
    displayFormat: null,
    displayGrouping: false,
    fillItems: [
      { label: "amount · 3 empty", disabled: true, action: () => undefined },
      { label: "Fill with median", title: "Fill with median", action: () => calls.push("fill:median") },
    ],
    outlierItems: [],
    onSort: (dir) => calls.push(`sort:${dir}`),
    onFilter: () => calls.push("filter"),
    onChart: () => calls.push("chart"),
    onHide: () => calls.push("hide"),
    onToggleFreeze: () => calls.push("freeze"),
    onDisplayFormat: (decimals) => calls.push(`format:${decimals}`),
    onDisplayGrouping: (on) => calls.push(`group:${on}`),
    onNumberLocale: (locale) => calls.push(`locale:${locale}`),
    onRename: () => calls.push("rename"),
    onChangeType: (type) => calls.push(`type:${type}`),
    onInsert: (at) => calls.push(`insert:${at}`),
    onDelete: () => calls.push("delete"),
    onQuickClean: (op) => calls.push(`clean:${op.kind}`),
    onOpenClean: (tab) => calls.push(`clean-panel:${tab}`),
    onSuggestion: () => calls.push("suggestion"),
    onConvertTokens: (tokens) => calls.push(`tokens:${tokens.join("|")}`),
    onMerge: () => calls.push("merge"),
    onOpenTransform: (preset) => calls.push(`transform:${preset?.type ?? "all"}`),
    onDedupe: (keep) => calls.push(`dedupe:${keep}`),
    onMelt: () => calls.push("melt"),
    onAllowedValues: (values) => calls.push(`allowed:${values.join("|")}`),
    onCompare: (target, operator, tolerance) => calls.push(`compare:${target}:${operator}:${tolerance}`),
    onCheckFreshness: (days) => calls.push(`fresh:${days}`),
    ...overrides,
  };
}

function openMenuFor(calls: string[], overrides: Partial<ColumnActionContext> = {}): void {
  openActionMenu(columnActionSections(context(calls, overrides)), { x: 10, y: 10 }, { title: "amount" });
}

function item(label: string): { click(): void; textContent: string | null } {
  const found = [...doc().querySelectorAll(".cmenu .cmenu-item")].find(
    (node) => node.querySelector(".cmenu-label")?.textContent === label,
  );
  assert.ok(found !== undefined, `expected the “${label}” item`);
  return found as unknown as { click(): void; textContent: string | null };
}

function labels(): string[] {
  return [...doc().querySelectorAll(".cmenu .cmenu-label")].map((node) => node.textContent ?? "");
}

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

test("the inspector reports the profile and findings, and has no actions", () => {
  setupDom();
  const label = doc().createElement("button") as unknown as HTMLElement;
  openColumnInspector(label, meta(), 0, { rowCount: 50 });
  const panel = doc().querySelector(".column-inspector");
  assert.ok(panel !== null);
  const text = panel.textContent ?? "";
  assert.match(text, /amount/);
  assert.match(text, /94% filled/);
  assert.match(text, /Min/);
  assert.match(text, /40/);
  assert.match(text, /4 value outliers/);
  assert.match(text, /“-999” appears in 12 of 500 cells/);
  assert.doesNotMatch(text, /Click to/, "findings read as facts, not instructions");
  assert.match(text, /Right-click the header for every action/);
  assert.equal(panel.querySelectorAll("button, select, input").length, 0, "left click only informs");
});

test("a clean text column shows its most common values and the all-clear", () => {
  setupDom();
  openColumnInspector(
    doc().createElement("button") as unknown as HTMLElement,
    meta({
      name: "city",
      type: "category",
      suggestions: [],
      anomalyCounts: { values: 0, lengths: 0 },
      stats: { ...meta().stats, nulls: 0, min: null, max: null, avgLength: 5, maxLength: 9, topValues: [{ label: "Oslo", count: 30 }, { label: "Rome", count: 20 }] },
    }),
    0,
    { rowCount: 50 },
  );
  const text = doc().querySelector(".column-inspector")?.textContent ?? "";
  assert.match(text, /Most common/);
  assert.match(text, /Oslo60%/);
  assert.match(text, /No issues found/);
});

test("the action menu groups every verb and runs them", () => {
  setupDom();
  const calls: string[] = [];
  openMenuFor(calls);
  const sections = [...doc().querySelectorAll(".cmenu-section")].map((node) => node.textContent);
  assert.deepEqual(sections, ["Fix", "View", "Column", "Clean", "Transform"]);
  item("Sort descending").click();
  assert.deepEqual(calls, ["sort:-1"]);
  assert.equal(doc().querySelector(".cmenu"), null, "running an action closes the menu");

  openMenuFor(calls);
  item("Insert column right…").click();
  assert.ok(calls.includes("insert:1"));

  openMenuFor(calls);
  item("Delete column…").click();
  assert.ok(calls.includes("delete"));
});

test("fixes come first, with counts, and open their own submenus", () => {
  setupDom();
  const calls: string[] = [];
  openMenuFor(calls);
  const fix = item("Treat “-999” as missing");
  fix.click();
  assert.deepEqual(calls, ["suggestion"]);

  openMenuFor(calls);
  const fill = item("Fill empty cells");
  assert.match(fill.textContent ?? "", /3/);
  fill.click();
  assert.ok(doc().querySelector(".cmenu-sub") !== null, "the submenu opens");
  assert.equal(doc().querySelector(".cmenu-sub .cmenu-sublabel")?.textContent, "amount · 3 empty");
  item("Fill with median").click();
  assert.ok(calls.includes("fill:median"));
  assert.equal(doc().querySelector(".cmenu-sub"), null);
});

test("submenus: case, display and type mark the current choice", () => {
  setupDom();
  const calls: string[] = [];
  openMenuFor(calls, { displayFormat: 2 });
  item("Change case").click();
  item("UPPERCASE").click();
  assert.deepEqual(calls, ["clean:case"]);

  openMenuFor(calls, { displayFormat: 2 });
  item("Number display").click();
  assert.equal(item("2 decimals").textContent, "2 decimals");
  const checked = [...doc().querySelectorAll('.cmenu-sub [aria-checked="true"] .cmenu-label')].map((node) => node.textContent);
  assert.deepEqual(checked, ["2 decimals"]);
  item("Thousands separators").click();
  assert.ok(calls.includes("group:true"));

  openMenuFor(calls);
  item("Change type").click();
  item("Text").click();
  assert.ok(calls.includes("type:string"));
});

test("integer columns get separators but no decimal places", () => {
  setupDom();
  openMenuFor([], { meta: meta({ name: "count", type: "integer" }) });
  item("Number display").click();
  assert.ok(labels().includes("Thousands separators"));
  assert.ok(!labels().includes("2 decimals"));
});

test("typing searches every action, submenus included, and Enter runs the first", () => {
  setupDom();
  const calls: string[] = [];
  openMenuFor(calls);
  const search = doc().querySelector(".cmenu .context-search") as unknown as HTMLInputElement;
  search.value = "upper";
  search.dispatchEvent(new (window as unknown as { Event: typeof Event }).Event("input"));
  assert.deepEqual(labels(), ["UPPERCASE"]);
  assert.equal(doc().querySelector(".cmenu .cmenu-path")?.textContent, "Change case");
  search.dispatchEvent(new (window as unknown as { KeyboardEvent: typeof KeyboardEvent }).KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  assert.deepEqual(calls, ["clean:case"]);

  openMenuFor(calls);
  const again = doc().querySelector(".cmenu .context-search") as unknown as HTMLInputElement;
  again.value = "hide";
  again.dispatchEvent(new (window as unknown as { Event: typeof Event }).Event("input"));
  assert.deepEqual(labels(), ["Hide column"]);
});

test("category columns offer an allowed-values check", async () => {
  setupDom();
  const calls: string[] = [];
  openMenuFor(calls, {
    meta: meta({ name: "city", type: "category", categories: { labels: ["a", "b", "c"], counts: [3, 2, 1] } }),
  });
  item("Allowed values…").click();
  const input = doc().querySelector(".modal .text-input") as HTMLInputElement | null;
  assert.ok(input !== null, "the values prompt opens");
  input.value = "a, b";
  const apply = [...doc().querySelectorAll(".modal .primary")].pop() as unknown as { click(): void };
  apply.click();
  await tick();
  assert.deepEqual(calls, ["allowed:a|b"]);
});

test("numeric columns compare with another column through nested submenus", () => {
  setupDom();
  const calls: string[] = [];
  const cols = [meta({ name: "start", type: "date" }), meta({ name: "amount", type: "number" }), meta({ name: "end", type: "date" })];
  openMenuFor(calls, { meta: cols[1], column: 1, columns: cols });
  item("Compare with").click();
  assert.ok(labels().includes("end"), "other numeric/date columns are listed");
  item("end").click();
  item("≥  at least").click();
  assert.deepEqual(calls, ["compare:2:gte:0"]);
});

test("the transform verbs open their panel with the column chosen", () => {
  setupDom();
  const calls: string[] = [];
  openMenuFor(calls);
  item("Fill from similar rows (k nearest neighbours)…").click();
  openMenuFor(calls);
  item("Remove duplicate rows").click();
  item("Keep the last copy").click();
  openMenuFor(calls);
  item("Group by & aggregate…").click();
  assert.deepEqual(calls, ["transform:knn", "dedupe:last", "transform:groupBy"]);
});

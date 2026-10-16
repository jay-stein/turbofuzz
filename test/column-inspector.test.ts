import { test } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import {
  openColumnInspector,
  type ColumnInspectorCallbacks,
} from "../src/ui/column-inspector.js";
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

function callbacks(
  calls: string[],
  overrides: Partial<ColumnInspectorCallbacks> = {},
): ColumnInspectorCallbacks {
  return {
    displayFormat: null,
    displayGrouping: false,
    onSort: (dir) => calls.push(`sort:${dir}`),
    onFilter: () => calls.push("filter"),
    onChart: () => calls.push("chart"),
    onQuickClean: (op) => calls.push(`clean:${op.kind}`),
    onOpenClean: (tab) => calls.push(`clean-panel:${tab}`),
    onOpenTransform: (preset) => calls.push(`transform:${preset?.type ?? "all"}`),
    onSuggestion: () => calls.push("suggestion"),
    onMerge: () => calls.push("merge"),
    onRename: () => calls.push("rename"),
    onDelete: () => calls.push("delete"),
    onDisplayFormat: (decimals) => calls.push(`format:${decimals}`),
    onDisplayGrouping: (on) => calls.push(`group:${on}`),
    onRound: (decimals) => calls.push(`round:${decimals}`),
    onFillMissing: (strategy) => calls.push(`fill:${strategy.kind}`),
    onDedupe: (keep) => calls.push(`dedupe:${keep}`),
    onSplit: (pattern, regex) => calls.push(`split:${pattern}:${regex}`),
    ...overrides,
  };
}

function anchor(): HTMLElement {
  const document = (globalThis as Record<string, unknown>).document as Window["document"];
  return document.createElement("button") as unknown as HTMLElement;
}

function inspectorText(): string {
  const document = (globalThis as Record<string, unknown>).document as Window["document"];
  return document.querySelector(".column-inspector")?.textContent ?? "";
}

function clickAction(label: string): void {
  const document = (globalThis as Record<string, unknown>).document as Window["document"];
  const button = [...document.querySelectorAll(".inspector-action, .inspector-issue")].find(
    (item) => item.textContent === label,
  );
  assert.ok(button !== undefined, `expected “${label}”`);
  (button as unknown as { click(): void }).click();
}

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

test("column inspector shows the profile, the issues and runs verbs", async () => {
  setupDom();
  const calls: string[] = [];
  const button = anchor();
  openColumnInspector(button, meta(), 0, callbacks(calls));

  const text = inspectorText();
  assert.match(text, /amount/);
  assert.match(text, /Min/);
  assert.match(text, /40/);
  assert.match(text, /4 value outliers/);
  assert.match(text, /treat “-999” as missing/);

  clickAction("Sort descending");
  assert.deepEqual(calls, ["sort:-1"]);

  openColumnInspector(button, meta(), 0, callbacks(calls));
  clickAction("UPPERCASE");
  assert.ok(calls.includes("clean:case"));

  openColumnInspector(button, meta(), 0, callbacks(calls));
  clickAction("2 dp");
  assert.ok(calls.includes("format:2"));

  openColumnInspector(button, meta(), 0, callbacks(calls));
  clickAction("Round…");
  const document = (globalThis as Record<string, unknown>).document as Window["document"];
  const confirm = document.querySelector(".confirm-modal .primary") as unknown as {
    click(): void;
  } | null;
  assert.ok(confirm !== null, "the round prompt opens");
  confirm.click();
  await tick();
  assert.ok(calls.includes("round:0"), "the round prompt defaults to 0 decimals");
});

test("fill and dedupe menus run their chosen strategy", () => {
  setupDom();
  const document = (globalThis as Record<string, unknown>).document as Window["document"];
  const calls: string[] = [];
  const button = anchor();
  openColumnInspector(button, meta(), 0, callbacks(calls));
  clickAction("Fill missing ▾");
  const median = [...document.querySelectorAll(".context-menu .context-item")].find(
    (item) => item.textContent === "Median",
  );
  assert.ok(median !== undefined);
  (median as unknown as { click(): void }).click();
  assert.deepEqual(calls, ["fill:median"]);

  openColumnInspector(button, meta(), 0, callbacks(calls));
  clickAction("Remove duplicates ▾");
  const last = [...document.querySelectorAll(".context-menu .context-item")].find(
    (item) => item.textContent === "Keep last copy",
  );
  assert.ok(last !== undefined);
  (last as unknown as { click(): void }).click();
  assert.ok(calls.includes("dedupe:last"));
});

test("a clean column gets the all-clear and structural verbs open Transform", () => {
  setupDom();
  const calls: string[] = [];
  const button = anchor();
  openColumnInspector(
    button,
    meta({ suggestions: [], anomalyCounts: { values: 0, lengths: 0 }, stats: { ...meta().stats, nulls: 0 } }),
    2,
    callbacks(calls),
  );
  assert.match(inspectorText(), /No issues found/);
  clickAction("Group by…");
  assert.deepEqual(calls, ["transform:groupBy"]);
});

test("numeric columns offer a display-only thousands-separator toggle", () => {
  setupDom();
  const calls: string[] = [];
  openColumnInspector(
    anchor(),
    meta({ name: "amount", type: "number" }),
    0,
    callbacks(calls),
  );
  assert.match(inspectorText(), /Thousands separators \(1,234,567\)/);
  clickAction("Thousands separators (1,234,567)");
  assert.deepEqual(calls, ["group:true"]);
});

test("integer columns offer separators but no decimal-place options", () => {
  setupDom();
  const calls: string[] = [];
  openColumnInspector(
    anchor(),
    meta({ name: "count", type: "integer" }),
    0,
    callbacks(calls),
  );
  const text = inspectorText();
  assert.match(text, /Thousands separators \(1,234,567\)/);
  assert.doesNotMatch(text, /1 dp/);
});

test("the Fill missing menu offers KNN next to the simple strategies", () => {
  setupDom();
  const calls: string[] = [];
  openColumnInspector(
    anchor(),
    meta({ name: "amount", type: "number" }),
    0,
    callbacks(calls),
  );
  clickAction("Fill missing ▾");
  const document = (globalThis as Record<string, unknown>).document as Window["document"];
  const knn = [...document.querySelectorAll(".context-menu .context-item")].find(
    (item) => item.textContent === "KNN (nearest neighbours)…",
  );
  assert.ok(knn !== undefined, "the KNN entry is present");
  (knn as unknown as { click(): void }).click();
  assert.deepEqual(calls, ["transform:knn"]);
});

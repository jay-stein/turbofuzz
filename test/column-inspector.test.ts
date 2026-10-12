import { test } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { openColumnInspector } from "../src/ui/column-inspector.js";
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

test("column inspector shows the profile, the issues and runs verbs", () => {
  setupDom();
  const document = (globalThis as Record<string, unknown>).document as Window["document"];
  const anchor = document.createElement("button") as unknown as HTMLElement;
  const calls: string[] = [];
  openColumnInspector(anchor, meta(), 0, {
    displayFormat: null,
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
  });

  const text = inspectorText();
  assert.match(text, /amount/);
  assert.match(text, /Min/);
  assert.match(text, /40/);
  assert.match(text, /4 value outliers/);
  assert.match(text, /treat “-999” as missing/);

  clickAction("Sort descending");
  assert.deepEqual(calls, ["sort:-1"]);

  // The panel closes on every action; reopen for the next verb.
  openColumnInspector(anchor, meta(), 0, {
    displayFormat: null,
    onSort: () => {},
    onFilter: () => {},
    onChart: () => {},
    onQuickClean: (op) => calls.push(`clean:${op.kind}`),
    onOpenClean: () => {},
    onOpenTransform: (preset) => calls.push(`transform:${preset?.type ?? "all"}`),
    onSuggestion: () => {},
    onMerge: () => {},
    onRename: () => {},
    onDelete: () => {},
    onDisplayFormat: (decimals) => calls.push(`format:${decimals}`),
  });
  clickAction("UPPERCASE");
  assert.ok(calls.includes("clean:case"));

  openColumnInspector(anchor, meta(), 0, {
    displayFormat: null,
    onSort: () => {},
    onFilter: () => {},
    onChart: () => {},
    onQuickClean: () => {},
    onOpenClean: () => {},
    onOpenTransform: (preset) => calls.push(`transform:${preset?.type ?? "all"}`),
    onSuggestion: () => {},
    onMerge: () => {},
    onRename: () => {},
    onDelete: () => {},
    onDisplayFormat: (decimals) => calls.push(`format:${decimals}`),
  });
  clickAction("2 dp");
  assert.ok(calls.includes("format:2"));
});

test("a clean column gets the all-clear and structural verbs open Transform", () => {
  setupDom();
  const document = (globalThis as Record<string, unknown>).document as Window["document"];
  const anchor = document.createElement("button") as unknown as HTMLElement;
  const transforms: string[] = [];
  openColumnInspector(
    anchor,
    meta({ suggestions: [], anomalyCounts: { values: 0, lengths: 0 }, stats: { ...meta().stats, nulls: 0 } }),
    2,
    {
      displayFormat: null,
      onSort: () => {},
      onFilter: () => {},
      onChart: () => {},
      onQuickClean: () => {},
      onOpenClean: () => {},
      onOpenTransform: (preset) => transforms.push(preset?.type ?? "all"),
      onSuggestion: () => {},
      onMerge: () => {},
      onRename: () => {},
      onDelete: () => {},
      onDisplayFormat: () => {},
    },
  );
  assert.match(inspectorText(), /No issues found/);
  clickAction("Split…");
  assert.deepEqual(transforms, ["splitColumn"]);
});

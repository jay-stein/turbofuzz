import { test } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import {
  initialCleanTab,
  openCleanPanel,
  type CleanPanelCallbacks,
} from "../src/ui/clean-panel.js";
import type { ColumnMeta } from "../src/worker/protocol.js";

function setupDom(): Window {
  const window = new Window();
  const globals = globalThis as Record<string, unknown>;
  globals.window = window;
  globals.document = window.document;
  globals.HTMLElement = window.HTMLElement;
  globals.MutationObserver = window.MutationObserver;
  globals.requestAnimationFrame = window.requestAnimationFrame.bind(window);
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
      min: 0,
      max: 10,
      mean: 5,
      stddev: 1,
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

const callbacks: CleanPanelCallbacks = {
  onApplyHeaders: () => {},
  onApplyClean: () => {},
  onResetCleans: () => {},
  onApplyNullPolicy: () => {},
  onApplyNullPolicyAll: () => {},
  onPreviewClean: () => Promise.resolve(null),
  onOpenMerge: () => {},
  onClose: () => {},
};

function activeTab(): string {
  const document = (globalThis as Record<string, unknown>).document as Window["document"];
  return document.querySelector(".clean-tab.active")?.textContent ?? "";
}

test("initialCleanTab picks Nulls, then Values, then Column names", () => {
  const withNulls = [meta({ stats: { ...meta().stats, nulls: 3 } })];
  const withTokens = [meta({ nullTokens: [{ label: "\\N", count: 4 }] })];
  const withSuggestion = [
    meta({ suggestions: [{ kind: "typeConflict", count: 2, sampled: 10, example: "1", columnType: "string" }] }),
  ];
  assert.equal(initialCleanTab(withNulls), "nulls");
  assert.equal(initialCleanTab(withTokens), "nulls", "placeholder tokens open Nulls");
  assert.equal(initialCleanTab(withSuggestion), "values");
  assert.equal(initialCleanTab([meta()]), "names");
  assert.equal(initialCleanTab(withNulls, 0), "values", "a chosen column opens Values");
});

test("the clean drawer opens on the tab where the work is", () => {
  setupDom();
  openCleanPanel(
    [meta({ stats: { ...meta().stats, nulls: 3 } })],
    new Map(),
    callbacks,
  );
  assert.equal(activeTab(), "Nulls");

  setupDom();
  openCleanPanel(
    [meta({ suggestions: [{ kind: "typeConflict", count: 2, sampled: 10, example: "1", columnType: "string" }] })],
    new Map(),
    callbacks,
  );
  assert.equal(activeTab(), "Values");

  setupDom();
  openCleanPanel([meta(), meta({ name: "b" })], new Map(), callbacks);
  assert.equal(activeTab(), "Column names");
});

test("Apply names is disabled while the panel reads No changes", () => {
  setupDom();
  openCleanPanel([meta({ name: "a" }), meta({ name: "b" })], new Map(), callbacks);
  const document = (globalThis as Record<string, unknown>).document as Window["document"];
  const summary = document.querySelector(".clean-summary")?.textContent ?? "";
  const apply = document.querySelector(".clean-footer .primary") as unknown as {
    disabled: boolean;
    textContent: string | null;
  };
  assert.equal(summary, "No changes.");
  assert.equal(apply.textContent, "Apply names");
  assert.equal(apply.disabled, true);

  setupDom();
  openCleanPanel([meta({ name: " needs trim " })], new Map(), callbacks);
  const document2 = (globalThis as Record<string, unknown>).document as Window["document"];
  const apply2 = document2.querySelector(".clean-footer .primary") as unknown as {
    disabled: boolean;
  };
  assert.equal(apply2.disabled, false);
});

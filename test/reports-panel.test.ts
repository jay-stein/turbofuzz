import { test } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { ReportsPanel } from "../src/ui/reports-panel.js";
import type { DatasetStats } from "../src/data/stats.js";
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

function stats(): DatasetStats {
  return {
    duplicateRows: 0,
    duplicateGroups: 0,
    rowsInDuplicateGroups: 0,
    emptyRows: 0,
    rowsWithNulls: 60,
    totalNullCells: 60,
    totalCells: 100,
    valueAnomalyRows: 0,
    lengthAnomalyRows: 0,
    computeMs: 1,
  };
}

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

test("reports state their row scope and label each finding", async () => {
  const window = setupDom();
  const host = window.document.createElement("div");
  const panel = new ReportsPanel(host as unknown as HTMLElement, {
    requestCorrelation: async () => null,
    requestCoMissingness: async () => null,
    requestGroupAnomalies: async () => null,
    requestDependencies: async () => null,
    requestRelationships: async () => null,
    requestTextProfile: async () => null,
    requestDistributionChanges: async () => null,
    requestSimilarClusters: async () => null,
    onAction: () => {},
  });
  panel.setData([meta({ name: "email", stats: { ...meta().stats, nulls: 60 } })], stats(), 100, 40);
  await tick();
  assert.match(
    host.querySelector(".reports-scope")?.textContent ?? "",
    /Current rows: 40 of 100/,
  );
  const scopes = [...host.querySelectorAll(".finding-scope")].map(
    (node) => node.textContent,
  );
  assert.ok(scopes.length > 0, "quality findings are rendered");
  assert.ok(
    scopes.every((scope) => scope === "Whole dataset" || scope === "Current rows"),
    "every finding has a known scope",
  );
});

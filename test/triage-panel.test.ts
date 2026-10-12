import { test } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { openTriagePanel } from "../src/ui/triage-panel.js";
import type { ColumnMeta } from "../src/worker/protocol.js";
import type { DatasetStats } from "../src/data/stats.js";

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
    suggestions: [
      { kind: "mixedNumber", locale: "dot", count: 5, ratio: 0.1, sampled: 50 },
    ],
    ...overrides,
  };
}

function stats(overrides: Partial<DatasetStats> = {}): DatasetStats {
  return {
    duplicateRows: 0,
    duplicateGroups: 0,
    rowsInDuplicateGroups: 0,
    emptyRows: 0,
    rowsWithNulls: 0,
    totalNullCells: 0,
    totalCells: 100,
    valueAnomalyRows: 0,
    lengthAnomalyRows: 0,
    computeMs: 1,
    ...overrides,
  };
}

function doc(): Window["document"] {
  return (globalThis as Record<string, unknown>).document as Window["document"];
}

test("a resolved fix ticks green and leaves the list on refresh", () => {
  setupDom();
  let applied = 0;
  const handle = openTriagePanel([meta()], stats(), {
    onSuggestion: () => applied++,
    onConvertToken: () => {},
    onOpenClean: () => {},
    onDedupe: () => {},
  });

  const apply = [...doc().querySelectorAll(".triage-item button")].find(
    (button) => button.textContent === "Apply",
  );
  assert.ok(apply !== undefined, "the suggestion offers Apply");
  (apply as unknown as { click(): void }).click();
  assert.equal(applied, 1);
  assert.match(doc().querySelector(".triage-done")?.textContent ?? "", /✓ Applied/);

  // The fix lands: the suggestion is gone from the new metadata.
  handle.update([meta({ suggestions: [] })], stats());
  assert.match(doc().querySelector(".triage-fixed-entry")?.textContent ?? "", /✓ Fixed: amount/);
  assert.equal(doc().querySelector(".triage-item"), null, "the cleared issue leaves the list");
  assert.match(doc().querySelector(".triage-empty")?.textContent ?? "", /Nothing left to review/);
  handle.close();
});

test("a fix that does not clear the issue loses its tick", () => {
  setupDom();
  const handle = openTriagePanel([meta()], stats(), {
    onSuggestion: () => {},
    onConvertToken: () => {},
    onOpenClean: () => {},
    onDedupe: () => {},
  });
  const apply = [...doc().querySelectorAll(".triage-item button")].find(
    (button) => button.textContent === "Apply",
  );
  (apply as unknown as { click(): void }).click();
  assert.ok(doc().querySelector(".triage-done") !== null);

  // Same metadata arrives (nothing changed): the pending tick is cleared.
  handle.update([meta()], stats());
  assert.equal(doc().querySelector(".triage-done"), null);
  assert.equal(doc().querySelector(".triage-fixed-entry"), null);
  const retry = [...doc().querySelectorAll(".triage-item button")].find(
    (button) => button.textContent === "Apply",
  );
  assert.ok(retry !== undefined, "Apply is available again");
  handle.close();
});

test("null and constant issues open the Clean panel instead of pretending to fix", () => {
  setupDom();
  const opened: string[] = [];
  const handle = openTriagePanel(
    [meta({ suggestions: [], stats: { ...meta().stats, nulls: 7, distinct: 3 } })],
    stats(),
    {
      onSuggestion: () => {},
      onConvertToken: () => {},
      onOpenClean: (column, tab) => opened.push(`${column}:${tab}`),
      onDedupe: () => {},
    },
  );
  const review = [...doc().querySelectorAll(".triage-item button")].find(
    (button) => button.textContent === "Review…",
  );
  assert.ok(review !== undefined);
  (review as unknown as { click(): void }).click();
  assert.deepEqual(opened, ["0:nulls"]);
  assert.equal(doc().querySelector(".triage-done"), null, "navigation is not a fix");
  handle.close();
});

test("the panel reports its close so the app can drop the handle", () => {
  setupDom();
  let closed = false;
  const handle = openTriagePanel([meta()], stats(), {
    onSuggestion: () => {},
    onConvertToken: () => {},
    onOpenClean: () => {},
    onDedupe: () => {},
    onClose: () => {
      closed = true;
    },
  });
  handle.close();
  assert.equal(closed, true);
  // Updates after close are ignored.
  handle.update([], stats());
  assert.equal(doc().querySelector(".triage-empty"), null);
});

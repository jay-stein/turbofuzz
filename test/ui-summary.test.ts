import { test } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { openDedupeMenu } from "../src/ui/dedupe-menu.js";
import type { DatasetStats } from "../src/data/stats.js";
import type { DedupeKeep } from "../src/data/transform-ops.js";

function setupDom(): Window {
  const window = new Window();
  const globals = globalThis as Record<string, unknown>;
  globals.window = window;
  globals.document = window.document;
  globals.HTMLElement = window.HTMLElement;
  return window;
}

function stats(overrides: Partial<DatasetStats> = {}): DatasetStats {
  return {
    duplicateRows: 0,
    duplicateGroups: 0,
    rowsInDuplicateGroups: 0,
    emptyRows: 0,
    rowsWithNulls: 0,
    totalNullCells: 0,
    totalCells: 10,
    valueAnomalyRows: 0,
    lengthAnomalyRows: 0,
    computeMs: 1,
    ...overrides,
  };
}

test("dedupe menu offers keep-first, keep-last and remove-all", () => {
  const window = setupDom();
  const document = window.document as unknown as Document;
  const anchor = document.createElement("button") as unknown as HTMLElement;
  const calls: DedupeKeep[] = [];

  openDedupeMenu(anchor, stats({ duplicateRows: 3, rowsInDuplicateGroups: 7 }), (keep) =>
    calls.push(keep),
  );

  const menu = document.querySelector(".qa-menu");
  assert.ok(menu !== null, "expected the dedupe menu");
  const items = menu.querySelectorAll(".context-item");
  assert.equal(items.length, 3);
  assert.match(items[0].textContent ?? "", /Keep first copy — 3 rows/);
  assert.match(items[1].textContent ?? "", /Keep last copy — 3 rows/);
  assert.match(items[2].textContent ?? "", /Remove all copies — 7 rows/);

  (items[0] as unknown as { click(): void }).click();
  assert.deepEqual(calls, ["first"]);
  assert.equal(document.querySelector(".qa-menu"), null, "menu closes after choosing");
});

test("the quick action is disabled when there are no duplicates", () => {
  const window = setupDom();
  const document = window.document as unknown as Document;
  const anchor = document.createElement("button") as unknown as HTMLElement;

  openDedupeMenu(anchor, stats(), () => {});

  const menu = document.querySelector(".qa-menu");
  assert.ok(menu !== null);
  const items = menu.querySelectorAll(".context-item");
  for (const item of items) {
    assert.equal((item as unknown as { disabled: boolean }).disabled, true);
  }
});

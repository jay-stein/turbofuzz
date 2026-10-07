import { test } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { openStepsPanel } from "../src/ui/steps-panel.js";

function setupDom(): Window {
  const window = new Window();
  const globals = globalThis as Record<string, unknown>;
  globals.window = window;
  globals.document = window.document;
  globals.HTMLElement = window.HTMLElement;
  globals.MutationObserver = window.MutationObserver;
  return window;
}

test("process log labels the panel and undoes missing-value and type entries", () => {
  setupDom();
  const undone: string[] = [];
  openStepsPanel(
    [
      {
        kind: "nulls",
        label: "Date: treat “TBC” as missing",
        detail: "nulls → exact-match missing tokens",
        column: 8,
        opIndex: 0,
        groupSize: 1,
      },
      {
        kind: "type",
        label: "Score: type → String",
        detail: "type → Integer → String",
        column: 14,
        opIndex: 0,
        groupSize: 1,
      },
    ],
    {
      onRemoveClean: () => {},
      onMoveClean: () => {},
      onRemoveLastTransform: () => {},
      onRestoreRows: () => {},
      onUndoPolicy: (column, opIndex) => undone.push(`policy:${column}:${opIndex}`),
      onUndoType: (column, opIndex) => undone.push(`type:${column}:${opIndex}`),
      onClearAll: () => {},
      onCopyRecipe: async () => true,
      onClose: () => {},
    },
  );

  const document = (globalThis as Record<string, unknown>).document as Window["document"];
  assert.match(document.querySelector(".modal-head h2")?.textContent ?? "", /Process Log \(2\)/);

  const rows = document.querySelectorAll(".clean-op");
  assert.equal(rows.length, 2);
  assert.match(rows[0].textContent ?? "", /treat “TBC” as missing/);
  assert.match(rows[1].textContent ?? "", /type → String/);

  (rows[0].querySelector(".undo-btn") as unknown as { click(): void }).click();
  (rows[1].querySelector(".undo-btn") as unknown as { click(): void }).click();
  assert.deepEqual(undone, ["policy:8:0", "type:14:0"]);
});

test("process log shows the empty state and disables bulk actions", () => {
  setupDom();
  openStepsPanel([], {
    onRemoveClean: () => {},
    onMoveClean: () => {},
    onRemoveLastTransform: () => {},
    onRestoreRows: () => {},
    onUndoPolicy: () => {},
    onUndoType: () => {},
    onClearAll: () => {},
    onCopyRecipe: async () => true,
    onClose: () => {},
  });

  const document = (globalThis as Record<string, unknown>).document as Window["document"];
  assert.match(document.querySelector(".modal-head h2")?.textContent ?? "", /Process Log \(0\)/);
  assert.equal(document.querySelectorAll(".clean-op").length, 0);
  const buttons = document.querySelectorAll(".clean-footer button");
  assert.equal((buttons[0] as unknown as { disabled: boolean }).disabled, true);
  assert.equal((buttons[1] as unknown as { disabled: boolean }).disabled, true);
});

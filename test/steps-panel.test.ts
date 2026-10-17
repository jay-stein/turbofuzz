import { test } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { openStepsPanel, type StepsPanelEntry } from "../src/ui/steps-panel.js";

function setupDom(): Window {
  const window = new Window();
  const globals = globalThis as Record<string, unknown>;
  globals.window = window;
  globals.document = window.document;
  globals.HTMLElement = window.HTMLElement;
  globals.MutationObserver = window.MutationObserver;
  return window;
}

test("Recipe labels the panel and undoes missing-value and type entries", () => {
  setupDom();
  const undone: string[] = [];
  let closed = 0;
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
      onUndoBatch: () => {},
      onClearAll: () => {},
      onCopyRecipe: async () => true,
      onSaveRecipe: () => {},
      onReplayRecipe: () => {},
      onClose: () => {
        closed++;
      },
    },
  );

  const document = (globalThis as Record<string, unknown>).document as Window["document"];
  assert.match(document.querySelector(".modal-head h2")?.textContent ?? "", /Recipe \(2\)/);

  const rows = document.querySelectorAll(".clean-op");
  assert.equal(rows.length, 2);
  assert.match(rows[0].textContent ?? "", /treat “TBC” as missing/);
  assert.match(rows[1].textContent ?? "", /type → String/);

  (rows[0].querySelector(".undo-btn") as unknown as { click(): void }).click();
  assert.equal(
    document.querySelector(".modal-overlay"),
    null,
    "the drawer closes after an undo so the reverted table is visible",
  );
  assert.equal(closed, 1, "onClose fires with the panel closing");
  (rows[1].querySelector(".undo-btn") as unknown as { click(): void }).click();
  assert.deepEqual(undone, ["policy:8:0", "type:14:0"]);
});

test("Recipe shows the empty state and disables bulk actions", () => {
  setupDom();
  openStepsPanel([], {
    onRemoveClean: () => {},
    onMoveClean: () => {},
    onRemoveLastTransform: () => {},
    onRestoreRows: () => {},
    onUndoPolicy: () => {},
    onUndoType: () => {},
    onUndoBatch: () => {},
    onClearAll: () => {},
    onCopyRecipe: async () => true,
    onSaveRecipe: () => {},
    onReplayRecipe: () => {},
    onClose: () => {},
  });

  const document = (globalThis as Record<string, unknown>).document as Window["document"];
  assert.match(document.querySelector(".modal-head h2")?.textContent ?? "", /Recipe \(0\)/);
  assert.equal(document.querySelectorAll(".clean-op").length, 0);
  const buttons = document.querySelectorAll(".clean-footer button");
  // Undo all, Replay recipe…, Save recipe…, Copy pandas recipe
  assert.equal((buttons[0] as unknown as { disabled: boolean }).disabled, true);
  assert.equal((buttons[1] as unknown as { disabled: boolean }).disabled, false, "replay works on an empty log");
  assert.equal((buttons[2] as unknown as { disabled: boolean }).disabled, true);
  assert.equal((buttons[3] as unknown as { disabled: boolean }).disabled, true);
});

test("Recipe language selector switches the exporter and its support line", async () => {
  const window = setupDom();
  const copies: string[] = [];
  openStepsPanel(
    [
      {
        kind: "transform",
        label: "Remove duplicate rows (keep first copy)",
        column: -1,
        opIndex: 0,
        groupSize: 1,
      },
    ],
    {
      onRemoveClean: () => {},
      onMoveClean: () => {},
      onRemoveLastTransform: () => {},
      onRestoreRows: () => {},
      onUndoPolicy: () => {},
      onUndoType: () => {},
      onUndoBatch: () => {},
      onClearAll: () => {},
      onCopyRecipe: async (target) => {
        copies.push(target);
        return true;
      },
      recipeSupport: (target) => `${target}: support`,
      onSaveRecipe: () => {},
      onReplayRecipe: () => {},
      onClose: () => {},
    },
  );

  const document = (globalThis as Record<string, unknown>).document as Window["document"];
  const select = document.querySelector(".recipe-target") as unknown as HTMLSelectElement;
  assert.ok(select !== null, "the language selector renders");
  assert.deepEqual(
    [...select.options].map((option) => option.value),
    ["pandas", "polars"],
  );
  assert.equal(select.value, "pandas");
  assert.match(document.querySelector(".clean-support")?.textContent ?? "", /pandas: support/);

  select.value = "polars";
  select.dispatchEvent(new window.Event("change") as unknown as Event);
  assert.match(document.querySelector(".clean-support")?.textContent ?? "", /polars: support/);

  const copy = [...document.querySelectorAll(".clean-footer button")].find(
    (button) => button.textContent === "Copy recipe",
  );
  assert.ok(copy !== undefined, "the copy button renders");
  (copy as unknown as { click(): void }).click();
  await Promise.resolve();
  assert.deepEqual(copies, ["polars"], "the selected target is sent to the generator");
});

test("Recipe condenses batches and undoes them as one action", () => {
  setupDom();
  const batches: number[] = [];
  const batch = { id: "transform-batch-0", label: "Transform batch (3 steps)" };
  const entries: StepsPanelEntry[] = [
    {
      kind: "transform",
      label: "Dedupe",
      detail: "transform → dedupe()",
      column: -1,
      opIndex: 0,
      groupSize: 3,
      group: batch,
    },
    {
      kind: "transform",
      label: "Drop",
      detail: "transform → drop()",
      column: -1,
      opIndex: 1,
      groupSize: 3,
      group: batch,
    },
    {
      kind: "transform",
      label: "Round",
      detail: "transform → round()",
      column: -1,
      opIndex: 2,
      groupSize: 3,
      group: batch,
    },
  ];
  openStepsPanel(entries, {
    onRemoveClean: () => {},
    onMoveClean: () => {},
    onRemoveLastTransform: () => {},
    onRestoreRows: () => {},
    onUndoPolicy: () => {},
    onUndoType: () => {},
    onUndoBatch: (members) => batches.push(members.length),
    onClearAll: () => {},
    onCopyRecipe: async () => true,
    onSaveRecipe: () => {},
    onReplayRecipe: () => {},
    onClose: () => {},
  });

  const document = (globalThis as Record<string, unknown>).document as Window["document"];
  assert.match(document.querySelector(".modal-head h2")?.textContent ?? "", /Recipe \(1\)/);
  const group = document.querySelector(".step-group");
  assert.ok(group !== null);
  const children = group.querySelector(".step-group-children");
  assert.ok(children !== null && children.classList.contains("hidden"));
  assert.equal(group.querySelectorAll(".step-substep").length, 3);
  assert.match(group.textContent ?? "", /3 steps/);

  (group.querySelector(".step-toggle") as unknown as { click(): void }).click();
  assert.equal(children.classList.contains("hidden"), false);
  (group.querySelector(".undo-btn") as unknown as { click(): void }).click();
  assert.deepEqual(batches, [3]);
  assert.equal(
    document.querySelector(".modal-overlay"),
    null,
    "batch undo also closes the drawer",
  );
});

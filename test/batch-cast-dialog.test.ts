import { test } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { openBatchCastDialog } from "../src/ui/batch-cast-dialog.js";

function setupDom(): Window {
  const window = new Window();
  const globals = globalThis as Record<string, unknown>;
  globals.window = window;
  globals.document = window.document;
  globals.HTMLElement = window.HTMLElement;
  globals.MutationObserver = window.MutationObserver;
  return window;
}

test("batch conversion previews and returns one cast update per selected column", async () => {
  setupDom();
  const window = globalThis.window as unknown as Window;
  const resultPromise = openBatchCastDialog({
    columns: [
      {
        index: 0,
        name: "amount",
        type: "string",
        suggested: "number",
        locale: "dot",
        order: "dmy",
        existing: [],
      },
      {
        index: 1,
        name: "when",
        type: "string",
        suggested: "date",
        locale: "dot",
        order: "dmy",
        existing: [],
      },
    ],
    preview: async (updates) => ({
      type: "cleanPreview",
      requestId: 1,
      columns: updates.map((update) => ({
        column: update.column,
        changed: 2,
        total: 3,
        failed: 0,
      })),
    }),
  });
  await new Promise((resolve) => setTimeout(resolve, 30));
  const doc = (globalThis as Record<string, unknown>).document as Window["document"];
  const apply = doc.querySelector(".batch-cast-modal .primary") as unknown as {
    click(): void;
    disabled: boolean;
  };
  assert.equal(apply.disabled, false);
  apply.click();
  const result = await resultPromise;
  assert.ok(result !== null);
  assert.equal(result?.count, 2);
  assert.deepEqual(result?.updates.map((update) => update.column), [0, 1]);
  assert.deepEqual(result?.updates[0]?.ops[0], {
    kind: "cast",
    target: "number",
    policy: "coerce",
    locale: "dot",
    order: "dmy",
  });
  assert.equal(doc.querySelector(".batch-cast-modal"), null);
  void window;
});

test("batch conversion blocks apply when Reject finds parse failures", async () => {
  setupDom();
  const window = globalThis.window as unknown as Window;
  const resultPromise = openBatchCastDialog({
    columns: [
      {
        index: 0,
        name: "amount",
        type: "string",
        suggested: "number",
        locale: "dot",
        order: "dmy",
        existing: [],
      },
    ],
    preview: async (updates) => ({
      type: "cleanPreview",
      requestId: 1,
      columns: updates.map((update) => ({
        column: update.column,
        changed: 0,
        total: 1,
        failed: 1,
        examples: ["n/a"],
      })),
    }),
  });
  await new Promise((resolve) => setTimeout(resolve, 30));
  const doc = (globalThis as Record<string, unknown>).document as Window["document"];
  const policy = doc.querySelector(
    'select[aria-label="Batch invalid value policy"]',
  ) as unknown as HTMLSelectElement;
  policy.value = "reject";
  policy.dispatchEvent(new window.Event("change") as unknown as Event);
  await new Promise((resolve) => setTimeout(resolve, 180));
  const apply = doc.querySelector(".batch-cast-modal .primary") as unknown as {
    disabled: boolean;
  };
  assert.equal(apply.disabled, true);
  (doc.querySelector(".batch-cast-modal .clean-footer .ghost") as unknown as { click(): void }).click();
  assert.equal(await resultPromise, null);
});
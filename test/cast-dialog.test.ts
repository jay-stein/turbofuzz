import { test } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { openCastDialog } from "../src/ui/cast-dialog.js";

function setupDom(): Window {
  const window = new Window();
  const globals = globalThis as Record<string, unknown>;
  globals.window = window;
  globals.document = window.document;
  globals.HTMLElement = window.HTMLElement;
  globals.MutationObserver = window.MutationObserver;
  globals.getComputedStyle = window.getComputedStyle.bind(window);
  return window;
}

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

test("cast dialog previews mismatches and confirms coerce", async () => {
  const window = setupDom();
  const result = openCastDialog({
    name: "amount",
    fromType: "string",
    target: "integer",
    initial: { target: "integer", policy: "coerce", locale: "dot", dateOrder: "dmy" },
    preview: async () => ({ changed: 2, total: 4, failed: 2, examples: ["2.5", "T"] }),
  });
  await tick();
  const doc = document;
  assert.match(doc.querySelector(".cast-summary")?.textContent ?? "", /2 of 4 values/);
  assert.match(doc.querySelector(".cast-example-values")?.textContent ?? "", /"2.5", "T"/);
  const policy = doc.querySelector('select[aria-label="Invalid value policy"]') as HTMLSelectElement;
  const confirm = [...doc.querySelectorAll(".clean-footer button")].find(
    (button) => button.classList.contains("primary"),
  ) as HTMLButtonElement;
  assert.equal(confirm.disabled, false);
  policy.value = "reject";
  policy.dispatchEvent(new window.Event("change") as unknown as Event);
  await tick();
  assert.equal(confirm.disabled, true, "reject is blocked while values fail");
  policy.value = "coerce";
  policy.dispatchEvent(new window.Event("change") as unknown as Event);
  await tick();
  confirm.click();
  const value = await result;
  assert.equal(value?.kind, "cast");
  if (value?.kind === "cast") {
    assert.equal(value.options.target, "integer");
    assert.equal(value.options.policy, "coerce");
  }
});

test("cast dialog can cancel or choose reinterpret-only", async () => {
  setupDom();
  const result = openCastDialog({
    name: "amount",
    fromType: "string",
    target: "number",
    initial: { target: "number", policy: "coerce", locale: "dot", dateOrder: "dmy" },
    preview: async () => ({ changed: 1, total: 2, failed: 0 }),
  });
  await tick();
  const doc = document;
  const reinterpret = [...doc.querySelectorAll(".clean-footer button")].find(
    (button) => button.textContent === "Reinterpret only",
  ) as HTMLButtonElement;
  reinterpret.click();
  const value = await result;
  assert.equal(value?.kind, "reinterpret");
});

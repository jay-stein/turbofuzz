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
  // 2 of 4 would blank (>1%): the confirmation box must be ticked first.
  assert.equal(confirm.disabled, true, "blanking more than 1% needs confirmation");
  const box = doc.querySelector(".cast-loss-confirm input") as HTMLInputElement;
  box.checked = true;
  box.dispatchEvent(new window.Event("change") as unknown as Event);
  assert.equal(confirm.disabled, false);
  policy.value = "reject";
  policy.dispatchEvent(new window.Event("change") as unknown as Event);
  await tick();
  assert.equal(confirm.disabled, true, "reject is blocked while values fail");
  policy.value = "coerce";
  policy.dispatchEvent(new window.Event("change") as unknown as Event);
  await tick();
  box.checked = true;
  box.dispatchEvent(new window.Event("change") as unknown as Event);
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

test("cast dialog refuses outright when digits would change", async () => {
  setupDom();
  const result = openCastDialog({
    name: "mobile",
    fromType: "string",
    target: "integer",
    initial: { target: "integer", policy: "coerce", locale: "dot", dateOrder: "dmy" },
    preview: async () => ({ changed: 10, total: 10, failed: 0, nonEmpty: 10, digitLoss: 10 }),
  });
  await tick();
  const confirm = [...document.querySelectorAll(".clean-footer button")].find((button) =>
    button.classList.contains("primary"),
  ) as HTMLButtonElement;
  assert.equal(confirm.disabled, true);
  assert.match(document.body.textContent ?? "", /start with zeros/);
  (document.querySelectorAll(".clean-footer button")[0] as HTMLButtonElement).click();
  assert.equal(await result, null);
});

test("cast dialog lets a tiny loss through without a prompt", async () => {
  const window = setupDom();
  const result = openCastDialog({
    name: "amount",
    fromType: "string",
    target: "number",
    initial: { target: "number", policy: "coerce", locale: "dot", dateOrder: "dmy" },
    preview: async () => ({ changed: 1000, total: 1000, failed: 5, nonEmpty: 1000, digitLoss: 0 }),
  });
  await tick();
  const confirm = [...document.querySelectorAll(".clean-footer button")].find((button) =>
    button.classList.contains("primary"),
  ) as HTMLButtonElement;
  assert.equal(confirm.disabled, false, "0.5% is under the 1% threshold");
  confirm.click();
  assert.equal((await result)?.kind, "cast");
  void window;
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { openTransformPanel } from "../src/ui/transform-panel.js";

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

test("transform panel renders the stage builder and staged steps on open", () => {
  setupDom();
  openTransformPanel(
    [{ kind: "dedupe", keep: "first" }],
    [{ name: "amount", numeric: true }],
    {
      onApply: () => {},
      onPreview: async () => null,
      onClose: () => {},
    },
  );

  const document = (globalThis as Record<string, unknown>).document as Window["document"];
  const options = document.querySelectorAll(".transform-builder select option");
  assert.ok(options.length >= 6, `expected step-type options, got ${options.length}`);

  const staged = document.querySelectorAll(".clean-op");
  assert.equal(staged.length, 1, "expected the applied step to be listed");

  const summary = document.querySelector(".clean-summary")?.textContent ?? "";
  assert.match(summary, /1 step ready to apply/);

  const addButton = document.querySelector(".transform-builder button");
  assert.equal(addButton?.textContent, "Add step");
});

test("transform panel starts empty with a working builder when nothing is applied", () => {
  setupDom();
  openTransformPanel([], [{ name: "amount", numeric: true }], {
    onApply: () => {},
    onPreview: async () => null,
    onClose: () => {},
  });

  const document = (globalThis as Record<string, unknown>).document as Window["document"];
  const options = document.querySelectorAll(".transform-builder select option");
  assert.ok(options.length >= 6, `expected step-type options, got ${options.length}`);
  const empty = document.querySelector(".clean-empty")?.textContent ?? "";
  assert.match(empty, /No steps yet/);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { PipelineStepper } from "../src/ui/stepper.js";
import { ViewTabs } from "../src/ui/view-tabs.js";

function setupDom(): Window {
  const window = new Window();
  const globals = globalThis as Record<string, unknown>;
  globals.window = window;
  globals.document = window.document;
  globals.HTMLElement = window.HTMLElement;
  return window;
}

test("pipeline rail reflects Process Log counts", () => {
  setupDom();
  const host = document.createElement("div");
  const stepper = new PipelineStepper(host, { onSelect: () => {} });

  assert.equal(host.querySelectorAll(".stepper-item").length, 4);
  assert.equal(host.querySelector('[data-stage="view"]'), null);

  const cleanLabel = host.querySelector('[data-stage="clean"] .stepper-label');
  const cleanHint = host.querySelector('[data-stage="clean"] .stepper-hint');
  assert.equal(cleanLabel?.textContent, "Clean");
  assert.equal(cleanHint?.classList.contains("hidden"), false, "Clean starts optional");

  stepper.setCount("clean", 2);
  assert.equal(cleanLabel?.textContent, "Clean · 2");
  assert.equal(host.querySelector('[data-stage="clean"]')?.classList.contains("done"), true);
  assert.equal(cleanHint?.classList.contains("hidden"), true);

  stepper.setCount("clean", 0);
  assert.equal(cleanLabel?.textContent, "Clean");
  assert.equal(host.querySelector('[data-stage="clean"]')?.classList.contains("done"), false);
  assert.equal(cleanHint?.classList.contains("hidden"), false);

  stepper.setCount("transform", 1);
  assert.equal(
    host.querySelector('[data-stage="transform"] .stepper-label')?.textContent,
    "Transform · 1",
  );
});

test("tabs keep the selected lens when a drawer opens and closes", () => {
  setupDom();
  const host = document.createElement("div");
  const changes: string[] = [];
  const tabs = new ViewTabs(host, { onChange: (view) => changes.push(view) });

  assert.equal(host.getAttribute("role"), "tablist");
  assert.equal(host.querySelectorAll('[role="tab"]').length, 3);

  tabs.select("table");
  assert.equal(tabs.selected, "table");
  assert.deepEqual(changes, ["table"]);

  const stepperHost = document.createElement("div");
  const stepper = new PipelineStepper(stepperHost, { onSelect: () => {} });
  stepper.setActive("clean");
  assert.equal(tabs.selected, "table", "opening Clean does not change the lens");
  stepper.setActive(null);
  assert.equal(tabs.selected, "table", "closing Clean does not change the lens");
  assert.deepEqual(changes, ["table"]);
});

test("tabs expose roving tabindex and respond to arrow keys", () => {
  setupDom();
  const host = document.createElement("div");
  const changes: string[] = [];
  const tabs = new ViewTabs(host, { onChange: (view) => changes.push(view) });
  const buttons = [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')];

  assert.equal(buttons[0].getAttribute("aria-selected"), "true");
  assert.equal(buttons[0].tabIndex, 0);
  assert.equal(buttons[1].tabIndex, -1);

  buttons[0].dispatchEvent(
    new window.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
  );
  assert.equal(tabs.selected, "table");
  assert.deepEqual(changes, ["table"]);
  assert.equal(buttons[1].getAttribute("aria-selected"), "true");
  assert.equal(buttons[0].getAttribute("aria-selected"), "false");
  assert.equal(buttons[1].tabIndex, 0);
  assert.equal(buttons[0].tabIndex, -1);

  host.dispatchEvent(new window.KeyboardEvent("keydown", { key: "End", bubbles: true }));
  assert.equal(tabs.selected, "chart");
  host.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Home", bubbles: true }));
  assert.equal(tabs.selected, "overview");
  host.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
  assert.equal(tabs.selected, "chart");
});

test("programmatic selection does not notify the app", () => {
  setupDom();
  const host = document.createElement("div");
  const changes: string[] = [];
  const tabs = new ViewTabs(host, { onChange: (view) => changes.push(view) });
  tabs.setSelected("chart");
  assert.equal(tabs.selected, "chart");
  assert.deepEqual(changes, []);
  const buttons = [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
  assert.equal(buttons[2].getAttribute("aria-selected"), "true");
});

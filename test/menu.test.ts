import { test } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { openMenu } from "../src/ui/menu.js";

function setupDom(): Window {
  const window = new Window();
  const globals = globalThis as Record<string, unknown>;
  globals.window = window;
  globals.document = window.document;
  globals.HTMLElement = window.HTMLElement;
  globals.MutationObserver = window.MutationObserver;
  return window;
}

function key(window: Window, value: string): void {
  window.document.dispatchEvent(new window.KeyboardEvent("keydown", { key: value, bubbles: true }));
}

test("menus are keyboard navigable: arrows skip disabled items, Escape restores focus", () => {
  const window = setupDom();
  const document = (globalThis as Record<string, unknown>).document as Window["document"];
  const anchor = document.createElement("button");
  document.body.append(anchor as never);
  const chosen: string[] = [];
  openMenu(anchor as unknown as HTMLElement, [
    { label: "One", action: () => chosen.push("one") },
    { label: "Two", disabled: true, action: () => chosen.push("two") },
    { label: "Three", action: () => chosen.push("three") },
  ]);

  const menu = document.querySelector(".context-menu") as unknown as HTMLElement;
  assert.ok(menu !== null, "the menu renders");
  const items = [...menu.querySelectorAll(".context-item")] as unknown as HTMLElement[];
  assert.equal(items.length, 3);
  assert.equal(document.activeElement, items[0], "focus lands on the first enabled item");

  key(window, "ArrowDown");
  assert.equal(document.activeElement, items[2], "disabled items are skipped");
  key(window, "ArrowDown");
  assert.equal(document.activeElement, items[0], "arrows cycle");
  key(window, "End");
  assert.equal(document.activeElement, items[2]);
  key(window, "Home");
  assert.equal(document.activeElement, items[0]);

  key(window, "Escape");
  assert.equal(document.querySelector(".context-menu"), null, "Escape closes the menu");
  assert.equal(document.activeElement, anchor, "focus returns to the anchor");

  openMenu(anchor as unknown as HTMLElement, [
    { label: "Only", action: () => chosen.push("only") },
  ]);
  const only = document.querySelector(".context-item") as unknown as { click(): void };
  only.click();
  assert.deepEqual(chosen, ["only"]);
});

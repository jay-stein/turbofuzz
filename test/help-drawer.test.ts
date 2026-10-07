import { test } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { openHelpDrawer } from "../src/ui/help-drawer.js";
import { HELP_SECTIONS } from "../src/ui/help-content.js";

function setupDom(): Window {
  const window = new Window();
  const globals = globalThis as Record<string, unknown>;
  globals.window = window;
  globals.document = window.document;
  globals.HTMLElement = window.HTMLElement;
  globals.MutationObserver = window.MutationObserver;
  return window;
}

test("help drawer lists every topic and filters as you search", () => {
  const window = setupDom();
  openHelpDrawer();

  const document = (globalThis as Record<string, unknown>).document as Window["document"];
  assert.match(document.querySelector(".modal-head h2")?.textContent ?? "", /User guide/);
  assert.equal(document.querySelectorAll(".help-section").length, HELP_SECTIONS.length);

  const search = document.querySelector(".help-search") as unknown as {
    value: string;
    dispatchEvent(event: unknown): boolean;
  };
  search.value = "decimal";
  search.dispatchEvent(new window.Event("input", { bubbles: true }));

  const filtered = document.querySelectorAll(".help-section");
  assert.equal(filtered.length, 2, "fix chips and clean both explain mixed decimals");
  const ids = Array.from(filtered).map((section) => section.id);
  assert.ok(ids.includes("help-fix-chips"));
  assert.match(document.querySelector(".help-count")?.textContent ?? "", /2 of \d+ topics/);
});

test("help drawer deep-links to a topic", () => {
  setupDom();
  openHelpDrawer("privacy");

  const document = (globalThis as Record<string, unknown>).document as Window["document"];
  const privacy = document.querySelector("#help-privacy");
  assert.ok(privacy !== null, "privacy section is present");
  assert.ok(privacy?.classList.contains("flash"), "deep-linked topic is highlighted");
});

test("help drawer reports when a search matches nothing", () => {
  const window = setupDom();
  openHelpDrawer();

  const document = (globalThis as Record<string, unknown>).document as Window["document"];
  const search = document.querySelector(".help-search") as unknown as {
    value: string;
    dispatchEvent(event: unknown): boolean;
  };
  search.value = "zzzz-no-match";
  search.dispatchEvent(new window.Event("input", { bubbles: true }));

  assert.equal(document.querySelectorAll(".help-section").length, 0);
  assert.match(document.querySelector(".help-empty")?.textContent ?? "", /No topics match/);
});

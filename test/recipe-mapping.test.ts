import { test } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { openRecipeMapping } from "../src/ui/recipe-mapping.js";

function setupDom(): Window {
  const window = new Window();
  const globals = globalThis as Record<string, unknown>;
  globals.window = window;
  globals.document = window.document;
  globals.HTMLElement = window.HTMLElement;
  globals.MutationObserver = window.MutationObserver;
  return window;
}

test("recipe mapping resolves the chosen columns", async () => {
  setupDom();
  const pending = openRecipeMapping({
    names: [" Amount ", "When"],
    columns: ["region", "total", "date"],
  });
  const selects = document.querySelectorAll<HTMLSelectElement>(".recipe-map-row select");
  assert.equal(selects.length, 2);
  selects[0].value = "1";
  selects[1].value = "2";
  const confirm = [...document.querySelectorAll(".modal .primary")].pop() as unknown as {
    click(): void;
  };
  confirm.click();
  const mapping = await pending;
  assert.ok(mapping !== null);
  assert.deepEqual([...mapping.entries()], [
    [" Amount ", 1],
    ["When", 2],
  ]);
});

test("recipe mapping cancels with a null result", async () => {
  setupDom();
  const pending = openRecipeMapping({ names: [" Amount "], columns: ["region"] });
  const cancel = [...document.querySelectorAll(".modal .ghost")].find((button) =>
    (button.textContent ?? "").includes("Replay without transforms"),
  );
  assert.ok(cancel !== undefined);
  (cancel as unknown as { click(): void }).click();
  assert.equal(await pending, null);
  assert.equal(document.querySelector(".modal-overlay"), null, "the modal closes");
});

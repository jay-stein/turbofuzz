import { test } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { openDedupePreview } from "../src/ui/dedupe-preview.js";

function setupDom(): Window {
  const window = new Window();
  const globals = globalThis as Record<string, unknown>;
  globals.window = window;
  globals.document = window.document;
  globals.HTMLElement = window.HTMLElement;
  globals.MutationObserver = window.MutationObserver;
  return window;
}

test("the preview lists each group's copies together, shades the id, and resolves the copy to keep", async () => {
  const window = setupDom();
  const shown = openDedupePreview({
    title: "Smart Deduplicate",
    names: ["name", "id", "city"],
    ignore: [1],
    groups: [{ rows: [0, 3], cells: [["Ann", "1", "Leeds"], ["Ann", "4", "Leeds"]] }],
    removeRows: 1,
    totalGroups: 5,
    keep: "first",
  });
  const modal = document.querySelector("[data-qp='dedupe-preview']")!;
  const headers = [...modal.querySelectorAll("thead th")].map((th) => th.textContent);
  assert.deepEqual(headers, ["", "Row", "id", "name", "city"], "the ignored id comes first, before the matching columns");
  assert.equal(modal.querySelectorAll("th.dd-ignored").length, 1);
  assert.equal(modal.querySelectorAll("td.dd-ignored").length, 2, "the id cell of both copies is shaded");
  const status = (): string[] => [...modal.querySelectorAll("td.dd-status")].map((td) => td.textContent ?? "");
  assert.deepEqual(status(), ["Keep", "Remove"]);
  assert.match(modal.textContent ?? "", /Showing 1 of 5 groups/);
  const keep = modal.querySelector("select") as unknown as HTMLSelectElement;
  keep.value = "last";
  keep.dispatchEvent(new window.Event("change") as unknown as Event);
  assert.deepEqual(status(), ["Remove", "Keep"], "switching to the last copy moves the Keep");
  (modal.querySelector("[data-qp='dedupe-confirm']") as unknown as HTMLButtonElement).click();
  assert.equal(await shown, "last");
  assert.equal(document.querySelector("[data-qp='dedupe-preview']"), null, "closed");
});

test("Show them all in the Table closes the preview without removing anything", async () => {
  setupDom();
  let listed = false;
  const shown = openDedupePreview({
    title: "Remove duplicate rows",
    names: ["a", "b"],
    ignore: [],
    groups: [{ rows: [0, 1], cells: [["x", ""], ["x", ""]] }],
    removeRows: 1,
    totalGroups: 1,
    keep: "first",
    showAll: () => {
      listed = true;
    },
  });
  assert.match(document.querySelector(".dd-blank")?.textContent ?? "", /empty/);
  (document.querySelector("[data-qp='dedupe-show-all']") as unknown as HTMLButtonElement).click();
  assert.equal(await shown, null);
  assert.equal(listed, true);
});

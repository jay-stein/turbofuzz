import { test } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { estimateFromText, openLargeLoadDialog } from "../src/ui/load-guard.js";

function setupDom(): Window {
  const window = new Window();
  const globals = globalThis as Record<string, unknown>;
  globals.window = window;
  globals.document = window.document;
  globals.HTMLElement = window.HTMLElement;
  globals.MutationObserver = window.MutationObserver;
  return window;
}

test("estimates rows, columns and cells from a text prefix", () => {
  const rows = Array.from({ length: 100 }, (_, i) => `${i},alpha-${i},3.5`);
  const sample = `${rows.join("\n")}\n`;
  const bytesPerRow = sample.length / rows.length;
  const totalBytes = Math.round(bytesPerRow * 1000);
  const estimate = estimateFromText(totalBytes, sample);
  assert.ok(estimate !== null);
  assert.equal(estimate.columns, 3);
  assert.ok(
    estimate.rows >= 990 && estimate.rows <= 1010,
    `expected ~1000 rows, got ${estimate.rows}`,
  );
  assert.equal(estimate.cells, estimate.rows * 3);
});

test("drops a partial final sample row and rejects tiny samples", () => {
  const sample = "a,b\n1,2\n3,4\n5,6";
  const estimate = estimateFromText(10_000, sample);
  assert.ok(estimate !== null);
  // The partial final row is dropped; complete rows average 4 bytes each.
  assert.ok(estimate.rows >= 2400 && estimate.rows <= 2600, `got ${estimate.rows}`);
  assert.equal(estimateFromText(10_000, "one line only"), null);
  assert.equal(estimateFromText(0, "a,b\n1,2\n"), null);
});

test("the large-load dialog offers sample, full load or cancel", async () => {
  const window = setupDom();
  const document = (globalThis as Record<string, unknown>).document as Window["document"];
  const estimate = { rows: 5_200_000, columns: 14, cells: 72_800_000 };

  const choose = async (label: string): Promise<unknown> => {
    const promise = openLargeLoadDialog(estimate, "big.csv");
    const buttons = [...document.querySelectorAll(".modal .clean-footer button")];
    const button = buttons.find((entry) => (entry.textContent ?? "").includes(label));
    assert.ok(button !== undefined, `expected a “${label}” button`);
    (button as unknown as { click(): void }).click();
    return promise;
  };

  assert.equal(await choose("first 100,000 rows"), "sample");
  assert.equal(await choose("Load everything anyway"), "all");
  assert.equal(await choose("Cancel"), null);

  const overlay = document.querySelector(".modal-overlay");
  assert.equal(overlay, null, "each dialog closes after a choice");
  void window;
});

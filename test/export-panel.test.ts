import { test } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { ensureCsvExtension, openExportPanel } from "../src/ui/export-panel.js";

function setupDom(): Window {
  const window = new Window();
  const globals = globalThis as Record<string, unknown>;
  globals.window = window;
  globals.document = window.document;
  globals.HTMLElement = window.HTMLElement;
  globals.MutationObserver = window.MutationObserver;
  return window;
}

test("ensureCsvExtension keeps, adds or falls back on the extension", () => {
  assert.equal(ensureCsvExtension("sales.csv", "fallback.csv"), "sales.csv");
  assert.equal(ensureCsvExtension("sales", "fallback.csv"), "sales.csv");
  assert.equal(ensureCsvExtension("sales.CSV", "fallback.csv"), "sales.CSV");
  assert.equal(ensureCsvExtension("   ", "fallback.csv"), "fallback.csv");
});

test("export panel asks for a name and options before saving", () => {
  setupDom();
  let saved: { name: string; nullAsBlank: boolean } | null = null;
  openExportPanel("euro-cleaned.csv", { nullAsBlank: true }, {
    onSave: (name, settings) => {
      saved = { name, nullAsBlank: settings.nullAsBlank };
    },
    onClose: () => {},
  });

  const document = (globalThis as Record<string, unknown>).document as Window["document"];
  const input = document.querySelector(".export-modal input[type='text']") as unknown as {
    value: string;
  };
  assert.equal(input.value, "euro-cleaned.csv");

  const checkbox = document.querySelector(
    ".export-modal input[type='checkbox']",
  ) as unknown as { checked: boolean };
  assert.equal(checkbox.checked, true);
  checkbox.checked = false;
  input.value = "my data";

  (document.querySelector(".export-modal .primary") as unknown as { click(): void }).click();

  assert.deepEqual(saved, { name: "my data.csv", nullAsBlank: false });
  assert.equal(document.querySelector(".export-modal"), null, "panel closes after saving");
});

test("export panel lists CSV now and marks other formats as planned", () => {
  setupDom();
  openExportPanel("data.csv", { nullAsBlank: true }, { onSave: () => {}, onClose: () => {} });

  const document = (globalThis as Record<string, unknown>).document as Window["document"];
  const options = document.querySelectorAll(".export-modal select option");
  assert.equal(options.length, 2);
  assert.equal(options[0].textContent, "CSV (.csv)");
  assert.match(options[1].textContent ?? "", /planned/);
});

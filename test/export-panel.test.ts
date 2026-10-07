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
  let saved: { name: string; nullAsBlank: boolean; scope: string } | null = null;
  openExportPanel(
    "euro-cleaned.csv",
    { nullAsBlank: true, scope: "all" },
    { allRows: 100, filteredRows: 100, filtersActive: false },
    {
      onSave: (name, settings) => {
        saved = { name, nullAsBlank: settings.nullAsBlank, scope: settings.scope };
      },
      onClose: () => {},
    },
  );

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

  assert.deepEqual(saved, { name: "my data.csv", nullAsBlank: false, scope: "all" });
  assert.equal(document.querySelector(".export-modal"), null, "panel closes after saving");
});

test("export panel defaults to all rows and states the filtered count", () => {
  setupDom();
  let saved: { scope: string } | null = null;
  openExportPanel(
    "data.csv",
    { nullAsBlank: true, scope: "all" },
    { allRows: 21000, filteredRows: 237, filtersActive: true },
    {
      onSave: (_name, settings) => {
        saved = { scope: settings.scope };
      },
      onClose: () => {},
    },
  );

  const document = (globalThis as Record<string, unknown>).document as Window["document"];
  const radios = document.querySelectorAll(
    ".export-modal input[type='radio']",
  ) as unknown as { checked: boolean; click(): void }[];
  assert.equal(radios.length, 2);
  assert.equal(radios[0].checked, true, "all rows is the default");
  assert.match(document.querySelector(".scope-warning")?.textContent ?? "", /21,000 rows after steps/);
  assert.match(document.querySelector(".scope-warning")?.textContent ?? "", /237 of 21,000/);

  radios[1].click();
  assert.match(document.querySelector(".scope-warning")?.textContent ?? "", /Only the 237 rows/);

  (document.querySelector(".export-modal .primary") as unknown as { click(): void }).click();
  assert.deepEqual(saved, { scope: "filtered" });
});

test("export panel hides the scope choice when no filters are active", () => {
  setupDom();
  openExportPanel(
    "data.csv",
    { nullAsBlank: true, scope: "all" },
    { allRows: 500, filteredRows: 500, filtersActive: false },
    { onSave: () => {}, onClose: () => {} },
  );

  const document = (globalThis as Record<string, unknown>).document as Window["document"];
  assert.equal(document.querySelectorAll(".export-modal input[type='radio']").length, 0);
  assert.match(document.querySelector(".scope-static")?.textContent ?? "", /All 500 rows/);
});

test("export panel lists CSV now and marks other formats as planned", () => {
  setupDom();
  openExportPanel(
    "data.csv",
    { nullAsBlank: true, scope: "all" },
    { allRows: 10, filteredRows: 10, filtersActive: false },
    { onSave: () => {}, onClose: () => {} },
  );

  const document = (globalThis as Record<string, unknown>).document as Window["document"];
  const options = document.querySelectorAll(".export-modal select option");
  assert.equal(options.length, 2);
  assert.equal(options[0].textContent, "CSV (.csv)");
  assert.match(options[1].textContent ?? "", /planned/);
});

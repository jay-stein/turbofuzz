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
    { nullAsBlank: true, escapeFormulas: true, scope: "all", limit: null },
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
  assert.equal(input.value, "euro-cleaned", "the extension comes from the format");

  const checkbox = document.querySelector(
    ".export-modal input[aria-label='Add date-time prefix']",
  ) as unknown as { checked: boolean };
  assert.equal(checkbox.checked, true, "the date-time prefix is on by default");
  checkbox.checked = false;
  const nullBox = document.querySelectorAll(
    ".export-modal input[type='checkbox']",
  )[1] as unknown as { checked: boolean };
  assert.equal(nullBox.checked, true);
  nullBox.checked = false;
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
    { nullAsBlank: true, escapeFormulas: true, scope: "all", limit: null },
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
    ".export-modal input[name='export-scope']",
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
    { nullAsBlank: true, escapeFormulas: true, scope: "all", limit: null },
    { allRows: 500, filteredRows: 500, filtersActive: false },
    { onSave: () => {}, onClose: () => {} },
  );

  const document = (globalThis as Record<string, unknown>).document as Window["document"];
  assert.equal(document.querySelectorAll(".export-modal input[name='export-scope']").length, 0);
  assert.equal(document.querySelectorAll(".export-modal input[name='export-limit']").length, 2);
  assert.match(document.querySelector(".scope-static")?.textContent ?? "", /All 500 rows/);
});

test("export panel offers a first-N subset defaulting to all rows", () => {
  setupDom();
  let saved: { limit: number | null } | null = null;
  openExportPanel(
    "data.csv",
    { nullAsBlank: true, escapeFormulas: true, scope: "all", limit: null },
    { allRows: 5000, filteredRows: 5000, filtersActive: false },
    {
      onSave: (_name, settings) => {
        saved = { limit: settings.limit };
      },
      onClose: () => {},
    },
  );

  const document = (globalThis as Record<string, unknown>).document as Window["document"];
  const limitRadios = document.querySelectorAll(
    ".export-modal input[name='export-limit']",
  ) as unknown as { checked: boolean; click(): void }[];
  assert.equal(limitRadios.length, 2);
  assert.equal(limitRadios[0].checked, true, "all rows is the default");
  const count = document.querySelector(".export-limit-input") as unknown as {
    value: string;
    disabled: boolean;
  };
  assert.equal(count.value, "1000");
  assert.equal(count.disabled, true);

  limitRadios[1].click();
  assert.equal(count.disabled, false);
  count.value = "250";
  (document.querySelector(".export-modal .primary") as unknown as { click(): void }).click();
  assert.deepEqual(saved, { limit: 250 });
});

test("export panel offers several formats and builds the file name from them", () => {
  setupDom();
  let saved: { name: string; format?: string; compression?: string } | null = null;
  openExportPanel(
    "data",
    { nullAsBlank: true, escapeFormulas: true, scope: "all", limit: null, datePrefix: false },
    { allRows: 10, filteredRows: 10, filtersActive: false },
    {
      onSave: (name, settings) => {
        saved = { name, format: settings.format, compression: settings.compression };
      },
      onClose: () => {},
    },
  );

  const document = (globalThis as Record<string, unknown>).document as Window["document"];
  const formats = document.querySelectorAll(".export-modal select[aria-label='Export format'] option");
  assert.deepEqual(
    [...formats].map((option) => option.getAttribute("value")),
    ["csv", "csv-semicolon", "tsv", "json", "jsonl"],
  );
  const select = document.querySelector(
    ".export-modal select[aria-label='Export format']",
  ) as unknown as { value: string; dispatchEvent(event: unknown): void };
  select.value = "json";
  select.dispatchEvent(new (document.defaultView as unknown as { Event: typeof Event }).Event("change"));
  assert.match(document.querySelector(".export-preview")?.textContent ?? "", /Will save as data\.json$/);

  (document.querySelector(".export-modal .primary") as unknown as { click(): void }).click();
  assert.deepEqual(saved, { name: "data.json", format: "json", compression: "none" });
});

test("export panel offers the Excel formula escape on by default", () => {
  setupDom();
  let saved: { escapeFormulas: boolean } | null = null;
  openExportPanel(
    "data.csv",
    { nullAsBlank: true, escapeFormulas: true, scope: "all", limit: null },
    { allRows: 10, filteredRows: 10, filtersActive: false },
    {
      onSave: (_name, settings) => {
        saved = { escapeFormulas: settings.escapeFormulas };
      },
      onClose: () => {},
    },
  );

  const document = (globalThis as Record<string, unknown>).document as Window["document"];
  const checkboxes = document.querySelectorAll(
    ".export-modal input[type='checkbox']",
  ) as unknown as { checked: boolean }[];
  assert.equal(checkboxes.length, 3);
  assert.equal(checkboxes[1].checked, true, "nullAsBlank keeps its default");
  assert.equal(checkboxes[2].checked, true, "formula escape is on by default");
  checkboxes[2].checked = false;

  (document.querySelector(".export-modal .primary") as unknown as { click(): void }).click();
  assert.deepEqual(saved, { escapeFormulas: false });
});

test("export panel shows one sensitive-data line, defaulting to Include with no extra click", () => {
  setupDom();
  let saved: string | undefined;
  openExportPanel(
    "customers.csv",
    { nullAsBlank: true, escapeFormulas: false, scope: "all", limit: null },
    { allRows: 100, filteredRows: 100, filtersActive: false },
    {
      onSave: (_name, settings) => {
        saved = settings.sensitiveMode;
      },
      onClose: () => {},
    },
    ["email", "phone", "full_name"],
  );
  const document = (globalThis as Record<string, unknown>).document as Window["document"];
  const row = document.querySelector(".export-sensitive");
  assert.match(
    row?.textContent ?? "",
    /This export includes 3 columns that may contain sensitive data: email, phone, full_name/,
  );
  const checked = document.querySelector(".export-sensitive input:checked") as unknown as { value: string };
  assert.equal(checked.value, "include");
  (document.querySelector(".export-modal .primary") as unknown as { click(): void }).click();
  assert.equal(saved, "include", "saving with defaults needs no extra click");

  openExportPanel(
    "customers.csv",
    { nullAsBlank: true, escapeFormulas: false, scope: "all", limit: null },
    { allRows: 100, filteredRows: 100, filtersActive: false },
    {
      onSave: (_name, settings) => {
        saved = settings.sensitiveMode;
      },
      onClose: () => {},
    },
    ["email"],
  );
  const mask = [...document.querySelectorAll(".export-sensitive input")].find(
    (input) => (input as unknown as { value: string }).value === "mask",
  ) as unknown as { checked: boolean; dispatchEvent(e: unknown): void };
  mask.checked = true;
  mask.dispatchEvent(new (globalThis as unknown as { window: Window }).window.Event("change"));
  (document.querySelector(".export-modal .primary") as unknown as { click(): void }).click();
  assert.equal(saved, "mask");
});

test("export panel has no sensitive line when nothing is flagged", () => {
  setupDom();
  openExportPanel(
    "plain.csv",
    { nullAsBlank: true, escapeFormulas: false, scope: "all", limit: null },
    { allRows: 10, filteredRows: 10, filtersActive: false },
    { onSave: () => {}, onClose: () => {} },
  );
  const document = (globalThis as Record<string, unknown>).document as Window["document"];
  const row = document.querySelector(".export-sensitive") as unknown as { classList: { contains(c: string): boolean } };
  assert.equal(row.classList.contains("hidden"), true);
});

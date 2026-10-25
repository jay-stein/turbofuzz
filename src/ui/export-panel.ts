import type { ExportScope } from "../worker/protocol.js";
import { setupDialog } from "./dialog.js";
import { el } from "./dom.js";
import {
  EXPORT_COMPRESSIONS,
  EXPORT_FORMATS,
  buildExportFileName,
  formatInfo,
  stripExportExtension,
  type ExportCompression,
  type ExportFormat,
} from "./export-formats.js";

export interface ExportSettings {
  nullAsBlank: boolean;
  escapeFormulas: boolean;
  scope: ExportScope;
  /** null = every row in the selected scope; otherwise the first N. */
  limit: number | null;
  format?: ExportFormat;
  compression?: ExportCompression;
  /** Prefix the file name with the export time as YYYYMMDDHHMMSS_. */
  datePrefix?: boolean;
}

export interface ExportScopeInfo {
  /** Rows after steps/deletes, ignoring filters. */
  allRows: number;
  /** Rows matching the current filters/specials/sample. */
  filteredRows: number;
  filtersActive: boolean;
}

export interface ExportPanelCallbacks {
  onSave: (fileName: string, settings: ExportSettings) => void;
  onClose: () => void;
}

/** Appends .csv unless the user typed it already; empty names fall back. */
export function ensureCsvExtension(name: string, fallback: string): string {
  const trimmed = name.trim();
  const base = trimmed === "" ? fallback : trimmed;
  return /\.csv$/i.test(base) ? base : `${base}.csv`;
}

/**
 * Export dialog: confirms the scope, file name and options before anything is
 * written. The scope is stated in row counts so a filtered view can never be
 * exported silently: "all rows after steps" is the default when filters are
 * active, and the filtered option spells out how many rows it covers.
 */
export function openExportPanel(
  defaultName: string,
  settings: ExportSettings,
  scopeInfo: ExportScopeInfo,
  callbacks: ExportPanelCallbacks,
): void {
  const overlay = el("div", { class: "modal-overlay" });
  const modal = el("div", { class: "modal export-modal" });

  const head = el("div", { class: "modal-head" });
  head.append(el("h2", {}, ["Export data"]));
  const closeButton = el("button", { class: "icon-btn", type: "button", title: "Close" }, ["×"]);
  head.append(closeButton);
  modal.append(head);

  let format: ExportFormat = settings.format ?? "csv";
  let compression: ExportCompression = settings.compression ?? "none";

  const formatField = el("label", { class: "clean-field" });
  formatField.append(el("span", { class: "clean-label" }, ["Format"]));
  const formatSelect = el("select", { "aria-label": "Export format" }) as HTMLSelectElement;
  for (const entry of EXPORT_FORMATS) {
    const option = el("option", { value: entry.value }, [entry.label]) as HTMLOptionElement;
    option.selected = entry.value === format;
    formatSelect.append(option);
  }
  const formatHint = el("div", { class: "clean-hint" });
  const compressionSelect = el("select", {
    "aria-label": "Export compression",
  }) as HTMLSelectElement;
  for (const entry of EXPORT_COMPRESSIONS) {
    const option = el("option", { value: entry.value }, [entry.label]) as HTMLOptionElement;
    option.selected = entry.value === compression;
    compressionSelect.append(option);
  }
  const compressionRow = el("div", { class: "export-compression" }, [
    el("span", {}, ["Compress"]),
    compressionSelect,
  ]);
  formatField.append(formatSelect, formatHint, compressionRow);

  let scope: ExportScope = scopeInfo.filtersActive ? settings.scope : "all";
  const scopeField = el("div", { class: "clean-field scope-field" });
  scopeField.append(el("span", { class: "clean-label" }, ["Rows to export"]));
  const scopeOptions = el("div", { class: "scope-options" });
  const warning = el("div", { class: "clean-hint scope-warning" });

  const updateWarning = (): void => {
    if (!scopeInfo.filtersActive) {
      warning.textContent = `All ${scopeInfo.allRows.toLocaleString()} rows after steps — no filters are active.`;
      return;
    }
    warning.textContent =
      scope === "all"
        ? `Filters are active — ${scopeInfo.filteredRows.toLocaleString()} of ${scopeInfo.allRows.toLocaleString()} rows match, but this export includes all ${scopeInfo.allRows.toLocaleString()} rows after steps.`
        : `Only the ${scopeInfo.filteredRows.toLocaleString()} rows currently shown will be exported.`;
  };

  if (scopeInfo.filtersActive) {
    const makeRadio = (value: ExportScope, label: string): HTMLLabelElement => {
      const option = el("label", { class: "control check clean-check" });
      const input = el("input", { type: "radio", name: "export-scope" }) as HTMLInputElement;
      input.value = value;
      input.checked = scope === value;
      input.addEventListener("change", () => {
        if (input.checked) {
          scope = value;
          updateWarning();
        }
      });
      option.append(input, label);
      return option;
    };
    scopeOptions.append(
      makeRadio(
        "all",
        `All rows after steps (${scopeInfo.allRows.toLocaleString()})`,
      ),
      makeRadio(
        "filtered",
        `Rows matching current filters (${scopeInfo.filteredRows.toLocaleString()} of ${scopeInfo.allRows.toLocaleString()})`,
      ),
    );
  } else {
    scopeOptions.append(
      el("span", { class: "scope-static" }, [
        `All ${scopeInfo.allRows.toLocaleString()} rows after steps`,
      ]),
    );
  }
  updateWarning();
  scopeField.append(scopeOptions, warning);

  const limitField = el("div", { class: "clean-field scope-field" });
  limitField.append(el("span", { class: "clean-label" }, ["Rows to include"]));
  const limitOptions = el("div", { class: "scope-options" });
  const countInput = el("input", {
    class: "text-input export-limit-input",
    type: "number",
    min: "1",
    step: "1",
    value: String(settings.limit ?? 1000),
    "aria-label": "Number of rows to export",
    spellcheck: "false",
  }) as HTMLInputElement;
  countInput.disabled = settings.limit === null;
  let limit: number | null = settings.limit;

  const allOption = el("label", { class: "control check clean-check" });
  const allInput = el("input", { type: "radio", name: "export-limit" }) as HTMLInputElement;
  allInput.checked = settings.limit === null;
  allOption.append(allInput, "All rows");

  const subsetOption = el("label", { class: "control check clean-check" });
  const subsetInput = el("input", { type: "radio", name: "export-limit" }) as HTMLInputElement;
  subsetInput.checked = settings.limit !== null;
  subsetOption.append(subsetInput, "First");
  subsetOption.append(countInput);
  subsetOption.append("rows");

  const syncLimit = (): void => {
    countInput.disabled = !subsetInput.checked;
    limit = subsetInput.checked
      ? Math.max(1, Math.floor(Number(countInput.value) || 1000))
      : null;
  };
  allInput.addEventListener("change", syncLimit);
  subsetInput.addEventListener("change", syncLimit);
  countInput.addEventListener("input", () => {
    if (subsetInput.checked) syncLimit();
  });
  limitOptions.append(allOption, subsetOption);
  const limitHint = el("div", { class: "clean-hint" }, [
    "The subset takes the first N rows of the selected scope, in the current display order.",
  ]);
  limitField.append(limitOptions, limitHint);

  const nameField = el("label", { class: "clean-field" });
  nameField.append(el("span", { class: "clean-label" }, ["File name"]));
  const nameInput = el("input", {
    class: "text-input",
    type: "text",
    value: stripExportExtension(defaultName),
    spellcheck: "false",
    "aria-label": "Export file name",
  }) as HTMLInputElement;
  const prefixInput = el("input", { type: "checkbox", "aria-label": "Add date-time prefix" }) as HTMLInputElement;
  prefixInput.checked = settings.datePrefix ?? true;
  const prefixRow = el("label", { class: "control check clean-check" }, [
    prefixInput,
    "Start the name with the export date and time (YYYYMMDDHHMMSS_)",
  ]);
  const preview = el("div", { class: "clean-hint export-preview" });
  const finalName = (): string =>
    buildExportFileName(nameInput.value, defaultName, format, compression, prefixInput.checked);
  const syncName = (): void => {
    formatHint.textContent = formatInfo(format).hint;
    preview.textContent = `Will save as ${finalName()}`;
  };
  formatSelect.addEventListener("change", () => {
    format = formatSelect.value as ExportFormat;
    syncName();
  });
  compressionSelect.addEventListener("change", () => {
    compression = compressionSelect.value as ExportCompression;
    syncName();
  });
  nameInput.addEventListener("input", syncName);
  prefixInput.addEventListener("change", syncName);
  syncName();
  nameField.append(nameInput, prefixRow, preview);

  const optionsRow = el("label", { class: "control check clean-check" });
  const nullInput = el("input", { type: "checkbox" }) as HTMLInputElement;
  nullInput.checked = settings.nullAsBlank;
  optionsRow.append(nullInput, "Blank null values");

  const formulaRow = el("label", { class: "control check clean-check" });
  const formulaInput = el("input", { type: "checkbox" }) as HTMLInputElement;
  formulaInput.checked = settings.escapeFormulas;
  formulaInput.title =
    "Prefix =, @ and signed expressions with ' so Excel and Sheets import them as text";
  formulaRow.append(formulaInput, "Escape formula-like cells (safe for Excel)");

  const hint = el("div", { class: "clean-hint" }, [
    "Cleaning steps are always included. The file is built in this browser. When your browser supports it, you choose the folder and name in the system save dialog.",
  ]);

  const footer = el("div", { class: "clean-footer" });
  const cancel = el("button", { class: "ghost", type: "button" }, ["Cancel"]);
  cancel.addEventListener("click", close);
  const save = el("button", { class: "primary", type: "button" }, ["Save file"]);
  save.addEventListener("click", () => {
    const fileName = finalName();
    syncLimit();
    callbacks.onSave(fileName, {
      format,
      compression,
      datePrefix: prefixInput.checked,
      nullAsBlank: nullInput.checked,
      escapeFormulas: formulaInput.checked,
      scope,
      limit,
    });
    close();
  });
  footer.append(cancel, el("span", { class: "grow" }), save);

  modal.append(formatField, scopeField, limitField, nameField, optionsRow, formulaRow, hint, footer);

  // Null blanking and formula escaping are CSV-family options; JSON and Excel
  // keep real nulls and numbers.
  const syncOptions = (): void => {
    const csvFamily = format === "csv" || format === "csv-semicolon" || format === "tsv";
    formulaRow.classList.toggle("hidden", !csvFamily);
    optionsRow.classList.toggle("hidden", format === "json" || format === "jsonl");
  };
  formatSelect.addEventListener("change", syncOptions);
  syncOptions();

  function close(): void {
    overlay.remove();
    document.removeEventListener("keydown", onKey);
    callbacks.onClose();
  }
  function onKey(event: KeyboardEvent): void {
    if (event.key === "Escape") close();
  }
  closeButton.addEventListener("click", close);
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) close();
  });
  document.addEventListener("keydown", onKey);

  overlay.append(modal);
  document.body.append(overlay);
  setupDialog(overlay, "Export data");
}

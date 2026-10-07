import { setupDialog } from "./dialog.js";
import { el } from "./dom.js";

export interface ExportSettings {
  nullAsBlank: boolean;
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
 * Export dialog: confirms the file name and options before anything is
 * written, and lists the formats the app can emit. Formats beyond CSV are
 * shown as planned so the choice stays discoverable.
 */
export function openExportPanel(
  defaultName: string,
  settings: ExportSettings,
  callbacks: ExportPanelCallbacks,
): void {
  const overlay = el("div", { class: "modal-overlay" });
  const modal = el("div", { class: "modal export-modal" });

  const head = el("div", { class: "modal-head" });
  head.append(el("h2", {}, ["Export data"]));
  const closeButton = el("button", { class: "icon-btn", type: "button", title: "Close" }, ["×"]);
  head.append(closeButton);
  modal.append(head);

  const formatField = el("label", { class: "clean-field" });
  formatField.append(el("span", { class: "clean-label" }, ["Format"]));
  const formatSelect = el("select", { "aria-label": "Export format" }) as HTMLSelectElement;
  formatSelect.append(el("option", { value: "csv" }, ["CSV (.csv)"]) as HTMLOptionElement);
  const parquet = el("option", { value: "parquet" }, ["Parquet (planned)"]) as HTMLOptionElement;
  parquet.disabled = true;
  formatSelect.append(parquet);
  formatField.append(formatSelect);

  const nameField = el("label", { class: "clean-field" });
  nameField.append(el("span", { class: "clean-label" }, ["File name"]));
  const nameInput = el("input", {
    class: "text-input",
    type: "text",
    value: defaultName,
    spellcheck: "false",
    "aria-label": "Export file name",
  }) as HTMLInputElement;
  nameField.append(nameInput);

  const optionsRow = el("label", { class: "control check clean-check" });
  const nullInput = el("input", { type: "checkbox" }) as HTMLInputElement;
  nullInput.checked = settings.nullAsBlank;
  optionsRow.append(nullInput, "Blank null values");

  const hint = el("div", { class: "clean-hint" }, [
    "The file is built in this browser. When your browser supports it, you choose the folder and name in the system save dialog.",
  ]);

  const footer = el("div", { class: "clean-footer" });
  const cancel = el("button", { class: "ghost", type: "button" }, ["Cancel"]);
  cancel.addEventListener("click", close);
  const save = el("button", { class: "primary", type: "button" }, ["Save file"]);
  save.addEventListener("click", () => {
    const fileName = ensureCsvExtension(nameInput.value, defaultName);
    callbacks.onSave(fileName, { nullAsBlank: nullInput.checked });
    close();
  });
  footer.append(cancel, el("span", { class: "grow" }), save);

  modal.append(formatField, nameField, optionsRow, hint, footer);

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

import { el } from "./dom.js";
import {
  DEFAULT_HEADER_OPTIONS,
  normalizeHeaders,
  type HeaderCaseStyle,
  type HeaderNormalizeOptions,
} from "../data/headers.js";

export interface CleanPanelCallbacks {
  onApply: (headers: string[]) => void;
  onClose: () => void;
}

const CASE_STYLES: readonly { value: HeaderCaseStyle; label: string }[] = [
  { value: "keep", label: "Keep as-is" },
  { value: "snake", label: "snake_case" },
  { value: "camel", label: "camelCase" },
  { value: "title", label: "Title Case" },
  { value: "lower", label: "lower case" },
  { value: "upper", label: "UPPER CASE" },
];

/**
 * First Clean panel: column-name normalisation only. A live preview shows the
 * exact before/after mapping before anything is applied. Value-level clean
 * operations will follow the same panel pattern later.
 */
export function openCleanPanel(
  headers: readonly string[],
  callbacks: CleanPanelCallbacks,
): void {
  const options: HeaderNormalizeOptions = { ...DEFAULT_HEADER_OPTIONS };

  const overlay = el("div", { class: "modal-overlay" });
  const modal = el("div", { class: "modal clean-modal" });

  const head = el("div", { class: "modal-head" });
  head.append(el("h2", {}, ["Clean — column names"]));
  const closeButton = el("button", { class: "icon-btn", type: "button", title: "Close" }, ["×"]);
  head.append(closeButton);
  modal.append(head);

  const caseField = el("label", { class: "clean-field" });
  caseField.append(el("span", { class: "clean-label" }, ["Case"]));
  const caseSelect = el("select") as HTMLSelectElement;
  for (const { value, label } of CASE_STYLES) {
    const option = el("option", { value }, [label]) as HTMLOptionElement;
    if (value === options.caseStyle) option.selected = true;
    caseSelect.append(option);
  }
  caseSelect.addEventListener("change", () => {
    options.caseStyle = caseSelect.value as HeaderCaseStyle;
    renderPreview();
  });
  caseField.append(caseSelect);

  const toggles = el("div", { class: "clean-toggles" });
  toggles.append(
    buildToggle("Trim whitespace", options.trim, (value) => {
      options.trim = value;
      renderPreview();
    }),
    buildToggle("Strip brackets", options.stripBrackets, (value) => {
      options.stripBrackets = value;
      renderPreview();
    }),
    buildToggle("Deduplicate names", options.dedupe, (value) => {
      options.dedupe = value;
      renderPreview();
    }),
  );

  const previewSummary = el("div", { class: "clean-summary" });
  const previewList = el("div", { class: "clean-preview" });

  function renderPreview(): void {
    const next = normalizeHeaders(headers, options);
    let changed = 0;
    const fragment = document.createDocumentFragment();
    for (let i = 0; i < headers.length; i++) {
      if (headers[i] === next[i]) continue;
      changed++;
      const row = el("div", { class: "clean-preview-row" });
      row.append(
        el("span", { class: "clean-preview-old", title: headers[i] }, [headers[i]]),
        el("span", { class: "clean-preview-arrow" }, ["→"]),
        el("span", { class: "clean-preview-new", title: next[i] }, [next[i]]),
      );
      fragment.append(row);
    }
    previewList.replaceChildren(fragment);
    previewSummary.textContent =
      changed === 0 ? "No changes." : `${changed} of ${headers.length} columns will be renamed`;
  }

  const footer = el("div", { class: "clean-footer" });
  const cancel = el("button", { class: "ghost", type: "button" }, ["Cancel"]);
  cancel.addEventListener("click", close);
  const apply = el("button", { class: "primary", type: "button" }, ["Apply"]);
  apply.addEventListener("click", () => {
    callbacks.onApply(normalizeHeaders(headers, options));
    close();
  });
  footer.append(cancel, el("span", { class: "grow" }), apply);

  modal.append(caseField, toggles, previewSummary, previewList, footer);

  function close(): void {
    overlay.remove();
    document.removeEventListener("keydown", onKey);
    callbacks.onClose();
  }
  const onKey = (event: KeyboardEvent): void => {
    if (event.key === "Escape") close();
  };
  closeButton.addEventListener("click", close);
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) close();
  });
  document.addEventListener("keydown", onKey);

  overlay.append(modal);
  document.body.append(overlay);

  renderPreview();
}

function buildToggle(
  label: string,
  initial: boolean,
  onChange: (value: boolean) => void,
): HTMLElement {
  const wrap = el("label", { class: "control check clean-check" });
  const input = el("input", { type: "checkbox" }) as HTMLInputElement;
  input.checked = initial;
  input.addEventListener("change", () => onChange(input.checked));
  wrap.append(input, label);
  return wrap;
}

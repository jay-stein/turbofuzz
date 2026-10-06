import { clear, el } from "./dom.js";
import {
  DEFAULT_HEADER_OPTIONS,
  normalizeHeaders,
  type HeaderCaseStyle,
  type HeaderNormalizeOptions,
} from "../data/headers.js";
import {
  applyCleanOps,
  describeCleanOp,
  type CleanOp,
} from "../data/clean-ops.js";
import type { ColumnMeta } from "../worker/protocol.js";

export interface CleanPanelCallbacks {
  onApplyHeaders: (headers: string[]) => void;
  onApplyClean: (column: number, ops: CleanOp[]) => void;
  onResetCleans: () => void;
  onApplyNullPolicy: (column: number, extra: string[], keep: string[]) => void;
  onApplyNullPolicyAll: (extra: string[], keep: string[]) => void;
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

const OP_TYPES: readonly { value: string; label: string }[] = [
  { value: "trim", label: "Trim whitespace" },
  { value: "upper", label: "UPPERCASE" },
  { value: "lower", label: "lowercase" },
  { value: "title", label: "Title Case" },
  { value: "replace", label: "Find & replace" },
];

/**
 * Clean panel: column-name normalisation and non-destructive value cleaning.
 * Both tabs preview exactly what will change before anything is applied, and
 * the worker keeps the untouched source so cleans can be reverted.
 */
export function openCleanPanel(
  metas: readonly ColumnMeta[],
  cleaned: ReadonlyMap<number, CleanOp[]>,
  callbacks: CleanPanelCallbacks,
): void {
  const overlay = el("div", { class: "modal-overlay" });
  const modal = el("div", { class: "modal clean-modal" });

  const head = el("div", { class: "modal-head" });
  head.append(el("h2", {}, ["Clean"]));
  const closeButton = el("button", { class: "icon-btn", type: "button", title: "Close" }, ["×"]);
  head.append(closeButton);
  modal.append(head);

  const tabs = el("div", { class: "clean-tabs" });
  const namesButton = el("button", { class: "clean-tab", type: "button" }, ["Column names"]);
  const valuesButton = el("button", { class: "clean-tab", type: "button" }, ["Values"]);
  const nullsButton = el("button", { class: "clean-tab", type: "button" }, ["Nulls"]);
  tabs.append(namesButton, valuesButton, nullsButton);

  const namesTab = buildNamesTab(metas.map((meta) => meta.name), callbacks, close);
  const valuesTab = buildValuesTab(metas, cleaned, callbacks, close);
  const nullsTab = buildNullsTab(metas, callbacks, close);
  modal.append(tabs, namesTab, valuesTab, nullsTab);

  type Tab = "names" | "values" | "nulls";
  function selectTab(tab: Tab): void {
    namesButton.classList.toggle("active", tab === "names");
    valuesButton.classList.toggle("active", tab === "values");
    nullsButton.classList.toggle("active", tab === "nulls");
    namesTab.classList.toggle("hidden", tab !== "names");
    valuesTab.classList.toggle("hidden", tab !== "values");
    nullsTab.classList.toggle("hidden", tab !== "nulls");
  }
  namesButton.addEventListener("click", () => selectTab("names"));
  valuesButton.addEventListener("click", () => selectTab("values"));
  nullsButton.addEventListener("click", () => selectTab("nulls"));
  selectTab("names");

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
}

function buildNamesTab(
  headers: readonly string[],
  callbacks: CleanPanelCallbacks,
  close: () => void,
): HTMLElement {
  const options: HeaderNormalizeOptions = { ...DEFAULT_HEADER_OPTIONS };
  const wrap = el("div", { class: "clean-names" });

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
  const apply = el("button", { class: "primary", type: "button" }, ["Apply names"]);
  apply.addEventListener("click", () => {
    callbacks.onApplyHeaders(normalizeHeaders(headers, options));
    close();
  });
  footer.append(cancel, el("span", { class: "grow" }), apply);

  wrap.append(caseField, toggles, previewSummary, previewList, footer);
  renderPreview();
  return wrap;
}

function buildValuesTab(
  metas: readonly ColumnMeta[],
  cleaned: ReadonlyMap<number, CleanOp[]>,
  callbacks: CleanPanelCallbacks,
  close: () => void,
): HTMLElement {
  const wrap = el("div", { class: "clean-values" });

  let column = 0;
  let pending: CleanOp[] = (cleaned.get(column) ?? []).slice();

  const colField = el("label", { class: "clean-field" });
  colField.append(el("span", { class: "clean-label" }, ["Column"]));
  const colSelect = el("select") as HTMLSelectElement;
  metas.forEach((meta, index) => {
    colSelect.append(el("option", { value: String(index) }, [meta.name]) as HTMLOptionElement);
  });
  colField.append(colSelect);

  const opField = el("label", { class: "clean-field" });
  opField.append(el("span", { class: "clean-label" }, ["Operation"]));
  const opSelect = el("select") as HTMLSelectElement;
  for (const { value, label } of OP_TYPES) {
    opSelect.append(el("option", { value }, [label]) as HTMLOptionElement);
  }
  opField.append(opSelect);

  const replaceRow = el("div", { class: "clean-field replace-row hidden" });
  const findInput = el("input", {
    class: "text-input",
    type: "text",
    placeholder: "Find",
    spellcheck: "false",
  }) as HTMLInputElement;
  const replacementInput = el("input", {
    class: "text-input",
    type: "text",
    placeholder: "Replace with",
    spellcheck: "false",
  }) as HTMLInputElement;
  const ignoreCaseLabel = el("label", { class: "control check clean-check" });
  const ignoreCaseInput = el("input", { type: "checkbox" }) as HTMLInputElement;
  ignoreCaseLabel.append(ignoreCaseInput, "Ignore case");
  replaceRow.append(findInput, replacementInput, ignoreCaseLabel);

  const syncOpType = (): void => {
    replaceRow.classList.toggle("hidden", opSelect.value !== "replace");
  };
  opSelect.addEventListener("change", syncOpType);

  const addButton = el("button", { class: "ghost small", type: "button" }, ["Add operation"]);
  addButton.addEventListener("click", () => {
    const op = readOp(opSelect.value, findInput.value, replacementInput.value, ignoreCaseInput.checked);
    if (op === null) return;
    pending.push(op);
    renderOps();
    renderPreview();
  });

  const opList = el("div", { class: "clean-op-list" });
  const previewSummary = el("div", { class: "clean-summary" });
  const preview = el("div", { class: "clean-preview" });

  function sampleValues(): string[] {
    const meta = metas[column];
    if (meta === undefined) return [];
    if (meta.categories !== null && meta.categories.labels.length > 0) {
      return meta.categories.labels.slice(0, 8);
    }
    return meta.stats.samples.slice(0, 8);
  }

  function renderOps(): void {
    clear(opList);
    if (pending.length === 0) {
      opList.append(el("div", { class: "clean-empty" }, ["No operations — this column is unchanged."]));
      return;
    }
    pending.forEach((op, index) => {
      const row = el("div", { class: "clean-op" });
      const remove = el("button", { class: "icon-btn", type: "button", title: "Remove" }, ["×"]);
      remove.addEventListener("click", () => {
        pending.splice(index, 1);
        renderOps();
        renderPreview();
      });
      row.append(
        el("span", { class: "clean-op-index" }, [String(index + 1)]),
        el("span", { class: "clean-op-desc" }, [describeCleanOp(op)]),
        remove,
      );
      opList.append(row);
    });
  }

  function renderPreview(): void {
    const samples = sampleValues();
    const results = applyCleanOps(samples, pending);
    clear(preview);
    if (samples.length === 0) {
      preview.append(el("div", { class: "clean-empty" }, ["No sample values."]));
    } else {
      const fragment = document.createDocumentFragment();
      for (let i = 0; i < samples.length; i++) {
        const row = el("div", { class: "clean-preview-row" });
        row.append(
          el("span", { class: "clean-preview-old", title: samples[i] }, [samples[i]]),
          el("span", { class: "clean-preview-arrow" }, ["→"]),
          el("span", { class: "clean-preview-new", title: results[i] }, [results[i]]),
        );
        fragment.append(row);
      }
      preview.append(fragment);
      const changed = samples.filter((value, i) => value !== results[i]).length;
      previewSummary.textContent =
        pending.length === 0
          ? `Preview of ${samples.length} sample values`
          : `Preview of ${samples.length} sample values · ${changed} would change`;
    }
  }

  colSelect.addEventListener("change", () => {
    column = Number(colSelect.value);
    pending = (cleaned.get(column) ?? []).slice();
    renderOps();
    renderPreview();
  });

  const footer = el("div", { class: "clean-footer" });
  if (cleaned.size > 0) {
    const reset = el("button", { class: "ghost", type: "button" }, [
      `Revert all (${cleaned.size})`,
    ]);
    reset.addEventListener("click", () => {
      callbacks.onResetCleans();
      close();
    });
    footer.append(reset);
  }
  footer.append(el("span", { class: "grow" }));
  const apply = el("button", { class: "primary", type: "button" }, ["Apply to column"]);
  apply.addEventListener("click", () => {
    callbacks.onApplyClean(column, pending.slice());
    close();
  });
  footer.append(apply);

  const builder = el("div", { class: "clean-builder" }, [opField, replaceRow, addButton]);
  wrap.append(colField, builder, opList, previewSummary, preview, footer);
  syncOpType();
  renderOps();
  renderPreview();
  return wrap;
}

function readOp(
  type: string,
  find: string,
  replacement: string,
  ignoreCase: boolean,
): CleanOp | null {
  switch (type) {
    case "trim":
      return { kind: "trim" };
    case "upper":
      return { kind: "case", style: "upper" };
    case "lower":
      return { kind: "case", style: "lower" };
    case "title":
      return { kind: "case", style: "title" };
    case "replace":
      return find === "" ? null : { kind: "replace", find, replacement, ignoreCase };
    default:
      return null;
  }
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

/**
 * Null review. Defaults to "All columns": one aggregated list of the values the
 * heuristic calls missing across the dataset, so the common case is a single
 * review and apply. A specific column can still be chosen for exceptions (e.g.
 * a town called "NULL" that is a real value in one column only).
 */
function buildNullsTab(
  metas: readonly ColumnMeta[],
  callbacks: CleanPanelCallbacks,
  close: () => void,
): HTMLElement {
  const wrap = el("div", { class: "clean-values" });

  let column: number | null = null;
  let extra = new Set<string>();
  let keep = new Set<string>();

  const colField = el("label", { class: "clean-field" });
  colField.append(el("span", { class: "clean-label" }, ["Columns"]));
  const colSelect = el("select") as HTMLSelectElement;
  colSelect.append(el("option", { value: "" }, ["All columns"]) as HTMLOptionElement);
  metas.forEach((meta, index) => {
    const option = el("option", { value: String(index) }) as HTMLOptionElement;
    const hasNulls = meta.stats.nulls > 0;
    option.textContent = hasNulls ? `• ${meta.name}` : meta.name;
    if (hasNulls) option.style.color = "var(--danger)";
    colSelect.append(option);
  });
  colField.append(colSelect);

  const hint = el("div", { class: "clean-hint" }, [
    "Ticked values are replaced with a blank when you apply. Untick anything that is a real value (e.g. a town called NULL).",
  ]);
  const list = el("div", { class: "null-list" });

  const extraField = el("div", { class: "clean-field" });
  extraField.append(el("span", { class: "clean-label" }, ["Also null"]));
  const extraInput = el("input", {
    class: "text-input",
    type: "text",
    placeholder: "Add a value to treat as null",
    spellcheck: "false",
  }) as HTMLInputElement;
  const addButton = el("button", { class: "ghost small", type: "button" }, ["Add"]);
  extraField.append(extraInput, addButton);
  const summary = el("div", { class: "clean-summary" });

  function currentTokens(): { label: string; count: number }[] {
    if (column !== null) return metas[column].nullTokens.map((token) => ({ ...token }));
    const counts = new Map<string, number>();
    for (const meta of metas) {
      for (const token of meta.nullTokens) {
        counts.set(token.label, (counts.get(token.label) ?? 0) + token.count);
      }
    }
    return [...counts.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
  }

  function render(): void {
    const tokens = currentTokens();
    const detected = new Set(tokens.map((token) => token.label));
    clear(list);

    const candidates = new Map<string, number>();
    for (const token of tokens) candidates.set(token.label, token.count);
    for (const label of keep) if (!candidates.has(label)) candidates.set(label, 0);
    for (const label of extra) if (!candidates.has(label)) candidates.set(label, 0);

    if (candidates.size === 0) {
      list.append(el("div", { class: "clean-empty" }, ["No nulls detected."]));
    } else {
      const entries = [...candidates.entries()].sort(
        (a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0),
      );
      for (const [label, count] of entries) {
        const isDetected = detected.has(label);
        const row = el("label", { class: "null-row" });
        const checkbox = el("input", { type: "checkbox" }) as HTMLInputElement;
        checkbox.checked = extra.has(label) || (isDetected && !keep.has(label));
        checkbox.addEventListener("change", () => {
          if (checkbox.checked) {
            keep.delete(label);
            if (!isDetected) extra.add(label);
          } else {
            keep.add(label);
            extra.delete(label);
          }
          renderSummary(tokens);
        });
        row.append(
          checkbox,
          el("span", { class: "null-label", title: label }, [label === "" ? "(blank)" : label]),
          el("span", { class: "null-count" }, [
            isDetected ? count.toLocaleString() : extra.has(label) ? "added" : "kept",
          ]),
        );
        list.append(row);
      }
    }
    renderSummary(tokens);
  }

  function renderSummary(tokens: readonly { label: string; count: number }[]): void {
    let nullCells = 0;
    for (const token of tokens) {
      if (!keep.has(token.label)) nullCells += token.count;
    }
    const parts = [`${nullCells.toLocaleString()} cells to blank`];
    if (keep.size > 0) parts.push(`${keep.size} kept`);
    if (extra.size > 0) parts.push(`${extra.size} added`);
    summary.textContent = parts.join(" · ");
  }

  function addExtra(): void {
    const value = extraInput.value;
    if (value === "") return;
    const alreadyNull = currentTokens().some((token) => token.label === value) && !keep.has(value);
    if (!alreadyNull) extra.add(value);
    extraInput.value = "";
    render();
  }
  addButton.addEventListener("click", addExtra);
  extraInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      addExtra();
    }
  });

  function loadColumn(index: number | null): void {
    column = index;
    extra = new Set();
    keep = new Set();
    if (index === null) {
      for (const meta of metas) {
        for (const token of meta.nullPolicy.extra) extra.add(token);
        for (const token of meta.nullPolicy.keep) keep.add(token);
      }
      colSelect.classList.toggle("has-nulls", metas.some((meta) => meta.stats.nulls > 0));
    } else {
      const meta = metas[index];
      for (const token of meta.nullPolicy.extra) extra.add(token);
      for (const token of meta.nullPolicy.keep) keep.add(token);
      colSelect.classList.toggle("has-nulls", meta.stats.nulls > 0);
    }
    render();
  }
  colSelect.addEventListener("change", () => {
    loadColumn(colSelect.value === "" ? null : Number(colSelect.value));
  });

  const footer = el("div", { class: "clean-footer" });
  const cancel = el("button", { class: "ghost", type: "button" }, ["Cancel"]);
  cancel.addEventListener("click", close);
  const apply = el("button", { class: "primary", type: "button" }, ["Apply nulls"]);
  apply.addEventListener("click", () => {
    if (column === null) callbacks.onApplyNullPolicyAll([...extra], [...keep]);
    else callbacks.onApplyNullPolicy(column, [...extra], [...keep]);
    close();
  });
  footer.append(cancel, el("span", { class: "grow" }), apply);

  wrap.append(colField, hint, list, extraField, summary, footer);
  loadColumn(null);
  return wrap;
}

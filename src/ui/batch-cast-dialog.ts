import type { CastOptions, CastPolicy, CastTarget } from "../data/cast-ops.js";
import type { CleanOp } from "../data/clean-ops.js";
import { castCompatibility } from "../data/type-lattice.js";
import { TYPE_LABELS, type ColumnType } from "../types.js";
import type { CleanPreviewMessage, CleanUpdate, ColumnMeta } from "../worker/protocol.js";
import { setupDialog } from "./dialog.js";
import { el } from "./dom.js";

const TARGETS: readonly CastTarget[] = [
  "integer",
  "number",
  "date",
  "datetime",
  "time",
  "duration",
  "boolean",
];

const TARGET_LABELS: Record<CastTarget, string> = {
  integer: "Integer",
  number: "Number",
  date: "Date",
  datetime: "Date & time",
  time: "Time of day",
  duration: "Duration",
  boolean: "Boolean",
};

export interface BatchCastColumn {
  index: number;
  name: string;
  type: ColumnType;
  suggested: CastTarget | null;
  locale: ColumnMeta["numberLocale"];
  order: ColumnMeta["dateOrder"];
  existing: CleanOp[];
}

export interface BatchCastDialogInput {
  columns: readonly BatchCastColumn[];
  preview: (updates: CleanUpdate[]) => Promise<CleanPreviewMessage>;
}

export interface BatchCastDialogResult {
  updates: CleanUpdate[];
  previous: CleanUpdate[];
  count: number;
}

function castOp(column: BatchCastColumn, target: CastTarget, policy: CastPolicy): CleanOp {
  return {
    kind: "cast",
    target,
    policy,
    locale: column.locale,
    order: column.order,
  };
}

/** Multi-column cast queue with one preview request and one apply/undo unit. */
export function openBatchCastDialog(
  input: BatchCastDialogInput,
): Promise<BatchCastDialogResult | null> {
  return new Promise((resolve) => {
    const overlay = el("div", { class: "modal-overlay" });
    const modal = el("div", { class: "modal batch-cast-modal" });
    const head = el("div", { class: "modal-head" });
    head.append(el("h2", {}, ["Convert column types"]));
    const closeButton = el(
      "button",
      { class: "icon-btn", type: "button", title: "Close" },
      ["×"],
    );
    head.append(closeButton);
    modal.append(head);

    const body = el("div", { class: "batch-cast-body" });
    body.append(
      el("p", { class: "batch-cast-note" }, [
        "Convert several columns in one pass. Values are rewritten once and can be undone together.",
      ]),
    );
    const policyRow = el("div", { class: "batch-cast-policy" });
    const policyLabel = el("label", { class: "chart-field" });
    policyLabel.append(el("span", { class: "chart-field-label" }, ["Invalid values"]));
    const policySelect = el("select", {
      class: "chart-select",
      "aria-label": "Batch invalid value policy",
    }) as HTMLSelectElement;
    for (const [value, label] of [
      ["coerce", "Coerce to blank"],
      ["keep", "Keep original text"],
      ["reject", "Reject the batch"],
    ] as const) {
      policySelect.append(el("option", { value }, [label]) as HTMLOptionElement);
    }
    policyLabel.append(policySelect);
    policyRow.append(policyLabel);
    const selectAll = el("button", { class: "ghost small", type: "button" }, ["Select all"]);
    const clearAll = el("button", { class: "ghost small", type: "button" }, ["Clear"]);
    policyRow.append(selectAll, clearAll, el("span", { class: "grow" }));
    body.append(policyRow);

    const table = el("div", { class: "batch-cast-table" });
    const header = el("div", { class: "batch-cast-row head" }, [
      el("span", {}, [""]),
      el("span", {}, ["Column"]),
      el("span", {}, ["Current"]),
      el("span", {}, ["Suggested"]),
      el("span", {}, ["Convert to"]),
      el("span", {}, ["Issues"]),
    ]);
    table.append(header);
    const rows = new Map<
      number,
      {
        input: BatchCastColumn;
        checkbox: HTMLInputElement;
        target: HTMLSelectElement;
        failures: HTMLElement;
      }
    >();
    for (const column of input.columns) {
      const checkbox = el("input", {
        type: "checkbox",
        ...(column.suggested !== null ? { checked: "checked" } : {}),
        "aria-label": `Select ${column.name}`,
      }) as HTMLInputElement;
      const target = el("select", {
        class: "chart-select batch-cast-target",
        "aria-label": `Target type for ${column.name}`,
      }) as HTMLSelectElement;
      target.append(el("option", { value: "" }, ["Keep current"]) as HTMLOptionElement);
      for (const value of TARGETS) {
        const option = el("option", { value }, [TARGET_LABELS[value]]) as HTMLOptionElement;
        if (value === (column.suggested ?? column.type)) option.selected = true;
        target.append(option);
      }
      target.value = column.suggested ?? "";
      const failures = el("span", { class: "batch-cast-failures" });
      const row = el("label", { class: "batch-cast-row" }, [
        checkbox,
        el("span", { class: "batch-cast-name", title: column.name }, [column.name]),
        el("span", { class: "batch-cast-type" }, [TYPE_LABELS[column.type]]),
        el("span", { class: "batch-cast-suggested" }, [
          column.suggested === null ? "-" : TARGET_LABELS[column.suggested],
        ]),
        target,
        failures,
      ]);
      const updateCompatibility = (): void => {
        if (target.value === "") {
          target.title = "Keep the current type";
          target.removeAttribute("aria-description");
          return;
        }
        const compatibility = castCompatibility(column.type, target.value as CastTarget);
        target.title = compatibility.reason;
        target.dataset.risk = compatibility.risk;
        target.setAttribute("aria-description", compatibility.reason);
      };
      checkbox.addEventListener("change", () => schedulePreview());
      target.addEventListener("change", () => {
        if (target.value !== "") checkbox.checked = true;
        updateCompatibility();
        schedulePreview();
      });
      updateCompatibility();
      rows.set(column.index, { input: column, checkbox, target, failures });
      table.append(row);
    }
    body.append(table);

    const summary = el("div", { class: "batch-cast-summary", role: "status" }, [
      "Select one or more columns.",
    ]);
    const examples = el("div", { class: "batch-cast-examples" });
    body.append(summary, examples);

    const footer = el("div", { class: "clean-footer" });
    const cancel = el("button", { class: "ghost", type: "button" }, ["Cancel"]);
    const apply = el("button", { class: "primary", type: "button" }, ["Convert selected"]) as HTMLButtonElement;
    apply.disabled = true;
    footer.append(cancel, el("span", { class: "grow" }), apply);
    modal.append(body, footer);

    let settled = false;
    let generation = 0;
    let timer: number | null = null;
    let latestFailures = false;
    const close = (value: BatchCastDialogResult | null): void => {
      if (settled) return;
      settled = true;
      if (timer !== null) window.clearTimeout(timer);
      overlay.remove();
      resolve(value);
    };
    const updates = (): { updates: CleanUpdate[]; previous: CleanUpdate[]; count: number } => {
      const next: CleanUpdate[] = [];
      const previous: CleanUpdate[] = [];
      for (const { input: column, checkbox, target } of rows.values()) {
        if (!checkbox.checked || target.value === "") continue;
        next.push({
          column: column.index,
          ops: [...column.existing, castOp(column, target.value as CastTarget, policySelect.value as CastPolicy)],
        });
        previous.push({ column: column.index, ops: column.existing });
      }
      return { updates: next, previous, count: next.length };
    };
    const schedulePreview = (): void => {
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => void preview(), 120);
    };
    const preview = async (): Promise<void> => {
      const current = ++generation;
      const request = updates();
      for (const { failures } of rows.values()) failures.textContent = "";
      if (request.updates.length === 0) {
        latestFailures = false;
        summary.textContent = "Select one or more columns.";
        examples.replaceChildren();
        apply.disabled = true;
        apply.textContent = "Convert selected";
        return;
      }
      summary.textContent = `Checking ${request.count} column${request.count === 1 ? "" : "s"}...`;
      apply.disabled = true;
      try {
        const result = await input.preview(request.updates);
        if (settled || current !== generation) return;
        let changed = 0;
        let failed = 0;
        let rejected = false;
        const failedExamples: string[] = [];
        for (const counts of result.columns) {
          const row = rows.get(counts.column);
          changed += counts.changed;
          failed += counts.failed;
          if (row !== undefined) {
            row.failures.textContent = counts.failed > 0 ? counts.failed.toLocaleString() : "";
            row.failures.title = counts.examples?.join(", ") ?? "";
          }
          if (counts.failed > 0) {
            rejected = policySelect.value === "reject";
            if (counts.examples !== undefined) failedExamples.push(...counts.examples);
          }
        }
        latestFailures = rejected;
        apply.disabled = rejected;
        apply.textContent = `Convert ${request.count} column${request.count === 1 ? "" : "s"}`;
        summary.textContent = rejected
          ? `Rejected: ${failed.toLocaleString()} values do not parse under this policy.`
          : `${changed.toLocaleString()} cells across ${request.count} column${
              request.count === 1 ? "" : "s"
            } will change${failed > 0 ? `; ${failed.toLocaleString()} values do not parse` : ""}.`;
        examples.replaceChildren();
        if (failedExamples.length > 0) {
          examples.append(
            el("span", { class: "batch-cast-example-label" }, ["Examples: "]),
            el("span", {}, [[...new Set(failedExamples)].slice(0, 6).join(", ")]),
          );
        }
      } catch {
        if (settled || current !== generation) return;
        latestFailures = true;
        apply.disabled = true;
        summary.textContent = "Could not preview the batch conversion.";
      }
    };
    selectAll.addEventListener("click", () => {
      for (const { input: column, checkbox, target } of rows.values()) {
        if (target.value === "" && column.suggested !== null) {
          target.value = column.suggested;
        }
        checkbox.checked = target.value !== "";
      }
      schedulePreview();
    });
    clearAll.addEventListener("click", () => {
      for (const { checkbox } of rows.values()) checkbox.checked = false;
      schedulePreview();
    });
    policySelect.addEventListener("change", schedulePreview);
    closeButton.addEventListener("click", () => close(null));
    cancel.addEventListener("click", () => close(null));
    apply.addEventListener("click", () => {
      if (latestFailures) return;
      const request = updates();
      if (request.count === 0) return;
      close(request);
    });
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) close(null);
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") close(null);
    });
    overlay.append(modal);
    document.body.append(overlay);
    setupDialog(overlay, "Convert column types");
    void preview();
  });
}
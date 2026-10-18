import type { CastOptions, CastPolicy, CastTarget } from "../data/cast-ops.js";
import type { DateOrder } from "../parse/dates.js";
import type { NumberLocale } from "../parse/numbers.js";
import type { ColumnType } from "../types.js";
import { TYPE_LABELS } from "../types.js";
import { setupDialog } from "./dialog.js";
import { el } from "./dom.js";

export interface CastPreviewCounts {
  changed: number;
  total: number;
  failed: number;
  examples?: string[];
}

export type CastDialogResult =
  | { kind: "cast"; options: CastOptions }
  | { kind: "reinterpret" }
  | null;

export interface CastDialogInput {
  name: string;
  fromType: ColumnType;
  target: CastTarget;
  initial: CastOptions;
  preview: (options: CastOptions) => Promise<CastPreviewCounts>;
}

const TARGET_LABELS: Record<CastTarget, string> = {
  integer: "Integer",
  number: "Number",
  date: "Date",
  datetime: "Date & time",
  time: "Time of day",
  duration: "Duration",
  boolean: "Boolean",
};

const POLICY_LABELS: Record<CastPolicy, string> = {
  coerce: "Coerce invalid values to blank (pandas-style)",
  keep: "Keep invalid values as text",
  reject: "Cancel the conversion if any value fails",
};

export function openCastDialog(input: CastDialogInput): Promise<CastDialogResult> {
  return new Promise((resolve) => {
    const overlay = el("div", { class: "modal-overlay" });
    const modal = el("div", { class: "modal cast-modal" });

    const head = el("div", { class: "modal-head" });
    head.append(
      el("h2", {}, [
        `Change "${input.name}" from ${TYPE_LABELS[input.fromType]} to ${TARGET_LABELS[input.target]}`,
      ]),
    );
    const closeButton = el("button", {
      class: "icon-btn",
      type: "button",
      title: "Close",
    }, ["×"]);
    head.append(closeButton);
    modal.append(head);

    const body = el("div", { class: "chart-setup-body" });
    body.append(
      el("p", { class: "confirm-body" }, [
        "Valid values are rewritten into the canonical format. Invalid values are handled by the policy below.",
      ]),
    );

    const policyField = el("label", { class: "chart-setup-field" });
    policyField.append(el("span", { class: "chart-field-label" }, ["Invalid values"]));
    const policySelect = el("select", {
      class: "chart-select",
      "aria-label": "Invalid value policy",
    }) as HTMLSelectElement;
    for (const policy of ["coerce", "keep", "reject"] as const) {
      policySelect.append(
        el("option", { value: policy }, [POLICY_LABELS[policy]]) as HTMLOptionElement,
      );
    }
    policySelect.value = input.initial.policy;
    policyField.append(policySelect);
    body.append(policyField);

    const localeField = el("label", { class: "chart-setup-field" });
    localeField.append(el("span", { class: "chart-field-label" }, ["Decimal convention"]));
    const localeSelect = el("select", {
      class: "chart-select",
      "aria-label": "Decimal convention",
    }) as HTMLSelectElement;
    localeSelect.append(
      el("option", { value: "dot" }, ["Decimal point (1,234.56)"]) as HTMLOptionElement,
      el("option", { value: "comma" }, ["Decimal comma (1.234,56)"]) as HTMLOptionElement,
    );
    localeSelect.value = input.initial.locale ?? "dot";
    localeField.append(localeSelect);
    const wantsLocale = input.target === "number" || input.target === "integer";
    localeField.classList.toggle("hidden", !wantsLocale);
    body.append(localeField);

    const orderField = el("label", { class: "chart-setup-field" });
    orderField.append(el("span", { class: "chart-field-label" }, ["Date order"]));
    const orderSelect = el("select", {
      class: "chart-select",
      "aria-label": "Date order",
    }) as HTMLSelectElement;
    orderSelect.append(
      el("option", { value: "dmy" }, ["Day first (DD/MM/YYYY)"]) as HTMLOptionElement,
      el("option", { value: "mdy" }, ["Month first (MM/DD/YYYY)"]) as HTMLOptionElement,
    );
    orderSelect.value = input.initial.dateOrder ?? "dmy";
    orderField.append(orderSelect);
    const wantsOrder = input.target === "date" || input.target === "datetime";
    orderField.classList.toggle("hidden", !wantsOrder);
    body.append(orderField);

    const summary = el("div", { class: "cast-summary", role: "status" }, [
      "Checking the conversion...",
    ]);
    const examples = el("div", { class: "cast-examples" });
    body.append(summary, examples);

    const errorEl = el("div", { class: "chart-setup-error", role: "alert" });
    modal.append(body, errorEl);

    const footer = el("div", { class: "clean-footer" });
    const cancel = el("button", { class: "ghost", type: "button" }, ["Cancel"]);
    const reinterpret = el("button", { class: "ghost", type: "button" }, [
      "Reinterpret only",
    ]);
    reinterpret.title = "Change the logical type without rewriting values.";
    const confirm = el("button", { class: "primary", type: "button" }, [
      `Convert to ${TARGET_LABELS[input.target]}`,
    ]);
    footer.append(cancel, reinterpret, el("span", { class: "grow" }), confirm);
    modal.append(footer);

    let settled = false;
    let generation = 0;
    let latest: CastPreviewCounts | null = null;

    const finish = (value: CastDialogResult): void => {
      if (settled) return;
      settled = true;
      overlay.remove();
      document.removeEventListener("keydown", onKey);
      resolve(value);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") finish(null);
    };

    const options = (): CastOptions => ({
      target: input.target,
      policy: policySelect.value as CastPolicy,
      locale: localeSelect.value as NumberLocale,
      dateOrder: orderSelect.value as DateOrder,
    });

    const render = (counts: CastPreviewCounts): void => {
      latest = counts;
      const wouldChange = counts.changed.toLocaleString();
      const total = counts.total.toLocaleString();
      const failed = counts.failed.toLocaleString();
      summary.textContent =
        counts.failed === 0
          ? `${wouldChange} of ${total} values will be converted.`
          : `${wouldChange} of ${total} values will be converted; ${failed} don't parse as ${TARGET_LABELS[
              input.target
            ].toLowerCase()}.`;
      examples.replaceChildren();
      if (counts.examples !== undefined && counts.examples.length > 0) {
        examples.append(
          el("div", { class: "cast-examples-label" }, ["Examples that don't parse"]),
          el("div", { class: "cast-example-values" }, [
            counts.examples.map((value) => `"${value}"`).join(", "),
          ]),
        );
      }
      confirm.disabled = policySelect.value === "reject" && counts.failed > 0;
    };

    const refresh = (): void => {
      const current = ++generation;
      summary.textContent = "Checking the conversion...";
      examples.replaceChildren();
      confirm.disabled = true;
      void input
        .preview(options())
        .then((counts) => {
          if (settled || current !== generation) return;
          render(counts);
        })
        .catch(() => {
          if (settled || current !== generation) return;
          latest = null;
          summary.textContent = "Could not preview the conversion.";
          confirm.disabled = true;
        });
    };

    policySelect.addEventListener("change", refresh);
    localeSelect.addEventListener("change", refresh);
    orderSelect.addEventListener("change", refresh);
    closeButton.addEventListener("click", () => finish(null));
    cancel.addEventListener("click", () => finish(null));
    reinterpret.addEventListener("click", () => finish({ kind: "reinterpret" }));
    confirm.addEventListener("click", () => {
      if (latest === null || confirm.disabled) return;
      finish({ kind: "cast", options: options() });
    });
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) finish(null);
    });
    document.addEventListener("keydown", onKey);

    overlay.append(modal);
    document.body.append(overlay);
    setupDialog(overlay, `Change column type`);
    refresh();
  });
}

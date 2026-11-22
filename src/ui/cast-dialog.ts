import type { CastOptions, CastPolicy, CastTarget } from "../data/cast-ops.js";
import { createDateFormatPicker } from "./date-format-picker.js";
import type { NumberLocale } from "../parse/numbers.js";
import type { ColumnType } from "../types.js";
import { TYPE_LABELS } from "../types.js";
import { CAST_LOSS_CONFIRM_SHARE } from "../data/cast-ops.js";
import { setupDialog } from "./dialog.js";
import { el } from "./dom.js";
import type { DateAuditMessage } from "../worker/protocol.js";
import { openDateAudit, readAs } from "./date-audit-dialog.js";
import { isTemporalType } from "../types.js";

export interface CastPreviewCounts {
  changed: number;
  total: number;
  failed: number;
  examples?: string[];
  /** Non-empty cells; the base for the loss percentage. */
  nonEmpty?: number;
  /** Cells whose digits a number cast would change (leading zeros, 16+ digits). */
  digitLoss?: number;
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
  /** Some of the column's values, to show which date formats fit. */
  samples?: readonly string[];
  /** A column already read as dates: its file text beside what it was read as (date-audit-dialog.ts). */
  audit?: () => Promise<DateAuditMessage>;
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
    // Already dates (date & time to date, or back): nothing is parsed again, so there are no formats
    // or invalid values to choose; the dialog says what happens to each value and shows it.
    const alreadyDates = isTemporalType(input.fromType) && (input.target === "date" || input.target === "datetime") && input.fromType !== "time" && input.fromType !== "duration";
    body.append(
      el("p", { class: "confirm-body" }, [
        alreadyDates
          ? input.target === "date"
            ? "These values are already read as dates. Converting keeps each one's day and drops its time of day."
            : "These values are already read as dates. Converting gives each one a time of day of 00:00."
          : "Valid values are rewritten into the canonical format. Invalid values are handled by the policy below.",
      ]),
    );
    const already = el("div", { class: "cast-already hidden" });
    body.append(already);
    if (alreadyDates && input.audit !== undefined) {
      already.classList.remove("hidden");
      already.append(el("p", { class: "cast-already-wait" }, ["Reading some values…"]));
      void input.audit().then((audit) => {
        const sample = audit.rows.filter((row) => Number.isFinite(row.value));
        const timed = sample.filter((row) => row.value % 86_400_000 !== 0).length;
        const lines = el("table", { class: "cast-already-table" }, [
          el("thead", {}, [el("tr", {}, [el("th", {}, ["In the file"]), el("th", {}, ["Now"]), el("th", {}, ["After"])])]),
          el(
            "tbody",
            {},
            sample.slice(0, 4).map((row) =>
              el("tr", {}, [
                el("td", { class: "mono" }, [row.text]),
                el("td", { class: "mono" }, [readAs(audit.columnType, row.value)]),
                el("td", { class: "mono" }, [readAs(input.target as "date" | "datetime", input.target === "date" ? row.value - (((row.value % 86_400_000) + 86_400_000) % 86_400_000) : row.value)]),
              ]),
            ),
          ),
        ]);
        const loss =
          input.target !== "date"
            ? ""
            : timed === 0
              ? `In the first ${sample.length.toLocaleString()} values every time is 00:00:00, so nothing but that is dropped.`
              : `${timed.toLocaleString()} of the first ${sample.length.toLocaleString()} values have a time of day, which is dropped.`;
        const check = el("button", { class: "link small", type: "button" }, ["See how the whole column was read"]);
        check.addEventListener("click", () => openDateAudit(input.name, input.audit!));
        already.replaceChildren(lines, ...(loss === "" ? [] : [el("p", { class: "cast-already-note" }, [loss])]), check);
      }, () => already.classList.add("hidden"));
    }

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
    policyField.classList.toggle("hidden", alreadyDates);
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

    const wantsOrder = input.target === "date" || input.target === "datetime";
    const picker = createDateFormatPicker({
      samples: input.samples ?? [],
      initial: input.initial.dateOrder ?? "dmy",
      withTime: input.target === "datetime",
      onChange: () => refresh(),
    });
    picker.root.classList.toggle("hidden", !wantsOrder || alreadyDates);
    body.append(picker.root);

    const summary = el("div", { class: "cast-summary", role: "status" }, [
      "Checking the conversion...",
    ]);
    const examples = el("div", { class: "cast-examples" });
    body.append(summary, examples);

    // Blanking more than 1% of the values needs an explicit yes.
    const lossBox = el("input", { type: "checkbox" }) as HTMLInputElement;
    const lossText = el("span", {});
    const lossConfirm = el("label", { class: "cast-loss-confirm hidden" }, [lossBox, lossText]);
    const guard = el("div", { class: "chart-setup-error", role: "alert" });
    body.append(lossConfirm, guard);

    const errorEl = el("div", { class: "chart-setup-error", role: "alert" });
    modal.append(body, errorEl);

    const footer = el("div", { class: "clean-footer" });
    const cancel = el("button", { class: "ghost", type: "button" }, ["Cancel"]);
    const reinterpret = el("button", { class: "ghost", type: "button" }, [
      "Reinterpret only",
    ]);
    reinterpret.title = "Change the logical type without rewriting values.";
    // Between date & time and date there is nothing to reinterpret: the values are dates either way.
    reinterpret.classList.toggle("hidden", alreadyDates);
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
      dateOrder: picker.value() ?? input.initial.dateOrder ?? "dmy",
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
      guardrails(counts);
    };

    // Refuse outright when digits would change; ask first when many values would blank.
    const guardrails = (counts: CastPreviewCounts): void => {
      const digitLoss = counts.digitLoss ?? 0;
      const nonEmpty = Math.max(1, counts.nonEmpty ?? counts.total);
      const blanks = policySelect.value === "coerce" ? counts.failed : 0;
      const share = blanks / nonEmpty;
      guard.textContent =
        digitLoss > 0
          ? `${digitLoss.toLocaleString()} value${digitLoss === 1 ? "" : "s"} start with zeros or have too many digits, so converting would change them. Keep the column as text, or treat it as an identifier.`
          : "";
      const needsConfirm = digitLoss === 0 && share > CAST_LOSS_CONFIRM_SHARE;
      lossConfirm.classList.toggle("hidden", !needsConfirm);
      lossText.textContent = ` ${blanks.toLocaleString()} values (${(share * 100).toFixed(1)}%) don't parse and will become blank. Tick to confirm.`;
      if (!needsConfirm) lossBox.checked = false;
      confirm.disabled =
        (policySelect.value === "reject" && counts.failed > 0) ||
        digitLoss > 0 ||
        (needsConfirm && !lossBox.checked);
    };
    lossBox.addEventListener("change", () => {
      if (latest !== null) guardrails(latest);
    });

    const refresh = (): void => {
      const current = ++generation;
      if (wantsOrder && picker.value() === null) {
        latest = null;
        summary.textContent = "Fix the custom format to see the conversion.";
        examples.replaceChildren();
        confirm.disabled = true;
        return;
      }
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

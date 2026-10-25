import { setupDialog } from "./dialog.js";
import { el } from "./dom.js";

export interface RangePromptOptions {
  title: string;
  /** Shown above the inputs: what the column currently spans. */
  hint: string;
  min: number | null;
  max: number | null;
  confirmLabel?: string;
}

export interface RangeChoice {
  min: number | null;
  max: number | null;
  /** `limit` moves outside values to the bound; `blank` empties them. */
  outside: "limit" | "blank";
}

/** Parses a bound; blank means "no limit on this side", anything else must be a number. */
export function parseBound(text: string): number | null | "invalid" {
  const trimmed = text.trim().replace(/,/g, "");
  if (trimmed === "") return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : "invalid";
}

/**
 * Asks for a lower and upper limit and what to do with values outside them.
 * Resolves null when cancelled; the confirm button stays disabled until at
 * least one valid bound is given and min does not exceed max.
 */
export function openRangePrompt(options: RangePromptOptions): Promise<RangeChoice | null> {
  return new Promise((resolve) => {
    const overlay = el("div", { class: "modal-overlay" });
    const modal = el("div", { class: "modal confirm-modal range-modal" });

    const head = el("div", { class: "modal-head" });
    head.append(el("h2", {}, [options.title]));
    const closeButton = el("button", { class: "icon-btn", type: "button", title: "Close" }, ["×"]);
    head.append(closeButton);
    modal.append(head);
    modal.append(el("p", { class: "clean-hint" }, [options.hint]));

    const field = (label: string, value: number | null): HTMLInputElement => {
      const wrap = el("label", { class: "clean-field" });
      wrap.append(el("span", { class: "clean-label" }, [label]));
      const input = el("input", {
        class: "text-input",
        type: "text",
        inputmode: "decimal",
        value: value === null ? "" : String(value),
        placeholder: "no limit",
        spellcheck: "false",
        "aria-label": label,
      }) as HTMLInputElement;
      wrap.append(input);
      modal.append(wrap);
      return input;
    };
    const minInput = field("Lowest allowed value", options.min);
    const maxInput = field("Highest allowed value", options.max);

    const radio = (value: "limit" | "blank", label: string, checked: boolean): HTMLInputElement => {
      const row = el("label", { class: "control check clean-check" });
      const input = el("input", { type: "radio", name: "range-outside" }) as HTMLInputElement;
      input.value = value;
      input.checked = checked;
      row.append(input, label);
      modal.append(row);
      return input;
    };
    const limit = radio("limit", "Move values outside the range to the nearest limit", true);
    const blank = radio("blank", "Empty values outside the range, so I can fill them next", false);

    const problem = el("div", { class: "clean-hint range-problem" });
    modal.append(problem);

    const footer = el("div", { class: "clean-footer" });
    const cancel = el("button", { class: "ghost", type: "button" }, ["Cancel"]);
    const confirm = el("button", { class: "primary", type: "button" }, [
      options.confirmLabel ?? "Apply",
    ]) as HTMLButtonElement;
    footer.append(cancel, el("span", { class: "grow" }), confirm);
    modal.append(footer);

    const read = (): { choice: RangeChoice | null; message: string } => {
      const min = parseBound(minInput.value);
      const max = parseBound(maxInput.value);
      if (min === "invalid" || max === "invalid") return { choice: null, message: "Limits must be numbers." };
      if (min === null && max === null) return { choice: null, message: "Enter at least one limit." };
      if (min !== null && max !== null && min > max) {
        return { choice: null, message: "The lowest value is higher than the highest." };
      }
      return { choice: { min, max, outside: blank.checked ? "blank" : "limit" }, message: "" };
    };
    const sync = (): void => {
      const { choice, message } = read();
      confirm.disabled = choice === null;
      problem.textContent = message;
    };
    for (const input of [minInput, maxInput, limit, blank]) {
      input.addEventListener("input", sync);
      input.addEventListener("change", sync);
    }
    sync();

    let settled = false;
    const finish = (value: RangeChoice | null): void => {
      if (settled) return;
      settled = true;
      overlay.remove();
      document.removeEventListener("keydown", onKey);
      resolve(value);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") finish(null);
      if (event.key === "Enter" && !confirm.disabled && document.activeElement !== cancel) {
        event.preventDefault();
        finish(read().choice);
      }
    };
    closeButton.addEventListener("click", () => finish(null));
    cancel.addEventListener("click", () => finish(null));
    confirm.addEventListener("click", () => finish(read().choice));
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) finish(null);
    });
    document.addEventListener("keydown", onKey);

    overlay.append(modal);
    document.body.append(overlay);
    setupDialog(overlay, options.title);
    minInput.focus();
    minInput.select();
  });
}

/** A compact, readable bound for hints and labels (no scientific notation for ordinary values). */
export function formatBound(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const rounded = Number(value.toPrecision(6));
  return rounded.toLocaleString("en-US", { maximumFractionDigits: 6 });
}

import { applyCleanOps, type CleanOp } from "../data/clean-ops.js";
import { setupDialog } from "./dialog.js";
import { el } from "./dom.js";

export type ProtectMode = "mask" | "hash";

export interface ProtectInput {
  name: string;
  mode: ProtectMode;
  /** A few real values from the column, shown masked in the "before" side only. */
  samples: readonly string[];
  /** Non-empty cells the op will rewrite. */
  affected: number;
  /** Fresh random salt for a hash; injectable so tests are deterministic. */
  newSalt?: () => string;
}

/** Eight random bytes as hex: enough that a hash cannot be matched against a public table. */
export function randomSalt(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Mask or hash a column: choose the options, see up to five before/after rows and
 * the number of cells affected, then apply. Nothing changes until Apply, and the
 * result is an ordinary undoable Recipe step.
 */
export function openProtectDialog(input: ProtectInput): Promise<CleanOp | null> {
  return new Promise((resolve) => {
    const overlay = el("div", { class: "modal-overlay" });
    const modal = el("div", { class: "modal protect-modal" });
    const head = el("div", { class: "modal-head" });
    head.append(
      el("h2", {}, [input.mode === "mask" ? `Mask “${input.name}”` : `Hash “${input.name}”`]),
    );
    const closeButton = el("button", { class: "icon-btn", type: "button", title: "Close" }, ["×"]);
    head.append(closeButton);
    modal.append(head);

    const body = el("div", { class: "chart-setup-body" });
    body.append(
      el("p", { class: "confirm-body" }, [
        input.mode === "mask"
          ? "Hides the middle of every value and keeps the edges. Emails keep their domain. Blank and missing-value cells are left alone."
          : "Replaces every value with a one-way code, the same value always giving the same code, so rows can still be matched. Blank and missing-value cells are left alone.",
      ]),
    );

    const first = el("input", { class: "text-input", type: "number", min: "0", max: "10", value: "1", "aria-label": "Characters to keep at the start" }) as HTMLInputElement;
    const last = el("input", { class: "text-input", type: "number", min: "0", max: "10", value: "2", "aria-label": "Characters to keep at the end" }) as HTMLInputElement;
    const salt = el("input", { class: "text-input", type: "text", spellcheck: "false", "aria-label": "Salt" }) as HTMLInputElement;
    salt.value = (input.newSalt ?? randomSalt)();
    if (input.mode === "mask") {
      body.append(
        el("div", { class: "header-row-controls" }, [
          el("label", { class: "chart-setup-field" }, [el("span", { class: "chart-field-label" }, ["Keep at the start"]), first]),
          el("label", { class: "chart-setup-field" }, [el("span", { class: "chart-field-label" }, ["Keep at the end"]), last]),
        ]),
      );
    } else {
      body.append(
        el("label", { class: "chart-setup-field" }, [
          el("span", { class: "chart-field-label" }, ["Salt (kept in the Recipe so the step can be replayed)"]),
          salt,
        ]),
        el("p", { class: "cast-loss-confirm" }, [
          "Short or guessable values, such as phone numbers, can still be re-identified by trying every possibility. A hash hides values from a glance, it is not encryption.",
        ]),
      );
    }

    const table = el("div", { class: "protect-preview", role: "table", "aria-label": "Before and after" });
    const summary = el("div", { class: "cast-summary", role: "status" });
    body.append(table, summary);
    modal.append(body);

    const footer = el("div", { class: "clean-footer" });
    const cancel = el("button", { class: "ghost", type: "button" }, ["Cancel"]);
    const apply = el("button", { class: "primary", type: "button" }, ["Apply"]);
    footer.append(cancel, el("span", { class: "grow" }), apply);
    modal.append(footer);

    const op = (): CleanOp =>
      input.mode === "mask"
        ? {
            kind: "mask",
            keepFirst: Math.max(0, Math.min(10, Math.floor(Number(first.value) || 0))),
            keepLast: Math.max(0, Math.min(10, Math.floor(Number(last.value) || 0))),
          }
        : { kind: "hash", salt: salt.value };

    let settled = false;
    const finish = (value: CleanOp | null): void => {
      if (settled) return;
      settled = true;
      overlay.remove();
      document.removeEventListener("keydown", onKey);
      resolve(value);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") finish(null);
    };

    const render = (): void => {
      const before = input.samples.filter((value) => value.trim() !== "").slice(0, 5);
      const after = applyCleanOps(before, [op()]);
      table.replaceChildren(
        el("div", { class: "protect-row protect-head" }, [
          el("span", {}, ["Before (partly hidden)"]),
          el("span", {}, ["After"]),
        ]),
      );
      before.forEach((value, index) => {
        table.append(
          el("div", { class: "protect-row" }, [
            el("span", {}, [applyCleanOps([value], [{ kind: "mask", keepFirst: 1, keepLast: 2 }])[0]]),
            el("span", {}, [after[index]]),
          ]),
        );
      });
      const noun = input.affected === 1 ? "cell" : "cells";
      summary.textContent = `${input.affected.toLocaleString()} non-empty ${noun} in “${input.name}” will be rewritten. You can undo it from the Recipe.`;
      apply.disabled = input.mode === "hash" && salt.value === "";
    };
    first.addEventListener("input", render);
    last.addEventListener("input", render);
    salt.addEventListener("input", render);
    closeButton.addEventListener("click", () => finish(null));
    cancel.addEventListener("click", () => finish(null));
    apply.addEventListener("click", () => {
      if (!apply.disabled) finish(op());
    });
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) finish(null);
    });
    document.addEventListener("keydown", onKey);
    overlay.append(modal);
    document.body.append(overlay);
    setupDialog(overlay, `Protect ${input.name}`);
    render();
  });
}

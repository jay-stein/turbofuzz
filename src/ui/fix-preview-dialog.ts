import { n, plural, pointsLabel } from "../data/dq-copy.js";
import type { PageIssue } from "../data/dq-issues.js";
import { setupDialog } from "./dialog.js";
import { el } from "./dom.js";
import { renderDistCompare } from "./dist-compare.js";

/**
 * One preview for one or several fixes: for each issue the before/after
 * sample lines, the rows it changes and the points it adds, with a checkbox per
 * issue. Nothing is applied until the single "Apply" click, and each ticked issue
 * then becomes its own undoable Recipe step. Resolves with the ticked issue ids,
 * or null when cancelled.
 */
export function openFixPreview(issues: readonly PageIssue[]): Promise<string[] | null> {
  return new Promise((resolve) => {
    const overlay = el("div", { class: "modal-overlay" });
    const modal = el("div", { class: "modal fix-preview-modal" });
    const head = el("div", { class: "modal-head" });
    head.append(
      el("h2", {}, [issues.length === 1 ? "Preview this fix" : `Preview ${issues.length} fixes`]),
    );
    const closeButton = el("button", { class: "icon-btn", type: "button", title: "Close" }, ["×"]);
    head.append(closeButton);
    modal.append(head);

    const body = el("div", { class: "chart-setup-body" });
    body.append(
      el("p", { class: "confirm-body" }, [
        "Nothing changes until you press Apply. Each fix is recorded as its own step in the Recipe, so you can undo them one at a time.",
      ]),
    );

    const checks = new Map<string, HTMLInputElement>();
    for (const issue of issues) {
      const box = el("input", { type: "checkbox", "aria-label": `Apply: ${issue.title}` }) as HTMLInputElement;
      box.checked = true;
      checks.set(issue.id, box);
      const card = el("section", { class: "fix-preview-item" }, [
        el("label", { class: "fix-preview-head" }, [
          box,
          el("strong", {}, [issue.title]),
          issue.points !== null && issue.points >= 0.1
            ? el("span", { class: "pts-pill" }, [pointsLabel(issue.points)])
            : "",
        ]),
      ]);
      if (issue.dist !== null) card.append(renderDistCompare(issue.dist));
      const lines = el("ul", { class: "fix-preview-lines" });
      for (const step of issue.fixes) {
        if (step.kind === "convert") continue;
        for (const line of step.preview) {
          lines.append(
            el("li", {}, [
              el("code", {}, [line.from]),
              " → ",
              el("code", {}, [line.to]),
              `  ·  ${n(line.count)} ${plural(line.count, "row", "rows")}`,
            ]),
          );
        }
      }
      card.append(lines);
      body.append(card);
    }
    const summary = el("div", { class: "cast-summary", role: "status" });
    body.append(summary);
    modal.append(body);

    const footer = el("div", { class: "clean-footer" });
    const cancel = el("button", { class: "ghost", type: "button" }, ["Cancel"]);
    const apply = el("button", { class: "primary", type: "button" }, ["Apply"]);
    footer.append(cancel, el("span", { class: "grow" }), apply);
    modal.append(footer);

    const selected = (): PageIssue[] => issues.filter((issue) => checks.get(issue.id)?.checked === true);
    const refresh = (): void => {
      const chosen = selected();
      const rows = chosen.reduce((sum, issue) => sum + issue.rows, 0);
      const points = chosen.reduce((sum, issue) => sum + (issue.points ?? 0), 0);
      summary.textContent =
        chosen.length === 0
          ? "Nothing selected."
          : `${n(chosen.length)} ${plural(chosen.length, "fix", "fixes")} · about ${n(rows)} ${plural(rows, "cell", "cells")} change${
              points >= 0.1 ? ` · ${pointsLabel(points)} on the score` : ""
            }`;
      apply.disabled = chosen.length === 0;
      apply.textContent = chosen.length === 1 ? "Apply 1 fix" : `Apply ${chosen.length} fixes`;
    };
    for (const box of checks.values()) box.addEventListener("change", refresh);

    let settled = false;
    const finish = (value: string[] | null): void => {
      if (settled) return;
      settled = true;
      overlay.remove();
      document.removeEventListener("keydown", onKey);
      resolve(value);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") finish(null);
    };
    closeButton.addEventListener("click", () => finish(null));
    cancel.addEventListener("click", () => finish(null));
    apply.addEventListener("click", () => {
      if (!apply.disabled) finish(selected().map((issue) => issue.id));
    });
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) finish(null);
    });
    document.addEventListener("keydown", onKey);
    overlay.append(modal);
    document.body.append(overlay);
    setupDialog(overlay, "Preview fixes");
    refresh();
  });
}

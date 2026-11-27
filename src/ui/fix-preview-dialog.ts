import { n, plural, pointsLabel } from "../data/dq-copy.js";
import type { FixPreviewLine, PageIssue } from "../data/dq-issues.js";
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
export function openFixPreview(issues: readonly PageIssue[]): Promise<string[] | null>;
/**
 * With `apply`, the dialog stays open while the ticked fixes run: Apply and
 * Cancel are disabled and the button shows progress, so a second press cannot
 * start another run. Resolves with what `apply` returned.
 */
export function openFixPreview<T>(
  issues: readonly PageIssue[],
  apply: (ids: string[], progress: (done: number, total: number) => void, kept: ReadonlyMap<string, ReadonlySet<string>>) => Promise<T>,
): Promise<T | null>;
export function openFixPreview<T>(
  issues: readonly PageIssue[],
  apply?: (ids: string[], progress: (done: number, total: number) => void, kept: ReadonlyMap<string, ReadonlySet<string>>) => Promise<T>,
): Promise<T | string[] | null> {
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
    // Junk-text values the user unticked, per issue: kept as real values.
    const keptTokens = new Map<string, Set<string>>();
    const keptCells = (issue: PageIssue): number => {
      const kept = keptTokens.get(issue.id);
      if (kept === undefined || kept.size === 0) return 0;
      return issue.fixes.reduce(
        (sum, step) => (step.kind === "placeholders" ? sum + step.preview.filter((line) => kept.has(line.from)).reduce((s, line) => s + line.count, 0) : sum),
        0,
      );
    };
    // Declared before the cards so the pickers can call it; assigned below.
    let refresh: () => void = () => undefined;
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
        if (step.kind === "placeholders") {
          card.append(tokenPicker(issue.id, step.preview, keptTokens, () => refresh()));
          continue;
        }
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
    const applyButton = el("button", { class: "primary", type: "button" }, ["Apply"]) as HTMLButtonElement;
    footer.append(cancel, el("span", { class: "grow" }), applyButton);
    modal.append(footer);

    const selected = (): PageIssue[] => issues.filter((issue) => checks.get(issue.id)?.checked === true);
    refresh = (): void => {
      const chosen = selected();
      const rows = chosen.reduce((sum, issue) => sum + Math.max(0, issue.rows - keptCells(issue)), 0);
      const points = chosen.reduce((sum, issue) => sum + (issue.points ?? 0), 0);
      summary.textContent =
        chosen.length === 0
          ? "Nothing selected."
          : `${n(chosen.length)} ${plural(chosen.length, "fix", "fixes")} · about ${n(rows)} ${plural(rows, "cell", "cells")} change${
              points >= 0.1 ? ` · ${pointsLabel(points)} on the score` : ""
            }`;
      applyButton.disabled = chosen.length === 0;
      applyButton.textContent = chosen.length === 1 ? "Apply 1 fix" : `Apply ${chosen.length} fixes`;
    };
    for (const box of checks.values()) box.addEventListener("change", refresh);

    let settled = false;
    let running = false;
    const finish = (value: T | string[] | null): void => {
      if (settled || running) return;
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
    applyButton.addEventListener("click", () => {
      if (applyButton.disabled || running) return;
      const ids = selected().map((issue) => issue.id);
      if (apply === undefined) {
        finish(ids);
        return;
      }
      running = true;
      applyButton.disabled = true;
      cancel.setAttribute("disabled", "");
      closeButton.setAttribute("disabled", "");
      for (const box of checks.values()) box.disabled = true;
      modal.setAttribute("aria-busy", "true");
      applyButton.textContent = "Applying…";
      const progress = (done: number, total: number): void => {
        applyButton.textContent = `Applying ${n(done)} of ${n(total)}…`;
      };
      for (const input of modal.querySelectorAll<HTMLInputElement>(".fix-token-list input, .fix-token-bulk button")) input.disabled = true;
      void apply(ids, progress, keptTokens)
        .then(
          (value) => value,
          () => null,
        )
        .then((value) => {
          running = false;
          finish(value);
        });
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

/**
 * Every junk-text value in the column, each with its own tick, all ticked to start:
 * fix the lot by default, untick a value that is real data ("NULL" as a surname).
 * Nothing is hidden behind "+N more"; a long list scrolls.
 */
function tokenPicker(
  issueId: string,
  lines: readonly FixPreviewLine[],
  kept: Map<string, Set<string>>,
  changed: () => void,
): HTMLElement {
  const set = new Set<string>();
  kept.set(issueId, set);
  const boxes: { box: HTMLInputElement; line: FixPreviewLine; to: HTMLElement }[] = [];
  const sync = (): void => {
    for (const { box, line, to } of boxes) {
      if (box.checked) set.delete(line.from);
      else set.add(line.from);
      to.textContent = box.checked ? "empty" : "kept as text";
      to.classList.toggle("fix-token-kept", !box.checked);
    }
    count.textContent = `${n(lines.length - set.size)} of ${n(lines.length)} ticked`;
    changed();
  };
  const list = el("ul", { class: "fix-token-list" });
  for (const line of lines) {
    const box = el("input", { type: "checkbox", "aria-label": `Make “${line.from}” empty` }) as HTMLInputElement;
    box.checked = true;
    const to = el("span", { class: "fix-token-to" }, ["empty"]);
    boxes.push({ box, line, to });
    box.addEventListener("change", sync);
    list.append(
      el("li", {}, [
        el("label", {}, [
          box,
          el("code", {}, [line.from]),
          el("span", { class: "fix-token-arrow", "aria-hidden": "true" }, ["→"]),
          to,
          el("span", { class: "fix-token-count" }, [`${n(line.count)} ${plural(line.count, "row", "rows")}`]),
        ]),
      ]),
    );
  }
  const setAll = (checked: boolean): void => {
    for (const { box } of boxes) box.checked = checked;
    sync();
  };
  const all = el("button", { type: "button", class: "fix-token-all" }, ["All"]);
  const none = el("button", { type: "button", class: "fix-token-none" }, ["None"]);
  all.addEventListener("click", () => setAll(true));
  none.addEventListener("click", () => setAll(false));
  const count = el("span", { class: "fix-token-tally" }, [`${n(lines.length)} of ${n(lines.length)} ticked`]);
  return el("div", { class: "fix-tokens" }, [
    el("div", { class: "fix-token-head" }, [
      el("span", {}, ["Untick any value that is real data, like “NULL” as a surname. It is kept as text and no longer counts as missing."]),
    ]),
    el("div", { class: "fix-token-bulk" }, [count, el("span", { class: "grow" }), all, none]),
    list,
  ]);
}

import type { DQScore, ScoreCheck } from "../data/score.js";
import { setupDialog } from "./dialog.js";
import { clear, el } from "./dom.js";

export interface QualityPanelCallbacks {
  /** Filter the table to the failing rows of a check (undo via the toast). */
  onFilter(check: ScoreCheck): void;
}

function bandClass(score: number | null): string {
  if (score === null) return "na";
  return score >= 90 ? "good" : score >= 75 ? "fair" : "poor";
}

/**
 * The Data Quality drawer (plan §4): overall score, per-dimension rows and
 * every check with exact fail/pass/n-a counts. "Show only issues" answers
 * "what's wrong?" in one click; each failing check filters the table to its
 * rows. N.A. counts are always shown — nothing is silently excluded.
 */
export function openQualityPanel(score: DQScore, callbacks: QualityPanelCallbacks): void {
  const overlay = el("div", { class: "modal-overlay drawer-overlay" });
  const modal = el("div", { class: "modal clean-modal drawer quality-drawer" });

  const head = el("div", { class: "modal-head" });
  head.append(el("h2", {}, ["Data quality"]));
  const closeButton = el("button", { class: "icon-btn", type: "button", title: "Close" }, ["×"]);
  head.append(closeButton);
  modal.append(head);

  const overall = score.overall === null ? null : Math.round(score.overall * 10) / 10;
  const summary = el("div", { class: "quality-overall" });
  summary.append(
    el("span", { class: `quality-score band-${score.band ?? "na"}` }, [
      overall === null ? "n/a" : overall.toFixed(1),
    ]),
    el("span", { class: "quality-band" }, [
      score.band === "good"
        ? "good"
        : score.band === "fair"
          ? "fair"
          : score.band === "poor"
            ? "needs work"
            : "not applicable",
    ]),
  );
  const applicable = score.dimensions.filter((dimension) => dimension.score !== null);
  summary.append(
    el("span", { class: "quality-calc" }, [
      applicable.length === 0
        ? "No applicable dimensions for this dataset."
        : `Weighted mean of ${applicable.length} applicable dimension${
            applicable.length === 1 ? "" : "s"
          } · N.A. excluded · advisory findings are never scored`,
    ]),
  );
  modal.append(summary);

  const only = el("label", { class: "control check clean-check" });
  const toggle = el("input", { type: "checkbox" }) as HTMLInputElement;
  only.append(toggle, "Show only issues");
  modal.append(only);

  const list = el("div", { class: "quality-list" });
  modal.append(list);

  const renderCheck = (check: ScoreCheck): HTMLElement => {
    const row = el("div", { class: "quality-check" });
    const info = el("div", { class: "quality-check-info" });
    info.append(
      el("span", { class: "quality-check-label" }, [check.label]),
      el("span", { class: "quality-check-detail" }, [check.detail]),
    );
    const counts = `${check.fail.toLocaleString()} fail · ${check.pass.toLocaleString()} pass${
      check.na > 0 ? ` · ${check.na.toLocaleString()} n/a` : ""
    }`;
    row.append(info, el("span", { class: "quality-check-counts" }, [counts]));
    if (check.filter !== null) {
      const show = el(
        "button",
        { class: "ghost small", type: "button", title: "Filter the table to the failing rows" },
        [check.fixLabel ?? "Show rows"],
      ) as HTMLButtonElement;
      show.addEventListener("click", () => {
        callbacks.onFilter(check);
        close();
      });
      row.append(show);
    }
    return row;
  };

  const render = (): void => {
    clear(list);
    for (const dimension of score.dimensions) {
      const hasIssues = dimension.checks.some((check) => check.fail > 0);
      if (toggle.checked && !hasIssues) continue;
      const row = el("div", { class: "quality-dimension" });
      row.append(
        el("span", { class: `quality-dim-score band-${bandClass(dimension.score)}` }, [
          dimension.score === null ? "n/a" : dimension.score.toFixed(1),
        ]),
        el("span", { class: "quality-dim-label", title: dimension.abbreviation }, [
          dimension.label,
        ]),
        el("span", { class: "quality-dim-weight" }, [`w ${dimension.weight}`]),
      );
      list.append(row);
      if (dimension.note !== null) {
        list.append(el("div", { class: "quality-note" }, [dimension.note]));
      }
      for (const check of dimension.checks) {
        if (toggle.checked && check.fail === 0) continue;
        list.append(renderCheck(check));
      }
    }
    if (list.childElementCount === 0) {
      list.append(el("div", { class: "clean-empty" }, ["No issues — every check passes."]));
    }
  };
  render();
  toggle.addEventListener("change", render);

  function close(): void {
    overlay.remove();
    document.removeEventListener("keydown", onKey);
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
  setupDialog(overlay, "Data quality");
}

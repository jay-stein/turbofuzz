import type { DQScore, ScoreCheck, ScoreDimension } from "../data/score.js";
import { setupDialog } from "./dialog.js";
import { clear, el } from "./dom.js";

export type DQExportKind = "markdown" | "json" | "html" | "supplier" | "sodacl" | "dbt" | "gx" | "dqdl";

export interface QualityPanelCallbacks {
  /** Filter the table to the failing rows of a check (undo via the toast). */
  onFilter(check: ScoreCheck): void;
  /** Copy/download the DQ report; resolves false when the clipboard blocks. */
  onExport(kind: DQExportKind): Promise<boolean>;
  /** Column names for the matrix (indexed by column). */
  columnNames?: readonly string[];
  /** Current weights/bands overrides (prefills the settings). */
  config?: {
    weights?: Partial<Record<ScoreDimension, number>>;
    bandGood?: number;
    bandFair?: number;
  };
  /** Persist new weights/bands; the app reopens the drawer with the new score. */
  onConfigChange?(config: {
    weights: Partial<Record<ScoreDimension, number>>;
    bandGood: number;
    bandFair: number;
  }): void;
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

  // Weights & bands: effective weights come from the current score; edits are
  // persisted by the app, which reopens the drawer with the recomputed score.
  const settingsToggle = el(
    "button",
    { class: "ghost small quality-settings-btn", type: "button" },
    ["Weights & bands ▾"],
  ) as HTMLButtonElement;
  const settings = el("div", { class: "quality-settings hidden" });
  const weightInputs = new Map<ScoreDimension, HTMLInputElement>();
  for (const dimension of score.dimensions) {
    const row = el("label", { class: "quality-setting" });
    const input = el("input", {
      class: "chart-number",
      type: "number",
      min: "0",
      max: "100",
      step: "5",
      value: String(dimension.weight),
      "aria-label": `${dimension.label} weight`,
    }) as HTMLInputElement;
    weightInputs.set(dimension.dimension, input);
    row.append(el("span", {}, [dimension.label]), input);
    settings.append(row);
  }
  const bandRow = el("div", { class: "quality-setting" });
  const goodInput = el("input", {
    class: "chart-number",
    type: "number",
    min: "50",
    max: "100",
    value: String(callbacks.config?.bandGood ?? 90),
    "aria-label": "Good band threshold",
  }) as HTMLInputElement;
  const fairInput = el("input", {
    class: "chart-number",
    type: "number",
    min: "0",
    max: "100",
    value: String(callbacks.config?.bandFair ?? 75),
    "aria-label": "Fair band threshold",
  }) as HTMLInputElement;
  bandRow.append(el("span", {}, ["Good ≥"]), goodInput, el("span", {}, ["Fair ≥"]), fairInput);
  settings.append(bandRow);
  const applySettings = el("button", { class: "primary", type: "button" }, [
    "Apply",
  ]) as HTMLButtonElement;
  applySettings.addEventListener("click", () => {
    const weights: Partial<Record<ScoreDimension, number>> = {};
    for (const [dimension, input] of weightInputs) {
      const value = Number(input.value);
      if (Number.isFinite(value) && value >= 0) weights[dimension] = value;
    }
    const bandGood = Number(goodInput.value);
    const bandFair = Number(fairInput.value);
    callbacks.onConfigChange?.({
      weights,
      bandGood: Number.isFinite(bandGood) ? bandGood : 90,
      bandFair: Number.isFinite(bandFair) ? bandFair : 75,
    });
    close();
  });
  settings.append(applySettings);
  settingsToggle.addEventListener("click", () => settings.classList.toggle("hidden"));
  modal.append(settingsToggle, settings);

  const only = el("label", { class: "control check clean-check" });
  const toggle = el("input", { type: "checkbox" }) as HTMLInputElement;
  only.append(toggle, "Show only issues");
  modal.append(only);

  const list = el("div", { class: "quality-list" });
  modal.append(list);

  const matrixTitle = el("div", { class: "quality-matrix-title" }, ["Column × dimension"]);
  const matrixHost = el("div", { class: "quality-matrix" });
  modal.append(matrixTitle, matrixHost);

  const footer = el("div", { class: "clean-footer" });
  const swapLabel = (button: HTMLButtonElement, label: string, ok: boolean): void => {
    button.textContent = ok ? "Copied" : "Clipboard blocked";
    window.setTimeout(() => {
      button.textContent = label;
    }, 2000);
  };
  const copyReport = el("button", { class: "ghost", type: "button" }, [
    "Copy report",
  ]) as HTMLButtonElement;
  copyReport.title = "Copy the full data-quality report (Markdown)";
  copyReport.addEventListener("click", () => {
    void callbacks.onExport("markdown").then((ok) => swapLabel(copyReport, "Copy report", ok));
  });
  const downloadJson = el("button", { class: "ghost", type: "button" }, [
    "Download JSON",
  ]) as HTMLButtonElement;
  downloadJson.title = "Download the report as a JSON file";
  downloadJson.addEventListener("click", () => {
    void callbacks.onExport("json");
  });
  const targetSelect = el("select", {
    class: "recipe-target",
    "aria-label": "Pipeline format",
    title: "Emit the discovered checks for a pipeline tool",
  }) as HTMLSelectElement;
  for (const [value, label] of [
    ["sodacl", "SodaCL"],
    ["dbt", "dbt"],
    ["gx", "Great Expectations"],
    ["dqdl", "Deequ DQDL"],
  ] as const) {
    targetSelect.append(el("option", { value }, [label]) as HTMLOptionElement);
  }
  const copyAs = el("button", { class: "ghost", type: "button" }, [
    "Copy as…",
  ]) as HTMLButtonElement;
  copyAs.title = "Copy the discovered checks as pipeline-format rules (support notes included)";
  copyAs.addEventListener("click", () => {
    const kind = targetSelect.value as DQExportKind;
    void callbacks.onExport(kind).then((ok) => swapLabel(copyAs, "Copy as…", ok));
  });
  footer.append(copyReport, downloadJson, el("span", { class: "grow" }), targetSelect, copyAs);
  modal.append(footer);

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

    // Column × dimension matrix: pass rate per column for the per-column
    // checks (completeness and validity); click a cell to filter its failures.
    clear(matrixHost);
    const perColumn = new Map<number, Map<ScoreDimension, ScoreCheck>>();
    for (const dimension of score.dimensions) {
      for (const check of dimension.checks) {
        if (check.column === null) continue;
        let entry = perColumn.get(check.column);
        if (entry === undefined) {
          entry = new Map();
          perColumn.set(check.column, entry);
        }
        entry.set(dimension.dimension, check);
      }
    }
    const dims: ScoreDimension[] = ["completeness", "validity"];
    const rows = [...perColumn.entries()]
      .sort((a, b) => a[0] - b[0])
      .filter(
        ([, checks]) =>
          !toggle.checked || [...checks.values()].some((check) => check.fail > 0),
      );
    matrixTitle.classList.toggle("hidden", rows.length === 0);
    matrixHost.classList.toggle("hidden", rows.length === 0);
    if (rows.length > 0) {
      const table = el("table", { class: "quality-matrix-table" });
      const head = el("tr");
      head.append(el("th", {}, ["Column"]));
      for (const dimension of dims) {
        head.append(
          el("th", {}, [dimension === "completeness" ? "Comp" : "Valid"]),
        );
      }
      table.append(head);
      for (const [column, checks] of rows) {
        const tr = el("tr");
        tr.append(el("td", {}, [callbacks.columnNames?.[column] ?? `Column ${column + 1}`]));
        for (const dimension of dims) {
          const td = el("td", {});
          const check = checks.get(dimension);
          if (check === undefined) {
            td.append(el("span", { class: "quality-cell band-na" }, ["—"]));
          } else {
            const applicable = check.pass + check.fail;
            const rate = applicable === 0 ? null : check.pass / applicable;
            const button = el(
              "button",
              {
                class: `quality-cell band-${
                  rate === null ? "na" : rate >= 0.95 ? "good" : rate >= 0.8 ? "fair" : "poor"
                }`,
                type: "button",
                title: `${check.label} — ${check.fail.toLocaleString()} fail`,
              },
              [rate === null ? "n/a" : `${Math.round(rate * 100)}%`],
            ) as HTMLButtonElement;
            if (check.filter !== null) {
              button.addEventListener("click", () => {
                callbacks.onFilter(check);
                close();
              });
            }
            td.append(button);
          }
          tr.append(td);
        }
        table.append(tr);
      }
      matrixHost.append(table);
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

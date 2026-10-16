import type { DQScore, ScoreCheck, ScoreDimension } from "../data/score.js";
import type { DatasetStats } from "../data/stats.js";
import { clear, el } from "./dom.js";
import type { DQExportKind } from "./quality-panel.js";

function formatCount(value: number): string {
  return value.toLocaleString();
}

function bandClass(score: number | null): "good" | "fair" | "poor" | "na" {
  if (score === null) return "na";
  return score >= 90 ? "good" : score >= 75 ? "fair" : "poor";
}

function bandWord(band: DQScore["band"]): string {
  if (band === "good") return "good";
  if (band === "fair") return "fair";
  if (band === "poor") return "needs work";
  return "not applicable";
}

export interface QualityPageCallbacks {
  /** Filter the table to the failing rows of a check. */
  onFilter(check: ScoreCheck): void;
  /** Copy/download the DQ report; resolves false when the clipboard blocks. */
  onExport(kind: DQExportKind): Promise<boolean>;
  /** Current weights/bands overrides (prefills the settings). */
  config?: {
    weights?: Partial<Record<ScoreDimension, number>>;
    bandGood?: number;
    bandFair?: number;
  };
  /** Persist new weights/bands; the app recomputes and re-renders. */
  onConfigChange?(config: {
    weights: Partial<Record<ScoreDimension, number>>;
    bandGood: number;
    bandFair: number;
  }): void;
}

export interface QualityPageInput {
  score: DQScore;
  rowCount: number;
  stats: DatasetStats;
  columnNames: readonly string[];
}

/**
 * The Data Quality page (the Ataccama-style diagnostic dashboard): the score
 * with its inputs, what to fix first ranked by points gained, every check with
 * exact counts, the column × dimension matrix and the dataset facts — all
 * display-only, every number drills to the failing rows.
 */
export class QualityPage {
  private onlyIssues = false;
  private dimensionFilter: ScoreDimension | null = null;
  private settingsOpen = false;
  private lastInput: QualityPageInput | null = null;

  constructor(
    private readonly root: HTMLElement,
    private readonly callbacks: QualityPageCallbacks,
  ) {
    this.root.classList.add("quality-page");
  }

  /** Re-renders from a fresh score; null shows the empty state. */
  render(input: QualityPageInput | null): void {
    this.lastInput = input;
    clear(this.root);
    if (input === null) {
      this.root.append(
        el("div", { class: "clean-empty qp-empty" }, [
          "Load a file to see its data-quality dashboard: score, checks, column matrix and fixes.",
        ]),
      );
      return;
    }
    const { score, stats, rowCount, columnNames } = input;
    const applicable = score.dimensions.filter((dimension) => dimension.score !== null);
    const checkCount = score.dimensions.reduce((sum, dim) => sum + dim.checks.length, 0);
    const failing = score.dimensions.reduce(
      (sum, dim) => sum + dim.checks.filter((check) => check.fail > 0).length,
      0,
    );

    this.root.append(
      this.buildHero(
        score,
        stats,
        rowCount,
        columnNames.length,
        applicable.length,
        checkCount,
        failing,
      ),
      this.buildSettings(score),
      this.buildDimensions(score),
      this.buildFixes(score),
      this.buildChecks(score),
      this.buildMatrix(score, columnNames),
    );
  }

  // ---------- hero ----------

  private buildHero(
    score: DQScore,
    stats: DatasetStats,
    rowCount: number,
    columnCount: number,
    applicableCount: number,
    checkCount: number,
    failing: number,
  ): HTMLElement {
    const hero = el("div", { class: "qp-hero" });
    const overall = score.overall === null ? null : Math.round(score.overall * 10) / 10;
    const ring = el("div", { class: `qp-ring band-${score.band ?? "na"}` });
    if (overall !== null) {
      ring.style.setProperty("--qp-fill", `${(overall / 100) * 360}deg`);
    }
    ring.append(
      el("div", { class: "qp-ring-inner" }, [
        el("span", { class: "qp-ring-value" }, [overall === null ? "n/a" : overall.toFixed(1)]),
        el("span", { class: "qp-ring-label" }, ["/ 100"]),
      ]),
    );

    const body = el("div", { class: "qp-hero-body" });
    body.append(
      el("div", { class: "qp-hero-title" }, [
        "Data quality",
        el("span", { class: `qp-band-chip band-${score.band ?? "na"}` }, [bandWord(score.band)]),
      ]),
      el("div", { class: "qp-hero-calc" }, [
        applicableCount === 0
          ? "No applicable dimensions for this dataset."
          : `Weighted mean of ${applicableCount} applicable dimension${
              applicableCount === 1 ? "" : "s"
            } · ${checkCount} checks · ${failing} with failures · N.A. excluded`,
      ]),
    );

    const populated =
      stats.totalCells === 0
        ? 100
        : ((stats.totalCells - stats.totalNullCells) / stats.totalCells) * 100;
    const facts = el("div", { class: "qp-facts" });
    const fact = (label: string, value: string): HTMLElement =>
      el("span", { class: "qp-fact" }, [
        el("span", { class: "qp-fact-value" }, [value]),
        el("span", { class: "qp-fact-label" }, [label]),
      ]);
    facts.append(
      fact("rows", formatCount(rowCount)),
      fact("columns", formatCount(columnCount)),
      fact("populated", `${populated.toFixed(1)}%`),
      fact("empty cells", formatCount(stats.totalNullCells)),
      fact("duplicate rows", formatCount(stats.duplicateRows)),
      fact("value outliers", formatCount(stats.valueAnomalyRows)),
      fact("length outliers", formatCount(stats.lengthAnomalyRows)),
    );

    const actions = el("div", { class: "qp-actions" });
    const onlyIssues = el(
      "button",
      { class: `ghost small ${this.onlyIssues ? "active" : ""}`, type: "button" },
      [this.onlyIssues ? "Showing issues only" : "Show only issues"],
    ) as HTMLButtonElement;
    onlyIssues.addEventListener("click", () => {
      this.onlyIssues = !this.onlyIssues;
      this.render(this.lastInput);
    });
    const copy = el("button", { class: "ghost small", type: "button" }, ["Copy report"]) as HTMLButtonElement;
    copy.addEventListener("click", () => void this.callbacks.onExport("markdown"));
    const download = el("button", { class: "ghost small", type: "button" }, [
      "Download JSON",
    ]) as HTMLButtonElement;
    download.addEventListener("click", () => void this.callbacks.onExport("json"));
    const settings = el("button", { class: "ghost small", type: "button" }, [
      this.settingsOpen ? "Hide settings" : "Weights & bands",
    ]) as HTMLButtonElement;
    settings.addEventListener("click", () => {
      this.settingsOpen = !this.settingsOpen;
      this.render(this.lastInput);
    });
    actions.append(onlyIssues, el("span", { class: "grow" }), settings, copy, download);

    hero.append(ring, body, actions);
    hero.append(facts);
    return hero;
  }

  // ---------- settings ----------

  private buildSettings(score: DQScore): HTMLElement {
    const settings = el("div", {
      class: `qp-settings ${this.settingsOpen ? "" : "hidden"}`,
    });
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
      value: String(this.callbacks.config?.bandGood ?? 90),
      "aria-label": "Good band threshold",
    }) as HTMLInputElement;
    const fairInput = el("input", {
      class: "chart-number",
      type: "number",
      min: "0",
      max: "100",
      value: String(this.callbacks.config?.bandFair ?? 75),
      "aria-label": "Fair band threshold",
    }) as HTMLInputElement;
    bandRow.append(
      el("span", {}, ["Good ≥"]),
      goodInput,
      el("span", {}, ["Fair ≥"]),
      fairInput,
    );
    const apply = el("button", { class: "primary", type: "button" }, [
      "Apply",
    ]) as HTMLButtonElement;
    apply.addEventListener("click", () => {
      const weights: Partial<Record<ScoreDimension, number>> = {};
      for (const [dimension, input] of weightInputs) {
        const value = Number(input.value);
        if (Number.isFinite(value) && value >= 0) weights[dimension] = value;
      }
      const bandGood = Number(goodInput.value);
      const bandFair = Number(fairInput.value);
      this.callbacks.onConfigChange?.({
        weights,
        bandGood: Number.isFinite(bandGood) ? bandGood : 90,
        bandFair: Number.isFinite(bandFair) ? bandFair : 75,
      });
    });
    settings.append(bandRow, apply);
    settings.append(
      el("div", { class: "qp-settings-note" }, [
        "Weights set how much each dimension moves the overall score; bands colour it. Saved in this browser.",
      ]),
    );
    return settings;
  }

  // ---------- dimension cards ----------

  private buildDimensions(score: DQScore): HTMLElement {
    const wrap = el("div", { class: "qp-section" });
    wrap.append(el("h3", { class: "qp-section-title" }, ["Dimensions"]));
    const grid = el("div", { class: "qp-dims" });
    for (const dimension of score.dimensions) {
      const pass = dimension.checks.reduce((sum, check) => sum + check.pass, 0);
      const fail = dimension.checks.reduce((sum, check) => sum + check.fail, 0);
      const failingChecks = dimension.checks.filter((check) => check.fail > 0).length;
      const active = this.dimensionFilter === dimension.dimension;
      const card = el(
        "button",
        {
          class: `qp-dim band-${bandClass(dimension.score)} ${active ? "active" : ""}`,
          type: "button",
          title: dimension.note ?? `${formatCount(fail)} failing of ${formatCount(pass + fail)}`,
        },
        [],
      ) as HTMLButtonElement;
      card.append(
        el("div", { class: "qp-dim-head" }, [
          el("span", { class: "qp-dim-label" }, [dimension.label]),
          el("span", { class: "qp-dim-weight" }, [`w ${dimension.weight}`]),
        ]),
        el("div", { class: "qp-dim-score" }, [
          dimension.score === null ? "n/a" : `${Math.round(dimension.score * 10) / 10}`,
        ]),
        el("div", { class: "qp-dim-bar" }, [
          el("span", {
            class: "qp-dim-bar-fill",
          }),
        ]),
        el("div", { class: "qp-dim-meta" }, [
          dimension.score === null
            ? (dimension.note ?? "not applicable")
            : `${dimension.checks.length} check${
                dimension.checks.length === 1 ? "" : "s"
              } · ${failingChecks} failing`,
        ]),
      );
      const fill = card.querySelector<HTMLElement>(".qp-dim-bar-fill");
      if (fill !== null && dimension.score !== null) {
        fill.style.width = `${Math.max(2, dimension.score)}%`;
      }
      card.addEventListener("click", () => {
        this.dimensionFilter = this.dimensionFilter === dimension.dimension ? null : dimension.dimension;
        this.render(this.lastInput);
      });
      grid.append(card);
    }
    wrap.append(grid);
    return wrap;
  }

  // ---------- what to fix first ----------

  private buildFixes(score: DQScore): HTMLElement {
    const weightSum = score.dimensions.reduce(
      (sum, dimension) =>
        sum + (dimension.score === null || dimension.weight <= 0 ? 0 : dimension.weight),
      0,
    );
    const fixes: {
      check: ScoreCheck;
      dimension: ScoreDimension;
      label: string;
      band: string;
      gain: number;
    }[] = [];
    for (const dimension of score.dimensions) {
      for (const check of dimension.checks) {
        const applicable = check.pass + check.fail;
        if (check.fail === 0 || applicable === 0 || dimension.weight <= 0) continue;
        const gain = (check.fail / applicable) * (dimension.weight / Math.max(1, weightSum)) * 100;
        fixes.push({
          check,
          dimension: dimension.dimension,
          label: dimension.label,
          band: bandClass(dimension.score),
          gain,
        });
      }
    }
    fixes.sort((a, b) => b.gain - a.gain);

    const section = el("div", { class: "qp-section" });
    section.append(
      el("h3", { class: "qp-section-title" }, [
        "What to fix first",
        el("span", { class: "qp-section-hint" }, ["ranked by points gained on the overall score"]),
      ]),
    );
    if (fixes.length === 0) {
      section.append(
        el("div", { class: "clean-empty" }, ["Nothing to fix — every check passes."]),
      );
      return section;
    }
    const list = el("div", { class: "qp-fixes" });
    for (const fix of fixes.slice(0, 5)) {
      const row = el("div", { class: "qp-fix" });
      const action = el("button", { class: "ghost small", type: "button" }, [
        fix.check.fixLabel ?? "Show failing",
      ]) as HTMLButtonElement;
      action.addEventListener("click", () => this.callbacks.onFilter(fix.check));
      row.append(
        el("span", { class: "qp-fix-gain" }, [`+${fix.gain.toFixed(1)} pts`]),
        el("span", { class: `qp-chip band-${fix.band}` }, [fix.label]),
        el("div", { class: "qp-fix-body" }, [
          el("div", { class: "qp-fix-label" }, [fix.check.label]),
          el("div", { class: "qp-fix-detail" }, [fix.check.detail]),
        ]),
        el("span", { class: "qp-fix-fail" }, [`${formatCount(fix.check.fail)} failing`]),
        action,
      );
      list.append(row);
    }
    if (fixes.length > 5) {
      list.append(
        el("div", { class: "qp-fix-more" }, [
          `…and ${fixes.length - 5} more in the checks list below.`,
        ]),
      );
    }
    section.append(list);
    return section;
  }

  // ---------- checks ----------

  private buildChecks(score: DQScore): HTMLElement {
    const section = el("div", { class: "qp-section" });
    section.append(
      el("h3", { class: "qp-section-title" }, [
        "Checks",
        el("span", { class: "qp-section-hint" }, [
          this.dimensionFilter === null
            ? "every check, with exact pass / fail / n-a counts"
            : `filtered to ${this.dimensionFilter}`,
        ]),
      ]),
    );
    const table = el("div", { class: "qp-checks" });
    const head = el("div", { class: "qp-check qp-check-head" });
    head.append(
      el("span", { class: "qp-check-status" }, [""]),
      el("span", { class: "qp-check-label" }, ["Check"]),
      el("span", { class: "qp-check-dim" }, ["Dimension"]),
      el("span", { class: "qp-check-detail" }, ["Evidence"]),
      el("span", { class: "qp-check-counts" }, ["Pass · Fail · n/a"]),
      el("span", { class: "qp-check-action" }, [""]),
    );
    table.append(head);
    let shown = 0;
    for (const dimension of score.dimensions) {
      if (this.dimensionFilter !== null && this.dimensionFilter !== dimension.dimension) continue;
      const checks = [...dimension.checks].sort(
        (a, b) => Number(b.fail > 0) - Number(a.fail > 0) || b.fail - a.fail,
      );
      for (const check of checks) {
        if (this.onlyIssues && check.fail === 0) continue;
        shown++;
        const applicable = check.pass + check.fail;
        const rate = applicable === 0 ? null : check.pass / applicable;
        const row = el("div", { class: "qp-check" });
        row.append(
          el("span", {
            class: `qp-check-status dot-${rate === null ? "na" : rate >= 0.95 ? "good" : rate >= 0.8 ? "fair" : "poor"}`,
            title:
              rate === null
                ? "not applicable"
                : `${Math.round(rate * 100)}% of applicable values pass`,
          }, ["●"]),
          el("span", { class: "qp-check-label" }, [check.label]),
          el("span", { class: "qp-check-dim" }, [dimension.abbreviation]),
          el("span", { class: "qp-check-detail" }, [check.detail]),
          el("span", { class: "qp-check-counts" }, [
            `${formatCount(check.pass)} · ${formatCount(check.fail)} · ${formatCount(check.na)}`,
          ]),
          (() => {
            const cell = el("span", { class: "qp-check-action" });
            if (check.filter !== null && check.fail > 0) {
              const button = el("button", { class: "ghost small", type: "button" }, [
                check.fixLabel ?? "Show failing",
              ]) as HTMLButtonElement;
              button.addEventListener("click", () => this.callbacks.onFilter(check));
              cell.append(button);
            }
            return cell;
          })(),
        );
        table.append(row);
      }
    }
    if (shown === 0) {
      table.append(
        el("div", { class: "clean-empty" }, [
          this.onlyIssues ? "No failing checks." : "No checks for this dimension.",
        ]),
      );
    }
    section.append(table);
    return section;
  }

  // ---------- column × dimension matrix ----------

  private buildMatrix(score: DQScore, columnNames: readonly string[]): HTMLElement {
    const section = el("div", { class: "qp-section" });
    section.append(
      el("h3", { class: "qp-section-title" }, [
        "Column × dimension",
        el("span", { class: "qp-section-hint" }, [
          "pass rate per column; click a cell to filter its failing rows",
        ]),
      ]),
    );
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
          !this.onlyIssues || [...checks.values()].some((check) => check.fail > 0),
      );
    if (rows.length === 0) {
      section.append(
        el("div", { class: "clean-empty" }, ["No per-column checks to show."]),
      );
      return section;
    }
    const table = el("table", { class: "quality-matrix-table" });
    const head = el("tr");
    head.append(el("th", {}, ["Column"]));
    for (const dimension of dims) {
      head.append(el("th", {}, [dimension === "completeness" ? "Completeness" : "Validity"]));
    }
    table.append(head);
    for (const [column, checks] of rows) {
      const tr = el("tr");
      tr.append(el("td", {}, [columnNames[column] ?? `Column ${column + 1}`]));
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
              title: `${check.label} — ${formatCount(check.fail)} failing of ${formatCount(applicable)}`,
            },
            [rate === null ? "n/a" : `${Math.round(rate * 100)}%`],
          ) as HTMLButtonElement;
          if (check.filter !== null) {
            button.addEventListener("click", () => this.callbacks.onFilter(check));
          }
          td.append(button);
        }
        tr.append(td);
      }
      table.append(tr);
    }
    section.append(table);
    return section;
  }
}

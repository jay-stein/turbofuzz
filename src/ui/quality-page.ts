import type { DQScore, ScoreCheck, ScoreDimension } from "../data/score.js";
import { FITNESS_PROFILES, fitnessProfile, readFitnessId, saveFitnessId } from "../data/fitness.js";
import type { Finding } from "../data/findings.js";
import {
  CLASS_NAMES,
  LABEL_NAMES,
  type SensitiveConfidence,
  type SensitiveFinding,
  type SensitiveLabel,
} from "../data/sensitivity.js";
import type { DatasetStats } from "../data/stats.js";
import type { ColumnHealth, PageIssue } from "../data/dq-issues.js";
import {
  buildHero,
  buildIssuesTab,
  buildSensitiveBanner,
  buildSkeleton,
  buildStrip,
  buildTabs,
  buildTiles,
  type FixedEntry,
  type QualityTab,
  type RowsAffectedTile,
} from "./quality-layout.js";
import { clear, el } from "./dom.js";
import { chipText } from "./chips.js";
import type { DQExportKind } from "./quality-panel.js";
import { describeScope } from "./scope.js";
import type { ColumnType } from "../types.js";

const DIMENSION_DEFINITIONS: readonly { label: string; text: string }[] = [
  { label: "Completeness", text: "Are the cells populated?" },
  { label: "Validity", text: "Do values match their type and expected format?" },
  { label: "Uniqueness", text: "Are records and keys free of unwanted duplicates?" },
  { label: "Consistency", text: "Do related columns and checks agree with each other?" },
  { label: "Timeliness", text: "Is the data recent enough for its purpose?" },
  { label: "Accuracy", text: "Does the data match an authoritative reference? (Not available offline.)" },
];

const REVIEW_LIMIT = 8;

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
  /** Convert a downgraded text column to its richer type. */
  onConvert?(column: number, type: ColumnType): void;
  /** Run a "Worth reviewing" finding's action (open the merge panel, filter rows, etc.). */
  onFinding?(finding: Finding): void;
  /** The user dismissed, confirmed or relabelled a possibly-sensitive column. */
  onSensitiveChange?(card: SensitiveCard, change: SensitiveChange): void;
  /** Rescan one column over every value (exact counts instead of a sample). */
  onScanExact?(column: number): void;
  /** Open the mask / hash / drop choices for a flagged column, anchored to its button. */
  onProtect?(card: SensitiveCard, anchor: HTMLElement): void;
  /**
   * Preview and apply the fixes for these issues (each as its own undoable step).
   * Resolves with what was applied and how to undo each, or null when cancelled.
   */
  onFixIssues?(issues: readonly PageIssue[]): Promise<FixOutcome | null>;
  /** Open the one-by-one review for an issue; resolves with what was applied, or null when cancelled. */
  onReviewIssue?(issue: PageIssue): Promise<FixOutcome | null>;
  /** Show the rows behind an issue (filters the table or runs its finding action). */
  onShowIssue?(issue: PageIssue): void;
  /** The user marked a column optional (true) or required (false). */
  onOptionalChange?(columnName: string, optional: boolean): void;
  /** The Rules tab body, built by the app (which owns the rules). */
  buildRulesPanel?(): HTMLElement;
  ruleCount?(): number;
  /** The History tab body. */
  buildHistoryPanel?(): HTMLElement;
  /** Turn off a suggested check (session only). */
  onDisableSuggestion?(checkId: string): void;
  /** Download exceptions.csv (one row per failing cell). */
  onExceptions?(includeRaw: boolean): Promise<void>;
  /** Columns masked in the exceptions file (sensitive-flagged, not dismissed). */
  maskedColumns?(): number[];
  /** Open a column's profile from the health strip. */
  onOpenColumn?(column: number, anchor: HTMLElement): void;
  /** Filter the table to the rows that fail at least one check. */
  onShowAffectedRows?(): void;
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

/** A possibly-sensitive column as the page shows it: the engine finding plus masked examples. */
export interface SensitiveCard extends SensitiveFinding {
  /** Up to three sample values, already masked; the page reveals one on click. */
  examples: string[];
  /** The unmasked sample values, shown only when the user clicks to reveal. */
  revealed: string[];
}

export interface FixOutcome {
  items: { id: string; undo: () => void }[];
}

export interface SensitiveChange {
  dismissed?: boolean;
  confirmed?: boolean;
  label?: SensitiveLabel;
}

export interface FreshnessColumn {
  column: number;
  name: string;
  latest: number;
}

export interface QualityPageInput {
  score: DQScore;
  rowCount: number;
  /** Rows currently visible in the table, when a filter is active. */
  visibleRowCount?: number;
  stats: DatasetStats;
  columnNames: readonly string[];
  /** The single ranked issue list (fix, review, info). */
  issues?: readonly PageIssue[];
  /** One health card per column, worst first. */
  health?: readonly ColumnHealth[];
  /** Distinct rows failing a deterministic check; undefined while still counting. */
  rowsAffected?: RowsAffectedTile | null;
  /** Changes when a new file is loaded, so "fixed this session" starts empty. */
  datasetKey?: string;
  /** Possibly-sensitive columns from the engine, with the user's decisions applied. */
  sensitive?: readonly SensitiveCard[];
  sensitiveScanned?: boolean;
  /** Date/datetime columns with their latest value (epoch ms). */
  freshness?: readonly FreshnessColumn[];
  /** Injectable clock for deterministic freshness labels in tests. */
  now?: number;
}

/**
 * The Data Quality page (the Ataccama-style diagnostic dashboard): the score
 * with its inputs, what to fix first ranked by points gained, every check with
 * exact counts, the column × dimension matrix and the dataset facts — all
 * display-only, every number drills to the failing rows.
 */
export class QualityPage {
  private tab: QualityTab = "issues";
  private showAllColumns = false;
  private showAllIssues = false;
  private fixed: FixedEntry[] = [];
  /** Dataset-level advisory signals from the app, shown under the issue list. */
  private advanced: HTMLElement | null = null;
  private datasetKey = "";
  private onlyIssues = false;
  private dimensionFilter: ScoreDimension | null = null;
  private settingsOpen = false;
  private lastInput: QualityPageInput | null = null;
  private scopeLabel = "";
  private tableScopeLabel = "";

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
      const empty = el("div", { class: "clean-empty qp-empty" });
      empty.append(
        el("h3", {}, ["Data quality at a glance"]),
        el("p", {}, [
          "Load a file to score completeness, validity, uniqueness, consistency, timeliness and accuracy, then review what to fix first.",
        ]),
      );
      const definitions = el("ul", { class: "qp-empty-definitions" });
      for (const definition of DIMENSION_DEFINITIONS) {
        definitions.append(
          el("li", {}, [el("strong", {}, [definition.label]), ` — ${definition.text}`]),
        );
      }
      empty.append(definitions);
      this.root.append(empty);
      return;
    }
    const { score, stats, rowCount, columnNames } = input;
    if (input.datasetKey !== undefined && input.datasetKey !== this.datasetKey) {
      this.datasetKey = input.datasetKey;
      this.fixed = [];
      this.showAllIssues = false;
      this.showAllColumns = false;
    }
    this.scopeLabel = describeScope({ total: rowCount });
    this.tableScopeLabel =
      input.visibleRowCount !== undefined && input.visibleRowCount < rowCount
        ? describeScope({ total: rowCount, visible: input.visibleRowCount })
        : "";
    const checkCount = score.dimensions.reduce((sum, dim) => sum + dim.checks.length, 0);
    const issues = input.issues ?? [];
    const health = input.health ?? [];
    const cards = input.sensitive ?? [];
    const liveCards = cards.filter((card) => card.dismissed !== true);
    const scanned = input.sensitiveScanned === true;
    const fixIssues = issues.filter((issue) => issue.severity === "fix");
    const reviewIssues = issues.filter((issue) => issue.severity === "review");
    const safe = fixIssues.filter((issue) => issue.batchSafe && issue.fixes.length > 0);
    const topWin = fixIssues.find((issue) => issue.points !== null) ?? null;

    this.root.append(
      buildHero(
        {
          overall: score.overall === null ? null : Math.round(score.overall * 10) / 10,
          band: score.band,
          bandWord: bandWord(score.band),
          bandReason:
            score.bandCap === null
              ? null
              : `${bandWord(score.band).replace(/^./, (c) => c.toUpperCase())} because ${score.bandCap.reason}`,
          rowCount,
          columnCount: columnNames.length,
          checkCount,
          topWin,
          fixCount: fixIssues.length,
          reviewCount: reviewIssues.length,
          sensitiveCount: liveCards.length,
          maskedColumns: this.callbacks.maskedColumns?.().length ?? 0,
          canFixTop: safe.length > 0,
          scopeLine:
            this.tableScopeLabel === ""
              ? this.scopeLabel
              : `${this.scopeLabel} · Table view: ${this.tableScopeLabel}`,
        },
        {
          fixTop: () => void this.fix(safe.slice(0, 3)),
          copy: () => void this.callbacks.onExport("markdown"),
          download: () => void this.callbacks.onExport("json"),
          ...(this.callbacks.onExceptions === undefined
            ? {}
            : { exceptions: (includeRaw: boolean) => void this.callbacks.onExceptions?.(includeRaw) }),
          html: () => void this.callbacks.onExport("html"),
          supplier: () => void this.callbacks.onExport("supplier"),
          weights: () => {
            this.tab = "checks";
            this.settingsOpen = !this.settingsOpen;
            this.render(this.lastInput);
          },
        },
      ),
      buildTiles(
        {
          fix: fixIssues.length,
          review: reviewIssues.length,
          sensitive: scanned ? liveCards.length : null,
          rows: input.rowsAffected === undefined ? null : input.rowsAffected,
        },
        {
          openIssues: () => this.select("issues"),
          openSensitive: () => this.select("sensitive"),
          showAffected: () => this.callbacks.onShowAffectedRows?.(),
        },
      ),
      buildStrip(health, this.showAllColumns, {
        open: (column, anchor) => this.callbacks.onOpenColumn?.(column, anchor),
        toggle: () => {
          this.showAllColumns = !this.showAllColumns;
          this.render(this.lastInput);
        },
      }),
      buildTabs(
        this.tab,
        { issues: issues.length, sensitive: scanned ? liveCards.length : null, rules: this.callbacks.ruleCount?.() ?? 0 },
        (tab) => this.select(tab),
      ),
    );

    const panel = el("div", {
      class: "qp-panel",
      id: "qp-panel",
      role: "tabpanel",
      "aria-labelledby": `qp-tab-${this.tab}`,
    });
    if (this.tab === "issues") {
      panel.append(
        buildIssuesTab(
          issues,
          this.fixed,
          { showAll: this.showAllIssues, checkCount },
          buildSensitiveBanner(
            liveCards.map((card) => card.name),
            () => this.select("sensitive"),
          ),
          {
            applyAllSafe: () => void this.fix(safe),
            ...(this.callbacks.onReviewIssue === undefined ? {} : { review: (issue: PageIssue) => void this.review(issue) }),
            safeCount: safe.length,
            fix: (issue) => void this.fixOne(issue),
            show: (issue) => this.callbacks.onShowIssue?.(issue),
            ...(this.callbacks.onOptionalChange === undefined
              ? {}
              : {
                  optional: (issue: PageIssue, optional: boolean) => {
                    if (issue.columnName !== null) this.callbacks.onOptionalChange?.(issue.columnName, optional);
                  },
                }),
            toggleAll: () => {
              this.showAllIssues = !this.showAllIssues;
              this.render(this.lastInput);
            },
            openChecks: () => this.select("checks"),
            undo: (entry) => this.undoFixed(entry),
          },
        ),
      );
      if (this.advanced !== null) panel.append(this.advanced);
    } else if (this.tab === "columns") {
      panel.append(
        buildStrip(health, true, { open: (column, anchor) => this.callbacks.onOpenColumn?.(column, anchor), toggle: () => {} }, health.length),
      );
    } else if (this.tab === "rules") {
      const rules = this.callbacks.buildRulesPanel?.();
      if (rules !== undefined) panel.append(rules);
    } else if (this.tab === "history") {
      const history = this.callbacks.buildHistoryPanel?.();
      if (history !== undefined) panel.append(history);
    } else if (this.tab === "sensitive") {
      panel.append(this.buildSensitive(cards, scanned));
      if (!scanned) panel.append(buildSkeleton(3));
    } else {
      const onlyIssues = el(
        "button",
        { class: `ghost small ${this.onlyIssues ? "active" : ""}`, type: "button" },
        [this.onlyIssues ? "Showing issues only" : "Show only issues"],
      ) as HTMLButtonElement;
      onlyIssues.addEventListener("click", () => {
        this.onlyIssues = !this.onlyIssues;
        this.render(this.lastInput);
      });
      panel.append(
        el("div", { class: "qp-actions" }, [onlyIssues]),
        this.buildSettings(score),
        this.buildExplanation(score),
        this.buildDimensions(score),
        this.buildFreshness(input.freshness ?? [], input.now ?? Date.now()),
        this.buildChecks(score),
        this.buildMatrix(score, columnNames),
      );
    }
    this.root.append(
      panel,
      el("footer", { class: "qp-footer" }, [
        "Computed locally in your browser · No data leaves this tab",
      ]),
    );
    void stats;
  }

  /** Sets (or replaces) the advisory-signals section shown at the bottom of the Issues tab. */
  setAdvanced(section: HTMLElement | null): void {
    this.advanced?.remove();
    this.advanced = section;
    const panel = this.root.querySelector("#qp-panel");
    if (section !== null && panel !== null && this.tab === "issues") panel.append(section);
  }

  private select(tab: QualityTab): void {
    this.tab = tab;
    this.render(this.lastInput);
  }

  /** Previews and applies the fixes for these issues, then remembers them under Fixed this session. */
  private async fix(issues: readonly PageIssue[]): Promise<void> {
    if (issues.length === 0 || this.callbacks.onFixIssues === undefined) return;
    const outcome = await this.callbacks.onFixIssues(issues);
    if (outcome === null) return;
    for (const item of outcome.items) {
      const issue = issues.find((candidate) => candidate.id === item.id);
      if (issue === undefined) continue;
      this.fixed.push({ id: item.id, title: issue.title, points: issue.points, undo: item.undo });
    }
    this.render(this.lastInput);
  }

  private async review(issue: PageIssue): Promise<void> {
    const outcome = await this.callbacks.onReviewIssue?.(issue);
    if (outcome === null || outcome === undefined) return;
    for (const item of outcome.items) {
      this.fixed.push({ id: item.id, title: issue.title, points: issue.points, undo: item.undo });
    }
    this.render(this.lastInput);
  }

  private async fixOne(issue: PageIssue): Promise<void> {
    const convert = issue.fixes.find((step) => step.kind === "convert");
    if (convert !== undefined && issue.fixes.length === 1) {
      // Conversions go through the type dialog, which guards against losing values.
      this.callbacks.onConvert?.(convert.column, convert.to);
      return;
    }
    await this.fix([issue]);
  }

  private undoFixed(entry: FixedEntry): void {
    this.fixed = this.fixed.filter((candidate) => candidate !== entry);
    entry.undo();
    this.render(this.lastInput);
  }

  private buildScopeLine(): HTMLElement {
    const text =
      this.tableScopeLabel === ""
        ? this.scopeLabel
        : `${this.scopeLabel} · Table view: ${this.tableScopeLabel}`;
    return el("div", { class: "qp-scope", title: "Which rows the score and checks describe" }, [
      text,
    ]);
  }

  private buildExplanation(score: DQScore): HTMLElement {
    const line = el("div", { class: "qp-explain" });
    const applicable = score.dimensions.filter(
      (dimension) => dimension.score !== null && dimension.weight > 0,
    );
    const weightSum = applicable.reduce((sum, dimension) => sum + dimension.weight, 0);
    if (applicable.length === 0 || weightSum <= 0) {
      line.append(
        el("span", { class: "qp-explain-empty" }, [
          "No weighted, applicable dimensions to explain.",
        ]),
      );
    } else {
      const parts = applicable.map((dimension) => {
        const contribution = (dimension.weight / weightSum) * (dimension.score ?? 0);
        return `${dimension.label} ${(dimension.score ?? 0).toFixed(1)} × ${dimension.weight} → +${contribution.toFixed(1)}`;
      });
      line.append(
        el("span", { class: "qp-explain-label" }, ["Score:"]),
        el("span", { class: "qp-explain-parts" }, [parts.join(" · ")]),
      );
    }
    const adjust = el(
      "button",
      { class: "link qp-weight-link", type: "button" },
      ["Adjust weights"],
    ) as HTMLButtonElement;
    adjust.addEventListener("click", () => {
      this.settingsOpen = true;
      this.render(this.lastInput);
    });
    line.append(adjust);
    return line;
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
    const profileRow = el("label", { class: "quality-setting" });
    const profileSelect = el("select", { "aria-label": "Fitness profile" }) as HTMLSelectElement;
    for (const profile of FITNESS_PROFILES) {
      profileSelect.append(el("option", { value: profile.id, ...(profile.id === readFitnessId() ? { selected: "selected" } : {}) }, [profile.label]));
    }
    const profileNote = el("span", { class: "qp-settings-note" }, [fitnessProfile(readFitnessId()).description]);
    profileSelect.addEventListener("change", () => {
      const profile = fitnessProfile(profileSelect.value);
      saveFitnessId(profile.id);
      for (const [dimension, input] of weightInputs) input.value = String(profile.weights[dimension]);
      profileNote.textContent = profile.description;
    });
    profileRow.append(el("span", {}, ["Fitness profile"]), profileSelect, profileNote);
    settings.append(profileRow);
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
    wrap.append(
      el("h3", { class: "qp-section-title" }, [
        "Dimensions",
        el("span", { class: "qp-section-hint" }, [this.scopeLabel]),
      ]),
    );
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

  // ---------- freshness ----------

  private buildFreshness(columns: readonly FreshnessColumn[], now: number): HTMLElement {
    if (columns.length === 0) return el("div", { class: "hidden" });
    const section = el("div", { class: "qp-section" });
    section.append(
      el("h3", { class: "qp-section-title" }, [
        "Freshness",
        el("span", { class: "qp-section-hint" }, [
          `latest value per date column · informational; ${this.scopeLabel}`,
        ]),
      ]),
    );
    const list = el("div", { class: "qp-freshness" });
    for (const column of columns) {
      const date = new Date(column.latest);
      const latest = Number.isFinite(column.latest)
        ? date.toISOString().slice(0, 10)
        : "unknown";
      const ageDays = Number.isFinite(column.latest)
        ? Math.max(0, (now - column.latest) / 86_400_000)
        : null;
      const age =
        ageDays === null
          ? "No recent value"
          : ageDays < 1
            ? "Today"
            : `${Math.floor(ageDays).toLocaleString()} day${Math.floor(ageDays) === 1 ? "" : "s"} old`;
      const card = el("div", { class: "qp-fresh-card" });
      card.append(
        el("span", { class: "qp-fresh-name", title: column.name }, [column.name]),
        el("span", { class: "qp-fresh-value" }, [latest]),
        el("span", { class: "qp-fresh-meta" }, [age]),
      );
      list.append(card);
    }
    section.append(list);
    return section;
  }

  // ---------- sensitive data ----------

  private buildSensitive(cards: readonly SensitiveCard[], scanned: boolean): HTMLElement {
    const section = el("div", { class: "qp-section qp-sensitive" });
    section.append(
      el("h3", { class: "qp-section-title" }, [
        "Possibly sensitive columns",
        el("span", { class: "qp-section-hint" }, [
          "advisory only — these are not counted against your score",
        ]),
      ]),
    );
    const visible = cards.filter((card) => card.dismissed !== true);
    const hidden = cards.filter((card) => card.dismissed === true);
    if (!scanned && visible.length === 0) {
      section.append(
        el("div", { class: "qp-sensitive-empty" }, ["Scanning text columns for personal data…"]),
      );
      return section;
    }
    if (visible.length === 0) {
      section.append(
        el("div", { class: "qp-sensitive-empty" }, [
          hidden.length > 0
            ? "Nothing left to review."
            : "No columns look like they hold personal or sensitive data.",
        ]),
      );
    }
    const groups: { confidence: SensitiveConfidence; title: string }[] = [
      { confidence: "high", title: "Likely" },
      { confidence: "medium", title: "Possible" },
      { confidence: "low", title: "Weak signals" },
    ];
    for (const group of groups) {
      const inGroup = visible.filter((card) => card.confidence === group.confidence);
      if (inGroup.length === 0) continue;
      const list = el("div", { class: "qp-sensitive-list" });
      for (const card of inGroup) list.append(this.buildSensitiveCard(card));
      if (group.confidence === "low") {
        const details = el("details", { class: "qp-sensitive-weak" }, [
          el("summary", {}, [`${group.title} (${inGroup.length}) — show`]),
          list,
        ]);
        section.append(details);
      } else {
        section.append(el("h4", { class: "qp-sensitive-group" }, [group.title]), list);
      }
    }
    if (hidden.length > 0) {
      const restore = el("details", { class: "qp-sensitive-weak" }, [
        el("summary", {}, [`${hidden.length} marked not sensitive — show`]),
      ]);
      for (const card of hidden) {
        const row = el("div", { class: "qp-sensitive-hidden" }, [
          el("span", {}, [card.name]),
        ]);
        const undo = el("button", { class: "ghost small", type: "button" }, ["Restore"]);
        undo.addEventListener("click", () => this.callbacks.onSensitiveChange?.(card, { dismissed: false }));
        row.append(undo);
        restore.append(row);
      }
      section.append(restore);
    }
    return section;
  }

  private buildSensitiveCard(card: SensitiveCard): HTMLElement {
    const root = el("div", { class: "qp-sensitive-card" });
    root.append(
      el("div", { class: "qp-sensitive-name", title: card.name }, [card.name]),
      el("div", { class: "qp-sensitive-tags" }, [
        el("span", { class: "qp-sensitive-tag" }, [CLASS_NAMES[card.class]]),
        card.confirmed === true
          ? el("span", { class: "qp-sensitive-tag confirmed" }, ["Marked sensitive"])
          : "",
      ]),
    );
    const why = el("ul", { class: "qp-sensitive-why" });
    for (const reason of card.reasons) why.append(el("li", {}, [reason.label]));
    root.append(why);

    if (card.examples.length > 0) {
      const examples = el("div", { class: "qp-sensitive-examples", "aria-label": "Masked examples" });
      card.examples.forEach((masked, index) => {
        const chip = el("button", {
          class: "qp-sensitive-example",
          type: "button",
          title: "Click to reveal this value",
        }, [masked]) as HTMLButtonElement;
        let shown = false;
        chip.addEventListener("click", () => {
          shown = !shown;
          chip.textContent = shown ? (card.revealed[index] ?? masked) : masked;
          chip.title = shown ? "Click to hide this value" : "Click to reveal this value";
        });
        examples.append(chip);
      });
      root.append(examples);
    }

    const sampledAll = card.sampled >= card.scanned;
    root.append(
      el("div", { class: "qp-sensitive-meta" }, [
        sampledAll
          ? `${formatCount(card.scanned)} values scanned`
          : `${formatCount(card.sampled)} of ${formatCount(card.scanned)} values scanned`,
      ]),
    );
    if (!sampledAll && this.callbacks.onScanExact !== undefined) {
      const scan = el("button", { class: "ghost small", type: "button" }, ["Scan all values"]);
      scan.addEventListener("click", () => {
        scan.setAttribute("disabled", "");
        scan.textContent = "Scanning…";
        this.callbacks.onScanExact?.(card.column);
      });
      root.append(scan);
    }

    const label = el("select", {
      class: "chart-select qp-sensitive-label",
      "aria-label": `Handling label for ${card.name}`,
    }) as HTMLSelectElement;
    for (const value of ["public", "internal", "confidential", "restricted"] as const) {
      label.append(el("option", { value }, [LABEL_NAMES[value]]) as HTMLOptionElement);
    }
    label.value = card.label;
    label.addEventListener("change", () =>
      this.callbacks.onSensitiveChange?.(card, { label: label.value as SensitiveLabel }),
    );
    const actions = el("div", { class: "qp-sensitive-actions" });
    const notSensitive = el("button", { class: "ghost small", type: "button" }, ["Not sensitive"]);
    notSensitive.addEventListener("click", () =>
      this.callbacks.onSensitiveChange?.(card, { dismissed: true, confirmed: false }),
    );
    const mark = el("button", { class: "ghost small", type: "button" }, [
      card.confirmed === true ? "Unmark" : "Mark sensitive",
    ]);
    mark.addEventListener("click", () =>
      this.callbacks.onSensitiveChange?.(card, { confirmed: card.confirmed !== true }),
    );
    actions.append(label, notSensitive, mark);
    if (this.callbacks.onProtect !== undefined) {
      const protect = el("button", { class: "ghost small", type: "button" }, ["Protect ▾"]) as HTMLButtonElement;
      protect.title = "Mask or hash the values, or drop the column";
      protect.addEventListener("click", () => this.callbacks.onProtect?.(card, protect));
      actions.append(protect);
    }
    root.append(actions);
    return root;
  }

  // ---------- checks ----------

  /** A check's action: convert the column when it is a downgrade, else filter. */
  private runCheck(check: ScoreCheck): void {
    if (
      check.convertTo !== undefined &&
      check.column !== null &&
      this.callbacks.onConvert !== undefined
    ) {
      this.callbacks.onConvert(check.column, check.convertTo);
      return;
    }
    this.callbacks.onFilter(check);
  }

  private buildChecks(score: DQScore): HTMLElement {
    const section = el("div", { class: "qp-section" });
    section.append(
      el("h3", { class: "qp-section-title" }, [
        "Checks",
        el("span", { class: "qp-section-hint" }, [
          this.dimensionFilter === null
            ? `every check, with exact pass / fail / n-a counts · ${this.scopeLabel}`
            : `filtered to ${this.dimensionFilter} · ${this.scopeLabel}`,
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
            if (check.fail > 0 && (check.filter !== null || check.convertTo !== undefined)) {
              const button = el("button", { class: "ghost small", type: "button" }, [
                chipText(check.convertTo === undefined ? "filter" : "fix", check.fixLabel ?? "Show failing"),
              ]) as HTMLButtonElement;
              button.addEventListener("click", () => this.runCheck(check));
              cell.append(button);
            }
            if (check.suggested === true && this.callbacks.onDisableSuggestion !== undefined) {
              const off = el("button", { class: "ghost small", type: "button", title: "Suggested from the column names. Turn it off." }, ["Turn off"]);
              off.addEventListener("click", () => this.callbacks.onDisableSuggestion?.(check.id));
              cell.append(off);
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
    const dims = score.dimensions
      .map((dimension) => dimension.dimension)
      .filter((dimension) =>
        [...perColumn.values()].some((checks) => checks.has(dimension)),
      );
    const dimLabels = dims.map(
      (dimension) =>
        score.dimensions.find((entry) => entry.dimension === dimension)?.label ??
        dimension,
    );
    section.append(
      el("h3", { class: "qp-section-title" }, [
        dimLabels.length > 0 ? `${dimLabels.join(" & ")} by column` : "Column checks",
        el("span", { class: "qp-section-hint" }, [
          `pass rate per column; click a cell to filter its failing rows · ${this.scopeLabel}`,
        ]),
      ]),
    );
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
      head.append(
        el("th", {}, [
          score.dimensions.find((entry) => entry.dimension === dimension)?.label ?? dimension,
        ]),
      );
    }
    head.append(el("th", {}, ["Score"]));
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
      const checksForColumn = [...checks.values()];
      const pass = checksForColumn.reduce((sum, check) => sum + check.pass, 0);
      const fail = checksForColumn.reduce((sum, check) => sum + check.fail, 0);
      const total = pass + fail;
      const rate = total === 0 ? null : pass / total;
      tr.append(
        el("td", {}, [
          el(
            "span",
            {
              class: `quality-cell band-${
                rate === null ? "na" : rate >= 0.95 ? "good" : rate >= 0.8 ? "fair" : "poor"
              }`,
              title: `${formatCount(pass)} passing of ${formatCount(total)} applicable values`,
            },
            [rate === null ? "n/a" : `${Math.round(rate * 100)}%`],
          ),
        ]),
      );
      table.append(tr);
    }
    section.append(table);
    return section;
  }
}

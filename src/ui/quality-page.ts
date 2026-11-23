import { overallIfPassed, pointsIfPassed, type DQScore, type ScoreCheck, type ScoreDimension } from "../data/score.js";
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
import { cleanSteps, type DQBaseline } from "../data/dq-baseline.js";
import { buildCompareSection, type ScoreStep } from "./quality-compare.js";
import type { ColumnHealth, PageIssue } from "../data/dq-issues.js";
import {
  buildCleanHero,
  buildHero,
  buildIssuesTab,
  groupIssues,
  ISSUE_GROUPS,
  openIssueGroup,
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
import { excelBox } from "./excel-box.js";
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
  /**
   * Which page this is: "clean" lists the issues to fix, grouped by the kind of work;
   * "report" (the default) is the Data Quality Report with its tabs and exports.
   */
  mode?: "clean" | "report";
  /** Go to the Clean page (from the report). */
  onOpenClean?(): void;
  /** Go to the Data Quality Report, optionally on one tab (from the Clean page). */
  onOpenReport?(tab?: QualityTab): void;
  /** The ways to fill one column's empty cells (Fill the gaps). */
  fillChoices?(column: number): { id: string; label: string; note?: string }[];
  /** Fill one column's empty cells the chosen way (previewed, undoable). */
  onFill?(column: number, choice: string): void;
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
  onShowIssueSide?(issue: PageIssue, special: "dateDayFirst" | "dateMonthFirst"): void;
  /**
   * Remove repeated rows as one Recipe step, comparing every column but `ignore` (none: exact repeats).
   * Opens a preview of example groups first; `showAll` lists every one in the Table instead.
   */
  onDedupe?(ignore: number[], keep: "first" | "last", rows: number, showAll?: () => void): void;
  /** The user reviewed an issue and set it aside ("not a problem"). */
  onDismissIssue?(issue: PageIssue): void;
  /** Issues set aside earlier for this file. */
  reviewedList?(): { id: string; title: string; rows: number }[];
  /** Put a set-aside issue back. */
  onRestoreReviewed?(id: string): void;
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
  /** Build and save the formatted Excel report of the whole file; resolves with a note to show, or "". */
  onExcelReport?(includeRaw: boolean): Promise<string>;
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
  /** The data as loaded, before any step: the "before" of the Clean page and the report. */
  baseline?: DQBaseline | null;
  /** The same measures for the data now: the report's "after". */
  current?: DQBaseline | null;
  /** The steps applied since the raw load, each with the score once it landed. */
  steps?: readonly ScoreStep[];
}

/**
 * The Data Quality page (the Ataccama-style diagnostic dashboard): the score
 * with its inputs, what to fix first ranked by points gained, every check with
 * exact counts, the column × dimension matrix and the dataset facts — all
 * display-only, every number drills to the failing rows.
 */
export class QualityPage {
  private tab: QualityTab = "columns";
  private showAllIssues = false;
  private fixed: FixedEntry[] = [];
  /** Clean steps done at the last render (null before the first), to say when one finishes. */
  private stepsDone: Set<string> | null = null;
  private finished: string | null = null;
  /** True while a fix run is in progress. */
  private fixing = false;
  /** Dataset-level advisory signals from the app, shown under the issue list. */
  private advanced: HTMLElement | null = null;
  private datasetKey = "";
  private onlyIssues = false;
  private dimensionFilter: ScoreDimension | null = null;
  private settingsOpen = false;
  /** The Excel report is being built; kept here because the page redraws while it waits (sensitive scan). */
  private excelBusy = false;
  /** What the last Excel build said ("Saved…", a cut-off note or an error), shown in the foot box. */
  private excelNote = "";
  private lastInput: QualityPageInput | null = null;
  private scopeLabel = "";
  private tableScopeLabel = "";

  constructor(
    private readonly root: HTMLElement,
    private readonly callbacks: QualityPageCallbacks,
  ) {
    this.root.classList.add("quality-page");
    if (this.isClean) this.root.classList.add("clean-page");
  }

  private get isClean(): boolean {
    return this.callbacks.mode === "clean";
  }

  /** Shows one tab of the report (used when another page sends the user here). */
  openTab(tab: QualityTab): void {
    this.tab = tab;
    this.render(this.lastInput);
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
      this.stepsDone = null;
      this.finished = null;
      this.showAllIssues = false;
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

    if (this.isClean) {
      this.renderClean(input, issues, safe, liveCards.map((card) => card.name), checkCount);
      return;
    }

    this.root.append(
      buildHero(
        {
          overall: score.overall === null ? null : Math.round(score.overall * 10) / 10,
          band: score.band,
          bandWord: bandWord(score.band),
          bandReason: score.bandReason,
          rowCount,
          columnCount: columnNames.length,
          checkCount,
          topWin,
          fixCount: fixIssues.length,
          reviewCount: reviewIssues.length,
          sensitiveCount: liveCards.length,
          maskedColumns: this.callbacks.maskedColumns?.().length ?? 0,
          excelBusy: this.excelBusy,
          canFixTop: safe.length > 0,
          scopeLine:
            this.tableScopeLabel === ""
              ? this.scopeLabel
              : `${this.scopeLabel} · Table view: ${this.tableScopeLabel}`,
        },
        {
          fixTop: () => void this.fix(safe.slice(0, 3)),
          ...(this.callbacks.onOpenClean === undefined ? {} : { openClean: () => this.callbacks.onOpenClean?.() }),
          copy: () => void this.callbacks.onExport("markdown"),
          ...(this.callbacks.onExceptions === undefined
            ? {}
            : { exceptions: (includeRaw: boolean) => void this.callbacks.onExceptions?.(includeRaw) }),
          html: () => void this.callbacks.onExport("html"),
          ...(this.callbacks.onExcelReport === undefined
            ? {}
            : { excel: (includeRaw: boolean) => void this.runExcel(includeRaw).catch(() => undefined) }),
          weights: () => {
            this.tab = "checks";
            this.settingsOpen = !this.settingsOpen;
            this.render(this.lastInput);
          },
        },
      ),
      ...(input.baseline === undefined || input.baseline === null || input.current === undefined || input.current === null
        ? []
        : [
            buildCompareSection(input.baseline, input.current, input.steps ?? [], {
              bandFair: this.callbacks.config?.bandFair ?? 75,
              bandGood: this.callbacks.config?.bandGood ?? 90,
              ...(this.callbacks.onOpenClean === undefined ? {} : { openClean: () => this.callbacks.onOpenClean?.() }),
            }),
          ]),
      buildTiles(
        {
          fix: fixIssues.length,
          review: reviewIssues.length,
          sensitive: scanned ? liveCards.length : null,
          rows:
            input.rowsAffected === undefined || input.rowsAffected === null
              ? null
              : {
                  ...input.rowsAffected,
                },
        },
        {
          openIssues: () => this.callbacks.onOpenClean?.(),
          openSensitive: () => this.select("sensitive"),
          showAffected: () => this.callbacks.onShowAffectedRows?.(),
        },
      ),
      buildTabs(
        this.tab,
        { sensitive: scanned ? liveCards.length : null, rules: this.callbacks.ruleCount?.() ?? 0 },
        (tab) => this.select(tab),
      ),
    );

    const panel = el("div", {
      class: "qp-panel",
      id: "qp-panel",
      role: "tabpanel",
      "aria-labelledby": `qp-tab-${this.tab}`,
    });
    if (this.tab === "columns") {
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
    const excelFoot = this.buildExcelFoot();
    this.root.append(panel);
    if (excelFoot !== null) this.root.append(excelFoot);
    this.root.append(
      el("footer", { class: "qp-footer" }, [
        "Computed locally in your browser · No data leaves this tab",
      ]),
    );
    void stats;
  }

  /**
   * One Excel build at a time, from either button. The page redraws while the build waits
   * (sensitive scan results stream in), so the busy state and the result live here, not in the buttons.
   */
  private async runExcel(includeRaw: boolean): Promise<string> {
    const run = this.callbacks.onExcelReport;
    if (run === undefined) return "";
    if (this.excelBusy) return "The report is already being built.";
    this.excelBusy = true;
    this.excelNote = "";
    this.render(this.lastInput);
    try {
      const note = await run(includeRaw);
      this.excelNote = note === "" ? "Saved. Check your downloads." : note;
      return note;
    } catch (error) {
      this.excelNote = error instanceof Error ? error.message : "Export failed.";
      throw error;
    } finally {
      this.excelBusy = false;
      this.render(this.lastInput);
    }
  }

  /** The big Excel call to action at the foot of the page, as on the comparison report. */
  private buildExcelFoot(): HTMLElement | null {
    if (this.callbacks.onExcelReport === undefined) return null;
    const masked = this.callbacks.maskedColumns?.().length ?? 0;
    const raw = el("input", { type: "checkbox", class: "qp-raw-switch" }) as HTMLInputElement;
    const extra =
      masked === 0
        ? undefined
        : el("label", { class: "qp-raw-label qp-excel-raw" }, [
            raw,
            ` Include raw values (${masked.toLocaleString()} sensitive ${masked === 1 ? "column is" : "columns are"} masked)`,
          ]);
    return excelBox({
      title: "Get the Excel data-quality report",
      sub: "The whole file in one formatted workbook: score and dimensions, every column profiled, findings, checks and rules, failing cells, relationships and sensitive columns. Ready to share.",
      run: () => this.runExcel(raw.checked),
      busy: this.excelBusy,
      ...(this.excelNote === "" ? {} : { note: this.excelNote }),
      ...(extra === undefined ? {} : { extra }),
    });
  }

  /** Sets (or replaces) the advisory-signals section shown at the bottom of the Clean page. */
  setAdvanced(section: HTMLElement | null): void {
    this.advanced?.remove();
    this.advanced = section;
    const panel = this.root.querySelector(".cl-panel");
    if (section !== null && panel !== null && this.isClean) panel.append(section);
  }

  /** The checks behind these issues that a fix would clear (optional columns' blanks are not defects). */
  private scoredChecks(issues: readonly PageIssue[]): Set<string> {
    const ids = new Set<string>();
    for (const issue of issues) {
      if (issue.check !== undefined && issue.optional !== true) ids.add(issue.check.id);
    }
    return ids;
  }

  /** Exact points a group adds when all of it is fixed, and the dimension its largest check sits in. */
  private groupGain(score: DQScore, issues: readonly PageIssue[]): { points: number; dimension: string | null } {
    const ids = this.scoredChecks(issues);
    let top: ScoreCheck | null = null;
    for (const issue of issues) {
      const check = issue.check;
      if (check === undefined || !ids.has(check.id)) continue;
      if (top === null || check.fail > top.fail) top = check;
    }
    const dimension = top === null ? null : (score.dimensions.find((entry) => entry.dimension === top.dimension)?.label ?? null);
    return { points: pointsIfPassed(score, ids), dimension };
  }

  /** Opens one step's group on the Clean page and brings it into view. */
  private openStep(id: string): void {
    openIssueGroup(id);
    this.render(this.lastInput);
    this.root.querySelector(`[data-group="${id}"].qp-group`)?.scrollIntoView({ block: "start", behavior: "smooth" });
  }

  /**
   * The Clean page: the score from the raw load to now and what is still on the table, the
   * biggest win next, then every issue in its group of work with the points the group adds.
   */
  private renderClean(
    input: QualityPageInput,
    issues: readonly PageIssue[],
    safe: readonly PageIssue[],
    sensitiveNames: readonly string[],
    checkCount: number,
  ): void {
    const { score } = input;
    const groups = groupIssues(issues).map((entry) => ({ ...entry, gain: this.groupGain(score, entry.issues) }));
    const potential = overallIfPassed(score, this.scoredChecks(issues));
    const baseline = input.baseline ?? null;
    // The kinds of work as numbered steps; the one to do now leads, whatever its points.
    const open = groups
      .map((entry) => ({ id: entry.group.id, issues: entry.issues.filter((issue) => issue.severity !== "info").map((issue) => issue.id) }))
      .filter((entry) => entry.issues.length > 0);
    const steps = cleanSteps(baseline, open).map((step) => ({ ...step, title: ISSUE_GROUPS.find((group) => group.id === step.id)?.title ?? step.id }));
    const doneNow = new Set(steps.filter((step) => step.state === "done").map((step) => step.id));
    const justDone = steps.find((step) => doneNow.has(step.id) && this.stepsDone !== null && !this.stepsDone.has(step.id));
    if (justDone !== undefined) this.finished = justDone.title;
    else if (this.finished !== null && !steps.some((step) => step.title === this.finished && step.state === "done")) this.finished = null;
    this.stepsDone = doneNow;
    const currentId = steps.find((step) => step.state === "current")?.id;
    const top = groups.find((entry) => entry.group.id === currentId) ?? null;
    const topSafe = top === null ? [] : top.issues.filter((issue) => issue.batchSafe && issue.fixes.length > 0);
    const smartIssue = issues.find((issue) => issue.kind === "smartDuplicates");
    this.root.append(
      buildCleanHero(
        {
          overall: score.overall === null ? null : Math.round(score.overall * 10) / 10,
          band: score.band,
          bandWord: bandWord(score.band),
          raw: baseline === null || baseline.overall === null ? null : Math.round(baseline.overall * 10) / 10,
          potential: potential === null ? null : Math.round(potential * 10) / 10,
          bandFair: this.callbacks.config?.bandFair ?? 75,
          bandGood: this.callbacks.config?.bandGood ?? 90,
          fixCount: issues.filter((issue) => issue.severity === "fix").length,
          reviewCount: issues.filter((issue) => issue.severity === "review").length,
          safeCount: safe.length,
          steps,
          finished: this.finished,
          smart: smartIssue?.dedupe === undefined || this.callbacks.onDedupe === undefined ? null : { rows: smartIssue.dedupe.rows, ignoredNames: smartIssue.dedupe.ignoredNames, points: smartIssue.points },
          next: top === null ? null : { id: top.group.id, title: top.group.title, points: top.gain.points, dimension: top.gain.dimension, safe: topSafe.length },
        },
        {
          fixAllSafe: () => void this.fix(safe),
          fixNext: () => void this.fix(topSafe),
          openNext: () => {
            if (top !== null) this.openStep(top.group.id);
          },
          openStep: (id) => this.openStep(id),
          openReport: () => this.callbacks.onOpenReport?.(),
        },
      ),
    );
    const panel = el("div", { class: "cl-panel" });
    panel.append(
      buildIssuesTab(
        issues,
        this.fixed,
        { showAll: this.showAllIssues, checkCount, steps },
        buildSensitiveBanner(sensitiveNames, () => this.callbacks.onOpenReport?.("sensitive")),
        {
          fixGroup: (group) => void this.fix(group),
          ...(this.callbacks.onReviewIssue === undefined ? {} : { review: (issue: PageIssue) => void this.review(issue) }),
          ...(this.callbacks.onDismissIssue === undefined ? {} : { dismiss: (issue: PageIssue) => this.callbacks.onDismissIssue?.(issue) }),
          reviewed: this.callbacks.reviewedList?.() ?? [],
          restore: (id: string) => this.callbacks.onRestoreReviewed?.(id),
          fix: (issue) => void this.fixOne(issue),
          show: (issue) => this.callbacks.onShowIssue?.(issue),
          showSide: (issue, special) => this.callbacks.onShowIssueSide?.(issue, special),
          ...(this.callbacks.onOptionalChange === undefined
            ? {}
            : {
                optional: (issue: PageIssue, optional: boolean) => {
                  if (issue.columnName !== null) this.callbacks.onOptionalChange?.(issue.columnName, optional);
                },
              }),
          groupGain: (list) => this.groupGain(score, list),
          ...(this.callbacks.onFill === undefined
            ? {}
            : {
                fillChoices: (issue: PageIssue) => (issue.column === null ? [] : (this.callbacks.fillChoices?.(issue.column) ?? [])),
                fill: (issue: PageIssue, choice: string) => {
                  if (issue.column !== null) this.callbacks.onFill?.(issue.column, choice);
                },
              }),
          ...(this.callbacks.onDedupe === undefined
            ? {}
            : {
                dedupe: (issue: PageIssue, keep: "first" | "last") => {
                  if (issue.dedupe !== undefined) this.callbacks.onDedupe?.(issue.dedupe.ignore, keep, issue.dedupe.rows, () => this.callbacks.onShowIssue?.(issue));
                },
              }),
          toggleAll: () => {
            this.showAllIssues = !this.showAllIssues;
            this.render(this.lastInput);
          },
          openChecks: () => this.callbacks.onOpenReport?.("checks"),
          undo: (entry) => this.undoFixed(entry),
        },
      ),
    );
    if (this.advanced !== null) panel.append(this.advanced);
    this.root.append(
      panel,
      el("footer", { class: "qp-footer" }, [
        "Points are what the score gains when an issue is fixed, worked out from the same checks the report scores · Computed locally in your browser",
      ]),
    );
  }

  private select(tab: QualityTab): void {
    this.tab = tab;
    this.render(this.lastInput);
  }

  /** Previews and applies the fixes for these issues, then remembers them under Fixed this session. */
  private async fix(issues: readonly PageIssue[]): Promise<void> {
    if (issues.length === 0 || this.callbacks.onFixIssues === undefined || this.fixing) return;
    // One run at a time: a second press while fixes are still applying does nothing.
    this.fixing = true;
    let outcome: FixOutcome | null;
    try {
      outcome = await this.callbacks.onFixIssues(issues);
    } finally {
      this.fixing = false;
    }
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

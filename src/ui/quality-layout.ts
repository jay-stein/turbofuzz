import { n, percentLabel, plural, pointsLabel } from "../data/dq-copy.js";
import type { ColumnHealth, IssueKind, PageIssue } from "../data/dq-issues.js";
import type { Finding } from "../data/findings.js";
import type { CleanStep } from "../data/dq-baseline.js";
import { clear, el } from "./dom.js";
import { renderDistCompare } from "./dist-compare.js";

/** Tabs on the Data Quality Report. The issues themselves live on the Clean page. */
export type QualityTab = "columns" | "sensitive" | "rules" | "history" | "checks";

export interface FixedEntry {
  id: string;
  title: string;
  points: number | null;
  undo: () => void;
}

export interface RowsAffectedTile {
  count: number;
  total: number;
  /** Set when the share of failing rows is what holds the headline down: the tile says so. */
}

export interface HeroInput {
  overall: number | null;
  band: "good" | "fair" | "poor" | null;
  bandWord: string;
  rowCount: number;
  columnCount: number;
  checkCount: number;
  topWin: PageIssue | null;
  fixCount: number;
  reviewCount: number;
  sensitiveCount: number;
  canFixTop: boolean;
  scopeLine: string;
  /** "Fair because Cabin is 77% empty", or null when the band is just the number. */
  bandReason?: string | null;
  /** Columns whose values the exceptions file masks unless the switch is on. */
  maskedColumns?: number;
  /** The Excel report is being built (it can wait for the sensitive scan): its button shows so and is disabled. */
  excelBusy?: boolean;
}

/** Rows of 9 cards fit at 1440px; beyond two rows the strip collapses behind a toggle. */
const STRIP_COLLAPSED = 18;

/**
 * The Clean page groups issues by what kind of work they are, one card each that opens to its
 * issues: standardising values, junk data, dates, filling the gaps, duplicates, unusual values,
 * and the rest to review. Kinds not listed fall into the last group.
 */
export const ISSUE_GROUPS: readonly { id: string; title: string; about: string; kinds: readonly IssueKind[] }[] = [
  { id: "standardise", title: "Standardise", about: "The same thing written different ways, symbols in numbers, garbled characters", kinds: ["variants", "offFormat", "numberSymbols", "mojibake"] },
  { id: "junk", title: "Junk data", about: "Text where a value should be (N/A, -, ?), values that do not read, and columns with nothing in them", kinds: ["placeholders", "unreadable", "emptyColumn"] },
  { id: "dates", title: "Dates", about: "Mixed date formats, day and month swapped, dates in the wrong order", kinds: ["dateFormat", "dateConflict", "pairOrder"] },
  { id: "empty", title: "Fill the gaps", about: "Empty cells, filled the way you choose for each column", kinds: ["empty"] },
  { id: "duplicates", title: "Duplicates", about: "Repeated rows, the same record under two ids, and ids that should be unique", kinds: ["smartDuplicates", "duplicates", "keyDuplicates"] },
  { id: "unusual", title: "Unusual values", about: "Values outside the range the rest suggest", kinds: ["outOfRange"] },
  { id: "review", title: "To review", about: "Checks that need a judgement call", kinds: ["review", "other"] },
];

type IssueGroup = (typeof ISSUE_GROUPS)[number];

/** Groups opened this session: the page re-renders after every fix, and an open group stays open. */
const openGroups = new Set<string>();
/** Groups the analyst closed: the step to do now opens by itself, unless they closed it. */
const closedGroups = new Set<string>();

/** Issues in their groups, the groups ordered by the most urgent issue in each, then by rows. */
export function groupIssues(issues: readonly PageIssue[]): { group: IssueGroup; issues: PageIssue[] }[] {
  const rank: Record<PageIssue["severity"], number> = { fix: 0, review: 1, info: 2 };
  const last = ISSUE_GROUPS[ISSUE_GROUPS.length - 1]!;
  const byGroup = new Map<string, PageIssue[]>();
  for (const issue of issues) {
    const group = ISSUE_GROUPS.find((entry) => entry.kinds.includes(issue.kind)) ?? last;
    const list = byGroup.get(group.id) ?? [];
    list.push(issue);
    byGroup.set(group.id, list);
  }
  const worst = (list: readonly PageIssue[]): number => Math.min(...list.map((issue) => rank[issue.severity]));
  const rows = (list: readonly PageIssue[]): number => list.reduce((sum, issue) => sum + issue.rows, 0);
  return ISSUE_GROUPS.filter((group) => byGroup.has(group.id))
    .map((group) => ({ group, issues: byGroup.get(group.id)! }))
    .sort((a, b) => worst(a.issues) - worst(b.issues) || rows(b.issues) - rows(a.issues));
}

export function buildHero(
  input: HeroInput,
  actions: {
    fixTop: () => void;
    /** On the report the main button goes to the Clean page instead of fixing in place. */
    openClean?: () => void;
    copy: () => void;
    weights: () => void;
    exceptions?: (includeRaw: boolean) => void;
    html?: () => void;
    /** The formatted Excel report (whole file); the flag is the raw-values switch. */
    excel?: (includeRaw: boolean) => void;
  },
): HTMLElement {
  const hero = el("section", { class: "qp-hero2", "aria-label": "Data quality summary" });
  const ring = el("div", { class: `qp-ring band-${input.band ?? "na"}` });
  if (input.overall !== null) ring.style.setProperty("--qp-fill", `${(input.overall / 100) * 360}deg`);
  ring.append(
    el("div", { class: "qp-ring-inner" }, [
      el("span", { class: "qp-ring-value" }, [input.overall === null ? "n/a" : input.overall.toFixed(1)]),
      el("span", { class: "qp-ring-label" }, ["/ 100"]),
    ]),
  );
  const body = el("div", { class: "qp-hero-body" });
  body.append(
    el("h2", { class: "qp-hero-title" }, [
      "Data quality",
      el("span", { class: `qp-band-chip band-${input.band ?? "na"}` }, [input.bandWord]),
    ]),
    el("p", { class: "qp-hero-line" }, [
      `${n(input.fixCount)} ${plural(input.fixCount, "issue needs", "issues need")} fixing · ${n(input.reviewCount)} worth reviewing · ${n(input.sensitiveCount)} ${plural(input.sensitiveCount, "column", "columns")} possibly sensitive`,
    ]),
  );
  if (input.bandReason !== undefined && input.bandReason !== null) {
    body.append(el("p", { class: "qp-hero-reason" }, [input.bandReason]));
  }
  if (input.topWin !== null && input.topWin.points !== null && input.topWin.points >= 0.1) {
    body.append(
      el("p", { class: "qp-hero-win" }, [
        el("strong", {}, ["Biggest win: "]),
        `${input.topWin.title} → about ${pointsLabel(input.topWin.points).replace("+", "")} on the score`,
      ]),
    );
  }
  body.append(el("p", { class: "qp-hero-scope" }, [input.scopeLine]));

  const buttons = el("div", { class: "qp-hero-actions" });
  const openClean = actions.openClean;
  const toClean = input.fixCount + input.reviewCount;
  const primary = el("button", { class: "primary", type: "button", ...(openClean === undefined ? {} : { "data-qp": "open-clean" }) }, [
    openClean !== undefined
      ? toClean > 0
        ? `Clean ${n(toClean)} ${plural(toClean, "issue", "issues")}`
        : "Open Clean"
      : input.canFixTop
        ? "Fix top 3 issues…"
        : "Nothing to fix automatically",
  ]) as HTMLButtonElement;
  if (openClean !== undefined) {
    primary.title = "Go to the Clean page: every issue grouped by the kind of work, with the points each fix adds";
    primary.addEventListener("click", openClean);
  } else {
    primary.disabled = !input.canFixTop;
    primary.title = input.canFixTop
      ? "Preview the three biggest safe fixes, then apply them as separate undoable steps"
      : "The remaining issues need a decision from you; open the Clean page";
    primary.addEventListener("click", actions.fixTop);
  }
  const copy = el("button", { class: "ghost small", type: "button" }, ["Copy report"]);
  copy.addEventListener("click", actions.copy);
  const weights = el("button", { class: "ghost small", type: "button" }, ["Score & weights"]);
  weights.addEventListener("click", actions.weights);
  const raw = el("input", { type: "checkbox", class: "qp-raw-switch" }) as HTMLInputElement;
  buttons.append(primary);
  const excel = actions.excel;
  if (excel !== undefined) {
    const busy = input.excelBusy === true;
    const excelButton = el("button", { class: "small qp-excel-button", type: "button", "data-qp": "excel-report", "aria-busy": busy ? "true" : "false" }, [
      busy ? "Building Excel report…" : "Excel report ↓",
    ]) as HTMLButtonElement;
    excelButton.disabled = busy;
    excelButton.title = busy
      ? "Building the workbook: it waits for the sensitive-data scan and the repeated-rows count, then downloads"
      : "A formatted workbook of the whole file: summary, columns, findings, checks, failing cells, relationships and sensitive columns";
    excelButton.addEventListener("click", () => excel(raw.checked));
    buttons.append(excelButton);
  }
  buttons.append(copy, weights);
  if (actions.html !== undefined) {
    const html = el("button", { class: "ghost small", type: "button", "data-qp": "html-report" }, ["Download HTML report"]);
    html.title = "One printable page: score, top issues, columns, rules and trend. No values from flagged columns.";
    html.addEventListener("click", actions.html);
    buttons.append(html);
  }
  const exceptions = actions.exceptions;
  if (exceptions !== undefined) {
    const exportButton = el("button", { class: "ghost small", type: "button", "data-qp": "exceptions" }, [
      "Download exceptions CSV",
    ]);
    exportButton.title = "One row per failing cell: row, column, check, value and reason";
    exportButton.addEventListener("click", () => exceptions(raw.checked));
    buttons.append(exportButton);
  }
  if (exceptions !== undefined || excel !== undefined) {
    if ((input.maskedColumns ?? 0) > 0) {
      buttons.append(
        el("label", { class: "qp-raw-label" }, [
          raw,
          ` Include raw values (${n(input.maskedColumns ?? 0)} sensitive ${plural(input.maskedColumns ?? 0, "column is", "columns are")} masked)`,
        ]),
      );
    }
  }
  hero.append(ring, body, buttons);
  return hero;
}

export interface CleanHeroInput {
  overall: number | null;
  band: "good" | "fair" | "poor" | null;
  bandWord: string;
  /** The score of the data as loaded, before any step; null when not known. */
  raw: number | null;
  /** The score if every scored issue still on the page were fixed. */
  potential: number | null;
  bandFair: number;
  bandGood: number;
  fixCount: number;
  reviewCount: number;
  safeCount: number;
  /** The kinds of work as numbered steps, in order (done, now, to come). */
  steps: readonly (CleanStep & { title: string })[];
  /** The step to do now: what it adds and how to start it. */
  next: { id: string; title: string; points: number; dimension: string | null; safe: number } | null;
  /** "Junk data done": the step finished most recently, said once it lands. */
  finished: string | null;
  /** Smart Deduplicate's find, spotlit at the top: rows that repeat once the id is ignored. */
  smart?: { rows: number; ignoredNames: string; points: number | null } | null;
}

/**
 * The top of the Clean page: the score as a bar from the raw load, what cleaning has gained,
 * what is still on the table, then progress and the biggest win next. Every number is the real
 * score; the bar moves as soon as a fix lands, with no staged animation.
 */
export function buildCleanHero(
  input: CleanHeroInput,
  actions: { fixAllSafe: () => void; fixNext: () => void; openNext: () => void; openStep: (id: string) => void; openReport: () => void },
): HTMLElement {
  const root = el("section", { class: "cl-hero", "aria-label": "Cleaning progress" });
  const now = input.overall;
  const raw = input.raw;
  const fmt = (value: number): string => value.toFixed(1);
  const intro = el("div", { class: "cl-intro" }, [
    el("h2", { class: "cl-title" }, ["Clean"]),
    el("p", { class: "cl-sub" }, [
      input.fixCount + input.reviewCount === 0
        ? "Nothing left to fix or review."
        : `${n(input.fixCount)} ${plural(input.fixCount, "issue", "issues")} to fix and ${n(input.reviewCount)} to review, grouped by the kind of work. Every fix is a step you can undo; your file is never changed.`,
    ]),
  ]);
  const meter = el("div", { class: "cl-meter" });
  const head = el("div", { class: "cl-score-row" }, [
    el("span", { class: "cl-score", "data-qp": "clean-score" }, [now === null ? "n/a" : fmt(now)]),
    el("span", { class: "cl-of" }, ["/ 100"]),
    el("span", { class: `qp-band-chip band-${input.band ?? "na"}` }, [input.bandWord]),
  ]);
  const facts: (string | HTMLElement)[] = [];
  if (raw !== null) facts.push("Raw load ", el("b", {}, [fmt(raw)]));
  if (input.potential !== null && now !== null && input.potential - now >= 0.05) {
    if (facts.length > 0) facts.push(" · ");
    facts.push("up to ", el("b", { class: "cl-up" }, [fmt(input.potential)]), " if all cleaned");
  }
  if (facts.length > 0) head.append(el("span", { class: "cl-score-facts" }, facts));
  meter.append(head);
  if (now !== null) {
    const base = raw === null ? now : Math.min(raw, now);
    const gained = raw === null ? 0 : Math.max(0, now - raw);
    const left = input.potential === null ? 0 : Math.max(0, input.potential - now);
    const label = `Score ${fmt(now)}${raw === null ? "" : `, raw load ${fmt(raw)}`}${left >= 0.05 ? `, up to ${fmt(now + left)} if all cleaned` : ""}`;
    const bar = el("div", { class: "cl-bar", role: "img", "aria-label": label });
    const seg = (cls: string, width: number): HTMLElement => {
      const part = el("span", { class: `cl-seg ${cls}` });
      part.style.width = `${Math.max(0, Math.min(100, width))}%`;
      return part;
    };
    bar.append(seg("cl-seg-base", base), seg("cl-seg-gain", gained), seg("cl-seg-left", left));
    for (const [at, name] of [[input.bandFair, "Fair"], [input.bandGood, "Good"]] as const) {
      const tick = el("span", { class: "cl-tick", title: `${name} at ${at}` });
      tick.style.left = `${at}%`;
      bar.append(tick);
    }
    meter.append(
      bar,
      el("div", { class: "cl-legend" }, [
        el("span", {}, [el("i", { class: "cl-key cl-seg-base" }), raw === null ? "Now" : "As loaded"]),
        ...(raw === null ? [] : [el("span", {}, [el("i", { class: "cl-key cl-seg-gain" }), "Gained by cleaning ", el("b", { class: "cl-up" }, [`+${fmt(gained)}`])])]),
        el("span", {}, [el("i", { class: "cl-key cl-seg-left" }), "Still on the table"]),
        el("span", { class: "cl-bands" }, [`Fair at ${input.bandFair} · Good at ${input.bandGood}`]),
      ]),
    );
  }
  root.append(intro, meter);

  const steps = input.steps;
  const doneCount = steps.filter((step) => step.state === "done").length;
  const allDone = steps.length > 0 && doneCount === steps.length;
  if (steps.length > 0) {
    // The kinds of work as numbered steps that hold still: done ones tick off, the one to do now is lit.
    const list = el("ol", { class: "cl-steps", "aria-label": `${n(doneCount)} of ${n(steps.length)} steps done` });
    steps.forEach((step, index) => {
      const sub = step.state === "done" ? (step.total > 0 ? `${n(step.total)} of ${n(step.total)} cleared` : "Cleared") : step.total > step.left ? `${n(step.total - step.left)} of ${n(step.total)} cleared` : `${n(step.left)} to do`;
      const button = el("button", { class: "cl-step-btn", type: "button", "aria-current": step.state === "current" ? "step" : "false" }, [
        el("span", { class: "cl-step-mark", "aria-hidden": "true" }, [step.state === "done" ? "✓" : String(index + 1)]),
        el("span", { class: "cl-step-text" }, [el("span", { class: "cl-step-title" }, [step.title]), el("span", { class: "cl-step-sub" }, [sub])]),
      ]);
      button.addEventListener("click", () => actions.openStep(step.id));
      list.append(el("li", { class: `cl-step ${step.state}`, "data-step": step.id }, [button]));
    });
    root.append(list);
  }
  if (input.finished !== null && !allDone) {
    const on = steps.findIndex((step) => step.state === "current");
    const then = on < 0 ? "" : ` Next: ${steps[on]!.title}.`;
    root.append(el("p", { class: "cl-flash", role: "status", "data-qp": "clean-flash" }, [`✓ ${input.finished} done.${then}`]));
  }
  if (allDone) {
    const gained = raw === null || now === null ? "" : ` Score ${fmt(raw)} at load, ${fmt(now)} now (${now - raw >= 0 ? "+" : ""}${fmt(now - raw)}).`;
    const report = el("button", { class: "primary", type: "button", "data-qp": "open-report" }, ["See the before and after report"]);
    report.addEventListener("click", actions.openReport);
    root.append(
      el("div", { class: "cl-done", role: "status", "data-qp": "clean-done" }, [
        el("span", { class: "cl-done-mark", "aria-hidden": "true" }, ["✓"]),
        el("span", { class: "cl-done-text" }, [el("b", {}, [`All ${n(steps.length)} ${plural(steps.length, "step", "steps")} done. Nice work.`]), gained]),
        report,
      ]),
    );
    return root;
  }

  const smart = input.smart ?? null;
  if (smart !== null && smart.rows > 0) {
    const look = el("button", { class: "ghost outlined", type: "button", "data-qp": "smart-open" }, ["Review and remove…"]);
    look.addEventListener("click", () => actions.openStep("duplicates"));
    root.append(
      el("div", { class: "cl-smart", "data-qp": "smart-spotlight" }, [
        el("span", { class: "smart-badge" }, ["Smart Deduplicate"]),
        el("span", { class: "cl-smart-text" }, [
          el("b", {}, [`${n(smart.rows)} ${plural(smart.rows, "row is", "rows are")} the same record twice.`]),
          ` They match another row on every column except ${smart.ignoredNames}, so an exact-duplicate check never sees them.`,
        ]),
        smart.points !== null && smart.points >= 0.1 ? el("span", { class: "cl-next-pts" }, [pointsLabel(smart.points)]) : "",
        look,
      ]),
    );
  }

  const row = el("div", { class: "cl-progress" });
  if (steps.length > 0) row.append(el("span", { class: "cl-progress-text" }, [`${n(doneCount)} of ${n(steps.length)} ${plural(steps.length, "step", "steps")} done`]));
  row.append(el("span", { class: "cl-spacer" }));
  const report = el("button", { class: "ghost small", type: "button", "data-qp": "open-report" }, ["Before and after report"]);
  report.addEventListener("click", actions.openReport);
  row.append(report);
  if (input.safeCount > 0) {
    const all = el("button", { class: "primary fix-btn", type: "button", "data-qp": "fix-all-safe" }, [`Fix all safe (${n(input.safeCount)})…`]);
    all.title = "Whitespace, case, placeholders and standard formats only. One combined preview; each fix stays its own undoable step.";
    all.addEventListener("click", actions.fixAllSafe);
    row.append(all);
  }
  root.append(row);

  const next = input.next;
  if (next !== null) {
    const button = el("button", { class: next.safe > 0 ? "primary fix-btn" : "ghost outlined", type: "button", "data-qp": "fix-next" }, [
      next.safe > 0 ? `Fix ${n(next.safe)} safe…` : "Open",
    ]);
    button.addEventListener("click", next.safe > 0 ? actions.fixNext : actions.openNext);
    const at = steps.findIndex((step) => step.id === next.id);
    root.append(
      el("div", { class: "cl-next", "data-group": next.id }, [
        el("span", { class: "cl-next-label" }, [at < 0 ? "Next" : `Step ${n(at + 1)} of ${n(steps.length)}`]),
        el("span", { class: "cl-next-title" }, [next.title]),
        next.dimension === null || next.points < 0.1 ? "" : el("span", { class: "cl-next-dim" }, [`lifts ${next.dimension}`]),
        next.points < 0.1 ? "" : el("span", { class: "cl-next-pts" }, [pointsLabel(next.points)]),
        button,
      ]),
    );
  }
  return root;
}

/** Dataset-wide signals under the Clean page's groups: missing-together, drift, near duplicates, text profiles. */
export function buildAdvancedSection(loading: boolean, findings: readonly Finding[], run: (finding: Finding) => void): HTMLElement {
  const section = el("section", { class: "qp-advanced" });
  section.append(
    el("h2", { class: "overview-heading" }, ["Advanced signals"]),
    el("p", { class: "qp-advanced-hint" }, [
      "Missing-together patterns, drift between row halves, near-duplicate values and text profiles. Relationships and functional dependencies live in the Outliers lens.",
    ]),
  );
  if (loading) {
    section.append(el("div", { class: "qp-advanced-empty" }, ["Checking advanced signals…"]));
    return section;
  }
  if (findings.length === 0) {
    section.append(el("div", { class: "qp-advanced-empty" }, ["✓ No additional signals found."]));
    return section;
  }
  for (const finding of findings.slice(0, 12)) {
    const row = el("div", { class: `advanced-finding severity-${finding.severity}` }, [
      el("div", { class: "advanced-finding-body" }, [
        el("span", { class: "advanced-finding-title" }, [finding.title]),
        el("span", { class: "advanced-finding-evidence" }, [finding.evidence.map((entry) => `${entry.metric}: ${entry.value}`).join(" · ")]),
      ]),
    ]);
    if (finding.action !== undefined) {
      const action = el("button", { class: "ghost small", type: "button" }, [finding.fixLabel ?? "Show rows"]);
      action.addEventListener("click", () => run(finding));
      row.append(action);
    }
    section.append(row);
  }
  return section;
}

/** Opens one group on the Clean page (it stays open across re-renders). */
export function openIssueGroup(id: string): void {
  closedGroups.delete(id);
  openGroups.add(id);
}

export function buildTiles(
  input: { fix: number; review: number; sensitive: number | null; rows: RowsAffectedTile | null },
  actions: {
    openIssues: () => void;
    openSensitive: () => void;
    showAffected: () => void;
  },
): HTMLElement {
  const tiles = el("section", { class: "qp-tiles", "aria-label": "Summary" });
  const tile = (
    cls: string,
    value: string,
    label: string,
    sub: string,
    onClick: (() => void) | null,
    title: string,
  ): HTMLElement => {
    const root = el(onClick === null ? "div" : "button", {
      class: `qp-tile ${cls}`,
      ...(onClick === null ? {} : { type: "button" }),
      title,
    });
    root.append(
      el("span", { class: "qp-tile-value" }, [value]),
      el("span", { class: "qp-tile-label" }, [label]),
      el("span", { class: "qp-tile-sub" }, [sub]),
    );
    if (onClick !== null) root.addEventListener("click", onClick);
    return root;
  };
  tiles.append(
    tile("tile-fix", n(input.fix), "Needs fixing", "wrong or inconsistent values", actions.openIssues, "Open the issue list"),
    tile("tile-review", n(input.review), "Worth reviewing", "may be fine, may not", actions.openIssues, "Open the issue list"),
    input.rows === null
      ? tile("tile-rows tile-loading", "…", "Rows affected", "counting", null, "Counting affected rows")
      : tile(
          "tile-rows",
          `${n(input.rows.count)} of ${n(input.rows.total)}`,
          "Rows affected",
          `${percentLabel(input.rows.count, input.rows.total)} · fail at least one check`,
          input.rows.count > 0 ? actions.showAffected : null,
          "Filter the table to the rows that fail a check",
        ),
    tile(
      "tile-sens",
      input.sensitive === null ? "…" : n(input.sensitive),
      "Possibly sensitive",
      "not counted against your score",
      actions.openSensitive,
      "Open the sensitive columns tab",
    ),
  );
  return tiles;
}

export function buildStrip(
  health: readonly ColumnHealth[],
  expanded: boolean,
  actions: { open: (column: number, anchor: HTMLElement) => void; toggle: () => void },
  limit = STRIP_COLLAPSED,
): HTMLElement {
  const section = el("section", { class: "qp-strip-section", "aria-label": "Column health" });
  section.append(
    el("div", { class: "qp-strip-head" }, [
      el("h3", { class: "qp-section-title" }, ["Columns"]),
      el("span", { class: "qp-section-hint" }, ["worst first · click a column to open its profile"]),
    ]),
  );
  const strip = el("div", { class: "qp-strip" });
  const shown = expanded ? health : health.slice(0, limit);
  for (const column of shown) {
    const card = el("button", {
      class: `qp-col ${column.fixRows > 0 ? "col-fix" : column.reviewRows > 0 ? "col-review" : "col-clean"}`,
      type: "button",
      title:
        column.score?.score != null
          ? `Open “${column.name}” · score ${column.score.score.toFixed(0)}: ${column.score.parts
              .map((part) => `${part.label} ${part.rate.toFixed(0)}% × weight ${part.weight}`)
              .join(", ")}`
          : `Open “${column.name}”`,
    }) as HTMLButtonElement;
    const bar = el("span", {
      class: "qp-col-bar",
      role: "img",
      "aria-label": `${column.name}: ${Math.round(column.cleanShare * 100)}% clean`,
    });
    const seg = (cls: string, share: number): HTMLElement => {
      const part = el("span", { class: `seg ${cls}` });
      part.style.flexGrow = String(Math.max(0, share));
      return part;
    };
    bar.append(
      seg("seg-fix", column.fixShare),
      seg("seg-review", column.reviewShare),
      seg("seg-clean", column.cleanShare),
    );
    card.append(
      el("span", { class: "qp-col-top" }, [
        el("span", { class: "qp-col-name" }, [column.name]),
        el("span", { class: "qp-col-score", title: "Column score out of 100" }, [column.score?.score != null ? column.score.score.toFixed(0) : ""]),
      ]),
      el("span", { class: "qp-col-type" }, [column.type]),
      bar,
    );
    const chips = el("span", { class: "qp-col-chips" });
    if (column.chips.length === 0 && !column.sensitive) {
      chips.append(el("span", { class: "qp-col-clean" }, [el("i", { class: "dot" }), "clean"]));
    }
    for (const chip of column.chips) chips.append(el("span", { class: "qp-chip2" }, [chip]));
    if (column.sensitive) chips.append(el("span", { class: "qp-chip2 chip-sens" }, ["personal?"]));
    card.append(chips);
    card.addEventListener("click", () => actions.open(column.column, card));
    strip.append(card);
  }
  section.append(strip);
  if (health.length > limit) {
    const toggle = el("button", { class: "ghost small qp-strip-toggle", type: "button" }, [
      expanded ? "Show fewer columns" : `Show all ${n(health.length)} columns`,
    ]);
    toggle.addEventListener("click", actions.toggle);
    section.append(toggle);
  }
  return section;
}

export function buildTabs(
  active: QualityTab,
  counts: { sensitive: number | null; rules?: number },
  select: (tab: QualityTab) => void,
): HTMLElement {
  const bar = el("div", { class: "qp-tabs", role: "tablist", "aria-label": "Data quality sections" });
  const tabs: { id: QualityTab; label: string }[] = [
    { id: "columns", label: "Columns" },
    { id: "sensitive", label: counts.sensitive === null ? "Sensitive" : `Sensitive ${counts.sensitive}` },
    { id: "rules", label: counts.rules === undefined || counts.rules === 0 ? "Rules" : `Rules ${counts.rules}` },
    { id: "history", label: "History" },
    { id: "checks", label: "All checks" },
  ];
  const buttons: HTMLButtonElement[] = [];
  tabs.forEach((tab, index) => {
    const button = el("button", {
      class: `qp-tab ${tab.id === active ? "active" : ""}`,
      type: "button",
      role: "tab",
      id: `qp-tab-${tab.id}`,
      "aria-selected": tab.id === active ? "true" : "false",
      "aria-controls": "qp-panel",
      tabindex: tab.id === active ? "0" : "-1",
    }, [tab.label]) as HTMLButtonElement;
    button.addEventListener("click", () => select(tab.id));
    button.addEventListener("keydown", (event) => {
      let next = -1;
      if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
      else if (event.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = tabs.length - 1;
      if (next < 0) return;
      event.preventDefault();
      select(tabs[next].id);
      window.setTimeout(() => document.getElementById(`qp-tab-${tabs[next].id}`)?.focus(), 0);
    });
    buttons.push(button);
    bar.append(button);
  });
  return bar;
}

export function buildIssueCard(
  issue: PageIssue,
  options: { primary: boolean },
  actions: {
    fix: (issue: PageIssue) => void;
    show: (issue: PageIssue) => void;
    /** Shows the rows of one side of an issue (day-first or month-first dates). */
    showSide?: (issue: PageIssue, special: "dateDayFirst" | "dateMonthFirst") => void;
    optional?: (issue: PageIssue, optional: boolean) => void;
    dismiss?: (issue: PageIssue) => void;
    /** Open the one-by-one review for an issue that has choices to make. */
    review?: (issue: PageIssue) => void;
    /** The ways to fill an empty-cells issue's column, and filling it one of them. */
    fillChoices?: (issue: PageIssue) => { id: string; label: string; note?: string }[];
    fill?: (issue: PageIssue, choice: string) => void;
    /** Exact points these issues add once their rows pass. */
    groupGain?: (issues: readonly PageIssue[]) => { points: number; dimension: string | null };
    /** Removes an issue's repeated rows, keeping the first or last copy. */
    dedupe?: (issue: PageIssue, keep: "first" | "last") => void;
  },
): HTMLElement {
  const smart = issue.kind === "smartDuplicates";
  const card = el("article", { class: `issue-card sev-${issue.severity}${smart ? " issue-smart" : ""}`, "data-issue": issue.id });
  const head = el("div", { class: "issue-head" }, [
    ...(smart ? [el("span", { class: "smart-badge", title: "Found by comparing every column except the id" }, ["Smart Deduplicate"])] : []),
    el("h4", { class: "issue-title" }, [issue.title]),
  ]);
  if (issue.severity === "fix" && issue.points !== null && issue.points >= 0.1) {
    head.append(el("span", { class: "pts-pill" }, [pointsLabel(issue.points)]));
  }
  const main = el("div", { class: "issue-main" }, [head]);
  if (issue.dist !== null) main.append(renderDistCompare(issue.dist));
  else main.append(el("p", { class: "issue-evidence" }, [issue.evidence]));
  if (issue.dist !== null) main.append(el("p", { class: "issue-evidence" }, [issue.evidence]));
  if (issue.examples.length > 0) {
    main.append(
      el("div", { class: "issue-examples" }, issue.examples.map((value) => el("code", {}, [value]))),
    );
  }
  if (issue.impact !== null) {
    main.append(el("p", { class: "issue-impact" }, [el("strong", {}, ["Impact: "]), issue.impact]));
  }
  const choices = issue.kind === "empty" && actions.fill !== undefined ? (actions.fillChoices?.(issue) ?? []) : [];
  if (choices.length > 0) main.append(buildFillRow(issue, choices, (choice) => actions.fill?.(issue, choice)));
  const buttons = el("div", { class: "issue-actions" });
  const dedupe = issue.dedupe;
  if (dedupe !== undefined && dedupe.rows > 0 && actions.dedupe !== undefined) {
    // Remove the repeats as one undoable step, keeping the first or the last copy of each record.
    const keep = el("select", { class: "issue-keep-select", "data-qp": "dedupe-keep", "aria-label": "Which copy to keep" }, [
      el("option", { value: "first" }, ["Keep the first copy"]),
      el("option", { value: "last" }, ["Keep the last copy"]),
    ]) as HTMLSelectElement;
    const go = el("button", { class: `${options.primary ? "primary btn-primary" : "ghost outlined"} fix-btn`, type: "button", "data-qp": "dedupe" }, [
      `Remove ${n(dedupe.rows)} ${plural(dedupe.rows, "repeat", "repeats")}…`,
    ]);
    go.title = dedupe.ignore.length > 0 ? `Rows are compared on every column except ${dedupe.ignoredNames}. Shows the duplicates first; a Recipe step you can undo.` : "Rows identical in every column. Shows the duplicates first; a Recipe step you can undo.";
    go.addEventListener("click", () => actions.dedupe?.(issue, keep.value as "first" | "last"));
    // The same preview, for looking: each group's copies one after the other, not a filtered table.
    const look = el("button", { class: "ghost outlined", type: "button", "data-qp": "dedupe-look" }, ["See the duplicates"]);
    look.addEventListener("click", () => actions.dedupe?.(issue, keep.value as "first" | "last"));
    buttons.append(go, keep, look);
  }
  if (issue.fixes.length > 0 && issue.fixLabel !== null) {
    const fix = el("button", { class: `${options.primary ? "primary btn-primary" : "ghost outlined"} fix-btn`, type: "button" }, [
      issue.fixLabel,
    ]);
    fix.addEventListener("click", () => actions.fix(issue));
    buttons.append(fix);
  }
  const standardise = issue.fixes.find((step) => step.kind === "standardise");
  if (standardise !== undefined && standardise.kind === "standardise" && standardise.groups !== undefined && actions.review !== undefined) {
    const review = el("button", { class: "ghost outlined", type: "button", "data-qp": "review-spellings" }, ["Review one by one\u2026"]);
    review.title = "Choose which spelling becomes the standard for each group, or leave a group alone";
    review.addEventListener("click", () => actions.review?.(issue));
    buttons.append(review);
  }
  // A dedupe card's preview already shows the rows (and links to all of them in the Table).
  const showable = (issue.check !== undefined || issue.finding !== undefined) && !(dedupe !== undefined && dedupe.rows > 0 && actions.dedupe !== undefined);
  if (showable) {
    const label =
      issue.fixes.length > 0 ? "Show rows" : (issue.fixLabel ?? "Show rows");
    const show = el(
      "button",
      { class: issue.fixes.length > 0 ? "link" : "ghost outlined", type: "button" },
      [label],
    );
    show.addEventListener("click", () => actions.show(issue));
    buttons.append(show);
  }
  for (const side of actions.showSide === undefined ? [] : (issue.sides ?? [])) {
    const showSide = el("button", { class: "link", type: "button", "data-qp": `show-${side.special}` }, [side.label]);
    showSide.addEventListener("click", () => actions.showSide?.(issue, side.special));
    buttons.append(showSide);
  }
  if (issue.check !== undefined && issue.kind !== "empty" && actions.dismiss !== undefined) {
    // Fine rows are not a defect: the score counts them as passing, and the link says by how much.
    // Only on a review item: a fixable card already shows what its fix adds.
    const lift = issue.severity === "review" ? (actions.groupGain?.([issue]).points ?? 0) : 0;
    const ok = el("button", { class: "link", type: "button", "data-qp": "dismiss" }, [lift >= 0.1 ? `Not a problem (${pointsLabel(lift)})` : "Not a problem"]);
    ok.title = "I have looked at these rows and they are fine. They count as passing, so the score goes up; it comes back if more rows are affected.";
    ok.addEventListener("click", () => actions.dismiss?.(issue));
    buttons.append(ok);
  }
  if (issue.kind === "empty" && issue.column !== null && actions.optional !== undefined) {
    const marked = issue.optional === true;
    const toggle = el("button", { class: "link", type: "button" }, [
      marked ? "Mark as required" : "This column is optional",
    ]);
    toggle.addEventListener("click", () => actions.optional?.(issue, !marked));
    buttons.append(toggle);
  }
  card.append(main, buttons);
  return card;
}

/**
 * How to fill one column's empty cells: the methods that suit its type, a Fill button that
 * previews before anything changes, and a line on what the chosen method does.
 */
function buildFillRow(issue: PageIssue, choices: readonly { id: string; label: string; note?: string }[], fill: (choice: string) => void): HTMLElement {
  const id = `fill-${issue.id.replace(/[^a-z0-9_-]/gi, "-")}`;
  const select = el("select", { id, class: "issue-fill-select", "data-qp": "fill-method" }) as HTMLSelectElement;
  for (const choice of choices) select.append(el("option", { value: choice.id }, [choice.label]));
  const note = el("span", { class: "issue-fill-note" });
  const sync = (): void => {
    note.textContent = choices.find((choice) => choice.id === select.value)?.note ?? "";
  };
  select.addEventListener("change", sync);
  sync();
  const go = el("button", { class: "ghost outlined fix-btn", type: "button", "data-qp": "fill" }, ["Fill…"]);
  go.title = "Preview the fill first; it lands in the Recipe as a step you can undo, and filled cells are marked in the Table";
  go.addEventListener("click", () => fill(select.value));
  return el("div", { class: "issue-fill" }, [el("label", { for: id, class: "issue-fill-label" }, ["Fill empty cells with"]), select, go, note]);
}

export function buildIssuesTab(
  issues: readonly PageIssue[],
  fixed: readonly FixedEntry[],
  state: { showAll: boolean; checkCount: number; steps?: readonly CleanStep[] },
  sensitiveBanner: HTMLElement | null,
  actions: {
    fix: (issue: PageIssue) => void;
    show: (issue: PageIssue) => void;
    showSide?: (issue: PageIssue, special: "dateDayFirst" | "dateMonthFirst") => void;
    toggleAll: () => void;
    openChecks: () => void;
    undo: (entry: FixedEntry) => void;
    optional?: (issue: PageIssue, optional: boolean) => void;
    /** Sets an issue aside as reviewed ("not a problem"); omitted when the page cannot remember it. */
    dismiss?: (issue: PageIssue) => void;
    /** Issues set aside earlier, and how to put one back. */
    reviewed?: readonly { id: string; title: string; rows: number }[];
    restore?: (id: string) => void;
    /** Previews and applies every safe fix together; omitted when none is available. */
    applyAllSafe?: () => void;
    /** The same for one group's safe fixes. */
    fixGroup?: (issues: readonly PageIssue[]) => void;
    safeCount?: number;
    review?: (issue: PageIssue) => void;
    /** Exact points a group adds when all of it is fixed, and the dimension it lifts most. */
    groupGain?: (issues: readonly PageIssue[]) => { points: number; dimension: string | null };
    fillChoices?: (issue: PageIssue) => { id: string; label: string; note?: string }[];
    fill?: (issue: PageIssue, choice: string) => void;
    dedupe?: (issue: PageIssue, keep: "first" | "last") => void;
  },
): HTMLElement {
  const root = el("div", { class: "qp-issues" });
  if (sensitiveBanner !== null) root.append(sensitiveBanner);
  if (actions.applyAllSafe !== undefined && (actions.safeCount ?? 0) > 1) {
    const all = el("button", { class: "ghost outlined qp-apply-all", type: "button" }, [
      `Apply all ${n(actions.safeCount ?? 0)} safe fixes…`,
    ]);
    all.title = "Whitespace, case and standard formats only. One combined preview; each fix stays its own undoable step.";
    all.addEventListener("click", actions.applyAllSafe);
    root.append(all);
  }
  if (issues.length === 0) {
    const empty = el("div", { class: "qp-empty-state" }, [
      el("strong", {}, [`No issues found across ${n(state.checkCount)} checks`]),
      el("span", {}, [" — nothing needs fixing or reviewing."]),
    ]);
    const link = el("button", { class: "link", type: "button" }, ["See every check"]);
    link.addEventListener("click", actions.openChecks);
    empty.append(" ", link);
    root.append(empty);
  }
  // One card per kind of work; each opens to its issues. A lone group is open from the start.
  // With steps, groups keep their step order, finished steps stay as a ticked row, and the step to do now is open.
  const steps = state.steps ?? [];
  const place = (id: string): number => {
    const at = steps.findIndex((step) => step.id === id);
    return at < 0 ? steps.length : at;
  };
  const groups = steps.length === 0 ? groupIssues(issues) : groupIssues(issues).sort((a, b) => place(a.group.id) - place(b.group.id));
  const current = steps.find((step) => step.state === "current")?.id;
  if (groups.length > 1) {
    const all = el("button", { class: "ghost small qp-expand-all", type: "button" }, [state.showAll ? "Collapse all" : "Expand all"]);
    all.addEventListener("click", () => {
      openGroups.clear();
      if (state.showAll) for (const entry of groups) closedGroups.add(entry.group.id);
      else closedGroups.clear();
      actions.toggleAll();
    });
    root.append(all);
  }
  // The first fixable issue on the page gets its one solid button.
  const firstFixable = groups.flatMap((entry) => entry.issues).find((issue) => (issue.fixes.length > 0 && issue.fixLabel !== null) || (issue.dedupe !== undefined && actions.dedupe !== undefined))?.id;
  const shown = new Set(groups.map((entry) => entry.group.id));
  const doneRow = (step: CleanStep): HTMLElement | null => {
    const group = ISSUE_GROUPS.find((entry) => entry.id === step.id);
    if (group === undefined || shown.has(step.id)) return null;
    return el("section", { class: "qp-group qp-group-done", "data-group": step.id, "aria-label": `${group.title}: done` }, [
      el("div", { class: "qp-group-done-row" }, [
        el("span", { class: "qp-fixed-check", "aria-hidden": "true" }, ["✓"]),
        el("span", { class: "qp-group-title" }, [group.title]),
        el("span", { class: "qp-group-about" }, [step.total > 0 ? `Done: ${n(step.total)} of ${n(step.total)} cleared` : "Done"]),
      ]),
    ]);
  };
  let stepAt = 0;
  for (const { group, issues: list } of groups) {
    // Finished steps that come before this group, in step order.
    for (; stepAt < steps.length && place(steps[stepAt]!.id) < place(group.id); stepAt++) {
      const row = doneRow(steps[stepAt]!);
      if (row !== null) root.append(row);
    }
    const auto = group.id === current && !closedGroups.has(group.id);
    const open = state.showAll || groups.length === 1 || openGroups.has(group.id) || auto;
    const step = steps.find((entry) => entry.id === group.id);
    root.append(buildIssueGroup(group, list, open, firstFixable, actions, step));
  }
  for (; stepAt < steps.length; stepAt++) {
    const row = doneRow(steps[stepAt]!);
    if (row !== null) root.append(row);
  }
  if (fixed.length > 0) {
    const group = el("section", { class: "qp-fixed", "aria-label": "Fixed this session" }, [
      el("h3", { class: "qp-section-title" }, ["Fixed this session"]),
    ]);
    for (const entry of fixed) {
      const row = el("div", { class: "qp-fixed-row" }, [
        el("span", { class: "qp-fixed-check", "aria-hidden": "true" }, ["✓"]),
        el("span", { class: "qp-fixed-title" }, [entry.title]),
        entry.points !== null && entry.points >= 0.1
          ? el("span", { class: "pts-pill" }, [pointsLabel(entry.points)])
          : "",
      ]);
      const undo = el("button", { class: "ghost small", type: "button" }, ["Undo"]);
      undo.addEventListener("click", () => actions.undo(entry));
      row.append(undo);
      group.append(row);
    }
    root.append(group);
  }
  if (actions.reviewed !== undefined && actions.reviewed.length > 0) {
    const group = el("section", { class: "qp-fixed qp-reviewed", "aria-label": "Reviewed and set aside" }, [
      el("h3", { class: "qp-section-title" }, ["Reviewed and set aside"]),
      el("p", { class: "qp-note" }, ["You looked at these and they are fine, so they are left out of the score. One comes back if more rows are affected."]),
    ]);
    for (const entry of actions.reviewed) {
      const row = el("div", { class: "qp-fixed-row" }, [
        el("span", { class: "qp-fixed-check", "aria-hidden": "true" }, ["\u2713"]),
        el("span", { class: "qp-fixed-title" }, [entry.title]),
      ]);
      const back = el("button", { class: "ghost small", type: "button", "data-qp": "restore" }, ["Put back"]);
      back.addEventListener("click", () => actions.restore?.(entry.id));
      row.append(back);
      group.append(row);
    }
    root.append(group);
  }
  return root;
}

function buildIssueGroup(group: IssueGroup, issues: readonly PageIssue[], open: boolean, firstFixable: string | undefined, actions: Parameters<typeof buildIssuesTab>[4], step?: CleanStep): HTMLElement {
  const count = (severity: PageIssue["severity"]): number => issues.filter((issue) => issue.severity === severity).length;
  const parts = [
    count("fix") > 0 ? `${count("fix")} to fix` : "",
    count("review") > 0 ? `${count("review")} to review` : "",
    count("info") > 0 ? `${count("info")} info` : "",
  ].filter(Boolean);
  const columns = new Set(issues.map((issue) => issue.column).filter((column) => column !== null)).size;
  const gain = actions.groupGain?.(issues) ?? null;
  const points = gain?.points ?? issues.reduce((sum, issue) => sum + (issue.points ?? 0), 0);
  const worst = count("fix") > 0 ? "fix" : count("review") > 0 ? "review" : "info";
  const body = el("div", { class: "qp-group-body", id: `qp-group-${group.id}` });
  const head = el(
    "button",
    { class: "qp-group-head", type: "button", "aria-expanded": String(open), "aria-controls": body.id },
    [
      el("span", { class: "qp-group-chevron", "aria-hidden": "true" }),
      el("span", { class: "qp-group-text" }, [
        el("span", { class: "qp-group-title" }, [group.title, el("span", { class: "qp-group-count" }, [String(issues.length)])]),
        el("span", { class: "qp-group-about" }, [group.about]),
      ]),
      el("span", { class: "qp-group-facts" }, [
        step !== undefined && step.total > step.left
          ? el("span", { class: "qp-group-cleared", "data-qp": "group-cleared" }, [`\u2713 ${n(step.total - step.left)} of ${n(step.total)} cleared`])
          : "",
        el("span", { class: `qp-group-sev sev-${worst}` }, [parts.join(" \u00b7 ")]),
        columns > 0 ? el("span", {}, [`${n(columns)} ${plural(columns, "column", "columns")}`]) : "",
        points >= 0.1
          ? el("span", { class: "qp-group-gain", title: "What the score gains when every issue in this group is fixed" }, [
              el("span", { class: "pts-pill" }, [pointsLabel(points)]),
              gain?.dimension ? el("span", { class: "qp-group-dim" }, [gain.dimension]) : "",
            ])
          : "",
      ]),
    ],
  );
  const bar = el("div", { class: "qp-group-bar" }, [head]);
  // Every safe fix in the group at once, previewed together like Apply all.
  const safe = issues.filter((issue) => issue.batchSafe && issue.fixes.length > 0);
  if (safe.length > 1 && actions.fixGroup !== undefined) {
    const fixAll = el("button", { class: "ghost small qp-group-fix", type: "button" }, [`Fix ${n(safe.length)} safe\u2026`]);
    fixAll.title = "Whitespace, case and standard formats only. One combined preview; each fix stays its own undoable step.";
    fixAll.addEventListener("click", () => actions.fixGroup?.(safe));
    bar.append(fixAll);
  }
  const section = el("section", { class: `qp-group${open ? " open" : ""}`, "data-group": group.id, "aria-label": group.title }, [bar, body]);
  const fill = (): void => {
    if (body.childElementCount > 0) return;
    for (const issue of issues) body.append(buildIssueCard(issue, { primary: issue.id === firstFixable }, actions));
  };
  let shown = open;
  body.hidden = !open;
  if (open) fill();
  head.addEventListener("click", () => {
    const opening = !shown;
    shown = opening;
    if (opening) {
      fill();
      openGroups.add(group.id);
      closedGroups.delete(group.id);
    } else {
      openGroups.delete(group.id);
      closedGroups.add(group.id);
    }
    body.hidden = !opening;
    section.classList.toggle("open", opening);
    head.setAttribute("aria-expanded", String(opening));
  });
  return section;
}

/** A single purple line on the Clean page; the full list lives in the report's Sensitive tab. */
export function buildSensitiveBanner(names: readonly string[], review: () => void): HTMLElement | null {
  if (names.length === 0) return null;
  const shown = names.slice(0, 4).join(", ");
  const more = names.length - 4;
  const banner = el("div", { class: "qp-sens-banner", role: "note" });
  banner.append(
    el("span", { class: "dot", "aria-hidden": "true" }),
    el("strong", {}, [`${n(names.length)} ${plural(names.length, "column", "columns")} possibly sensitive`]),
    el("span", { class: "qp-sens-names" }, [` — ${shown}${more > 0 ? `, +${more} more` : ""}. Not an error, and not counted in your score.`]),
  );
  const link = el("button", { class: "link", type: "button" }, ["Review →"]);
  link.addEventListener("click", review);
  banner.append(link);
  return banner;
}

/** Skeleton shown in a section while its data is still on the way. */
export function buildSkeleton(lines = 3): HTMLElement {
  const root = el("div", { class: "qp-skeleton", "aria-hidden": "true" });
  for (let i = 0; i < lines; i++) root.append(el("span", { class: "sk-line" }));
  return root;
}

export function clearNode(node: HTMLElement): void {
  clear(node);
}

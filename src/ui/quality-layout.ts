import { n, percentLabel, plural, pointsLabel } from "../data/dq-copy.js";
import type { ColumnHealth, PageIssue } from "../data/dq-issues.js";
import { clear, el } from "./dom.js";
import { renderDistCompare } from "./dist-compare.js";

/** Tabs on the Quality page. Rules and History arrive with the rules and history milestone. */
export type QualityTab = "issues" | "columns" | "sensitive" | "rules" | "history" | "checks";

export interface FixedEntry {
  id: string;
  title: string;
  points: number | null;
  undo: () => void;
}

export interface RowsAffectedTile {
  count: number;
  total: number;
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
}

/** Rows of 9 cards fit at 1440px; beyond two rows the strip collapses behind a toggle. */
const STRIP_COLLAPSED = 18;
const ISSUES_COLLAPSED = 5;

export function buildHero(
  input: HeroInput,
  actions: {
    fixTop: () => void;
    copy: () => void;
    download: () => void;
    weights: () => void;
    exceptions?: (includeRaw: boolean) => void;
    html?: () => void;
    supplier?: () => void;
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
  const primary = el("button", { class: "primary", type: "button" }, [
    input.canFixTop ? "Fix top 3 issues…" : "Nothing to fix automatically",
  ]) as HTMLButtonElement;
  primary.disabled = !input.canFixTop;
  primary.title = input.canFixTop
    ? "Preview the three biggest safe fixes, then apply them as separate undoable steps"
    : "The remaining issues need a decision from you; open the Issues tab";
  primary.addEventListener("click", actions.fixTop);
  const copy = el("button", { class: "ghost small", type: "button" }, ["Copy report"]);
  copy.addEventListener("click", actions.copy);
  const download = el("button", { class: "ghost small", type: "button" }, ["Download JSON"]);
  download.addEventListener("click", actions.download);
  const weights = el("button", { class: "ghost small", type: "button" }, ["Score & weights"]);
  weights.addEventListener("click", actions.weights);
  buttons.append(primary, copy, download, weights);
  if (actions.html !== undefined) {
    const html = el("button", { class: "ghost small", type: "button", "data-qp": "html-report" }, ["Download HTML report"]);
    html.title = "One printable page: score, top issues, columns, rules and trend. No values from flagged columns.";
    html.addEventListener("click", actions.html);
    buttons.append(html);
  }
  if (actions.supplier !== undefined) {
    const supplier = el("button", { class: "ghost small", type: "button", "data-qp": "supplier-message" }, ["Copy message for data supplier"]);
    supplier.addEventListener("click", actions.supplier);
    buttons.append(supplier);
  }
  const exceptions = actions.exceptions;
  if (exceptions !== undefined) {
    const raw = el("input", { type: "checkbox", class: "qp-raw-switch" }) as HTMLInputElement;
    const exportButton = el("button", { class: "ghost small", type: "button", "data-qp": "exceptions" }, [
      "Download exceptions CSV",
    ]);
    exportButton.title = "One row per failing cell: row, column, check, value and reason";
    exportButton.addEventListener("click", () => exceptions(raw.checked));
    buttons.append(exportButton);
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
  counts: { issues: number; sensitive: number | null; rules?: number },
  select: (tab: QualityTab) => void,
): HTMLElement {
  const bar = el("div", { class: "qp-tabs", role: "tablist", "aria-label": "Data quality sections" });
  const tabs: { id: QualityTab; label: string }[] = [
    { id: "issues", label: `Issues ${counts.issues}` },
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
    optional?: (issue: PageIssue, optional: boolean) => void;
    /** Open the one-by-one review for an issue that has choices to make. */
    review?: (issue: PageIssue) => void;
  },
): HTMLElement {
  const card = el("article", { class: `issue-card sev-${issue.severity}`, "data-issue": issue.id });
  const head = el("div", { class: "issue-head" }, [el("h4", { class: "issue-title" }, [issue.title])]);
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
  const buttons = el("div", { class: "issue-actions" });
  if (issue.fixes.length > 0 && issue.fixLabel !== null) {
    const fix = el("button", { class: options.primary ? "primary btn-primary" : "ghost outlined", type: "button" }, [
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
  const showable = issue.check !== undefined || issue.finding !== undefined;
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

export function buildIssuesTab(
  issues: readonly PageIssue[],
  fixed: readonly FixedEntry[],
  state: { showAll: boolean; checkCount: number },
  sensitiveBanner: HTMLElement | null,
  actions: {
    fix: (issue: PageIssue) => void;
    show: (issue: PageIssue) => void;
    toggleAll: () => void;
    openChecks: () => void;
    undo: (entry: FixedEntry) => void;
    optional?: (issue: PageIssue, optional: boolean) => void;
    /** Previews and applies every safe fix together; omitted when none is available. */
    applyAllSafe?: () => void;
    safeCount?: number;
    review?: (issue: PageIssue) => void;
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
  const shown = state.showAll ? issues : issues.slice(0, ISSUES_COLLAPSED);
  // The first fixable card gets the page's one solid button.
  const firstFixable = shown.find((issue) => issue.fixes.length > 0 && issue.fixLabel !== null)?.id;
  for (const issue of shown) {
    root.append(buildIssueCard(issue, { primary: issue.id === firstFixable }, actions));
  }
  if (issues.length > shown.length) {
    const rest = issues.slice(shown.length);
    const review = rest.filter((i) => i.severity === "review").length;
    const info = rest.filter((i) => i.severity === "info").length;
    const fix = rest.filter((i) => i.severity === "fix").length;
    const parts = [
      fix > 0 ? `${fix} to fix` : "",
      review > 0 ? `${review} to review` : "",
      info > 0 ? `${info} info` : "",
    ].filter(Boolean);
    const more = el("button", { class: "ghost outlined qp-more", type: "button" }, [
      `Show ${rest.length} more - ${parts.join(", ")}`,
    ]);
    more.addEventListener("click", actions.toggleAll);
    root.append(more);
  } else if (state.showAll && issues.length > ISSUES_COLLAPSED) {
    const less = el("button", { class: "ghost outlined qp-more", type: "button" }, ["Show fewer"]);
    less.addEventListener("click", actions.toggleAll);
    root.append(less);
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
  return root;
}

/** A single purple line on the Issues tab; the full list lives in the Sensitive tab. */
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

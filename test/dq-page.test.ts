import { test } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { ColumnData } from "../src/data/column.js";
import { IMPACT, TITLES, maskToWords, percentLabel, plural, pointsLabel } from "../src/data/dq-copy.js";
import { buildColumnHealth, buildIssues, type PageIssue } from "../src/data/dq-issues.js";
import { computeDQScore, overallIfPassed, pointsIfPassed } from "../src/data/score.js";
import { captureBaseline } from "../src/data/dq-baseline.js";
import type { DatasetStats } from "../src/data/stats.js";
import { QualityPage } from "../src/ui/quality-page.js";
import { groupIssues } from "../src/ui/quality-layout.js";
import { renderDistCompare } from "../src/ui/dist-compare.js";
import { openFixPreview } from "../src/ui/fix-preview-dialog.js";
import type { ColumnMeta } from "../src/worker/protocol.js";

function setupDom(): Window {
  const window = new Window();
  const globals = globalThis as Record<string, unknown>;
  globals.window = window;
  globals.document = window.document;
  globals.HTMLElement = window.HTMLElement;
  globals.MutationObserver = window.MutationObserver;
  return window;
}

const rows = (n: number, make: (i: number) => string): string[] => Array.from({ length: n }, (_, i) => make(i));

function metaOf(column: ColumnData): ColumnMeta {
  return {
    name: column.name,
    type: column.type,
    numberLocale: column.numberLocale,
    dateOrder: column.dateOrder,
    stats: column.stats,
    anomalyCounts: { values: 0, lengths: 0 },
    similarGroups: 0,
    categories: null,
    histogram: null,
    valueFence: null,
    lengthFence: null,
    nullPolicy: { extra: [], keep: [] },
    nullTokens: [...column.nullTokens],
    suggestions: column.suggestions,
    typeDowngrade: column.typeDowngrade,
    conformance: column.conformance,
    semantic: column.semantic,
    variants: column.type === "string" ? column.spellingVariants() : null,
  };
}

const stats = (rowsCount: number): DatasetStats => ({
  duplicateRows: 0, duplicateGroups: 0, rowsInDuplicateGroups: 0, emptyRows: 0, rowsWithNulls: 0,
  totalNullCells: 0, totalCells: rowsCount, valueAnomalyRows: 0, lengthAnomalyRows: 0, computeMs: 1,
});

/** Dataset-B style status: three spellings plus two placeholders. */
function messy(n = 400): ColumnMeta[] {
  const status = ColumnData.create(
    "status",
    rows(n, (i) => (i < 40 ? "N/A" : i < 80 ? "-" : ["ACTIVE", "active", "Active", "pending"][i % 4])),
  );
  // Enough distinct values that status is text (variants are computed for text columns).
  const spread = ColumnData.create("note", rows(n, (i) => `Item ${i}`));
  const id = ColumnData.create("id", rows(n, (i) => String(i)));
  const metas = [id, status, spread].map(metaOf);
  // Variants for a short category column come from its labels in the worker; mirror that here.
  const labels = new Map<string, number>();
  for (const value of status.raw) if (!status.isNull(value)) labels.set(value, (labels.get(value) ?? 0) + 1);
  metas[1] = { ...metas[1], variants: variantsFrom(labels) };
  return metas;
}

import { spellingVariants } from "../src/data/variants.js";
function variantsFrom(labels: Map<string, number>) {
  return spellingVariants([...labels.keys()], [...labels.values()]);
}

test("copy templates handle plurals, zero, rounding and never print undefined", () => {
  assert.equal(pointsLabel(1), "+1 pt");
  assert.equal(pointsLabel(8.34), "+8.3 pts");
  assert.equal(pointsLabel(0.04), "+0 pts");
  assert.equal(percentLabel(0, 100), "0%");
  assert.equal(percentLabel(1, 1000), "<1%");
  assert.equal(percentLabel(1045, 1240), "84%");
  assert.equal(plural(1, "row", "rows"), "row");
  const lines = [
    IMPACT.variants("status", 8, 3),
    IMPACT.placeholders(312, ["N/A", "-"]),
    IMPACT.placeholders(1, ["N/A"]),
    IMPACT.unreadable(1),
    IMPACT.unreadable(56),
    IMPACT.empty(1, 1),
    IMPACT.duplicates(40),
    IMPACT.offFormat(155),
    TITLES.variants("status", 8, 3),
    TITLES.variantsAndPlaceholders("status", 8, 3, 312),
    TITLES.unreadable("age", 1, "Integer"),
  ];
  for (const line of lines) assert.ok(!/undefined|NaN|null/.test(line), line);
  assert.equal(IMPACT.variants("status", 8, 3), "A pivot by “status” shows 8 groups instead of 3.");
  assert.equal(IMPACT.placeholders(1, ["N/A"]), "1 cell says “N/A” instead of being empty.");
  assert.equal(IMPACT.unreadable(1), "1 value is read as text, so sums and charts skip it.");
  assert.equal(TITLES.variantsAndPlaceholders("status", 8, 3, 312), "“status” has 8 spellings of 3 values, plus 312 junk text cells");
});

test("masks are described in words, never shown raw", () => {
  assert.equal(maskToWords("A A"), "letters, a space, letters");
  assert.equal(maskToWords("9-9"), "digits, a dash, digits");
  assert.equal(maskToWords("A@A.A"), "letters, an at sign, letters, a dot, letters");
  assert.equal(maskToWords("A~9"), "letters, “~”, digits");
});

test("one issue list: variants merge with placeholders, fixes first, points on fixes only", () => {
  const metas = messy();
  const score = computeDQScore(metas, stats(400), 400);
  const issues = buildIssues({ score, metas, rowCount: 400, review: [], sensitiveColumns: new Set() });
  const status = issues.find((issue) => issue.id === "variants.1");
  assert.ok(status !== undefined, issues.map((i) => i.id).join(","));
  assert.match(status.title, /“status” has 3 spellings of 1 value, plus 80 junk text cells/);
  assert.equal(status.severity, "fix");
  assert.ok((status.points ?? 0) > 0);
  assert.deepEqual(status.fixes.map((fix) => fix.kind), ["standardise", "placeholders"]);
  assert.equal(status.batchSafe, true);
  assert.equal(issues.filter((i) => i.id.startsWith("placeholders.1")).length, 0, "no second card for the same column");
  // Dist: kept spellings are targets, merged ones variants, placeholders grey.
  const classes = new Set(status.dist?.now.map((row) => row.cls));
  assert.ok(classes.has("target") && classes.has("variant") && classes.has("placeholder"));
  assert.equal(status.dist?.after.find((row) => row.cls === "placeholder")?.count, 80);
  // Ordering: fix before review before info, then by points.
  const severities = issues.map((i) => i.severity);
  assert.deepEqual(severities, [...severities].sort((a, b) => ["fix", "review", "info"].indexOf(a) - ["fix", "review", "info"].indexOf(b)));
  for (const issue of issues) {
    if (issue.severity !== "fix") assert.equal(issue.points, null, issue.id);
    for (const text of [issue.title, issue.evidence, issue.impact ?? ""]) assert.ok(!/undefined/.test(text));
  }
});

test("a refused conversion is a review item with no points, never a fix", () => {
  const raw = rows(1000, (i) => (i < 120 ? "n0pe" : String((i % 5) + 1)));
  const metas = [metaOf(ColumnData.create("Quantity", raw))];
  const score = computeDQScore(metas, stats(1000), 1000);
  const issues = buildIssues({ score, metas, rowCount: 1000, review: [], sensitiveColumns: new Set() });
  const issue = issues.find((i) => i.kind === "unreadable");
  assert.equal(issue?.severity, "review");
  assert.equal(issue?.points, null);
  assert.deepEqual(issue?.fixes, []);
});

test("example values of a possibly sensitive column are masked", () => {
  const raw = rows(300, (i) => (i % 10 === 0 ? `bad@@host${i}.com` : `user${i}@example.com`));
  const column = ColumnData.create("email", raw);
  const metas = [{ ...metaOf(column), pattern: { mask: "A@A.A", share: 0.9, total: 300, offCount: 30, examples: ["bad@@host0.com"] } }];
  const score = computeDQScore(metas, stats(300), 300);
  const plain = buildIssues({ score, metas, rowCount: 300, review: [], sensitiveColumns: new Set() });
  const masked = buildIssues({ score, metas, rowCount: 300, review: [], sensitiveColumns: new Set([0]) });
  assert.equal(plain.find((i) => i.kind === "offFormat")?.examples[0], "bad@@host0.com");
  assert.equal(masked.find((i) => i.kind === "offFormat")?.examples[0], "b***@host0.com");
  assert.match(plain.find((i) => i.kind === "offFormat")?.evidence ?? "", /letters, an at sign/);
});

test("column health: worst first, clean last, at most two chips", () => {
  const metas = messy();
  const score = computeDQScore(metas, stats(400), 400);
  const issues = buildIssues({ score, metas, rowCount: 400, review: [], sensitiveColumns: new Set([1]) });
  const health = buildColumnHealth(metas, issues, 400, new Set([1]));
  assert.equal(health[0].name, "status");
  assert.ok(health[0].fixShare > 0);
  assert.ok(health.at(-1)!.chips.length === 0 || health.at(-1)!.fixRows === 0);
  for (const card of health) assert.ok(card.chips.length + (card.sensitive ? 1 : 0) <= 2, card.name);
  const shares = health.map((card) => card.fixShare + card.reviewShare + card.cleanShare);
  for (const total of shares) assert.ok(Math.abs(total - 1) < 1e-9);
});

test("dist compare caps rows, labels bars for screen readers and never animates", () => {
  const window = setupDom();
  const many = Array.from({ length: 12 }, (_, i) => ({ label: `v${i}`, count: 12 - i, cls: i === 0 ? ("target" as const) : ("variant" as const) }));
  const node = renderDistCompare({ now: many, after: [{ label: "v0", count: 78, cls: "target" }] }) as unknown as HTMLElement;
  void window;
  assert.equal(node.querySelectorAll(".dist-group")[0].querySelectorAll(".dist-row").length, 8);
  assert.match(node.querySelector(".dist-more")?.textContent ?? "", /\+4 more/);
  const labels = [...node.querySelectorAll("[role='img']")].map((bar) => bar.getAttribute("aria-label") ?? "");
  assert.match(labels[1], /v1: 11 rows, will merge into v0/);
  assert.ok(!node.innerHTML.includes("animation"));
});

test("the fix preview applies only what is ticked", async () => {
  const window = setupDom();
  const metas = messy();
  const score = computeDQScore(metas, stats(400), 400);
  const issues = buildIssues({ score, metas, rowCount: 400, review: [], sensitiveColumns: new Set() }).filter((i) => i.fixes.length > 0);
  const result = openFixPreview(issues);
  await new Promise((resolve) => setTimeout(resolve, 0));
  const doc = (globalThis as Record<string, unknown>).document as Window["document"];
  assert.match(doc.querySelector(".fix-preview-lines")?.textContent ?? "", /→/);
  assert.match(doc.querySelector(".cast-summary")?.textContent ?? "", /1 fix/);
  const box = doc.querySelector(".fix-preview-head input") as unknown as { checked: boolean; dispatchEvent(e: unknown): void };
  box.checked = false;
  box.dispatchEvent(new window.Event("change"));
  const apply = doc.querySelector(".fix-preview-modal .primary") as unknown as { disabled: boolean; click(): void };
  assert.equal(apply.disabled, true, "nothing ticked, nothing to apply");
  box.checked = true;
  box.dispatchEvent(new window.Event("change"));
  apply.click();
  assert.deepEqual(await result, [issues[0].id]);
});

function page(callbacks: Partial<ConstructorParameters<typeof QualityPage>[1]> = {}) {
  const window = setupDom();
  const host = window.document.createElement("div");
  const quality = new QualityPage(host as unknown as HTMLElement, {
    onFilter: () => {},
    onExport: () => Promise.resolve(true),
    ...callbacks,
  });
  return { host, quality };
}

function input(metas: ColumnMeta[], issues: PageIssue[], extra: Record<string, unknown> = {}) {
  const n = metas[0].stats.nulls + 400;
  void n;
  return {
    score: computeDQScore(metas, stats(400), 400),
    rowCount: 400,
    stats: stats(400),
    columnNames: metas.map((m) => m.name),
    issues,
    health: buildColumnHealth(metas, issues, 400, new Set()),
    datasetKey: "a",
    ...extra,
  };
}

test("the report's main button goes to the Clean page", () => {
  const metas = messy();
  const score = computeDQScore(metas, stats(400), 400);
  const issues = buildIssues({ score, metas, rowCount: 400, review: [], sensitiveColumns: new Set() });
  let opened = 0;
  const { host, quality } = page({ onOpenClean: () => { opened++; } });
  quality.render(input(metas, issues) as never);
  const primary = host.querySelector(".qp-hero-actions .primary") as unknown as HTMLButtonElement;
  assert.match(primary.textContent ?? "", /^Clean \d+ issues?$/);
  primary.click();
  assert.equal(opened, 1);
  assert.equal(host.querySelector(".issue-card, .qp-group"), null, "the issues live on the Clean page");
});

test("Fix all safe on the Clean page applies via the callback, lists the fix under Fixed this session and undo restores it", async () => {
  const metas = messy();
  const score = computeDQScore(metas, stats(400), 400);
  const issues = buildIssues({ score, metas, rowCount: 400, review: [], sensitiveColumns: new Set() });
  let undone = 0;
  const seen: string[][] = [];
  const { host, quality } = page({
    mode: "clean",
    onFixIssues: async (picked) => {
      seen.push(picked.map((issue) => issue.id));
      return { items: picked.map((issue) => ({ id: issue.id, undo: () => { undone++; } })) };
    },
  });
  quality.render(input(metas, issues) as never);
  const primary = host.querySelector("[data-qp='fix-all-safe']") as unknown as HTMLButtonElement;
  assert.match(primary.textContent ?? "", /Fix all safe \(1\)/);
  primary.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(seen, [["variants.1"]]);
  assert.match(host.querySelector(".qp-fixed")?.textContent ?? "", /Fixed this session/);
  assert.match(host.querySelector(".qp-fixed-row")?.textContent ?? "", /status/);
  (host.querySelector(".qp-fixed-row button") as unknown as HTMLButtonElement).click();
  assert.equal(undone, 1);
  assert.equal(host.querySelector(".qp-fixed"), null, "undo removes it from the fixed list");

  // A new file clears the list.
  quality.render(input(metas, issues, { datasetKey: "b" }) as never);
  assert.equal(host.querySelector(".qp-fixed"), null);
});

test("tabs follow the ARIA pattern and arrow keys move between them", () => {
  const metas = messy();
  const { host, quality } = page();
  quality.render(input(metas, []) as never);
  const tabs = [...host.querySelectorAll("[role='tab']")] as unknown as HTMLButtonElement[];
  assert.equal(host.querySelector("[role='tablist']")?.getAttribute("aria-label"), "Data quality sections");
  assert.equal(tabs.filter((tab) => tab.getAttribute("aria-selected") === "true").length, 1);
  assert.equal(tabs[0].getAttribute("tabindex"), "0");
  assert.equal(tabs[1].getAttribute("tabindex"), "-1");
  assert.equal(host.querySelector("[role='tabpanel']")?.getAttribute("aria-labelledby"), "qp-tab-columns");
  const KeyboardEventCtor = (globalThis as unknown as { window: Window }).window.KeyboardEvent;
  tabs[0].dispatchEvent(new KeyboardEventCtor("keydown", { key: "ArrowRight", bubbles: true }) as unknown as Event);
  const after = [...host.querySelectorAll("[role='tab']")] as unknown as HTMLButtonElement[];
  assert.equal(after[1].getAttribute("aria-selected"), "true");
});

test("clean data shows a calm empty state with a link to every check", () => {
  const column = ColumnData.create("id", rows(300, (i) => String(i)));
  const metas = [metaOf(column)];
  const clean = page({ mode: "clean" });
  clean.quality.render(input(metas, []) as never);
  assert.match(clean.host.querySelector(".qp-empty-state")?.textContent ?? "", /No issues found across \d+ checks/);
  assert.match(clean.host.querySelector(".cl-sub")?.textContent ?? "", /Nothing left to fix or review/);
  assert.equal(clean.host.querySelector("[data-qp='fix-all-safe']"), null);
  const { host, quality } = page({ onOpenClean: () => undefined });
  quality.render(input(metas, []) as never);
  const tiles = [...host.querySelectorAll(".qp-tile-value")].map((node) => node.textContent);
  assert.equal(tiles[0], "0");
  assert.equal(tiles[1], "0");
  const primary = host.querySelector(".qp-hero-actions .primary") as unknown as HTMLButtonElement;
  assert.equal(primary.textContent, "Open Clean");
});

test("issues are grouped by the kind of work, each group a card that opens; the strip collapses after two rows of nine", () => {
  const metas = Array.from({ length: 30 }, (_, i) => metaOf(ColumnData.create(`c${i}`, rows(60, (r) => String(r)))));
  const kinds = ["variants", "variants", "placeholders", "empty", "empty", "empty", "duplicates", "other"] as const;
  const issues: PageIssue[] = kinds.map((kind, i) => ({
    id: `x${i}`, severity: kind === "other" ? "info" : kind === "empty" ? "review" : "fix", kind, column: i, columnName: `c${i}`,
    title: `Issue ${i}`, evidence: "evidence", impact: null, points: kind === "variants" ? 1 : null, examples: [], dist: null,
    fixes: [], fixLabel: null, batchSafe: false, rows: 10 - i,
  }));
  // The report opens on its Columns tab, every column listed.
  const report = page();
  report.quality.render(input(metas, issues) as never);
  assert.equal(report.host.querySelectorAll(".qp-col").length, 30);
  assert.equal(report.host.querySelector(".qp-strip-toggle"), null);
  const { host, quality } = page({ mode: "clean" });
  quality.render(input(metas, issues) as never);
  const groups = [...host.querySelectorAll(".qp-group")].map((node) => node.getAttribute("data-group"));
  // The groups with something to fix first (by rows), then review, then info.
  assert.deepEqual(groups, ["standardise", "junk", "duplicates", "empty", "review"]);
  assert.equal(host.querySelectorAll(".issue-card").length, 0, "every group starts closed");
  const empty = host.querySelector(".qp-group[data-group='empty']")!;
  assert.match(empty.textContent ?? "", /Fill the gaps3/);
  assert.match(empty.textContent ?? "", /3 to review/);
  (empty.querySelector(".qp-group-head") as unknown as HTMLButtonElement).click();
  assert.equal(host.querySelectorAll(".issue-card").length, 3);
  assert.equal(empty.querySelector(".qp-group-head")?.getAttribute("aria-expanded"), "true");
  (host.querySelector(".qp-expand-all") as unknown as HTMLButtonElement).click();
  assert.equal(host.querySelectorAll(".issue-card").length, 8);
  (host.querySelector(".qp-expand-all") as unknown as HTMLButtonElement).click();
  assert.equal(host.querySelectorAll(".issue-card").length, 0);
});

test("the rows-affected tile reads N of TOTAL with a percentage and filters on click", () => {
  const metas = messy();
  let shown = 0;
  const { host, quality } = page({ onShowAffectedRows: () => { shown++; } });
  quality.render(input(metas, [], { rowsAffected: { count: 1045, total: 1240 } }) as never);
  const tile = host.querySelector(".tile-rows") as unknown as HTMLButtonElement;
  assert.match(tile.textContent ?? "", /1,045 of 1,240/);
  assert.match(tile.textContent ?? "", /84%/);
  tile.click();
  assert.equal(shown, 1);
  quality.render(input(metas, [], { rowsAffected: undefined }) as never);
  assert.ok(host.querySelector(".tile-loading"), "a skeleton-style tile while counting");
});

test("no raw masks, internal ids or undefined appear in the visible text", () => {
  const metas = messy();
  const score = computeDQScore(metas, stats(400), 400);
  const issues = buildIssues({ score, metas, rowCount: 400, review: [], sensitiveColumns: new Set() });
  const { host, quality } = page();
  quality.render(input(metas, issues) as never);
  const text = host.textContent ?? "";
  assert.ok(!/undefined|NaN/.test(text));
  assert.ok(!/\bA A\b|\b9-9\b|\bA9\b/.test(text), "no raw character masks");
  assert.ok(!/variants\.\d|consistency\.|validity\./.test(text), "no internal check ids");
});

test("points are exact: with no checks passed the score is unchanged, and fixing a group adds what re-scoring gives", () => {
  const metas = messy();
  const score = computeDQScore(metas, stats(400), 400);
  assert.ok(score.overall !== null);
  assert.ok(Math.abs((overallIfPassed(score, new Set()) ?? 0) - score.overall) < 1e-9);
  const issues = buildIssues({ score, metas, rowCount: 400, review: [], sensitiveColumns: new Set() });
  const ids = new Set(issues.flatMap((issue) => (issue.check === undefined ? [] : [issue.check.id])));
  const gain = pointsIfPassed(score, ids);
  assert.ok(gain > 0);
  assert.ok(Math.abs(score.overall + gain - (overallIfPassed(score, ids) ?? 0)) < 1e-9);
  assert.equal(pointsIfPassed(score, new Set()), 0);
});

test("the Clean page sets the score against the raw load and counts the kinds of work cleaned", () => {
  const metas = messy();
  const score = computeDQScore(metas, stats(400), 400);
  const issues = buildIssues({ score, metas, rowCount: 400, review: [], sensitiveColumns: new Set() });
  const present = groupIssues(issues.filter((issue) => issue.severity !== "info")).map((entry) => entry.group.id);
  assert.ok(present.length > 0);
  const baseline = captureBaseline({ score, metas, rowCount: 400, rowsAffected: 80, duplicateRows: 0, groups: [...present, "duplicates", "dates"], issues: issues.length });
  assert.equal(baseline.columns.length, metas.length);
  assert.equal(baseline.emptyCells, metas.reduce((sum, meta) => sum + meta.stats.nulls, 0));
  const { host, quality } = page({ mode: "clean", onOpenReport: () => undefined });
  quality.render(input(metas, issues, { baseline: { ...baseline, overall: (score.overall ?? 0) - 5 } }) as never);
  assert.match(host.querySelector(".cl-score-facts")?.textContent ?? "", /Raw load \d+\.\d/);
  assert.match(host.querySelector(".cl-legend")?.textContent ?? "", /Gained by cleaning \+5\.0/);
  // Duplicates and dates were found at load and are no longer on the page: two kinds of work done.
  assert.equal(host.querySelector(".cl-progress-text")?.textContent, `2 of ${present.length + 2} kinds of work cleaned`);
  assert.equal(host.querySelectorAll(".cl-dots i.done").length, 2);
  assert.match(host.querySelector(".cl-next")?.textContent ?? "", /Biggest win next/);
  assert.ok(host.querySelector(".cl-bar")?.getAttribute("aria-label")?.startsWith("Score "));
});

test("Fill the gaps offers the fills that suit each column, says what the chosen one does, and fills on request", () => {
  const metas = messy();
  const score = computeDQScore(metas, stats(400), 400);
  const issues = buildIssues({ score, metas, rowCount: 400, review: [], sensitiveColumns: new Set() });
  const filled: [number, string][] = [];
  const { host, quality } = page({
    mode: "clean",
    fillChoices: () => [
      { id: "median", label: "Median", note: "The median fills every gap." },
      { id: "knn", label: "Estimate from similar rows (KNN)…", note: "Estimated from the most similar rows." },
    ],
    onFill: (column, choice) => filled.push([column, choice]),
  });
  const empty: PageIssue = { id: "empty.1", severity: "review", kind: "empty", column: 1, columnName: "spend", title: "“spend” has 10 empty cells", evidence: "10 of 400", impact: null, points: null, examples: [], dist: null, fixes: [], fixLabel: "Review empties", batchSafe: false, rows: 10 };
  quality.render(input(metas, [...issues, empty]) as never);
  (host.querySelector(".qp-group[data-group='empty'] .qp-group-head") as unknown as HTMLButtonElement).click();
  const card = host.querySelector("[data-issue='empty.1']")!;
  const select = card.querySelector("[data-qp='fill-method']") as unknown as HTMLSelectElement;
  assert.deepEqual([...select.querySelectorAll("option")].map((option) => option.textContent), ["Median", "Estimate from similar rows (KNN)…"]);
  assert.equal(card.querySelector(".issue-fill-note")?.textContent, "The median fills every gap.");
  assert.equal(card.querySelector(`label[for='${select.id}']`)?.textContent, "Fill empty cells with");
  select.value = "knn";
  select.dispatchEvent(new (globalThis as unknown as { window: Window }).window.Event("change") as unknown as Event);
  assert.equal(card.querySelector(".issue-fill-note")?.textContent, "Estimated from the most similar rows.");
  (card.querySelector("[data-qp='fill']") as unknown as HTMLButtonElement).click();
  assert.deepEqual(filled, [[1, "knn"]]);
});

test("fill choices follow the column type: free text gets no typical value or estimate, identifiers get none", async () => {
  const { cleanFillOptions } = await import("../src/ui/fill-menu.js");
  const ids = (meta: ColumnMeta): string[] => cleanFillOptions(meta).map((option) => option.id);
  const numeric = metaOf(ColumnData.create("spend", rows(50, (i) => (i % 5 === 0 ? "" : String(i * 3)))));
  assert.deepEqual(ids(numeric), ["median", "mean", "zero", "forward", "backward", "knn", "more"]);
  const category = metaOf(ColumnData.create("region", rows(60, (i) => (i % 6 === 0 ? "" : ["North", "South"][i % 2]!))));
  assert.equal(category.type, "category");
  assert.deepEqual(ids(category), ["mode", "unknown", "forward", "backward", "knn", "more"]);
  const text = { ...category, type: "string" as const };
  assert.deepEqual(ids(text), ["unknown", "forward", "backward", "more"]);
  assert.match(cleanFillOptions(text)[0]!.note, /Free text/);
  assert.deepEqual(ids({ ...category, type: "identifier" as const }), []);
});

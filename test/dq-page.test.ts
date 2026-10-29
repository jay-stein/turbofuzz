import { test } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { ColumnData } from "../src/data/column.js";
import { IMPACT, TITLES, maskToWords, percentLabel, plural, pointsLabel } from "../src/data/dq-copy.js";
import { buildColumnHealth, buildIssues, type PageIssue } from "../src/data/dq-issues.js";
import { computeDQScore } from "../src/data/score.js";
import type { DatasetStats } from "../src/data/stats.js";
import { QualityPage } from "../src/ui/quality-page.js";
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
  assert.equal(TITLES.variantsAndPlaceholders("status", 8, 3, 312), "“status” has 8 spellings of 3 values, plus 312 placeholders");
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
  assert.match(status.title, /“status” has 3 spellings of 1 value, plus 80 placeholders/);
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

test("Fix top 3 applies via the callback, lists the fix under Fixed this session and undo restores it", async () => {
  const metas = messy();
  const score = computeDQScore(metas, stats(400), 400);
  const issues = buildIssues({ score, metas, rowCount: 400, review: [], sensitiveColumns: new Set() });
  let undone = 0;
  const seen: string[][] = [];
  const { host, quality } = page({
    onFixIssues: async (picked) => {
      seen.push(picked.map((issue) => issue.id));
      return { items: picked.map((issue) => ({ id: issue.id, undo: () => { undone++; } })) };
    },
  });
  quality.render(input(metas, issues) as never);
  const primary = host.querySelector(".qp-hero-actions .primary") as unknown as HTMLButtonElement;
  assert.equal(primary.disabled, false);
  assert.match(primary.textContent ?? "", /Fix top 3 issues/);
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
  assert.equal(host.querySelector("[role='tabpanel']")?.getAttribute("aria-labelledby"), "qp-tab-issues");
  const KeyboardEventCtor = (globalThis as unknown as { window: Window }).window.KeyboardEvent;
  tabs[0].dispatchEvent(new KeyboardEventCtor("keydown", { key: "ArrowRight", bubbles: true }) as unknown as Event);
  const after = [...host.querySelectorAll("[role='tab']")] as unknown as HTMLButtonElement[];
  assert.equal(after[1].getAttribute("aria-selected"), "true");
});

test("clean data shows a calm empty state with a link to every check", () => {
  const column = ColumnData.create("id", rows(300, (i) => String(i)));
  const metas = [metaOf(column)];
  const { host, quality } = page();
  quality.render(input(metas, []) as never);
  assert.match(host.querySelector(".qp-empty-state")?.textContent ?? "", /No issues found across \d+ checks/);
  const tiles = [...host.querySelectorAll(".qp-tile-value")].map((node) => node.textContent);
  assert.equal(tiles[0], "0");
  assert.equal(tiles[1], "0");
  const primary = host.querySelector(".qp-hero-actions .primary") as unknown as HTMLButtonElement;
  assert.equal(primary.disabled, true);
});

test("issues collapse after five and the strip collapses after two rows of nine", () => {
  const metas = Array.from({ length: 30 }, (_, i) => metaOf(ColumnData.create(`c${i}`, rows(60, (r) => String(r)))));
  const issues: PageIssue[] = Array.from({ length: 8 }, (_, i) => ({
    id: `x${i}`, severity: i < 5 ? "fix" : i < 7 ? "review" : "info", kind: "other", column: i, columnName: `c${i}`,
    title: `Issue ${i}`, evidence: "evidence", impact: null, points: i < 5 ? 1 : null, examples: [], dist: null,
    fixes: [], fixLabel: null, batchSafe: false, rows: 1,
  }));
  const { host, quality } = page();
  quality.render(input(metas, issues) as never);
  assert.equal(host.querySelectorAll(".issue-card").length, 5);
  assert.match(host.querySelector(".qp-more")?.textContent ?? "", /Show 3 more - 2 to review, 1 info/);
  assert.equal(host.querySelectorAll(".qp-col").length, 18);
  (host.querySelector(".qp-strip-toggle") as unknown as HTMLButtonElement).click();
  assert.equal(host.querySelectorAll(".qp-col").length, 30);
  (host.querySelector(".qp-more") as unknown as HTMLButtonElement).click();
  assert.equal(host.querySelectorAll(".issue-card").length, 8);
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

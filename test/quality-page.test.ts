import { test } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { computeDQScore } from "../src/data/score.js";
import { QualityPage } from "../src/ui/quality-page.js";
import { buildIssues } from "../src/data/dq-issues.js";
import type { DatasetStats } from "../src/data/stats.js";
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

/** Opens a tab by its label; the page re-renders, so callers re-query afterwards. */
function openTab(host: HTMLElement, label: string): void {
  const tab = ([...host.querySelectorAll("button.qp-tab")] as unknown as HTMLButtonElement[]).find((button) =>
    (button.textContent ?? "").startsWith(label),
  );
  assert.ok(tab !== undefined, `tab ${label}`);
  tab.click();
}

function meta(overrides: Partial<ColumnMeta> = {}): ColumnMeta {
  return {
    name: "col",
    type: "string",
    numberLocale: "dot",
    dateOrder: "dmy",
    stats: {
      nulls: 0,
      distinct: 5,
      samples: [],
      topValues: [],
      min: null,
      max: null,
      mean: null,
      stddev: null,
      minLength: null,
      maxLength: null,
      avgLength: null,
    },
    anomalyCounts: { values: 0, lengths: 0 },
    similarGroups: 0,
    categories: null,
    histogram: null,
    valueFence: null,
    lengthFence: null,
    nullPolicy: { extra: [], keep: [] },
    nullTokens: [],
    suggestions: [],
    ...overrides,
  };
}

function stats(overrides: Partial<DatasetStats> = {}): DatasetStats {
  return {
    duplicateRows: 0,
    duplicateGroups: 0,
    rowsInDuplicateGroups: 0,
    emptyRows: 0,
    rowsWithNulls: 0,
    totalNullCells: 0,
    totalCells: 400,
    valueAnomalyRows: 0,
    lengthAnomalyRows: 0,
    computeMs: 1,
    ...overrides,
  };
}

test("the Data Quality page shows the score, tiles, strip and the checks behind them", () => {
  const window = setupDom();
  const columns = [
    meta({ name: "city" }),
    meta({ name: "email", stats: { ...meta().stats, nulls: 50 } }),
    meta({
      name: "score",
      type: "integer",
      suggestions: [
        { kind: "typeConflict", count: 20, sampled: 100, example: "high", columnType: "integer" },
      ],
    }),
  ];
  const score = computeDQScore(columns, stats(), 100);
  const host = window.document.createElement("div");
  const filters: string[] = [];
  const page = new QualityPage(host as unknown as HTMLElement, {
    onFilter: (check) => filters.push(check.id),
    onExport: () => Promise.resolve(true),
  });
  page.render({
    score,
    rowCount: 100,
    stats: stats(),
    columnNames: ["city", "email", "score"],
  });

  const ring = host.querySelector(".qp-ring-value")?.textContent ?? "";
  assert.match(ring, /^\d+\.\d$/, "the ring shows the overall score");
  assert.equal(host.querySelectorAll(".qp-tile").length, 4, "four summary tiles");
  assert.equal(
    host.querySelector(".qp-hero-scope")?.textContent,
    "Whole dataset (100 rows)",
    "the page states its row scope",
  );
  assert.match(host.querySelector(".qp-footer")?.textContent ?? "", /No data leaves this tab/);

  openTab(host as unknown as HTMLElement, "All checks");
  assert.ok(host.querySelectorAll(".qp-dim").length === 6, "one card per dimension");
  const explanation = host.querySelector(".qp-explain")?.textContent ?? "";
  assert.match(explanation, /Completeness/);
  assert.match(explanation, /Adjust weights/);
  const contributions = [...explanation.matchAll(/\+(\d+\.\d)/g)].map((match) => Number(match[1]));
  const contributionTotal = contributions.reduce((sum, value) => sum + value, 0);
  assert.ok(
    Math.abs(contributionTotal - Number(ring)) < 0.15,
    `contributions ${contributionTotal} add up to ${ring}`,
  );
  const matrixTitle = [...host.querySelectorAll(".qp-section-title")].find((title) =>
    (title.textContent ?? "").includes("by column"),
  );
  assert.match(matrixTitle?.textContent ?? "", /Completeness & Validity by column/);

  // Dimension card click filters the checks list down to that dimension.
  const dims = [...host.querySelectorAll(".qp-dim")] as unknown as { click(): void; textContent: string }[];
  const completeness = dims.find((card) => (card.textContent ?? "").startsWith("Completeness"));
  assert.ok(completeness !== undefined);
  completeness.click();
  const sectionHints = [...host.querySelectorAll(".qp-section-hint")].map(
    (node) => node.textContent ?? "",
  );
  assert.ok(
    sectionHints.some((hint) => hint.includes("completeness")),
    "the checks section says which dimension it shows",
  );

  // A matrix cell click reports its check too (email completeness → nulls).
  const cells = host.querySelectorAll(".quality-matrix-table button.quality-cell");
  assert.ok(cells.length >= 6, "matrix cells for every column");
  (cells[2] as unknown as { click(): void }).click();
  assert.ok(filters.length >= 1, "matrix cells filter their failures");
});

test("show only issues hides passing checks and matrix rows", () => {
  const window = setupDom();
  const columns = [meta({ name: "clean" }), meta({ name: "dirty", stats: { ...meta().stats, nulls: 5 } })];
  const score = computeDQScore(columns, stats(), 100);
  const host = window.document.createElement("div");
  const page = new QualityPage(host as unknown as HTMLElement, {
    onFilter: () => {},
    onExport: () => Promise.resolve(true),
  });
  page.render({ score, rowCount: 100, stats: stats(), columnNames: ["clean", "dirty"] });
  openTab(host as unknown as HTMLElement, "All checks");

  const rowsBefore = host.querySelectorAll(".qp-check:not(.qp-check-head)").length;
  assert.equal(rowsBefore, 2 + 2 + 1, "two completeness + two validity + uniqueness rows");

  const toggle = ([...host.querySelectorAll(".qp-actions button")] as unknown as {
    textContent: string;
    click(): void;
  }[]).find((button) => (button.textContent ?? "").includes("Show only issues"));
  assert.ok(toggle !== undefined);
  toggle.click();

  const rowsAfter = host.querySelectorAll(".qp-check:not(.qp-check-head)").length;
  assert.equal(rowsAfter, 1, "only the failing email-style check stays");
  const matrixRows = host.querySelectorAll(".quality-matrix-table tr").length;
  assert.equal(matrixRows, 2, "header + the dirty column only");
});

test("filtered table scope is shown separately from the dataset scope", () => {
  const window = setupDom();
  const columns = [meta({ name: "city" })];
  const score = computeDQScore(columns, stats(), 100);
  const host = window.document.createElement("div");
  const page = new QualityPage(host as unknown as HTMLElement, {
    onFilter: () => {},
    onExport: () => Promise.resolve(true),
  });
  page.render({
    score,
    rowCount: 100,
    visibleRowCount: 40,
    stats: stats(),
    columnNames: ["city"],
  });
  assert.match(
    host.querySelector(".qp-hero-scope")?.textContent ?? "",
    /Whole dataset \(100 rows\).*Current rows: 40 of 100/,
  );
});

test("the empty Data Quality state explains the six dimensions", () => {
  const window = setupDom();
  const host = window.document.createElement("div");
  const page = new QualityPage(host as unknown as HTMLElement, {
    onFilter: () => {},
    onExport: () => Promise.resolve(true),
  });
  page.render(null);
  const text = host.textContent ?? "";
  assert.match(text, /Data quality at a glance/);
  for (const dimension of [
    "Completeness",
    "Validity",
    "Uniqueness",
    "Consistency",
    "Timeliness",
    "Accuracy",
  ]) {
    assert.match(text, new RegExp(dimension));
  }
  assert.equal(host.querySelectorAll(".qp-empty-definitions li").length, 6);
});

test("the score explanation link opens the existing settings panel", () => {
  const window = setupDom();
  const host = window.document.createElement("div");
  const page = new QualityPage(host as unknown as HTMLElement, {
    onFilter: () => {},
    onExport: () => Promise.resolve(true),
  });
  page.render({
    score: computeDQScore([meta({ name: "city" })], stats(), 100),
    rowCount: 100,
    stats: stats(),
    columnNames: ["city"],
  });
  openTab(host as unknown as HTMLElement, "All checks");
  assert.ok(
    (host.querySelector(".qp-settings") as unknown as HTMLElement).classList.contains("hidden"),
    "settings start hidden",
  );
  (host.querySelector(".qp-weight-link") as unknown as { click(): void }).click();
  assert.ok(
    !(host.querySelector(".qp-settings") as unknown as HTMLElement).classList.contains("hidden"),
    "the link opens settings",
  );
});

test("an issue card shows the rows behind it and the first fixable card gets the only primary button", () => {
  const window = setupDom();
  const columns = [
    meta({ name: "status", variants: { groups: 1, minorityRows: 30, examples: [{ spellings: [{ value: "Active", count: 60 }, { value: "active", count: 30 }] }], mappings: [{ from: "active", to: "Active", count: 30 }] } }),
    meta({ name: "email", stats: { ...meta().stats, nulls: 50 } }),
  ];
  const score = computeDQScore(columns, stats(), 100);
  const issues = buildIssues({ score, metas: columns, rowCount: 100, review: [], sensitiveColumns: new Set() });
  const host = window.document.createElement("div");
  const shown: string[] = [];
  const page = new QualityPage(host as unknown as HTMLElement, {
    onFilter: () => {},
    onExport: () => Promise.resolve(true),
    onShowIssue: (issue) => shown.push(issue.id),
  });
  page.render({ score, rowCount: 100, stats: stats(), columnNames: ["status", "email"], issues });
  assert.equal(host.querySelectorAll(".issue-card").length, issues.length);
  assert.equal(host.querySelectorAll(".issue-card .btn-primary").length, 1, "one primary in the list");
  const first = host.querySelector(".issue-card") as unknown as HTMLElement;
  assert.match(first.textContent ?? "", /status/);
  assert.match(first.textContent ?? "", /\+\d+(\.\d)? pts/);
  const show = [...first.querySelectorAll("button")].find((b) => (b.textContent ?? "") === "Show rows") as unknown as HTMLButtonElement;
  show.click();
  assert.deepEqual(shown, ["variants.0"]);
});

test("the matrix includes a per-column score", () => {
  const window = setupDom();
  const host = window.document.createElement("div");
  const columns = [meta({ name: "city" }), meta({ name: "postcode" })];
  const page = new QualityPage(host as unknown as HTMLElement, {
    onFilter: () => {},
    onExport: () => Promise.resolve(true),
  });
  page.render({
    score: computeDQScore(columns, stats(), 100),
    rowCount: 100,
    stats: stats(),
    columnNames: ["city", "postcode"],
  });
  openTab(host as unknown as HTMLElement, "All checks");
  const headers = [...host.querySelectorAll(".quality-matrix-table th")].map(
    (cell) => cell.textContent,
  );
  assert.ok(headers.includes("Score"));
  const scores = [...host.querySelectorAll(".quality-matrix-table span.quality-cell")];
  assert.ok(scores.length >= 2);
  assert.match(scores[0]?.textContent ?? "", /^\d+%$/);
});

test("sensitive-pattern and freshness advisories render separately", () => {
  const window = setupDom();
  const host = window.document.createElement("div");
  const columns = [meta({ name: "email" }), meta({ name: "card" }), meta({ name: "when", type: "date" })];
  const page = new QualityPage(host as unknown as HTMLElement, {
    onFilter: () => {},
    onExport: () => Promise.resolve(true),
  });
  page.render({
    score: computeDQScore(columns, stats(), 100),
    rowCount: 100,
    stats: stats(),
    columnNames: ["email", "card", "when"],
    sensitive: [
      {
        column: 0,
        name: "email",
        class: "contact",
        confidence: "high",
        reasons: [{ kind: "value", label: "100% of sampled values look like email addresses" }],
        sampled: 100,
        scanned: 100,
        label: "confidential",
        examples: ["j***@example.com"],
        revealed: ["jane@example.com"],
      },
      {
        column: 1,
        name: "card",
        class: "financial",
        confidence: "medium",
        reasons: [{ kind: "name", label: "the column name contains card" }],
        sampled: 100,
        scanned: 100,
        label: "confidential",
        examples: [],
        revealed: [],
      },
    ],
    sensitiveScanned: true,
    freshness: [{ column: 2, name: "when", latest: Date.UTC(2024, 0, 1) }],
    now: Date.UTC(2024, 0, 11),
  });
  openTab(host as unknown as HTMLElement, "Sensitive");
  const sensitive = host.querySelector(".qp-sensitive")?.textContent ?? "";
  assert.match(sensitive, /Possibly sensitive columns/);
  assert.match(sensitive, /not counted against your score/);
  assert.match(sensitive, /Contact details/);
  assert.match(sensitive, /100% of sampled values look like email addresses/);
  openTab(host as unknown as HTMLElement, "All checks");
  assert.match(host.querySelector(".qp-freshness")?.textContent ?? "", /2024-01-01/);
  assert.match(host.querySelector(".qp-freshness")?.textContent ?? "", /10 days old/);
});

test("a downgrade check converts the column in one click", () => {
  const window = setupDom();
  const columns = [
    meta({
      name: "amount",
      type: "string",
      typeDowngrade: { candidate: "integer", share: 0.94, ok: 94, total: 100, examples: ["TBC"] },
    }),
  ];
  const score = computeDQScore(columns, stats(), 100);
  const host = window.document.createElement("div");
  const converted: string[] = [];
  const page = new QualityPage(host as unknown as HTMLElement, {
    onFilter: () => {},
    onExport: () => Promise.resolve(true),
    onConvert: (column, type) => converted.push(`${column}:${type}`),
  });
  page.render({ score, rowCount: 100, stats: stats(), columnNames: ["amount"] });
  openTab(host as unknown as HTMLElement, "All checks");

  const rows = [...host.querySelectorAll(".qp-check:not(.qp-check-head)")] as unknown as {
    textContent: string;
    querySelector(selector: string): { click(): void } | null;
  }[];
  const row = rows.find((entry) => (entry.textContent ?? "").includes("stored as Text"));
  assert.ok(row !== undefined, "the downgrade check is listed");
  row?.querySelector("button")?.click();
  assert.deepEqual(converted, ["0:integer"], "the action converts, not filters");
});

test("sensitive cards mask examples, reveal on click and report decisions", () => {
  const window = setupDom();
  const host = window.document.createElement("div");
  const changes: unknown[] = [];
  let exact = -1;
  const page = new QualityPage(host as unknown as HTMLElement, {
    onFilter: () => {},
    onExport: () => Promise.resolve(true),
    onSensitiveChange: (card, change) => changes.push([card.name, change]),
    onScanExact: (column) => {
      exact = column;
    },
  });
  page.render({
    score: computeDQScore([meta({ name: "email" })], stats(), 100),
    rowCount: 100,
    stats: stats(),
    columnNames: ["email"],
    sensitive: [
      {
        column: 0,
        name: "email",
        class: "contact",
        confidence: "high",
        reasons: [{ kind: "value", label: "94% of sampled values look like email addresses" }],
        sampled: 5000,
        scanned: 12000,
        label: "confidential",
        examples: ["j***@example.com"],
        revealed: ["jane@example.com"],
      },
    ],
    sensitiveScanned: true,
  });
  openTab(host as unknown as HTMLElement, "Sensitive");
  const example = host.querySelector(".qp-sensitive-example") as unknown as HTMLButtonElement;
  assert.equal(example.textContent, "j***@example.com");
  example.click();
  assert.equal(example.textContent, "jane@example.com");
  example.click();
  assert.equal(example.textContent, "j***@example.com");

  assert.match(host.querySelector(".qp-sensitive-meta")?.textContent ?? "", /5,000 of 12,000 values scanned/);
  const buttons = [...host.querySelectorAll(".qp-sensitive button")] as unknown as HTMLButtonElement[];
  buttons.find((b) => b.textContent === "Scan all values")?.click();
  assert.equal(exact, 0);
  buttons.find((b) => b.textContent === "Not sensitive")?.click();
  buttons.find((b) => b.textContent === "Mark sensitive")?.click();
  const select = host.querySelector(".qp-sensitive-label") as unknown as HTMLSelectElement;
  select.value = "restricted";
  select.dispatchEvent(new window.Event("change") as unknown as Event);
  assert.deepEqual(changes, [
    ["email", { dismissed: true, confirmed: false }],
    ["email", { confirmed: true }],
    ["email", { label: "restricted" }],
  ]);
});

test("dismissed sensitive columns are tucked away and can be restored", () => {
  const window = setupDom();
  const host = window.document.createElement("div");
  const changes: unknown[] = [];
  const page = new QualityPage(host as unknown as HTMLElement, {
    onFilter: () => {},
    onExport: () => Promise.resolve(true),
    onSensitiveChange: (card, change) => changes.push([card.name, change]),
  });
  page.render({
    score: computeDQScore([meta({ name: "email" })], stats(), 100),
    rowCount: 100,
    stats: stats(),
    columnNames: ["email"],
    sensitive: [
      {
        column: 0, name: "email", class: "contact", confidence: "high", dismissed: true,
        reasons: [], sampled: 10, scanned: 10, label: "confidential", examples: [], revealed: [],
      },
    ],
    sensitiveScanned: true,
  });
  openTab(host as unknown as HTMLElement, "Sensitive");
  assert.equal(host.querySelector(".qp-sensitive-card"), null);
  assert.match(host.querySelector(".qp-sensitive")?.textContent ?? "", /1 marked not sensitive/);
  (host.querySelector(".qp-sensitive-hidden button") as unknown as HTMLButtonElement).click();
  assert.deepEqual(changes, [["email", { dismissed: false }]]);
});

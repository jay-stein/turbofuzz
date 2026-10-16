import { test } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { computeDQScore } from "../src/data/score.js";
import { QualityPage } from "../src/ui/quality-page.js";
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

test("the Data Quality page shows the score, dims, fixes and matrix", () => {
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
  assert.ok(host.querySelectorAll(".qp-dim").length === 6, "one card per dimension");
  assert.ok(
    (host.querySelector(".qp-fact-label")?.textContent ?? "").includes("rows"),
    "facts start with rows",
  );

  // What to fix first: the email completeness check (50 of 100 empty) leads —
  // weight 30 over a weight sum of 75 → +20.0 points.
  const firstFix = host.querySelector(".qp-fix .qp-fix-label")?.textContent ?? "";
  assert.match(firstFix, /email/, "the biggest loser ranks first");
  const firstGain = host.querySelector(".qp-fix .qp-fix-gain")?.textContent ?? "";
  assert.match(firstGain, /\+20\.0 pts/);

  const fixButton = host.querySelector(".qp-fix .qp-check-action button, .qp-fix button") as
    | { click(): void }
    | null;
  assert.ok(fixButton !== null, "fix rows carry an action button");
  fixButton?.click();
  assert.ok(filters.length >= 1, "the fix action reports the check");

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
  const cells = host.querySelectorAll(".quality-matrix-table .quality-cell");
  assert.ok(cells.length >= 6, "matrix cells for every column");
  (cells[2] as unknown as { click(): void }).click();
  assert.ok(filters.length >= 2, "matrix cells filter their failures");
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

import { test } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { computeDQScore } from "../src/data/score.js";
import { openQualityPanel } from "../src/ui/quality-panel.js";
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

function stats(): DatasetStats {
  return {
    duplicateRows: 0,
    duplicateGroups: 0,
    rowsInDuplicateGroups: 0,
    emptyRows: 0,
    rowsWithNulls: 0,
    totalNullCells: 0,
    totalCells: 300,
    valueAnomalyRows: 0,
    lengthAnomalyRows: 0,
    computeMs: 1,
  };
}

test("the quality drawer lists dimensions, filters issues and closes", async () => {
  const window = setupDom();
  const columns = [
    meta({ name: "city" }),
    meta({ name: "email", stats: { ...meta().stats, nulls: 20 } }),
    meta({
      name: "score",
      type: "integer",
      suggestions: [
        { kind: "typeConflict", count: 10, sampled: 100, example: "high", columnType: "integer" },
      ],
    }),
  ];
  const score = computeDQScore(columns, stats(), 100);
  const filters: string[] = [];
  const exports: string[] = [];
  openQualityPanel(score, {
    onFilter: (check) => filters.push(check.id),
    onExport: async (kind) => {
      exports.push(kind);
      return true;
    },
  });

  const document = (globalThis as Record<string, unknown>).document as Window["document"];
  assert.equal(document.querySelector(".quality-score")?.textContent, "95.9");
  assert.equal(document.querySelectorAll(".quality-dimension").length, 6);
  assert.match(document.querySelector(".quality-calc")?.textContent ?? "", /Weighted mean/);
  assert.match(
    [...document.querySelectorAll(".quality-note")].map((note) => note.textContent).join(" "),
    /No reference data available/,
  );

  const allChecks = document.querySelectorAll(".quality-check").length;
  assert.ok(allChecks >= 6, "every check row renders by default");

  const toggle = document.querySelector(
    ".quality-drawer input[type=checkbox]",
  ) as unknown as HTMLInputElement;
  toggle.checked = true;
  toggle.dispatchEvent(new window.Event("change") as unknown as Event);
  const visible = [...document.querySelectorAll(".quality-check")].map(
    (row) => row.textContent ?? "",
  );
  assert.ok(visible.some((text) => text.includes("email")), "failing checks stay");
  assert.ok(
    !visible.some((text) => text.includes("city") && text.includes("populated")),
    "clean checks are hidden",
  );

  const first = document.querySelector(".quality-check button") as unknown as { click(): void };
  first.click();
  assert.deepEqual(filters, ["completeness.1"], "the email emptiness filter fires");
  assert.equal(document.querySelector(".modal-overlay"), null, "the drawer closes after filtering");

  openQualityPanel(score, {
    onFilter: (check) => filters.push(check.id),
    onExport: async (kind) => {
      exports.push(kind);
      return true;
    },
  });
  const copyReport = [...document.querySelectorAll(".clean-footer button")].find(
    (button) => button.textContent === "Copy report",
  );
  assert.ok(copyReport !== undefined, "the report export renders");
  (copyReport as unknown as { click(): void }).click();
  await Promise.resolve();
  assert.deepEqual(exports, ["markdown"]);
});

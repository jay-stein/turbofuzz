import { test } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { OutliersPanel, type OutliersPage } from "../src/ui/outliers-panel.js";
import type { DatasetStats } from "../src/data/stats.js";
import type {
  ColumnMeta,
  OutlierAnalysisMessage,
  OutlierMethod,
  OutlierMode,
} from "../src/worker/protocol.js";

function setupDom(): Window {
  const window = new Window();
  const globals = globalThis as Record<string, unknown>;
  globals.window = window;
  globals.document = window.document;
  globals.HTMLElement = window.HTMLElement;
  globals.MutationObserver = window.MutationObserver;
  globals.getComputedStyle = window.getComputedStyle.bind(window);
  return window;
}

function meta(overrides: Partial<ColumnMeta> = {}): ColumnMeta {
  return {
    name: "col",
    type: "number",
    numberLocale: "dot",
    dateOrder: "dmy",
    stats: {
      nulls: 0,
      distinct: 100,
      samples: [],
      topValues: [],
      min: 0,
      max: 100,
      mean: 50,
      stddev: 10,
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
    totalCells: 100,
    valueAnomalyRows: 0,
    lengthAnomalyRows: 0,
    computeMs: 1,
  };
}

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function analysis(
  method: OutlierMethod,
  mode: OutlierMode = "quick",
): OutlierAnalysisMessage {
  return {
    type: "outlierAnalysis",
    requestId: 1,
    method,
    mode,
    labels: ["amount", "score"],
    columns: [0, 1],
    scores: Float32Array.from([0.9, 0.8, 0.2, 0.1]),
    rowIndices: Uint32Array.from([0, 1, 2, 3]),
    threshold: 0.75,
    flagged: 2,
    analyzed: 4,
    excluded: 0,
    sampled: false,
    totalRows: 4,
    projected: false,
    projectionComponents: 0,
    omittedFeatures: 0,
    details: [
      {
        row: 0,
        score: 0.9,
        contributions: [
          { column: 0, label: "amount", value: 900, median: 20, z: 8.2, contribution: 0.7 },
          { column: 1, label: "score", value: 12, median: 10, z: 1.2, contribution: 0.3 },
        ],
        values: ["900", "12"],
      },
    ],
    featureImportance: [
      { column: 0, label: "amount", weight: 1 },
      { column: 1, label: "score", weight: 0.4 },
    ],
    visualRows: Uint32Array.from([0, 1, 2, 3]),
    visualX: Float32Array.from([0, 1, 0.5, 0.4]),
    visualY: Float32Array.from([0, 1, 0.6, 0.3]),
    visualFlagged: Uint8Array.from([1, 1, 0, 0]),
    ms: 12,
  };
}

function buildPanel(
  onShowOutliers: () => void = () => {},
  page: OutliersPage = "outliers",
): { window: Window; host: HTMLElement; panel: OutliersPanel; calls: string[] } {
  const window = setupDom();
  const host = document.createElement("div");
  const calls: string[] = [];
  const panel = new OutliersPanel(host, {
    requestOutlier: (input) => {
      calls.push(`${input.method}:${input.mode}:${input.respectFilters}`);
      return Promise.resolve(analysis(input.method, input.mode));
    },
    requestCorrelation: () =>
      Promise.resolve({

        type: "correlation",
        requestId: 2,
        columns: [0, 1],
        labels: ["amount", "score"],
        ms: 1,
        result: {
          values: Float64Array.from([1, 0.62, 0.62, 1]),
          counts: Uint32Array.from([4, 4, 4, 4]),
        },
      }),
    requestRelationships: () =>
      Promise.resolve({
        type: "relationships",
        requestId: 3,
        ms: 1,
        relationships: [
          {
            kind: "pearson",
            aColumn: 0,
            bColumn: 1,
            aLabel: "amount",
            bLabel: "score",
            effect: 0.62,
            n: 4,
          },
        ],
      }),
    requestDependencies: () =>
      Promise.resolve({
        type: "dependencies",
        requestId: 4,
        ms: 1,
        pairs: [
          {
            determinantColumn: 0,
            dependentColumn: 1,
            determinantLabel: "amount",
            dependentLabel: "score",
            rows: 4,
            violations: 0,
            examples: [],
          },
        ],
      }),
    requestGroupAnomalies: () =>
      Promise.resolve({
        type: "groupAnomalies",
        requestId: 5,
        pairs: [],
        totalFlagged: 0,
        ms: 1,
      }),
    requestSimilarClusters: () =>
      Promise.resolve({
        type: "similarClusters",
        requestId: 6,
        entries: [],
        ms: 1,
      }),
    onShowOutliers,
    onClearOutliers: () => calls.push("clear"),
    onFilterValue: (column, code) => calls.push(`filter:${column}:${code}`),
    onFinding: () => calls.push("finding"),
    onWinsorize: (column, percent) => calls.push(`winsorize:${column}:${percent}`),
    onFlagAnomalies: (column) => calls.push(`flag:${column}`),
    onOpenClean: (column) => calls.push(`clean:${column}`),
  }, page);
  panel.setData(
    [
      meta({ name: "amount" }),
      meta({ name: "score" }),
      meta({
        name: "region",
        type: "category",
        categories: { labels: ["A", "B"], counts: [99, 1] },
      }),
    ],
    stats(),
    100,
    100,
  );
  return { window, host, panel, calls };
}

test("the outliers page offers method cards, features, quick and deep routes", async () => {
  const { host, calls } = buildPanel();
  assert.ok(host.querySelectorAll(".outliers-method").length >= 5);
  assert.ok(host.querySelector(".outliers-features") !== null);
  const quick = [...host.querySelectorAll("button")].find(
    (button) => button.textContent === "Run quick scan",
  ) as HTMLButtonElement;
  quick.click();
  await tick();
  await tick();
  assert.deepEqual(calls, ["isolationForest:quick:true"]);
  assert.match(host.querySelector(".outliers-recipe")?.textContent ?? "", /Isolation Forest/);
  assert.ok(host.querySelector(".outliers-landscape-canvas") !== null);
  assert.ok(host.querySelectorAll(".outliers-row").length === 1);
});

test("deep compute calls the worker with the deep mode", async () => {
  const { host, calls } = buildPanel();
  const deep = [...host.querySelectorAll("button")].find((button) =>
    (button.textContent ?? "").includes("Deep compute"),
  ) as HTMLButtonElement;
  deep.click();
  await tick();
  await tick();
  assert.deepEqual(calls, ["isolationForest:deep:true"]);
  assert.match(host.querySelector(".outliers-recipe")?.textContent ?? "", /Deep compute/);
});

test("showing flagged rows runs the app callback", async () => {
  let shown = 0;
  const { host } = buildPanel(() => {
    shown++;
  });
  const quick = [...host.querySelectorAll("button")].find(
    (button) => button.textContent === "Run quick scan",
  ) as HTMLButtonElement;
  quick.click();
  await tick();
  await tick();
  const show = [...host.querySelectorAll(".outliers-row button, .outliers-actions button")].find(
    (button) => (button.textContent ?? "").includes("Show"),
  ) as HTMLButtonElement | undefined;
  if (show !== undefined) show.click();
  const insight = [...host.querySelectorAll(".outliers-insight.clickable")][0] as
    | HTMLButtonElement
    | undefined;
  insight?.click();
  assert.ok(shown >= 1);
});

test("top outliers explain the likely value and offer quick fixes", async () => {
  const { host, calls } = buildPanel();
  const quick = [...host.querySelectorAll("button")].find(
    (button) => button.textContent === "Run quick scan",
  ) as HTMLButtonElement;
  quick.click();
  await tick();
  await tick();
  const row = host.querySelector(".outliers-row") as HTMLButtonElement;
  assert.match(
    row.textContent ?? "",
    /Likely: amount 900 is far above the typical 20 \(≈45× the typical\)/,
  );
  row.click();
  await tick();
  assert.match(
    host.querySelector(".outliers-detail-likely")?.textContent ?? "",
    /Likely: amount 900/,
  );
  const findButton = (prefix: string): HTMLButtonElement => {
    const button = [...host.querySelectorAll(".outliers-detail button")].find((entry) =>
      (entry.textContent ?? "").startsWith(prefix),
    );
    assert.ok(button !== undefined, `expected a ${prefix} button`);
    return button as HTMLButtonElement;
  };
  findButton("Clip “amount”").click();
  findButton("Flag “amount”").click();
  findButton("Clean “amount”").click();
  assert.deepEqual(calls, [
    "isolationForest:quick:true",
    "winsorize:0:1",
    "flag:0",
    "clean:0",
  ]);
});

test("the relationships page renders a heatmap, ranked associations and dependencies", async () => {
  const { host } = buildPanel(() => {}, "relationships");
  await tick();
  await tick();
  await tick();
  assert.ok(host.querySelector(".outliers-heatmap") !== null);
  assert.match(host.querySelector(".outliers-heatmap")?.textContent ?? "", /amount/);
  assert.ok(host.querySelectorAll(".outliers-association").length >= 1);
  assert.ok(host.querySelector(".outliers-network-canvas") !== null);
  assert.ok(host.querySelectorAll(".outliers-dependency").length >= 1);
  assert.match(host.textContent ?? "", /Correlation heatmap/);
});

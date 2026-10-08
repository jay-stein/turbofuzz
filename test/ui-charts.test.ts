import { test } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { ChartsPanel, type ChartsPanelOptions } from "../src/ui/chart-panel.js";
import type {
  BoxStatsMessage,
  ChartBinsMessage,
  ChartSeriesMessage,
  ColumnMeta,
  CorrelationMessage,
  CrosstabMessage,
} from "../src/worker/protocol.js";

function setupDom(): Window {
  const window = new Window();
  const globals = globalThis as Record<string, unknown>;
  globals.window = window;
  globals.document = window.document;
  globals.HTMLElement = window.HTMLElement;
  globals.getComputedStyle = window.getComputedStyle.bind(window);
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
      min: 0,
      max: 10,
      mean: 5,
      stddev: 1,
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

const bins: ChartBinsMessage = {
  type: "chartBins",
  requestId: 1,
  column: 0,
  median: 5,
  bins: [1, 2, 1],
  overflow: 0,
  above: 0,
  below: 0,
  total: 4,
};

function series(): ChartSeriesMessage {
  return {
    type: "chartSeries",
    requestId: 1,
    xColumn: 0,
    yColumn: 1,
    colorColumn: -1,
    sizeColumn: -1,
    colorLabels: null,
    ms: 1,
    correlation: 0.5,
    result: {
      mode: "points",
      x: Float64Array.from([1, 2]),
      y: Float64Array.from([2, 3]),
      colorValues: null,
      colorCodes: null,
      size: null,
      shown: 2,
      total: 2,
      outside: 0,
      xMin: 0,
      xMax: 3,
      yMin: 0,
      yMax: 4,
      sampled: false,
    },
  };
}

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function boxStats(): BoxStatsMessage {
  return {
    type: "boxStats",
    requestId: 1,
    valueColumn: 0,
    categoryColumn: 2,
    ms: 1,
    result: {
      groups: [
        {
          label: "a",
          count: 3,
          min: 1,
          q1: 1.5,
          median: 2,
          q3: 2.5,
          max: 3,
          whiskerLow: 1,
          whiskerHigh: 3,
          outliers: new Float64Array(0),
          other: false,
        },
        {
          label: "b",
          count: 2,
          min: 4,
          q1: 4.25,
          median: 4.5,
          q3: 4.75,
          max: 5,
          whiskerLow: 4,
          whiskerHigh: 5,
          outliers: new Float64Array([9]),
          other: false,
        },
      ],
      total: 5,
      missing: 0,
    },
  };
}

function crosstab(): CrosstabMessage {
  return {
    type: "crosstab",
    requestId: 1,
    xColumn: 2,
    yColumn: 2,
    ms: 1,
    result: {
      xLabels: ["a", "b"],
      yLabels: ["a", "b"],
      counts: Uint32Array.from([3, 1, 0, 1]),
      total: 5,
    },
  };
}

function correlation(): CorrelationMessage {
  return {
    type: "correlation",
    requestId: 1,
    columns: [0, 1],
    labels: ["age", "score"],
    ms: 1,
    result: {
      values: Float64Array.from([1, 0.5, 0.5, 1]),
      counts: Uint32Array.from([5, 5, 5, 5]),
    },
  };
}

const stubOptions = (): ChartsPanelOptions => ({
  datasetName: () => "test.csv",
  requestBins: () => Promise.resolve(bins),
  requestSeries: () => Promise.resolve(series()),
  requestBoxStats: () => Promise.resolve(boxStats()),
  requestCrosstab: () => Promise.resolve(crosstab()),
  requestCorrelation: () => Promise.resolve(correlation()),
});

test("chart cards draw scatter points and density grids", async () => {
  const window = setupDom();
  const counts = { fillRect: 0, putImageData: 0, fillText: 0 };
  class MockContext {
    font = "";
    fillStyle = "";
    strokeStyle = "";
    lineWidth = 0;
    globalAlpha = 1;
    textAlign = "left";
    textBaseline = "alphabetic";
    imageSmoothingEnabled = true;
    clearRect(): void {}
    setTransform(): void {}
    scale(): void {}
    beginPath(): void {}
    closePath(): void {}
    moveTo(): void {}
    lineTo(): void {}
    stroke(): void {}
    fill(): void {}
    setLineDash(): void {}
    roundRect(): void {}
    strokeRect(): void {
      counts.fillRect++;
    }
    drawImage(): void {}
    fillText(): void {
      counts.fillText++;
    }
    fillRect(): void {
      counts.fillRect++;
    }
    measureText(text: string): { width: number } {
      return { width: text.length * 6 };
    }
    createImageData(width: number, height: number): {
      data: Uint8ClampedArray;
      width: number;
      height: number;
    } {
      return { data: new Uint8ClampedArray(width * height * 4), width, height };
    }
    putImageData(): void {
      counts.putImageData++;
    }
  }
  const proto = window.HTMLCanvasElement.prototype as unknown as {
    getContext(): unknown;
  };
  proto.getContext = (): unknown => new MockContext();

  const host = document.createElement("div");
  const panel = new ChartsPanel(host, {
    ...stubOptions(),
    requestSeries: (input) =>
      Promise.resolve(
        input.mode === "density"
          ? {
              ...series(),
              result: {
                mode: "density" as const,
                counts: Uint32Array.from([1, 2, 0, 3]),
                cols: 2,
                rows: 2,
                xMin: 0,
                xMax: 1,
                yMin: 0,
                yMax: 1,
                total: 6,
                outside: 0,
                max: 3,
              },
            }
          : series(),
      ),
  });
  panel.setColumns([
    meta({ name: "age", type: "integer" }),
    meta({ name: "score", type: "number" }),
    meta({ name: "city", type: "category", categories: { labels: ["a", "b"], counts: [3, 2] } }),
  ]);
  panel.setFiltered({}, {});
  panel.setRowCount(10);
  await tick();

  const kind = host.querySelector<HTMLSelectElement>(".chart-kind");
  assert.ok(kind !== null);
  kind.value = "scatter";
  (kind as unknown as { dispatchEvent(event: unknown): boolean }).dispatchEvent(
    new window.Event("change"),
  );
  await tick();
  assert.ok(counts.fillRect > 0, "scatter points were drawn");

  const mode = host.querySelector<HTMLSelectElement>('select[aria-label="Render mode"]');
  assert.ok(mode !== null);
  mode.value = "density";
  (mode as unknown as { dispatchEvent(event: unknown): boolean }).dispatchEvent(
    new window.Event("change"),
  );
  await tick();
  assert.ok(counts.putImageData > 0, "density grid was drawn");

  const style = host.querySelector<HTMLSelectElement>('select[aria-label="Density style"]');
  assert.ok(style !== null);
  for (const value of ["contours", "heat", "both"]) {
    style.value = value;
    (style as unknown as { dispatchEvent(event: unknown): boolean }).dispatchEvent(
      new window.Event("change"),
    );
    await tick();
  }
  assert.equal(style.value, "both");

  for (const next of ["box", "heatmap", "correlation"] as const) {
    kind.value = next;
    (kind as unknown as { dispatchEvent(event: unknown): boolean }).dispatchEvent(
      new window.Event("change"),
    );
    await tick();
  }
  assert.equal(kind.value, "correlation");
  assert.ok(counts.fillText > 0, "correlation labels were drawn");

  panel.dispose();
});

test("charts panel adds, duplicates and removes independent cards", async () => {
  const window = setupDom();
  const host = document.createElement("div");
  const panel = new ChartsPanel(host, stubOptions());
  panel.setColumns([
    meta({ name: "age", type: "integer", histogram: { bins: [1], min: 0, max: 10, symlog: false, below: 0, above: 0, p05: 0, p95: 10 } }),
    meta({ name: "score", type: "number", histogram: { bins: [1], min: 0, max: 10, symlog: false, below: 0, above: 0, p05: 0, p95: 10 } }),
    meta({ name: "city", type: "category", categories: { labels: ["a", "b"], counts: [3, 2] } }),
  ]);
  panel.setFiltered({}, {});
  panel.setRowCount(10);
  await tick();

  assert.equal(host.querySelectorAll(".chart-card").length, 1);

  const buttons = [...host.querySelectorAll("button")];
  const add = buttons.find((button) => button.textContent?.includes("Add chart"));
  assert.ok(add !== undefined);
  add.click();
  await tick();

  const cards = host.querySelectorAll(".chart-card");
  assert.equal(cards.length, 2);
  const kinds = host.querySelectorAll<HTMLSelectElement>(".chart-kind");
  assert.equal(kinds[0].value, "histogram");
  assert.equal(kinds[1].value, "scatter", "second card defaults to scatter over two numerics");

  const duplicate = [...cards[1].querySelectorAll("button")].find(
    (button) => button.textContent === "Duplicate",
  );
  assert.ok(duplicate !== undefined);
  duplicate.click();
  await tick();
  assert.equal(host.querySelectorAll(".chart-card").length, 3);

  const remove = [...cards[0].querySelectorAll("button")].find(
    (button) => button.textContent === "×",
  );
  assert.ok(remove !== undefined);
  remove.click();
  assert.equal(host.querySelectorAll(".chart-card").length, 2);

  const layout = host.querySelector<HTMLSelectElement>('select[aria-label="Charts per row"]');
  const grid = host.querySelector<HTMLElement>(".charts-grid");
  assert.ok(layout !== null && grid !== null);
  layout.value = "4";
  (layout as unknown as { dispatchEvent(event: unknown): boolean }).dispatchEvent(
    new window.Event("change"),
  );
  assert.equal(grid.dataset.cols, "4");

  const firstKind = host.querySelector<HTMLSelectElement>(".chart-kind");
  assert.ok(firstKind !== null);
  for (const kind of ["line", "bar", "scatter", "density", "histogram"]) {
    firstKind.value = kind;
    (firstKind as unknown as { dispatchEvent(event: unknown): boolean }).dispatchEvent(
      new window.Event("change"),
    );
    await tick();
  }
  assert.equal(firstKind.value, "histogram");

  const mode = host.querySelector<HTMLSelectElement>('select[aria-label="Render mode"]');
  assert.ok(mode !== null);
  mode.value = "points";
  (mode as unknown as { dispatchEvent(event: unknown): boolean }).dispatchEvent(
    new window.Event("change"),
  );
  await tick();

  panel.dispose();
});

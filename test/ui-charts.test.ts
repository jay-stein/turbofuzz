import { test } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import type { ChartBins } from "../src/data/chart-bins.js";
import { ChartsPanel } from "../src/ui/chart-panel.js";
import type { ChartSeriesMessage, ColumnMeta } from "../src/worker/protocol.js";

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

const bins: ChartBins = { bins: [1, 2, 1], overflow: 0, above: 0, below: 0, total: 4 };

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
    datasetName: () => "test.csv",
    requestBins: () => Promise.resolve(bins),
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

  panel.dispose();
});

test("charts panel adds, duplicates and removes independent cards", async () => {
  const window = setupDom();
  const host = document.createElement("div");
  const panel = new ChartsPanel(host, {
    datasetName: () => "test.csv",
    requestBins: () => Promise.resolve(bins),
    requestSeries: () => Promise.resolve(series()),
  });
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

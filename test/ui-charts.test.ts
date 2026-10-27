import { test } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import type { ColumnFilter } from "../src/search/query-engine.js";
import { ChartsPanel, type ChartsPanelOptions } from "../src/ui/chart-panel.js";
import {
  ChartCard,
  cropDensityGrid,
  fitMapView,
  tableFiltersForHitActions,
  type ChartCardConfig,
  type ChartCardOptions,
} from "../src/ui/chart-card.js";
import type { ViewDef } from "../src/data/aggregate.js";
import type { SeriesGrid } from "../src/data/chart-series.js";
import { chartSpecJson } from "../src/ui/chart-spec.js";
import type {
  AggregateMessage,
  BoxStatsMessage,
  ChartBinsMessage,
  PivotMessage,
  ChartSeriesMessage,
  ColumnMeta,
  CorrelationMessage,
  CrosstabMessage,
} from "../src/worker/protocol.js";
import { plainMeasureName } from "../src/ui/chart-utils.js";

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
  requestAggregate: () =>
    Promise.resolve({
      type: "aggregate",
      requestId: 1,
      viewId: "chart-treemap",
      labels: ["a", "b"],
      dimensions: [["a", "b"]],
      dimensionNames: ["city"],
      dimensionIsTime: [false],
      dimensionTimes: [Float64Array.from([Number.NaN, Number.NaN])],
      measures: [Float64Array.from([30, 10])],
      measureNames: ["sum(amount)"],
      totals: Float64Array.from([40]),
      groupCount: 2,
      totalGroups: 2,
      truncated: false,
      partials: null,
      ms: 1,
    }),
  requestTextProfile: () =>
    Promise.resolve({
      type: "textProfile",
      requestId: 1,
      column: 0,
      label: "notes",
      profile: {
        rows: 40,
        characters: 400,
        avgLength: 10,
        totalTokens: 80,
        distinctTerms: 25,
        topTerms: [
          { term: "delivery", count: 12 },
          { term: "late", count: 8 },
        ],
        shapes: {
        email: 2,
        url: 1,
        phone: 0,
        creditCard: 0,
        iban: 0,
        taxFileNumber: 0,
        abn: 0,
        acn: 0,
        governmentId: 0,
        numeric: 0,
        dateLike: 0,
        uppercase: 3,
        hasDigits: 5,
      },
      },
      ms: 1,
    }),
});

const stubCardOptions = (): ChartCardOptions => ({
  ...stubOptions(),
  onRemove: () => {},
  onDuplicate: () => {},
  onExport: () => {},
});

test("chart text stays legible and date labels fit the left margin", () => {
  const window = setupDom();
  const captured: {
    text: string;
    x: number;
    width: number;
    align: string;
    font: string;
    rotated: boolean;
  }[] = [];
  class MockContext {
    font = "";
    fillStyle = "";
    strokeStyle = "";
    lineWidth = 0;
    globalAlpha = 1;
    textAlign = "left";
    textBaseline = "alphabetic";
    imageSmoothingEnabled = true;
    private tx = 0;
    private ty = 0;
    private rotated = false;
    private readonly stack: { tx: number; ty: number; rotated: boolean }[] = [];
    clearRect(): void {}
    setTransform(): void {}
    scale(): void {}
    beginPath(): void {}
    closePath(): void {}
    moveTo(): void {}
    lineTo(): void {}
    arc(): void {}
    rect(): void {}
    clip(): void {}
    stroke(): void {}
    fill(): void {}
    setLineDash(): void {}
    roundRect(): void {}
    strokeRect(): void {}
    fillRect(): void {}
    drawImage(): void {}
    save(): void {
      this.stack.push({ tx: this.tx, ty: this.ty, rotated: this.rotated });
    }
    restore(): void {
      const previous = this.stack.pop();
      if (previous === undefined) return;
      this.tx = previous.tx;
      this.ty = previous.ty;
      this.rotated = previous.rotated;
    }
    translate(x: number, y: number): void {
      this.tx += x;
      this.ty += y;
    }
    rotate(): void {
      this.rotated = true;
    }
    measureText(text: string): { width: number } {
      return { width: String(text).length * 8 };
    }
    fillText(text: string, x: number): void {
      const width = this.measureText(text).width;
      captured.push({
        text: String(text),
        x: x + this.tx,
        width,
        align: this.textAlign,
        font: this.font,
        rotated: this.rotated,
      });
    }
    createImageData(width: number, height: number): {
      data: Uint8ClampedArray;
      width: number;
      height: number;
    } {
      return { data: new Uint8ClampedArray(width * height * 4), width, height };
    }
    getImageData(_x: number, _y: number, width: number, height: number): {
      data: Uint8ClampedArray;
      width: number;
      height: number;
    } {
      return { data: new Uint8ClampedArray(width * height * 4), width, height };
    }
    putImageData(): void {}
    createLinearGradient(): { addColorStop(): void } {
      return { addColorStop(): void {} };
    }
  }
  const proto = window.HTMLCanvasElement.prototype as unknown as {
    getContext(): unknown;
  };
  proto.getContext = (): unknown => new MockContext();

  const columns = [
    meta({ name: "when", type: "date" }),
    meta({
      name: "amount",
      type: "number",
      stats: { ...meta().stats, min: 0, max: 100 },
    }),
  ];
  const renderCard = (presetX: number, presetY: number): typeof captured => {
    const host = document.createElement("div");
    const card = new ChartCard(host, stubCardOptions(), {
      kind: "scatter",
      x: presetX,
      y: presetY,
      title: "T",
    });
    const wrap = host.querySelector(".chart-canvas-wrap") as HTMLElement;
    Object.defineProperty(wrap, "clientWidth", { value: 640, configurable: true });
    captured.length = 0;
    card.setColumns(columns);
    const result = captured.slice();
    card.dispose();
    return result;
  };

  const numericY = renderCard(0, 1);
  const dateY = renderCard(1, 0);

  const titleX = (entries: typeof captured): number =>
    entries.find((entry) => entry.text === "T")?.x ?? -1;
  assert.ok(
    titleX(dateY) > titleX(numericY),
    `date labels should widen the left margin (got ${titleX(dateY)} vs ${titleX(numericY)})`,
  );

  for (const entry of dateY) {
    // The rotated Y axis title reports positions along its own axis.
    if (entry.rotated) continue;
    const left =
      entry.align === "right"
        ? entry.x - entry.width
        : entry.align === "center"
          ? entry.x - entry.width / 2
          : entry.x;
    assert.ok(left >= -0.5, `label ${JSON.stringify(entry.text)} starts at ${left}`);
  }

  const sizes = dateY
    .map((entry) => Number(/([0-9.]+)px/.exec(entry.font)?.[1] ?? 0))
    .filter((size) => size > 0);
  assert.ok(sizes.length > 0);
  assert.ok(Math.min(...sizes) >= 11, `smallest on-screen text was ${Math.min(...sizes)}px`);
});

test("density viewport cropping keeps only visible cells", () => {
  const grid: SeriesGrid = {
    mode: "density",
    counts: Uint32Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]),
    cols: 4,
    rows: 4,
    xMin: 0,
    xMax: 4,
    yMin: 0,
    yMax: 4,
    total: 136,
    outside: 0,
    max: 16,
  };
  const cropped = cropDensityGrid(grid, { xMin: 0, xMax: 2, yMin: 0, yMax: 2 });
  assert.equal(cropped.cols, 2);
  assert.equal(cropped.rows, 2);
  assert.deepEqual([...cropped.counts], [1, 2, 5, 6]);
  assert.equal(cropped.max, 6);
  assert.deepEqual(
    { xMin: cropped.xMin, xMax: cropped.xMax, yMin: cropped.yMin, yMax: cropped.yMax },
    { xMin: 0, xMax: 2, yMin: 0, yMax: 2 },
  );
  assert.equal(cropped.counts.reduce((sum, count) => sum + count, 0), 14);
});

test("chart cards draw scatter points and density grids", async () => {
  const window = setupDom();
  const counts = { fillRect: 0, putImageData: 0, fillText: 0, arc: 0 };
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
    arc(): void {
      counts.arc++;
    }
    rect(): void {}
    clip(): void {}
    stroke(): void {}
    fill(): void {}
    setLineDash(): void {}
    roundRect(): void {}
    strokeRect(): void {
      counts.fillRect++;
    }
    drawImage(): void {}
    save(): void {}
    restore(): void {}
    translate(): void {}
    rotate(): void {}
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
    getImageData(_x: number, _y: number, width: number, height: number): {
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
  panel.addCard({ kind: "scatter", x: 0, y: 1 });
  await tick();

  const kind = host.querySelector<HTMLSelectElement>(".chart-kind");
  assert.ok(kind !== null);
  kind.value = "scatter";
  (kind as unknown as { dispatchEvent(event: unknown): boolean }).dispatchEvent(
    new window.Event("change"),
  );
  await tick();
  assert.ok(
    counts.fillRect > 0 || counts.arc > 0,
    "scatter points were drawn (as circles for small series)",
  );

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

test("preset settings survive construction and column wiring", async () => {
  setupDom();
  const host = document.createElement("div");
  const panel = new ChartsPanel(host, stubOptions());
  panel.setColumns([
    meta({ name: "age", type: "integer" }),
    meta({ name: "score", type: "number" }),
    meta({ name: "price", type: "number" }),
    meta({ name: "city", type: "category", categories: { labels: ["a", "b"], counts: [3, 2] } }),
  ]);
  await tick();

  const scatter = panel.addCard({ kind: "scatter", x: 2, y: 0, title: "Price vs age" });
  const scatterConfig = scatter.getConfig();
  assert.equal(scatterConfig.x, 2, "preset X survives construction");
  assert.equal(scatterConfig.y, 0, "preset Y survives construction");
  assert.equal(scatterConfig.title, "Price vs age");
  assert.equal(
    scatter.root.querySelector<HTMLInputElement>(".chart-title")?.value,
    "Price vs age",
    "title input is initialised from the preset",
  );

  const correlation = panel.addCard({
    kind: "correlation",
    correlationColumns: [1, 2],
    title: "Numeric",
  });
  assert.deepEqual(correlation.getConfig().correlationColumns, [1, 2]);

  const filled = panel.addCard({ kind: "correlation" });
  assert.ok(
    filled.getConfig().correlationColumns.length >= 2,
    "an empty correlation card selects numeric columns by default",
  );

  const duplicated = panel.addCard(filled.getConfig());
  assert.equal(duplicated.getConfig().kind, "correlation");
  assert.deepEqual(duplicated.getConfig().correlationColumns, filled.getConfig().correlationColumns);

  const source = panel.addCard({ kind: "histogram", column: 2, title: "Revenue spread" });
  const copy = panel.addCard(source.getConfig());
  assert.equal(copy.getConfig().column, 2, "duplicate keeps its column");
  assert.equal(copy.getConfig().title, "Revenue spread", "duplicate keeps its title");

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

  assert.equal(host.querySelectorAll(".chart-card").length, 0, "no chart is preloaded");
  panel.addCard({ kind: "bar", column: 2 });

  const buttons = [...host.querySelectorAll("button")];
  const add = buttons.find((button) => button.textContent?.includes("Add chart"));
  assert.ok(add !== undefined);
  add.click();
  await tick();

  const panelEl = host.querySelector(".chart-add-panel");
  assert.ok(panelEl !== null && !panelEl.classList.contains("hidden"), "Add chart opens the builder panel");
  const scatterType = [...host.querySelectorAll(".chart-add-type")].find(
    (chip) => chip.textContent === "Scatter",
  );
  assert.ok(scatterType !== undefined, "the builder offers a Scatter type");
  (scatterType as unknown as { click(): void }).click();
  await tick();
  assert.equal(document.querySelector(".chart-setup-modal"), null, "no modal sits between the click and the chart");
  assert.ok(host.querySelector(".chart-add-panel")?.classList.contains("hidden"), "the panel collapses once the chart exists");

  const cards = host.querySelectorAll(".chart-card");
  assert.equal(cards.length, 2);
  const kinds = host.querySelectorAll<HTMLSelectElement>(".chart-kind");
  assert.equal(kinds[0].value, "scatter", "the new Scatter card goes to the top");
  assert.equal(kinds[1].value, "bar", "city is the best default category");

  const doc = (globalThis as Record<string, unknown>).document as Window["document"];
  const openCardMenu = (card: Element): void => {
    (card.querySelector(".chart-more") as unknown as { click(): void }).click();
  };
  const menuItem = (label: string): { click(): void } => {
    const item = [...doc.querySelectorAll(".context-menu .context-item")].find(
      (button) => button.textContent === label,
    );
    assert.ok(item !== undefined, `expected menu item ${label}`);
    return item as unknown as { click(): void };
  };

  openCardMenu(cards[0]);
  menuItem("Duplicate").click();
  await tick();
  assert.equal(host.querySelectorAll(".chart-card").length, 3);

  openCardMenu(cards[1]);
  menuItem("Remove chart").click();
  const confirmRemove = [...doc.querySelectorAll(".modal .primary")].pop() as unknown as {
    click(): void;
  };
  assert.ok(confirmRemove !== undefined, "removal asks for confirmation");
  confirmRemove.click();
  await tick();
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

function captureMockContext(window: Window, drawn: string[]): void {
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
    arc(): void {}
    rect(): void {}
    clip(): void {}
    stroke(): void {}
    fill(): void {}
    setLineDash(): void {}
    roundRect(): void {}
    strokeRect(): void {}
    fillRect(): void {}
    drawImage(): void {}
    save(): void {}
    restore(): void {}
    translate(): void {}
    rotate(): void {}
    measureText(text: string): { width: number } {
      return { width: String(text).length * 6 };
    }
    fillText(text: string): void {
      drawn.push(String(text));
    }
    createImageData(width: number, height: number): {
      data: Uint8ClampedArray;
      width: number;
      height: number;
    } {
      return { data: new Uint8ClampedArray(width * height * 4), width, height };
    }
    getImageData(_x: number, _y: number, width: number, height: number): {
      data: Uint8ClampedArray;
      width: number;
      height: number;
    } {
      return { data: new Uint8ClampedArray(width * height * 4), width, height };
    }
    putImageData(): void {}
    createLinearGradient(): { addColorStop(): void } {
      return { addColorStop(): void {} };
    }
  }
  const proto = window.HTMLCanvasElement.prototype as unknown as { getContext(): unknown };
  proto.getContext = (): unknown => new MockContext();
}

test("chart canvas carries a generated role=img label", async () => {
  const window = setupDom();
  captureMockContext(window, []);
  const host = document.createElement("div");
  const card = new ChartCard(host, stubCardOptions(), { kind: "bar", column: 0 });
  const wrap = host.querySelector(".chart-canvas-wrap") as HTMLElement;
  Object.defineProperty(wrap, "clientWidth", { value: 640, configurable: true });
  card.setColumns([
    meta({ name: "region", type: "category", categories: { labels: ["Perth", "Sydney"], counts: [10, 5] } }),
  ]);
  await tick();
  const canvas = host.querySelector("canvas") as HTMLCanvasElement;
  assert.equal(canvas.getAttribute("role"), "img");
  assert.match(canvas.getAttribute("aria-label") ?? "", /Count plot of region/);
  card.dispose();
});

test("bar clicks toggle their category through onFilter", async () => {
  const window = setupDom();
  captureMockContext(window, []);
  const applied: [number, ColumnFilter | null][] = [];
  let current: ColumnFilter | null = null;
  const host = document.createElement("div");
  const card = new ChartCard(
    host,
    {
      ...stubCardOptions(),
      onFilter: (column, filter) => {
        applied.push([column, filter]);
        current = filter;
      },
      currentFilter: () => current,
    },
    { kind: "bar", column: 0 },
  );
  const wrap = host.querySelector(".chart-canvas-wrap") as HTMLElement;
  Object.defineProperty(wrap, "clientWidth", { value: 640, configurable: true });
  card.setColumns([
    meta({ name: "region", type: "category", categories: { labels: ["Perth", "Sydney"], counts: [10, 5] } }),
  ]);
  await tick();
  const canvas = host.querySelector("canvas") as HTMLCanvasElement;
  const click = (): void => {
    (canvas as unknown as { dispatchEvent(event: unknown): boolean }).dispatchEvent(
      new window.MouseEvent("click", { clientX: 200, clientY: 200 }),
    );
  };
  click();
  assert.deepEqual(applied, [[0, { kind: "values", selected: [0] }]]);
  click();
  assert.deepEqual(applied[1], [0, null], "clicking the only selected value clears it");
  card.dispose();
});

test("chart menu can filter the table or show rows for the hovered bar", async () => {
  const window = setupDom();
  captureMockContext(window, []);
  const applied: { column: number; filter: ColumnFilter }[][] = [];
  const shown: string[] = [];
  const host = document.createElement("div") as unknown as HTMLElement;
  const card = new ChartCard(
    host,
    {
      ...stubCardOptions(),
      onFilterTable: (filters) => applied.push([...filters]),
      onShowRows: (filters, label) => {
        applied.push([...filters]);
        shown.push(label);
      },
    },
    { kind: "bar", column: 0 },
  );
  const wrap = host.querySelector(".chart-canvas-wrap") as HTMLElement;
  Object.defineProperty(wrap, "clientWidth", { value: 640, configurable: true });
  card.setColumns([
    meta({ name: "region", type: "category", categories: { labels: ["Perth", "Sydney"], counts: [10, 5] } }),
  ]);
  await tick();
  const canvas = host.querySelector("canvas") as HTMLCanvasElement;
  (canvas as unknown as { dispatchEvent(event: unknown): boolean }).dispatchEvent(
    new window.MouseEvent("pointermove", { clientX: 200, clientY: 200 }),
  );
  await new Promise((resolve) => setTimeout(resolve, 60));
  const doc = (globalThis as Record<string, unknown>).document as Window["document"];
  const menuItem = (label: string): { click(): void } => {
    (host.querySelector(".chart-more") as unknown as { click(): void }).click();
    const item = [...doc.querySelectorAll(".context-menu .context-item")].find(
      (button) => button.textContent === label,
    ) as unknown as { click(): void } | undefined;
    assert.ok(item !== undefined, `expected menu item ${label}`);
    return item;
  };
  menuItem("Filter table to selection").click();
  menuItem("Show underlying rows").click();
  assert.equal(applied.length, 2);
  assert.deepEqual(applied[0], [{ column: 0, filter: { kind: "values", selected: [0] } }]);
  assert.deepEqual(applied[1], [{ column: 0, filter: { kind: "values", selected: [0] } }]);
  assert.match(shown[0] ?? "", /Perth/);
  card.dispose();
});
test("hovering a chart fills the role=tooltip element", async () => {
  const window = setupDom();
  captureMockContext(window, []);
  const host = document.createElement("div");
  const card = new ChartCard(host, stubCardOptions(), { kind: "bar", column: 0 });
  const wrap = host.querySelector(".chart-canvas-wrap") as HTMLElement;
  Object.defineProperty(wrap, "clientWidth", { value: 640, configurable: true });
  card.setColumns([
    meta({ name: "region", type: "category", categories: { labels: ["Perth", "Sydney"], counts: [10, 5] } }),
  ]);
  await tick();
  const canvas = host.querySelector("canvas") as HTMLCanvasElement;
  const tooltip = host.querySelector("[role=tooltip]") as HTMLElement;
  assert.ok(tooltip !== null);
  assert.equal(tooltip.classList.contains("hidden"), true, "hidden until hovered");
  (canvas as unknown as { dispatchEvent(event: unknown): boolean }).dispatchEvent(
    new window.MouseEvent("pointermove", { clientX: 200, clientY: 200 }),
  );
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(tooltip.classList.contains("hidden"), false);
  assert.match(tooltip.textContent ?? "", /Perth|Sydney/);
  card.dispose();
});

test("a card with nothing to draw explains itself inside the plot", async () => {
  setupDom();
  const window = (globalThis as Record<string, unknown>).window as Window;
  const drawn: string[] = [];
  captureMockContext(window, drawn);
  const host = document.createElement("div");
  const card = new ChartCard(host, stubCardOptions(), { kind: "histogram", column: -1 });
  const wrap = host.querySelector(".chart-canvas-wrap") as HTMLElement;
  Object.defineProperty(wrap, "clientWidth", { value: 640, configurable: true });
  card.setColumns([meta({ name: "note", type: "string" })]);
  await tick();
  const text = drawn.join(" ");
  assert.match(text, /no numeric, temporal or category columns/);
  assert.match(host.querySelector(".chart-note")?.textContent ?? "", /no numeric, temporal or category/);
  assert.equal(
    host.querySelector(".chart-settings-body")?.classList.contains("hidden"),
    true,
    "settings that cannot apply are hidden",
  );
  card.dispose();
});

test("chart settings live in a Customize drawer next to the canvas", async () => {
  const window = setupDom();
  captureMockContext(window, []);
  const host = document.createElement("div");
  const panel = new ChartsPanel(host, stubOptions());
  panel.setColumns([
    meta({ name: "city", type: "category", categories: { labels: ["a", "b"], counts: [1, 1] } }),
    meta({ name: "amount", type: "number" }),
  ]);
  panel.addCard({ kind: "bar", column: 0 });
  await tick();
  const layout = host.querySelector(".chart-card-layout");
  assert.ok(layout !== null);
  assert.ok(layout.querySelector(".chart-sidebar .chart-kind") !== null, "chart type is in the sidebar");
  assert.ok(layout.querySelector(".chart-card-main .chart-canvas") !== null, "the canvas sits beside it");
  const toggle = host.querySelector<HTMLButtonElement>(".chart-sidebar-toggle");
  assert.ok(toggle !== null);
  assert.equal(toggle.textContent, "Customize", "the drawer is called Customize");
  assert.equal(toggle.getAttribute("aria-expanded"), "false", "settings start closed so the chart keeps the full width");
  toggle.click();
  assert.equal(layout.classList.contains("sidebar-open"), true);
  assert.equal(toggle.getAttribute("aria-expanded"), "true");
  toggle.click();
  assert.equal(layout.classList.contains("sidebar-open"), false);
  assert.equal(layout.classList.contains("sidebar-collapsed"), true);
  panel.dispose();
});

test("an emptied chart grid stays empty through column changes", async () => {
  const window = setupDom();
  captureMockContext(window, []);
  const host = document.createElement("div");
  const panel = new ChartsPanel(host, stubOptions());
  const city = (): ColumnMeta =>
    meta({ name: "city", type: "category", categories: { labels: ["a", "b"], counts: [1, 1] } });
  panel.setColumns([city(), meta({ name: "amount", type: "integer" })]);
  await tick();
  assert.equal(host.querySelectorAll(".chart-card").length, 0);
  panel.addCard({ kind: "bar", column: 0 });
  await tick();
  assert.equal(host.querySelectorAll(".chart-card").length, 1);
  (host.querySelector(".chart-more") as unknown as { click(): void }).click();
  const doc = (globalThis as Record<string, unknown>).document as Window["document"];
  const remove = [...doc.querySelectorAll(".context-menu .context-item")].find(
    (item) => item.textContent === "Remove chart",
  ) as unknown as { click(): void } | undefined;
  assert.ok(remove !== undefined);
  remove.click();
  const confirmRemove = [...doc.querySelectorAll(".modal .primary")].pop() as unknown as {
    click(): void;
  };
  assert.ok(confirmRemove !== undefined);
  confirmRemove.click();
  await tick();
  assert.equal(host.querySelectorAll(".chart-card").length, 0);
  panel.setColumns([city(), meta({ name: "amount", type: "number" })]);
  await tick();
  assert.equal(host.querySelectorAll(".chart-card").length, 0, "no default card comes back");
  panel.dispose();
});

test("group by draws one line per category with a toggleable legend", async () => {
  const window = setupDom();
  captureMockContext(window, []);
  const host = document.createElement("div");
  const card = new ChartCard(
    host,
    {
      ...stubCardOptions(),
      requestGroupedBins: () =>
        Promise.resolve({
          type: "groupedBins",
          requestId: 1,
          column: 0,
          groupColumn: 1,
          labels: ["Perth", "Sydney"],
          codes: [0, 1],
          groups: [
            [2, 3, 1, 0],
            [0, 1, 2, 2],
          ],
          totals: [6, 5],
          otherIndex: -1,
          bins: 4,
          overflow: 0,
          above: 0,
          below: 0,
          total: 11,
          ms: 1,
        }),
    },
    { kind: "line", column: 0, groupColumn: 1 },
  );
  const wrap = host.querySelector(".chart-canvas-wrap") as HTMLElement;
  Object.defineProperty(wrap, "clientWidth", { value: 640, configurable: true });
  card.setColumns([
    meta({
      name: "order_date",
      type: "date",
      histogram: {
        bins: [1, 1, 1, 1],
        min: 0,
        max: 4,
        symlog: false,
        below: 0,
        above: 0,
        p05: 0,
        p95: 4,
      },
    }),
    meta({
      name: "region",
      type: "category",
      categories: { labels: ["Perth", "Sydney"], counts: [6, 5] },
    }),
  ]);
  await tick();
  const legend = host.querySelector(".chart-legend") as HTMLElement;
  assert.equal(legend.classList.contains("hidden"), false);
  const labels = [...legend.querySelectorAll("button")].map((button) => button.textContent);
  assert.deepEqual(labels, ["Perth", "Sydney"]);
  const canvas = host.querySelector("canvas") as HTMLCanvasElement;
  assert.match(canvas.getAttribute("aria-label") ?? "", /Time series of order_date by region/);
  assert.match(host.querySelector(".chart-note")?.textContent ?? "", /2 lines by region/);

  (canvas as unknown as { dispatchEvent(event: unknown): boolean }).dispatchEvent(
    new window.MouseEvent("pointermove", { clientX: 200, clientY: 200 }),
  );
  await new Promise((resolve) => setTimeout(resolve, 60));
  const tooltip = host.querySelector("[role=tooltip]") as HTMLElement;
  assert.match(tooltip.textContent ?? "", /Perth: 2/);

  const items = [...legend.querySelectorAll("button")];
  (items[1] as unknown as { click(): void }).click();
  await tick();
  const refreshed = [...legend.querySelectorAll("button")];
  assert.equal(refreshed[1].classList.contains("off"), true);
  assert.equal(refreshed[1].getAttribute("aria-pressed"), "false");
  assert.match(host.querySelector(".chart-note")?.textContent ?? "", /1 of 2 lines by region/);
  card.dispose();
});

test("treemap tiles draw and filter their category", async () => {
  const window = setupDom();
  captureMockContext(window, []);
  const applied: [number, ColumnFilter | null][] = [];
  const host = document.createElement("div");
  const card = new ChartCard(
    host,
    {
      ...stubCardOptions(),
      requestAggregate: () =>
        Promise.resolve({
          type: "aggregate",
          requestId: 1,
          viewId: "chart-treemap",
          labels: ["Perth", "Sydney"],
          dimensions: [["Perth", "Sydney"]],
          dimensionNames: ["region"],
          dimensionIsTime: [false],
          dimensionTimes: [Float64Array.from([Number.NaN, Number.NaN])],
          measures: [Float64Array.from([10, 5]), Float64Array.from([10, 5])],
          measureNames: ["count(*)", "count(*)"],
          totals: Float64Array.from([10, 5]),
          groupCount: 2,
          totalGroups: 2,
          truncated: false,
          partials: null,
          ms: 1,
        }),
      onFilter: (column, filter) => applied.push([column, filter]),
      currentFilter: () => null,
    },
    { kind: "treemap", column: 0 },
  );
  const wrap = host.querySelector(".chart-canvas-wrap") as HTMLElement;
  Object.defineProperty(wrap, "clientWidth", { value: 640, configurable: true });
  card.setColumns([
    meta({
      name: "region",
      type: "category",
      categories: { labels: ["Perth", "Sydney"], counts: [10, 5] },
    }),
  ]);
  await tick();
  assert.match(host.querySelector(".chart-note")?.textContent ?? "", /2 tiles/);
  const canvas = host.querySelector("canvas") as HTMLCanvasElement;
  (canvas as unknown as { dispatchEvent(event: unknown): boolean }).dispatchEvent(
    new window.MouseEvent("click", { clientX: 120, clientY: 120 }),
  );
  assert.deepEqual(applied, [[0, { kind: "values", selected: [0] }]]);
  card.dispose();
});

test("treemap groups text by a numeric measure and shows the aggregation", async () => {
  const window = setupDom();
  captureMockContext(window, []);
  const calls: ViewDef[] = [];
  const host = document.createElement("div");
  const card = new ChartCard(
    host,
    {
      ...stubCardOptions(),
      requestAggregate: (view) => {
        calls.push(view);
        return Promise.resolve({
          type: "aggregate",
          requestId: 1,
          viewId: "chart-treemap",
          labels: ["alpha", "beta"],
          dimensions: [["alpha", "beta"]],
          dimensionNames: ["description"],
          dimensionIsTime: [false],
          dimensionTimes: [Float64Array.from([Number.NaN, Number.NaN])],
          measures: [Float64Array.from([30, 10]), Float64Array.from([3, 2])],
          measureNames: ["sum(amount)", "count(*)"],
          totals: Float64Array.from([40]),
          groupCount: 2,
          totalGroups: 2,
          truncated: false,
          partials: null,
          ms: 1,
        });
      },
    },
    { kind: "treemap", column: 0, valueColumn: 1, valueAgg: "sum" },
  );
  const wrap = host.querySelector(".chart-canvas-wrap") as HTMLElement;
  Object.defineProperty(wrap, "clientWidth", { value: 640, configurable: true });
  card.setColumns([
    meta({ name: "description", type: "string", stats: { ...meta().stats, distinct: 40 } }),
    meta({ name: "amount", type: "number" }),
  ]);
  await tick();
  assert.deepEqual(calls.at(-1)?.dimensions, [{ column: 0, by: "value" }]);
  assert.deepEqual(calls.at(-1)?.measures, [
    { column: 1, agg: "sum" },
    { column: null, agg: "count" },
  ]);
  assert.match(host.querySelector(".chart-note")?.textContent ?? "", /Sum of amount/);
  assert.match(host.querySelector(".chart-note")?.textContent ?? "", /40 total/);
  card.dispose();
});

test("top-terms bars draw and filter rows by term", async () => {
  const window = setupDom();
  captureMockContext(window, []);
  const applied: [number, ColumnFilter | null][] = [];
  const host = document.createElement("div");
  const card = new ChartCard(
    host,
    {
      ...stubCardOptions(),
      onFilter: (column, filter) => applied.push([column, filter]),
      currentFilter: () => null,
    },
    { kind: "terms", column: 0 },
  );
  const wrap = host.querySelector(".chart-canvas-wrap") as HTMLElement;
  Object.defineProperty(wrap, "clientWidth", { value: 640, configurable: true });
  card.setColumns([meta({ name: "notes", type: "string" })]);
  await tick();
  assert.match(host.querySelector(".chart-note")?.textContent ?? "", /2 terms/);
  const canvas = host.querySelector("canvas") as HTMLCanvasElement;
  (canvas as unknown as { dispatchEvent(event: unknown): boolean }).dispatchEvent(
    new window.MouseEvent("click", { clientX: 120, clientY: 90 }),
  );
  assert.deepEqual(applied, [[0, { kind: "text", mode: "contains", query: "delivery" }]]);
  card.dispose();
});

test("the red x removes a chart only after confirmation", async () => {
  const window = setupDom();
  captureMockContext(window, []);
  const host = document.createElement("div");
  const panel = new ChartsPanel(host, stubOptions());
  panel.setColumns([
    meta({ name: "city", type: "category", categories: { labels: ["a", "b"], counts: [1, 1] } }),
  ]);
  panel.addCard({ kind: "bar", column: 0 });
  await tick();
  const doc = (globalThis as Record<string, unknown>).document as Window["document"];
  (host.querySelector(".chart-remove") as unknown as { click(): void }).click();
  const cancel = [...doc.querySelectorAll(".modal .ghost")].find((button) =>
    (button.textContent ?? "").includes("Cancel"),
  );
  assert.ok(cancel !== undefined, "removal asks for confirmation");
  (cancel as unknown as { click(): void }).click();
  assert.equal(host.querySelectorAll(".chart-card").length, 1, "cancel keeps the chart");
  (host.querySelector(".chart-remove") as unknown as { click(): void }).click();
  const confirm = [...doc.querySelectorAll(".modal .primary")].pop() as unknown as {
    click(): void;
  };
  confirm.click();
  await tick();
  assert.equal(host.querySelectorAll(".chart-card").length, 0, "confirm removes the chart");
  panel.dispose();
});

test("the colour map defaults to tab10 and can be changed", async () => {
  const window = setupDom();
  captureMockContext(window, []);
  const host = document.createElement("div");
  const card = new ChartCard(host, stubCardOptions(), { kind: "bar", column: 0 });
  card.setColumns([
    meta({ name: "city", type: "category", categories: { labels: ["a", "b"], counts: [1, 1] } }),
  ]);
  await tick();
  assert.equal(card.getConfig().palette, "tab10");
  const select = host.querySelector(".chart-palette-select") as HTMLSelectElement;
  assert.ok(select !== null, "the palette picker renders");
  assert.equal(select.value, "tab10");
  select.value = "Set2";
  select.dispatchEvent(new window.Event("change") as unknown as Event);
  await tick();
  assert.equal(card.getConfig().palette, "Set2");
  assert.equal(host.querySelectorAll(".chart-palette-dot").length, 10);
  card.dispose();
});

test("the chart menu downloads the data behind the chart as CSV", async () => {
  const window = setupDom();
  captureMockContext(window, []);
  const blobs: Blob[] = [];
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  (URL as unknown as { createObjectURL: (blob: Blob) => string }).createObjectURL = (blob) => {
    blobs.push(blob);
    return "blob:test";
  };
  (URL as unknown as { revokeObjectURL: (url: string) => void }).revokeObjectURL = () => {};
  try {
    const host = document.createElement("div");
    const card = new ChartCard(host, stubCardOptions(), { kind: "bar", column: 0 });
    card.setColumns([
      meta({
        name: "city",
        type: "category",
        categories: { labels: ["Adelaide", "Brisbane"], counts: [3, 2] },
      }),
    ]);
    await tick();
    (host.querySelector(".chart-more") as unknown as { click(): void }).click();
    const menu = [...document.querySelectorAll(".context-menu .context-item")].find(
      (item) => item.textContent === "Download data (CSV)",
    );
    assert.ok(menu !== undefined, "the card menu offers CSV");
    assert.ok(
      [...document.querySelectorAll(".context-menu .context-item")].some(
        (item) => item.textContent === "Download chart spec (JSON)",
      ),
      "the card menu offers a chart spec",
    );
    assert.ok(
      [...document.querySelectorAll(".context-menu .context-item")].some(
        (item) => item.textContent === "Download pandas code",
      ),
      "the card menu offers pandas code",
    );
    assert.ok(
      [...document.querySelectorAll(".context-menu .context-item")].some(
        (item) => item.textContent === "Download Polars code",
      ),
      "the card menu offers Polars code",
    );
    (menu as unknown as { click(): void }).click();
    await tick();
    assert.equal(blobs.length, 1, "a CSV blob was created");
    const text = new TextDecoder().decode(await blobs[0].arrayBuffer());
    assert.match(text, /^category,count,percent,is_other/);
    assert.match(text, /Adelaide,3,60\.0000,false/);
    assert.match(text, /Brisbane,2,40\.0000,false/);
    card.dispose();
  } finally {
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
  }
});

test("a ramp palette exposes fixed colour min and max", async () => {
  const window = setupDom();
  captureMockContext(window, []);
  const host = document.createElement("div");
  const card = new ChartCard(host, stubCardOptions(), {
    kind: "scatter",
    x: 0,
    y: 1,
    colorColumn: 2,
  });
  card.setColumns([
    meta({ name: "x", type: "number", stats: { ...meta().stats, min: 0, max: 10 } }),
    meta({ name: "y", type: "number", stats: { ...meta().stats, min: 0, max: 10 } }),
    meta({ name: "score", type: "number", stats: { ...meta().stats, min: 0, max: 100 } }),
  ]);
  await tick();
  const palette = host.querySelector(".chart-palette-select") as HTMLSelectElement;
  palette.value = "Blues";
  palette.dispatchEvent(new window.Event("change") as unknown as Event);
  await tick();
  const min = host.querySelector('input[aria-label="Colour scale minimum"]') as HTMLInputElement;
  const max = host.querySelector('input[aria-label="Colour scale maximum"]') as HTMLInputElement;
  assert.equal(min.closest(".chart-color-domain")?.classList.contains("hidden"), false);
  min.value = "20";
  max.value = "80";
  min.dispatchEvent(new window.Event("change") as unknown as Event);
  await tick();
  assert.equal(card.getConfig().colorMin, 20);
  assert.equal(card.getConfig().colorMax, 80);
  min.value = "90";
  min.dispatchEvent(new window.Event("change") as unknown as Event);
  await tick();
  assert.equal(card.getConfig().colorMin, 20, "invalid bounds are ignored");
  assert.match(host.querySelector(".chart-palette-status")?.textContent ?? "", /greater than min/);
  card.dispose();
});

test("the colour map can be reversed", async () => {
  const window = setupDom();
  captureMockContext(window, []);
  const host = document.createElement("div");
  const card = new ChartCard(host, stubCardOptions(), { kind: "bar", column: 0 });
  card.setColumns([
    meta({
      name: "city",
      type: "category",
      categories: { labels: ["a", "b"], counts: [1, 1] },
    }),
  ]);
  await tick();
  const before = [...host.querySelectorAll(".chart-palette-dot")] as HTMLElement[];
  const secondBefore = before[1]?.style.background;
  const reverse = host.querySelector(
    'input[aria-label="Reverse the colour map"]',
  ) as HTMLInputElement;
  assert.ok(reverse !== null, "the Reverse toggle renders");
  assert.equal(reverse.checked, false);
  reverse.checked = true;
  reverse.dispatchEvent(new window.Event("change") as unknown as Event);
  await tick();
  assert.equal(card.getConfig().paletteReversed, true);
  const after = [...host.querySelectorAll(".chart-palette-dot")] as HTMLElement[];
  assert.notEqual(after[1]?.style.background, secondBefore, "the preview flips");
  card.dispose();
});

test("single-series colour follows the palette until the user picks one", async () => {
  const window = setupDom();
  captureMockContext(window, []);
  const host = document.createElement("div");
  const card = new ChartCard(host, stubCardOptions(), {
    kind: "histogram",
    column: 0,
  });
  card.setColumns([
    meta({
      name: "amount",
      type: "number",
      histogram: { bins: [1, 2], min: 0, max: 10, symlog: false, below: 0, above: 0, p05: 0, p95: 10 },
    }),
  ]);
  await tick();
  const hex = host.querySelector(".chart-hex") as HTMLInputElement;
  assert.equal(hex.value, "#1f77b4", "tab10's first colour shows straight away");
  const palette = host.querySelector(".chart-palette-select") as HTMLSelectElement;
  palette.value = "Set2";
  palette.dispatchEvent(new window.Event("change") as unknown as Event);
  await tick();
  assert.equal(hex.value, "#66c2a5", "the single-series colour follows the new palette");
  (host.querySelector('.chart-swatch[title="#2563eb"]') as unknown as { click(): void }).click();
  await tick();
  assert.equal(card.getConfig().colorCustom, true);
  palette.value = "Set3";
  palette.dispatchEvent(new window.Event("change") as unknown as Event);
  await tick();
  assert.equal(hex.value, "#2563eb", "a hand-picked colour survives palette changes");
  card.dispose();
});

test("a grouped histogram draws one share curve per category with a legend", async () => {
  const window = setupDom();
  captureMockContext(window, []);
  const host = document.createElement("div");
  const card = new ChartCard(
    host,
    {
      ...stubCardOptions(),
      requestGroupedBins: () =>
        Promise.resolve({
          type: "groupedBins",
          requestId: 1,
          column: 0,
          groupColumn: 1,
          labels: ["Female", "Male"],
          codes: [0, 1],
          groups: [
            [4, 2, 1, 0],
            [1, 3, 3, 1],
          ],
          totals: [7, 8],
          otherIndex: -1,
          bins: 4,
          overflow: 0,
          above: 0,
          below: 0,
          total: 15,
          ms: 1,
        }),
    },
    { kind: "histogram", column: 0, groupColumn: 1 },
  );
  const wrap = host.querySelector(".chart-canvas-wrap") as HTMLElement;
  Object.defineProperty(wrap, "clientWidth", { value: 640, configurable: true });
  card.setColumns([
    meta({
      name: "trip_duration",
      type: "number",
      histogram: { bins: [1, 1, 1, 1], min: 0, max: 40, symlog: false, below: 0, above: 0, p05: 1, p95: 39 },
    }),
    meta({
      name: "gender",
      type: "category",
      categories: { labels: ["Female", "Male"], counts: [7, 8] },
    }),
  ]);
  await tick();
  const legend = host.querySelectorAll(".chart-legend-item");
  assert.equal(legend.length, 2, "one legend entry per gender");
  assert.match(host.querySelector(".chart-note")?.textContent ?? "", /2 curves by gender/);
  assert.match(host.querySelector(".chart-note")?.textContent ?? "", /share of each group per bin/);
  card.dispose();
});

test("the source label says Table when no filters apply", async () => {
  const window = setupDom();
  captureMockContext(window, []);
  const host = document.createElement("div");
  const card = new ChartCard(host, { ...stubCardOptions(), tableSourceLabel: () => "Table" }, {
    kind: "bar",
    column: 0,
  });
  card.setColumns([
    meta({ name: "city", type: "category", categories: { labels: ["a", "b"], counts: [1, 1] } }),
  ]);
  await tick();
  const option = host.querySelector(".chart-source option") as HTMLOptionElement;
  assert.equal(option.textContent, "Table");
  card.dispose();
});

test("axis controls sit in their own bordered group", async () => {
  const window = setupDom();
  captureMockContext(window, []);
  const host = document.createElement("div");
  const card = new ChartCard(host, stubCardOptions(), { kind: "bar", column: 0 });
  card.setColumns([
    meta({ name: "city", type: "category", categories: { labels: ["a", "b"], counts: [1, 1] } }),
  ]);
  await tick();
  const axes = host.querySelector(".chart-axes") as HTMLElement;
  assert.ok(axes !== null, "the axes group renders");
  assert.equal(axes.classList.contains("hidden"), false);
  assert.match(axes.textContent ?? "", /Axes/);
  assert.ok(axes.querySelector('[aria-label="Chart column"]') !== null);
  const kindSelect = host.querySelector(".chart-kind") as HTMLSelectElement;
  kindSelect.value = "scatter";
  kindSelect.dispatchEvent(new window.Event("change") as unknown as Event);
  await tick();
  assert.ok(axes.querySelector('[aria-label="X column"]') !== null);
  assert.ok(axes.querySelector('[aria-label="Y column"]') !== null);
  card.dispose();
});

test("charts label both axes with their column names", async () => {
  const window = setupDom();
  const drawn: string[] = [];
  captureMockContext(window, drawn);
  const columns = [
    meta({
      name: "amount",
      type: "number",
      histogram: { bins: [1, 2, 1], min: 0, max: 10, symlog: false, below: 0, above: 0, p05: 0, p95: 10 },
    }),
    meta({ name: "score", type: "number" }),
  ];
  const render = async (preset: Partial<ChartCardConfig>): Promise<string[]> => {
    const host = document.createElement("div");
    const card = new ChartCard(host, stubCardOptions(), preset);
    const wrap = host.querySelector(".chart-canvas-wrap") as HTMLElement;
    Object.defineProperty(wrap, "clientWidth", { value: 640, configurable: true });
    drawn.length = 0;
    card.setColumns(columns);
    await tick();
    const result = drawn.slice();
    card.dispose();
    return result;
  };

  const histogram = await render({ kind: "histogram", column: 0 });
  assert.ok(histogram.includes("amount"), "the histogram X axis names the column");
  assert.ok(histogram.includes("Rows"), "the histogram Y axis names the count");

  const scatter = await render({ kind: "scatter", x: 0, y: 1 });
  assert.ok(scatter.includes("amount"), "the scatter X axis names its column");
  assert.ok(scatter.includes("score"), "the scatter Y axis names its column");
});

test("empty chart states draw no axis titles", async () => {
  const window = setupDom();
  const drawn: string[] = [];
  captureMockContext(window, drawn);
  const host = document.createElement("div");
  const card = new ChartCard(
    host,
    { ...stubCardOptions(), requestBins: () => new Promise(() => {}) },
    { kind: "histogram", column: 0 },
  );
  const wrap = host.querySelector(".chart-canvas-wrap") as HTMLElement;
  Object.defineProperty(wrap, "clientWidth", { value: 640, configurable: true });
  card.setColumns([meta({ name: "amount", type: "number" })]);
  await tick();
  assert.ok(
    drawn.some((text) => text.includes("no histogram data")),
    "the empty state explains why",
  );
  assert.ok(!drawn.includes("Rows"), "no Y title under an empty-state message");
  card.dispose();
});

test("bubble chart draws grid counts and explains the area", async () => {
  const window = setupDom();
  captureMockContext(window, []);
  const host = document.createElement("div");
  const calls: unknown[][] = [];
  const card = new ChartCard(
    host,
    {
      ...stubCardOptions(),
      requestGridCounts: async (...args: unknown[]) => {
        calls.push(args);
        return {
          type: "gridCounts",
          requestId: 1,
          result: {
            xMin: 0,
            xMax: 10,
            yMin: 0,
            yMax: 10,
            bins: 4,
            counts: Uint32Array.from(Array.from({ length: 16 }, (_, i) => (i === 5 ? 3 : i % 4 === 0 ? 1 : 0))),
            maxCount: 3,
            values: null,
            valueMax: 0,
            groups: null,
            total: 7,
            missing: 0,
          },
          ms: 1,
        };
      },
    } as unknown as ChartCardOptions,
    { kind: "bubble", x: 0, y: 1 },
  );
  const wrap = host.querySelector(".chart-canvas-wrap") as HTMLElement;
  Object.defineProperty(wrap, "clientWidth", { value: 640, configurable: true });
  card.setColumns([
    meta({ name: "lat", type: "number", histogram: { bins: [1], min: 0, max: 10, symlog: false, below: 0, above: 0, p05: 0, p95: 10 } }),
    meta({ name: "lon", type: "number", histogram: { bins: [1], min: 0, max: 10, symlog: false, below: 0, above: 0, p05: 0, p95: 10 } }),
    meta({ name: "amount", type: "number", histogram: { bins: [1], min: 0, max: 100, symlog: false, below: 0, above: 0, p05: 0, p95: 100 } }),
  ]);
  await tick();
  const note = host.querySelector(".chart-note")?.textContent ?? "";
  assert.match(note, /size: rows per cell/);
  assert.match(note, /cells/);
  assert.equal(calls[0]?.[3], undefined, "count mode sends no measure");

  const agg = host.querySelector(
    'select[aria-label="Bubble size measure"]',
  ) as HTMLSelectElement;
  assert.ok(agg !== null, "the size-by control renders for bubbles");
  agg.value = "mean";
  agg.dispatchEvent(new window.Event("change") as unknown as Event);
  const size = host.querySelector('select[aria-label="Size column"]') as HTMLSelectElement;
  assert.ok(size !== null);
  size.value = "2";
  size.dispatchEvent(new window.Event("change") as unknown as Event);
  await tick();
  const lastCall = calls[calls.length - 1];
  assert.deepEqual(lastCall?.[3], { column: 2, agg: "mean" });
  assert.match(
    host.querySelector(".chart-note")?.textContent ?? "",
    /size: mean\(amount\) per cell/,
  );

  const scale = host.querySelector(
    'select[aria-label="Bubble size scale"]',
  ) as HTMLSelectElement;
  assert.ok(scale !== null);
  scale.value = "log";
  scale.dispatchEvent(new window.Event("change") as unknown as Event);
  await tick();
  assert.match(host.querySelector(".chart-note")?.textContent ?? "", /log scale/);
  card.dispose();
});

test("animating over a date column shows the playback bar and scrubs frames", async () => {
  const window = setupDom();
  captureMockContext(window, []);
  const host = document.createElement("div");
  let requests = 0;
  const card = new ChartCard(
    host,
    {
      ...stubCardOptions(),
      requestAnimation: async () => {
        requests++;
        return {
          type: "animation",
          requestId: 1,
          result: {
            frames: [
              { time: Date.UTC(2024, 0, 1), label: "2024-01" },
              { time: Date.UTC(2024, 1, 1), label: "2024-02" },
            ],
            maxCount: 2,
            total: 3,
            missing: 0,
            bar: { labels: ["open", "closed"], counts: Uint32Array.from([1, 2, 2, 1]) },
          },
          ms: 1,
        };
      },
    },
    { kind: "bar", column: 0, animationTimeColumn: 1, animationGrain: "month" },
  );
  const wrap = host.querySelector(".chart-canvas-wrap") as HTMLElement;
  Object.defineProperty(wrap, "clientWidth", { value: 640, configurable: true });
  card.setColumns([
    meta({ name: "status", type: "category", categories: { labels: ["open", "closed"], counts: [2, 1] } }),
    meta({
      name: "when",
      type: "date",
      stats: {
        ...meta().stats,
        min: Date.UTC(2024, 0, 1),
        max: Date.UTC(2024, 2, 1),
        distinct: 60,
      },
      histogram: { bins: [1, 1, 1], min: Date.UTC(2024, 0, 1), max: Date.UTC(2024, 2, 1), symlog: false, below: 0, above: 0, p05: 0, p95: 1 },
    }),
  ]);
  await tick();
  assert.ok(requests > 0, "frames were requested for the animated kind");
  const bar = host.querySelector(".chart-animation") as HTMLElement;
  assert.equal(bar.classList.contains("hidden"), false, "the playback bar appears");
  const slider = bar.querySelector("input[type=range]") as HTMLInputElement;
  assert.equal(slider.max, "1");
  assert.match(bar.textContent ?? "", /2024-01/);
  slider.value = "1";
  slider.dispatchEvent(new window.Event("input") as unknown as Event);
  await tick();
  assert.match(bar.textContent ?? "", /2024-02/);
  assert.match(host.querySelector(".chart-note")?.textContent ?? "", /2024-02/);
  assert.doesNotMatch(
    host.querySelector(".chart-note")?.textContent ?? "",
    /frame \d+ of \d+/,
    "the frame counter clutter is gone; the date is enough",
  );
  card.dispose();
});

test("Export GIF encodes the animation frames and downloads a blob", async () => {
  const window = setupDom();
  captureMockContext(window, []);
  const blobs: Blob[] = [];
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  (URL as unknown as { createObjectURL: (blob: Blob) => string }).createObjectURL = (blob) => {
    blobs.push(blob);
    return "blob:test";
  };
  (URL as unknown as { revokeObjectURL: (url: string) => void }).revokeObjectURL = () => {};
  try {
    const host = document.createElement("div");
    const card = new ChartCard(
      host,
      {
        ...stubCardOptions(),
        requestAnimation: async () => ({
          type: "animation",
          requestId: 1,
          result: {
            frames: [
              { time: Date.UTC(2024, 0, 1), label: "2024-01" },
              { time: Date.UTC(2024, 1, 1), label: "2024-02" },
            ],
            maxCount: 2,
            total: 3,
            missing: 0,
            bar: { labels: ["open", "closed"], counts: Uint32Array.from([1, 2, 2, 1]) },
          },
          ms: 1,
        }),
      },
      { kind: "bar", column: 0, animationTimeColumn: 1, animationGrain: "month" },
    );
    const wrap = host.querySelector(".chart-canvas-wrap") as HTMLElement;
    Object.defineProperty(wrap, "clientWidth", { value: 640, configurable: true });
    card.setColumns([
      meta({ name: "status", type: "category", categories: { labels: ["open", "closed"], counts: [2, 1] } }),
      meta({
        name: "when",
        type: "date",
        stats: { ...meta().stats, min: Date.UTC(2024, 0, 1), max: Date.UTC(2024, 2, 1), distinct: 60 },
        histogram: { bins: [1], min: Date.UTC(2024, 0, 1), max: Date.UTC(2024, 2, 1), symlog: false, below: 0, above: 0, p05: 0, p95: 1 },
      }),
    ]);
    await tick();
    const button = [...host.querySelectorAll(".chart-animation button")].find((entry) =>
      (entry.textContent ?? "").includes("Export"),
    );
    assert.ok(button !== undefined, "the export button exists");
    // Choosing 2x halve the per-frame duration before exporting.
    const speed = host.querySelector(
      'select[aria-label="Play speed"]',
    ) as HTMLSelectElement;
    assert.ok(speed !== null, "the speed control renders");
    speed.value = "2";
    speed.dispatchEvent(new window.Event("change") as unknown as Event);
    assert.equal(card.getConfig().animationSpeed, 2);
    (button as unknown as { click(): void }).click();
    const doc = (globalThis as Record<string, unknown>).document as Window["document"];
    const gif = [...doc.querySelectorAll(".context-menu .context-item")].find(
      (entry) => entry.textContent === "Animated GIF (.gif)",
    );
    assert.ok(gif !== undefined, "the export menu offers GIF");
    (gif as unknown as { click(): void }).click();
    for (let attempt = 0; attempt < 20 && blobs.length === 0; attempt++) await tick();
    assert.equal(blobs.length, 1, "a GIF blob was created");
    const bytes = new Uint8Array(await blobs[0].arrayBuffer());
    assert.ok(bytes.length > 40);
    assert.equal(String.fromCharCode(...bytes.slice(0, 6)), "GIF89a");
    assert.match(host.querySelector(".chart-note")?.textContent ?? "", /Exported 2 frames as a GIF/);
    card.dispose();
  } finally {
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
  }
});

test("video export explains itself when WebCodecs is unavailable", async () => {
  const window = setupDom();
  captureMockContext(window, []);
  const host = document.createElement("div");
  const card = new ChartCard(
    host,
    {
      ...stubCardOptions(),
      requestAnimation: async () => ({
        type: "animation",
        requestId: 1,
        result: {
          frames: [
            { time: Date.UTC(2024, 0, 1), label: "2024-01" },
            { time: Date.UTC(2024, 1, 1), label: "2024-02" },
          ],
          maxCount: 1,
          total: 2,
          missing: 0,
          bar: { labels: ["open"], counts: Uint32Array.from([1, 1]) },
        },
        ms: 1,
      }),
    },
    { kind: "bar", column: 0, animationTimeColumn: 1, animationGrain: "month" },
  );
  await tick();
  card.setColumns([
    meta({ name: "status", type: "category", categories: { labels: ["open"], counts: [1] } }),
    meta({
      name: "when",
      type: "date",
      stats: { ...meta().stats, min: Date.UTC(2024, 0, 1), max: Date.UTC(2024, 2, 1), distinct: 60 },
    }),
  ]);
  await tick();
  const exportButton = [...host.querySelectorAll(".chart-animation button")].find((entry) =>
    (entry.textContent ?? "").includes("Export"),
  );
  assert.ok(exportButton !== undefined);
  (exportButton as unknown as { click(): void }).click();
  const doc = (globalThis as Record<string, unknown>).document as Window["document"];
  const video = [...doc.querySelectorAll(".context-menu .context-item")].find(
    (entry) => entry.textContent === "Video (.mp4)",
  );
  assert.ok(video !== undefined, "the export menu offers MP4");
  (video as unknown as { click(): void }).click();
  await tick();
  assert.match(
    host.querySelector(".chart-note")?.textContent ?? "",
    /WebCodecs|Could not encode the video/,
  );
  card.dispose();
});

test("the Animate button sits in the toolbar and reveals the setup row", async () => {
  const window = setupDom();
  captureMockContext(window, []);
  const host = document.createElement("div");
  const card = new ChartCard(host, stubCardOptions(), { kind: "bar", column: 0 });
  card.setColumns([
    meta({ name: "status", type: "category", categories: { labels: ["open"], counts: [1] } }),
    meta({
      name: "when",
      type: "date",
      stats: { ...meta().stats, min: Date.UTC(2024, 0, 1), max: Date.UTC(2024, 2, 1), distinct: 60 },
    }),
  ]);
  await tick();
  const button = host.querySelector(".chart-animate-btn") as HTMLButtonElement;
  assert.ok(button !== null, "the Animate button is in the toolbar");
  assert.equal(button.disabled, false);
  const setup = host.querySelector(".chart-animate-setup") as HTMLElement;
  assert.equal(setup.classList.contains("hidden"), true, "setup starts collapsed");
  assert.ok(setup.querySelector('select[aria-label="Animate over time"]') !== null);
  assert.match(setup.textContent ?? "", /Animate/);
  button.click();
  await tick();
  assert.equal(setup.classList.contains("hidden"), false, "clicking reveals the setup row");
  assert.ok(button.classList.contains("active"));
  button.click();
  await tick();
  assert.equal(setup.classList.contains("hidden"), true);
  card.dispose();
});

test("the Animate button is disabled when the file has no date column", async () => {
  const window = setupDom();
  captureMockContext(window, []);
  const host = document.createElement("div");
  const card = new ChartCard(host, stubCardOptions(), { kind: "bar", column: 0 });
  card.setColumns([
    meta({ name: "status", type: "category", categories: { labels: ["open"], counts: [1] } }),
  ]);
  await tick();
  const button = host.querySelector(".chart-animate-btn") as HTMLButtonElement;
  assert.equal(button.disabled, true);
  assert.match(button.title, /needs a date or datetime column/);
  card.dispose();
});

test("animation speed presets cover 1.25x and a custom multiplier", async () => {
  const window = setupDom();
  captureMockContext(window, []);
  const host = document.createElement("div");
  const card = new ChartCard(host, stubCardOptions(), { kind: "bar", column: 0 });
  card.setColumns([
    meta({ name: "status", type: "category", categories: { labels: ["open"], counts: [1] } }),
  ]);
  await tick();
  const speed = host.querySelector(
    'select[aria-label="Play speed"]',
  ) as HTMLSelectElement;
  assert.ok(speed !== null);
  const values = [...speed.options].map((option) => option.value);
  assert.deepEqual(values, ["0.5", "0.75", "1", "1.25", "1.5", "2", "custom"]);
  card.dispose();
});

test("picking a Size column for a bubble switches the measure to sum", async () => {
  const window = setupDom();
  captureMockContext(window, []);
  const host = document.createElement("div");
  const calls: unknown[][] = [];
  const card = new ChartCard(
    host,
    {
      ...stubCardOptions(),
      requestGridCounts: async (...args: unknown[]) => {
        calls.push(args);
        return {
          type: "gridCounts",
          requestId: 1,
          result: {
            xMin: 0,
            xMax: 1,
            yMin: 0,
            yMax: 1,
            bins: 4,
            counts: new Uint32Array(16),
            maxCount: 0,
            values: null,
            valueMax: 0,
            groups: null,
            total: 0,
            missing: 0,
          },
          ms: 1,
        };
      },
    } as unknown as ChartCardOptions,
    { kind: "bubble", x: 0, y: 1 },
  );
  card.setColumns([
    meta({ name: "lat", type: "number" }),
    meta({ name: "lon", type: "number" }),
    meta({ name: "amount", type: "number" }),
  ]);
  await tick();
  const settingsRow = host.querySelector(".chart-bubble-settings") as HTMLElement;
  assert.ok(settingsRow !== null, "the bubble options row renders");
  assert.equal(settingsRow.classList.contains("hidden"), false, "visible for bubbles");
  const size = host.querySelector('select[aria-label="Size column"]') as HTMLSelectElement;
  size.value = "2";
  size.dispatchEvent(new window.Event("change") as unknown as Event);
  await tick();
  assert.equal(card.getConfig().bubbleAgg, "sum", "the measure switches off count");
  assert.deepEqual(calls[calls.length - 1]?.[3], { column: 2, agg: "sum" });
  // Non-bubble kinds keep the row hidden.
  const kind = host.querySelector(".chart-kind") as HTMLSelectElement;
  kind.value = "bar";
  kind.dispatchEvent(new window.Event("change") as unknown as Event);
  await tick();
  assert.equal(settingsRow.classList.contains("hidden"), true, "hidden for bars");
  card.dispose();
});

test("a grouped bubble chart draws one set per category with a legend", async () => {
  const window = setupDom();
  captureMockContext(window, []);
  const host = document.createElement("div");
  const cellCount = 16;
  const alphaCounts = Uint32Array.from(Array.from({ length: cellCount }, (_, i) => (i % 5 === 0 ? 1 : 0)));
  const betaCounts = Uint32Array.from(Array.from({ length: cellCount }, (_, i) => (i % 3 === 0 ? 2 : 0)));
  const card = new ChartCard(
    host,
    {
      ...stubCardOptions(),
      requestGridCounts: async () => ({
        type: "gridCounts",
        requestId: 1,
        result: {
          xMin: 0,
          xMax: 10,
          yMin: 0,
          yMax: 10,
          bins: 4,
          counts: alphaCounts.map((value, i) => value + (betaCounts[i] ?? 0)),
          maxCount: 4,
          values: null,
          valueMax: 0,
          groups: [
            { code: 0, label: "alpha", counts: alphaCounts, values: null },
            { code: 1, label: "beta", counts: betaCounts, values: null },
          ],
          total: 9,
          missing: 0,
        },
        ms: 1,
      }),
    } as unknown as ChartCardOptions,
    { kind: "bubble", x: 0, y: 1, groupColumn: 2 },
  );
  const wrap = host.querySelector(".chart-canvas-wrap") as HTMLElement;
  Object.defineProperty(wrap, "clientWidth", { value: 640, configurable: true });
  card.setColumns([
    meta({ name: "lat", type: "number" }),
    meta({ name: "lon", type: "number" }),
    meta({ name: "gender", type: "category", categories: { labels: ["alpha", "beta"], counts: [5, 4] } }),
  ]);
  await tick();
  const legend = host.querySelectorAll(".chart-legend-item");
  assert.equal(legend.length, 2, "one legend entry per group");
  assert.match(host.querySelector(".chart-note")?.textContent ?? "", /2 of 2 groups by gender/);
  (legend[0] as unknown as { click(): void }).click();
  await tick();
  const refreshed = host.querySelectorAll(".chart-legend-item");
  assert.ok(refreshed[0]?.classList.contains("off"), "clicking hides the group");
  assert.match(host.querySelector(".chart-note")?.textContent ?? "", /1 of 2 groups/);
  card.dispose();
});

test("the add-chart builder lists every type, explains unfit ones and adds directly", async () => {
  const window = setupDom();
  captureMockContext(window, []);
  const host = document.createElement("div");
  const panel = new ChartsPanel(host, stubOptions());
  panel.setColumns([
    meta({ name: "city", type: "category", categories: { labels: ["a", "b"], counts: [1, 1] } }),
    meta({ name: "amount", type: "number" }),
    meta({ name: "score", type: "number" }),
    meta({ name: "when", type: "date" }),
  ]);
  await tick();
  assert.equal(host.querySelector(".charts-rail"), null, "the duplicate left rail is gone");
  const chips = [...host.querySelectorAll(".chart-add-type")] as HTMLButtonElement[];
  assert.equal(chips.length, 19, "one chip per chart type");
  const bubble = chips.find((chip) => (chip.textContent ?? "").startsWith("Bubble"));
  assert.ok(bubble !== undefined, "the builder offers Bubble");
  const disabled = chips.find((chip) => chip.getAttribute("aria-disabled") === "true");
  assert.ok(disabled !== undefined, "at least one type does not fit these columns");
  assert.equal(disabled.disabled, false, "unfit chips stay focusable");
  const describedBy = disabled.getAttribute("aria-describedby") ?? "";
  assert.ok(describedBy !== "", "the unfit chip points at its reason");
  assert.match(host.querySelector(`#${describedBy}`)?.textContent ?? "", /\S/, "the reason is available to assistive technology");
  disabled.click();
  assert.equal(host.querySelectorAll(".chart-card").length, 0, "an unfit type adds nothing");
  bubble.click();
  await tick();
  assert.equal(host.ownerDocument.querySelectorAll(".chart-setup-modal").length, 0, "no dialog opens");
  assert.equal(host.querySelectorAll(".chart-card").length, 1, "the chip adds one card directly");
  const kinds = host.querySelectorAll<HTMLSelectElement>(".chart-kind");
  assert.equal(kinds[kinds.length - 1]?.value, "bubble");
  panel.dispose();
});

test("chart cards show their table scope and filtered row count", async () => {
  const window = setupDom();
  captureMockContext(window, []);
  const host = document.createElement("div");
  const panel = new ChartsPanel(host, stubOptions());
  panel.setColumns([
    meta({ name: "city", type: "category", categories: { labels: ["a"], counts: [1] } }),
    meta({ name: "amount", type: "number" }),
  ]);
  const card = panel.addCard({ kind: "bar", column: 0 });
  panel.setTotalRowCount(100);
  panel.setRowCount(20);
  assert.match(card.root.querySelector(".chart-scope")?.textContent ?? "", /Current rows: 20 of 100/);
  panel.setRowCount(100);
  assert.match(card.root.querySelector(".chart-scope")?.textContent ?? "", /Whole dataset \(100 rows\)/);
  panel.dispose();
});

test("the empty charts state is one clear message without auto suggestions", async () => {
  const window = setupDom();
  captureMockContext(window, []);
  const host = document.createElement("div");
  const panel = new ChartsPanel(host, stubOptions());
  panel.restore([], [
    meta({ name: "city", type: "category", categories: { labels: ["a"], counts: [1] } }),
    meta({ name: "amount", type: "number" }),
  ]);
  await tick();
  assert.equal(host.querySelectorAll(".charts-empty-suggestions button").length, 0);
  assert.match(
    host.querySelector(".charts-empty-title")?.textContent ?? "",
    /No charts yet/,
  );
  const add = [...host.querySelectorAll("button")].find((button) =>
    (button.textContent ?? "").includes("Add chart"),
  );
  assert.ok(add !== undefined);
  add.click();
  await tick();
  assert.ok(
    !host.querySelector(".chart-add-panel")?.classList.contains("hidden"),
    "Add chart opens the data-first builder",
  );
  assert.ok(host.querySelector(".chart-add-quick-btn") !== null, "quick starts are offered");
  panel.dispose();
});

test("an orphaned chart stays in the grid and can be rebound", async () => {
  const window = setupDom();
  captureMockContext(window, []);
  const sourceHost = document.createElement("div");
  const source = new ChartsPanel(sourceHost, stubOptions());
  const columns = [
    meta({ name: "city", type: "category", categories: { labels: ["a"], counts: [1] } }),
    meta({ name: "amount", type: "number" }),
  ];
  source.setColumns(columns);
  source.addCard({ kind: "bar", column: 0 });
  const original = source.captureConfigs()[0];
  assert.ok(original !== undefined);
  source.dispose();
  const missing = { ...original, column: "gone", missingColumns: ["gone"] };
  const host = document.createElement("div");
  const panel = new ChartsPanel(host, stubOptions());
  panel.restore([{ missingColumns: ["gone"], namedConfig: missing }], columns);
  assert.equal(host.querySelectorAll(".chart-card-orphan").length, 1, "the card stays");
  assert.match(host.textContent ?? "", /gone/);
  const rebind = [...host.querySelectorAll(".chart-card-orphan button")].find(
    (button) => (button.textContent ?? "").trim() === "Rebind",
  ) as unknown as { click(): void };
  rebind.click();
  await tick();
  const modal = host.ownerDocument.querySelector(".chart-setup-modal");
  assert.ok(modal !== null);
  (modal.querySelector(".primary") as unknown as { click(): void }).click();
  await tick();
  assert.equal(host.querySelectorAll(".chart-card-orphan").length, 0);
  assert.equal(host.querySelectorAll(".chart-card").length, 1, "rebind keeps a card");
  panel.dispose();
});

test("single-axis kinds keep the X/Y controls hidden through filter updates", async () => {
  const window = setupDom();
  captureMockContext(window, []);
  const host = document.createElement("div");
  const card = new ChartCard(host, stubCardOptions(), { kind: "bar", column: 0 });
  card.setColumns([
    meta({ name: "city", type: "category", categories: { labels: ["a"], counts: [1] } }),
    meta({ name: "amount", type: "number" }),
  ]);
  await tick();
  card.setFiltered({}, {});
  await tick();
  const xWrap = host
    .querySelector('select[aria-label="X column"]')
    ?.closest(".chart-tag");
  const yWrap = host
    .querySelector('select[aria-label="Y column"]')
    ?.closest(".chart-tag");
  assert.ok(xWrap?.classList.contains("hidden"), "X stays hidden on a bar chart");
  assert.ok(yWrap?.classList.contains("hidden"), "Y stays hidden on a bar chart");
  card.dispose();
});

test("the Wide button makes a card span the full row", async () => {
  const window = setupDom();
  captureMockContext(window, []);
  const host = document.createElement("div");
  const card = new ChartCard(host, stubCardOptions(), { kind: "bar", column: 0 });
  card.setColumns([
    meta({ name: "city", type: "category", categories: { labels: ["a"], counts: [1] } }),
  ]);
  await tick();
  const button = host.querySelector(".chart-width-btn") as HTMLButtonElement;
  assert.ok(button !== null, "the width control renders");
  assert.equal(card.root.classList.contains("span-full"), false);
  button.click();
  assert.equal(card.root.classList.contains("span-full"), true);
  assert.equal(card.getConfig().span, "full");
  assert.ok(button.classList.contains("active"));
  button.click();
  assert.equal(card.root.classList.contains("span-full"), false);
  assert.equal(card.getConfig().span, "auto");
  card.dispose();
});

test("Reduce is discoverable, enables with a Size column and updates the measure", async () => {
  const window = setupDom();
  captureMockContext(window, []);
  const host = document.createElement("div");
  const calls: unknown[][] = [];
  const card = new ChartCard(
    host,
    {
      ...stubCardOptions(),
      requestGridCounts: async (...args: unknown[]) => {
        calls.push(args);
        return {
          type: "gridCounts",
          requestId: 1,
          result: {
            xMin: 0,
            xMax: 1,
            yMin: 0,
            yMax: 1,
            bins: 4,
            counts: new Uint32Array(16),
            maxCount: 0,
            values: null,
            valueMax: 0,
            groups: null,
            total: 0,
            missing: 0,
          },
          ms: 1,
        };
      },
    } as unknown as ChartCardOptions,
    { kind: "bubble", x: 0, y: 1 },
  );
  card.setColumns([
    meta({ name: "lat", type: "number" }),
    meta({ name: "lon", type: "number" }),
    meta({ name: "amount", type: "number" }),
  ]);
  await tick();
  const reduce = host.querySelector(
    'select[aria-label="Bubble size measure"]',
  ) as HTMLSelectElement;
  assert.ok(reduce !== null, "the Reduce select is visible");
  assert.ok(
    !(reduce.closest(".chart-field") as HTMLElement).classList.contains("hidden"),
    "Reduce is not hidden",
  );
  assert.equal(reduce.disabled, true, "disabled while Size is Count of rows");
  const size = host.querySelector('select[aria-label="Size column"]') as HTMLSelectElement;
  size.value = "2";
  size.dispatchEvent(new window.Event("change") as unknown as Event);
  await tick();
  assert.equal(reduce.disabled, false, "enabled once a Size column is chosen");
  assert.equal(reduce.value, "sum", "switches to Sum automatically");
  reduce.value = "mean";
  reduce.dispatchEvent(new window.Event("change") as unknown as Event);
  await tick();
  assert.deepEqual(calls[calls.length - 1]?.[3], { column: 2, agg: "mean" });
  size.value = "-1";
  size.dispatchEvent(new window.Event("change") as unknown as Event);
  await tick();
  assert.equal(reduce.disabled, true, "back to Count disables Reduce");
  assert.equal(calls[calls.length - 1]?.[3], undefined);
  card.dispose();
});

test("changing Group refreshes the bubble with the group column", async () => {
  const window = setupDom();
  captureMockContext(window, []);
  const host = document.createElement("div");
  const calls: unknown[][] = [];
  const card = new ChartCard(
    host,
    {
      ...stubCardOptions(),
      requestGridCounts: async (...args: unknown[]) => {
        calls.push(args);
        return {
          type: "gridCounts",
          requestId: 1,
          result: {
            xMin: 0,
            xMax: 1,
            yMin: 0,
            yMax: 1,
            bins: 4,
            counts: new Uint32Array(16),
            maxCount: 0,
            values: null,
            valueMax: 0,
            groups: null,
            total: 0,
            missing: 0,
          },
          ms: 1,
        };
      },
    } as unknown as ChartCardOptions,
    { kind: "bubble", x: 0, y: 1 },
  );
  card.setColumns([
    meta({ name: "lat", type: "number" }),
    meta({ name: "lon", type: "number" }),
    meta({ name: "kind", type: "category", categories: { labels: ["a", "b"], counts: [1, 1] } }),
  ]);
  await tick();
  assert.equal(calls[calls.length - 1]?.[4], undefined, "ungrouped by default");
  const group = host.querySelector('select[aria-label="Group by"]') as HTMLSelectElement;
  group.value = "2";
  group.dispatchEvent(new window.Event("change") as unknown as Event);
  await tick();
  assert.equal(calls[calls.length - 1]?.[4], 2, "the group column reaches the worker");
  card.dispose();
});

test("date time series uses human-grain buckets instead of 64-bin combs", async () => {
  const window = setupDom();
  captureMockContext(window, []);
  const host = document.createElement("div");
  const requested: { column: number; options: { min: number; max: number; binCount: number } }[] = [];
  const card = new ChartCard(
    host,
    {
      ...stubCardOptions(),
      requestBins: async (column: number, options: unknown) => {
        requested.push({ column, options: options as { min: number; max: number; binCount: number } });
        return { type: "chartBins", requestId: 1, bins: [1], overflow: 0, above: 0, below: 0, total: 1, median: null, ms: 1 } as never;
      },
    } as unknown as ChartCardOptions,
    { kind: "line", column: 0 },
  );
  const spanDays = 23;
  card.setColumns([
    meta({
      name: "when",
      type: "date",
      stats: {
        ...meta().stats,
        min: Date.UTC(2024, 2, 1),
        max: Date.UTC(2024, 2, 1) + spanDays * 86_400_000,
        distinct: 24,
      },
      histogram: {
        bins: [1],
        min: Date.UTC(2024, 2, 1),
        max: Date.UTC(2024, 2, 1) + spanDays * 86_400_000,
        symlog: false,
        below: 0,
        above: 0,
        p05: 0,
        p95: 1,
      },
    }),
  ]);
  await tick();
  assert.equal(requested.length, 1, "the line asks for day-grain bins");
  assert.equal(requested[0]?.options.binCount, spanDays + 1, "one bucket per day plus the inclusive end");
  card.setFiltered({}, {});
  await tick();
  assert.equal(requested.length, 1, "unchanged filters do not re-request buckets");
  card.dispose();
});

test("focus mode expands a card and restores it with its config", async () => {
  const window = setupDom();
  captureMockContext(window, []);
  const host = document.createElement("div");
  const card = new ChartCard(host, stubCardOptions(), { kind: "bar", column: 0 });
  const wrap = host.querySelector(".chart-canvas-wrap") as HTMLElement;
  Object.defineProperty(wrap, "clientWidth", { value: 640, configurable: true });
  card.setColumns([
    meta({ name: "city", type: "category", categories: { labels: ["a", "b"], counts: [1, 1] } }),
  ]);
  await tick();
  const doc = (globalThis as Record<string, unknown>).document as Window["document"];
  doc.body.append(host as never);
  (host.querySelector(".chart-focus-btn") as unknown as { click(): void }).click();
  const overlay = doc.querySelector(".chart-focus-overlay") as unknown as HTMLElement;
  assert.ok(overlay !== null, "the focus overlay opens");
  assert.equal(overlay.contains(host as never), true, "the same card moves into the overlay");
  overlay.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape" }) as never);
  assert.equal(doc.querySelector(".chart-focus-overlay"), null, "Escape closes the overlay");
  assert.equal(
    (host.parentNode as unknown as Window["document"]["body"]) === doc.body,
    true,
    "the card returns to its grid slot",
  );
  assert.equal(card.getConfig().kind, "bar", "configuration survives the round trip");
  card.dispose();
});

test("axis title overrides and units label the axes; truncated titles stay hoverable", async () => {
  const window = setupDom();
  const drawn: string[] = [];
  captureMockContext(window, drawn);
  const host = document.createElement("div");
  const card = new ChartCard(host, stubCardOptions(), {
    kind: "histogram",
    column: 0,
    xTitle: "Trip duration",
    yUnit: "kWh",
  });
  const wrap = host.querySelector(".chart-canvas-wrap") as HTMLElement;
  Object.defineProperty(wrap, "clientWidth", { value: 640, configurable: true });
  card.setColumns([
    meta({
      name: "amount",
      type: "number",
      histogram: { bins: [1, 2, 1], min: 0, max: 10, symlog: false, below: 0, above: 0, p05: 0, p95: 10 },
    }),
  ]);
  await tick();
  assert.ok(drawn.includes("Trip duration"), "the X override replaces the column name");
  assert.ok(drawn.includes("Rows (kWh)"), "the unit is appended to the Y title");

  const long = "A very long axis title that will definitely not fit in the plot area";
  const host2 = document.createElement("div");
  const card2 = new ChartCard(host2, stubCardOptions(), {
    kind: "histogram",
    column: 0,
    xTitle: long,
  });
  const wrap2 = host2.querySelector(".chart-canvas-wrap") as HTMLElement;
  Object.defineProperty(wrap2, "clientWidth", { value: 480, configurable: true });
  card2.setColumns([
    meta({
      name: "amount",
      type: "number",
      histogram: { bins: [1, 2, 1], min: 0, max: 10, symlog: false, below: 0, above: 0, p05: 0, p95: 10 },
    }),
  ]);
  await tick();
  assert.ok(
    drawn.some((text) => text.startsWith("A very long axis title") && text.endsWith("…")),
    "the long title is truncated with an ellipsis",
  );
  const canvas2 = host2.querySelector("canvas") as HTMLCanvasElement;
  (canvas2 as unknown as { dispatchEvent(event: unknown): boolean }).dispatchEvent(
    new window.MouseEvent("pointermove", { clientX: 276, clientY: 252 }),
  );
  await new Promise((resolve) => setTimeout(resolve, 60));
  const tooltip = host2.querySelector("[role=tooltip]") as HTMLElement;
  assert.equal(
    tooltip.querySelector(".chart-tooltip-title")?.textContent,
    long,
    "hovering the truncated title shows the full text",
  );
  card.dispose();
  card2.dispose();
});

test("a line card plots its own measure over time without a view", async () => {
  setupDom();
  const host = document.createElement("div");
  const calls: ViewDef[] = [];
  const aggregate = (view: ViewDef): AggregateMessage => ({
    type: "aggregate",
    requestId: 1,
    viewId: view.id,
    labels: ["2013-08-15", "2013-08-16"],
    dimensions: [["2013-08-15", "2013-08-16"]],
    dimensionNames: ["date_time (day)"],
    dimensionIsTime: [true],
    dimensionTimes: [Float64Array.from([Date.UTC(2013, 7, 15), Date.UTC(2013, 7, 16)])],
    measures: [Float64Array.from([12.5, 18.25])],
    measureNames: ["mean(direction)"],
    totals: Float64Array.from([15.375]),
    groupCount: 2,
    totalGroups: 2,
    truncated: false,
    partials: null,
    ms: 1,
  });
  const options = stubCardOptions();
  const card = new ChartCard(
    host,
    {
      ...options,
      requestAggregate: (view: ViewDef) => {
        calls.push(view);
        return Promise.resolve(aggregate(view));
      },
    },
    { kind: "line", column: 0, valueColumn: 1, valueAgg: "mean", valueGrain: "day" },
  );
  const columns = [
    meta({ name: "date_time", type: "datetime", stats: { ...meta().stats, distinct: 300 } }),
    meta({ name: "direction", type: "number" }),
  ];
  card.setColumns(columns);
  await tick();

  assert.equal(calls.length, 1, "the card fetches its own aggregate");
  const def = calls[0];
  assert.ok(def !== undefined);
  assert.deepEqual(def.dimensions, [{ column: 0, by: { time: "day" } }]);
  assert.deepEqual(def.measures, [{ column: 1, agg: "mean" }]);
  assert.equal(def.respectFilters, true, "value lines respect the active filters");

  const tagWrap = (label: string): HTMLElement | null =>
    ([...host.querySelectorAll(".chart-tag")] as HTMLElement[]).find(
      (tag) => tag.querySelector(".chart-tag-label")?.textContent === label,
    ) ?? null;
  assert.equal(tagWrap("Value")?.classList.contains("hidden"), false);
  assert.equal(tagWrap("Aggregate")?.classList.contains("hidden"), false);
  assert.equal(tagWrap("Time resolution")?.classList.contains("hidden"), false);
  card.dispose();
});

test("a bar card plots a measure per category without a view", async () => {
  setupDom();
  const host = document.createElement("div");
  const calls: ViewDef[] = [];
  const aggregate = (view: ViewDef): AggregateMessage => ({
    type: "aggregate",
    requestId: 1,
    viewId: view.id,
    labels: ["Portland", "Salem"],
    dimensions: [["Portland", "Salem"]],
    dimensionNames: ["city (value)"],
    dimensionIsTime: [false],
    dimensionTimes: [Float64Array.from([Number.NaN, Number.NaN])],
    measures: [Float64Array.from([30, 10])],
    measureNames: ["mean(amount)"],
    totals: Float64Array.from([20]),
    groupCount: 2,
    totalGroups: 2,
    truncated: false,
    partials: null,
    ms: 1,
  });
  const options = stubCardOptions();
  const card = new ChartCard(
    host,
    {
      ...options,
      requestAggregate: (view: ViewDef) => {
        calls.push(view);
        return Promise.resolve(aggregate(view));
      },
    },
    { kind: "bar", column: 1, valueColumn: 0, valueAgg: "mean" },
  );
  const columns = [
    meta({ name: "amount", type: "number" }),
    meta({ name: "city", type: "category" }),
  ];
  card.setColumns(columns);
  await tick();

  assert.equal(calls.length, 1, "the card fetches its own aggregate");
  const def = calls[0];
  assert.ok(def !== undefined);
  assert.deepEqual(def.dimensions, [{ column: 1, by: "value" }]);
  assert.deepEqual(def.measures, [{ column: 0, agg: "mean" }]);
  assert.deepEqual(def.sort, { key: "m0", dir: "desc" }, "categories sort by measure");
  assert.equal(def.fill, "none");
  assert.equal(def.respectFilters, true, "value bars respect the active filters");

  const tagWrap = (label: string): HTMLElement | null =>
    ([...host.querySelectorAll(".chart-tag")] as HTMLElement[]).find(
      (tag) => tag.querySelector(".chart-tag-label")?.textContent === label,
    ) ?? null;
  assert.equal(tagWrap("Value")?.classList.contains("hidden"), false);
  assert.equal(tagWrap("Aggregate")?.classList.contains("hidden"), false);
  assert.equal(tagWrap("Time resolution")?.classList.contains("hidden"), true, "no grain for bars");
  card.dispose();
});

test("a barplot aggregates a numeric measure by category", async () => {
  setupDom();
  const host = document.createElement("div");
  const calls: ViewDef[] = [];
  const aggregate = (view: ViewDef): AggregateMessage => ({
    type: "aggregate",
    requestId: 1,
    viewId: view.id,
    labels: ["Portland", "Salem"],
    dimensions: [["Portland", "Salem"]],
    dimensionNames: ["city (value)"],
    dimensionIsTime: [false],
    dimensionTimes: [Float64Array.from([Number.NaN, Number.NaN])],
    measures: [Float64Array.from([30, 10])],
    measureNames: ["sum(amount)"],
    totals: Float64Array.from([40]),
    groupCount: 2,
    totalGroups: 2,
    truncated: false,
    partials: null,
    ms: 1,
  });
  const options = stubCardOptions();
  const card = new ChartCard(
    host,
    {
      ...options,
      requestAggregate: (view: ViewDef) => {
        calls.push(view);
        return Promise.resolve(aggregate(view));
      },
    },
    { kind: "barplot", column: 1, valueColumn: 0, valueAgg: "sum" },
  );
  card.setColumns([
    meta({ name: "amount", type: "number" }),
    meta({ name: "city", type: "category" }),
  ]);
  await tick();

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0]?.dimensions, [{ column: 1, by: "value" }]);
  assert.deepEqual(calls[0]?.measures, [{ column: 0, agg: "sum" }]);
  assert.deepEqual(calls[0]?.sort, { key: "m0", dir: "desc" });
  assert.equal(calls[0]?.respectFilters, true);
  card.dispose();

  for (const agg of ["count", "distinct"] as const) {
    const countCard = new ChartCard(
      host,
      {
        ...options,
        requestAggregate: (view: ViewDef) => {
          calls.push(view);
          return Promise.resolve(aggregate(view));
        },
      },
      { kind: "barplot", column: 1, valueColumn: 0, valueAgg: agg },
    );
    countCard.setColumns([
      meta({ name: "amount", type: "number" }),
      meta({ name: "city", type: "category" }),
    ]);
    await tick();
    assert.deepEqual(calls.at(-1)?.measures, [{ column: 0, agg }]);
    countCard.dispose();
  }

  const calcCard = new ChartCard(
    host,
    {
      ...options,
      requestAggregate: (view: ViewDef) => {
        calls.push(view);
        return Promise.resolve(aggregate(view));
      },
    },
    { kind: "barplot", column: 1, valueColumn: 0, valueAgg: "sum", valueCalc: "cumulative" },
  );
  calcCard.setColumns([
    meta({ name: "amount", type: "number" }),
    meta({ name: "city", type: "category" }),
  ]);
  await tick();
  assert.deepEqual(calls.at(-1)?.measures[0]?.post, [{ op: "cumulative" }]);
  calcCard.dispose();

  const stacked = new ChartCard(
    host,
    options,
    { kind: "barplot", column: 1, valueColumn: 0, barLayout: "stack" },
  );
  stacked.setColumns([
    meta({ name: "amount", type: "number" }),
    meta({ name: "city", type: "category" }),
  ]);
  await tick();
  assert.equal(stacked.getConfig().barLayout, "stack");
  stacked.dispose();
});

test("a map card requests unclipped coordinate points", async () => {
  setupDom();
  const host = document.createElement("div");
  const calls: { mode: string; clip?: boolean; xColumn: number; yColumn: number }[] = [];
  const options = stubCardOptions();
  const card = new ChartCard(
    host,
    {
      ...options,
      requestSeries: (input) => {
        calls.push({
          mode: input.mode,
          clip: input.clip,
          xColumn: input.xColumn,
          yColumn: input.yColumn,
        });
        return Promise.resolve(series());
      },
    },
    { kind: "map", x: 1, y: 0 },
  );
  card.setColumns([
    meta({ name: "lat", type: "number", stats: { ...meta().stats, min: -37.9, max: -37.7 } }),
    meta({ name: "lon", type: "number", stats: { ...meta().stats, min: 144.8, max: 145.1 } }),
  ]);
  await tick();

  const input = calls[calls.length - 1];
  assert.ok(input !== undefined, "the map fetches its own points");
  assert.equal(input.mode, "points", "maps never switch to a density grid");
  assert.equal(input.clip, false, "the full coordinate range is kept");
  assert.equal(input.xColumn, 1);
  assert.equal(input.yColumn, 0);
  card.dispose();
});

test("a map heat grid aggregates a measure per cell", async () => {
  setupDom();
  const host = document.createElement("div");
  const calls: unknown[][] = [];
  const options = stubCardOptions();
  const card = new ChartCard(
    host,
    {
      ...options,
      requestGridCounts: async (...args: unknown[]) => {
        calls.push(args);
        return {
          type: "gridCounts",
          requestId: 1,
          result: {
            xMin: 144.8,
            xMax: 145.1,
            yMin: -37.9,
            yMax: -37.7,
            bins: 40,
            counts: new Uint32Array(1600),
            maxCount: 0,
            values: Float64Array.from(Array.from({ length: 1600 }, (_, i) => (i % 7 === 0 ? 1200000 : 0))),
            valueMax: 1200000,
            groups: null,
            total: 100,
            missing: 0,
          },
          ms: 1,
        };
      },
    },
    {
      kind: "map",
      x: 1,
      y: 0,
      mapMode: "heat",
      sizeColumn: 2,
      bubbleAgg: "sum",
    },
  );
  card.setColumns([
    meta({ name: "lat", type: "number", stats: { ...meta().stats, min: -37.9, max: -37.7 } }),
    meta({ name: "lon", type: "number", stats: { ...meta().stats, min: 144.8, max: 145.1 } }),
    meta({ name: "price", type: "number", stats: { ...meta().stats, min: 100000, max: 4000000 } }),
  ]);
  await tick();

  assert.ok(calls.length >= 1, "the heat grid is fetched");
  const last = calls[calls.length - 1] ?? [];
  assert.equal(last[0], 1, "longitude column");
  assert.equal(last[1], 0, "latitude column");
  assert.equal(last[2], 40, "default grid resolution");
  assert.deepEqual(last[3], { column: 2, agg: "sum" }, "the measure is the size column");

  const mode = host.querySelector('select[aria-label="Map display mode"]') as HTMLSelectElement;
  assert.ok(mode !== null, "the display mode control exists");
  assert.equal(mode.value, "heat");
  card.dispose();
});

test("a line card splits its measure into one series per group", async () => {
  setupDom();
  const host = document.createElement("div");
  const calls: ViewDef[] = [];
  const aggregate = (view: ViewDef): AggregateMessage => ({
    type: "aggregate",
    requestId: 1,
    viewId: view.id,
    labels: ["2026-08 · a", "2026-08 · b", "2026-09 · a", "2026-09 · b"],
    dimensions: [
      ["2026-08", "2026-08", "2026-09", "2026-09"],
      ["a", "b", "a", "b"],
    ],
    dimensionNames: ["day (month)", "city (value)"],
    dimensionIsTime: [true, false],
    dimensionTimes: [
      Float64Array.from([Date.UTC(2026, 7, 1), Date.UTC(2026, 7, 1), Date.UTC(2026, 8, 1), Date.UTC(2026, 8, 1)]),
      Float64Array.from([Number.NaN, Number.NaN, Number.NaN, Number.NaN]),
    ],
    measures: [Float64Array.from([10, 20, 12, 18])],
    measureNames: ["sum(amount)"],
    totals: Float64Array.from([60]),
    groupCount: 4,
    totalGroups: 4,
    truncated: false,
    partials: null,
    ms: 1,
  });
  const options = stubCardOptions();
  const card = new ChartCard(
    host,
    {
      ...options,
      requestAggregate: (view: ViewDef) => {
        calls.push(view);
        return Promise.resolve(aggregate(view));
      },
    },
    { kind: "line", column: 0, valueColumn: 1, valueAgg: "sum", valueGrain: "month", groupColumn: 2 },
  );
  card.setColumns([
    meta({ name: "day", type: "datetime", stats: { ...meta().stats, distinct: 300 } }),
    meta({ name: "amount", type: "number" }),
    meta({ name: "city", type: "category" }),
  ]);
  await tick();

  const def = calls[calls.length - 1];
  assert.ok(def !== undefined);
  assert.deepEqual(def.dimensions, [
    { column: 0, by: { time: "month" } },
    { column: 2, by: "value" },
  ]);
  assert.deepEqual(def.measures, [{ column: 1, agg: "sum" }]);
  assert.equal((card as unknown as { config: { groupColumn: number } }).config.groupColumn, 2);

  const note = host.querySelector(".chart-note")?.textContent ?? "";
  assert.match(note, /sum\(amount\) by city/, "the note names the split column");
  assert.match(note, /2 of 2 series shown/);
  card.dispose();
});

test("a histogram card aggregates a measure per bin without a view", async () => {
  setupDom();
  const host = document.createElement("div");
  const calls: ViewDef[] = [];
  const aggregate = (view: ViewDef): AggregateMessage => ({
    type: "aggregate",
    requestId: 1,
    viewId: view.id,
    labels: ["0–10", "10–20", "20–30"],
    dimensions: [["0–10", "10–20", "20–30"]],
    dimensionNames: ["age (bins)"],
    dimensionIsTime: [false],
    dimensionTimes: [Float64Array.from([Number.NaN, Number.NaN, Number.NaN])],
    measures: [Float64Array.from([12, 88, 30])],
    measureNames: ["sum(amount)"],
    totals: Float64Array.from([130]),
    groupCount: 3,
    totalGroups: 3,
    truncated: false,
    partials: null,
    ms: 1,
  });
  const options = stubCardOptions();
  const card = new ChartCard(
    host,
    {
      ...options,
      requestAggregate: (view: ViewDef) => {
        calls.push(view);
        return Promise.resolve(aggregate(view));
      },
    },
    { kind: "histogram", column: 0, valueColumn: 1, valueAgg: "sum" },
  );
  card.setColumns([
    meta({
      name: "age",
      type: "number",
      histogram: { bins: [1, 2, 3], min: 0, max: 30, symlog: false, below: 0, above: 0, p05: 1, p95: 28 },
    }),
    meta({ name: "amount", type: "number" }),
  ]);
  await tick();

  const def = calls[calls.length - 1];
  assert.ok(def !== undefined, "the card fetches its own aggregate");
  assert.deepEqual(def.dimensions, [{ column: 0, by: { bin: { n: 32 } } }]);
  assert.deepEqual(def.measures, [{ column: 1, agg: "sum" }]);
  assert.deepEqual(def.sort, { key: "dim0", dir: "asc" }, "bins stay in bin order");

  const tagWrap = (label: string): HTMLElement | null =>
    ([...host.querySelectorAll(".chart-tag")] as HTMLElement[]).find(
      (tag) => tag.querySelector(".chart-tag-label")?.textContent === label,
    ) ?? null;
  assert.equal(tagWrap("Value")?.classList.contains("hidden"), false);
  assert.equal(tagWrap("Aggregate")?.classList.contains("hidden"), false);
  assert.equal(tagWrap("Time resolution")?.classList.contains("hidden"), true);
  card.dispose();
});

test("a KPI card totals a measure over all rows without a date", async () => {
  setupDom();
  const host = document.createElement("div");
  const calls: ViewDef[] = [];
  const aggregate = (view: ViewDef): AggregateMessage => ({
    type: "aggregate",
    requestId: 1,
    viewId: view.id,
    labels: [""],
    dimensions: [],
    dimensionNames: [],
    dimensionIsTime: [],
    dimensionTimes: [],
    measures: [Float64Array.from([42.5])],
    measureNames: ["mean(amount)"],
    totals: Float64Array.from([42.5]),
    groupCount: 1,
    totalGroups: 1,
    truncated: false,
    partials: null,
    ms: 1,
  });
  const options = stubCardOptions();
  const card = new ChartCard(
    host,
    {
      ...options,
      requestAggregate: (view: ViewDef) => {
        calls.push(view);
        return Promise.resolve(aggregate(view));
      },
    },
    { kind: "kpi", column: 0, valueColumn: 0, valueAgg: "mean" },
  );
  card.setColumns([meta({ name: "amount", type: "number" })]);
  await tick();

  assert.equal(calls.length, 1, "the KPI fetches its own aggregate");
  const def = calls[0];
  assert.ok(def !== undefined);
  assert.deepEqual(def.dimensions, [], "a grand total needs no dimension");
  assert.deepEqual(def.measures, [{ column: 0, agg: "mean" }]);
  assert.equal(def.respectFilters, true);

  const tagWrap = (label: string): HTMLElement | null =>
    ([...host.querySelectorAll(".chart-tag")] as HTMLElement[]).find(
      (tag) => tag.querySelector(".chart-tag-label")?.textContent === label,
    ) ?? null;
  assert.equal(tagWrap("Value")?.classList.contains("hidden"), false);
  assert.equal(tagWrap("Aggregate")?.classList.contains("hidden"), false);
  assert.equal(tagWrap("Time resolution")?.classList.contains("hidden"), true);
  const note = host.querySelector(".chart-note")?.textContent ?? "";
  assert.match(note, /mean\(amount\) = 42\.5/, "the note carries the full value");
  card.dispose();
});

test("a KPI card with a date column reads the series and shows Bucket", async () => {
  setupDom();
  const host = document.createElement("div");
  const calls: ViewDef[] = [];
  const aggregate = (view: ViewDef): AggregateMessage => ({
    type: "aggregate",
    requestId: 1,
    viewId: view.id,
    labels: ["2026-08", "2026-09"],
    dimensions: [["2026-08", "2026-09"]],
    dimensionNames: ["day (month)"],
    dimensionIsTime: [true],
    dimensionTimes: [
      Float64Array.from([Date.UTC(2026, 7, 1), Date.UTC(2026, 8, 1)]),
    ],
    measures: [Float64Array.from([40, 42.5])],
    measureNames: ["mean(amount)"],
    totals: Float64Array.from([41.25]),
    groupCount: 2,
    totalGroups: 2,
    truncated: false,
    partials: null,
    ms: 1,
  });
  const options = stubCardOptions();
  const card = new ChartCard(
    host,
    {
      ...options,
      requestAggregate: (view: ViewDef) => {
        calls.push(view);
        return Promise.resolve(aggregate(view));
      },
    },
    { kind: "kpi", column: 0, valueColumn: 1, valueAgg: "mean" },
  );
  card.setColumns([
    meta({ name: "day", type: "datetime", stats: { ...meta().stats, distinct: 300 } }),
    meta({ name: "amount", type: "number" }),
  ]);
  await tick();

  const def = calls[calls.length - 1];
  assert.ok(def !== undefined);
  assert.equal(def.dimensions.length, 1);
  assert.equal(
    (def.dimensions[0] as { column: number }).column,
    0,
    "the date column buckets the series",
  );
  const tagWrap = (label: string): HTMLElement | null =>
    ([...host.querySelectorAll(".chart-tag")] as HTMLElement[]).find(
      (tag) => tag.querySelector(".chart-tag-label")?.textContent === label,
    ) ?? null;
  assert.equal(tagWrap("Time resolution")?.classList.contains("hidden"), false);
  const note = host.querySelector(".chart-note")?.textContent ?? "";
  assert.match(note, /42\.5/, "the note carries the latest value");
  assert.match(note, /vs previous/, "the change is stated");
  card.dispose();
});
test("map cards expose visible zoom/fit controls and clearer layer labels", async () => {
  const window = setupDom();
  captureMockContext(window, []);
  const host = document.createElement("div");
  const card = new ChartCard(host, stubCardOptions(), { kind: "map", x: 1, y: 0 });
  const wrap = host.querySelector(".chart-canvas-wrap") as HTMLElement;
  Object.defineProperty(wrap, "clientWidth", { value: 640, configurable: true });
  card.setColumns([
    meta({ name: "lat", type: "number" }),
    meta({ name: "lon", type: "number" }),
  ]);
  await tick();
  const controls = host.querySelector(".chart-map-controls");
  assert.ok(controls !== null);
  assert.equal(controls.classList.contains("hidden"), false);
  const labels = [...controls.querySelectorAll("button")].map(
    (button) => button.getAttribute("aria-label") ?? button.textContent,
  );
  assert.deepEqual(labels, ["Zoom the map in", "Zoom the map out", "Fit the map to the data"]);
  const settings = host.querySelector(".chart-bubble-settings")?.textContent ?? "";
  assert.match(settings, /Load extra map data/);
  assert.match(settings, /Clear extra map data/);
  card.dispose();
});

test("map auto-fit follows the data percentile bounds", () => {
  const lons = Array.from({ length: 100 }, (_, index) => -120 + index * 0.4);
  const lats = Array.from({ length: 100 }, (_, index) => -10 + index * 0.1);
  lons[0] = -170;
  lons[99] = 170;
  lats[0] = -60;
  lats[99] = 60;
  const view = fitMapView(lons, lats);
  assert.ok(view !== null);
  assert.ok((view?.lonMin ?? -180) > -170);
  assert.ok((view?.lonMax ?? 180) < 170);
  assert.ok((view?.latMin ?? -90) > -60);
  assert.ok((view?.latMax ?? 90) < 60);
});
test("chart sources group pivot views as a first-class source category", () => {
  const window = setupDom();
  const host = document.createElement("div") as unknown as HTMLElement;
  const card = new ChartCard(host, stubCardOptions(), { kind: "bar", column: 0 });
  card.setSources([
    { id: "p1", name: "Pivot by month", kind: "pivot" },
    { id: "v1", name: "Saved aggregate", kind: "view" },
  ]);
  const groups = [...host.querySelectorAll(".chart-source optgroup")].map(
    (group) => group.getAttribute("label"),
  );
  assert.deepEqual(groups, ["Table data", "Pivot views", "Saved views"]);
  assert.equal(
    host.querySelector('.chart-source optgroup[label="Pivot views"] option')?.textContent,
    "Pivot by month",
  );
  card.dispose();
  void window;
});
test("a pivot view source renders a pivot heatmap with level selectors", async () => {
  const window = setupDom();
  const host = document.createElement("div") as unknown as HTMLElement;
  const pivot: PivotMessage = {
    type: "pivot",
    requestId: 1,
    pivotId: "p1",
    rowLabels: [["2024", "Jan"], ["2024", "Feb"], ["2025", "Jan"]],
    colLabels: [["North"], ["South"]],
    rowNames: ["Year", "Month"],
    colNames: ["Region"],
    rowIsTime: [false, false],
    colIsTime: [false],
    rowTimes: [
      Float64Array.from([Number.NaN, Number.NaN, Number.NaN]),
      Float64Array.from([Number.NaN, Number.NaN, Number.NaN]),
    ],
    colTimes: [Float64Array.from([Number.NaN, Number.NaN])],
    measures: [
      {
        name: "sum(amount)",
        values: Float64Array.from([1, 2, 3, 4, 5, 6]),
        rowTotals: Float64Array.from([3, 7, 11]),
        colTotals: Float64Array.from([9, 12]),
        grandTotal: 21,
      },
    ],
    groupCount: 6,
    totalGroups: 6,
    truncated: false,
    ms: 1,
  };
  let requests = 0;
  const options: ChartCardOptions = {
    ...stubCardOptions(),
    requestViewPivot: async () => {
      requests++;
      return pivot;
    },
  };
  const card = new ChartCard(host, options, {
    kind: "pivotHeatmap",
    source: "p1",
    title: "Pivot heatmap",
  });
  const wrap = host.querySelector(".chart-canvas-wrap") as HTMLElement;
  Object.defineProperty(wrap, "clientWidth", { value: 640, configurable: true });
  Object.defineProperty(wrap, "clientHeight", { value: 360, configurable: true });
  card.setColumns([meta({ name: "amount", type: "number" })]);
  card.setSources([{ id: "p1", name: "Monthly pivot", kind: "pivot" }]);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(requests, 1);
  assert.match(host.querySelector(".chart-note")?.textContent ?? "", /sum\(amount\) by Month x Region/);
  const rowSelect = host.querySelector(
    'select[aria-label="Pivot row level"]',
  ) as HTMLSelectElement;
  assert.equal(rowSelect.options.length, 2);
  assert.equal(rowSelect.value, "1");
  rowSelect.value = "0";
  rowSelect.dispatchEvent(new window.Event("change") as unknown as Event);
  assert.match(host.querySelector(".chart-note")?.textContent ?? "", /sum\(amount\) by Year x Region/);
  card.dispose();
});

test("chart measures are type-aware and warn about risky sums", () => {
  const window = setupDom();
  const host = document.createElement("div") as unknown as HTMLElement;
  const card = new ChartCard(host, stubCardOptions(), {
    kind: "barplot",
    column: 0,
    valueColumn: 1,
    valueAgg: "mean",
  });
  card.setColumns([
    meta({
      name: "region",
      type: "category",
      categories: { labels: ["North", "South"], counts: [5, 4] },
    }),
    meta({ name: "conversion_rate", type: "number" }),
  ]);
  const agg = host.querySelector(
    'select[aria-label="Aggregation"]',
  ) as HTMLSelectElement;
  const labels = [...agg.options].map((option) => option.textContent);
  assert.ok(labels.includes("Std deviation"));
  assert.ok(labels.includes("Variance"));
  assert.ok(labels.includes("90th percentile"));
  agg.value = "sum";
  agg.dispatchEvent(new window.Event("change") as unknown as Event);
  assert.doesNotMatch(host.querySelector(".chart-summary")?.textContent ?? "", /misleading/i);
  const note = host.querySelector(".chart-lint") as HTMLElement;
  assert.equal(note.classList.contains("hidden"), false);
  assert.match(note.textContent ?? "", /conversion_rate looks like a rate or percentage\. Summing it rarely makes sense; use Average\./);
  assert.equal(host.querySelectorAll(".chart-lint").length, 1, "one note at a time");
  (note.querySelector(".chart-lint-x") as unknown as { click(): void }).click();
  assert.equal(note.classList.contains("hidden"), true, "a dismissed note stays dismissed");
  agg.value = "mean";
  agg.dispatchEvent(new window.Event("change") as unknown as Event);
  assert.equal(note.classList.contains("hidden"), true, "Average needs no note");
  card.dispose();
});

test("boolean chart measures expose true, false, missing and percent choices", () => {
  setupDom();
  const host = document.createElement("div") as unknown as HTMLElement;
  const card = new ChartCard(host, stubCardOptions(), {
    kind: "kpi",
    column: -1,
    valueColumn: 0,
    valueAgg: "true",
  });
  card.setColumns([meta({ name: "is_active", type: "boolean" })]);
  const agg = host.querySelector(
    'select[aria-label="Aggregation"]',
  ) as HTMLSelectElement;
  const labels = [...agg.options].map((option) => option.textContent);
  assert.ok(labels.includes("True count"));
  assert.ok(labels.includes("True % of rows"));
  assert.ok(labels.includes("Missing count"));
  card.dispose();
});
test("chart selections become ordinary table filters", () => {
  assert.deepEqual(
    tableFiltersForHitActions([
      { kind: "values", column: 2, code: 4 },
      { kind: "range", column: 1, min: 0, max: 10 },
      { kind: "text", column: 3, query: "north" },
    ]),
    [
      { column: 2, filter: { kind: "values", selected: [4] } },
      { column: 1, filter: { kind: "range", min: 0, max: 10 } },
      { column: 3, filter: { kind: "text", mode: "contains", query: "north" } },
    ],
  );
});

test("chart data issues expose filter, rows and scoped fixes", async () => {
  setupDom();
  const filters: { column: number; filter: ColumnFilter }[][] = [];
  const converted: string[][] = [];
  const suggestions: string[] = [];
  const host = document.createElement("div") as unknown as HTMLElement;
  const card = new ChartCard(
    host,
    {
      ...stubCardOptions(),
      onFilterTable: (items) => filters.push([...items]),
      onShowRows: (items) => filters.push([...items]),
      onConvertToken: (_column, tokens) => converted.push(tokens),
      onSuggestion: (_column, suggestion) => suggestions.push(suggestion.kind),
    },
    { kind: "bar", column: 0 },
  );
  card.setColumns([
    meta({
      name: "city",
      type: "category",
      categories: { labels: ["north", "(empty)"], counts: [4, 3] },
      stats: {
        nulls: 3,
        distinct: 2,
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
      nullTokens: [{ label: "n/a", count: 2 }],
      suggestions: [{ kind: "sentinel", value: "TBC", count: 2, ratio: 0.1, sampled: 20 }],
    }),
  ]);
  const bar = host.querySelector(".chart-data-issues") as HTMLElement;
  assert.ok(bar !== null);
  assert.match(bar.textContent ?? "", /3 missing/);
  assert.match(bar.textContent ?? "", /2 placeholders/);
  assert.match(bar.textContent ?? "", /TBC/);
  const chips = [...bar.querySelectorAll(".chart-issue-chip")] as HTMLButtonElement[];
  assert.ok(chips.some((chip) => /^Filter:/.test(chip.textContent ?? "")));
  assert.ok(chips.some((chip) => /^Fix: convert/.test(chip.textContent ?? "")));
  assert.ok(chips.some((chip) => /^Fix: treat/.test(chip.textContent ?? "")));
  (chips.find((chip) => /^Filter:/.test(chip.textContent ?? "")) as HTMLButtonElement).click();
  (chips.find((chip) => /^Fix: convert/.test(chip.textContent ?? "")) as HTMLButtonElement).click();
  (chips.find((chip) => /^Fix: treat/.test(chip.textContent ?? "")) as HTMLButtonElement).click();
  assert.deepEqual(filters[0], [{ column: 0, filter: { kind: "blank", negate: false } }]);
  assert.deepEqual(converted, [["n/a"]]);
  assert.deepEqual(suggestions, ["sentinel"]);
  card.dispose();
});

test("edit and reset share the card config path", async () => {
  setupDom();
  const host = document.createElement("div") as unknown as HTMLElement;
  const card = new ChartCard(host, stubCardOptions(), {
    kind: "bar",
    column: 0,
    title: "Cities",
    colorMin: 1,
    colorMax: 9,
    colorCenter: 5,
  });
  card.setColumns([
    meta({ name: "city", type: "category", categories: { labels: ["a", "b"], counts: [3, 2] } }),
    meta({ name: "score", type: "number" }),
  ]);
  card.applyConfig({ kind: "barplot", column: 0, valueColumn: 1, colorMin: null, colorMax: null, colorCenter: null });
  assert.equal(card.getConfig().kind, "barplot");
  assert.equal(card.getConfig().valueColumn, 1);
  assert.equal(card.getConfig().title, "Cities");
  assert.equal(card.getConfig().colorCenter, null);
  card.dispose();
});
test("chart card menu opens the shared edit dialog and reset path", async () => {
  const window = setupDom();
  captureMockContext(window, []);
  const messages: string[] = [];
  const host = document.createElement("div") as unknown as HTMLElement;
  const panel = new ChartsPanel(host, {
    ...stubOptions(),
    onCardEdited: (message) => messages.push(message),
  });
  panel.setColumns([
    meta({ name: "city", type: "category", categories: { labels: ["a", "b"], counts: [3, 2] } }),
    meta({ name: "score", type: "number" }),
  ]);
  await tick();
  const card = panel.addCard({ kind: "bar", column: 0, title: "Cities" });
  const doc = (globalThis as Record<string, unknown>).document as Window["document"];
  const openMenuItem = (label: string): { click(): void } => {
    (card.root.querySelector(".chart-more") as unknown as { click(): void }).click();
    const item = [...doc.querySelectorAll(".context-menu .context-item")].find(
      (button) => button.textContent === label,
    ) as unknown as { click(): void } | undefined;
    assert.ok(item !== undefined, `expected menu item ${label}`);
    return item;
  };
  openMenuItem("Reset to suggested").click();
  assert.equal(card.getConfig().title, "Cities");
  assert.equal(card.getConfig().kind, "bar");
  assert.match(messages.at(-1) ?? "", /reset to suggested/i);
  openMenuItem("Edit chart").click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  const modal = doc.querySelector(".chart-setup-modal");
  assert.ok(modal !== null);
  assert.match(modal.textContent ?? "", /Edit count plot chart/);
  (modal.querySelector(".ghost") as unknown as { click(): void }).click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(doc.querySelector(".chart-setup-modal"), null);
  panel.dispose();
});
test("chart cards validate and apply a lossless spec atomically", async () => {
  setupDom();
  const host = document.createElement("div") as unknown as HTMLElement;
  const card = new ChartCard(host, stubCardOptions(), {
    kind: "bar",
    column: 0,
    title: "Cities",
  });
  card.setColumns([
    meta({ name: "city", type: "category", categories: { labels: ["a", "b"], counts: [3, 2] } }),
    meta({ name: "score", type: "number" }),
  ]);
  const valid = card.getSpec();
  valid.kind = "barplot";
  valid.fields.value = "score";
  valid.title = "Average score";
  valid.presentation.colorCenter = 0;
  assert.deepEqual(card.applySpecText(chartSpecJson(valid)), []);
  assert.equal(card.getConfig().kind, "barplot");
  assert.equal(card.getConfig().valueColumn, 1);
  assert.equal(card.getConfig().title, "Average score");
  assert.equal(card.getConfig().colorCenter, 0);

  const before = card.getConfig();
  const invalid = { ...valid, fields: { ...valid.fields, value: "missing" } };
  const issues = card.applySpecText(JSON.stringify(invalid));
  assert.ok(issues.length > 0);
  assert.deepEqual(card.getConfig(), before, "an invalid spec leaves the card untouched");
  card.dispose();
});
test("right-clicking a shape offers to leave it out, which re-requests the data without it", async () => {
  const window = setupDom();
  captureMockContext(window, []);
  const views: ViewDef[] = [];
  const host = document.createElement("div");
  const card = new ChartCard(
    host,
    {
      ...stubCardOptions(),
      requestAggregate: (view) => {
        views.push(view);
        const leftOut = view.exclude?.some((entry) => entry.kind === "values" && entry.labels.includes("Perth")) === true;
        const labels = leftOut ? ["Sydney"] : ["Perth", "Sydney"];
        return Promise.resolve({
          type: "aggregate",
          requestId: 1,
          viewId: "chart-treemap",
          labels,
          dimensions: [labels],
          dimensionNames: ["region"],
          dimensionIsTime: [false],
          dimensionTimes: [Float64Array.from(labels.map(() => Number.NaN))],
          measures: [Float64Array.from(labels.map(() => 5)), Float64Array.from(labels.map(() => 5))],
          measureNames: ["count(*)", "count(*)"],
          totals: Float64Array.from(labels.map(() => 5)),
          groupCount: labels.length,
          totalGroups: labels.length,
          truncated: false,
          partials: null,
          ms: 1,
        });
      },
      onFilter: () => {},
      currentFilter: () => null,
    },
    { kind: "treemap", column: 0 },
  );
  const wrap = host.querySelector(".chart-canvas-wrap") as HTMLElement;
  Object.defineProperty(wrap, "clientWidth", { value: 640, configurable: true });
  document.body.append(host);
  card.setColumns([
    meta({
      name: "region",
      type: "category",
      categories: { labels: ["Perth", "Sydney"], counts: [10, 5] },
    }),
  ]);
  await tick();
  const canvas = host.querySelector("canvas") as HTMLCanvasElement;
  const event = new window.MouseEvent("contextmenu", { clientX: 120, clientY: 120, cancelable: true });
  (canvas as unknown as { dispatchEvent(event: unknown): boolean }).dispatchEvent(event);
  assert.equal(event.defaultPrevented, true, "the browser menu is replaced");
  const items = [...document.querySelectorAll(".context-menu .context-item")].map(
    (item) => item.textContent,
  );
  assert.ok(items.includes("Leave out “Perth”"), `menu was ${JSON.stringify(items)}`);
  assert.ok(items.includes("Show only “Perth”"));
  assert.ok(items.includes("Filter the table to “Perth”"));

  const before = views.length;
  (
    [...document.querySelectorAll(".context-menu .context-item")].find(
      (item) => item.textContent === "Leave out “Perth”",
    ) as unknown as { click(): void }
  ).click();
  await tick();
  assert.ok(views.length > before, "the card asks the worker again");
  assert.deepEqual(views.at(-1)?.exclude, [{ kind: "values", column: 0, labels: ["Perth"] }]);
  assert.deepEqual(card.getConfig().excludes, [{ kind: "values", column: 0, labels: ["Perth"] }]);
  const chip = host.querySelector(".chart-exclusion-chip") as HTMLButtonElement;
  assert.match(chip.textContent ?? "", /region: Perth/);

  chip.click();
  await tick();
  assert.equal(card.getConfig().excludes, undefined, "clicking the chip puts it back");
  assert.equal(views.at(-1)?.exclude, undefined);
  card.dispose();
  host.remove();
});

test("the add-chart builder makes a chart from a quick start in one click", async () => {
  const window = setupDom();
  captureMockContext(window, []);
  const host = document.createElement("div");
  const panel = new ChartsPanel(host, stubOptions());
  panel.setColumns([
    meta({ name: "order_date", type: "date", stats: { ...meta().stats, distinct: 200, min: 1_700_000_000_000, max: 1_730_000_000_000 } }),
    meta({ name: "region", type: "category", stats: { ...meta().stats, distinct: 4 }, categories: { labels: ["a", "b"], counts: [3, 2] } }),
    meta({ name: "revenue", type: "number", stats: { ...meta().stats, distinct: 800 } }),
  ]);
  panel.setRowCount(1000);
  await tick();
  const add = [...host.querySelectorAll("button")].find((b) => (b.textContent ?? "").includes("Add chart"));
  (add as unknown as { click(): void }).click();
  const quick = host.querySelector(".chart-add-quick-btn") as unknown as HTMLButtonElement;
  assert.match(quick.textContent ?? "", /Total revenue over time/);
  quick.click();
  await tick();
  assert.equal(host.querySelectorAll(".chart-card").length, 1, "one click, one chart");
  assert.equal(host.querySelector<HTMLSelectElement>(".chart-kind")?.value, "line");
  panel.dispose();
});

test("the add-chart builder recommends charts for the picked fields", async () => {
  const window = setupDom();
  captureMockContext(window, []);
  const host = document.createElement("div");
  const panel = new ChartsPanel(host, stubOptions());
  panel.setColumns([
    meta({ name: "region", type: "category", stats: { ...meta().stats, distinct: 4 }, categories: { labels: ["a", "b"], counts: [3, 2] } }),
    meta({ name: "revenue", type: "number", stats: { ...meta().stats, distinct: 800 } }),
  ]);
  panel.setRowCount(1000);
  await tick();
  const add = [...host.querySelectorAll("button")].find((b) => (b.textContent ?? "").includes("Add chart"));
  (add as unknown as { click(): void }).click();
  assert.equal(host.querySelectorAll(".chart-add-tile").length, 0, "nothing is recommended before fields are picked");
  const field = (name: string): HTMLButtonElement =>
    [...host.querySelectorAll<HTMLButtonElement>(".chart-add-field")].find((b) => b.querySelector(".chart-add-field-name")?.textContent === name) as HTMLButtonElement;
  field("region").click();
  field("revenue").click();
  assert.equal(field("revenue").getAttribute("aria-pressed"), "true");
  const tiles = [...host.querySelectorAll<HTMLButtonElement>(".chart-add-tile")];
  assert.ok(tiles.length >= 1);
  assert.match(tiles[0].textContent ?? "", /Barplot/);
  assert.match(tiles[0].textContent ?? "", /Best/);
  assert.match(tiles[0].textContent ?? "", /Bars start at zero/);
  tiles[0].click();
  await tick();
  assert.equal(host.querySelector<HTMLSelectElement>(".chart-kind")?.value, "barplot");
  assert.equal(document.querySelector(".chart-setup-modal"), null);
  panel.dispose();
});

test("new charts land at the top of the grid, are announced and can be undone", async () => {
  const window = setupDom();
  captureMockContext(window, []);
  const host = document.createElement("div");
  const added: { label: string; undo?: () => void }[] = [];
  const panel = new ChartsPanel(host, {
    ...stubOptions(),
    onCardAdded: (label, undo) => added.push({ label, undo }),
  });
  panel.setColumns([
    meta({ name: "city", type: "category", stats: { ...meta().stats, distinct: 4 }, categories: { labels: ["a", "b"], counts: [3, 2] } }),
    meta({ name: "amount", type: "number", stats: { ...meta().stats, distinct: 400 } }),
  ]);
  panel.setRowCount(100);
  const first = panel.addCard({ kind: "bar", column: 0 });
  const second = panel.addChart({ kind: "histogram", column: 1 });
  const roots = [...host.querySelectorAll(".charts-grid > .chart-card")];
  assert.equal(roots[0], second.root, "the new chart is first in the grid");
  assert.equal(roots[1], first.root, "earlier charts keep their order below it");
  assert.ok(second.root.classList.contains("chart-card-new"), "the new chart is highlighted");
  assert.equal(added.length, 1);
  assert.equal(added[0].label, "Histogram");
  added[0].undo?.();
  assert.equal(host.querySelectorAll(".chart-card").length, 1, "Undo removes only the new chart");
  assert.equal(host.querySelector(".chart-card"), first.root);
  panel.dispose();
});

function viewResult(measure: string, groups: number): AggregateMessage {
  return {
    type: "aggregate",
    requestId: 1,
    viewId: "v1",
    labels: Array.from({ length: groups }, (_, i) => `g${i}`),
    dimensions: [Array.from({ length: groups }, (_, i) => `g${i}`)],
    dimensionNames: ["region"],
    dimensionIsTime: [false],
    dimensionTimes: [new Float64Array(groups)],
    measures: [Float64Array.from({ length: groups }, (_, i) => i + 1)],
    measureNames: [measure],
    totals: new Float64Array(1),
    groupCount: groups,
    totalGroups: groups,
    truncated: false,
    partials: null,
    ms: 1,
  };
}

test("a view-bound bar names its real type, source and measure", async () => {
  const window = setupDom();
  const host = document.createElement("div") as unknown as HTMLElement;
  let result = viewResult("sum(units)", 4);
  const card = new ChartCard(
    host,
    { ...stubCardOptions(), requestViewAggregate: async () => result },
    { kind: "bar", source: "v1", title: "Units by region" },
  );
  card.setColumns([meta({ name: "units", type: "number" })]);
  // Before the views list arrives the select still names the source.
  assert.equal(host.querySelector<HTMLSelectElement>(".chart-source select, select.chart-source")?.selectedOptions[0]?.textContent, "Units by region");
  card.setSources([{ id: "v1", name: "Units by region", kind: "view" }]);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(
    host.querySelector(".chart-summary")?.textContent,
    "Barplot from view: Sum of units by region · 4 groups",
  );
  const staticType = host.querySelector(".chart-kind-static");
  assert.equal(staticType?.textContent, "Barplot", "the type row reads as text, not blank");
  assert.equal(staticType?.classList.contains("hidden"), false);

  // A count view is still a count plot.
  result = viewResult("count(*)", 1);
  card.refreshView();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(host.querySelector(".chart-summary")?.textContent, "Count plot from view: Rows by region · 1 group");
  card.dispose();
  void window;
});

test("plainMeasureName reads aggregates as words", () => {
  assert.equal(plainMeasureName("sum(units)"), "Sum of units");
  assert.equal(plainMeasureName("mean(unit price)"), "Average of unit price");
  assert.equal(plainMeasureName("count(*)"), "Rows");
  assert.equal(plainMeasureName("sum(x) · weighted by w"), "Sum of x · weighted by w");
  assert.equal(plainMeasureName("custom expr"), "custom expr");
});

test("Chart this keeps its view result when sibling refreshes run after the request", async () => {
  const window = setupDom();
  captureMockContext(window, []);
  const host = document.createElement("div");
  const panel = new ChartsPanel(host, {
    ...stubOptions(),
    requestViewAggregate: async () => viewResult("sum(units)", 4),
  });
  panel.setColumns([
    meta({ name: "region", type: "category", stats: { ...meta().stats, distinct: 4 }, categories: { labels: ["a", "b"], counts: [3, 2] } }),
    meta({ name: "units", type: "number", stats: { ...meta().stats, distinct: 400 } }),
  ]);
  panel.setSources([{ id: "v1", name: "Sum of units by region", kind: "view" }]);
  panel.setRowCount(100);
  panel.addViewChart({ id: "v1", name: "Sum of units by region" } as never);
  panel.setRowCount(100);
  panel.setFiltered({}, {});
  // A live refresh (new facets, columns) lands while the view request is in flight.
  panel.setColumns([
    meta({ name: "region", type: "category", stats: { ...meta().stats, distinct: 4 }, categories: { labels: ["a", "b"], counts: [3, 2] } }),
    meta({ name: "units", type: "number", stats: { ...meta().stats, distinct: 400 } }),
  ]);
  await tick();
  assert.equal(
    host.querySelector(".chart-summary")?.textContent,
    "Barplot from view: Sum of units by region · 4 groups",
  );
  assert.doesNotMatch(host.querySelector(".chart-note")?.textContent ?? "", /no groups/);
  panel.dispose();
});

test("a bar chart with many ungrouped bars gets one short note", () => {
  const window = setupDom();
  const host = document.createElement("div") as unknown as HTMLElement;
  const card = new ChartCard(host, stubCardOptions(), {
    kind: "bar",
    column: 0,
    groupOther: false,
    title: "",
  });
  card.setColumns([
    meta({
      name: "suburb",
      type: "category",
      stats: { ...meta().stats, distinct: 40 },
      categories: { labels: ["a", "b"], counts: [3, 2] },
    }),
  ]);
  card.setRowCount(500);
  const note = host.querySelector(".chart-lint") as HTMLElement;
  assert.equal(note.classList.contains("hidden"), false);
  assert.match(note.textContent ?? "", /40 bars is hard to read\. Show the top 10 and group the rest as Other\./);
  card.dispose();
  void window;
});

/** An aggregate with `dims` dimensions: rows are (bucket, group?) pairs. */
function extraAggregate(
  view: ViewDef,
  rows: { bucket: string; group?: string; value: number }[],
  time = false,
): AggregateMessage {
  const two = rows.some((row) => row.group !== undefined);
  return {
    type: "aggregate",
    requestId: 1,
    viewId: view.id,
    labels: rows.map((row) => row.bucket),
    dimensions: two
      ? [rows.map((row) => row.bucket), rows.map((row) => row.group ?? "")]
      : [rows.map((row) => row.bucket)],
    dimensionNames: two ? ["period", "region"] : ["region"],
    dimensionIsTime: two ? [time, false] : [time],
    dimensionTimes: (two ? [0, 1] : [0]).map(() => new Float64Array(rows.length).fill(Number.NaN)),
    measures: [Float64Array.from(rows.map((row) => row.value))],
    measureNames: ["sum(revenue)"],
    totals: new Float64Array(1),
    groupCount: rows.length,
    totalGroups: rows.length,
    truncated: false,
    partials: null,
    ms: 1,
  };
}

async function drawExtra(
  config: Partial<ChartCardConfig>,
  rows: { bucket: string; group?: string; value: number }[],
  time = false,
): Promise<{ texts: string[]; note: string; calls: ViewDef[]; hits: number }> {
  const window = setupDom();
  const texts: string[] = [];
  captureMockContext(window, texts);
  const host = document.createElement("div") as unknown as HTMLElement;
  const calls: ViewDef[] = [];
  const card = new ChartCard(
    host,
    {
      ...stubCardOptions(),
      requestAggregate: (view: ViewDef) => {
        calls.push(view);
        return Promise.resolve(extraAggregate(view, rows, time));
      },
    },
    { title: "", ...config },
  );
  const wrap = host.querySelector(".chart-canvas-wrap") as HTMLElement;
  Object.defineProperty(wrap, "clientWidth", { value: 800, configurable: true });
  Object.defineProperty(wrap, "clientHeight", { value: 450, configurable: true });
  card.setColumns([
    meta({ name: "revenue", type: "number", stats: { ...meta().stats, distinct: 500 } }),
    meta({ name: "region", type: "category", stats: { ...meta().stats, distinct: 3 }, categories: { labels: ["East", "West", "North"], counts: [3, 2, 1] } }),
    meta({ name: "product", type: "category", stats: { ...meta().stats, distinct: 2 }, categories: { labels: ["A", "B"], counts: [3, 3] } }),
    meta({ name: "when", type: "date", stats: { ...meta().stats, distinct: 100 } }),
  ]);
  await tick();
  const note = host.querySelector(".chart-note")?.textContent ?? "";
  const hits = (card as unknown as { hitRegions: unknown[] }).hitRegions.length;
  card.dispose();
  return { texts, note, calls, hits };
}

test("a dot plot draws one dot per category, largest first, and says when the axis skips zero", async () => {
  const out = await drawExtra(
    { kind: "dotplot", column: 1, valueColumn: 0, valueAgg: "sum" },
    [{ bucket: "North", value: 96 }, { bucket: "East", value: 100 }, { bucket: "West", value: 98 }],
  );
  assert.deepEqual(out.calls[0]?.dimensions, [{ column: 1, by: "value" }], "one dimension: the category");
  assert.ok(out.texts.indexOf("East") < out.texts.indexOf("West") && out.texts.indexOf("West") < out.texts.indexOf("North"), "rows are largest first");
  assert.match(out.note, /3 groups/);
  assert.match(out.note, /axis starts at .*not zero/);
  assert.equal(out.hits, 3, "each dot is hoverable");
});

test("a 100% stacked bar needs a Group by and then shows shares", async () => {
  const bare = await drawExtra({ kind: "stacked100", column: 1, valueColumn: 0, valueAgg: "sum" }, [{ bucket: "East", value: 1 }]);
  assert.match(bare.texts.join(" "), /Pick a Group by column/);

  const out = await drawExtra(
    { kind: "stacked100", column: 1, groupColumn: 2, valueColumn: 0, valueAgg: "sum" },
    [
      { bucket: "East", group: "A", value: 30 },
      { bucket: "East", group: "B", value: 10 },
      { bucket: "West", group: "A", value: 20 },
    ],
  );
  assert.deepEqual(out.calls[0]?.dimensions, [{ column: 1, by: "value" }, { column: 2, by: "value" }]);
  assert.ok(out.texts.includes("75%"), "East is 75% A");
  assert.ok(out.texts.includes("100%"), "the axis runs to 100%");
  assert.match(out.note, /Share of sum\(revenue\) by region within each period/);
});

test("small multiples draw one titled panel per group", async () => {
  const out = await drawExtra(
    { kind: "smallmultiples", column: 3, groupColumn: 1, valueColumn: 0, valueAgg: "mean" },
    [
      { bucket: "Jan", group: "East", value: 5 },
      { bucket: "Feb", group: "East", value: 9 },
      { bucket: "Jan", group: "West", value: 2 },
      { bucket: "Feb", group: "West", value: 1 },
    ],
    true,
  );
  assert.equal(out.calls[0]?.dimensions.length, 2, "time plus group");
  assert.ok(out.texts.includes("East") && out.texts.includes("West"), "each panel is titled");
  assert.equal(out.hits, 2, "one hover region per panel");
  assert.match(out.note, /each panel has its own scale/);
});

test("a slopegraph compares the first and last point of each group", async () => {
  const out = await drawExtra(
    { kind: "slopegraph", column: 3, groupColumn: 1, valueColumn: 0, valueAgg: "mean" },
    [
      { bucket: "2023", group: "East", value: 10 },
      { bucket: "2024", group: "East", value: 20 },
      { bucket: "2025", group: "East", value: 40 },
      { bucket: "2023", group: "West", value: 30 },
      { bucket: "2025", group: "West", value: 10 },
    ],
    true,
  );
  assert.ok(out.texts.includes("2023") && out.texts.includes("2025"), "both moments are headed");
  assert.ok(!out.texts.includes("2024"), "the middle point is not drawn");
  assert.ok(out.texts.some((t) => t.includes("East") && t.includes("10")), "left label carries the starting value");
  assert.match(out.note, /2023 vs 2025 \(3 periods/);
  assert.equal(out.hits, 4, "a hover region at each end of each line");
});

test("a waterfall runs a total, colours steps and closes with a Total bar", async () => {
  const out = await drawExtra(
    { kind: "waterfall", column: 1, valueColumn: 0, valueAgg: "sum" },
    [{ bucket: "East", value: 100 }, { bucket: "West", value: -30 }, { bucket: "North", value: 40 }],
  );
  assert.deepEqual(out.calls[0]?.dimensions, [{ column: 1, by: "value" }]);
  assert.ok(out.texts.includes("Total"), "closes with a Total bar");
  assert.ok(out.texts.includes("110"), "100 - 30 + 40");
  assert.ok(out.texts.includes("−30"), "a loss reads as a minus");
  assert.match(out.note, /running total \(green up, red down\)/);
  assert.equal(out.hits, 4, "three steps plus the total");
});

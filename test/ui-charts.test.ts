import { test } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import type { ColumnFilter } from "../src/search/query-engine.js";
import { ChartsPanel, type ChartsPanelOptions } from "../src/ui/chart-panel.js";
import { ChartCard, type ChartCardOptions } from "../src/ui/chart-card.js";
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
        shapes: { email: 2, url: 1, phone: 0, numeric: 0, dateLike: 0, uppercase: 3, hasDigits: 5 },
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
  const captured: { text: string; x: number; width: number; align: string; font: string }[] = [];
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
    measureText(text: string): { width: number } {
      return { width: String(text).length * 8 };
    }
    fillText(text: string, x: number): void {
      const width = this.measureText(text).width;
      captured.push({
        text: String(text),
        x,
        width,
        align: this.textAlign,
        font: this.font,
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
    arc(): void {}
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

  assert.equal(host.querySelectorAll(".chart-card").length, 1);

  const buttons = [...host.querySelectorAll("button")];
  const add = buttons.find((button) => button.textContent?.includes("Add chart"));
  assert.ok(add !== undefined);
  add.click();
  await tick();

  const galleryDoc = (globalThis as Record<string, unknown>).document as Window["document"];
  const scatterTile = [...galleryDoc.querySelectorAll(".chart-gallery .chart-tile")].find(
    (tile) => tile.textContent === "Scatter",
  );
  assert.ok(scatterTile !== undefined, "the gallery offers a Scatter tile");
  (scatterTile as unknown as { click(): void }).click();
  await tick();

  const cards = host.querySelectorAll(".chart-card");
  assert.equal(cards.length, 2);
  const kinds = host.querySelectorAll<HTMLSelectElement>(".chart-kind");
  assert.equal(kinds[0].value, "bar", "city is the best default category");
  assert.equal(kinds[1].value, "scatter", "the Scatter tile adds a scatter card");

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

  openCardMenu(cards[1]);
  menuItem("Duplicate").click();
  await tick();
  assert.equal(host.querySelectorAll(".chart-card").length, 3);

  openCardMenu(cards[0]);
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
  assert.match(canvas.getAttribute("aria-label") ?? "", /Bar chart of region/);
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
  assert.match(text, /no numeric, date or category columns/);
  assert.match(host.querySelector(".chart-note")?.textContent ?? "", /no numeric, date or category/);
  assert.equal(
    host.querySelector(".chart-settings-body")?.classList.contains("hidden"),
    true,
    "settings that cannot apply are hidden",
  );
  card.dispose();
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

test("the colour map defaults to Pastel1 and can be changed", async () => {
  const window = setupDom();
  captureMockContext(window, []);
  const host = document.createElement("div");
  const card = new ChartCard(host, stubCardOptions(), { kind: "bar", column: 0 });
  card.setColumns([
    meta({ name: "city", type: "category", categories: { labels: ["a", "b"], counts: [1, 1] } }),
  ]);
  await tick();
  assert.equal(card.getConfig().palette, "Pastel1");
  const select = host.querySelector(".chart-palette-select") as HTMLSelectElement;
  assert.ok(select !== null, "the palette picker renders");
  assert.equal(select.value, "Pastel1");
  select.value = "Set2";
  select.dispatchEvent(new window.Event("change") as unknown as Event);
  await tick();
  assert.equal(card.getConfig().palette, "Set2");
  assert.equal(host.querySelectorAll(".chart-palette-dot").length, 10);
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
  assert.equal(hex.value, "#fbb4ae", "Pastel1's first colour shows straight away");
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

test("bubble chart draws grid counts and explains the area", async () => {
  const window = setupDom();
  captureMockContext(window, []);
  const host = document.createElement("div");
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
          counts: Uint32Array.from(Array.from({ length: 16 }, (_, i) => (i === 5 ? 3 : i % 4 === 0 ? 1 : 0))),
          maxCount: 3,
          total: 7,
          missing: 0,
        },
        ms: 1,
      }),
    },
    { kind: "bubble", x: 0, y: 1 },
  );
  const wrap = host.querySelector(".chart-canvas-wrap") as HTMLElement;
  Object.defineProperty(wrap, "clientWidth", { value: 640, configurable: true });
  card.setColumns([
    meta({ name: "lat", type: "number", histogram: { bins: [1], min: 0, max: 10, symlog: false, below: 0, above: 0, p05: 0, p95: 10 } }),
    meta({ name: "lon", type: "number", histogram: { bins: [1], min: 0, max: 10, symlog: false, below: 0, above: 0, p05: 0, p95: 10 } }),
  ]);
  await tick();
  const note = host.querySelector(".chart-note")?.textContent ?? "";
  assert.match(note, /bubble area ∝ rows/);
  assert.match(note, /cells/);
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
  assert.match(host.querySelector(".chart-note")?.textContent ?? "", /frame 2 of 2/);
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
      (entry.textContent ?? "").includes("Export GIF"),
    );
    assert.ok(button !== undefined, "the GIF export button exists");
    (button as unknown as { click(): void }).click();
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

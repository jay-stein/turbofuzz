import { test } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { ChartCard, type ChartCardConfig, type ChartCardOptions } from "../src/ui/chart-card.js";
import { chartSpecFromConfig, chartSpecToConfig, parseChartSpec, chartSpecJson } from "../src/ui/chart-spec.js";
import { markKey, resetMarkStyles, MUTED } from "../src/ui/chart-mark-colors.js";
import type { AggregateMessage, ColumnMeta } from "../src/worker/protocol.js";

/** Every bar filled: its colour and left edge. */
const bars: { color: string; x: number }[] = [];
/** Every drawing call with the styles in force, to compare two draws exactly. */
const calls: string[] = [];

function setupDom(): Window {
  const window = new Window();
  const globals = globalThis as Record<string, unknown>;
  globals.window = window;
  globals.document = window.document;
  globals.HTMLElement = window.HTMLElement;
  globals.MutationObserver = window.MutationObserver;
  globals.getComputedStyle = window.getComputedStyle.bind(window);
  class RecordingContext {
    font = "";
    fillStyle = "";
    strokeStyle = "";
    lineWidth = 1;
    globalAlpha = 1;
    globalCompositeOperation = "source-over";
    textAlign = "left";
    textBaseline = "alphabetic";
    imageSmoothingEnabled = true;
    private dash: number[] = [];
    private path: [number, number][] = [];
    private readonly stack: { dash: number[]; lineWidth: number }[] = [];
    clearRect(): void {}
    setTransform(): void {}
    scale(): void {}
    beginPath(): void {
      this.path = [];
    }
    closePath(): void {}
    moveTo(x: number, y: number): void {
      this.path.push([x, y]);
    }
    lineTo(x: number, y: number): void {
      this.path.push([x, y]);
    }
    arc(): void {}
    rect(): void {}
    clip(): void {}
    stroke(): void {
      calls.push(`stroke ${String(this.strokeStyle)} ${this.lineWidth} ${this.dash.join()} ${JSON.stringify(this.path)}`);
    }
    fill(): void {
      calls.push(`fill ${String(this.fillStyle)} ${this.globalAlpha} ${JSON.stringify(this.path)}`);
    }
    setLineDash(dash: number[]): void {
      this.dash = [...dash];
    }
    roundRect(x: number, y: number, w: number, h: number): void {
      bars.push({ color: String(this.fillStyle), x });
      this.path.push([x, y], [x + w, y + h]);
    }
    strokeRect(): void {}
    fillRect(): void {}
    drawImage(): void {}
    save(): void {
      this.stack.push({ dash: this.dash, lineWidth: this.lineWidth });
    }
    restore(): void {
      const previous = this.stack.pop();
      if (previous === undefined) return;
      this.dash = previous.dash;
      this.lineWidth = previous.lineWidth;
    }
    translate(): void {}
    rotate(): void {}
    measureText(text: string): { width: number } {
      return { width: String(text).length * 6 };
    }
    fillText(text: string, x: number, y: number): void {
      calls.push(`text ${String(this.fillStyle)} ${text} ${x} ${y}`);
    }
    createImageData(width: number, height: number): { data: Uint8ClampedArray; width: number; height: number } {
      return { data: new Uint8ClampedArray(width * height * 4), width, height };
    }
    getImageData(_x: number, _y: number, width: number, height: number): { data: Uint8ClampedArray; width: number; height: number } {
      return { data: new Uint8ClampedArray(width * height * 4), width, height };
    }
    putImageData(): void {}
    createLinearGradient(): { addColorStop(): void } {
      return { addColorStop(): void {} };
    }
  }
  (window.HTMLCanvasElement.prototype as unknown as { getContext(): unknown }).getContext = (): unknown => new RecordingContext();
  return window;
}

function meta(overrides: Partial<ColumnMeta> = {}): ColumnMeta {
  return {
    name: "col",
    type: "string",
    numberLocale: "dot",
    dateOrder: "dmy",
    stats: { nulls: 0, distinct: 5, samples: [], topValues: [], min: 0, max: 10, mean: 5, stddev: 1, minLength: null, maxLength: null, avgLength: null },
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

function aggregate(labels: string[], values: number[], extra: Partial<AggregateMessage> = {}): AggregateMessage {
  return {
    type: "aggregate",
    requestId: 1,
    viewId: "v",
    labels,
    dimensions: [labels],
    dimensionNames: ["region"],
    dimensionIsTime: [false],
    dimensionTimes: [new Float64Array(labels.length).fill(Number.NaN)],
    measures: [Float64Array.from(values)],
    measureNames: ["sum(amount)"],
    totals: Float64Array.from([values.reduce((a, b) => a + b, 0)]),
    groupCount: labels.length,
    totalGroups: labels.length,
    truncated: false,
    partials: null,
    ms: 1,
    ...extra,
  };
}

function clearLog(): void {
  bars.length = 0;
  calls.length = 0;
}

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function options(overrides: Partial<ChartCardOptions> = {}): ChartCardOptions {
  return {
    datasetName: () => "t.csv",
    requestBins: () => new Promise(() => {}),
    requestSeries: () => new Promise(() => {}),
    requestBoxStats: () => new Promise(() => {}),
    requestCrosstab: () => new Promise(() => {}),
    requestCorrelation: () => new Promise(() => {}),
    requestAggregate: () => new Promise(() => {}),
    requestTextProfile: () => new Promise(() => {}),
    onRemove: () => {},
    onDuplicate: () => {},
    onExport: () => {},
    ...overrides,
  } as ChartCardOptions;
}

const regionMeta = (labels: string[]): ColumnMeta =>
  meta({ name: "region", type: "category", stats: { ...meta().stats, distinct: labels.length }, categories: { labels, counts: labels.map(() => 1) } });
const amountMeta = (): ColumnMeta => meta({ name: "amount", type: "number", stats: { ...meta().stats, min: 0, max: 50, mean: 12, distinct: 500 } });

async function draw(config: Partial<ChartCardConfig>, columns: ColumnMeta[], extra: Partial<ChartCardOptions> = {}): Promise<ChartCard> {
  const host = document.createElement("div");
  const card = new ChartCard(host, options(extra), config);
  const wrap = host.querySelector(".chart-canvas-wrap") as HTMLElement;
  Object.defineProperty(wrap, "clientWidth", { value: 800, configurable: true });
  card.setColumns(columns);
  await tick();
  await tick();
  clearLog();
  card.render();
  return card;
}


const RED = "#d62728";
const placeMeta = (counts: [string, number][]): ColumnMeta =>
  meta({ name: "region", type: "category", categories: { labels: counts.map(([label]) => label), counts: counts.map(([, count]) => count) } });

test("count bars: a colour follows its category through a re-sort, and the others keep theirs", async () => {
  setupDom();
  const card = await draw({ kind: "bar", column: 0, markColors: { [markKey("Sydney")]: RED } }, [placeMeta([["Perth", 10], ["Sydney", 5], ["Hobart", 2]])]);
  assert.equal(bars.length, 3);
  assert.equal(bars[1]!.color, RED, "Sydney (second) is red");
  assert.notEqual(bars[0]!.color, RED);
  assert.notEqual(bars[2]!.color, RED);
  // New counts put Sydney first: the colour goes with it, not with the second place.
  card.setColumns([placeMeta([["Sydney", 20], ["Perth", 10], ["Hobart", 2]])]);
  clearLog();
  card.render();
  assert.deepEqual(bars.map((bar) => bar.color === RED), [true, false, false]);
  card.dispose();
});

test("measure bars: an override sleeps while a filter hides its category and comes back with it", async () => {
  setupDom();
  let answer = aggregate(["a", "b", "c"], [30, 20, 10]);
  const card = await draw(
    { kind: "barplot", column: 0, valueColumn: 1, valueAgg: "sum", markColors: { [markKey("b")]: RED } },
    [regionMeta(["a", "b", "c"]), amountMeta()],
    { requestAggregate: async () => answer },
  );
  assert.deepEqual(bars.map((bar) => bar.color === RED), [false, true, false]);
  answer = aggregate(["a", "c"], [30, 10]);
  card.refreshValue();
  await tick();
  await tick();
  clearLog();
  card.render();
  assert.equal(bars.length, 2);
  assert.ok(bars.every((bar) => bar.color !== RED), "nothing red while b is filtered out");
  assert.deepEqual(card.getConfig().markColors, { [markKey("b")]: RED }, "kept, dormant");
  answer = aggregate(["b", "a", "c"], [40, 30, 10]);
  card.refreshValue();
  await tick();
  await tick();
  clearLog();
  card.render();
  assert.deepEqual(bars.map((bar) => bar.color === RED), [true, false, false], "back, on b, now first");
  card.dispose();
});

test("grouped and stacked bars: one bar of one series, and a whole series", async () => {
  setupDom();
  const split = aggregate(["a", "a", "b", "b"], [10, 5, 4, 2], { dimensions: [["a", "a", "b", "b"], ["x", "y", "x", "y"]], dimensionNames: ["region", "kind"], dimensionIsTime: [false, false] });
  const GREEN = "#00aa00";
  for (const barLayout of ["group", "stack"] as const) {
    const card = await draw(
      { kind: "barplot", column: 0, valueColumn: 1, groupColumn: 2, barLayout, markColors: { [markKey("b", "y")]: RED, [markKey(null, "x")]: GREEN } },
      [regionMeta(["a", "b"]), amountMeta(), regionMeta(["x", "y"])],
      { requestAggregate: async () => split },
    );
    assert.equal(bars.length, 4, barLayout);
    const colors = bars.map((bar) => bar.color);
    assert.equal(colors.filter((color) => color === GREEN).length, 2, `${barLayout}: series x is green`);
    assert.equal(colors.filter((color) => color === RED).length, 1, `${barLayout}: one bar of y is red`);
    assert.equal(colors.filter((color) => color !== RED && color !== GREEN).length, 1, `${barLayout}: the other y bar keeps its colour`);
    assert.ok(card.hitRegions.some((region) => region.mark === markKey("b", "y")), "each bar is a hit region with its key");
    card.dispose();
  }
});

test("highlight keeps one bar in colour and greys the rest; Reset colours clears everything", async () => {
  setupDom();
  const card = await draw(
    { kind: "barplot", column: 0, valueColumn: 1, valueAgg: "sum", markHighlight: markKey("b"), markColors: { [markKey("c")]: RED } },
    [regionMeta(["a", "b", "c"]), amountMeta()],
    { requestAggregate: async () => aggregate(["a", "b", "c"], [30, 20, 10]) },
  );
  const [a, b, c] = bars.map((bar) => bar.color);
  assert.equal(a, c, "the rest share the grey, an own colour too");
  assert.notEqual(a, b);
  assert.notEqual(b, RED);
  resetMarkStyles(card);
  assert.equal(card.getConfig().markHighlight, undefined);
  assert.equal(card.getConfig().markColors, undefined);
  clearLog();
  card.render();
  assert.equal(new Set(bars.map((bar) => bar.color)).size, 1, "one colour again");
  card.dispose();
});

test("no override, an empty one, or one for a category not on the chart draws exactly as before", async () => {
  setupDom();
  const logOf = async (extra: Partial<ChartCardConfig>): Promise<string[]> => {
    const card = await draw(
      { kind: "barplot", column: 0, valueColumn: 1, valueAgg: "sum", ...extra },
      [regionMeta(["a", "b", "c"]), amountMeta()],
      { requestAggregate: async () => aggregate(["a", "b", "c"], [30, 20, 10]) },
    );
    const log = calls.slice();
    card.dispose();
    return log;
  };
  const plain = await logOf({});
  assert.ok(plain.length > 10);
  assert.deepEqual(await logOf({ markColors: {} }), plain);
  assert.deepEqual(await logOf({ markColors: { [markKey("zzz")]: RED } }), plain);
});

test("mark colours survive the ChartSpec round trip; unreadable ones are left out", () => {
  setupDom();
  const columns = [regionMeta(["a", "b"]), amountMeta()];
  const host = document.createElement("div");
  const card = new ChartCard(host, options(), { kind: "barplot", column: 0, valueColumn: 1, markColors: { [markKey("a")]: RED, [markKey(null, "x")]: MUTED }, markHighlight: markKey("a"), markLabels: [markKey("b")] });
  card.setColumns(columns);
  const text = chartSpecJson(chartSpecFromConfig(card.getConfig(), columns));
  const back = parseChartSpec(text, columns).config!;
  assert.deepEqual(back.markColors, { [markKey("a")]: RED, [markKey(null, "x")]: MUTED });
  assert.equal(back.markHighlight, markKey("a"));
  assert.deepEqual(back.markLabels, [markKey("b")]);
  const raw = JSON.parse(text) as { presentation: { markColors: Record<string, unknown> } };
  raw.presentation.markColors[markKey("c")] = "javascript:alert(1)";
  assert.deepEqual(chartSpecToConfig(raw as never, columns).config?.markColors, { [markKey("a")]: RED, [markKey(null, "x")]: MUTED });
  card.dispose();
});

test("clicking a bar on the Chart page offers Colour…, and a swatch recolours that bar only", async () => {
  setupDom();
  const card = await draw(
    { kind: "bar", source: "v1" },
    [amountMeta()],
    { docked: true, requestViewAggregate: async () => aggregate(["a", "b", "c"], [3, 2, 1]) },
  );
  card.setSources([{ id: "v1", name: "Units", kind: "view" }]);
  await tick();
  clearLog();
  card.render();
  const region = card.hitRegions.find((candidate) => candidate.mark === markKey("b"));
  assert.ok(region !== undefined, "a pivot-view bar is a selectable mark although it cannot filter");
  card.selectRegion(region);
  const bar = card.selectionBar!;
  assert.equal(bar.classList.contains("hidden"), false);
  const buttons = (): HTMLButtonElement[] => [...bar.querySelectorAll("button")] as HTMLButtonElement[];
  const colour = buttons().find((button) => button.textContent === "Colour…");
  assert.ok(colour !== undefined);
  assert.equal(buttons().some((button) => button.textContent === "Filter to this"), false, "nothing to filter by on a view");
  colour.click();
  const swatches = bar.querySelectorAll<HTMLButtonElement>(".chart-mark-colors .chart-swatch");
  assert.ok(swatches.length >= 2);
  swatches[1]!.click();
  const chosen = card.getConfig().markColors?.[markKey("b")];
  assert.ok(chosen !== undefined);
  clearLog();
  card.render();
  assert.equal(bars[1]!.color, chosen);
  assert.notEqual(bars[0]!.color, chosen);
  // Escape in the colour row closes it.
  const row = bar.querySelector(".chart-mark-colors")!;
  row.dispatchEvent(new (window as unknown as { KeyboardEvent: typeof KeyboardEvent }).KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  assert.equal(bar.querySelector(".chart-mark-colors"), null);
  card.dispose();
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { ChartCard, type ChartCardConfig, type ChartCardOptions } from "../src/ui/chart-card.js";
import { chartSpecFromConfig, chartSpecToConfig, parseChartSpec, chartSpecJson } from "../src/ui/chart-spec.js";
import { parseRefValue } from "../src/ui/chart-ref-lines.js";
import type { AggregateMessage, ColumnMeta, ChartSeriesMessage, BoxStatsMessage } from "../src/worker/protocol.js";

/** A dashed stroke drawn in the reference-line style, in canvas CSS pixels. */
interface Stroke {
  points: [number, number][];
}

const strokes: Stroke[] = [];
const texts: string[] = [];

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
      // Reference lines are the only strokes dashed 6/4 at 1.5px.
      if (this.dash.join() === "6,4" && this.lineWidth === 1.5) strokes.push({ points: this.path.slice() });
    }
    fill(): void {}
    setLineDash(dash: number[]): void {
      this.dash = [...dash];
    }
    roundRect(): void {}
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
    fillText(text: string): void {
      texts.push(String(text));
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
  strokes.length = 0;
  texts.length = 0;
  card.render();
  return card;
}

const note = (card: ChartCard): string => card.noteEl.textContent ?? "";
const horizontal = (stroke: Stroke): boolean => stroke.points.length === 2 && stroke.points[0]![1] === stroke.points[1]![1];
const vertical = (stroke: Stroke): boolean => stroke.points.length === 2 && stroke.points[0]![0] === stroke.points[1]![0];

/** The pixel a value-axis line should sit at on a vertical axis that starts at 0 and tops out at `top`. */
function expectedY(card: ChartCard, value: number, top: number): number {
  const frame = card.lastFrame!;
  return Math.round(frame.top + frame.plotH - (value / top) * frame.plotH) + 0.5;
}

test("reference values parse thousands, suffixes and percents, and refuse a decimal comma", () => {
  assert.deepEqual(parseRefValue("1,000", false), { value: 1000, error: null });
  assert.deepEqual(parseRefValue("1,234,567.5", false), { value: 1234567.5, error: null });
  assert.deepEqual(parseRefValue("2.5k", false), { value: 2500, error: null });
  assert.deepEqual(parseRefValue("3M", false), { value: 3e6, error: null });
  assert.deepEqual(parseRefValue("-4", false), { value: -4, error: null });
  assert.deepEqual(parseRefValue("0", false), { value: 0, error: null });
  assert.equal(parseRefValue("15%", false).value, 0.15);
  assert.deepEqual(parseRefValue("", false), { value: undefined, error: null });
  // Never guess a decimal comma.
  const comma = parseRefValue("1,5", false);
  assert.equal(comma.value, undefined);
  assert.match(comma.error ?? "", /comma/);
  assert.match(parseRefValue("ten", false).error ?? "", /Not a number/);
  assert.equal(parseRefValue("2021-03-01", true).value, Date.UTC(2021, 2, 1));
});

test("count bars: a line inside the data lands on its value, zero lands on the baseline", async () => {
  setupDom();
  const card = await draw({ kind: "bar", column: 0, refLines: [{ axis: "y", source: "value", value: 5 }, { axis: "y", source: "value", value: 0 }] }, [
    meta({ name: "region", type: "category", categories: { labels: ["Perth", "Sydney"], counts: [10, 5] } }),
  ]);
  assert.equal(strokes.length, 2, "both lines drawn, the zero one too");
  const top = 10 * 1.12;
  assert.equal(strokes[0]!.points[0]![1], expectedY(card, 5, top));
  assert.equal(strokes[1]!.points[0]![1], expectedY(card, 0, top));
  assert.ok(strokes.every(horizontal));
  card.dispose();
});

test("a line above the data stretches the axis to show it; a negative one on a zero-based axis is named, not dropped", async () => {
  setupDom();
  const card = await draw({ kind: "bar", column: 0, refLines: [{ axis: "y", source: "value", value: 40 }, { axis: "y", source: "value", value: -3 }] }, [
    meta({ name: "region", type: "category", categories: { labels: ["Perth", "Sydney"], counts: [10, 5] } }),
  ]);
  assert.equal(strokes.length, 1);
  const frame = card.lastFrame!;
  const y = strokes[0]!.points[0]![1];
  assert.ok(y > frame.top && y < frame.top + frame.plotH, `the line at 40 is inside the plot (y=${y})`);
  assert.match(note(card), /Line at -3 is off the scale/);
  card.dispose();
});

test("measure bars: every aggregate draws the line, not only sum/mean/min/max/count", async () => {
  setupDom();
  for (const agg of ["sum", "median", "p90", "distinct"] as const) {
    const card = await draw(
      { kind: "barplot", column: 0, valueColumn: 1, valueAgg: agg, refLines: [{ axis: "y", source: "value", value: 20 }] },
      [regionMeta(["a", "b", "c"]), amountMeta()],
      { requestAggregate: async () => aggregate(["a", "b", "c"], [30, 10, 5]) },
    );
    assert.equal(strokes.length, 1, `${agg}: drawn`);
    assert.equal(strokes[0]!.points[0]![1], expectedY(card, 20, 30), `${agg}: at 20 on a 0-30 axis`);
    card.dispose();
  }
});

test("a % of total chart reads 15% as 0.15", async () => {
  setupDom();
  const card = await draw(
    { kind: "barplot", column: 0, valueColumn: 1, valueAgg: "sum", valueCalc: "pctTotal", refLines: [{ axis: "y", source: "value", value: parseRefValue("15%", false).value }] },
    [regionMeta(["a", "b"]), amountMeta()],
    { requestAggregate: async () => aggregate(["a", "b"], [0.6, 0.4]) },
  );
  assert.equal(strokes.length, 1);
  assert.equal(strokes[0]!.points[0]![1], expectedY(card, 0.15, 1), "0.6 rounds the axis up to 1 (Math.max(1, max))");
  card.dispose();
});

test("a chart of a pivot view draws its reference line", async () => {
  setupDom();
  const card = await draw(
    { kind: "bar", source: "v1", refLines: [{ axis: "y", source: "value", value: 2 }] },
    [amountMeta()],
    { requestViewAggregate: async () => aggregate(["a", "b", "c", "d"], [1, 2, 3, 4]) },
  );
  card.setSources([{ id: "v1", name: "Units", kind: "view" }]);
  await tick();
  strokes.length = 0;
  card.render();
  assert.equal(strokes.length, 1);
  assert.equal(strokes[0]!.points[0]![1], expectedY(card, 2, 4));
  card.dispose();
});

test("grouped and stacked bars draw the line on their shared axis", async () => {
  setupDom();
  const split = aggregate(["a", "a", "b", "b"], [10, 5, 4, 2], { dimensions: [["a", "a", "b", "b"], ["x", "y", "x", "y"]], dimensionNames: ["region", "kind"], dimensionIsTime: [false, false] });
  for (const barLayout of ["group", "stack"] as const) {
    const card = await draw(
      { kind: "barplot", column: 0, valueColumn: 1, groupColumn: 2, barLayout, refLines: [{ axis: "y", source: "value", value: 3 }] },
      [regionMeta(["a", "b"]), amountMeta(), regionMeta(["x", "y"])],
      { requestAggregate: async () => split },
    );
    assert.equal(strokes.length, 1, `${barLayout}: drawn`);
    assert.equal(strokes[0]!.points[0]![1], expectedY(card, 3, barLayout === "stack" ? 15 : 10));
    card.dispose();
  }
});

test("many bars lie on their side and the value line runs up the plot at its value", async () => {
  setupDom();
  const labels = Array.from({ length: 20 }, (_, i) => `P${i}`);
  const card = await draw(
    { kind: "barplot", column: 0, valueColumn: 1, valueAgg: "sum", refLines: [{ axis: "y", source: "value", value: 50 }] },
    [regionMeta(labels), amountMeta()],
    { requestAggregate: async () => aggregate(labels, labels.map((_, i) => 200 - i * 5)) },
  );
  assert.equal(strokes.length, 1);
  assert.ok(vertical(strokes[0]!), "a vertical line on a horizontal value axis");
  const axis = card.refAxis!;
  assert.equal(axis.y.across, false);
  assert.equal(axis.y.min, 0);
  assert.equal(strokes[0]!.points[0]![0], Math.round(axis.y.from + (50 / axis.y.max) * (axis.y.to - axis.y.from)) + 0.5);
  card.dispose();
});

test("a column mean is not drawn on a Sum axis (wrong units); the average of the bars is", async () => {
  setupDom();
  const card = await draw(
    { kind: "barplot", column: 0, valueColumn: 1, valueAgg: "sum", refLines: [{ axis: "y", source: "mean" }, { axis: "y", source: "average" }] },
    [regionMeta(["a", "b", "c"]), amountMeta()],
    { requestAggregate: async () => aggregate(["a", "b", "c"], [30, 10, 5]) },
  );
  assert.equal(strokes.length, 1);
  assert.equal(strokes[0]!.points[0]![1], expectedY(card, 15, 30));
  assert.ok(texts.includes("average 15"));
  assert.match(note(card), /column mean is not drawn/);
  card.dispose();
});

test("on a mean axis the column mean is drawn", async () => {
  setupDom();
  const card = await draw(
    { kind: "barplot", column: 0, valueColumn: 1, valueAgg: "mean", refLines: [{ axis: "y", source: "mean" }] },
    [regionMeta(["a", "b"]), amountMeta()],
    { requestAggregate: async () => aggregate(["a", "b"], [30, 10]) },
  );
  assert.equal(strokes.length, 1);
  assert.equal(strokes[0]!.points[0]![1], expectedY(card, 12, 30));
  card.dispose();
});

function points(): ChartSeriesMessage {
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
    result: { mode: "points", x: Float64Array.from([1, 2]), y: Float64Array.from([2, 3]), colorValues: null, colorCodes: null, size: null, shown: 2, total: 2, outside: 0, xMin: 0, xMax: 4, yMin: 0, yMax: 4, sampled: false },
  };
}

test("scatter: lines on both axes, and a Y line beyond the data widens the axis", async () => {
  setupDom();
  const numbers = [meta({ name: "x", type: "number" }), meta({ name: "y", type: "number" })];
  const card = await draw(
    { kind: "scatter", x: 0, y: 1, refLines: [{ axis: "y", source: "value", value: 8 }, { axis: "x", source: "value", value: 2 }] },
    numbers,
    { requestSeries: async () => points() },
  );
  assert.equal(strokes.length, 2);
  const space = card.brushSpace!;
  assert.ok(space.yMax! >= 8, "the Y axis reaches the line");
  assert.ok(horizontal(strokes[0]!) && vertical(strokes[1]!));
  const y = strokes[0]!.points[0]![1];
  assert.ok(y >= space.top && y <= space.top + space.plotH);
  assert.equal(strokes[1]!.points[0]![0], Math.round(space.left + (2 / 4) * space.plotW) + 0.5);
  card.dispose();
});

test("box plot: the control shows and the line is drawn on the value axis", async () => {
  setupDom();
  const box: BoxStatsMessage = {
    type: "boxStats",
    requestId: 1,
    valueColumn: 0,
    categoryColumn: 1,
    ms: 1,
    result: {
      groups: [{ label: "a", count: 3, min: 1, q1: 1.5, median: 2, q3: 2.5, max: 3, whiskerLow: 1, whiskerHigh: 3, outliers: new Float64Array(0), outlierCount: 0, other: false }],
      total: 3,
      otherCount: 0,
    },
  } as unknown as BoxStatsMessage;
  const card = await draw(
    { kind: "box", x: 0, y: 1, refLines: [{ axis: "y", source: "value", value: 2 }] },
    [amountMeta(), regionMeta(["a"])],
    { requestBoxStats: async () => box },
  );
  assert.equal(card.hasValueAxis(), true, "the control is offered");
  assert.equal(strokes.length, 1);
  card.dispose();
});

test("the line survives a type change, a ChartSpec round trip and a PNG export", async () => {
  setupDom();
  const columns = [regionMeta(["a", "b"]), amountMeta(), meta({ name: "when", type: "date", stats: { ...meta().stats, min: 0, max: 1e11 } })];
  const day = 86_400_000;
  const timed = aggregate(["2024-01-01", "2024-01-02"], [10, 5], { dimensionIsTime: [true], dimensionTimes: [Float64Array.from([Date.UTC(2024, 0, 1), Date.UTC(2024, 0, 1) + day])] });
  const card = await draw(
    { kind: "barplot", column: 0, valueColumn: 1, valueAgg: "sum", refLines: [{ axis: "y", source: "value", value: 7 }] },
    columns,
    { requestAggregate: async (view) => ((view.dimensions[0] as { column: number }).column === 2 ? timed : aggregate(["a", "b"], [10, 5])) },
  );
  assert.equal(strokes.length, 1);

  card.applyConfig({ kind: "line", column: 2 });
  for (let i = 0; i < 5; i++) await tick();
  strokes.length = 0;
  card.render();
  assert.deepEqual(card.getConfig().refLines, [{ axis: "y", source: "value", value: 7 }]);
  assert.equal(strokes.length, 1, `still drawn after Bar -> Line: ${note(card)}`);

  const spec = chartSpecFromConfig(card.getConfig(), columns);
  const back = chartSpecToConfig(spec, columns).config;
  assert.deepEqual(back?.refLines, [{ axis: "y", source: "value", value: 7 }]);
  const text = chartSpecJson(spec);
  assert.deepEqual(parseChartSpec(text, columns).config?.refLines, [{ axis: "y", source: "value", value: 7 }]);
  // A hand-edited spec with a broken line is refused with a reason, like any other bad field (specs apply atomically).
  const broken = JSON.parse(text) as { presentation: { refLines: unknown[] } };
  broken.presentation.refLines.push({ axis: "z" }, "nonsense");
  const parsed = parseChartSpec(JSON.stringify(broken), columns);
  assert.ok(parsed.issues.some((issue) => /reference lines/.test(issue)), parsed.issues.join("; "));

  strokes.length = 0;
  card.exportPng(1600, 900);
  assert.ok(strokes.length >= 1, "the export canvas has the line");
  card.dispose();
});

test("typing a value that is not a number says so and keeps the line where it was", async () => {
  setupDom();
  const card = await draw(
    { kind: "bar", column: 0, refLines: [{ axis: "y", source: "value", value: 5 }] },
    [meta({ name: "region", type: "category", categories: { labels: ["Perth", "Sydney"], counts: [10, 5] } })],
  );
  card.syncRefLines();
  const input = card.refRows.querySelector<HTMLInputElement>(".chart-ref-value")!;
  const error = card.refRows.querySelector<HTMLElement>(".chart-ref-error")!;
  input.value = "1,5";
  input.dispatchEvent(new (window as unknown as { Event: typeof Event }).Event("input"));
  assert.equal(card.getConfig().refLines?.[0]?.value, 5, "the line stays at 5");
  assert.equal(error.classList.contains("hidden"), false);
  assert.equal(input.getAttribute("aria-invalid"), "true");
  input.value = "7";
  input.dispatchEvent(new (window as unknown as { Event: typeof Event }).Event("input"));
  assert.equal(card.getConfig().refLines?.[0]?.value, 7);
  assert.equal(error.classList.contains("hidden"), true);
  // Undo (or an applied spec) that changes only the value shows it in the field.
  card.applyConfig({ refLines: [{ axis: "y", source: "value", value: 3 }] });
  card.syncRefLines();
  assert.equal(card.refRows.querySelector<HTMLInputElement>(".chart-ref-value")!.value, "3");
  card.dispose();
});

test("a vertical line on a chart whose X is categories is named in the note, not silently dropped", async () => {
  setupDom();
  const card = await draw(
    { kind: "barplot", column: 0, valueColumn: 1, valueAgg: "sum", refLines: [{ axis: "x", source: "value", value: 3 }] },
    [regionMeta(["a", "b"]), amountMeta()],
    { requestAggregate: async () => aggregate(["a", "b"], [10, 5]) },
  );
  assert.equal(strokes.length, 0);
  assert.match(note(card), /X axis is not numeric/);
  card.dispose();
});

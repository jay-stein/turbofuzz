import { test } from "node:test";
import assert from "node:assert/strict";

interface WorkerMessage {
  type: string;
  requestId: number;
  [key: string]: unknown;
}

test("worker serves grid counts and animation frames", async () => {
  const responses: WorkerMessage[] = [];
  let onmessage: ((event: { data: WorkerMessage }) => void) | null = null;

  (globalThis as Record<string, unknown>).self = {
    set onmessage(handler: (event: { data: WorkerMessage }) => void) {
      onmessage = handler;
    },
    get onmessage(): ((event: { data: WorkerMessage }) => void) | null {
      return onmessage;
    },
    postMessage: (message: WorkerMessage): void => {
      responses.push(message);
    },
  };

  await import("../src/worker/search.worker.js");
  assert.ok(onmessage !== null, "worker registered onmessage");

  const send = (data: WorkerMessage): void => {
    onmessage?.({ data });
  };
  const find = (type: string, requestId: number): WorkerMessage => {
    const message = responses.find((r) => r.type === type && r.requestId === requestId);
    assert.ok(message !== undefined, `expected ${type}#${requestId}`);
    return message;
  };

  send({
    type: "load",
    requestId: 1,
    name: "t",
    delimiter: "auto",
    hasHeaders: true,
    text: [
      "lat,lon,status,when",
      "1.5,10.0,closed,2024-01-05",
      "1.6,10.1,closed,2024-01-06",
      "2.5,11.0,open,2024-02-07",
      "3.5,12.0,pending,2024-02-08",
      "1.5,10.0,open,2024-03-09",
    ].join("\n"),
  });
  find("loaded", 1);

  send({ type: "getGridCounts", requestId: 2, xColumn: 0, yColumn: 1, bins: 4 });
  const grid = find("gridCounts", 2) as unknown as {
    result: {
      bins: number;
      total: number;
      maxCount: number;
      counts: Uint32Array;
      xMin: number;
      xMax: number;
    };
  };
  assert.equal(grid.result.bins, 4);
  assert.equal(grid.result.total, 5);
  assert.ok(grid.result.maxCount >= 2, "two January rows share a cell");
  assert.equal(grid.result.xMin, 1.5);
  assert.equal(grid.result.xMax, 3.5);

  send({
    type: "getAnimation",
    requestId: 3,
    timeColumn: 3,
    grain: "month",
    chart: "bar",
    column: 2,
    yColumn: -1,
    topN: 5,
  });
  const bars = find("animation", 3) as unknown as {
    result: {
      frames: { label: string }[];
      total: number;
      missing: number;
      bar: { labels: string[]; counts: Uint32Array };
    };
  };
  assert.deepEqual(
    bars.result.frames.map((frame) => frame.label),
    ["2024-01", "2024-02", "2024-03"],
  );
  assert.equal(bars.result.total, 5);
  assert.equal(bars.result.bar.labels.length, 3, "closed, open, pending");
  const width = bars.result.bar.labels.length;
  assert.deepEqual([...bars.result.bar.counts.slice(0, width)], [2, 0, 0]);
  assert.deepEqual([...bars.result.bar.counts.slice(width, width * 2)], [0, 1, 1]);

  send({
    type: "getAnimation",
    requestId: 4,
    timeColumn: 3,
    grain: "month",
    chart: "bubble",
    column: 0,
    yColumn: 1,
    bins: 4,
  });
  const bubbles = find("animation", 4) as unknown as {
    result: {
      frames: { label: string }[];
      maxCount: number;
      bubble: { bins: number; grids: Uint32Array };
    };
  };
  assert.equal(bubbles.result.frames.length, 3);
  assert.equal(bubbles.result.bubble.bins, 4);
  assert.equal(bubbles.result.maxCount, 2);
  const cellCount = 16;
  const january = bubbles.result.bubble.grids.slice(0, cellCount);
  assert.equal([...january].reduce((sum, value) => sum + value, 0), 2);

  send({
    type: "getGridCounts",
    requestId: 8,
    xColumn: 0,
    yColumn: 1,
    bins: 4,
    groupColumn: 2,
  });
  const grouped = find("gridCounts", 8) as unknown as {
    result: { groups: { label: string; counts: Uint32Array }[] | null };
  };
  assert.ok(grouped.result.groups !== null, "grouping returns one grid per category");
  assert.deepEqual(
    grouped.result.groups?.map((group) => group.label),
    ["closed", "open", "pending"],
  );
  assert.equal(
    grouped.result.groups?.reduce(
      (sum, group) => sum + group.counts.reduce((a, b) => a + b, 0),
      0,
    ),
    5,
    "every row lands in exactly one group grid",
  );

  send({
    type: "getGridCounts",
    requestId: 6,
    xColumn: 0,
    yColumn: 1,
    bins: 4,
    measure: { column: 0, agg: "sum" },
  });
  const measured = find("gridCounts", 6) as unknown as {
    result: { values: Float64Array | null; valueMax: number; counts: Uint32Array };
  };
  assert.ok(measured.result.values !== null, "the worker aggregates the measure per cell");
  assert.ok(measured.result.valueMax >= 1.5);
  assert.equal(
    measured.result.values?.length,
    measured.result.counts.length,
    "one value per grid cell",
  );

  send({
    type: "getAnimation",
    requestId: 7,
    timeColumn: 3,
    grain: "month",
    chart: "bubble",
    column: 0,
    yColumn: 1,
    bins: 4,
    measure: { column: 0, agg: "mean" },
  });
  const measuredFrames = find("animation", 7) as unknown as {
    result: { bubble: { values: Float64Array | null; valueMax: number; grids: Uint32Array } };
  };
  assert.ok(measuredFrames.result.bubble.values !== null);
  assert.equal(
    measuredFrames.result.bubble.values?.length,
    measuredFrames.result.bubble.grids.length,
  );

  send({
    type: "getAnimation",
    requestId: 5,
    timeColumn: 3,
    grain: "month",
    chart: "histogram",
    column: 0,
    yColumn: -1,
    bins: 4,
  });
  const histogram = find("animation", 5) as unknown as {
    result: {
      frames: { label: string }[];
      maxCount: number;
      hist: { bins: number; min: number; max: number; counts: Uint32Array };
    };
  };
  assert.equal(histogram.result.frames.length, 3);
  assert.equal(histogram.result.hist.bins, 4);
  assert.equal(histogram.result.hist.min, 1.5);
  assert.equal(histogram.result.hist.max, 3.5);
  assert.ok(histogram.result.maxCount >= 1, "bins receive rows across frames");
});

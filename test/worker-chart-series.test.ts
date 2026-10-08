import { test } from "node:test";
import assert from "node:assert/strict";

interface WorkerMessage {
  type: string;
  requestId: number;
  [key: string]: unknown;
}

test("worker serves scatter points and density grids for chart cards", async () => {
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
    text: "x,y,c\n1,2,a\n2,4,b\n3,6,a\n4,8,a",
  });
  find("loaded", 1);

  send({
    type: "getChartSeries",
    requestId: 2,
    xColumn: 0,
    yColumn: 1,
    colorColumn: 2,
    mode: "points",
    limit: 100,
  });
  const points = find("chartSeries", 2) as unknown as {
    colorLabels: string[] | null;
    result: {
      mode: string;
      shown: number;
      total: number;
      x: Float64Array;
      y: Float64Array;
      colorCodes: Uint16Array | null;
    };
  };
  assert.equal(points.result.mode, "points");
  assert.equal(points.result.shown, 4);
  assert.equal(points.result.total, 4);
  assert.deepEqual([...points.result.x], [1, 2, 3, 4]);
  assert.deepEqual([...points.result.y], [2, 4, 6, 8]);
  assert.deepEqual(points.colorLabels, ["a", "b"]);
  assert.ok(points.result.colorCodes !== null);
  assert.deepEqual([...points.result.colorCodes], [0, 1, 0, 0]);

  send({
    type: "getChartSeries",
    requestId: 3,
    xColumn: 0,
    yColumn: 1,
    mode: "density",
    limit: 100,
  });
  const density = find("chartSeries", 3) as unknown as {
    result: { mode: string; counts: Uint32Array; total: number; max: number };
  };
  assert.equal(density.result.mode, "density");
  assert.equal(density.result.total, 4);
  assert.equal(density.result.counts.reduce((sum, count) => sum + count, 0), 4);
  assert.equal(density.result.max, 1);

  send({
    type: "getChartSeries",
    requestId: 4,
    xColumn: 0,
    yColumn: 1,
    column: 0,
    mode: "auto",
    limit: 2,
  });
  const auto = find("chartSeries", 4) as unknown as { result: { mode: string } };
  assert.equal(auto.result.mode, "density");
});

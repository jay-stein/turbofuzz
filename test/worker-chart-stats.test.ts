import { test } from "node:test";
import assert from "node:assert/strict";

interface WorkerMessage {
  type: string;
  requestId: number;
  [key: string]: unknown;
}

test("worker serves box, crosstab and correlation stats for chart cards", async () => {
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
    text: "x,y,c,g\n1,2,a,red\n2,4,b,red\n3,6,a,blue\n4,8,a,blue",
  });
  find("loaded", 1);

  send({
    type: "getBoxStats",
    requestId: 2,
    valueColumn: 0,
    categoryColumn: 2,
    topN: 5,
    groupOther: true,
  });
  const box = find("boxStats", 2) as unknown as {
    ms: number;
    result: {
      groups: { label: string; count: number; median: number; outliers: Float64Array }[];
      total: number;
    };
  };
  assert.equal(box.result.total, 4);
  assert.equal(box.result.groups.length, 2);
  assert.deepEqual(
    box.result.groups.map((group) => [group.label, group.count]),
    [
      ["a", 3],
      ["b", 1],
    ],
  );
  assert.equal(box.result.groups[0].median, 3);
  assert.ok(box.ms >= 0);

  send({
    type: "getCrosstab",
    requestId: 3,
    xColumn: 2,
    yColumn: 3,
    topX: 5,
    topY: 5,
    groupOther: true,
  });
  const cross = find("crosstab", 3) as unknown as {
    result: { xLabels: string[]; yLabels: string[]; counts: Uint32Array; total: number };
  };
  assert.deepEqual(cross.result.xLabels, ["a", "b"]);
  assert.deepEqual(cross.result.yLabels, ["blue", "red"]);
  assert.deepEqual([...cross.result.counts], [2, 0, 1, 1]);
  assert.equal(cross.result.total, 4);

  send({ type: "getCorrelation", requestId: 4, columns: [0, 1] });
  const correlation = find("correlation", 4) as unknown as {
    columns: number[];
    labels: string[];
    result: { values: Float64Array; counts: Uint32Array };
  };
  assert.deepEqual(correlation.columns, [0, 1]);
  assert.deepEqual(correlation.labels, ["x", "y"]);
  assert.equal(correlation.result.values[1], 1);
  assert.equal(correlation.result.counts[1], 4);

  send({ type: "getCorrelation", requestId: 5, columns: [0, 99, 0] });
  const sanitized = find("correlation", 5) as unknown as { columns: number[] };
  assert.deepEqual(sanitized.columns, [0]);
});

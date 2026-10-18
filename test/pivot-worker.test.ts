import { test } from "node:test";
import assert from "node:assert/strict";
import type { PivotDef } from "../src/data/pivot.js";

interface WorkerMessage {
  type: string;
  requestId: number;
  [key: string]: unknown;
}

test("the worker serves an assembled pivot matrix", async () => {
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
  const send = (data: WorkerMessage): void => onmessage?.({ data });
  const find = (type: string, requestId: number): WorkerMessage => {
    const message = responses.find(
      (entry) => entry.type === type && entry.requestId === requestId,
    );
    assert.ok(message !== undefined, `expected ${type}#${requestId}`);
    return message;
  };

  send({
    type: "load",
    requestId: 1,
    name: "sales.csv",
    delimiter: "auto",
    hasHeaders: true,
    text: "region,category,amount\nNorth,A,10\nNorth,B,5\nSouth,A,20\nSouth,A,10\nEast,B,7",
  });
  find("loaded", 1);

  const pivot: PivotDef = {
    id: "p1",
    name: "Sales pivot",
    index: [{ column: 0, by: "value" }],
    columns: [{ column: 1, by: "value" }],
    values: [{ column: 2, agg: "sum" }],
    respectFilters: true,
    margins: true,
  };
  send({ type: "getPivot", requestId: 2, pivot });
  const message = find("pivot", 2) as unknown as {
    pivotId: string;
    rowLabels: string[][];
    colLabels: string[][];
    measures: { values: Float64Array; grandTotal: number }[];
  };
  assert.equal(message.pivotId, "p1");
  assert.deepEqual(message.rowLabels, [["East"], ["North"], ["South"], ["All"]]);
  assert.deepEqual(message.colLabels, [["A"], ["B"], ["All"]]);
  assert.equal(message.measures[0].grandTotal, 52);
  assert.equal(message.measures[0].values[11], 52);
});

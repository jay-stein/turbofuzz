import { test } from "node:test";
import assert from "node:assert/strict";
import type { ViewDef } from "../src/data/aggregate.js";

interface WorkerMessage {
  type: string;
  requestId: number;
  [key: string]: unknown;
}

test("a chart-level aggregate filter narrows to one category", async () => {
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
    name: "teams.csv",
    delimiter: "auto",
    hasHeaders: true,
    text: "team,amount\nAlpha,10\nBeta,20\nAlpha,30",
  });
  find("loaded", 1);

  const view: ViewDef = {
    id: "chart-filter",
    name: "Alpha",
    dimensions: [{ column: 0, by: "value" }],
    measures: [{ column: 1, agg: "sum" }],
    fill: "none",
    sort: { key: "m0", dir: "desc" },
    limit: 10,
    respectFilters: true,
    filterColumn: 0,
    filterCode: 0,
  };
  send({ type: "getAggregate", requestId: 2, view });
  const aggregate = find("aggregate", 2) as unknown as {
    labels: string[];
    measures: Float64Array[];
  };
  assert.deepEqual(aggregate.labels, ["Alpha"]);
  assert.equal(aggregate.measures[0][0], 40);
});

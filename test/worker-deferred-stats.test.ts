import { test } from "node:test";
import assert from "node:assert/strict";

interface WorkerMessage {
  type: string;
  requestId: number;
  [key: string]: unknown;
}

test("deferred load opens rows before dataset metrics are finalized", async () => {
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
  assert.ok(onmessage !== null);
  const send = (data: WorkerMessage): void => onmessage?.({ data });
  const find = (type: string, requestId: number): WorkerMessage => {
    const message = responses.find((response) => response.type === type && response.requestId === requestId);
    assert.ok(message !== undefined, `expected ${type}#${requestId}`);
    return message;
  };

  send({
    type: "load",
    requestId: 1,
    name: "deferred.csv",
    delimiter: "auto",
    hasHeaders: true,
    buffer: new TextEncoder().encode("id,value\n1,a\n1,a\n2,b").buffer,
    deferStats: true,
  });
  await new Promise((resolve) => setTimeout(resolve, 60));
  const loaded = find("loaded", 1) as unknown as {
    statsPending?: boolean;
    stats: { duplicateRows: number };
    columns: { anomalyCounts: { values: number } }[];
  };
  assert.equal(loaded.statsPending, true);
  assert.equal(loaded.stats.duplicateRows, 0);

  send({ type: "finalizeStats", requestId: 2 });
  await new Promise((resolve) => setTimeout(resolve, 80));
  const finalized = find("datasetStats", 2) as unknown as {
    stats: { duplicateRows: number };
    columns: { anomalyCounts: { values: number } }[];
    count: number;
  };
  assert.equal(finalized.stats.duplicateRows, 1);
  assert.equal(finalized.count, 3);
  assert.ok(Array.isArray(finalized.columns));
});
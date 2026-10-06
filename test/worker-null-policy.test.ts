import { test } from "node:test";
import assert from "node:assert/strict";

interface WorkerMessage {
  type: string;
  requestId: number;
  [key: string]: unknown;
}

test("setNullPolicy un-nulls a real value and rebuilds stats", async () => {
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

  const send = (data: WorkerMessage): void => onmessage?.({ data });
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
    text: "town,state\nNULL,NSW\nSydney,NSW\nN/A,VIC",
  });
  const loaded = find("loaded", 1) as unknown as { stats: { totalNullCells: number } };
  // "NULL" and "N/A" are both treated as null at ingest.
  assert.equal(loaded.stats.totalNullCells, 2);

  send({ type: "setNullPolicy", requestId: 2, column: 0, extra: [], keep: ["NULL"] });
  const cleaned = find("cleaned", 2) as unknown as {
    columns: {
      column: number;
      meta: { stats: { nulls: number }; categories: { labels: string[] } | null };
    }[];
    stats: { totalNullCells: number };
  };
  assert.equal(cleaned.columns[0].meta.stats.nulls, 1); // only N/A remains null
  assert.equal(cleaned.stats.totalNullCells, 1);
  assert.ok(cleaned.columns[0].meta.categories?.labels.includes("NULL"));

  // Adding a custom null token excludes it from the numeric stats.
  send({
    type: "load",
    requestId: 3,
    name: "t2",
    delimiter: "auto",
    hasHeaders: true,
    text: "amount\n10\n-999\n20",
  });
  send({ type: "setNullPolicy", requestId: 4, column: 0, extra: ["-999"], keep: [] });
  const numeric = find("cleaned", 4) as unknown as {
    columns: { meta: { stats: { nulls: number; mean: number | null } } }[];
  };
  assert.equal(numeric.columns[0].meta.stats.nulls, 1);
  assert.equal(numeric.columns[0].meta.stats.mean, 15);
});

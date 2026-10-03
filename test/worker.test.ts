import { test } from "node:test";
import assert from "node:assert/strict";

interface WorkerMessage {
  type: string;
  requestId: number;
  [key: string]: unknown;
}

test("search worker handles the full request lifecycle", async () => {
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
    text: "name,age\nAlice,30\nBob,40\nCara,50",
  });
  const loaded = find("loaded", 1);
  assert.equal(loaded.rowCount, 3);
  assert.deepEqual(loaded.headers, ["name", "age"]);

  send({ type: "getRows", requestId: 2, start: 0, end: 2 });
  const rows = find("rows", 2) as unknown as { rows: string[][] };
  assert.deepEqual(rows.rows[0], ["Alice", "30"]);
  assert.deepEqual(rows.rows[1], ["Bob", "40"]);

  send({
    type: "setFilter",
    requestId: 3,
    column: 0,
    filter: { kind: "text", mode: "contains", query: "alice" },
  });
  assert.equal(find("results", 3).count, 1);

  send({ type: "getRows", requestId: 4, start: 0, end: 5 });
  const filtered = find("rows", 4) as unknown as { rows: string[][] };
  assert.equal(filtered.rows.length, 1);
  assert.deepEqual(filtered.rows[0], ["Alice", "30"]);

  send({ type: "sort", requestId: 5, column: 1, dir: -1 });
  assert.equal(find("sorted", 5).count, 1);

  send({ type: "getStats", requestId: 6 });
  const stats = find("stats", 6) as unknown as {
    rowCount: number;
    columns: { mean: number | null }[];
  };
  assert.equal(stats.rowCount, 3);
  assert.equal(stats.columns[1].mean, 40);

  send({ type: "setType", requestId: 7, column: 1, columnType: "number" });
  const meta = find("columnMeta", 7) as unknown as { meta: { type: string }; count: number };
  assert.equal(meta.meta.type, "number");
  assert.equal(meta.count, 1);

  send({ type: "clearFilters", requestId: 8 });
  assert.equal(find("results", 8).count, 3);
});

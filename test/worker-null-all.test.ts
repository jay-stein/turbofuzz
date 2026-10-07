import { test } from "node:test";
import assert from "node:assert/strict";

interface WorkerMessage {
  type: string;
  requestId: number;
  [key: string]: unknown;
}

test("resolveNullsAll blanks nulls across every column in one pass", async () => {
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
    text: "town,note\nNULL,N/A\nSydney,ok\nAdelaide,N/A",
  });
  const loaded = find("loaded", 1) as unknown as { stats: { totalNullCells: number } };
  assert.equal(loaded.stats.totalNullCells, 3);

  // One pass: keep the town called NULL everywhere, blank every other null.
  send({ type: "resolveNullsAll", requestId: 2, extra: [], keep: ["NULL"] });
  const cleaned = find("cleaned", 2) as unknown as {
    columns: { column: number; meta: { name: string; stats: { nulls: number } } }[];
    stats: { totalNullCells: number };
  };
  assert.equal(cleaned.columns.length, 2);
  assert.equal(cleaned.columns[0].meta.stats.nulls, 0);
  assert.equal(cleaned.columns[1].meta.stats.nulls, 2);
  assert.equal(cleaned.stats.totalNullCells, 2);

  send({ type: "getRows", requestId: 3, start: 0, end: 3 });
  const rows = find("rows", 3) as unknown as { rows: string[][] };
  assert.deepEqual(rows.rows, [
    ["NULL", ""],
    ["Sydney", "ok"],
    ["Adelaide", ""],
  ]);
});

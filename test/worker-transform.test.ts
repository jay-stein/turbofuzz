import { test } from "node:test";
import assert from "node:assert/strict";

interface WorkerMessage {
  type: string;
  requestId: number;
  [key: string]: unknown;
}

test("transform applies a pipeline, rebuilds the dataset and resets", async () => {
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
    text: "city,sales\nSydney,10\nSydney,10\nMelbourne,20",
  });
  find("loaded", 1);

  send({ type: "transform", requestId: 2, ops: [{ kind: "dedupe", keep: "first" }] });
  const deduped = find("transformed", 2) as unknown as {
    rowCount: number;
    baseSchema: { name: string; numeric: boolean }[];
    ops: unknown[];
  };
  assert.equal(deduped.rowCount, 2);
  assert.deepEqual(deduped.baseSchema, [
    { name: "city", numeric: false },
    { name: "sales", numeric: true },
  ]);
  assert.equal(deduped.ops.length, 1);

  // Chained group-by is re-derived from the base with the dedupe already applied.
  send({
    type: "transform",
    requestId: 3,
    ops: [
      { kind: "dedupe", keep: "first" },
      { kind: "groupBy", dimension: 0, measure: 1, aggregate: "sum" },
    ],
  });
  const grouped = find("transformed", 3) as unknown as { rowCount: number; headers: string[] };
  assert.equal(grouped.rowCount, 2);
  assert.deepEqual(grouped.headers, ["city", "Sum(sales)"]);

  send({ type: "getRows", requestId: 4, start: 0, end: 5 });
  const groupedRows = find("rows", 4) as unknown as { rows: string[][] };
  assert.deepEqual(groupedRows.rows, [
    ["Melbourne", "20"],
    ["Sydney", "10"],
  ]);

  // Empty op list restores the captured base exactly.
  send({ type: "transform", requestId: 5, ops: [] });
  const reset = find("transformed", 5) as unknown as { rowCount: number; ops: unknown[] };
  assert.equal(reset.rowCount, 3);
  assert.equal(reset.ops.length, 0);

  send({ type: "getRows", requestId: 6, start: 0, end: 5 });
  const original = find("rows", 6) as unknown as { rows: string[][] };
  assert.equal(original.rows.length, 3);
  assert.deepEqual(original.rows[0], ["Sydney", "10"]);
});

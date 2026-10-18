import { test } from "node:test";
import assert from "node:assert/strict";

interface WorkerMessage {
  type: string;
  requestId: number;
  [key: string]: unknown;
}

test("cast failures persist as a reviewable row filter", async () => {
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
    const message = responses.find((entry) => entry.type === type && entry.requestId === requestId);
    assert.ok(message !== undefined, `expected ${type}#${requestId}`);
    return message;
  };

  send({
    type: "load",
    requestId: 1,
    name: "cast",
    delimiter: "auto",
    hasHeaders: true,
    text: "amount\n1\noops\n3",
  });
  find("loaded", 1);
  send({
    type: "cleanColumns",
    requestId: 2,
    updates: [
      {
        column: 0,
        ops: [
          { kind: "cast", target: "number", policy: "coerce", locale: "dot", order: "dmy" },
        ],
      },
    ],
  });
  const cleaned = find("cleaned", 2) as unknown as {
    castFailures: { column: number; count: number }[];
  };
  assert.deepEqual(cleaned.castFailures, [{ column: 0, count: 1 }]);

  send({ type: "setSpecial", requestId: 3, kind: "castFailures", active: true });
  const review = find("results", 3) as unknown as { count: number };
  assert.equal(review.count, 1, "only the failing source row is shown");

  send({
    type: "cleanColumns",
    requestId: 4,
    updates: [{ column: 0, ops: [] }],
  });
  const reverted = find("cleaned", 4) as unknown as {
    castFailures: { column: number; count: number }[];
  };
  assert.deepEqual(reverted.castFailures, []);
});
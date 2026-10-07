import { test } from "node:test";
import assert from "node:assert/strict";

interface WorkerMessage {
  type: string;
  requestId: number;
  [key: string]: unknown;
}

test("convert ops canonicalise values and keep inferred types", async () => {
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
    name: "euro",
    delimiter: "auto",
    hasHeaders: true,
    text: "umsatz;when\n1.234,56;05/03/2024\nN/A;13/04/2024",
  });
  find("loaded", 1);

  send({
    type: "cleanColumns",
    requestId: 2,
    updates: [
      { column: 0, ops: [{ kind: "toNumber", locale: "comma" }] },
      { column: 1, ops: [{ kind: "toDate", order: "dmy" }] },
    ],
  });
  const cleaned = find("cleaned", 2) as unknown as {
    columns: { column: number; meta: { type: string } }[];
  };
  assert.equal(cleaned.columns[0].meta.type, "number");
  assert.equal(cleaned.columns[1].meta.type, "date");

  send({ type: "getRows", requestId: 3, start: 0, end: 2 });
  const rows = find("rows", 3) as unknown as { rows: string[][] };
  assert.deepEqual(rows.rows, [
    ["1234.56", "2024-03-05"],
    ["N/A", "2024-04-13"],
  ]);
});

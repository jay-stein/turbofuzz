import { test } from "node:test";
import assert from "node:assert/strict";

interface WorkerMessage {
  type: string;
  requestId: number;
  [key: string]: unknown;
}

test("shuffle reorders the same rows and keeps flags", async () => {
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

  const values: string[] = [];
  for (let i = 0; i < 200; i++) values.push(i === 0 || i === 199 ? "dup" : `v${i}`);
  send({
    type: "load",
    requestId: 1,
    name: "t",
    delimiter: "auto",
    hasHeaders: true,
    text: ["n", ...values].join("\n"),
  });
  const loaded = find("loaded", 1) as unknown as { rowCount: number; stats: { rowsInDuplicateGroups: number } };
  assert.equal(loaded.rowCount, 200);
  assert.equal(loaded.stats.rowsInDuplicateGroups, 2);

  send({ type: "shuffle", requestId: 2 });
  const shuffled = find("shuffled", 2) as unknown as {
    count: number;
    firstRows: string[][];
    firstFlags: Uint8Array;
  };
  assert.equal(shuffled.count, 200);
  assert.equal(shuffled.firstRows.length, 40);
  assert.equal(shuffled.firstFlags.length, 40);

  send({ type: "getRows", requestId: 3, start: 0, end: 200 });
  const rows = find("rows", 3) as unknown as { rows: string[][]; flags: Uint8Array };
  assert.equal(rows.rows.length, 200);
  assert.deepEqual(
    rows.rows.map((row) => row[0]).sort(),
    values.slice().sort(),
  );
  assert.deepEqual(rows.rows.slice(0, 40), shuffled.firstRows);

  let flagged = 0;
  for (const flag of rows.flags) flagged += flag & 1;
  assert.equal(flagged, 2);

  send({ type: "shuffle", requestId: 4, limit: 25 });
  const limited = find("shuffled", 4) as unknown as {
    count: number;
    firstRows: string[][];
    firstFlags: Uint8Array;
  };
  assert.equal(limited.count, 25);
  assert.equal(limited.firstRows.length, 25);
  assert.equal(limited.firstFlags.length, 25);

  send({ type: "getRows", requestId: 5, start: 0, end: 25 });
  const limitedRows = find("rows", 5) as unknown as { rows: string[][] };
  assert.equal(limitedRows.rows.length, 25);
  assert.deepEqual(limitedRows.rows, limited.firstRows);

  send({ type: "shuffle", requestId: 6, limit: 1000 });
  assert.equal(find("shuffled", 6).count, 25);
});

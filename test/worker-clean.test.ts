import { test } from "node:test";
import assert from "node:assert/strict";

interface WorkerMessage {
  type: string;
  requestId: number;
  [key: string]: unknown;
}

test("cleanColumns applies value cleans, rebuilds stats and can revert", async () => {
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
    text: "name,age\n alice ,30\nALICE,30\nbob,50",
  });
  find("loaded", 1);

  // Turn on the duplicates view before cleaning: the clean rebuild replaces the
  // query engine, so this verifies active specials survive it.
  send({ type: "setSpecial", requestId: 2, kind: "duplicates", active: true });
  const before = find("results", 2) as unknown as { count: number };
  assert.equal(before.count, 0);

  // Clean: trim + uppercase the name column.
  send({
    type: "cleanColumns",
    requestId: 3,
    updates: [{ column: 0, ops: [{ kind: "trim" }, { kind: "case", style: "upper" }] }],
  });
  const cleaned = find("cleaned", 3) as unknown as {
    columns: { column: number; meta: { name: string; type: string } }[];
    stats: { duplicateRows: number };
    count: number;
  };
  assert.equal(cleaned.columns.length, 1);
  assert.equal(cleaned.columns[0].column, 0);
  assert.equal(cleaned.columns[0].meta.name, "name");
  // Two formerly distinct rows are now identical and the duplicates view is still on.
  assert.equal(cleaned.stats.duplicateRows, 1);
  assert.equal(cleaned.count, 2);

  send({ type: "getRows", requestId: 4, start: 0, end: 3 });
  const rows = find("rows", 4) as unknown as { rows: string[][] };
  assert.deepEqual(rows.rows.map((row) => row[0]), ["ALICE", "ALICE"]);

  // An empty op list restores the untouched source values exactly.
  send({
    type: "cleanColumns",
    requestId: 5,
    updates: [{ column: 0, ops: [] }],
  });
  const reverted = find("cleaned", 5) as unknown as { stats: { duplicateRows: number } };
  assert.equal(reverted.stats.duplicateRows, 0);

  // Turn the duplicates view off to see the full reverted column.
  send({ type: "setSpecial", requestId: 6, kind: "duplicates", active: false });
  assert.equal(find("results", 6).count, 3);

  send({ type: "getRows", requestId: 7, start: 0, end: 3 });
  const revertedRows = find("rows", 7) as unknown as { rows: string[][] };
  assert.deepEqual(revertedRows.rows.map((row) => row[0]), [" alice ", "ALICE", "bob"]);
});

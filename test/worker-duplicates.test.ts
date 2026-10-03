import { test } from "node:test";
import assert from "node:assert/strict";

interface WorkerMessage {
  type: string;
  requestId: number;
  [key: string]: unknown;
}

test("duplicates toggle groups identical rows together with separators", async () => {
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
    name: "dupes",
    delimiter: "auto",
    hasHeaders: true,
    text: "name,city\na,x\nb,y\na,x\nc,z\nb,y\nd,w",
  });
  assert.equal(find("loaded", 1).rowCount, 6);

  send({ type: "setSpecial", requestId: 2, kind: "duplicates", active: true });
  const results = find("results", 2) as unknown as {
    count: number;
    firstRows: string[][];
    firstGroups: boolean[];
  };
  assert.equal(results.count, 4);
  assert.equal(results.firstRows.length, 4);
  assert.equal(results.firstGroups.filter(Boolean).length, 2, "one separator per group");
  assert.equal(results.firstGroups[0], true);

  // Identical rows must be adjacent: pairs (0,1) and (2,3).
  assert.deepEqual(results.firstRows[0], results.firstRows[1]);
  assert.deepEqual(results.firstRows[2], results.firstRows[3]);
  assert.notDeepEqual(results.firstRows[1], results.firstRows[2]);

  // Paging keeps the group separators.
  send({ type: "getRows", requestId: 3, start: 0, end: 4 });
  const page = find("rows", 3) as unknown as { rows: string[][]; groups: boolean[] };
  assert.deepEqual(page.rows, results.firstRows);
  assert.deepEqual(page.groups, results.firstGroups);

  send({ type: "getRows", requestId: 4, start: 2, end: 4 });
  const tail = find("rows", 4) as unknown as { groups: boolean[] };
  assert.deepEqual(tail.groups, [true, false]);

  send({ type: "setSpecial", requestId: 5, kind: "duplicates", active: false });
  assert.equal(find("results", 5).count, 6);
});

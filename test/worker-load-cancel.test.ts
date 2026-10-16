import { test } from "node:test";
import assert from "node:assert/strict";

interface WorkerMessage {
  type: string;
  requestId?: number;
  [key: string]: unknown;
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function harness(): {
  responses: WorkerMessage[];
  send: (data: WorkerMessage) => void;
  find: (type: string, requestId: number) => WorkerMessage;
} {
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
  return {
    responses,
    send: (data) => onmessage?.({ data }),
    find: (type, requestId) => {
      const message = responses.find(
        (entry) => entry.type === type && entry.requestId === requestId,
      );
      assert.ok(message !== undefined, `expected ${type}#${requestId}`);
      return message;
    },
  };
}

// One harness for the file: the worker module captures `self` at import time,
// so the stub must exist before the import and is shared by every test.
const { responses, send, find } = harness();
let workerReady: Promise<void> | null = null;
const ensureWorker = (): Promise<void> => {
  workerReady ??= import("../src/worker/search.worker.js").then(() => undefined);
  return workerReady;
};

function bigTable(columns: number, rows: number): { rows: string[][]; hasHeaders: boolean } {
  return {
    rows: Array.from({ length: rows }, () => Array.from({ length: columns }, (_, c) => String(c))),
    hasHeaders: true,
  };
}

test("cancelling a big load keeps the previous dataset", async () => {
  await ensureWorker();

  send({
    type: "load",
    requestId: 1,
    name: "seed",
    delimiter: "auto",
    hasHeaders: true,
    text: "city,sales\nSydney,10\nPerth,20",
  });
  assert.equal(find("loaded", 1).rowCount, 2);

  // 200 x 300 cells is above the cancellable threshold; the build yields
  // between columns so the cancel message can land mid-build.
  send({
    type: "load",
    requestId: 2,
    name: "big",
    delimiter: "auto",
    hasHeaders: true,
    table: bigTable(200, 300),
  });
  send({ type: "cancelLoad" });
  for (let i = 0; i < 10; i++) await flush();

  const cancelled = find("loadCancelled", 2);
  assert.equal(cancelled.requestId, 2);
  assert.equal(
    responses.some((entry) => entry.type === "loaded" && entry.requestId === 2),
    false,
    "a cancelled load never swaps the dataset",
  );

  send({ type: "getRows", requestId: 3, start: 0, end: 2 });
  await flush();
  const rows = find("rows", 3) as unknown as { rows: string[][] };
  assert.deepEqual(rows.rows[0], ["Sydney", "10"], "the previous dataset is intact");
});

test("big loads report phased progress tied to the load request", async () => {
  await ensureWorker();

  send({
    type: "load",
    requestId: 5,
    name: "big",
    delimiter: "auto",
    hasHeaders: true,
    table: bigTable(200, 300),
  });
  for (let i = 0; i < 200; i++) {
    await flush();
    if (responses.some((entry) => entry.type === "loaded" && entry.requestId === 5)) break;
  }
  find("loaded", 5);

  const allProgress = responses.filter((entry) => entry.type === "progress");
  assert.ok(allProgress.length > 0);
  assert.ok(
    allProgress.every((entry) => entry.requestId !== undefined),
    "load progress carries the load requestId",
  );
  const progress = allProgress.filter((entry) => entry.requestId === 5);
  assert.ok(progress.length > 0, "progress for the successful load is present");
  const phases = new Set(progress.map((entry) => entry.phase));
  for (const phase of ["infer", "build", "stats", "ready"]) {
    assert.ok(phases.has(phase), `expected a ${phase} progress event`);
  }
});

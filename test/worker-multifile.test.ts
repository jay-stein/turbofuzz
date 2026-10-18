import { test } from "node:test";
import assert from "node:assert/strict";

interface WorkerMessage {
  type: string;
  requestId: number;
  [key: string]: unknown;
}

test("the worker reports multi-file metadata and source", async () => {
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
  const send = (data: WorkerMessage): void => onmessage?.({ data });
  const find = (type: string, requestId: number): WorkerMessage => {
    const message = responses.find((response) => response.type === type && response.requestId === requestId);
    assert.ok(message !== undefined, `expected ${type}#${requestId}`);
    return message;
  };

  send({
    type: "load",
    requestId: 1,
    name: "2 files",
    delimiter: "auto",
    hasHeaders: true,
    files: [
      { name: "a.csv", text: "id,value\n1,a\n2,b" },
      { name: "b.csv", text: "id,value\n3,c" },
    ],
  });
  await new Promise((resolve) => setTimeout(resolve, 80));
  const loaded = find("loaded", 1) as unknown as {
    source: string;
    rowCount: number;
    files?: { name: string; rowCount: number; delimiter: string | null }[];
  };
  assert.equal(loaded.source, "multi");
  assert.equal(loaded.rowCount, 3);
  assert.deepEqual(loaded.files?.map((file) => file.name), ["a.csv", "b.csv"]);
  assert.deepEqual(loaded.files?.map((file) => file.rowCount), [2, 1]);
  assert.equal(loaded.files?.[0]?.delimiter, ",");
});
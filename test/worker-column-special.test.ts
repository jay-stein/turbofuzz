import { test } from "node:test";
import assert from "node:assert/strict";

interface WorkerMessage {
  type: string;
  requestId: number;
  [key: string]: unknown;
}

test("worker applies per-column specials and reports anomaly counts", async () => {
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
    text: "a,b\n1,x\n,x\n3,y\n5,x\n7,\n,z",
  });
  find("loaded", 1);

  send({ type: "setSpecial", requestId: 2, kind: "nulls", active: true, column: 0 });
  assert.equal((find("results", 2) as unknown as { count: number }).count, 2);

  send({ type: "setSpecial", requestId: 3, kind: "nulls", active: false, column: 0 });
  assert.equal((find("results", 3) as unknown as { count: number }).count, 6);

  send({ type: "setSpecial", requestId: 4, kind: "nulls", active: true, column: 1 });
  assert.equal((find("results", 4) as unknown as { count: number }).count, 1);

  // A fresh load exposes per-column anomaly counts in the column metadata.
  const rows: string[][] = [];
  for (let i = 0; i < 40; i++) rows.push([String(i + 1), String(i + 1)]);
  rows[39][1] = "1000000";
  send({
    type: "load",
    requestId: 5,
    name: "t2",
    delimiter: "auto",
    hasHeaders: true,
    text: ["a,b", ...rows.map((row) => row.join(","))].join("\n"),
  });
  const loaded = find("loaded", 5) as unknown as {
    columns: { anomalyCounts: { values: number; lengths: number } }[];
  };
  assert.equal(loaded.columns[0].anomalyCounts.values, 0);
  assert.ok(loaded.columns[1].anomalyCounts.values >= 1);
});

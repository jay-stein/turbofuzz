import { test } from "node:test";
import assert from "node:assert/strict";

interface WorkerMessage {
  type: string;
  requestId: number;
  [key: string]: unknown;
}

function rows(): string {
  const lines = ["region,amount"];
  for (let index = 0; index < 30; index++) lines.push(`A,${95 + (index % 11)}`);
  lines.push("A,5000");
  for (let index = 0; index < 30; index++) lines.push(`B,${4 + (index % 3)}`);
  return lines.join("\n");
}

test("worker computes group anomalies and filters to them", async () => {
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
    text: rows(),
  });
  find("loaded", 1);

  send({ type: "getGroupAnomalies", requestId: 2 });
  const anomalies = find("groupAnomalies", 2) as unknown as {
    pairs: { valueColumn: number; flagged: number }[];
    totalFlagged: number;
  };
  assert.equal(anomalies.totalFlagged, 1);
  assert.equal(anomalies.pairs.length, 1);

  // Show rows: the special filters the result set to the flagged row.
  send({ type: "setSpecial", requestId: 3, kind: "groupAnomalies", active: true, column: 1 });
  const filtered = find("results", 3) as unknown as { count: number };
  assert.equal(filtered.count, 1);

  send({ type: "setSpecial", requestId: 4, kind: "groupAnomalies", active: false, column: 1 });
  const restored = find("results", 4) as unknown as { count: number };
  assert.equal(restored.count, 61);
});

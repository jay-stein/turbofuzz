import { test } from "node:test";
import assert from "node:assert/strict";

interface WorkerMessage {
  type: string;
  requestId?: number;
  [key: string]: unknown;
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

test("the sensitive scan streams every text column, cancels, and can go exact", async () => {
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
  const until = async (predicate: () => boolean): Promise<void> => {
    for (let i = 0; i < 400 && !predicate(); i++) await wait(5);
    assert.ok(predicate(), "timed out");
  };

  // 16 text columns: more than the old 12-column cap.
  const names = Array.from({ length: 16 }, (_, c) => (c === 3 ? "email" : `label_${c}`));
  const lines = [names.join(",")];
  for (let r = 0; r < 6200; r++) {
    lines.push(names.map((_, c) => (c === 3 ? `user${r}@example.com` : `v${(r + c) % 9}`)).join(","));
  }
  send({ type: "load", requestId: 1, name: "t", delimiter: "auto", hasHeaders: true, text: lines.join("\n") });
  await until(() => responses.some((r) => r.type === "loaded"));

  send({ type: "scanSensitive", requestId: 10 });
  await until(() => responses.some((r) => r.type === "sensitiveDone" && r.requestId === 10));
  const columns = responses.filter((r) => r.type === "sensitiveColumn" && r.requestId === 10);
  assert.equal(columns.length, 16, "no 12-column cap");
  const email = columns.map((r) => r.input as { name: string; shapes: { email: number }; sampled: number; scanned: number })
    .find((input) => input.name === "email");
  assert.equal(email?.sampled, 5000, "bounded sample");
  assert.equal(email?.scanned, 6200, "reports how many values the column has");
  assert.equal(email?.shapes.email, 5000);
  assert.equal(columns.every((r) => r.exact === false), true);

  // Exact scan of one column reads every value.
  send({ type: "scanSensitive", requestId: 11, columns: [3], exact: true });
  await until(() => responses.some((r) => r.type === "sensitiveDone" && r.requestId === 11));
  const exact = responses.find((r) => r.type === "sensitiveColumn" && r.requestId === 11);
  assert.equal((exact?.input as { sampled: number }).sampled, 6200);
  assert.equal(exact?.exact, true);

  // Cancel stops the pass before all columns are done.
  send({ type: "scanSensitive", requestId: 12 });
  send({ type: "cancelScan", scanId: 12 });
  await until(() => responses.some((r) => r.type === "sensitiveDone" && r.requestId === 12));
  const done = responses.find((r) => r.type === "sensitiveDone" && r.requestId === 12);
  assert.equal(done?.cancelled, true);
  assert.ok(responses.filter((r) => r.type === "sensitiveColumn" && r.requestId === 12).length < 16);
});

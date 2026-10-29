import { test } from "node:test";
import assert from "node:assert/strict";

interface WorkerMessage {
  type: string;
  requestId?: number;
  [key: string]: unknown;
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

test("rows affected counts distinct rows failing a check and the filter shows exactly them", async () => {
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

  // 200 rows: status spelled three ways, 20 placeholder "N/A" rows (some overlap with nothing else).
  const lines = ["id,status,qty"];
  for (let i = 0; i < 200; i++) {
    const status = i < 20 ? "N/A" : i % 4 === 0 ? "active" : i % 4 === 1 ? "ACTIVE" : "Active";
    const qty = i % 50 === 0 ? "oops" : String((i % 5) + 1);
    lines.push(`${i},${status},${qty}`);
  }
  send({ type: "load", requestId: 1, name: "t", delimiter: "auto", hasHeaders: true, text: lines.join("\n") });
  await until(() => responses.some((r) => r.type === "loaded"));

  send({ type: "getRowsAffected", requestId: 2 });
  await until(() => responses.some((r) => r.type === "error" || r.type === "rowsAffected"));
  const message = responses.find((r) => r.type === "rowsAffected" || r.type === "error");
  assert.equal(message?.type, "rowsAffected", JSON.stringify(message));
  assert.equal(message?.total, 200);
  const count = message?.count as number;
  // Placeholders (20) + minority spellings among the other 180 + "oops" rows that are not already counted.
  assert.ok(count >= 20 + 90 && count <= 200, `count ${count}`);

  send({ type: "setSpecial", requestId: 3, kind: "affectedRows", active: true });
  await until(() => responses.some((r) => r.type === "results" && r.requestId === 3));
  const results = responses.find((r) => r.type === "results" && r.requestId === 3);
  assert.equal(results?.count, count, "the filter shows exactly the counted rows");
});

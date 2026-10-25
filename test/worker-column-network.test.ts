import { test } from "node:test";
import assert from "node:assert/strict";

interface WorkerMessage {
  type: string;
  requestId: number;
  [key: string]: unknown;
}

test("worker serves a column network with text associations", async () => {
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
    const message = responses.find((entry) => entry.type === type && entry.requestId === requestId);
    assert.ok(message !== undefined, `expected ${type}#${requestId}`);
    return message;
  };

  const lines = ["customer_id,amount,region,notes,message"];
  for (let row = 0; row < 120; row++) {
    const first = row < 60;
    lines.push(
      `${row + 1},${first ? 10 + (row % 5) : 100 + (row % 5)},${first ? "A" : "B"},${
        first ? `urgent delivery ref ${row}` : `routine pickup ref ${row}`
      },${first ? `delivery customer ${row}` : `pickup customer ${row}`}`,
    );
  }

  send({
    type: "load",
    requestId: 1,
    name: "network",
    delimiter: "auto",
    hasHeaders: true,
    text: lines.join("\n"),
  });
  assert.equal(find("loaded", 1).rowCount, 120);

  send({ type: "getColumnNetwork", requestId: 2, respectFilters: true });
  const network = find("columnNetwork", 2) as unknown as {
    nodes: { label: string; role: string }[];
    edges: { method: string; aLabel: string; bLabel: string }[];
    analyzedRows: number;
    totalRows: number;
    sampled: boolean;
  };

  assert.ok(network.nodes.some((node) => node.label === "notes" && node.role === "text"));
  assert.ok(!network.nodes.some((node) => node.label === "customer_id"));
  assert.ok(
    network.edges.some(
      (edge) =>
        edge.method === "tokenOverlap" &&
        [edge.aLabel, edge.bLabel].includes("notes") &&
        [edge.aLabel, edge.bLabel].includes("message"),
    ),
  );
  assert.ok(network.edges.some((edge) => edge.method === "cramersV"));
  assert.ok(network.edges.some((edge) => edge.method === "eta2"));
  assert.equal(network.totalRows, 120);
  assert.equal(network.analyzedRows, 120);
  assert.equal(network.sampled, false);
});

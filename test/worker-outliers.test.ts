import { test } from "node:test";
import assert from "node:assert/strict";

interface WorkerMessage {
  type: string;
  requestId: number;
  [key: string]: unknown;
}

function rows(): string {
  const lines = ["a,b,c"];
  for (let row = 0; row < 160; row++) {
    const base = (row % 31) * 1.25;
    lines.push(
      row === 73
        ? "900,1200,-700"
        : `${base + 0.5},${base * 2 + 1},${base * -1 + 2}`,
    );
  }
  return lines.join("\n");
}

test("worker runs an outlier analysis and filters the table to the flagged rows", async () => {
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
    name: "outliers",
    delimiter: "auto",
    hasHeaders: true,
    text: rows(),
  });
  find("loaded", 1);

  send({
    type: "getOutlierAnalysis",
    requestId: 2,
    method: "isolationForest",
    columns: [0, 1, 2],
    contamination: 0.01,
    mode: "quick",
    seed: 42,
    respectFilters: true,
  });
  const analysis = find("outlierAnalysis", 2);
  const scores = analysis.scores as Float32Array;
  const rowIndices = analysis.rowIndices as Uint32Array;
  assert.ok(scores instanceof Float32Array);
  assert.ok(rowIndices instanceof Uint32Array);
  assert.equal(analysis.analyzed, 160);
  assert.ok((analysis.flagged as number) >= 1);
  assert.ok(rowIndices.includes(73), "the planted row is analysed");
  assert.ok((analysis.details as unknown[]).length >= 1);
  const visualRows = analysis.visualRows as Uint32Array;
  const details = analysis.details as { row: number }[];
  assert.ok(
    details.some((detail) => visualRows.includes(detail.row)),
    "ranked detail rows are included in the landscape sample",
  );

  send({ type: "setSpecial", requestId: 3, kind: "outliers", active: true });
  const filtered = find("results", 3) as unknown as { count: number };
  assert.equal(filtered.count, analysis.flagged);

  send({ type: "setSpecial", requestId: 4, kind: "outliers", active: false });
  const restored = find("results", 4) as unknown as { count: number };
  assert.equal(restored.count, 160);

  send({
    type: "getOutlierAnalysis",
    requestId: 5,
    method: "pca",
    columns: [0],
    contamination: 0.01,
    mode: "quick",
    respectFilters: true,
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const error = responses.find(
    (message) => message.type === "error" && message.requestId === 5,
  );
  assert.ok(error !== undefined);
  assert.match(String(error.message), /numeric/i);
});

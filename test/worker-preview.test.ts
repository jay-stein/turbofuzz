import { test } from "node:test";
import assert from "node:assert/strict";

interface WorkerMessage {
  type: string;
  requestId: number;
  [key: string]: unknown;
}

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
const { send, find } = harness();
let workerReady: Promise<void> | null = null;
const ensureWorker = (): Promise<void> => {
  workerReady ??= import("../src/worker/search.worker.js").then(() => undefined);
  return workerReady;
};

test("transform previews explain each step with counts and samples", async () => {
  await ensureWorker();
  send({
    type: "load",
    requestId: 1,
    name: "preview",
    delimiter: "auto",
    hasHeaders: true,
    text: "when,amount\n2024-01-05,12.5\n2024-02-11,\n2024-03-02,7.5\n2024-03-02,7.5",
  });
  find("loaded", 1);

  send({
    type: "previewTransform",
    requestId: 2,
    ops: [
      { kind: "impute", column: 1, strategy: { kind: "mean" }, groupColumn: null },
      { kind: "dedupe", keep: "first" },
    ],
  });
  const preview = find("transformPreview", 2) as unknown as {
    notes: { op: number; text: string; samples?: { before: string; after: string }[] }[];
  };
  assert.equal(preview.notes.length, 2);
  assert.equal(preview.notes[0].op, 0);
  assert.match(preview.notes[0].text, /Fills 1 missing cell \(mean\)/);
  assert.equal(preview.notes[0].samples?.[0]?.before, "(empty)");
  assert.match(
    preview.notes[0].samples?.[0]?.after ?? "",
    /^9\.166/,
    "mean of 12.5, 7.5 and 7.5 before the dedupe step",
  );
  assert.match(preview.notes[1].text, /Removes 1 identical row/);
});

test("clean previews count unparseable cast values", async () => {
  await ensureWorker();
  send({
    type: "load",
    requestId: 11,
    name: "casts",
    delimiter: "auto",
    hasHeaders: true,
    text: "amount\n12.5\nnot a number\n7.5",
  });
  find("loaded", 11);

  send({
    type: "previewClean",
    requestId: 12,
    updates: [{ column: 0, ops: [{ kind: "toNumber", locale: "dot" }] }],
  });
  const preview = find("cleanPreview", 12) as unknown as {
    columns: { column: number; changed: number; total: number; failed: number }[];
  };
  assert.equal(preview.columns[0].failed, 1, "“not a number” cannot be parsed");
  assert.equal(preview.columns[0].changed, 0, "parseable values are already canonical");
});

test("clean previews report cast examples and policy failures", async () => {
  await ensureWorker();
  send({
    type: "load",
    requestId: 13,
    name: "cast-preview",
    delimiter: "auto",
    hasHeaders: true,
    text: "amount\n1\n2.5\nT\nNA",
  });
  find("loaded", 13);

  send({
    type: "previewClean",
    requestId: 14,
    updates: [
      {
        column: 0,
        ops: [{ kind: "cast", target: "integer", policy: "coerce" }],
      },
    ],
  });
  const preview = find("cleanPreview", 14) as unknown as {
    columns: { changed: number; failed: number; examples?: string[] }[];
  };
  assert.equal(preview.columns[0].failed, 2);
  assert.deepEqual(preview.columns[0].examples, ["2.5", "T"]);
  assert.equal(preview.columns[0].changed, 2);
});

test("combineDate previews name the output, the order and failed rows", async () => {
  await ensureWorker();
  send({
    type: "load",
    requestId: 21,
    name: "dates",
    delimiter: "auto",
    hasHeaders: true,
    text: "year,month,day\n2024,3,5\n2024,13,40",
  });
  find("loaded", 21);

  send({
    type: "previewTransform",
    requestId: 22,
    ops: [
      {
        kind: "combineDate",
        parts: [
          { column: 0, role: "year" },
          { column: 1, role: "month" },
          { column: 2, role: "day" },
        ],
        output: "date",
        outputName: "when",
        order: "auto",
        timeZone: "naive",
        dropParts: true,
      },
    ],
  });
  const preview = find("transformPreview", 22) as unknown as {
    notes: { text: string; samples?: { before: string; after: string }[] }[];
  };
  assert.match(preview.notes[0].text, /Joins 3 parts into “when” \(date, order per column\)/);
  assert.match(preview.notes[0].text, /1 row could not be combined/);
  assert.match(preview.notes[0].samples?.[0]?.before ?? "", /2024 · 13 · 40/);
});

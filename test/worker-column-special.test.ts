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
  send({ type: "setSpecial", requestId: 5, kind: "nulls", active: false, column: 1 });

  // Deleting rows removes them from the working set; clearing restores them.
  send({ type: "dropRows", requestId: 6, positions: [0, 1] });
  assert.equal((find("results", 6) as unknown as { count: number }).count, 4);
  send({ type: "getRows", requestId: 7, start: 0, end: 1 });
  const afterDrop = find("rows", 7) as unknown as { rows: string[][] };
  assert.deepEqual(afterDrop.rows[0]?.[0], "3");

  send({ type: "clearExcludedRows", requestId: 8 });
  assert.equal((find("results", 8) as unknown as { count: number }).count, 6);

  // A fresh load exposes per-column anomaly counts in the column metadata.
  const rows: string[][] = [];
  for (let i = 0; i < 40; i++) rows.push([String(i + 1), String(i + 1)]);
  rows[39][1] = "1000000";
  send({
    type: "load",
    requestId: 9,
    name: "t2",
    delimiter: "auto",
    hasHeaders: true,
    text: ["a,b", ...rows.map((row) => row.join(","))].join("\n"),
  });
  const loaded = find("loaded", 9) as unknown as {
    columns: { anomalyCounts: { values: number; lengths: number } }[];
  };
  assert.equal(loaded.columns[0].anomalyCounts.values, 0);
  assert.ok(loaded.columns[1].anomalyCounts.values >= 1);

  // Pattern validity: a dominant mask ("A-9") and the off-format rows it flags.
  const codes: string[] = [];
  for (let i = 0; i < 60; i++) codes.push(`AB-${1000 + i}`);
  codes.push("broken", "AB1000");
  send({
    type: "load",
    requestId: 10,
    name: "t3",
    delimiter: "auto",
    hasHeaders: true,
    text: ["code,n", ...codes.map((code, i) => `${code},${i}`)].join("\n"),
  });
  const patterned = find("loaded", 10) as unknown as {
    columns: { pattern?: { mask: string; offCount: number; examples: string[] } | null }[];
  };
  assert.equal(patterned.columns[0].pattern?.mask, "A-9");
  assert.equal(patterned.columns[0].pattern?.offCount, 2);
  assert.deepEqual(patterned.columns[0].pattern?.examples, ["broken", "AB1000"]);

  send({ type: "setSpecial", requestId: 11, kind: "pattern", active: true, column: 0 });
  assert.equal((find("results", 11) as unknown as { count: number }).count, 2);
  send({ type: "setSpecial", requestId: 12, kind: "pattern", active: false, column: 0 });
  assert.equal((find("results", 12) as unknown as { count: number }).count, 62);

  // Type changes report the values that cannot be represented in the new type.
  send({
    type: "load",
    requestId: 13,
    name: "t4",
    delimiter: "auto",
    hasHeaders: true,
    text: "n\n1\n2\nx\n2.5\n0",
  });
  find("loaded", 13);
  send({ type: "setType", requestId: 14, column: 0, columnType: "integer" });
  const changed = find("columnMeta", 14) as unknown as {
    nonParsing?: number;
    meta: { type: string };
  };
  assert.equal(changed.meta.type, "integer");
  assert.equal(changed.nonParsing, 2, "the text and decimal values are counted");

  // Composite-key duplicates: store bits, activate the special, filter to them.
  send({
    type: "load",
    requestId: 15,
    name: "t5",
    delimiter: "auto",
    hasHeaders: true,
    text: "a,b\n1,x\n1,x\n1,y\n2,x\n",
  });
  find("loaded", 15);
  send({ type: "checkKeyDuplicates", requestId: 16, columns: [0, 1] });
  const keyed = find("keyDuplicates", 16) as unknown as {
    duplicateRows: number;
    duplicateGroups: number;
    count: number;
  };
  assert.equal(keyed.duplicateRows, 1);
  assert.equal(keyed.duplicateGroups, 1);
  assert.equal(keyed.count, 2, "the view is filtered to the duplicate group");
  send({ type: "setSpecial", requestId: 17, kind: "keyDuplicates", active: false });
  assert.equal((find("results", 17) as unknown as { count: number }).count, 4);

  // Pair checks: compare two columns and filter to the failing rows.
  send({
    type: "load",
    requestId: 18,
    name: "t6",
    delimiter: "auto",
    hasHeaders: true,
    text: "start,end\n1,2\n2,1\n3,3\n",
  });
  find("loaded", 18);
  send({ type: "checkPair", requestId: 19, columnA: 0, columnB: 1, operator: "gte" });
  const pair = find("pairCheck", 19) as unknown as {
    violations: number;
    compared: number;
    count: number;
  };
  assert.equal(pair.compared, 3);
  assert.equal(pair.violations, 1);
  assert.equal(pair.count, 1, "the view is filtered to the failing row");
  send({ type: "setSpecial", requestId: 20, kind: "pairCheck", active: false });
  assert.equal((find("results", 20) as unknown as { count: number }).count, 3);
});

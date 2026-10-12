import { test } from "node:test";
import assert from "node:assert/strict";

interface WorkerMessage {
  type: string;
  requestId: number;
  [key: string]: unknown;
}

test("search worker handles the full request lifecycle", async () => {
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

  const send = (data: WorkerMessage): void => {
    onmessage?.({ data });
  };
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
    text: "name,age\nAlice,30\nBob,40\nCara,50",
  });
  const loaded = find("loaded", 1);
  assert.equal(loaded.rowCount, 3);
  assert.deepEqual(loaded.headers, ["name", "age"]);

  send({ type: "getRows", requestId: 2, start: 0, end: 2 });
  const rows = find("rows", 2) as unknown as { rows: string[][] };
  assert.deepEqual(rows.rows[0], ["Alice", "30"]);
  assert.deepEqual(rows.rows[1], ["Bob", "40"]);

  send({
    type: "setFilter",
    requestId: 3,
    column: 0,
    filter: { kind: "text", mode: "contains", query: "alice" },
  });
  const filteredResults = find("results", 3) as unknown as {
    count: number;
    facets: Record<number, number[]>;
  };
  assert.equal(filteredResults.count, 1);
  assert.deepEqual(filteredResults.facets[0], [1, 1, 1]);

  send({ type: "getRows", requestId: 4, start: 0, end: 5 });
  const filtered = find("rows", 4) as unknown as { rows: string[][] };
  assert.equal(filtered.rows.length, 1);
  assert.deepEqual(filtered.rows[0], ["Alice", "30"]);

  send({ type: "sort", requestId: 5, column: 1, dir: -1 });
  assert.equal(find("sorted", 5).count, 1);

  send({ type: "getStats", requestId: 6 });
  const stats = find("stats", 6) as unknown as {
    rowCount: number;
    columns: { mean: number | null }[];
  };
  assert.equal(stats.rowCount, 3);
  assert.equal(stats.columns[1].mean, 40);

  send({ type: "setType", requestId: 7, column: 1, columnType: "number" });
  const meta = find("columnMeta", 7) as unknown as { meta: { type: string }; count: number };
  assert.equal(meta.meta.type, "number");
  assert.equal(meta.count, 1);

  send({ type: "clearFilters", requestId: 8 });
  assert.equal(find("results", 8).count, 3);

  send({
    type: "setFilter",
    requestId: 9,
    column: 1,
    filter: { kind: "range", min: 35, max: 50 },
  });
  const rangeResults = find("results", 9) as unknown as {
    count: number;
    histograms: Record<number, number[]>;
  };
  assert.equal(rangeResults.count, 2);
  const histogram = rangeResults.histograms[1];
  assert.ok(Array.isArray(histogram), "range column histogram present");
  assert.equal(
    histogram.reduce((total, value) => total + value, 0),
    3,
    "histogram excludes the column's own filter",
  );

  send({
    type: "setFilter",
    requestId: 13,
    column: 1,
    filter: { kind: "range", min: 35, max: null },
    preview: true,
  });
  const preview = find("results", 13) as unknown as {
    count: number;
    facets: Record<number, number[]>;
    histograms: Record<number, number[]>;
  };
  assert.equal(preview.count, 2);
  assert.deepEqual(preview.facets, {});
  assert.deepEqual(preview.histograms, {});

  send({ type: "setSpecial", requestId: 14, kind: "duplicates", active: true });
  assert.equal(find("results", 14).count, 0);
  send({ type: "setSpecial", requestId: 15, kind: "duplicates", active: false });
  // the preview range filter from request 13 is still active
  assert.equal(find("results", 15).count, 2);

  send({ type: "clearFilters", requestId: 10 });
  assert.equal(find("results", 10).count, 3);

  send({ type: "startExport", requestId: 11 });
  const exportStarted = find("exportStarted", 11) as unknown as { total: number };
  assert.equal(exportStarted.total, 3);

  send({ type: "getCsv", requestId: 12, start: 0, end: 3 });
  const csv = find("csv", 12) as unknown as { text: string };
  assert.equal(csv.text, "name,age\r\nAlice,30\r\nBob,40\r\nCara,50\r\n");

  // Export scope: "all" ignores the active filter, "filtered" (default) keeps it.
  send({
    type: "setFilter",
    requestId: 16,
    column: 1,
    filter: { kind: "range", min: 40, max: null },
  });
  assert.equal(find("results", 16).count, 2);

  send({ type: "startExport", requestId: 17, scope: "all" });
  assert.equal((find("exportStarted", 17) as unknown as { total: number }).total, 3);
  send({ type: "getCsv", requestId: 18, start: 0, end: 3 });
  assert.equal(
    (find("csv", 18) as unknown as { text: string }).text,
    "name,age\r\nAlice,30\r\nBob,40\r\nCara,50\r\n",
  );

  send({ type: "startExport", requestId: 19, scope: "filtered" });
  assert.equal((find("exportStarted", 19) as unknown as { total: number }).total, 2);
  send({ type: "startExport", requestId: 20 });
  assert.equal(
    (find("exportStarted", 20) as unknown as { total: number }).total,
    2,
    "omitted scope keeps the filtered behaviour",
  );

  // Custom chart bins follow the current filters (range >= 40 still active).
  send({
    type: "getChartBins",
    requestId: 21,
    column: 1,
    options: { min: 0, max: 100, binCount: 5, overflow: false },
  });
  const chartBins = find("chartBins", 21) as unknown as {
    bins: number[];
    total: number;
    above: number;
  };
  assert.deepEqual(chartBins.bins, [0, 0, 2, 0, 0]);
  assert.equal(chartBins.total, 2);
  assert.equal(chartBins.above, 0);

  send({
    type: "getChartBins",
    requestId: 22,
    column: 1,
    options: { min: 0, max: 40, binCount: 2, overflow: true },
  });
  const overflowBins = find("chartBins", 22) as unknown as {
    bins: number[];
    overflow: number;
  };
  assert.deepEqual(overflowBins.bins, [0, 1], "40 clamps into the last bin");
  assert.equal(overflowBins.overflow, 1, "50 lands in the > Max bar");
});

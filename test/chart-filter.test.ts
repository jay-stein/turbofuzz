import { test } from "node:test";
import assert from "node:assert/strict";
import type { ViewDef } from "../src/data/aggregate.js";

interface WorkerMessage {
  type: string;
  requestId: number;
  [key: string]: unknown;
}

test("a chart-level aggregate filter narrows to one category", async () => {
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
    const message = responses.find(
      (entry) => entry.type === type && entry.requestId === requestId,
    );
    assert.ok(message !== undefined, `expected ${type}#${requestId}`);
    return message;
  };

  send({
    type: "load",
    requestId: 1,
    name: "teams.csv",
    delimiter: "auto",
    hasHeaders: true,
    text: "team,region,amount,qty\nAlpha,N,10,1\nBeta,S,20,2\nAlpha,S,30,3",
  });
  find("loaded", 1);

  const view: ViewDef = {
    id: "chart-filter",
    name: "Alpha",
    dimensions: [{ column: 0, by: "value" }],
    measures: [{ column: 2, agg: "sum" }],
    fill: "none",
    sort: { key: "m0", dir: "desc" },
    limit: 10,
    respectFilters: true,
    filterColumn: 0,
    filterCode: 0,
  };
  send({ type: "getAggregate", requestId: 2, view });
  const aggregate = find("aggregate", 2) as unknown as {
    labels: string[];
    measures: Float64Array[];
  };
  assert.deepEqual(aggregate.labels, ["Alpha"]);
  assert.equal(aggregate.measures[0][0], 40);

  send({
    type: "getChartSeries",
    requestId: 3,
    xColumn: 2,
    yColumn: 3,
    mode: "points",
    chartFilter: { column: 0, code: 0 },
    respectFilters: true,
  });
  const series = find("chartSeries", 3) as unknown as {
    result: { mode: string; x: Float64Array };
  };
  assert.equal(series.result.mode, "points");
  assert.equal(series.result.x.length, 2);

  send({
    type: "getCrosstab",
    requestId: 4,
    xColumn: 0,
    yColumn: 1,
    topX: 10,
    topY: 10,
    groupOther: false,
    chartFilter: { column: 0, code: 0 },
    respectFilters: true,
  });
  const crosstab = find("crosstab", 4) as unknown as { result: { total: number } };
  assert.equal(crosstab.result.total, 2);

  send({
    type: "getCorrelation",
    requestId: 5,
    columns: [2, 3],
    chartFilter: { column: 0, code: 0 },
    respectFilters: true,
  });
  const correlation = find("correlation", 5) as unknown as {
    result: { counts: Uint32Array; values: Float64Array };
  };
  assert.equal(correlation.result.counts[1], 2);
  assert.equal(correlation.result.values[1], 1);
});

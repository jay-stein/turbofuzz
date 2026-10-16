import { test } from "node:test";
import assert from "node:assert/strict";
import { pandasRecipeScript, type RecipeInput } from "../src/data/recipe.js";
import { polarsRecipeScript } from "../src/data/recipe-polars.js";
import { chartKindFor } from "../src/ui/chart-utils.js";
import type { ViewDef } from "../src/data/aggregate.js";

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

/**
 * End-to-end fixture for the common messy time series: parse dates, convert a
 * numeric measure, treat sentinels as missing, sort, filter a period,
 * aggregate by month and export both recipes. The same operation state feeds
 * the chart and the recipe generators.
 */
test("messy time series: convert → nulls → sort → filter → aggregate → recipe", async () => {
  const { send, find } = harness();
  await import("../src/worker/search.worker.js");

  send({
    type: "load",
    requestId: 1,
    name: "meter.csv",
    delimiter: "auto",
    hasHeaders: true,
    text: [
      "when,amount,status",
      "05/01/2024,12.5,Active",
      "11/02/2024,-999,Active",
      "02/03/2024,TBC,Trial",
      "18/04/2024,7.25,Active",
      "30/05/2024,3.10,Trial",
    ].join("\n"),
  });
  find("loaded", 1);

  // 1. Parse the date column and the numeric measure.
  send({
    type: "cleanColumns",
    requestId: 2,
    updates: [
      { column: 0, ops: [{ kind: "toDate", order: "dmy" }] },
      { column: 1, ops: [{ kind: "toNumber", locale: "dot" }] },
    ],
  });
  const cleaned = find("cleaned", 2) as unknown as {
    columns: { column: number; meta: { type: string } }[];
  };
  assert.equal(cleaned.columns[0].meta.type, "date");
  // The TBC marker keeps the measure from inferring as a number until it is
  // declared missing in the next step.
  assert.notEqual(cleaned.columns[1].meta.type, "number");

  // 2. Treat the -999 sentinel and the TBC marker as missing.
  send({
    type: "setNullPolicy",
    requestId: 3,
    column: 1,
    extra: ["TBC", "-999"],
    keep: [],
  });
  const nulled = find("cleaned", 3) as unknown as {
    columns: { column: number; meta: { type: string; stats: { nulls: number } } }[];
  };
  assert.equal(nulled.columns[0].column, 1);
  assert.equal(nulled.columns[0].meta.stats.nulls, 2, "sentinel and marker are both missing");
  assert.equal(nulled.columns[0].meta.type, "number", "with the marker excluded it infers numeric");

  // 3. Sort by time.
  send({ type: "sort", requestId: 4, column: 0, dir: 1 });
  const sorted = find("sorted", 4) as unknown as { firstRows: string[][] };
  assert.equal(sorted.firstRows[0][0], "2024-01-05");
  assert.equal(sorted.firstRows[0][1], "12.5", "converted to canonical decimal form");

  // 4. Filter the February–April period.
  send({
    type: "setFilter",
    requestId: 5,
    column: 0,
    filter: {
      kind: "range",
      min: Date.UTC(2024, 1, 1),
      max: Date.UTC(2024, 3, 30),
    },
  });
  const filtered = find("results", 5) as unknown as { count: number };
  assert.equal(filtered.count, 3, "Feb, Mar and Apr rows stay");

  // 5. Aggregate the measure by month over the filtered rows.
  const view: ViewDef = {
    id: "chart-workflow",
    name: "Monthly kWh",
    dimensions: [{ column: 0, by: { time: "month" } }],
    measures: [
      { column: null, agg: "count" },
      { column: 1, agg: "sum" },
    ],
    fill: "zero",
    sort: { key: "dim0", dir: "asc" },
    limit: 100,
    respectFilters: true,
  };
  send({ type: "getAggregate", requestId: 6, view });
  const aggregate = find("aggregate", 6) as unknown as {
    labels: string[];
    measures: Float64Array[];
    groupCount: number;
  };
  assert.deepEqual(aggregate.labels, ["2024-02", "2024-03", "2024-04"]);
  assert.equal(aggregate.groupCount, 3);
  assert.equal(aggregate.measures[1][2], 7.25, "April keeps its real measure");

  // 6. The chart kind follows the parsed type.
  assert.equal(chartKindFor("date"), "line");

  // 7. Both recipe targets read exactly the applied state (cleans + nulls).
  const input: RecipeInput = {
    cleans: [
      { name: "when", ops: [{ kind: "toDate", order: "dmy" }] },
      { name: "amount", ops: [{ kind: "toNumber", locale: "dot" }] },
    ],
    nulls: [{ name: "amount", extra: ["TBC", "-999"], keep: [] }],
    types: [],
    transforms: [],
    schema: [
      { name: "when", numeric: false },
      { name: "amount", numeric: false },
      { name: "status", numeric: false },
    ],
  };
  const pandas = pandasRecipeScript(input);
  const polars = polarsRecipeScript(input);
  for (const script of [pandas, polars]) {
    assert.match(script.code, /to_datetime/);
    assert.match(script.code, /to_numeric|cast\(pl\.Float64/);
    assert.match(script.code, /TBC/);
    assert.equal(script.entries.length, 3, "two cleans and one null-policy step");
  }
});

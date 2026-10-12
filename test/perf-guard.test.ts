import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDataset } from "../src/data/build.js";
import { computeAggregate, type ViewDef } from "../src/data/aggregate.js";

/**
 * Perf guard: catches accidental O(n²) regressions in the aggregate hot path.
 * The local p50 for this case is ~25 ms at 100k rows; the generous ceiling
 * keeps CI machines and debug builds from flaking while still failing at
 * 100× the budget.
 */
test("100k-row active view stays far under the interactive budget", () => {
  const rows: string[][] = new Array(100_000);
  for (let i = 0; i < 100_000; i++) {
    rows[i] = [
      `region-${i % 50}`,
      String((i * 37) % 10_000),
      i % 2 === 0 ? "Trial" : "Active",
    ];
  }
  const dataset = buildDataset("perf", ["region", "amount", "status"], rows);
  const ids = Uint32Array.from({ length: dataset.rowCount }, (_, index) => index);
  const view: ViewDef = {
    id: "perf",
    name: "Perf",
    dimensions: [{ column: 0, by: "value" }],
    measures: [
      { column: null, agg: "count" },
      { column: 1, agg: "sum" },
      { column: 1, agg: "mean" },
    ],
    fill: "none",
    sort: { key: "m0", dir: "desc" },
    limit: 500,
    respectFilters: true,
  };
  const started = performance.now();
  const result = computeAggregate(view, dataset.columns, dataset.rowCount, ids);
  const elapsed = performance.now() - started;
  assert.equal(result.groupCount, 50);
  assert.equal(result.totals[0], 100_000);
  assert.ok(elapsed < 2500, `the aggregate took ${elapsed.toFixed(0)} ms — expected well under 2500 ms`);
});

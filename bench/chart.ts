import { computeAggregate, type ViewDef } from "../src/data/aggregate.js";
import { buildDataset } from "../src/data/build.js";
import { computePivot } from "../src/data/pivot.js";
import { measuresToSeries, pivotChartDef, pivotToAggregate } from "../src/data/pivot-chart.js";
import { count, measure, ms } from "./bench-utils.js";
import { generateDataset } from "./data.js";

// Latency budgets for the Chart page, per change a person makes. Each case is the work the
// worker does between a click and the redraw, for the charts most questions need:
//   line:      a value over time by month
//   split:     the same line with one series per category
//   running:   that split line as a running total (worked out along each series)
//   values:    two values on one line chart, one series each
//   bar:       a value per category
//   bar split: bars grouped by a second category
//   bins:      a histogram with a value: rows put into 32 equal-count bins of one number
//   pivot:     a chart of a Pivot View (the pivot's own calculation, shaped to the chart)
//   filtered:  the line again after a filter left a tenth of the rows (a chart catching up when shown)
//
// Measured 2026-11-11 at 200,000 rows on the owner's laptop: 46-105 ms for a full recompute and
// 6-9 ms after the filter. Each budget is two to three times the slowest p95 seen over four runs,
// so a real slowdown fails the gate and a busy machine does not.

const sizeArg = process.argv.find((arg) => arg.startsWith("--rows="));
const rows = Number.parseInt(sizeArg?.slice("--rows=".length) ?? "200000", 10);
const iterationsArg = process.argv.find((arg) => arg.startsWith("--iterations="));
const iterations = Math.max(1, Number.parseInt(iterationsArg?.slice("--iterations=".length) ?? "15", 10) || 15);

const keys = ["install_date", "status", "state", "suburb", "annual_usage", "year"] as const;
const [DATE, STATUS, STATE, SUBURB, USAGE, YEAR] = [0, 1, 2, 3, 4, 5];
const generated = generateDataset(rows, 42, keys);
const grid = new Array<string[]>(rows);
for (let row = 0; row < rows; row++) grid[row] = keys.map((name) => generated.columns[name][row] ?? "");
const dataset = buildDataset("chart-bench", [...keys], grid);
const all = Uint32Array.from({ length: rows }, (_, index) => index);
const tenth = all.filter((id) => id % 10 === 0);

const base = { id: "card-value", name: "bench", fill: "none", limit: 5000, respectFilters: true } as const;
const byMonth = { column: DATE, by: { time: "month" } } as const;
const overTime = { key: "dim0", dir: "asc" } as const;
const largest = { key: "m0", dir: "desc" } as const;

const line: ViewDef = { ...base, dimensions: [byMonth], measures: [{ column: USAGE, agg: "sum" }], sort: overTime, showGaps: true };
const split: ViewDef = { ...base, dimensions: [byMonth, { column: STATUS, by: "value" }], measures: [{ column: USAGE, agg: "sum" }], sort: overTime };
const running: ViewDef = { ...split, measures: [{ column: USAGE, agg: "sum", post: [{ op: "cumulative" }] }] };
const values: ViewDef = { ...line, measures: [{ column: USAGE, agg: "mean" }, { column: YEAR, agg: "mean" }] };
const bar: ViewDef = { ...base, dimensions: [{ column: SUBURB, by: "value" }], measures: [{ column: USAGE, agg: "mean" }], sort: largest };
const barSplit: ViewDef = { ...bar, dimensions: [{ column: STATE, by: "value" }, { column: STATUS, by: "value" }] };
const histogram: ViewDef = { ...base, dimensions: [{ column: USAGE, by: { bin: { n: 32 } } }], measures: [{ column: null, agg: "count" }], sort: overTime };
// The Pivot View being charted: suburb and state down the side, year across the top.
const pivotView: ViewDef = {
  ...base,
  id: "view",
  dimensions: [{ column: STATE, by: "value" }, { column: SUBURB, by: "value" }, { column: YEAR, by: "value" }],
  measures: [{ column: USAGE, agg: "mean" }],
  sort: overTime,
  pivotColumns: [2],
};
const pivotDef = pivotChartDef(pivotView, { axis: 0, series: 2, measure: 0 });
if (pivotDef === null) throw new Error("the pivot chart has no definition");

const aggregate = (view: ViewDef, ids: Uint32Array = all) => computeAggregate(view, dataset.columns, rows, ids);
const cases: { name: string; budget: number; run: () => { groupCount: number } }[] = [
  { name: "line by month", budget: 200, run: () => aggregate(line) },
  { name: "line split by category", budget: 250, run: () => aggregate(split) },
  { name: "split line, running total", budget: 250, run: () => aggregate(running) },
  { name: "two values, one line each", budget: 200, run: () => measuresToSeries(aggregate(values), ["annual_usage", "year"]) },
  { name: "bar per category", budget: 150, run: () => aggregate(bar) },
  { name: "bars grouped by category", budget: 200, run: () => aggregate(barSplit) },
  { name: "value per bin (32 bins)", budget: 200, run: () => aggregate(histogram) },
  { name: "chart of a pivot", budget: 200, run: () => pivotToAggregate(computePivot(pivotDef, dataset.columns, rows, all)) },
  { name: "line after a filter (1 in 10)", budget: 30, run: () => aggregate(line, tenth) },
];

console.log(`Chart page: worker time per change, ${count(rows)} rows`);
for (const item of cases) {
  let groups = 0;
  const timing = measure(() => (groups = item.run().groupCount), { iterations, warmup: 2 });
  if (groups === 0) throw new Error(`${item.name}: the chart has nothing to draw`);
  const over = timing.p95 > item.budget;
  console.log(
    `${over ? "OVER" : "ok  "} ${item.name.padEnd(30)} p50 ${ms(timing.p50).padStart(5)} ms  p95 ${ms(timing.p95).padStart(5)} ms  budget ${item.budget} ms  (${count(groups)} points)`,
  );
  if (over) process.exitCode = 1;
}

import { buildDataset } from "../src/data/build.js";
import { computePivot, type PivotDef } from "../src/data/pivot.js";
import { count, measure, ms } from "./bench-utils.js";
import { generateDataset } from "./data.js";

const sizeArg = process.argv.find((arg) => arg.startsWith("--rows="));
const rows = Number.parseInt(sizeArg?.slice("--rows=".length) ?? "100000", 10);
const iterationsArg = process.argv.find((arg) => arg.startsWith("--iterations="));
const parsedIterations = Number.parseInt(iterationsArg?.slice("--iterations=".length) ?? "3", 10);
const iterations = Number.isFinite(parsedIterations) && parsedIterations > 0 ? parsedIterations : 3;
const keys = ["status", "suburb", "year", "annual_usage"] as const;
const headers: string[] = [...keys];
const generated = generateDataset(rows, 42);
const grid = new Array<string[]>(rows);
for (let row = 0; row < rows; row++) {
  grid[row] = keys.map((name) => generated.columns[name][row] ?? "");
}
const dataset = buildDataset("pivot-bench", headers, grid);
const ids = Uint32Array.from({ length: rows }, (_, index) => index);
const def: PivotDef = {
  id: "bench",
  name: "bench",
  index: [
    { column: 0, by: "value" },
    { column: 1, by: "value" },
  ],
  columns: [{ column: 2, by: "value" }],
  values: [{ column: 3, agg: "sum" }],
  respectFilters: true,
  margins: true,
  sort: "label",
};
const timing = measure(() => computePivot(def, dataset.columns, rows, ids), {
  iterations,
  warmup: 1,
});
const budget = 1500;
console.log(
  `${timing.p95 <= budget ? "ok  " : "OVER"} pivot ${count(rows)} rows, two index + one column + margins  p50 ${ms(timing.p50)} ms  p95 ${ms(timing.p95)} ms  budget ${budget} ms`,
);
if (timing.p95 > budget) process.exitCode = 1;
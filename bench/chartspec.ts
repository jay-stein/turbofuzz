import type { ColumnMeta } from "../src/worker/protocol.js";
import { defaultChartConfig } from "../src/ui/chart-builder.js";
import { chartSpecFromConfig, chartSpecToConfig } from "../src/ui/chart-spec.js";
import { measure, ms } from "./bench-utils.js";

const columns: ColumnMeta[] = Array.from({ length: 100 }, (_, index) => ({
  name: `column_${index}`,
  type: index === 0 ? "category" : "number",
  numberLocale: "dot",
  dateOrder: "dmy",
  stats: {
    nulls: 0,
    distinct: index === 0 ? 8 : 100,
    samples: [],
    topValues: [],
    min: 0,
    max: 100,
    mean: 50,
    stddev: 10,
    minLength: null,
    maxLength: null,
    avgLength: null,
  },
  anomalyCounts: { values: 0, lengths: 0 },
  similarGroups: 0,
  categories:
    index === 0
      ? { labels: ["A", "B", "C", "D", "E", "F", "G", "H"], counts: [1, 1, 1, 1, 1, 1, 1, 1] }
      : null,
  histogram: null,
  valueFence: null,
  lengthFence: null,
  nullPolicy: { extra: [], keep: [] },
  nullTokens: [],
  suggestions: [],
}));
const config = defaultChartConfig();
config.kind = "barplot";
config.column = 0;
config.valueColumn = 1;
config.valueAgg = "sum";
config.colorMin = 0;
config.colorMax = 100;
const iterations = 200;
const timing = measure(
  () => {
    const spec = chartSpecFromConfig(config, columns);
    const compiled = chartSpecToConfig(spec, columns);
    if (compiled.config === null) throw new Error(compiled.issues.join("; "));
  },
  { iterations, warmup: 10 },
);
const budget = 100;
console.log(
  `${timing.p95 <= budget ? "ok  " : "OVER"} ChartSpec round-trip 100 columns  p50 ${ms(timing.p50)} ms  p95 ${ms(timing.p95)} ms per 200 round-trips  budget ${budget} ms`,
);
if (timing.p95 > budget) process.exitCode = 1;
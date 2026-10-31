import { buildTable, DAY, type TsInput } from "../src/data/timeseries/base.js";
import { TsEngine, defaultConfig } from "../src/data/timeseries/engine.js";
import { measure, ms } from "./bench-utils.js";

// Latency budgets for the Time Series page, per change a person makes. The engine
// runs in the worker; these are the waits between a click or drag and the redraw.
//   open:    rows -> series table -> aggregate, decompose, eight models, futures
//   horizon: dragging the forecast handle (models and futures only)
//   smooth:  moving the rolling window (cached aggregate, one rolling pass)
//   patterns: opening the Patterns tab (hourly + daily + monthly profiles, with the re-aggregate)
//   twmean:  switching to the time-weighted mean (every reading spread over the time it held)
//
// Since 2026-10-31 (DEC-2026-10-31-03) anything that recomputes models may take up to 500 ms:
// the page shows a "Calculating..." spinner once a request passes 150 ms, and heavier
// analyses sit behind a button (the Deep check). Cheap interactions keep tight budgets.
// The earlier, tighter figures stay as targets: going over one prints "slow" but passes, so
// a creeping slowdown stays visible.
const CEILING = 500;
const BUDGETS = {
  daily: { open: CEILING, horizon: CEILING, smooth: 8, patterns: CEILING, twmean: CEILING },
  hourly: { open: CEILING, horizon: CEILING, smooth: 15, patterns: CEILING, twmean: CEILING },
};
const TARGETS = {
  daily: { open: 110, horizon: 80, patterns: 150, twmean: 110 },
  hourly: { open: 220, horizon: 110, patterns: 280, twmean: 220 },
};

/** Rows with a trend, a daily and weekly cycle and noise, `perDay` rows a day. */
function rows(days: number, perDay: number): TsInput {
  const n = days * perDay, step = DAY / perDay, start = Date.UTC(2016, 0, 4);
  const times = new Float64Array(n), value = new Float64Array(n), driver = new Float64Array(n);
  let seed = 7;
  const rnd = (): number => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  for (let i = 0; i < n; i++) {
    const t = start + i * step, hour = (i % perDay) * (24 / perDay), wd = Math.floor(i / perDay) % 7;
    times[i] = t;
    driver[i] = 20 + (i > n / 2 ? 2 : 0);
    value[i] = 100 + i * (50 / n) + 30 * Math.exp(-((hour - 14) ** 2) / 10) + (wd >= 5 ? 15 : 0) + 8 * rnd();
  }
  return { times, cols: { value, driver }, flags: {}, groups: ["all"], rowGroup: new Uint16Array(n), groupCol: null, dateCol: "date", dropped: 0 };
}

let failed = false;
const check = (label: string, p95: number, budget: number, target?: number): void => {
  const over = p95 > budget;
  if (over) failed = true;
  const slow = !over && target !== undefined && p95 > target;
  console.log(`${over ? "OVER" : slow ? "slow" : "ok  "} ${label.padEnd(44)} p95 ${ms(p95).padStart(7)} ms  budget ${budget} ms${slow ? `  (over the old target of ${target} ms)` : ""}`);
};

for (const [name, days, perDay, grain] of [["daily", 3650, 1, "day"], ["hourly", 730, 24, "hour"]] as const) {
  const input = rows(days, perDay);
  const budget = BUDGETS[name], target = TARGETS[name];
  const open = measure(() => {
    const table = buildTable(input);
    if (!table) throw new Error("no table");
    const engine = new TsEngine(table);
    engine.compute({ ...defaultConfig(engine.info()), grain }, "forecast");
  }, { iterations: 5, warmup: 1 });
  check(`${name}: open (${days * perDay} rows, ${grain})`, open.p95, budget.open, target.open);

  const table = buildTable(input);
  if (!table) throw new Error("no table");
  const engine = new TsEngine(table);
  const base = { ...defaultConfig(engine.info()), grain };
  engine.compute(base, "forecast");
  let h = base.horizon ?? 30;
  const horizon = measure(() => { h = h === 30 ? 31 : 30; engine.compute({ ...base, horizon: h }, "forecast"); }, { iterations: 6, warmup: 1 });
  check(`${name}: forecast horizon drag`, horizon.p95, budget.horizon, target.horizon);
  let w = 5;
  const smooth = measure(() => { w = w === 5 ? 6 : 5; engine.compute({ ...base, horizon: h, smoothW: w }, "explore"); }, { iterations: 6, warmup: 1 });
  check(`${name}: rolling window change`, smooth.p95, budget.smooth);
  let agg: "sum" | "mean" = "sum";
  const patterns = measure(() => {
    agg = agg === "sum" ? "mean" : "sum";
    engine.compute({ ...base, horizon: h, smoothW: w, agg }, "patterns");
  }, { iterations: 4, warmup: 0 });
  check(`${name}: patterns tab (+ re-aggregate)`, patterns.p95, budget.patterns, target.patterns);
  // Time-weighted mean: every reading spread over the time it held, then the full rerun.
  let tw = 0;
  const twmean = measure(() => { tw++; engine.compute({ ...base, horizon: h, smoothW: w, agg: tw % 2 ? "twmean" : "mean" }, "forecast"); }, { iterations: 4, warmup: 0 });
  check(`${name}: switch to time-weighted mean`, twmean.p95, budget.twmean, target.twmean);
}
if (failed) {
  console.error("Time series latency gate failed.");
  process.exitCode = 1;
}

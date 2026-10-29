import { test } from "node:test";
import assert from "node:assert/strict";
import { ColumnData } from "../src/data/column.js";
import { computeAggregate, normaliseEvery, timeBucket, type ViewDef } from "../src/data/aggregate.js";
import { autoShortStep, describeStep, fillTimeAxis, nextPeriod } from "../src/ui/chart-utils.js";

const at = (...parts: number[]): number => Date.UTC(parts[0]!, (parts[1] ?? 1) - 1, parts[2] ?? 1, parts[3] ?? 0, parts[4] ?? 0, parts[5] ?? 0);

test("normaliseEvery accepts whole numbers of two or more and otherwise means one unit", () => {
  assert.equal(normaliseEvery(undefined), 1);
  assert.equal(normaliseEvery(0), 1);
  assert.equal(normaliseEvery(1), 1);
  assert.equal(normaliseEvery(2.9), 2);
  assert.equal(normaliseEvery(Number.NaN), 1);
  assert.equal(normaliseEvery(15), 15);
});

test("fixed grains bucket every N units from the epoch", () => {
  assert.equal(timeBucket(at(2024, 5, 15, 13, 44, 59), "minute", { every: 15 }), at(2024, 5, 15, 13, 30));
  assert.equal(timeBucket(at(2024, 5, 15, 13, 45, 0), "minute", { every: 15 }), at(2024, 5, 15, 13, 45));
  assert.equal(timeBucket(at(2024, 5, 15, 13, 59), "hour", { every: 6 }), at(2024, 5, 15, 12));
  assert.equal(timeBucket(at(2024, 5, 15, 7, 1, 59), "second", { every: 30 }), at(2024, 5, 15, 7, 1, 30));
  // Width one is exactly the old behaviour.
  assert.equal(timeBucket(at(2024, 5, 15, 13, 44), "minute", { every: 1 }), at(2024, 5, 15, 13, 44));
});

test("weeks group into fortnights that always start on the chosen weekday", () => {
  const mondays = [0, 1, 2, 3, 4, 5].map((k) => at(2024, 1, 1 + 7 * k));
  const buckets = mondays.map((m) => timeBucket(m, "week", { every: 2 }));
  buckets.forEach((b) => assert.equal(new Date(b).getUTCDay(), 1));
  // Consecutive weeks pair up: each step is either the same bucket or exactly 14 days on.
  const steps = new Set(buckets.slice(1).map((b, i) => b - buckets[i]!));
  assert.deepEqual([...steps].sort((a, b) => a - b), [0, 14 * 86_400_000]);
  const sunday = timeBucket(at(2024, 1, 3), "week", { every: 2, weekStart: 0 });
  assert.equal(new Date(sunday).getUTCDay(), 0);
});

test("months, quarters and years group by whole months and follow the financial year", () => {
  assert.equal(timeBucket(at(2024, 5, 20), "month", { every: 3 }), at(2024, 4, 1));
  assert.equal(timeBucket(at(2024, 5, 20), "quarter", { every: 2 }), at(2024, 1, 1));
  assert.equal(timeBucket(at(2024, 8, 20), "quarter", { every: 2 }), at(2024, 7, 1));
  assert.equal(timeBucket(at(2025, 3, 5), "year", { every: 2 }), at(2024, 1, 1));
  // Financial years from July: pairs of quarters start in July and January.
  assert.equal(timeBucket(at(2024, 8, 20), "quarter", { every: 2, fiscalStartMonth: 7 }), at(2024, 7, 1));
  assert.equal(timeBucket(at(2024, 3, 20), "quarter", { every: 2, fiscalStartMonth: 7 }), at(2024, 1, 1));
});

test("an aggregate every 15 minutes buckets, labels and fills the gaps", () => {
  const stamps = ["2024-05-15 10:02:00", "2024-05-15 10:14:00", "2024-05-15 10:20:00", "2024-05-15 11:05:00"];
  const columns = [ColumnData.create("ts", stamps), ColumnData.create("v", ["1", "3", "5", "7"])];
  columns[0] = ColumnData.create("ts", stamps);
  const view: ViewDef = {
    id: "v",
    name: "v",
    dimensions: [{ column: 0, by: { time: "minute", every: 15 } }],
    measures: [{ column: 1, agg: "sum" }],
    fill: "zero",
    sort: { key: "dim0", dir: "asc" },
    limit: 100,
    respectFilters: false,
  };
  const result = computeAggregate(view, columns, 4, Uint32Array.from([0, 1, 2, 3]));
  // 10:00 (1+3), 10:15 (5), 10:30 and 10:45 empty, 11:00 (7).
  assert.deepEqual(Array.from(result.measures[0]), [4, 5, 0, 0, 7]);
  assert.match(result.dimensionNames[0] ?? "", /15 minutes/);
});

test("the chart axis steps by the same width", () => {
  assert.equal(nextPeriod(at(2024, 1, 1, 0, 0), "minute", 15), at(2024, 1, 1, 0, 15));
  assert.equal(nextPeriod(at(2024, 1, 1), "month", 3), at(2024, 4, 1));
  const quarterHours = [at(2024, 1, 1, 0, 0), at(2024, 1, 1, 0, 45)];
  assert.equal(fillTimeAxis(quarterHours, "minute", 20_000, 15).length, 4);
});

test("automatic short spans pick a round step with about sixty points", () => {
  assert.deepEqual(autoShortStep(50 * 60_000), { grain: "minute", every: 1 });
  assert.deepEqual(autoShortStep(4 * 3_600_000), { grain: "minute", every: 5 });
  assert.deepEqual(autoShortStep(24 * 3_600_000), { grain: "minute", every: 30 });
  assert.deepEqual(autoShortStep(2 * 86_400_000), { grain: "hour", every: 1 });
  assert.equal(describeStep("minute", 15), "15 minutes");
  assert.equal(describeStep("week"), "week");
  assert.equal(describeStep("week", 1, true), "weeks");
});

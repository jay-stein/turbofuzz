import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDataset } from "../src/data/build.js";
import {
  computeAggregate,
  periodIndex,
  timeBucket,
  timeLabel,
  zoneShift,
  type ViewDef,
} from "../src/data/aggregate.js";

function view(overrides: Partial<ViewDef> = {}): ViewDef {
  return {
    id: "v1",
    name: "View 1",
    dimensions: [{ column: 0, by: "value" }],
    measures: [{ column: null, agg: "count" }],
    fill: "none",
    sort: { key: "m0", dir: "desc" },
    limit: 500,
    respectFilters: true,
    ...overrides,
  };
}

const allIds = (count: number): Uint32Array =>
  Uint32Array.from({ length: count }, (_, index) => index);

const SALES = buildDataset("sales", ["region", "amount"], [
  ["North", "10"],
  ["South", "5"],
  ["North", "30"],
  ["North", ""],
  ["South", "5"],
  ["East", "20"],
]);

test("conditional measures count only matching rows", () => {
  const result = computeAggregate(
    view({
      measures: [
        { column: null, agg: "count" },
        { column: 1, agg: "sum", where: { column: 1, min: 20 } },
        { column: null, agg: "count", where: { column: 0, values: ["North"] } },
        { column: null, agg: "count", where: { column: 1, isNull: true } },
      ],
    }),
    SALES.columns,
    SALES.rowCount,
    allIds(SALES.rowCount),
  );
  const at = (label: string): number => result.labels.indexOf(label);
  assert.deepEqual([...result.measures[0]], [3, 2, 1]);
  assert.equal(result.measures[1][at("North")], 30);
  assert.equal(result.measures[1][at("South")], 0);
  assert.equal(result.measures[1][at("East")], 20);
  assert.equal(result.measures[2][at("North")], 3);
  assert.equal(result.measures[2][at("South")], 0);
  assert.equal(result.measures[3][at("North")], 1);
  assert.match(result.measureNames[1] ?? "", /where amount ≥ 20/);
  assert.match(result.measureNames[2] ?? "", /where region in \(North\)/);
  assert.match(result.measureNames[3] ?? "", /where amount is empty/);
});

test("conditional expressions apply the condition to every term", () => {
  const result = computeAggregate(
    view({
      dimensions: [{ column: 0, by: "value" }],
      measures: [
        {
          column: null,
          agg: "expr",
          expr: "sum(amount) / count(*)",
          where: { column: 0, values: ["North"] },
        },
      ],
    }),
    SALES.columns,
    SALES.rowCount,
    allIds(SALES.rowCount),
  );
  const at = (label: string): number => result.labels.indexOf(label);
  assert.equal(result.measures[0][at("North")], 40 / 3);
  assert.ok(!Number.isFinite(result.measures[0][at("South")] ?? 0));
});

test("week start and fiscal year options change buckets and labels", () => {
  const wednesday = Date.UTC(2024, 0, 3);
  assert.equal(timeBucket(wednesday, "week", { weekStart: 1 }), Date.UTC(2024, 0, 1));
  assert.equal(timeBucket(wednesday, "week", { weekStart: 0 }), Date.UTC(2023, 11, 31));

  // Australian-style July fiscal year: Dec 2024 is FY2024, Feb 2025 is FY2024 Q3.
  const december = Date.UTC(2024, 11, 15);
  assert.equal(timeLabel(december, "year", { fiscalStartMonth: 7 }), "FY2024");
  assert.equal(timeBucket(december, "year", { fiscalStartMonth: 7 }), Date.UTC(2024, 6, 1));
  const february = Date.UTC(2025, 1, 10);
  assert.equal(timeLabel(february, "quarter", { fiscalStartMonth: 7 }), "FY2024 Q3");
  assert.equal(timeBucket(february, "quarter", { fiscalStartMonth: 7 }), Date.UTC(2025, 0, 1));
  assert.equal(timeLabel(Date.UTC(2025, 6, 1), "year", { fiscalStartMonth: 7 }), "FY2025");
});

test("zone shift converts instants into wall-clock time", () => {
  const shift = zoneShift("+10:00");
  assert.ok(shift !== null);
  assert.equal(shift(Date.UTC(2024, 0, 31, 20)), Date.UTC(2024, 1, 1, 6));
  assert.equal(zoneShift(""), null);
  assert.equal(zoneShift("UTC"), null);
});

test("time zone options move rows across period boundaries", () => {
  const data = buildDataset("zones", ["when", "n"], [["2024-01-31T20:00:00Z", "1"]]);
  const utc = computeAggregate(
    view({ dimensions: [{ column: 0, by: { time: "month" } }] }),
    data.columns,
    data.rowCount,
    allIds(data.rowCount),
  );
  const brisbane = computeAggregate(
    view({ dimensions: [{ column: 0, by: { time: "month", tz: "+10:00" } }] }),
    data.columns,
    data.rowCount,
    allIds(data.rowCount),
  );
  assert.deepEqual(utc.labels, ["2024-01"]);
  assert.deepEqual(brisbane.labels, ["2024-02"]);
  assert.match(brisbane.dimensionNames[0] ?? "", /\+10:00/);
});

test("partial periods are flagged at data edges and can be excluded", () => {
  const monthly = buildDataset("months", ["when", "n"], [
    ["2020-01-15", "1"],
    ["2020-02-10", "2"],
    ["2020-03-05", "3"],
  ]);
  const result = computeAggregate(
    view({
      dimensions: [{ column: 0, by: { time: "month" } }],
      sort: { key: "dim0", dir: "asc" },
    }),
    monthly.columns,
    monthly.rowCount,
    allIds(monthly.rowCount),
  );
  assert.deepEqual(result.labels, ["2020-01", "2020-02", "2020-03"]);
  assert.deepEqual(result.partials, [true, false, false], "the data starts mid-January");

  const excluded = computeAggregate(
    view({
      dimensions: [{ column: 0, by: { time: "month" } }],
      sort: { key: "dim0", dir: "asc" },
      partial: "exclude",
    }),
    monthly.columns,
    monthly.rowCount,
    allIds(monthly.rowCount),
  );
  assert.deepEqual(excluded.labels, ["2020-02", "2020-03"]);
  assert.deepEqual(excluded.partials, [false, false]);
});

test("the current period is partial until it ends", () => {
  const now = new Date();
  const year = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 15);
  const previous = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1);
  const data = buildDataset("live", ["when", "n"], [
    [new Date(previous).toISOString(), "1"],
    [new Date(year).toISOString(), "2"],
  ]);
  const result = computeAggregate(
    view({
      dimensions: [{ column: 0, by: { time: "month" } }],
      sort: { key: "dim0", dir: "asc" },
    }),
    data.columns,
    data.rowCount,
    allIds(data.rowCount),
  );
  assert.equal(result.partials?.[0], false, "the previous month started on the 1st");
  assert.equal(result.partials?.[result.partials.length - 1], true, "this month is incomplete");
});

test("cohort and period-since dimensions follow each entity's first period", () => {
  const data = buildDataset("events", ["who", "when"], [
    ["Alice", "2024-01-10"],
    ["Alice", "2024-02-05"],
    ["Bob", "2024-02-20"],
    ["Bob", "2024-03-03"],
    ["Alice", "2024-03-11"],
  ]);
  const cohort = computeAggregate(
    view({
      dimensions: [{ column: 1, by: { cohort: { entity: 0, grain: "month" } } }],
      measures: [{ column: null, agg: "count" }],
      sort: { key: "dim0", dir: "asc" },
    }),
    data.columns,
    data.rowCount,
    allIds(data.rowCount),
  );
  assert.deepEqual(cohort.labels, ["2024-01", "2024-02"]);
  assert.deepEqual([...cohort.measures[0]], [3, 2], "Alice joins Jan, Bob Feb");
  assert.match(cohort.dimensionNames[0] ?? "", /cohort by who/);

  const since = computeAggregate(
    view({
      dimensions: [
        { column: 1, by: { cohort: { entity: 0, grain: "month" } } },
        { column: 1, by: { since: { entity: 0, grain: "month" } } },
      ],
      measures: [{ column: null, agg: "count" }],
      sort: { key: "dim1", dir: "asc" },
    }),
    data.columns,
    data.rowCount,
    allIds(data.rowCount),
  );
  const keys = since.labels;
  assert.deepEqual(keys, [
    "2024-01 · P0",
    "2024-02 · P0",
    "2024-01 · P1",
    "2024-02 · P1",
    "2024-01 · P2",
  ]);
  assert.deepEqual([...since.measures[0]], [1, 1, 1, 1, 1]);
  assert.equal(periodIndex(Date.UTC(2024, 0, 1), Date.UTC(2024, 2, 1), "month"), 2);
  assert.equal(periodIndex(Date.UTC(2024, 0, 1), Date.UTC(2024, 9, 1), "quarter"), 3);
});

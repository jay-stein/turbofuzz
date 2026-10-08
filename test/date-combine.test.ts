import { test } from "node:test";
import assert from "node:assert/strict";
import { ColumnData } from "../src/data/column.js";
import { applyCombineDate, type CombineDateOp } from "../src/data/date-combine.js";

function column(name: string, values: string[]): ColumnData {
  return ColumnData.create(name, values);
}

function combine(
  columns: ColumnData[],
  op: Partial<CombineDateOp>,
): ColumnData[] {
  return applyCombineDate(columns, {
    kind: "combineDate",
    parts: columns.map((_, index) => ({ column: index, role: "auto" as const })),
    output: "datetime",
    outputName: "combined",
    order: "auto",
    timeZone: "UTC",
    dropParts: false,
    ...op,
  });
}

test("combines year/month/day/hour with auto roles", () => {
  const columns = [
    column("Year", ["2024", "2024"]),
    column("Month", ["3", "12"]),
    column("Day", ["4", "31"]),
    column("Hour", ["14", "23"]),
  ];
  const out = combine(columns, {});
  const created = out[out.length - 1];
  assert.equal(created.name, "combined");
  assert.deepEqual(created.raw, ["2024-03-04T14:00:00Z", "2024-12-31T23:00:00Z"]);
  assert.equal(created.type, "date");
});

test("combines a date column and a 12-hour clock with AM/PM", () => {
  const columns = [column("Order date", ["03/04/2024", "06/13/2024"]), column("Time", ["2:35 PM", "9:05 am"])];
  const out = combine(columns, { order: "mdy", outputName: "placed_at" });
  const created = out[out.length - 1];
  assert.deepEqual(created.raw, ["2024-03-04T14:35:00Z", "2024-06-13T09:05:00Z"]);
});

test("day-first detection applies when order is auto", () => {
  const columns = [column("Date", ["13/02/2024", "05/06/2024"]), column("Hour", ["9", "10"])];
  const out = combine(columns, {});
  const created = out[out.length - 1];
  assert.deepEqual(created.raw, ["2024-02-13T09:00:00Z", "2024-06-05T10:00:00Z"]);
});

test("an offset in the data wins over the selected timezone", () => {
  const columns = [
    column("Date", ["2024-03-04", "2024-03-04"]),
    column("Time", ["14:35", "14:35"]),
    column("UTC offset", ["+10:00", "-05:00"]),
  ];
  const out = combine(columns, { timeZone: "UTC" });
  const created = out[out.length - 1];
  assert.deepEqual(created.raw, ["2024-03-04T14:35:00+10:00", "2024-03-04T14:35:00-05:00"]);
});

test("IANA timezones resolve the wall time to the zone offset", () => {
  const columns = [column("Date", ["2024-01-15", "2024-07-15"]), column("Hour", ["12", "12"])];
  const out = combine(columns, { timeZone: "Australia/Sydney" });
  const created = out[out.length - 1];
  assert.deepEqual(created.raw, ["2024-01-15T12:00:00+11:00", "2024-07-15T12:00:00+10:00"]);
});

test("naive output leaves the wall time unstamped", () => {
  const columns = [column("Date", ["2024-03-04"]), column("Hour", ["14"])];
  const out = combine(columns, { timeZone: "naive" });
  assert.deepEqual(out[out.length - 1].raw, ["2024-03-04T14:00:00"]);
});

test("date output drops the clock and defaults a missing day", () => {
  const columns = [column("Year", ["2024"]), column("Month", ["March"]), column("Hour", ["23"])];
  const out = combine(columns, { output: "date" });
  const created = out[out.length - 1];
  assert.deepEqual(created.raw, ["2024-03-01"]);
});

test("invalid and incomplete rows become blank", () => {
  const columns = [
    column("Date", ["2024-02-30", "", "2024-12-31"]),
    column("Hour", ["10", "10", "banana"]),
  ];
  const out = combine(columns, {});
  assert.deepEqual(out[out.length - 1].raw, ["", "", ""]);

  const yearOnly = combine([column("Year", ["2024"])], {});
  assert.deepEqual(yearOnly[yearOnly.length - 1].raw, [""]);

  const partial = combine(
    [column("Year", ["2024", ""]), column("Month", ["1", "2"]), column("Day", ["", "3"])],
    {},
  );
  assert.deepEqual(partial[partial.length - 1].raw, ["2024-01-01T00:00:00Z", ""]);
});

test("drop parts removes the sources and keeps the output last", () => {
  const columns = [column("Year", ["2024"]), column("Other", ["x"]), column("Month", ["3"]), column("Day", ["4"])];
  const out = combine(columns, {
    parts: [
      { column: 0, role: "year" },
      { column: 2, role: "month" },
      { column: 3, role: "day" },
    ],
    dropParts: true,
    output: "date",
  });
  assert.deepEqual(out.map((entry) => entry.name), ["Other", "combined"]);
  assert.deepEqual(out[1].raw, ["2024-03-04"]);
});

test("epoch seconds and milliseconds both convert", () => {
  const seconds = combine([column("Timestamp", ["1700000000"])], { parts: [{ column: 0, role: "epoch" }] });
  assert.deepEqual(seconds[seconds.length - 1].raw, ["2023-11-14T22:13:20Z"]);
  const millis = combine([column("Timestamp", ["1700000000000"])], { parts: [{ column: 0, role: "epoch" }] });
  assert.deepEqual(millis[millis.length - 1].raw, ["2023-11-14T22:13:20Z"]);
});

test("combining drops meridian conversion into the hour", () => {
  const columns = [
    column("Date", ["2024-03-04", "2024-03-04", "2024-03-04", "2024-03-04"]),
    column("Hour", ["12", "12", "1", "1"]),
    column("Meridiem", ["AM", "PM", "am", "pm"]),
  ];
  const out = combine(columns, {});
  assert.deepEqual(out[out.length - 1].raw, [
    "2024-03-04T00:00:00Z",
    "2024-03-04T12:00:00Z",
    "2024-03-04T01:00:00Z",
    "2024-03-04T13:00:00Z",
  ]);
});

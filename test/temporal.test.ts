import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDataset } from "../src/data/build.js";
import { ColumnData } from "../src/data/column.js";
import { parseDuration, parseTimeOfDay } from "../src/parse/dates.js";
import { buildRank } from "../src/search/order.js";
import { QueryEngine } from "../src/search/query-engine.js";
import { formatDurationMs, toDateTimeInputValue, toTimeInputValue } from "../src/parse/dates.js";
import { axisKindFor, formatTick } from "../src/ui/chart-utils.js";
import { buildCsv } from "../src/worker/csv.js";

function column(name: string, values: string[]): ColumnData {
  return ColumnData.create(name, values);
}

test("ISO date-only values infer date", () => {
  const when = column("when", ["2026-10-16", "2026-10-17", "2026-10-16"]);
  assert.equal(when.type, "date");
  assert.equal(when.numbers()[0], Date.UTC(2026, 9, 16));
  assert.equal(when.timeZoneAware, false);
});

test("timestamps infer datetime, including midnight timestamps", () => {
  assert.equal(
    column("when", ["2026-10-16 09:30:00", "2026-10-17T14:00", "2026-10-18 23:59:59.5"]).type,
    "datetime",
  );
  // A time component is semantic even when every clock happens to read 00:00.
  const midnight = column("when", ["2026-10-16T00:00:00Z", "2026-10-17T00:00:00Z"]);
  assert.equal(midnight.type, "datetime");
});

test("month-name dates split on the time component", () => {
  assert.equal(column("when", ["16 Oct 2026", "Oct 17, 2026"]).type, "date");
  assert.equal(column("when", ["16 Oct 2026 09:30", "Oct 17, 2026 14:00"]).type, "datetime");
});

test("mixing date-only and timestamp strings reads as datetime", () => {
  const mixed = column("when", ["2026-10-16", "2026-10-17 08:00:00", "2026-10-18"]);
  assert.equal(mixed.type, "datetime");
});

test("zone offsets are applied to the instant and flagged in metadata", () => {
  const aware = column("when", [
    "2026-10-16T09:30:00+10:00",
    "2026-10-15T23:30:00Z",
  ]);
  assert.equal(aware.type, "datetime");
  assert.equal(aware.timeZoneAware, true);
  assert.equal(aware.numbers()[0], Date.UTC(2026, 9, 15, 23, 30));
  assert.equal(aware.numbers()[1], Date.UTC(2026, 9, 15, 23, 30));

  const naive = column("when", ["2026-10-16 09:30:00", "2026-10-17 10:00:00"]);
  assert.equal(naive.type, "datetime");
  assert.equal(naive.timeZoneAware, false);
});

test("ambiguous DMY/MDY values keep the existing date-order policy", () => {
  const ambiguous = column("when", ["01/02/2026", "03/04/2026"]);
  assert.equal(ambiguous.type, "date");
  assert.equal(ambiguous.dateOrder, "dmy");
  assert.equal(ambiguous.numbers()[0], Date.UTC(2026, 1, 1));

  const us = column("when", ["05/13/2026", "06/14/2026"]);
  assert.equal(us.type, "date");
  assert.equal(us.dateOrder, "mdy");
  assert.equal(us.numbers()[0], Date.UTC(2026, 4, 13));
});

test("invalid dates, null tokens and all-null columns stay text", () => {
  const invalid = Array.from({ length: 13 }, (_, i) => `2026-13-${String(i + 1).padStart(2, "0")}`);
  const wrong = column("when", invalid);
  assert.notEqual(wrong.type, "date");
  assert.notEqual(wrong.type, "datetime");
  assert.equal(column("when", ["", "", ""]).type, "string");
  assert.equal(column("when", ["n/a", "n/a"]).type, "string");
});

test("time-of-day is conservative and needs context", () => {
  // Ambiguous HH:MM stays text, with a suggestion to convert.
  const ambiguous = column("slot", ["09:30", "14:45", "23:00"]);
  assert.notEqual(ambiguous.type, "time");
  assert.ok(ambiguous.suggestions.some((entry) => entry.kind === "time"));

  // A name that says clock resolves it.
  const named = column("arrival_time", ["09:30", "14:45"]);
  assert.equal(named.type, "time");
  assert.equal(named.numbers()[0], (9 * 60 + 30) * 60_000);

  // A 12-hour suffix is unambiguous.
  assert.equal(column("x", ["9:30 am", "2:15 pm"]).type, "time");
});

test("duration inference is conservative but catches unambiguous forms", () => {
  assert.equal(column("elapsed", ["25:10:00", "100:00:00"]).type, "duration");
  assert.equal(column("elapsed", ["1h 30m", "90m", "2h 15m"]).type, "duration");
  // Two-colon values at or below 23 hours are still ambiguous with wall clock.
  assert.notEqual(column("elapsed", ["01:30:00", "02:15:30"]).type, "duration");

  const elapsed = column("elapsed", ["1h 30m", "45m"]);
  assert.equal(elapsed.numbers()[0], 90 * 60_000);
  assert.equal(elapsed.numbers()[1], 45 * 60_000);
  assert.equal(parseDuration("01:30"), Number.NaN);
});

test("identifier-looking digit strings are not hijacked as temporal values", () => {
  assert.equal(column("code", ["010203", "010204", "010205"]).type, "identifier");
  assert.equal(column("code", ["123456789012345678", "123456789012345679"]).type, "identifier");
});

test("manual type overrides re-parse the column and clear caches", () => {
  const value = column("x", ["1:30:00", "2:00:00"]);
  assert.notEqual(value.type, "duration");
  value.setType("duration", true);
  assert.equal(value.type, "duration");
  assert.equal(value.numbers()[0], 5_400_000);
  assert.equal(value.stats.min, 5_400_000);
  assert.equal(value.stats.max, 7_200_000);

  value.setType("time", true);
  assert.equal(value.numbers()[0], 5_400_000);

  const stamps = column("x", ["2026-10-16T09:30:00Z"]);
  stamps.setType("datetime", true);
  assert.equal(stamps.type, "datetime");
  assert.equal(stamps.numbers()[0], Date.UTC(2026, 9, 16, 9, 30));
});

test("datetime and date columns filter and sort by instant", () => {
  const dataset = buildDataset(
    "t",
    ["stamp", "day"],
    [
      ["2026-10-16 09:30:00", "2026-10-16"],
      ["2026-10-15T10:00:00Z", "2026-10-14"],
      ["2026-10-17 08:00:00", "2026-10-18"],
    ],
  );
  const engine = new QueryEngine(dataset);
  const from = Date.UTC(2026, 9, 15, 12, 0);
  const hits = engine.evaluate(new Map([[0, { kind: "range", min: from, max: null }]]));
  assert.deepEqual([...hits], [0, 2], "datetime range uses the time of day");

  const dayHits = engine.evaluate(
    new Map([[1, { kind: "range", min: Date.UTC(2026, 9, 15), max: Date.UTC(2026, 9, 17) }]]),
  );
  assert.deepEqual([...dayHits], [0], "date range covers only the 16th");

  const rank = buildRank(dataset, 0);
  assert.deepEqual([...rank], [1, 0, 2], "timestamps sort chronologically");
});

test("chart axis formatting follows the temporal type", () => {
  assert.equal(axisKindFor("date"), "line");
  assert.equal(axisKindFor("datetime"), "datetime");
  assert.equal(axisKindFor("time"), "time");
  assert.equal(axisKindFor("duration"), "duration");
  assert.equal(axisKindFor("number"), null);

  const noon = Date.UTC(2026, 9, 16, 9, 30);
  assert.equal(formatTick(noon, "line"), "2026-10-16");
  assert.equal(formatTick(noon, "datetime"), "2026-10-16 09:30");
  assert.equal(formatTick(noon, "datetime"), "2026-10-16 09:30");
  assert.equal(formatTick(parseTimeOfDay("14:05"), "time"), "14:05");
  assert.equal(formatTick(parseDuration("1h 30m"), "duration"), "1:30:00");
  assert.equal(formatDurationMs(5_400_000), "1:30:00");
  assert.equal(toTimeInputValue(parseTimeOfDay("14:05")), "14:05");
  assert.equal(toDateTimeInputValue(noon), "2026-10-16T09:30");
});

test("CSV export canonicalises temporal values", () => {
  const dataset = buildDataset(
    "t",
    ["stamp", "clock", "elapsed"],
    [
      ["2026-10-16T09:30:00Z", "09:30", "1h 30m"],
      ["2026-10-17T00:00:00Z", "14:45", "45m"],
    ],
  );
  const ids = Uint32Array.from([0, 1]);
  const csv = buildCsv(dataset, ids, 0, 2, true);
  const lines = csv.trim().split("\r\n");
  assert.equal(lines[1], "2026-10-16T09:30:00Z,09:30,1:30:00");
  assert.equal(lines[2], "2026-10-17T00:00:00Z,14:45,0:45:00");
});

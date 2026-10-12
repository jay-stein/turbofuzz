import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseClockFields,
  parseDateFields,
  parseDatePart,
  parseOffsetMinutes,
  emptyComponents,
  suggestRole,
  detectOrder,
} from "../src/parse/date-parts.js";
import { parseDate } from "../src/parse/dates.js";

test("numeric dates follow the requested order", () => {
  assert.deepEqual(parseDateFields("03/04/2024", "mdy"), { year: 2024, month: 3, day: 4 });
  assert.deepEqual(parseDateFields("03/04/2024", "dmy"), { year: 2024, month: 4, day: 3 });
  assert.deepEqual(parseDateFields("2024/03/04", "mdy"), { year: 2024, month: 3, day: 4 });
  assert.deepEqual(parseDateFields("31-12-99", "dmy"), { year: 1999, month: 12, day: 31 });
});

test("month-name dates and ordinals parse", () => {
  assert.deepEqual(parseDateFields("4 Mar 2023", "dmy"), { year: 2023, month: 3, day: 4 });
  assert.deepEqual(parseDateFields("March 4, 2023", "dmy"), { year: 2023, month: 3, day: 4 });
  assert.deepEqual(parseDateFields("March 2023", "dmy"), { year: 2023, month: 3, day: 1 });
  assert.deepEqual(parseDateFields("4th June 2024", "dmy"), { year: 2024, month: 6, day: 4 });
});

test("clocks understand 12/24 hour and compact forms", () => {
  assert.deepEqual(parseClockFields("14:35"), {
    hour: 14,
    minute: 35,
    second: 0,
    millisecond: 0,
    meridiem: null,
  });
  assert.equal(parseClockFields("2:35 PM")?.hour, 2);
  assert.equal(parseClockFields("2:35 PM")?.meridiem, "pm");
  assert.deepEqual(parseClockFields("09:05:12.250"), {
    hour: 9,
    minute: 5,
    second: 12,
    millisecond: 250,
    meridiem: null,
  });
  assert.equal(parseClockFields("1430")?.hour, 14);
  assert.equal(parseClockFields("1430")?.minute, 30);
  assert.equal(parseClockFields("235959")?.second, 59);
  assert.equal(parseClockFields("9 pm")?.meridiem, "pm");
  assert.equal(parseClockFields("25:00"), null);
});

test("UTC offsets parse from many shapes", () => {
  assert.equal(parseOffsetMinutes("+10:30"), 630);
  assert.equal(parseOffsetMinutes("-0500"), -300);
  assert.equal(parseOffsetMinutes("Z"), 0);
  assert.equal(parseOffsetMinutes("UTC+2"), 120);
  assert.equal(parseOffsetMinutes("GMT-3:30"), -210);
  assert.equal(parseOffsetMinutes("nope"), null);
});

test("detectOrder distinguishes US and day-first columns", () => {
  assert.equal(detectOrder(["13/02/2024", "05/06/2024"]), "dmy");
  assert.equal(detectOrder(["02/13/2024", "05/06/2024"]), "mdy");
  assert.equal(detectOrder(["05/06/2024"]), "dmy");
});

test("parseDatePart handles ISO datetimes, epochs and meridiem", () => {
  const iso = emptyComponents();
  assert.equal(parseDatePart("2024-03-04T14:35:00Z", "datetime", "dmy", iso), true);
  assert.equal(iso.year, 2024);
  assert.equal(iso.hour, 14);
  assert.equal(iso.offsetMinutes, 0);

  const offset = emptyComponents();
  parseDatePart("2024-03-04T14:35:00+10:00", "datetime", "dmy", offset);
  assert.equal(offset.offsetMinutes, 600);

  const epoch = emptyComponents();
  assert.equal(parseDatePart("1700000000", "epoch", "dmy", epoch), true);
  assert.equal(epoch.year, 2023);
  assert.equal(epoch.month, 11);

  const meridiem = emptyComponents();
  parseDatePart("pm", "meridiem", "dmy", meridiem);
  assert.equal(meridiem.meridiem, "pm");
  assert.equal(parseDatePart("banana", "day", "dmy", emptyComponents()), false);
});

test("suggestRole uses value shapes first, then column names", () => {
  assert.equal(suggestRole("Year", ["2021", "2022", "2023"]), "year");
  assert.equal(suggestRole("col1", ["1999", "2024"]), "year");
  assert.equal(suggestRole("Month", ["Jan", "Feb"]), "month");
  assert.equal(suggestRole("col2", ["1", "12"]), "month");
  assert.equal(suggestRole("Day", ["1", "28", "31"]), "day");
  assert.equal(suggestRole("Hour", ["0", "23"]), "hour");
  assert.equal(suggestRole("col3", ["14:35", "09:00"]), "time");
  assert.equal(suggestRole("col4", ["2024-03-04", "2024-03-05"]), "date");
  assert.equal(suggestRole("col5", ["2024-03-04T14:35:00Z"]), "datetime");
  assert.equal(suggestRole("stamp", ["1700000000", "1700000001"]), "epoch");
  assert.equal(suggestRole("tz", ["+10:00", "-05:00"]), "offset");
  assert.equal(suggestRole("meridiem", ["AM", "PM"]), "meridiem");
});

test("parseDate keeps time and offsets for ISO datetimes", () => {
  assert.equal(parseDate("2024-03-04T14:35:00Z"), Date.UTC(2024, 2, 4, 14, 35));
  assert.equal(parseDate("2024-03-04T14:35:00+10:00"), Date.UTC(2024, 2, 4, 4, 35));
  assert.equal(parseDate("2024-03-04T14:35:12.250Z"), Date.UTC(2024, 2, 4, 14, 35, 12, 250));
});

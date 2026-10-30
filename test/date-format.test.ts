import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatProblem,
  fromStrftime,
  pandasDateArgs,
  parseWithFormat,
  polarsDateExpr,
  rankFormats,
  toStrftime,
} from "../src/parse/date-format.js";
import { classifyDateValue } from "../src/parse/dates.js";

const iso = (raw: string, format: string): string | null => {
  const v = parseWithFormat(raw, format);
  return v === null ? null : new Date(v.ms).toISOString();
};

test("year-month and year-only formats start on the first day", () => {
  assert.equal(iso("1749-01", "YYYY-MM"), "1749-01-01T00:00:00.000Z");
  assert.equal(iso("1749-1", "YYYY-MM"), "1749-01-01T00:00:00.000Z");
  assert.equal(iso("2024", "YYYY"), "2024-01-01T00:00:00.000Z");
  assert.equal(iso("2024 Q3", "YYYY [Q]Q"), "2024-07-01T00:00:00.000Z");
  assert.equal(iso("202403", "YYYYMM"), "2024-03-01T00:00:00.000Z");
  assert.equal(iso("1749-13", "YYYY-MM"), null, "no month 13");
});

test("day-month orders, month names and two-digit years", () => {
  assert.equal(iso("15.03.2024", "DD.MM.YYYY"), "2024-03-15T00:00:00.000Z");
  assert.equal(iso("03/15/2024", "MM/DD/YYYY"), "2024-03-15T00:00:00.000Z");
  assert.equal(iso("15-Mar-2024", "DD-MMM-YYYY"), "2024-03-15T00:00:00.000Z");
  assert.equal(iso("15-March-2024", "DD-MMM-YYYY"), "2024-03-15T00:00:00.000Z", "full name accepted for MMM");
  assert.equal(iso("Mar-24", "MMM-YY"), "2024-03-01T00:00:00.000Z");
  assert.equal(iso("Mar-85", "MMM-YY"), "1985-03-01T00:00:00.000Z");
  assert.equal(iso("31/02/2024", "DD/MM/YYYY"), null, "no 31 February");
  assert.equal(iso("Tuesday, 5 March 2024", "dddd, D MMMM YYYY"), "2024-03-05T00:00:00.000Z");
});

test("date and time formats: 24 and 12 hour clocks, fractions and offsets", () => {
  assert.equal(iso("2024-03-15 14:30:05", "YYYY-MM-DD HH:mm:ss"), "2024-03-15T14:30:05.000Z");
  assert.equal(iso("03/15/2024 02:30 PM", "MM/DD/YYYY hh:mm A"), "2024-03-15T14:30:00.000Z");
  assert.equal(iso("03/15/2024 12:05 am", "MM/DD/YYYY hh:mm A"), "2024-03-15T00:05:00.000Z");
  assert.equal(iso("2024-03-15 14:30:00.25", "YYYY-MM-DD HH:mm:ss.SSS"), "2024-03-15T14:30:00.250Z");
  assert.equal(iso("2024-03-15T14:30:00+10:00", "YYYY-MM-DD[T]HH:mm:ssZ"), "2024-03-15T04:30:00.000Z");
  assert.equal(iso("20240315143000", "YYYYMMDDHHmmss"), "2024-03-15T14:30:00.000Z");
  assert.equal(parseWithFormat("2024-03-15 14:30", "YYYY-MM-DD HH:mm")?.hasTime, true);
  assert.equal(iso("2024-03-15 25:00", "YYYY-MM-DD HH:mm"), null);
});

test("strftime formats work too, and convert back for pandas and Polars", () => {
  assert.equal(fromStrftime("%Y-%m"), "YYYY-MM");
  assert.equal(iso("15/03/2024 14:30", "%d/%m/%Y %H:%M"), "2024-03-15T14:30:00.000Z");
  assert.equal(toStrftime("DD.MM.YYYY HH:mm"), "%d.%m.%Y %H:%M");
  assert.equal(toStrftime("YYYY-[Q]Q"), null, "quarters have no strftime code");
  assert.equal(pandasDateArgs("fmt:YYYY-MM").args, 'format="%Y-%m"');
  assert.equal(pandasDateArgs("dmy").args, "dayfirst=True");
  assert.equal(pandasDateArgs("mdy").args, "dayfirst=False");
  // Polars needs a day: year-month values get one appended.
  assert.equal(polarsDateExpr('pl.col("m")', "fmt:YYYY-MM").expr, '(pl.col("m") + "|01").str.to_datetime(format="%Y-%m|%d", strict=False)');
});

test("unusable formats say why", () => {
  assert.match(formatProblem("MM-DD") ?? "", /needs a year/);
  assert.match(formatProblem("hh:mm DD/MM/YYYY") ?? "", /12-hour/);
  assert.equal(formatProblem("YYYY-MM"), null);
});

test("an explicit format rides on the date order everywhere dates are read", () => {
  assert.equal(classifyDateValue("1749-01", "dmy"), null, "automatic reading leaves year-month alone");
  assert.equal(new Date(classifyDateValue("1749-01", "fmt:YYYY-MM")!.ms).toISOString(), "1749-01-01T00:00:00.000Z");
});

test("formats are ranked by how many sample values they read", () => {
  const ranked = rankFormats(["1749-01", "1749-02", "1801-11", "2024-12"]);
  assert.equal(ranked[0]?.preset.format, "YYYY-MM");
  assert.equal(ranked[0]?.hits, 4);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { axisTicks, cropToXRange, dateBoundaries, dateTicks, formatDateTick, periodGrain, stepTicks, userDateTicks, userXRange, valueTop, valueY, type ChartAxes } from "../src/ui/chart-axes.js";
import type { ChartCard } from "../src/ui/chart-card.js";

/** Just what the axis helpers read from a card. */
function card(axes: ChartAxes | undefined): ChartCard {
  return { config: { axes }, axisXKind: null, axisYUsed: false, axisXGrain: null, axisXTickNote: "" } as unknown as ChartCard;
}

const month = (y: number, m: number): number => Date.UTC(y, m, 1);

test("a tick step the person set gives a tick at every multiple of it in range; unset gives round numbers", () => {
  assert.deepEqual(stepTicks(0, 20_000, 5000), [0, 5000, 10_000, 15_000, 20_000]);
  assert.deepEqual(stepTicks(1200, 4100, 1000), [2000, 3000, 4000]);
  assert.deepEqual(stepTicks(0, 1, 0.25), [0, 0.25, 0.5, 0.75, 1]);
  assert.equal(stepTicks(0, 1000, 1), null, "a step that would draw over 60 ticks is ignored");
  assert.equal(stepTicks(0, 10, null), null);
  assert.deepEqual(axisTicks(card({ yStep: 2500 }), "y", 0, 10_000, 4), [0, 2500, 5000, 7500, 10_000]);
  assert.deepEqual(axisTicks(card({ yStep: 3000 }), "x", 0, 10_000, 4), axisTicks(card(undefined), "x", 0, 10_000, 4), "a Y step leaves X automatic");
});

test("a Y range the person set maps its min to the plot's bottom and its max to the top", () => {
  const frame = { top: 10, plotH: 100 };
  assert.equal(valueTop(card({ yMax: 500 }), 900, 0), 500);
  assert.equal(valueTop(card({}), 900, 0), 900);
  assert.equal(valueTop(card({ yMax: 50 }), 900, 100), 900, "a max under the min is ignored");
  assert.equal(valueY(frame, 200, 200, 400), 110);
  assert.equal(valueY(frame, 400, 200, 400), 10);
  assert.equal(valueY(frame, 300, 200, 400), 60);
});

test("date ticks every N months, quarters or years, labelled as chosen", () => {
  const times = Array.from({ length: 36 }, (_, i) => month(2022, i));
  const every6 = dateTicks(card({ xEvery: { unit: "month", n: 6 } }), times, 20);
  assert.deepEqual(every6.map((tick) => tick.label), ["Jan 2022", "Jul 2022", "Jan 2023", "Jul 2023", "Jan 2024", "Jul 2024"]);
  const quarters = dateTicks(card({ xEvery: { unit: "quarter", n: 1 }, xFormat: "isoMonth" }), times, 20);
  assert.equal(quarters.length, 12);
  assert.deepEqual(quarters.slice(0, 3).map((tick) => tick.label), ["2022-01", "2022-04", "2022-07"]);
  const years = dateTicks(card({ xEvery: { unit: "year", n: 1 } }), times, 20);
  assert.deepEqual(years.map((tick) => [tick.index, tick.label]), [[0, "2022"], [12, "2023"], [24, "2024"]]);
  // Automatic placement, only the labels reformatted.
  const formatted = dateTicks(card({ xFormat: "quarter" }), times, 4);
  assert.ok(formatted.every((tick) => /^Q[1-4] 20\d\d$/.test(tick.label)), JSON.stringify(formatted));
  // Too many to read: a mark every month still, labels on an even multiple that fits, and it says so.
  const tight = card({ xEvery: { unit: "month", n: 1 } });
  const crowded = dateTicks(tight, times, 6);
  assert.equal(crowded.length, 36, "a mark at every month");
  assert.ok(crowded.every((tick) => tick.mark === true));
  assert.deepEqual(crowded.filter((tick) => tick.label !== "").slice(0, 3).map((tick) => tick.label), ["Jan 2022", "May 2022", "Sep 2022"]);
  assert.match(tight.axisXTickNote, /A tick every month; labelled every 4 months/);
});

test("a tick every quarter over twelve years: a mark at each quarter, a label at each Q1", () => {
  const times = Array.from({ length: 50 }, (_, i) => month(2014, i * 3));
  const c = card({ xEvery: { unit: "quarter", n: 1 }, xFormat: "quarter" });
  const ticks = dateTicks(c, times, 15);
  assert.equal(ticks.length, 50);
  const labels = ticks.filter((tick) => tick.label !== "").map((tick) => tick.label);
  assert.ok(labels.every((label) => label.startsWith("Q1 ")), labels.join(", "));
  assert.equal(labels[0], "Q1 2014");
  assert.match(c.axisXTickNote, /A tick every quarter; labelled every 4 quarters/);
});

test("ticks every 10 weeks on a chart by month become every 2 months, evenly, and say why", () => {
  const times = Array.from({ length: 60 }, (_, i) => month(2020, i));
  const c = card({ xEvery: { unit: "week", n: 10 }, xFormat: "isoDate" });
  const ticks = dateTicks(c, times, 20);
  assert.equal(c.axisXGrain, "month");
  assert.match(c.axisXTickNote, /every 10 weeks is drawn as every 2 months/);
  // Every label is the 1st of a month, two months apart.
  assert.deepEqual(ticks.slice(0, 4).map((tick) => tick.label), ["2020-01-01", "2020-03-01", "2020-05-01", "2020-07-01"]);
  const gaps = ticks.slice(1).map((tick, i) => tick.index - ticks[i]!.index);
  assert.ok(gaps.every((gap) => gap === 2), JSON.stringify(gaps));
});

test("calendar boundaries are exact dates, every N counted from the calendar or the first on the axis", () => {
  const iso = (t: number): string => new Date(t).toISOString().slice(0, 10);
  // Mondays, exactly 10 weeks apart from the first Monday in range.
  const weeks = dateBoundaries(Date.UTC(2024, 0, 3), Date.UTC(2024, 11, 31), "week", 10).map(iso);
  assert.deepEqual(weeks.slice(0, 3), ["2024-01-08", "2024-03-18", "2024-05-27"]);
  // Every 3 months lines up with quarters; every 5 counts from the first month in range.
  assert.deepEqual(dateBoundaries(Date.UTC(2024, 1, 10), Date.UTC(2024, 11, 31), "month", 3).map(iso), ["2024-04-01", "2024-07-01", "2024-10-01"]);
  assert.deepEqual(dateBoundaries(Date.UTC(2024, 1, 10), Date.UTC(2024, 11, 31), "month", 5).map(iso), ["2024-03-01", "2024-08-01"]);
  // Years divisible by N.
  assert.deepEqual(dateBoundaries(Date.UTC(2013, 5, 1), Date.UTC(2031, 0, 1), "year", 5).map(iso), ["2015-01-01", "2020-01-01", "2025-01-01", "2030-01-01"]);
  assert.equal(periodGrain([Date.UTC(2024, 0, 1), Date.UTC(2024, 1, 1), Date.UTC(2024, 2, 1)]), "month");
});

test("on a continuous date axis the ticks the person set are exact dates placed by time", () => {
  const c = card({ xEvery: { unit: "month", n: 1 }, xFormat: "isoDate" });
  const ticks = userDateTicks(c, Date.UTC(2024, 0, 15), Date.UTC(2024, 5, 20), 10)!;
  assert.deepEqual(ticks.map((tick) => tick.label), ["2024-02-01", "2024-03-01", "2024-04-01", "2024-05-01", "2024-06-01"]);
  assert.equal(userDateTicks(card({}), 0, 1e10, 10), null);
});

test("date tick formats", () => {
  const t = Date.UTC(2024, 0, 5);
  assert.equal(formatDateTick(t, "year"), "2024");
  assert.equal(formatDateTick(t, "quarter"), "Q1 2024");
  assert.equal(formatDateTick(t, "monthYear"), "Jan 2024");
  assert.equal(formatDateTick(t, "isoMonth"), "2024-01");
  assert.equal(formatDateTick(t, "dayMonth"), "5 Jan");
  assert.equal(formatDateTick(t, "isoDate"), "2024-01-05");
});

test("an X range on a chart of periods keeps the periods from the one holding X min to X max", () => {
  const times = Float64Array.from({ length: 12 }, (_, i) => month(2024, i));
  const result = {
    labels: Array.from(times, (t) => new Date(t).toISOString().slice(0, 7)),
    dimensions: [Array.from(times, (t) => new Date(t).toISOString().slice(0, 7))],
    dimensionTimes: [times],
    dimensionIsTime: [true],
    measures: [Float64Array.from({ length: 12 }, (_, i) => i * 10)],
    partials: Array.from({ length: 12 }, (_, i) => i === 11),
    groupCount: 12,
  };
  const cropped = cropToXRange(card({ xMin: Date.UTC(2024, 2, 15), xMax: Date.UTC(2024, 5, 1) }), result);
  assert.deepEqual(cropped.labels, ["2024-03", "2024-04", "2024-05", "2024-06"], "March holds the 15th, so it stays");
  assert.deepEqual(Array.from(cropped.measures[0]!), [20, 30, 40, 50]);
  assert.equal(cropped.groupCount, 4);
  assert.deepEqual(cropped.partials, [false, false, false, false]);
  assert.equal(cropToXRange(card({}), result), result, "nothing set: the same result");
  assert.equal(cropToXRange(card({ xMin: 0 }), { ...result, dimensionIsTime: [false] }).groupCount, 12, "not a date axis: untouched");
  assert.deepEqual(userXRange(card({ xMin: 5, xMax: 3 })), { min: null, max: null }, "crossed ends are ignored");
});

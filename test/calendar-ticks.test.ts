import { test } from "node:test";
import assert from "node:assert/strict";
import { calendarTicks } from "../src/ui/chart-utils.js";

const day = 86_400_000;
const start = Date.UTC(2022, 0, 3); // a Monday
const weekly = (n: number) => Array.from({ length: n }, (_, i) => start + i * 7 * day);
const daily = (n: number) => Array.from({ length: n }, (_, i) => start + i * day);

test("two years of weeks tick on quarters, not arbitrary dates", () => {
  const ticks = calendarTicks(weekly(104), 10);
  assert.ok(ticks.length >= 4 && ticks.length <= 10);
  for (const tick of ticks) assert.match(tick.label, /^(Q[1-4] \d{4}|[A-Z][a-z]{2} \d{4}|\d{4})$/);
  assert.equal(ticks[0].index, 0);
});

test("a few months of days tick on months or weeks and never exceed the maximum", () => {
  const ticks = calendarTicks(daily(120), 8);
  assert.ok(ticks.length <= 8);
  assert.ok(ticks.every((t) => /^([A-Z][a-z]{2} \d{4}|\d{1,2} [A-Z][a-z]{2})$/.test(t.label)));
});

test("ten years of months tick on years; a single day yields one tick", () => {
  const months = Array.from({ length: 120 }, (_, i) => Date.UTC(2015, i, 1));
  const ticks = calendarTicks(months, 8);
  assert.ok(ticks.every((t) => /^\d{4}$/.test(t.label)));
  assert.ok(ticks.length <= 8);
  assert.equal(calendarTicks([start], 8).length, 1);
  assert.deepEqual(calendarTicks([], 8), []);
});

import { fillTimeAxis, nextPeriod } from "../src/ui/chart-utils.js";

test("a continuous axis keeps missing periods in place", () => {
  const weeks = [start, start + 7 * day, start + 4 * 7 * day];
  assert.equal(fillTimeAxis(weeks, "week").length, 5);
  const months = [Date.UTC(2024, 0, 1), Date.UTC(2024, 1, 1), Date.UTC(2024, 4, 1)];
  const filled = fillTimeAxis(months, "month");
  assert.deepEqual(filled, [0, 1, 2, 3, 4].map((m) => Date.UTC(2024, m, 1)));
  assert.equal(nextPeriod(Date.UTC(2024, 11, 1), "month"), Date.UTC(2025, 0, 1));
  assert.equal(nextPeriod(Date.UTC(2024, 0, 1), "quarter"), Date.UTC(2024, 3, 1));
});

test("an axis that does not land on the observed buckets falls back to them", () => {
  const odd = [start, start + 3 * day, start + 10 * day];
  assert.deepEqual(fillTimeAxis(odd, "week"), odd);
});

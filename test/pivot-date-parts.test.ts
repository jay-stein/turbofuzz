import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDataset } from "../src/data/build.js";
import { computeAggregate, datePartLabel, type DatePart, type ViewDef } from "../src/data/aggregate.js";

const T = Date.UTC(2026, 10, 2, 14, 7, 9); // Monday 2 November 2026, 14:07:09, a Q4 date

test("every date part reads from a moment: the longer cycles first, down to the second", () => {
  const read = (part: DatePart): string => datePartLabel(T, part);
  assert.equal(read("quarter"), "Q4");
  assert.equal(read("month"), "Nov");
  assert.equal(read("week"), "W45");
  assert.equal(read("dom"), "02");
  assert.equal(read("dow"), "Mon");
  assert.equal(read("hour"), "14");
  assert.equal(read("minute"), "07");
  assert.equal(read("second"), "09");
  // The minute and second are of the hour and minute, not the whole day.
  assert.equal(datePartLabel(Date.UTC(2026, 0, 1, 0, 59, 59), "minute"), "59");
  assert.equal(datePartLabel(Date.UTC(2026, 0, 1, 23, 0, 0), "second"), "00");
});

test("minutes of the hour group across hours and sort in order", () => {
  const rows: string[][] = [];
  for (let h = 0; h < 3; h++) for (const m of [5, 35, 5]) rows.push([`2026-03-0${1 + h} 0${h}:${String(m).padStart(2, "0")}:00`, "1"]);
  const dataset = buildDataset("t", ["when", "n"], rows);
  const view: ViewDef = {
    id: "v", name: "v", dimensions: [{ column: 0, by: { datePart: "minute" } }], measures: [{ column: null, agg: "count" }],
    fill: "none", sort: { key: "dim0", dir: "asc" }, limit: 500, respectFilters: true,
  };
  const result = computeAggregate(view, dataset.columns, dataset.rowCount, Uint32Array.from(rows.map((_, i) => i)));
  assert.deepEqual(result.labels, ["05", "35"]);
  assert.deepEqual(Array.from(result.measures[0]!), [6, 3]);
});

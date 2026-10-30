import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTable } from "../src/data/timeseries/base.js";
import { seriesShape } from "../src/data/timeseries/shape.js";
import { timeDimension, viewSeriesInput } from "../src/data/timeseries/view-source.js";
import type { ViewDef } from "../src/data/aggregate.js";

const DAY = 86_400_000;
const month = (k: number): number => Date.UTC(2022, k, 1);

/** A view result: 24 months, optionally split by a second dimension with these labels. */
function result(players: string[] = []) {
  const rows = players.length ? 24 * players.length : 24;
  const times = new Float64Array(rows), sales = new Float64Array(rows), who: string[] = [];
  for (let r = 0; r < rows; r++) {
    const k = players.length ? Math.floor(r / players.length) : r;
    times[r] = month(k);
    // Few distinct whole numbers: the Table reading would call this a date part.
    sales[r] = 60 + (k % 4) * 3;
    who.push(players.length ? players[r % players.length]! : "");
  }
  const labels = [...times].map((t) => new Date(t).toISOString().slice(0, 7));
  const dimensions = players.length ? [labels, who] : [labels];
  return {
    dimensions,
    dimensionNames: players.length ? ["order_date (month)", "player"] : ["order_date (month)"],
    dimensionIsTime: players.length ? [true, false] : [true],
    dimensionTimes: players.length ? [times, new Float64Array(rows).fill(NaN)] : [times],
    measures: [sales],
    measureNames: ["sum(points)"],
    partials: null,
  };
}

test("a view's periods become the engine's rows, its measures plain columns", () => {
  const built = viewSeriesInput(result(), -1)!;
  assert.equal(built.input.times.length, 24);
  assert.equal(built.input.dateCol, "order_date (month)");
  assert.deepEqual(Object.keys(built.input.cols), ["sum(points)"]);
  assert.equal(built.input.aggregated, true);
  // Measures are never mistaken for date parts, so the series measures them at the view's grain.
  const table = buildTable(built.input)!;
  assert.deepEqual(table.timeLike, {});
  assert.equal(table.defMeasure, "sum(points)");
  assert.equal(table.eventLike, false);
});

test("a second dimension is a split choice, and the shape check names it when not split", () => {
  const unsplit = viewSeriesInput(result(["MJ", "Shaq", "LeBron"]), -1)!;
  assert.deepEqual(unsplit.input.groups, ["all"]);
  const shape = seriesShape(unsplit.input.times, null, unsplit.candidates);
  assert.equal(shape.typical, 3);
  assert.deepEqual(shape.keys.map((k) => [k.column, k.name]), [[1, "player"]]);

  const split = viewSeriesInput(result(["MJ", "Shaq", "LeBron"]), 1)!;
  assert.equal(split.input.groupCol, "player");
  assert.deepEqual(split.input.groups, ["LeBron", "MJ", "Shaq"]);
  assert.equal(split.input.rowGroup[0], 1);
});

test("edge periods the data only partly covers are flagged, from the raw rows", () => {
  // Daily rows from 1 Jan 2022 that stop on 1 Dec 2023: December is cut short.
  const cut = viewSeriesInput(result(), -1, { min: month(0), max: month(23), step: DAY })!;
  assert.deepEqual(cut.input.partialEdge, { first: false, last: true });
  // Stopping on 31 Dec covers the month (one day's step included).
  const full = viewSeriesInput(result(), -1, { min: month(0), max: month(24) - DAY, step: DAY })!;
  assert.deepEqual(full.input.partialEdge, { first: false, last: false });
  // Starting mid-January cuts the first month.
  const late = viewSeriesInput(result(), -1, { min: month(0) + 14 * DAY, max: month(24) - DAY, step: DAY })!;
  assert.equal(late.input.partialEdge?.first, true);
});

test("a view with no time dimension is not a series", () => {
  const r = result();
  assert.equal(viewSeriesInput({ ...r, dimensionIsTime: [false] }, -1), null);
  const view = { dimensions: [{ column: 0, by: "value" }, { column: 2, by: { time: "month" } }] } as unknown as ViewDef;
  assert.equal(timeDimension(view), 1);
});

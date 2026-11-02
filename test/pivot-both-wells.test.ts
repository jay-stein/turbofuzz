import { test } from "node:test";
import assert from "node:assert/strict";
import { type ViewDef } from "../src/data/aggregate.js";
import { movePivotField } from "../src/ui/views-panel.js";

function pivotView(): ViewDef {
  return {
    id: "p", name: "p",
    dimensions: [{ column: 0, by: { time: "month" } }, { column: 1, by: "value" }],
    measures: [{ column: 2, agg: "sum" }],
    fill: "none", sort: { key: "m0", dir: "desc" }, limit: 500, respectFilters: true,
    pivotColumns: [1], pivot: 1, pivotMeasure: 0,
  };
}

test("a date field already down the side is added again across the top, as a different period", () => {
  const view = pivotView();
  const added = movePivotField(view, { kind: "column", index: 0, well: "shelf" }, "columns", 1, false, true);
  assert.equal(added.ok, true);
  assert.equal(view.dimensions.length, 3, "the field now appears twice");
  assert.deepEqual(view.dimensions[0]!.by, { time: "month" }, "the one in the Index is untouched");
  const across = view.dimensions.filter((d, i) => view.pivotColumns!.includes(i) && d.column === 0);
  assert.deepEqual(across.map((d) => d.by), [{ time: "year" }], "and the new one is a period not already used");
});

test("a field dropped on the well it is already in moves; one in the other well is added there too", () => {
  const view = pivotView();
  // Column 1 sits in Columns: dropping it there again reorders, it does not duplicate.
  movePivotField(view, { kind: "column", index: 1, well: "shelf" }, "columns", 0, false);
  assert.equal(view.dimensions.filter((d) => d.column === 1).length, 1);
  // Dropping it on the Index as well gives it a place in both wells.
  const both = movePivotField(view, { kind: "column", index: 1, well: "shelf" }, "index", 0, false);
  assert.equal(both.ok, true);
  assert.equal(view.dimensions.filter((d) => d.column === 1).length, 2);
  assert.equal(view.pivotColumns!.length, 1, "one stays in Columns");
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { ColumnData } from "../src/data/column.js";
import { applyTransformOps } from "../src/data/transform-ops.js";

const data = (): ColumnData[] => [
  ColumnData.create("name", ["Ann", "Bo", "Cy", "Di"]),
  ColumnData.create("favourite_sport", ["soccer;tennis;golf", "golf", "", "a; b;;"]),
];

  test("explode makes one row per value and repeats the other columns", () => {
    const out = applyTransformOps("t", data(), [
      { kind: "explodeColumn", column: 1, pattern: ";", regex: false, trim: true, dropEmpty: true },
    ]);
    assert.deepEqual(out.columns[0].raw, ["Ann", "Ann", "Ann", "Bo", "Cy", "Di", "Di"]);
    assert.deepEqual(out.columns[1].raw, ["soccer", "tennis", "golf", "golf", "", "a", "b"]);
  });

  test("explode keeps empty pieces when asked and supports a regex delimiter", () => {
    const keep = applyTransformOps("t", data(), [
      { kind: "explodeColumn", column: 1, pattern: ";", regex: false, trim: false, dropEmpty: false },
    ]);
    assert.equal(keep.columns[1].raw[6], " b");
    assert.equal(keep.rowCount, 9);
    const re = applyTransformOps("t", data(), [
      { kind: "explodeColumn", column: 1, pattern: "[ ]*;[ ]*", regex: true, trim: true, dropEmpty: true },
    ]);
    assert.deepEqual(re.columns[1].raw, ["soccer", "tennis", "golf", "golf", "", "a", "b"]);
  });

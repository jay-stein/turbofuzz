import { test } from "node:test";
import assert from "node:assert/strict";
import { ColumnData } from "../src/data/column.js";
import { applySplitColumn, type SplitColumnOp } from "../src/data/split-column.js";

function column(name: string, values: string[]): ColumnData {
  return ColumnData.create(name, values);
}

function split(columns: ColumnData[], op: Partial<SplitColumnOp>): ColumnData[] {
  return applySplitColumn(columns, {
    kind: "splitColumn",
    column: 0,
    pattern: ",",
    regex: false,
    dropEmpty: true,
    dropOriginal: false,
    prefix: "",
    ...op,
  });
}

test("splits a delimited column into new columns by max part count", () => {
  const columns = [column("tags", ["a, b , c", "d,e", "", "x"])];
  const out = split(columns, {});
  assert.deepEqual(out.map((entry) => entry.name), ["tags", "tags_1", "tags_2", "tags_3"]);
  assert.deepEqual(out[1].raw, ["a", "d", "", "x"]);
  assert.deepEqual(out[2].raw, ["b", "e", "", ""]);
  assert.deepEqual(out[3].raw, ["c", "", "", ""]);
});

test("drop empty off keeps positional blanks", () => {
  const columns = [column("tags", ["a,,c"])];
  const out = split(columns, { dropEmpty: false });
  assert.deepEqual(out.map((entry) => entry.name), ["tags", "tags_1", "tags_2", "tags_3"]);
  assert.deepEqual(out[1].raw, ["a"]);
  assert.deepEqual(out[2].raw, [""]);
  assert.deepEqual(out[3].raw, ["c"]);
});

test("regex capture groups become the parts", () => {
  const columns = [column("pair", ["red - blue", "green - yellow"])];
  const out = split(columns, { regex: true, pattern: "(\\w+)\\s*-\\s*(\\w+)" });
  assert.deepEqual(out[1].raw, ["red", "green"]);
  assert.deepEqual(out[2].raw, ["blue", "yellow"]);
});

test("regex without groups splits on every match", () => {
  const columns = [column("list", ["a ; b;c"])];
  const out = split(columns, { regex: true, pattern: "\\s*;\\s*" });
  assert.deepEqual(out[1].raw, ["a"]);
  assert.deepEqual(out[2].raw, ["b"]);
  assert.deepEqual(out[3].raw, ["c"]);
});

test("invalid regex throws a friendly error", () => {
  const columns = [column("x", ["a,b"])];
  assert.throws(
    () => split(columns, { regex: true, pattern: "(" }),
    /Invalid regular expression/,
  );
});

test("too many parts error instead of exploding the column count", () => {
  const parts = Array.from({ length: 60 }, (_, index) => `v${index}`).join(",");
  const columns = [column("x", [parts])];
  assert.throws(() => split(columns, {}), /limit 50/);
});

test("dropOriginal replaces the source column in place", () => {
  const columns = [column("keep", ["1"]), column("tags", ["a,b"]), column("after", ["z"])];
  const out = split(columns, { column: 1, dropOriginal: true, prefix: "tag" });
  assert.deepEqual(out.map((entry) => entry.name), ["keep", "tag_1", "tag_2", "after"]);
  assert.deepEqual(out[1].raw, ["a"]);
  assert.deepEqual(out[3].raw, ["z"]);
});

test("prefix defaults to the source column name and names stay unique", () => {
  const columns = [column("tags", ["a,b"]), column("tags_1", ["existing"])];
  const out = split(columns, {});
  assert.deepEqual(out.map((entry) => entry.name), ["tags", "tags_1 (2)", "tags_2", "tags_1"]);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDataset, rebuildDataset } from "../src/data/build.js";
import { ColumnData } from "../src/data/column.js";

const headers = ["name", "value", "group"];
const rows = Array.from({ length: 120 }, (_, index) => [
  ` Name ${index % 17} `,
  String((index % 13) * 1.5),
  index % 3 === 0 ? "a" : index % 3 === 1 ? "b" : "a",
]);

function statsOf(dataset: ReturnType<typeof buildDataset>): unknown {
  const { computeMs: _computeMs, ...stats } = dataset.stats;
  return stats;
}

test("selective rebuild matches a full rebuild for unaffected columns", () => {
  const current = buildDataset("t", headers, rows);
  const columns = current.columns.slice();
  const cleaned = ColumnData.create("name", ["A", "B", ...rows.slice(2).map((row) => row[0] ?? "")]);
  columns[0] = cleaned;

  const selective = rebuildDataset(current, columns, [0]);
  const full = rebuildDataset(current, columns);

  assert.deepEqual(statsOf(selective), statsOf(full));
  assert.deepEqual([...selective.duplicateBits.words], [...full.duplicateBits.words]);
  assert.deepEqual([...selective.nullRowBits.words], [...full.nullRowBits.words]);
  assert.deepEqual([...selective.valueAnomalyBits.words], [...full.valueAnomalyBits.words]);
  assert.deepEqual([...selective.lengthAnomalyBits.words], [...full.lengthAnomalyBits.words]);
  assert.deepEqual(selective.valueFences, full.valueFences);
  assert.deepEqual(selective.lengthFences, full.lengthFences);
  assert.equal(selective.columns[1], current.columns[1], "unaffected column is reused");
  assert.equal(selective.columns[2], current.columns[2], "unaffected column is reused");
});

test("selective rebuild refuses stale stats when the affected column changes", () => {
  const current = buildDataset("t", headers, rows);
  const columns = current.columns.slice();
  columns[1] = ColumnData.create("value", ["1", "2", ...rows.slice(2).map((row) => row[1] ?? "")]);
  const selective = rebuildDataset(current, columns, [1]);
  const full = rebuildDataset(current, columns);
  assert.deepEqual(statsOf(selective), statsOf(full));
  assert.deepEqual([...selective.valueAnomalyBits.words], [...full.valueAnomalyBits.words]);
});
import { test } from "node:test";
import assert from "node:assert/strict";
import { listNames, researchGaps } from "../src/ui/tab-availability.js";
import type { ColumnMeta } from "../src/worker/protocol.js";

const col = (name: string, type: string, extra: Partial<ColumnMeta> = {}): ColumnMeta =>
  ({ name, type, role: null, suggestions: [], stats: { nulls: 0, distinct: 5, min: 0, max: 9 }, ...extra }) as unknown as ColumnMeta;

test("research tabs are greyed only when this table has nothing for them, each with a reason", () => {
  const plain = [col("agent", "category"), col("price", "number")];
  const gaps = researchGaps(plain, 50);
  assert.match(gaps.timeseries ?? "", /No date column/);
  assert.match(gaps.map ?? "", /No latitude and longitude/);
  assert.equal(gaps.relationships, undefined);
  assert.equal(gaps.outliers, undefined, "Outliers also checks text, so it is never greyed");

  const full = [col("day", "date"), col("lat", "number"), col("lon", "number"), col("price", "number")];
  assert.deepEqual(researchGaps(full, 50), {});

  assert.match(researchGaps([col("only", "string")], 5).relationships ?? "", /two columns/);
  assert.deepEqual(researchGaps([], 0), {}, "nothing loaded, nothing greyed");
});

test("names are listed briefly", () => {
  assert.equal(listNames(["a", "b"]), "a, b");
  assert.equal(listNames(["a", "b", "c", "d", "e"]), "a, b, c and 2 more");
});

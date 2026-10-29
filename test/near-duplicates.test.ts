import { test } from "node:test";
import assert from "node:assert/strict";
import { columnsIgnoring, idLikeColumns, nearDuplicateFinding } from "../src/data/near-duplicates.js";
import type { ColumnMeta } from "../src/worker/protocol.js";

const meta = (name: string, type: string, distinct: number, nulls = 0): ColumnMeta =>
  ({ name, type, role: null, stats: { distinct, nulls } }) as unknown as ColumnMeta;

const metas = [meta("id", "integer", 100), meta("name", "string", 60), meta("city", "string", 5)];

test("id-like columns are unique and complete on every row", () => {
  assert.deepEqual(idLikeColumns(metas, 100), [0]);
  assert.deepEqual(idLikeColumns([meta("id", "integer", 100, 2), metas[1]], 100), []);
  assert.deepEqual(idLikeColumns(metas, 10), [], "tiny tables are left alone");
});

test("the compared columns exclude the ids and need at least two", () => {
  assert.deepEqual(columnsIgnoring(metas, [0]), [1, 2]);
  assert.deepEqual(columnsIgnoring([metas[0], metas[1]], [0]), []);
});

test("the finding is a review item with a Show duplicates action, or null when nothing repeats", () => {
  assert.equal(nearDuplicateFinding(metas, [0], [1, 2], 0, 0), null);
  const finding = nearDuplicateFinding(metas, [0], [1, 2], 16, 8);
  assert.equal(finding?.severity, "review");
  assert.match(finding?.title ?? "", /16 rows repeat another row when “id” is ignored/);
  assert.equal(finding?.action?.kind, "keyDuplicates");
});

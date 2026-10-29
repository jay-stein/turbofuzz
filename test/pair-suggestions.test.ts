import { test } from "node:test";
import assert from "node:assert/strict";
import { suggestPairs } from "../src/data/pair-checks.js";
import type { ColumnMeta } from "../src/worker/protocol.js";

const m = (name: string, type: string): ColumnMeta => ({ name, type }) as unknown as ColumnMeta;

test("name pairs of the same type family become end >= start checks", () => {
  const pairs = suggestPairs([m("order_start", "date"), m("order_end", "date"), m("min_price", "number"), m("max_price", "number")]);
  assert.deepEqual(pairs.map((p) => [p.a, p.b]), [[1, 0], [3, 2]]);
  assert.match(pairs[0].label, /order_end.*order_start/);
});

test("different families, different stems or text columns propose nothing", () => {
  assert.deepEqual(suggestPairs([m("start", "date"), m("end", "string")]), []);
  assert.deepEqual(suggestPairs([m("order_start", "date"), m("ship_end", "date")]), []);
  assert.deepEqual(suggestPairs([m("created", "date"), m("updated", "date")]).length, 1);
});

test("camelCase names split into words", () => {
  assert.equal(suggestPairs([m("startDate", "date"), m("endDate", "date")]).length, 1);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { castColumn, losesDigits } from "../src/data/cast-ops.js";
import { ColumnData } from "../src/data/column.js";
import { CONVERT_MAX_LOSS_SHARE, computeDQScore } from "../src/data/score.js";
import type { ColumnMeta } from "../src/worker/protocol.js";

const opts = { target: "integer", policy: "coerce", locale: "dot", dateOrder: "dmy" } as const;

test("leading zeros and 16+ digit strings are digit-changing", () => {
  assert.equal(losesDigits("0412345678"), true);
  assert.equal(losesDigits("007"), true);
  assert.equal(losesDigits("-007"), true);
  assert.equal(losesDigits("1234567890123456"), true);
  assert.equal(losesDigits("0"), false);
  assert.equal(losesDigits("0.5"), false);
  assert.equal(losesDigits("42"), false);
});

test("castColumn counts digit loss and non-empty cells", () => {
  const result = castColumn(["0412", "0499", "17", "", "x"], opts);
  assert.equal(result.digitLoss, 2);
  assert.equal(result.nonEmpty, 4);
  assert.equal(result.failed, 1);
  // Non-numeric targets never count digit loss.
  assert.equal(castColumn(["0412"], { ...opts, target: "date" }).digitLoss, 0);
});

function scoreFor(junkPct: number) {
  const rows = 1000;
  const raw = Array.from({ length: rows }, (_, i) => (i < (rows * junkPct) / 100 ? "n0pe" : String((i % 5) + 1)));
  const column = ColumnData.create("Quantity", raw);
  const meta = {
    name: "Quantity", type: column.type, numberLocale: column.numberLocale, dateOrder: column.dateOrder,
    stats: column.stats, anomalyCounts: { values: 0, lengths: 0 }, similarGroups: 0, categories: null,
    histogram: null, valueFence: null, lengthFence: null, nullPolicy: { extra: [], keep: [] },
    nullTokens: [], suggestions: column.suggestions, typeDowngrade: column.typeDowngrade,
    conformance: column.conformance,
  } as ColumnMeta;
  const stats = { duplicateRows: 0, duplicateGroups: 0, rowsInDuplicateGroups: 0, emptyRows: 0, rowsWithNulls: 0, totalNullCells: 0, totalCells: rows, valueAnomalyRows: 0, lengthAnomalyRows: 0, computeMs: 1 };
  return computeDQScore([meta], stats, rows).dimensions.find((d) => d.dimension === "validity")!.checks[0];
}

test("a conversion that would blank more than 10% is not offered and claims no fix", () => {
  assert.equal(CONVERT_MAX_LOSS_SHARE, 0.1);
  // 8% junk makes the column a category by storage, so converting is the fix.
  const small = scoreFor(8);
  assert.equal(small.convertTo, "integer");
  assert.equal(small.fixBlocked, undefined);

  const big = scoreFor(12);
  assert.equal(big.convertTo, undefined);
  assert.match(big.fixBlocked ?? "", /blank 120 of 1,000/);
  assert.equal(big.fail, 120, "the failures still count against the score");
});

test("identifier-like columns never get a convert offer", () => {
  const phones = Array.from({ length: 200 }, (_, i) => `04${10000000 + i * 3}`);
  const ticket = Array.from({ length: 200 }, (_, i) => (i % 2 ? `PC ${17000 + i}` : String(300000 + i)));
  for (const [name, raw] of [["mobile", phones], ["Ticket", ticket], ["zip", Array.from({ length: 200 }, (_, i) => String(2000 + (i % 40)).padStart(5, "0"))]] as const) {
    const column = ColumnData.create(name, raw);
    assert.equal(column.conformance, null, name);
    assert.equal(column.typeDowngrade, null, name);
    assert.ok(!column.suggestions.some((s) => s.kind === "number" || s.kind === "typeConflict"), name);
  }
});

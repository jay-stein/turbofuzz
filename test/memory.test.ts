import { test } from "node:test";
import assert from "node:assert/strict";
import { ColumnData } from "../src/data/column.js";
import { estimateTableBytes, formatMemory, memoryLimit, memoryTone, projectLoadBytes } from "../src/data/memory.js";

const GB = 1024 ** 3;

test("the table estimate grows with cells, characters and distinct values", () => {
  const rows = 10_000;
  const ids = ColumnData.create("id", Array.from({ length: rows }, (_, i) => `ID-${100000 + i}`));
  const region = ColumnData.create("region", Array.from({ length: rows }, (_, i) => ["North", "South"][i % 2]!));
  const unique = estimateTableBytes([ids], rows);
  const repeated = estimateTableBytes([region], rows);
  // 12/cell + 3.5/char × 9 chars, + 32 per distinct value: unique ids cost far more than two repeated words.
  assert.equal(unique, Math.round(rows * (12 + 9 * 3.5) + rows * 32));
  assert.equal(repeated, Math.round(rows * (12 + 5 * 3.5) + 2 * 32));
  assert.equal(estimateTableBytes([ids, region], rows), unique + repeated);
  assert.equal(estimateTableBytes([], 0), 0);
  // Text outside Latin-1 takes two bytes a character.
  const greek = ColumnData.create("g", Array.from({ length: rows }, () => "αβγδε"));
  assert.equal(estimateTableBytes([greek], rows), Math.round(rows * (12 + 5 * 7) + 32));
});

test("a file's projection allows for the parse peak", () => {
  assert.equal(projectLoadBytes(1_000_000, 100_000), Math.round(100_000 * 16.8 + 1_000_000 * 5.5));
});

test("the limit comes from the browser, else the device, else a safe default", () => {
  assert.deepEqual(memoryLimit({ heapLimit: 4.2 * GB, deviceMemoryGb: 8 }), { bytes: 4.2 * GB, source: "browser" });
  assert.deepEqual(memoryLimit({ deviceMemoryGb: 4 }), { bytes: 2 * GB, source: "device" });
  assert.deepEqual(memoryLimit({ deviceMemoryGb: 32 }), { bytes: 4 * GB, source: "device" }, "a tab rarely gets more than 4 GB");
  assert.deepEqual(memoryLimit({}), { bytes: 2 * GB, source: "default" });
});

test("sizes read short, and the tone turns at 60% and 85% of the limit", () => {
  assert.deepEqual([formatMemory(512), formatMemory(420 * 1024 ** 2), formatMemory(1.34 * GB), formatMemory(12 * GB)], ["1 KB", "420 MB", "1.3 GB", "12 GB"]);
  assert.deepEqual([memoryTone(10, 100), memoryTone(60, 100), memoryTone(85, 100), memoryTone(1, 0)], ["ok", "warn", "high", "ok"]);
});

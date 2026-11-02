import assert from "node:assert/strict";
import test from "node:test";
import { binnedSummary, binRows, extractRows, extractTsv, linearFit, seriesRows, summarise } from "../src/data/chart-extract.js";
import { formatFormulaSafe } from "../src/data/formula-safe.js";

test("a summary skips blanks and says where the extremes are", () => {
  const stats = summarise(Float64Array.of(4, Number.NaN, 2, 6))!;
  assert.deepEqual([stats.n, stats.sum, stats.mean, stats.min, stats.max, stats.minAt, stats.maxAt], [3, 12, 4, 2, 6, 2, 3]);
  assert.equal(stats.sd, 2);
  assert.equal(summarise([Number.NaN]), null);
});

test("the straight line recovers a known slope and intercept", () => {
  const fit = linearFit([0, 1, 2, 3, Number.NaN], [5, 7, 9, 11, 100])!;
  assert.equal(fit.n, 4);
  assert.equal(fit.slope, 2);
  assert.equal(fit.intercept, 5);
  assert.equal(fit.r2, 1);
  assert.equal(linearFit([1, 1], [2, 3]), null, "no spread in x, no line");
});

test("bin rows carry shares that build to one, counting what sits above the last bin", () => {
  const rows = binRows([1, 3], [0, 10, 20], null);
  assert.deepEqual(rows[1], ["0", "10", "1", "0.250000", "0.250000"]);
  assert.deepEqual(rows[2], ["10", "20", "3", "0.750000", "1.000000"]);
  assert.equal(binRows([1, 3], [0, 10, 20], null, undefined, 4)[2]![4], "0.500000");
  const est = binnedSummary([1, 3], [0, 10, 20])!;
  assert.equal(est.n, 4);
  assert.equal(est.mean, 12.5);
});

test("each series reports its extremes with their periods, first, last and change", () => {
  const rows = seriesRows(["city"], ["a", "a", "b", "a"], ["jan", "feb", "jan", "mar"], [3, 1, 9, 7]);
  assert.deepEqual(rows[1], ["a", "3", "11", String(11 / 3), "1", "feb", "7", "mar", "3", "7", "4"]);
  assert.equal(rows[2]![0], "b");
});

test("a text cell a spreadsheet would run is made harmless; numbers stay numbers", () => {
  assert.equal(formatFormulaSafe("=SUM(A1)"), "'=SUM(A1)");
  assert.equal(formatFormulaSafe("-5.5"), "-5.5");
  assert.equal(formatFormulaSafe("@cmd"), "'@cmd");
  const tsv = extractTsv(extractRows({ title: "T", facts: [["a", "b"]], sections: [{ title: "S", rows: [["x"], ["=1+1"], ["two\nlines"]] }] }));
  assert.equal(tsv, "T\na\tb\n\nS\nx\n'=1+1\ntwo lines");
});

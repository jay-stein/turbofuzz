import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDataset } from "../src/data/build.js";
import { buildCsv, csvEscape } from "../src/worker/csv.js";

test("csvEscape quotes separators, quotes and newlines", () => {
  assert.equal(csvEscape("plain"), "plain");
  assert.equal(csvEscape("a,b"), '"a,b"');
  assert.equal(csvEscape('say "hi"'), '"say ""hi"""');
  assert.equal(csvEscape("line1\nline2"), '"line1\nline2"');
  assert.equal(csvEscape("carriage\rreturn"), '"carriage\rreturn"');
});

test("buildCsv writes header and escapes rows", () => {
  const dataset = buildDataset("t", ["name", "note"], [
    ["x,y", 'q"z'],
    ["plain", ""],
  ]);
  const ids = Uint32Array.from([0, 1]);
  const text = buildCsv(dataset, ids, 0, 2, true);
  assert.equal(text, 'name,note\r\n"x,y","q""z"\r\nplain,\r\n');
});

test("buildCsv chunks concatenate cleanly", () => {
  const dataset = buildDataset("t", ["a"], [["1"], ["2"]]);
  const ids = Uint32Array.from([0, 1]);
  const first = buildCsv(dataset, ids, 0, 1, true);
  const second = buildCsv(dataset, ids, 1, 2, false);
  assert.equal(first, "a\r\n1\r\n");
  assert.equal(second, "2\r\n");
  assert.equal(first + second, "a\r\n1\r\n2\r\n");
});

test("exports typed numeric and date values with blanks for missing", () => {
  const dataset = buildDataset("t", ["item_price", "day"], [
    ["$2.39 ", "2024-07-01"],
    ["NULL", "2024-07-02"],
  ]);
  const ids = Uint32Array.from([0, 1]);
  assert.equal(
    buildCsv(dataset, ids, 0, 2, true),
    "item_price,day\r\n2.39,2024-07-01\r\n,2024-07-02\r\n",
  );
});

test("exports european decimals as canonical numbers", () => {
  const dataset = buildDataset("t", ["umsatz"], [["198,72"], ["0,50"]], undefined, "comma");
  const ids = Uint32Array.from([0, 1]);
  assert.equal(buildCsv(dataset, ids, 0, 2, true), "umsatz\r\n198.72\r\n0.5\r\n");
});

test("nullAsBlank controls text null handling", () => {
  const dataset = buildDataset("t", ["city"], [["NULL"], ["Perth"]]);
  const ids = Uint32Array.from([0, 1]);
  assert.equal(
    buildCsv(dataset, ids, 0, 2, true, { nullAsBlank: false }),
    "city\r\nNULL\r\nPerth\r\n",
  );
  assert.equal(
    buildCsv(dataset, ids, 0, 2, true, { nullAsBlank: true }),
    "city\r\n\r\nPerth\r\n",
  );
});

test("escapeFormulas guards formula-like cells but keeps plain numbers", () => {
  const dataset = buildDataset("t", ["email", "amount"], [
    ["=1+1", "-999"],
    ["@SUM(1,1)", "12.5"],
    ["+1+2", "-20"],
    ["-2+3", "7"],
  ]);
  const ids = Uint32Array.from([0, 1, 2, 3]);
  assert.equal(
    buildCsv(dataset, ids, 0, 4, true, { escapeFormulas: true }),
    "email,amount\r\n'=1+1,-999\r\n\"'@SUM(1,1)\",12.5\r\n'+1+2,-20\r\n'-2+3,7\r\n",
  );
  // Off by default: values are exported untouched.
  assert.match(buildCsv(dataset, ids, 0, 4, true), /^email,amount\r\n=1\+1,-999/);
});

test("buildCsv masks or leaves out chosen columns", () => {
  const dataset = buildDataset("t", ["id", "email", "city"], [
    ["1", "jane@example.com", "Perth"],
    ["2", "", "Hobart"],
  ]);
  const ids = Uint32Array.from([0, 1]);
  const masked = buildCsv(dataset, ids, 0, 2, true, {
    columnHandling: [{ column: 1, mode: "mask" }],
  });
  assert.equal(masked, "id,email,city\r\n1,j***@example.com,Perth\r\n2,,Hobart\r\n");

  const excluded = buildCsv(dataset, ids, 0, 2, true, {
    columnHandling: [{ column: 1, mode: "exclude" }],
  });
  assert.equal(excluded, "id,city\r\n1,Perth\r\n2,Hobart\r\n");

  // Chunks without a header still drop the column.
  assert.equal(
    buildCsv(dataset, ids, 1, 2, false, { columnHandling: [{ column: 1, mode: "exclude" }] }),
    "2,Hobart\r\n",
  );
});

test("a typed cell that does not parse keeps its text on export; missing markers still blank", () => {
  const numbers = Array.from({ length: 60 }, (_, i) => [`${i + 1}.50`]);
  const rows = [...numbers, ["19215.35 DR"], ["N/A"]];
  const dataset = buildDataset("t", ["amount"], rows);
  assert.equal(dataset.columns[0].type, "number");
  const ids = Uint32Array.from(rows.map((_, i) => i));
  const lines = buildCsv(dataset, ids, 0, rows.length, true).split(/\r\n/);
  assert.equal(lines[1], "1.5");
  assert.equal(lines[61], "19215.35 DR");
  assert.equal(lines[62], "");
});

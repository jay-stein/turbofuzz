import { test } from "node:test";
import assert from "node:assert/strict";
import { ColumnData } from "../src/data/column.js";
import { looksLikeRowIndex } from "../src/data/identifier.js";

const seq = (n: number, start = 0): string[] => Array.from({ length: n }, (_, i) => String(start + i));
const typeOf = (name: string, values: string[]): string => ColumnData.create(name, values).type;

test("a blank-header 0..N-1 counter (pandas index export) is an identifier, not an integer", () => {
  assert.equal(typeOf("", seq(150_930)), "identifier");
  assert.equal(typeOf("Unnamed: 0", seq(500)), "identifier");
  assert.equal(typeOf("Column 1", seq(150_930)), "identifier", "the app’s name for a blank header");
  assert.equal(typeOf("index", seq(40, 1)), "identifier");
});

test("a long consecutive run is an identifier even with an ordinary header", () => {
  assert.equal(typeOf("record", seq(1_000, 1)), "identifier");
  assert.equal(typeOf("serial", seq(12, 100)), "identifier", "a serial-style header lowers the bar");
});

test("an index-style header tolerates holes left by filtering", () => {
  const values = seq(300).filter((_, i) => i % 25 !== 3);
  assert.equal(typeOf("", values), "identifier");
  assert.equal(typeOf("record", values), "integer", "an ordinary header needs a clean run");
});

test("axis and step numbers stay integers even as a clean run", () => {
  assert.equal(typeOf("x", seq(60)), "integer");
  assert.equal(typeOf("step", seq(1_000)), "integer");
  assert.equal(typeOf("t", seq(500, 1)), "integer");
});

test("measures are never mistaken for counters", () => {
  assert.equal(typeOf("year", seq(60, 1960)), "integer", "a year series is a measure");
  assert.equal(typeOf("price", seq(500, 1)), "integer");
  assert.equal(typeOf("points", Array.from({ length: 300 }, (_, i) => String(80 + (i % 21)))), "integer");
});

test("repeated, shuffled or sparse integers stay integers", () => {
  const shuffled = seq(300).sort((a, b) => ((Number(a) * 7919) % 301) - ((Number(b) * 7919) % 301));
  assert.equal(typeOf("quantity_sold", shuffled), "integer");
  const sparse = Array.from({ length: 200 }, (_, i) => String(i * 1000));
  assert.equal(typeOf("reading", sparse), "integer");
  const repeated = Array.from({ length: 200 }, (_, i) => String(Math.floor(i / 2)));
  assert.equal(typeOf("", repeated), "integer", "duplicates mean it is not a unique counter");
});

test("tiny tables are left alone unless the header says index", () => {
  assert.equal(looksLikeRowIndex(seq(6), "", 0, 6), false);
  assert.equal(looksLikeRowIndex(seq(20), "col", 0, 20), false, "too short without a header hint");
  assert.equal(looksLikeRowIndex(seq(20), "index", 0, 20), true);
});

test("a counter with missing cells is not a clean index", () => {
  const values = seq(200);
  for (let i = 0; i < 10; i++) values[i * 7] = "";
  assert.equal(typeOf("", values), "integer");
});
